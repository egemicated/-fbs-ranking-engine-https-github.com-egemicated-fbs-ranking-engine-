"""Private-input, chronological success-rate experiment; publishes derived results.

No requests, API keys, production imports or live writes. Run only after the
declared encrypted source inputs have been restored to the ignored local cache.
"""
import csv
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

from advanced_performance_ingest import normalize_advanced, read_context
from advanced_performance_model import fit_advanced_performance
from replay_weekly import weekly_groups, timestamp, protected_hashes

HERE = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()


def observations(games):
    return [dict(gameId=g['id'], teamId=g[side], opponentId=g[other],
                 rate=g['stats'][side]['rate'], plays=g['stats'][side]['plays'],
                 venue=0 if g['neutral'] else sign)
            for g in games for side, other, sign in [('home', 'away', 1), ('away', 'home', -1)]]


def division_sign(a, b):
    return int(a == 'fbs')-int(b == 'fbs')


def naive_ratings(teams, games, ridge, home, division):
    divisions = {t['id']: t['division'] for t in teams}
    sums = {i: 0. for i in divisions}; counts = {i: 0 for i in divisions}
    for g in games:
        a, b = g['home'], g['away']; venue = 0 if g['neutral'] else 1
        target = g['stats']['home']['rate']-g['stats']['away']['rate']
        adjusted = target-home*venue-division*division_sign(divisions[a], divisions[b])
        sums[a] += adjusted; sums[b] -= adjusted; counts[a] += 1; counts[b] += 1
    return {i: sums[i]/(counts[i]+ridge)+division*(.5 if divisions[i] == 'fbs' else -.5) for i in divisions}


def preweek_features(data, parent, ridge):
    by_id = {g['id']: g for g in data['games']}; seen = set(); rows = []
    divisions = {t['id']: t['division'] for t in data['teams']}
    for (kind, week), targets in weekly_groups(parent):
        cutoff = min(timestamp(g['startDate']) for g in targets)
        past = [g for g in data['games'] if g['id'] in seen and timestamp(g['startDate'])+86400 <= cutoff]
        assert not {g['id'] for g in targets}&{g['id'] for g in past}
        fitted, naive = [], []
        for home, division in [(0., 0.), (1., 0.), (0., 1.)]:
            model = fit_advanced_performance(data['teams'], observations(past),
                                            dict(ridge=ridge, homeRate=home, divisionRate=division))
            fitted.append({t['id']: t for t in model['ratings']})
            naive.append(naive_ratings(data['teams'], past, ridge, home, division))
        for target in targets:
            if target['id'] not in by_id:
                continue
            g = by_id[target['id']]; a, b = g['home'], g['away']
            if 'fbs' not in (divisions[a], divisions[b]):
                continue
            venue = 0 if g['neutral'] else 1
            adjusted_diff = [f[a]['rating']-f[b]['rating'] for f in fitted]
            naive_diff = [f[a]-f[b] for f in naive]
            rows.append(dict(id=g['id'], year=data['year'], block=f'{data["year"]}:{kind}:{week}',
                group='FBS-FBS' if divisions[a] == divisions[b] == 'fbs' else 'FBS-FCS',
                divisionSign=division_sign(divisions[a], divisions[b]), venue=venue,
                early=min(fitted[0][a]['measuredGames'], fitted[0][b]['measuredGames']) < 4,
                target=g['stats']['home']['rate']-g['stats']['away']['rate'],
                adjusted=[adjusted_diff[0], venue+adjusted_diff[1]-adjusted_diff[0], adjusted_diff[2]-adjusted_diff[0]],
                naive=[naive_diff[0], venue+naive_diff[1]-naive_diff[0], naive_diff[2]-naive_diff[0]]))
        seen.update(g['id'] for g in targets)
    return rows


def calibrate(rows, family):
    y = np.array([r['target'] for r in rows])
    if family == 'simple':
        x = np.array([[r['venue'], r['divisionSign']] for r in rows]); target = y
    elif family == 'naive':
        # The pre-inspection amendment gives the benchmark an older-fitted
        # scale as well as contextual columns, avoiding an unfair raw baseline.
        x = np.array([r['naive'] for r in rows]); target = y
    else:
        x = np.array([r['adjusted'][1:2] if family == 'zeroDivision' else r['adjusted'][1:] for r in rows])
        target = y-np.array([r['adjusted'][0] for r in rows])
    beta, _, rank, singular = np.linalg.lstsq(x, target, rcond=None)
    if rank != x.shape[1] or not np.all(np.isfinite(beta)):
        raise ValueError('Calibration columns are not identified')
    diagnostics = dict(designRank=int(rank), designColumns=x.shape[1], designConditionNumber=float(singular[0]/singular[-1]))
    if family == 'naive':
        return dict(scale=float(beta[0]), venueFeatureWeight=float(beta[1]), divisionFeatureWeight=float(beta[2]), **diagnostics)
    return dict(scale=1., homeRate=float(beta[0]), divisionRate=0. if family == 'zeroDivision' else float(beta[1]), **diagnostics)


