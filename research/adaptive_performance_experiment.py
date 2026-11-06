"""Declared adaptive-context extension; private sources, derived outputs only."""
import csv
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

from advanced_performance_model import fit_advanced_performance
from adaptive_performance_model import fit_adaptive_performance, posterior_context
from advanced_performance_ingest import normalize_advanced, read_context
from advanced_performance_experiment import observations, division_sign, naive_ratings, prediction, bootstrap
from replay_weekly import weekly_groups, timestamp, protected_hashes

HERE = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()


def features(data, parent, ridge):
    by_id = {g['id']: g for g in data['games']}; seen = set(); rows = []
    divisions = {t['id']: t['division'] for t in data['teams']}
    for (kind, week), targets in weekly_groups(parent):
        cutoff = min(timestamp(g['startDate']) for g in targets)
        past = [g for g in data['games'] if g['id'] in seen and timestamp(g['startDate'])+86400 <= cutoff]
        assert not {g['id'] for g in past}&{g['id'] for g in targets}
        models = []; raw = []
        for h, d in [(0., 0.), (1., 0.), (0., 1.)]:
            models.append(fit_advanced_performance(data['teams'], observations(past), dict(ridge=ridge, homeRate=h, divisionRate=d)))
            raw.append(naive_ratings(data['teams'], past, ridge, h, d))
        ratings = [{r['id']: r for r in m['ratings']} for m in models]
        evidence = [{g['gameId']: g for g in m['gameEvidence']} for m in models]
        q = np.zeros((2, 2)); b = np.zeros(2)
        for game_id, zero in evidence[0].items():
            z = np.array([zero['venue'], zero['divisionSign']])
            response = np.array([evidence[i][game_id]['predictedNetRate']-zero['predictedNetRate'] for i in [1, 2]])
            q += np.outer(z, response); b += z*(zero['netRate']-zero['predictedNetRate'])
        for target in targets:
            if target['id'] not in by_id:
                continue
            g = by_id[target['id']]; a, other = g['home'], g['away']
            if 'fbs' not in (divisions[a], divisions[other]):
                continue
            venue = 0 if g['neutral'] else 1
            adjusted = [r[a]['rating']-r[other]['rating'] for r in ratings]
            naive = [r[a]-r[other] for r in raw]
            rows.append(dict(id=g['id'], year=data['year'], block=f'{data["year"]}:{kind}:{week}',
                target=g['stats']['home']['rate']-g['stats']['away']['rate'], venue=venue,
                divisionSign=division_sign(divisions[a], divisions[other]),
                group='FBS-FBS' if divisions[a] == divisions[other] == 'fbs' else 'FBS-FCS',
                early=min(ratings[0][a]['measuredGames'], ratings[0][other]['measuredGames']) < 4,
                adjusted=[adjusted[0], venue+adjusted[1]-adjusted[0], adjusted[2]-adjusted[0]],
                naive=[naive[0], venue+naive[1]-naive[0], naive[2]-naive[0]],
                contextQ=q.tolist(), contextB=b.tolist(), contextGames=len(past)))
        seen.update(g['id'] for g in targets)
    return rows


def adaptive_prediction(row, config):
    posterior = posterior_context(row['contextQ'], row['contextB'],
                                  [config['homePrior'], config['divisionPrior']], config['contextPriorStrength'])
    base, h, d = row['adjusted']
    return base+posterior['homeRate']*h+posterior['divisionRate']*d


def summary(rows, predictions):
    if not rows:
        return dict(games=0)
    residual = np.array(predictions)-np.array([r['target'] for r in rows])
    cross = [e*r['divisionSign'] for e, r in zip(residual, rows) if r['divisionSign']]
    return dict(games=len(rows), mse=float(np.mean(residual**2)), rmse=float(np.sqrt(np.mean(residual**2))),
                mae=float(np.mean(abs(residual))), meanResidual=float(np.mean(residual)),
                meanFbsOrientedResidual=float(np.mean(cross)) if cross else None)


def evaluate(rows, pred):
    result = {}
    for label, want in [('allFbs', lambda r: True), ('FBS-FBS', lambda r: r['group'] == 'FBS-FBS'),
                        ('FBS-FCS', lambda r: r['group'] == 'FBS-FCS'),
                        ('establishedFbsFbs', lambda r: r['group'] == 'FBS-FBS' and not r['early'])]:
        selected = [r for r in rows if want(r)]
        result[label] = dict(pooled=summary(selected, [pred(r) for r in selected]),
            byYear={str(y): summary([r for r in selected if r['year'] == y], [pred(r) for r in selected if r['year'] == y])
                    for y in sorted({r['year'] for r in rows})})
    return result


