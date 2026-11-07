"""Original recorded-count predictive challenger: cached, chronological research.

No provider calls, live output writes or frozen-model changes. Model selection
uses older seasons only; familiar later years remain retrospective evidence.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np

from composite_outcome_replay import replay_year as outcome_replay
from predictive_v2_ingest import FEATURES, GROUPS, load_year
from predictive_v2_model import fit_unit_metrics, matchup_features
from replay_weekly import timestamp

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SHA = lambda raw: hashlib.sha256(raw).hexdigest()
CODE_FILES = ('predictive_v2_experiment.py', 'predictive_v2_ingest.py', 'predictive_v2_model.py',
              'composite_outcome_replay.py', 'compare_merit.py', 'division_experiment.py', 'replay_weekly.py')


def feature_columns(family, protocol):
    result = []
    for member in protocol['prediction']['families'][family]:
        result.extend(GROUPS[member] if member in GROUPS else [member])
    return result


def prepare_observations(past):
    observations = {metric: [] for metric in FEATURES}
    basic_counts = Counter()
    for game in past:
        if not game['knownD1'] or game['stats'] is None:
            continue
        if all(game['stats'][side]['features']['ypp'] is not None for side in ('home', 'away')):
            basic_counts.update((game['home'], game['away']))
        for side, opposite, sign in [('home', 'away', 1), ('away', 'home', -1)]:
            for metric in FEATURES:
                value = game['stats'][side]['features'][metric]
                if value is not None:
                    observations[metric].append(dict(gameId=game['id'], offense=game[side], defense=game[opposite],
                                                      value=value, venue=0 if game['neutral'] else sign))
    return observations, basic_counts


def replay_features(data, outcomes, ridge, protocol):
    if data['year'] != outcomes['year']:
        raise ValueError('Raw-stat and outcome replay years differ')
    if data['parentSha256'] != outcomes['sourceSha256']:
        raise ValueError('Raw-stat and baseline parent graphs differ')
    games = {game['id']: game for game in data['games']}
    teams = [team for team in data['teams'] if team['division'] in ('fbs', 'fcs')]
    config = dict(protocol['features']['context'], ridge=ridge)
    rows = []; checkpoints = []; seen_targets = set()
    for point in outcomes['checkpoints']:
        cutoff = timestamp(point['cutoff'])
        target_ids = {game['id'] for game in point['targets']}
        eligible = set(point['eligibleGameIds'])
        if eligible & target_ids or not eligible <= set(games):
            raise ValueError('Future target or incompatible game entered raw-stat graph')
        past = [games[identity] for identity in sorted(eligible)]
        if any(timestamp(game['startDate']) + 86400 > cutoff for game in past):
            raise ValueError('Raw-stat availability buffer violated')
        observations, basic_counts = prepare_observations(past)
        fitted = fit_unit_metrics(teams, observations, config)
        primary_count = native_count = target_count = 0
        for target in point['targets']:
            if target['id'] in seen_targets:
                raise ValueError('Duplicate target in weekly replay')
            seen_targets.add(target['id'])
            home, away = target['home'], target['away']
            a, b = point['rows'].get(home), point['rows'].get(away)
            if a is None or b is None:
                continue
            target_count += 1
            if target['homePoints'] == target['awayPoints']:
                raise ValueError('Tied modern FBS target requires an explicit policy')
            native = min(a['games'], b['games']) >= 4
            primary = native and min(basic_counts[home], basic_counts[away]) >= 4
            native_count += int(native); primary_count += int(primary)
            venue = int(not target['neutral'])
            values = dict(strength=a['strength'] - b['strength'], venue=venue)
            supports = {}
            for metric in FEATURES:
                predicted = matchup_features(fitted[metric], home, away, venue)
                values[metric] = predicted['difference']
                supports[metric] = {name: predicted[name] for name in
                    ('homeMeasuredGames', 'awayMeasuredGames', 'homeOffenseGames', 'homeDefenseGames',
                     'awayOffenseGames', 'awayDefenseGames')}
            rows.append(dict(id=target['id'], year=data['year'], block=point['block'], kind=point['kind'],
                             week=point['week'], home=home, away=away, homeTeam=a['team'], awayTeam=b['team'],
                             y=int(target['homePoints'] > target['awayPoints']), venue=venue,
                             primary=primary, nativeBaseline=native,
                             basicCounts=[basic_counts[home], basic_counts[away]],
                             outcomeCounts=[a['games'], b['games']], metricSupport=supports, features=values))
        checkpoints.append(dict(block=point['block'], cutoff=point['cutoff'], completedParentGames=len(past),
                                observedMetricSides={metric: len(value) for metric, value in observations.items()},
                                fbsFbsTargets=target_count, nativeBaselineTargets=native_count,
                                commonPrimaryTargets=primary_count,
                                maxUnitNormalResidual=max(model['fitDiagnostics']['maximumNormalEquationResidual'] for model in fitted.values())))
    return dict(year=data['year'], ridge=ridge, rows=rows, checkpoints=checkpoints,
                coverage=data['audit'], source={key: data[key] for key in ('sourceSha256', 'parentSha256', 'sourceManifestSha256')},
                baseline=outcomes['provenance'])


def cached_features(data, outcomes, ridge, protocol_bytes, protocol, code_hashes):
    identity = dict(source=data['sourceSha256'], parent=data['parentSha256'], baseline=outcomes['provenance'],
                    protocol=SHA(protocol_bytes), ridge=ridge, code=code_hashes, numpy=np.__version__)
    key = SHA(json.dumps(identity, sort_keys=True).encode())
    path = HERE/f'cache/predictive-v2/features/{data["year"]}-{ridge}-{key}.json.gz'
    if path.exists():
        return json.loads(gzip.decompress(path.read_bytes()))
    result = replay_features(data, outcomes, ridge, protocol)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(json.dumps(result, separators=(',', ':'), allow_nan=False).encode(), mtime=0))
    return result


def matrix(rows, columns):
    return np.array([[row['features'][name] for name in columns] for row in rows], dtype=float).reshape((-1, len(columns)))


def logistic_fit(rows, columns, penalty):
    if not rows or not np.isfinite(penalty) or penalty <= 0:
        raise ValueError('Nonempty earlier training and positive penalty required')
    raw = matrix(rows, columns)
    if not np.all(np.isfinite(raw)):
        raise ValueError('A model feature is not a finite reconstructed estimate')
    scale = np.sqrt(np.mean(raw**2, axis=0)); scale[scale < 1e-12] = 1.
    x = raw / scale
    y = np.array([row['y'] for row in rows])
    beta = np.zeros(len(columns))
    for iteration in range(150):
        z = x @ beta; p = 1 / (1 + np.exp(-np.clip(z, -700, 700)))
        objective = float(np.sum(np.logaddexp(0, z) - y*z) + .5*penalty*(beta @ beta))
        gradient = x.T @ (p-y) + penalty*beta
        hessian = x.T @ (x*(p*(1-p))[:, None]) + penalty*np.eye(len(beta))
        step = np.linalg.solve(hessian, gradient)
        amount = 1.
        while amount > 1e-9:
            candidate = beta - amount*step; zz = x @ candidate
            candidate_objective = np.sum(np.logaddexp(0, zz)-y*zz) + .5*penalty*(candidate @ candidate)
            if candidate_objective <= objective + 1e-10:
                break
            amount *= .5
        beta = candidate
        if float(np.max(abs(amount*step))) < 1e-10:
            break
    p = 1 / (1 + np.exp(-np.clip(x @ beta, -700, 700)))
    residual = float(np.max(abs(x.T @ (p-y) + penalty*beta)))
    if not np.all(np.isfinite(beta)) or residual > 1e-5:
        raise ValueError('Penalized probability fit failed its gradient check')
    return dict(columns=columns, scale=scale.tolist(), coefficients=beta.tolist(), penalty=penalty,
                originalUnitCoefficients=(beta/scale).tolist(), trainingGames=len(rows),
                trainingYears=sorted({row['year'] for row in rows}),
                diagnostics=dict(iterations=iteration+1, maxGradient=residual))


def probabilities(rows, fitted):
    x = matrix(rows, fitted['columns']) / np.array(fitted['scale'])
    return 1 / (1 + np.exp(-np.clip(x @ np.array(fitted['coefficients']), -700, 700)))


def predict_matchup(artifact, fitted_units, strength_by_id, home, away, venue=0):
    """Explain one research forecast from caller-verified pregame unit states.

    This pure function cannot establish source availability timestamps. Callers
    must build the states with the declared past-only replay/capture policy.
    """
    if home == away or type(venue) is not int or venue not in (-1, 0, 1):
        raise ValueError('Distinct teams and explicit signed venue required')
    fitted = artifact['logistic']
    if any(name not in set(FEATURES) | {'strength', 'venue'} for name in fitted['columns']):
        raise ValueError('Unapproved provider-derived or unknown model feature')
    if home not in strength_by_id or away not in strength_by_id:
        raise ValueError('Both own-engine Strength estimates are required')
    values = dict(strength=strength_by_id[home] - strength_by_id[away], venue=venue)
    unit_evidence = {}
    for metric in fitted['columns']:
        if metric in FEATURES:
            predicted = matchup_features(fitted_units[metric], home, away, venue)
            values[metric] = predicted['difference']; unit_evidence[metric] = predicted
    row = dict(features=values)
    if not all(np.isfinite(value) for value in values.values()):
        raise ValueError('Nonfinite research matchup feature')
    contributions = {name: float(values[name]*beta/scale) for name, beta, scale in
                     zip(fitted['columns'], fitted['coefficients'], fitted['scale'])}
    p = float(probabilities([row], fitted)[0])
    return dict(home=home, away=away, venue=venue, status='research-only',
                homeWinProbability=p, awayWinProbability=1-p,
                logOdds=sum(contributions.values()), logOddsContributions=contributions,
                ownEngineFeatureValues=values, unitEvidence=unit_evidence,
                interpretation='Original recorded-count research forecast; pure function assumes caller-verified pregame states, not a live publication or a uniquely correct achievement rank.')


def score(rows, fitted):
    if not rows:
        return dict(games=0)
    p = probabilities(rows, fitted); y = np.array([row['y'] for row in rows])
    clipped = np.clip(p, 1e-12, 1-1e-12)
    return dict(games=len(rows), accuracy=float(np.mean(np.where(abs(p-.5) <= 1e-10, .5, (p > .5) == y))),
                brier=float(np.mean((p-y)**2)), logLoss=float(np.mean(-y*np.log(clipped)-(1-y)*np.log(1-clipped))),
                probabilityBias=float(np.mean(p-y)))


def choose_configuration(entries, protocol):
    """Only older selection loss participates; later outcomes cannot enter here."""
    best = None
    for entry in entries:
        if best is None or entry['validation']['logLoss'] < best['validation']['logLoss'] - 1e-10:
            best = entry
        elif abs(entry['validation']['logLoss'] - best['validation']['logLoss']) <= 1e-10:
            priority = lambda row: (-row['penalty'], -row['ridge'], len(feature_columns(row['family'], protocol)),
                                    list(protocol['prediction']['families']).index(row['family']))
            if priority(entry) < priority(best):
                best = entry
    if best is None:
        raise ValueError('No older-only configuration was evaluated')
    return best


def paired_blocks(rows, candidate, baseline, replicates=1000):
    pc, pb = probabilities(rows, candidate), probabilities(rows, baseline)
    y = np.array([row['y'] for row in rows])
    correct = lambda p: np.where(abs(p-.5) <= 1e-10, .5, (p > .5) == y)
    loss = lambda p: -y*np.log(np.clip(p, 1e-12, 1-1e-12))-(1-y)*np.log(np.clip(1-p, 1e-12, 1-1e-12))
    differences = np.column_stack([correct(pc)-correct(pb), (pc-y)**2-(pb-y)**2, loss(pc)-loss(pb)])
    rng = np.random.default_rng(1729); sums = np.zeros((replicates, 3)); count = np.zeros(replicates)
    for year in sorted({row['year'] for row in rows}):
        blocks = sorted({row['block'] for row in rows if row['year'] == year})
        totals = []; sizes = []
        for block in blocks:
            mask = np.array([row['block'] == block for row in rows])
            totals.append(differences[mask].sum(axis=0)); sizes.append(int(sum(mask)))
        indices = rng.integers(len(blocks), size=(replicates, len(blocks)))
        sums += np.array(totals)[indices].sum(axis=1); count += np.array(sizes)[indices].sum(axis=1)
    samples = sums / count[:, None]
    return {name: dict(candidateMinusBaseline=float(np.mean(differences[:, index])),
                       weekBlockSensitivity95=np.quantile(samples[:, index], [.025, .975]).tolist())
            for index, name in enumerate(('accuracy', 'brier', 'logLoss'))}


def protected_check():
    previous = json.loads((HERE/'cache/predictive-v2/protected-before.json').read_bytes())
    changed = [name for name, digest in previous.items() if SHA((ROOT/name).read_bytes()) != digest]
    if changed:
        raise ValueError('An existing production/frozen file changed: '+', '.join(changed))
    return dict(files=len(previous), changed=changed)


def main():
    protocol_path = HERE/'predictive-v2-protocol.json'
    protocol_bytes = protocol_path.read_bytes(); protocol = json.loads(protocol_bytes)
    code_hashes = {name: SHA((HERE/name).read_bytes()) for name in CODE_FILES}
    years = sum((protocol['data'][name] for name in ('trainingYears', 'selectionYears', 'repeatedEvaluationYears')), [])
    inputs = {}; baselines = {}; replayed = {}; grid = []
    for year in years:
        inputs[year] = load_year(year); baselines[year] = outcome_replay(year)
        print('Verified recorded counts', year, inputs[year]['audit']['pairedFbsBoxGames'], '/',
              inputs[year]['audit']['expectedFbsGames'], flush=True)
    for ridge in protocol['features']['unitRidgeGrid']:
        replayed[ridge] = {}
        for year in years:
            replayed[ridge][year] = cached_features(inputs[year], baselines[year], ridge, protocol_bytes, protocol, code_hashes)
            print('Preweek units', ridge, year, sum(row['primary'] for row in replayed[ridge][year]['rows']), flush=True)
    for family in protocol['prediction']['families']:
        for ridge in ([protocol['features']['unitRidgeGrid'][0]] if family == 'strength' else protocol['features']['unitRidgeGrid']):
            train = [row for year in protocol['data']['trainingYears'] for row in replayed[ridge][year]['rows'] if row['primary']]
            validation = [row for year in protocol['data']['selectionYears'] for row in replayed[ridge][year]['rows'] if row['primary']]
            for penalty in protocol['prediction']['logisticPenaltyGrid']:
                fitted = logistic_fit(train, feature_columns(family, protocol), penalty)
                grid.append(dict(family=family, ridge=ridge, penalty=penalty, validation=score(validation, fitted)))
    selected = {family: choose_configuration([entry for entry in grid if entry['family'] == family], protocol)
                for family in protocol['prediction']['families']}
    best_broader = choose_configuration([entry for family, entry in selected.items() if family != 'strength'], protocol)
    models = {}; evaluation_rows = {}; results = {}
    for family, config in selected.items():
        ridge = config['ridge']
        training = [row for year in protocol['data']['trainingYears']+protocol['data']['selectionYears']
                    for row in replayed[ridge][year]['rows'] if row['primary']]
        models[family] = logistic_fit(training, feature_columns(family, protocol), config['penalty'])
        rows = [row for year in protocol['data']['repeatedEvaluationYears'] for row in replayed[ridge][year]['rows'] if row['primary']]
        evaluation_rows[family] = rows
        results[family] = dict(pooled=score(rows, models[family]),
            byYear={str(year): score([row for row in rows if row['year'] == year], models[family])
                    for year in protocol['data']['repeatedEvaluationYears']},
            groups={name: score([row for row in rows if predicate(row)], models[family]) for name, predicate in
                    [('regular', lambda row: row['kind'] == 'regular'), ('postseason', lambda row: row['kind'] == 'postseason'),
                     ('neutral', lambda row: not row['venue']), ('homeVenue', lambda row: bool(row['venue']))]})
    candidate = best_broader['family']; common_rows = evaluation_rows[candidate]
    for family, rows in evaluation_rows.items():
        if [(row['year'], row['id']) for row in common_rows] != [(row['year'], row['id']) for row in rows]:
            raise ValueError('Broader/baseline evaluation game samples differ: '+family)
    metadata = dict(protocolSha256=SHA(protocol_bytes), implementationSha256=code_hashes,
                    source={str(year): replayed[1][year]['source'] for year in years},
                    baseline={str(year): baselines[year]['provenance'] for year in years})
    fingerprint = SHA(json.dumps(metadata, sort_keys=True).encode())
    native_rows = [row for year in protocol['data']['repeatedEvaluationYears'] for row in replayed[1][year]['rows'] if row['nativeBaseline']]
    report = dict(protocol=protocol, fingerprint=fingerprint, **metadata, selectionGrid=grid,
                  selectedByFamily=selected, selectedBroaderCandidate=best_broader, fittedModels=models, evaluation=results,
                  nativeStrengthCoverage=score(native_rows, models['strength']),
                  pairedWeekBlockSensitivity=paired_blocks(common_rows, models[candidate], models['strength']),
                  coverage={str(year): dict(source=inputs[year]['audit'], checkpoints=replayed[1][year]['checkpoints']) for year in years},
                  productionProtection=protected_check(), cfbdCalls=0, networkDataPulls=0, liveChanges=False)
    output = HERE/f'results/predictive-v2/{fingerprint[:12]}'; output.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(report, indent=2, allow_nan=False)+'\n').encode()
    (output/'results.json').write_bytes(encoded); (output/'results.json.gz').write_bytes(gzip.compress(encoded, mtime=0))
    artifact = dict(schemaVersion=1, id=protocol['id'], status='research-only', family=candidate,
                    experimentFingerprint=fingerprint, protocolSha256=SHA(protocol_bytes),
                    implementationSha256=code_hashes, source=metadata['source'],
                    unitConfiguration=dict(protocol['features']['context'], ridge=best_broader['ridge']),
                    logistic=models[candidate], recordedMetricDefinitions=protocol['features']['definitions'],
                    trainedThroughSeason=2019, currentOwnStrengthConfiguration=json.loads((ROOT/'data/model.json').read_bytes()),
                    scope='Recorded-box-count candidate; no player, raw-play, drive or complete special-teams model yet. No provider success/PPA/ratings/probabilities.',
                    timing='Only caller-verified pregame states may feed predict_matchup; no future trial/public promotion is active for this candidate.',
                    validation=dict(retrospective=True, years=protocol['data']['repeatedEvaluationYears'],
                                    candidate=results[candidate]['pooled'], strengthControl=results['strength']['pooled'],
                                    superiorityEstablished=False))
    (output/'model.json').write_text(json.dumps(artifact, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    fields = ['year','block','id','home','away','homeTeam','awayTeam','y','venue']+list(models)
    probs = {family: probabilities(evaluation_rows[family], models[family]) for family in models}
    with (output/'game-predictions.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields); writer.writeheader()
        for index, row in enumerate(common_rows):
            writer.writerow({**{key: row[key] for key in fields[:9]}, **{family: float(values[index]) for family, values in probs.items()}})
    write_report(output, report)
    print(json.dumps(dict(output=str(output), fingerprint=fingerprint, selectedBroader=best_broader,
                          metrics={family: entry['pooled'] for family, entry in results.items()},
                          sensitivity=report['pairedWeekBlockSensitivity'], protected=report['productionProtection']), indent=2), flush=True)


def write_report(output, report):
    lines = ['ORIGINAL RECORDED-COUNT PREDICTIVE CHALLENGER', 'Fingerprint: '+report['fingerprint'],
             'Research only; no public rankings, frozen blend, schedules or provider requests changed.',
             'Own deterministic rates and fitted offense/defense/context/logistic weights; no provider success/PPA/ratings/probabilities.',
             'Recorded counts are ESPN/SportsDataverse; canonical outcomes, identities and timing are repaired CFBD histories.',
             'Older fitting2014-2017; selection2018-2019; refit2014-2019; familiar retrospective evaluation2023-2025.',
             'Target-week statistics/outcomes excluded; target download availability never selects future outcome games.', '',
             'Selected broader family (older validation only): '+report['selectedBroaderCandidate']['family'],
             'Model | Games | Accuracy | Brier(lower) | Logloss(lower)']
    for family, evaluation in report['evaluation'].items():
        item = evaluation['pooled']
        lines.append(f"{family} | {item['games']} | {100*item['accuracy']:.3f}% | {item['brier']:.6f} | {item['logLoss']:.6f}")
    lines += ['', 'Selected candidate versus Strength by evaluation year:']
    candidate = report['selectedBroaderCandidate']['family']
    for year, baseline in report['evaluation']['strength']['byYear'].items():
        other = report['evaluation'][candidate]['byYear'][year]
        lines.append(f"{year}: n={baseline['games']}; accuracy {100*baseline['accuracy']:.3f}% -> {100*other['accuracy']:.3f}%; Brier {baseline['brier']:.6f} -> {other['brier']:.6f}; logloss {baseline['logLoss']:.6f} -> {other['logLoss']:.6f}")
    lines += ['', 'Paired week-block sensitivity (candidate minus Strength):', json.dumps(report['pairedWeekBlockSensitivity'], indent=2),
              '', 'Scope and limits:',
              'This is a recorded-box-count candidate, not an all-football or all-player model. Missing play/drive/special-teams/player features are not invented.',
              'Provider source conventions, including college sacks and whole-team turnover/penalty attribution, remain disclosed.',
              'Sparse unit parameters shrink toward zero effects; this is an explicit modeling prior, not a fabricated zero-valued raw observation.',
              'Historical source and evaluation outcomes were already inspected. A later-year comparison here is not an untouched/prospective trial.',
              'Recurring teams connect weeks; sensitivity intervals are not calibrated independent significance.',
              'The broadest family is not automatically selected. Only older validation selects a candidate.',
              'New independent model calculations do not establish a uniquely correct earned-achievement ranking.',
              'Current SOR, Strength, Performance and frozen future blend are preserved. Protected files='+str(report['productionProtection']['files'])+'.']
    (output/'REPORT.txt').write_text('\n'.join(lines)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