def prediction(row, family, config):
    if family == 'zero':
        return 0.
    if family == 'simple':
        return config['homeRate']*row['venue']+config['divisionRate']*row['divisionSign']
    base, home, division = row['naive' if family == 'naive' else 'adjusted']
    if family == 'naive':
        return config['scale']*base+config['venueFeatureWeight']*home+config['divisionFeatureWeight']*division
    return config.get('scale', 1.)*base+config['homeRate']*home+config['divisionRate']*division


def metrics(rows, family, config):
    if not rows:
        return dict(games=0)
    residual = np.array([prediction(r, family, config)-r['target'] for r in rows])
    cross = [e*r['divisionSign'] for e, r in zip(residual, rows) if r['divisionSign']]
    return dict(games=len(rows), mse=float(np.mean(residual**2)), rmse=float(np.sqrt(np.mean(residual**2))),
                mae=float(np.mean(np.abs(residual))), meanResidual=float(np.mean(residual)),
                meanFbsOrientedResidual=float(np.mean(cross)) if cross else None)


def bootstrap(rows, configurations, settings):
    # Paired losses share a week-block draw; no independent-game error bars.
    blocks = {}
    for r in rows:
        loss = (prediction(r, 'naive', configurations['naive'])-r['target'])**2
        loss -= (prediction(r, 'adjusted', configurations['adjusted'])-r['target'])**2
        total, count = blocks.get(r['block'], (0., 0)); blocks[r['block']] = (total+loss, count+1)
    values = np.array([blocks[k] for k in sorted(blocks)])
    rng = np.random.default_rng(settings['seed']); improvements = []
    for _ in range(settings['replicates']):
        chosen = values[rng.integers(0, len(values), len(values))]
        improvements.append(float(chosen[:, 0].sum()/chosen[:, 1].sum()))
    return dict(blocks=len(values), replicates=settings['replicates'], seed=settings['seed'],
                comparison='matched calibrated raw MSE minus adjusted MSE; positive favors adjusted',
                interpretation='Paired week-block sensitivity interval; recurring teams connect weeks, so this is not a calibrated significance or prospective-coverage claim',
                meanPairedImprovement=float(values[:, 0].sum()/values[:, 1].sum()),
                interval=[float(v) for v in np.quantile(improvements, settings['interval'])])