def main():
    before = protected_hashes()
    protocol_bytes = (HERE/'adaptive-performance-protocol.json').read_bytes(); protocol = json.loads(protocol_bytes)
    base = json.loads((HERE/'advanced-performance-protocol.json').read_bytes())
    if sha((HERE/'advanced-performance-protocol.json').read_bytes()) != protocol['baseProtocolSha256']:
        raise ValueError('Base protocol changed')
    v1_path = HERE/'results/advanced-performance/4bf5494b85bc/experiment.json'; v1_bytes = v1_path.read_bytes(); v1 = json.loads(v1_bytes)
    source_manifests = {}; source_bytes = {}; datasets = {}; inputs = {}; parents = {}; parent_hashes = {}
    for label in ['advanced-training-v1', 'advanced-training-v2-supplement']:
        raw = (HERE/f'cache/{label}/manifest.json').read_bytes(); m = json.loads(raw)
        assert m['status'] == 'complete'
        if label.endswith('supplement') and m['protocolSha256'] != sha(protocol_bytes):
            raise ValueError('Supplement was not collected against the declared V2 protocol')
        source_manifests[label] = m; source_bytes[label] = sha(raw)
        for entry in m['files']:
            year = entry['year']; raw = (HERE/f'cache/{label}/{year}.json').read_bytes()
            assert sha(raw) == entry['rawSha256']
            data = normalize_advanced(json.loads(raw), read_context(year), year)
            encoded = (json.dumps(data, indent=2)+'\n').encode(); inputs[str(year)] = sha(encoded); datasets[year] = data
            if year not in [2021, 2022]:
                assert v1['inputSha256'][str(year)] == inputs[str(year)], 'Existing V1 input changed'
            print('V2 coverage', year, data['audit']['acceptedFbsInvolvingGames'], '/', data['audit']['completedFbsInvolvingContextGames'], flush=True)
            if year != 2026:
                raw_parent = (HERE/f'datasets/fcs-coverage-v1/seasons/{year}.json').read_bytes()
                parent_hashes[str(year)] = sha(raw_parent); parents[year] = json.loads(raw_parent)
    code_files = ['adaptive_performance_model.py', 'advanced_performance_model.py', 'advanced_performance_ingest.py',
                  'adaptive_performance_experiment.py', 'advanced_performance_experiment.py', 'performance_ingest.py', 'compare_merit.py', 'replay_weekly.py']
    code = {p: sha((HERE/p).read_bytes()) for p in code_files}
    fingerprint = sha(protocol_bytes+v1_bytes+json.dumps(dict(inputs=inputs, parent=parent_hashes, code=code, sources=source_bytes), sort_keys=True).encode())
    selection = protocol['selection']; validation_years = selection['ridgeSelectionYears']
    repeated = selection['repeatedEvaluationYears']; supplemental = selection['supplementalEvaluationYears']
    years = validation_years+repeated+supplemental; saved = {}; candidates = []
    feature_cache = HERE/'cache/advanced-training-v1/adaptive-features'; feature_cache.mkdir(exist_ok=True)
    for ridge in selection['ridgeGrid']:
        saved[ridge] = {}
        for year in years:
            key = sha(json.dumps(dict(input=inputs[str(year)], parent=parent_hashes[str(year)], code=code, ridge=ridge), sort_keys=True).encode())
            path = feature_cache/f'{year}-{key}.json'
            if path.exists():
                saved[ridge][year] = json.loads(path.read_bytes())
            else:
                saved[ridge][year] = features(datasets[year], parents[year], ridge)
                path.write_bytes(json.dumps(saved[ridge][year], separators=(',', ':')).encode())
            print('V2 features', ridge, year, len(saved[ridge][year]), flush=True)
        prior = next(c['config'] for c in v1['candidates'] if c['family'] == 'adjusted' and c['ridge'] == ridge)
        for strength in selection['contextPriorStrengthGrid']:
            config = dict(ridge=ridge, contextPriorStrength=strength, homePrior=prior['homeRate'], divisionPrior=prior['divisionRate'])
            val = [r for y in validation_years for r in saved[ridge][y]]
            score = summary(val, [adaptive_prediction(r, config) for r in val])
            candidates.append(dict(config=config, validation=score))
            print('V2 validation', ridge, strength, score['mse'], flush=True)
    selected = min(candidates, key=lambda c: (c['validation']['mse'], c['config']['ridge'], -c['config']['contextPriorStrength']))
    config = selected['config']; evaluation = {}; intervals = {}
    raw_config = v1['selected']['naive']['config']; raw_ridge = v1['selected']['naive']['ridge']
    for label, wanted_years in [('repeated2023to2025', repeated), ('supplemental2021to2022', supplemental)]:
        rows = [r for y in wanted_years for r in saved[config['ridge']][y]]
        control_rows = {(r['year'], r['id']): r for y in wanted_years for r in saved[raw_ridge][y]}
        assert len(control_rows) == len(rows)
        for row in rows:
            control = control_rows[(row['year'], row['id'])]
            assert all(control[k] == row[k] for k in ['target', 'block', 'group'])
        evaluation[label] = {'adaptive': evaluate(rows, lambda r: adaptive_prediction(r, config)),
            'matchedRaw': evaluate(rows, lambda r: prediction(control_rows[(r['year'], r['id'])], 'naive', raw_config))}
        for family in ['adjusted', 'zeroDivision']:
            control = v1['selected'][family]
            own_rows = [r for y in wanted_years for r in saved[control['ridge']][y]]
            evaluation[label][family+'V1'] = evaluate(own_rows, lambda r, f=family, c=control: prediction(r, f, c['config']))
        paired = [{**r, 'adjusted': [adaptive_prediction(r, config), 0., 0.],
                   'naive': control_rows[(r['year'], r['id'])]['naive']} for r in rows]
        intervals[label] = bootstrap(paired, dict(adjusted=dict(homeRate=0., divisionRate=0.), naive=raw_config), base['evaluation']['bootstrap'])
    current = fit_adaptive_performance(datasets[2026]['teams'], observations(datasets[2026]['games']), config)
    mean = sum(t['rating'] for t in current['rows'] if t['measuredGames'])/current['measuredFbsTeams']
    for t in current['rows']:
        t['aboveFbsMeanPercentagePoints'] = 100*(t['rating']-mean) if t['measuredGames'] else None
        t['coverage'] = datasets[2026]['audit']['teamCoverage'][t['id']]
        t['explanation']['fbsReferenceAdjustment'] = -mean
        t['explanation']['reconstructedAboveFbsMeanPercentagePoints'] = 100*(t['explanation']['reconstructedRating']-mean)
    top = {t['id'] for t in current['rows'][:25]}; sensitivity = {}
    for strength in selection['contextPriorStrengthGrid']:
        variant = fit_adaptive_performance(datasets[2026]['teams'], observations(datasets[2026]['games']), dict(config, contextPriorStrength=strength))
        sensitivity[str(strength)] = dict(config=variant['adaptiveConfig'], context=variant['contextFit'],
            top25SymmetricDifference=sorted(top^{t['id'] for t in variant['rows'][:25]}),
            rows=[dict(id=t['id'], rank=t['rank'], rating=t['rating']) for t in variant['rows']])
    checks = dict(completeCurrentCoverage=datasets[2026]['audit']['acceptedFbsInvolvingGames'] == datasets[2026]['audit']['completedFbsInvolvingContextGames'],
        evaluationCoverage=all(datasets[y]['audit']['acceptedFbsInvolvingGames']/datasets[y]['audit']['completedFbsInvolvingContextGames'] >= .98 for y in repeated+supplemental),
        exactScores=current['maxExplanationReconciliationError'] < 1e-9,
        exactContext=current['contextFit']['normalEquationResidual'] < 1e-9)
    for label in evaluation:
        result = evaluation[label]; bias = result['adaptive']['FBS-FCS']['pooled']['meanFbsOrientedResidual']
        checks[label+'BiasWithinTwoPoints'] = abs(bias) <= .02
        checks[label+'MseBeatsMatchedRaw'] = result['adaptive']['allFbs']['pooled']['mse'] < result['matchedRaw']['allFbs']['pooled']['mse']
        checks[label+'BlockIntervalFavorsAdaptive'] = intervals[label]['interval'][0] > 0
    assert protected_hashes() == before, 'Production changed during this offline run'
    report = dict(protocol=protocol, fingerprint=fingerprint, selected=selected, candidates=candidates,
        sourceManifestSha256=source_bytes, sourceManifests=source_manifests, inputSha256=inputs,
        parentOutcomeSha256=parent_hashes, implementationSha256=code, v1ReportSha256=sha(v1_bytes),
        coverage={str(y): datasets[y]['audit'] for y in datasets},
        evaluation=evaluation, blockIntervals=intervals, current=current, currentFbsMean=mean,
        sensitivity=sensitivity, readinessChecks=checks, allEngineeringChecksPass=all(checks.values()),
        numpyVersion=np.__version__, productionUnchanged=True,
        limitation='2023-2025 were inspected in V1 before declaring V2; supplemental fields are an additional retrospective check. No prospective/full-football claim.')
    out = HERE/'results/adaptive-performance'/fingerprint[:12]; out.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(report, indent=2)+'\n').encode(); (out/'experiment.json').write_bytes(encoded)
    (out/'experiment.json.gz').write_bytes(gzip.compress(encoded, mtime=0))
    fields = ['id', 'team', 'rank', 'aboveFbsMeanPercentagePoints', 'rating', 'measuredGames', 'rawOffenseRate', 'rawDefenseRateAllowed', 'minOpponentMeasuredGames', 'provisional']
    with (out/'current-ratings.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields); writer.writeheader(); writer.writerows({k: t[k] for k in fields} for t in current['rows'])
    print(json.dumps(dict(output=str(out), selected=selected, checks=checks, currentContext=current['contextFit'])), flush=True)


if __name__ == '__main__':
    main()