def main():
    before = protected_hashes()
    protocol_bytes = (HERE/'advanced-performance-protocol.json').read_bytes(); protocol = json.loads(protocol_bytes)
    amendment_bytes = (HERE/'advanced-performance-control-amendment.json').read_bytes()
    amendment = json.loads(amendment_bytes)
    selection = protocol['selection']; train = selection['venueDivisionTrainingYears']; valid = selection['ridgeSelectionYears']
    later = selection['retrospectiveEvaluationYears']; years = train+valid+later
    if amendment['baseProtocolSha256'] != sha(protocol_bytes):
        raise ValueError('Control amendment does not match declared base protocol')
    cache = HERE/'cache/advanced-training-v1'; manifest_bytes = (cache/'manifest.json').read_bytes(); manifest = json.loads(manifest_bytes)
    if manifest['protocolSha256'] != sha(protocol_bytes) or manifest['status'] != 'complete':
        raise ValueError('Source collection does not match declared base protocol')
    source = {f['year']: f for f in manifest['files']}; datasets = {}; parents = {}; inputs = {}; parent_hashes = {}
    output_data = HERE/'datasets/advanced-success-v1/seasons'; output_data.mkdir(parents=True, exist_ok=True)
    for year in years+[2026]:
        raw = (cache/f'{year}.json').read_bytes()
        if sha(raw) != source[year]['rawSha256']:
            raise ValueError('Private source checksum mismatch')
        data = normalize_advanced(json.loads(raw), read_context(year), year)
        encoded = (json.dumps(data, indent=2)+'\n').encode(); (output_data/f'{year}.json').write_bytes(encoded)
        datasets[year] = data; inputs[str(year)] = sha(encoded)
        if year != 2026:
            parent = (HERE/f'datasets/fcs-coverage-v1/seasons/{year}.json').read_bytes()
            parents[year] = json.loads(parent); parent_hashes[str(year)] = sha(parent)
        print('Coverage', year, data['audit']['acceptedFbsInvolvingGames'], '/', data['audit']['expectedFbsInvolvingGames'],
              'FCS', data['audit']['acceptedByDivisionPair'].get('fcs-fcs', 0), flush=True)
    code_paths = ['advanced_performance_model.py', 'advanced_performance_ingest.py', 'advanced_performance_experiment.py',
                  'performance_ingest.py', 'replay_weekly.py', 'compare_merit.py']
    code = {p: sha((HERE/p).read_bytes()) for p in code_paths}
    fingerprint = sha(protocol_bytes+amendment_bytes+manifest_bytes+json.dumps(dict(inputs=inputs, parents=parent_hashes, code=code), sort_keys=True).encode())
    feature_cache = cache/'features'; feature_cache.mkdir(exist_ok=True); grid = []; saved = {}
    for ridge in selection['ridgeGrid']:
        features = {}
        for year in years:
            key = sha(json.dumps(dict(input=inputs[str(year)], parent=parent_hashes[str(year)], code=code, ridge=ridge), sort_keys=True).encode())
            path = feature_cache/f'{year}-{key}.json'
            if path.exists():
                features[year] = json.loads(path.read_bytes())
            else:
                features[year] = preweek_features(datasets[year], parents[year], ridge)
                path.write_bytes(json.dumps(features[year], separators=(',', ':')).encode())
            print('Features', ridge, year, len(features[year]), flush=True)
        saved[ridge] = features
        training = [r for y in train for r in features[y]]; validation = [r for y in valid for r in features[y]]
        for family in ['adjusted', 'zeroDivision', 'naive']:
            config = calibrate(training, family)
            score = metrics(validation, family, config)
            grid.append(dict(family=family, ridge=ridge, config=config, trainingGames=len(training), validation=score))
            print('Validation', family, ridge, score['mse'], flush=True)
    selected = {family: min((r for r in grid if r['family'] == family), key=lambda r: (r['validation']['mse'], r['ridge']))
                for family in ['adjusted', 'zeroDivision', 'naive']}
    configs = {family: s['config'] for family, s in selected.items()}
    simple = calibrate([r for y in train for r in saved[selected['adjusted']['ridge']][y]], 'simple')
    evaluation = {}
    for family in ['adjusted', 'zeroDivision', 'naive', 'simple', 'zero']:
        features = saved[selected.get(family, selected['adjusted'])['ridge']]
        config = configs.get(family, simple); evaluation[family] = {}
        for label, predicate in [('allFbs', lambda r: True), ('FBS-FBS', lambda r: r['group'] == 'FBS-FBS'),
                                  ('FBS-FCS', lambda r: r['group'] == 'FBS-FCS'),
                                  ('establishedFbsFbs', lambda r: r['group'] == 'FBS-FBS' and not r['early'])]:
            evaluation[family][label] = dict(pooled=metrics([r for y in later for r in features[y] if predicate(r)], family, config),
                byYear={str(y): metrics([r for r in features[y] if predicate(r)], family, config) for y in later})
    # Align independently selected-ridge predictions by ID before paired bootstrap.
    held = []
    raw_rows = [r for y in later for r in saved[selected['naive']['ridge']][y]]
    raw_by_id = {(r['year'], r['id']): r for r in raw_rows}
    assert len(raw_by_id) == len(raw_rows), 'Duplicate held game identity'
    for year in later:
        for r in saved[selected['adjusted']['ridge']][year]:
            raw_row = raw_by_id[(r['year'], r['id'])]
            assert all(raw_row[k] == r[k] for k in ('target', 'block', 'group')), 'Held game alignment changed'
            held.append({**r, 'naive': raw_row['naive']})
    interval = bootstrap(held, configs, protocol['evaluation']['bootstrap'])
    chosen = selected['adjusted']; current_config = dict(ridge=chosen['ridge'], homeRate=chosen['config']['homeRate'], divisionRate=chosen['config']['divisionRate'])
    current = fit_advanced_performance(datasets[2026]['teams'], observations(datasets[2026]['games']), current_config)
    fbs_mean = sum(r['rating'] for r in current['rows'] if r['measuredGames'])/current['measuredFbsTeams']
    for row in current['rows']:
        row['aboveFbsMeanPercentagePoints'] = 100*(row['rating']-fbs_mean) if row['measuredGames'] else None
        row['explanation']['fbsReferenceAdjustment'] = -fbs_mean
        row['explanation']['reconstructedAboveFbsMeanPercentagePoints'] = 100*(row['explanation']['reconstructedRating']-fbs_mean)
        row['coverage'] = datasets[2026]['audit']['teamCoverage'][row['id']]
    top25 = {r['id'] for r in current['rows'][:25]}; sensitivity = {}
    variants = [('ridge-'+str(r), dict(current_config, ridge=r), datasets[2026]['games']) for r in selection['ridgeGrid'] if r != chosen['ridge']]
    variants += [('zeroDivision', dict(ridge=selected['zeroDivision']['ridge'], homeRate=configs['zeroDivision']['homeRate'], divisionRate=0.), datasets[2026]['games']),
                 ('fbsOnly', dict(current_config, divisionRate=0.), [g for g in datasets[2026]['games'] if all(next(t['division'] for t in datasets[2026]['teams'] if t['id'] == g[k]) == 'fbs' for k in ['home', 'away'])])]
    for name, config, games in variants:
        model = fit_advanced_performance(datasets[2026]['teams'], observations(games), config)
        sensitivity[name] = dict(config=config, games=model['gamesUsed'], interpretation='Conditional ridge-only changes keep selected venue/division coefficients fixed; zeroDivision is its independently selected control; fbsOnly is an input-removal diagnostic',
            top25SymmetricDifference=sorted(top25^{r['id'] for r in model['rows'][:25]}),
            rows=[dict(id=r['id'], rank=r['rank'], rating=r['rating']) for r in model['rows']])
    bias = evaluation['adjusted']['FBS-FCS']['pooled']['meanFbsOrientedResidual']
    control_bias = evaluation['zeroDivision']['FBS-FCS']['pooled']['meanFbsOrientedResidual']
    checks = dict(completeCurrentFbsCoverage=datasets[2026]['audit']['acceptedFbsInvolvingGames'] == datasets[2026]['audit']['completedFbsInvolvingContextGames'],
        evaluationFbsCoverage=all(datasets[y]['audit']['acceptedFbsInvolvingGames']/datasets[y]['audit']['completedFbsInvolvingContextGames'] >= .98 for y in later),
        exactExplanations=current['maxExplanationReconciliationError'] < 1e-9,
        adjustedBeatsMatchedRaw=evaluation['adjusted']['allFbs']['pooled']['mse'] < evaluation['naive']['allFbs']['pooled']['mse'],
        pairedBlockIntervalFavorsAdjusted=interval['interval'][0] > 0,
        crossBiasWithinTwoPercentagePoints=abs(bias) <= .02,
        crossBiasSmallerThanZeroDivision=abs(bias) < abs(control_bias))
    assert before == protected_hashes(), 'Production changed during this offline experiment'
    report = dict(protocol=protocol, amendment=amendment, runFingerprint=fingerprint, numpyVersion=np.__version__,
        sourceManifest=manifest, inputSha256=inputs, parentOutcomeSha256=parent_hashes, implementationSha256=code,
        coverage={str(y): datasets[y]['audit'] for y in years+[2026]},
        outcomeReference={str(y): datasets[y]['outcomeReference'] for y in years+[2026]},
        aliasSources={str(y): datasets[y]['aliasSource'] for y in years+[2026]},
        candidates=grid, selected=selected, simpleConfig=simple, evaluation=evaluation, blockBootstrap=interval,
        current=current, currentFbsReferenceMean=fbs_mean, sensitivity=sensitivity, readinessChecks=checks,
        allEngineeringChecksPass=all(checks.values()), productionUnchanged=True,
        limitation='Retrospective provider-covered scrimmage consistency; no complete-football, untouched holdout, prospective or proprietary PPA-model claim')
    out = HERE/'results/advanced-performance'/fingerprint[:12]; out.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(report, indent=2)+'\n').encode(); (out/'experiment.json').write_bytes(encoded)
    (out/'experiment.json.gz').write_bytes(gzip.compress(encoded, mtime=0))
    with (out/'current-ratings.csv').open('w', newline='', encoding='utf-8') as stream:
        fields = ['id', 'team', 'rank', 'aboveFbsMeanPercentagePoints', 'rating', 'measuredGames', 'rawOffenseRate', 'rawDefenseRateAllowed', 'minOpponentMeasuredGames', 'provisional']
        writer = csv.DictWriter(stream, fieldnames=fields); writer.writeheader(); writer.writerows({k: r[k] for k in fields} for r in current['rows'])
    print(json.dumps(dict(output=str(out), selected=selected, readinessChecks=checks, blockBootstrap=interval)), flush=True)


if __name__ == '__main__':
    main()
