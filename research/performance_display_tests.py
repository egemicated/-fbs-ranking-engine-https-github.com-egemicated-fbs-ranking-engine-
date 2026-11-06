"""Cached-only forward calibration and as-of-date withheld-game checks.

Writes only new derived research outputs. This is not a pregame forecast when
withholding a game from the current publication-date graph.
"""
import csv
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

from adaptive_performance_model import fit_adaptive_performance
from adaptive_performance_experiment import adaptive_prediction, evaluate
from advanced_performance_experiment import observations

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SHA = lambda value: hashlib.sha256(value).hexdigest()


def validate_forward_pairs(pairs):
    if not isinstance(pairs, list) or not pairs:
        raise ValueError('At least one explicit earlier-to-later season pair is required')
    targets = set()
    for pair in pairs:
        if (not isinstance(pair, list) or len(pair) != 2 or
                any(type(v) is not int for v in pair) or pair[0] >= pair[1] or pair[1] in targets):
            raise ValueError('Population priors must use an earlier completed season, with unique target years')
        targets.add(pair[1])


def ranks(values, ids, measured=None, tolerance=1e-12):
    """Match the declared shared-ranking rule; inactive teams remain unranked."""
    active = [i for i in ids if measured is None or measured[i] > 0]
    order = sorted(active, key=lambda i: (-values[i], i))
    result = {i: None for i in ids}; previous = None; shared = None
    for position, identity in enumerate(order, 1):
        if previous is None or abs(values[identity]-previous) > tolerance:
            shared = position; previous = values[identity]
        result[identity] = shared
    return result, order


def joint_system(teams, evidence, config):
    """Independent augmented r/H/D normal equations for exact removals."""
    ordered = sorted(teams, key=lambda t: t['id']); ids = {t['id']: i for i, t in enumerate(ordered)}
    count = len(ordered)
    design = np.zeros((len(evidence), count+2)); target = np.zeros(len(evidence))
    for row, game in enumerate(evidence):
        design[row, ids[game['a']]] = 1.; design[row, ids[game['b']]] = -1.
        design[row, count:] = [game['venue'], game['divisionSign']]
        target[row] = game['netRate']
    penalty = np.array([config['ridge']]*count+[config['contextPriorStrength']]*2)
    prior_rhs = np.zeros(count+2)
    prior_rhs[count:] = config['contextPriorStrength']*np.array([config['homePrior'], config['divisionPrior']])
    normal = np.diag(penalty)+design.T@design
    rhs = prior_rhs+design.T@target
    theta = np.linalg.solve(normal, rhs)
    inverse = np.linalg.inv(normal)
    return ordered, design, target, theta, inverse, normal, rhs


def omitted_coefficients(theta, inverse, vector, target):
    leverage_vector = inverse@vector
    leverage = float(vector@leverage_vector)
    denominator = 1.-leverage
    if not np.isfinite(denominator) or denominator <= 0:
        raise ValueError('Exact removal denominator must remain positive')
    residual = target-float(vector@theta)
    return theta-leverage_vector*(residual/denominator), denominator


def withheld_check(teams, fitted, config):
    ordered, design, target, theta, inverse, normal, rhs = joint_system(teams, fitted['gameEvidence'], config)
    ids = {t['id']: i for i, t in enumerate(ordered)}; by_id = {r['id']: r for r in fitted['ratings']}
    expected = np.array([by_id[t['id']]['effect'] for t in ordered]+[
        fitted['contextFit']['homeRate'], fitted['contextFit']['divisionRate']])
    agreement = float(np.max(abs(theta-expected)))
    if agreement > 1e-10:
        raise ValueError('Independent joint solution disagrees with adaptive model')
    fbs = [t['id'] for t in ordered if t['division'] == 'fbs']
    full_values = {t['id']: float(theta[ids[t['id']]]+(.5 if t['division'] == 'fbs' else -.5)*theta[-1]) for t in ordered}
    full_ranks, full_order = ranks(full_values, fbs)
    full_top = set(full_order[:25]); movement = {i: 0 for i in fbs}
    held = []; top_changed = 0; max_top_difference = 0; min_denominator = 1.; max_movement = 0
    for index, game in enumerate(fitted['gameEvidence']):
        if not any(by_id[i]['division'] == 'fbs' for i in [game['a'], game['b']]):
            continue
        coefficients, denominator = omitted_coefficients(theta, inverse, design[index], target[index])
        min_denominator = min(min_denominator, denominator)
        prediction = float(design[index]@coefficients)
        group = 'FBS-FBS' if all(by_id[i]['division'] == 'fbs' for i in [game['a'], game['b']]) else 'FBS-FCS'
        held.append(dict(group=group, divisionSign=game['divisionSign'], residual=prediction-target[index]))
        # This late-season snapshot has multiple games for every FBS team, but
        # retain the inactive rule for small synthetic fixtures too.
        measured = {i: by_id[i]['measuredGames']-int(i in [game['a'], game['b']]) for i in fbs}
        values = {i: float(coefficients[ids[i]]+.5*coefficients[-1]) for i in fbs}
        omitted_ranks, omitted_order = ranks(values, fbs, measured)
        difference = len(full_top.symmetric_difference(omitted_order[:25]))
        top_changed += int(difference > 0); max_top_difference = max(max_top_difference, difference)
        for i in fbs:
            if omitted_ranks[i] is not None and full_ranks[i] is not None:
                change = abs(omitted_ranks[i]-full_ranks[i]); movement[i] = max(movement[i], change)
                max_movement = max(max_movement, change)
    metrics = {}
    for group in ['allFbs', 'FBS-FBS', 'FBS-FCS']:
        subset = [r for r in held if group == 'allFbs' or r['group'] == group]
        residual = np.array([r['residual'] for r in subset])
        cross = [r['residual']*r['divisionSign'] for r in subset if r['divisionSign']]
        metrics[group] = dict(games=len(subset), mse=float(np.mean(residual**2)),
            rmse=float(np.sqrt(np.mean(residual**2))), mae=float(np.mean(abs(residual))),
            meanResidual=float(np.mean(residual)), meanFbsOrientedResidual=float(np.mean(cross)) if cross else None)
    return dict(scope='As-of-publication descriptive leave-one-game-out; NOT a pregame forecast',
        method='Exact joint-ridge Sherman-Morrison deletion; original target statistics removed from effects and venue/division context',
        gamesWithheld=len(held), metrics=metrics, independentJointAgreement=agreement,
        maxJointNormalEquationResidual=float(np.max(abs(normal@theta-rhs))),
        minimumRemovalDenominator=min_denominator, maximumIndividualRankMovement=max_movement,
        gamesChangingTop25Membership=top_changed, maximumTop25SymmetricDifference=max_top_difference,
        maximumRankMovementByTeam=[dict(id=i, team=by_id[i]['team'], fullRank=full_ranks[i], maxMovement=movement[i]) for i in fbs],
        limitations=['Other retained games can occur after the omitted game but before publication cutoff.',
                    'This cannot retroactively pass the historical future-game forecasting gate.',
                    'Rank influence is sensitivity, not a calibrated confidence interval or proof of a uniquely correct order.'])


def load_data(year):
    path = HERE/f'datasets/advanced-success-v1/seasons/{year}.json'
    return json.loads(path.read_bytes()), SHA(path.read_bytes())


def load_features(v2, year, ridge=1):
    key = SHA(json.dumps(dict(input=v2['inputSha256'][str(year)], parent=v2['parentOutcomeSha256'][str(year)],
                              code=v2['implementationSha256'], ridge=ridge), sort_keys=True).encode())
    path = HERE/f'cache/advanced-training-v1/adaptive-features/{year}-{key}.json'
    rows = json.loads(path.read_bytes())
    data, _ = load_data(year); games = {g['id']: g for g in data['games']}
    for row in rows:
        game = games[row['id']]
        if row['year'] != year or abs(row['target']-(game['stats']['home']['rate']-game['stats']['away']['rate'])) > 1e-12:
            raise ValueError('Frozen replay features do not match normalized target identities')
    return rows, SHA(path.read_bytes())


def current_reference(model, coverage):
    mean = float(np.mean([r['rating'] for r in model['rows'] if r['measuredGames']]))
    for row in model['rows']:
        row['aboveFbsMeanPercentagePoints'] = 100*(row['rating']-mean) if row['measuredGames'] else None
        row['coverage'] = coverage['teamCoverage'][row['id']]
        row['explanation']['fbsReferenceAdjustment'] = -mean
        row['explanation']['reconstructedAboveFbsMeanPercentagePoints'] = 100*(row['explanation']['reconstructedRating']-mean)
    return mean


def main():
    protocol_path = HERE/'performance_display_protocol.json'; protocol_bytes = protocol_path.read_bytes(); protocol = json.loads(protocol_bytes)
    baseline_bytes = (HERE/'results/adaptive-performance/a2232c44772a/experiment.json').read_bytes(); v2 = json.loads(baseline_bytes)
    snapshot_path = ROOT/'published/latest.json'; snapshot_bytes = snapshot_path.read_bytes(); snapshot = json.loads(snapshot_bytes)
    config = protocol['baseline']['config']; source_hashes = {}; feature_hashes = {}; priors = {}; forward = {}
    pairs = protocol['recentPriorCandidate']['forwardPairs']+ [protocol['recentPriorCandidate']['currentPair']]
    validate_forward_pairs(pairs)
    for prior_year, next_year in pairs:
        data, source_hashes[str(prior_year)] = load_data(prior_year)
        estimator_config = dict(config, contextPriorStrength=1)
        estimated = fit_adaptive_performance(data['teams'], observations(data['games']), estimator_config)
        prior = dict(homePrior=estimated['contextFit']['homeRate'], divisionPrior=estimated['contextFit']['divisionRate'])
        priors[str(next_year)] = dict(priorSeason=prior_year, estimatorConfig=estimator_config,
                                     config=dict(config, **prior), context=estimated['contextFit'], games=estimated['gamesUsed'])
        if next_year == 2026:
            continue
        rows, feature_hashes[str(next_year)] = load_features(v2, next_year)
        forward[str(next_year)] = {
            'baseline': evaluate(rows, lambda r: adaptive_prediction(r, config)),
            'recentPrior': evaluate(rows, lambda r: adaptive_prediction(r, priors[str(next_year)]['config']))}
        print('Forward completed', prior_year, next_year, flush=True)
    pooled_rows = []; baseline_predictions = []; recent_predictions = []
    for year in [2024, 2025]:
        rows, _ = load_features(v2, year); pooled_rows.extend(rows)
        baseline_predictions.extend([adaptive_prediction(r, config) for r in rows])
        recent_predictions.extend([adaptive_prediction(r, priors[str(year)]['config']) for r in rows])
    from adaptive_performance_experiment import summary
    pooled = {}
    for group in ['allFbs', 'FBS-FBS', 'FBS-FCS']:
        indices = [i for i, r in enumerate(pooled_rows) if group == 'allFbs' or r['group'] == group]
        subset = [pooled_rows[i] for i in indices]
        pooled[group] = dict(baseline=summary(subset, [baseline_predictions[i] for i in indices]),
                             recentPrior=summary(subset, [recent_predictions[i] for i in indices]))
    selection_checks = dict(
        crossBiasImproves=abs(pooled['FBS-FCS']['recentPrior']['meanFbsOrientedResidual']) < abs(pooled['FBS-FCS']['baseline']['meanFbsOrientedResidual']),
        pooledFbsMseHarmAtMostOnePercent=pooled['FBS-FBS']['recentPrior']['mse'] <= 1.01*pooled['FBS-FBS']['baseline']['mse'],
        eachYearFbsMseHarmAtMostThreePercent=all(forward[str(y)]['recentPrior']['FBS-FBS']['pooled']['mse'] <= 1.03*forward[str(y)]['baseline']['FBS-FBS']['pooled']['mse'] for y in [2024, 2025]))
    candidate = 'recent-prior' if all(selection_checks.values()) else 'v2-baseline'
    chosen_config = priors['2026']['config'] if candidate == 'recent-prior' else config
    current, source_hashes['2026'] = load_data(2026)
    if source_hashes['2026'] != v2['inputSha256']['2026']:
        raise ValueError('Current normalized source no longer matches saved validation snapshot')
    models = {}
    checks = {}
    for label, own_config in [('v2-baseline', config), ('recent-prior', priors['2026']['config'])]:
        models[label] = fit_adaptive_performance(current['teams'], observations(current['games']), own_config)
        current_reference(models[label], current['audit'])
        checks[label] = withheld_check(current['teams'], models[label], own_config)
        print('Withheld completed', label, checks[label]['gamesWithheld'], flush=True)
    chosen = models[candidate]
    if snapshot_path.read_bytes() != snapshot_bytes:
        raise ValueError('Publication baseline changed while running display tests')
    code_files = ['performance_display_tests.py', 'adaptive_performance_model.py', 'advanced_performance_model.py',
                  'adaptive_performance_experiment.py', 'advanced_performance_experiment.py']
    code_hashes = {p: SHA((HERE/p).read_bytes()) for p in code_files}
    fingerprint = SHA(protocol_bytes+json.dumps(dict(source=source_hashes, features=feature_hashes, code=code_hashes,
                     baseline=SHA(baseline_bytes), snapshot=SHA(snapshot_bytes)), sort_keys=True).encode())
    out = HERE/'results/performance-display'/fingerprint[:12]; out.mkdir(parents=True, exist_ok=True)
    original_failed = dict(status='failed', target=0.02, historicalCrossBias=-0.02295530263316677,
        scope='Repeated2023-2025 next-game forecast diagnostic for originalV2; retained unchanged',
        reference='research/results/adaptive-performance/a2232c44772a/experiment.json.gz')
    report = dict(protocol=protocol, fingerprint=fingerprint, sourceSha256=source_hashes, featureSha256=feature_hashes,
        implementationSha256=code_hashes, baselineReportSha256=SHA(baseline_bytes), snapshotFileSha256=SHA(snapshot_bytes),
        priorEstimates=priors, forwardByYear=forward, forwardPooled=pooled, selectionChecks=selection_checks,
        recommendedCandidate=candidate, recommendedConfig=chosen_config, withheldByCandidate=checks,
        currentRankComparisons=dict(baseline=[dict(id=r['id'],rank=r['rank'],rating=r['rating']) for r in models['v2-baseline']['rows']],
                                    recentPrior=[dict(id=r['id'],rank=r['rank'],rating=r['rating']) for r in models['recent-prior']['rows']]),
        originalFailedForecastGate=original_failed, apiCalls=0, productionChanged=False,
        caveat='Known retrospective seasons; descriptive game withholding permits later completed games. Experimental publication is not full validation or a passed original forecasting gate.')
    encoded = (json.dumps(report, indent=2)+'\n').encode(); (out/'tests.json').write_bytes(encoded)
    (out/'tests.json.gz').write_bytes(gzip.compress(encoded, mtime=0))
    manifest = next(f for f in v2['sourceManifests']['advanced-training-v1']['files'] if f['year'] == 2026)
    publisher = dict(schemaVersion=1, modelId=chosen['modelId'], status='experimental',
        label='Experimental Performance - Scrimmage Consistency', candidate=candidate,
        config=chosen_config, source=dict(snapshotHash=snapshot['snapshotHash'], snapshotFileSha256=SHA(snapshot_bytes),
            asOf=snapshot['asOf'], season=2026, advancedStatsSha256=manifest['rawSha256'], advancedStatsFetchedAt=manifest['completedAt'],
            priorSeason=2025 if candidate == 'recent-prior' else None, protocolSha256=SHA(protocol_bytes),
            publicationTestFingerprint=fingerprint),
        units='Percentage points of opponent-adjusted net success rate above the current measured FBS mean',
        scope=protocol['publication']['scope'], coverage=current['audit'],
        validation=dict(originalFailedForecastGate=original_failed, selectionChecks=selection_checks,
                        recentForwardPooled=pooled, withheld=checks[candidate], testReportFingerprint=fingerprint),
        contextFit=chosen['contextFit'], currentFbsMean=float(np.mean([r['rating'] for r in chosen['rows'] if r['measuredGames']])),
        rows=chosen['rows'], maxExplanationReconciliationError=chosen['maxExplanationReconciliationError'],
        implementationSha256=code_hashes,
        limitations=['Experimental scrimmage-consistency ranking, not a complete special-teams/turnover/scoring-value grade.',
                    'Rates cover CFBD PPA-eligible plays, not every box-score play; no proprietary PPA values are model features.',
                    'The original historical forecast-bias gate remains failed. New forward comparisons are already-inspected retrospective data.',
                    'As-of-date withheld-game checks are descriptive and must not be labeled pregame forecasts.'])
    (out/'publisher-input.json').write_text(json.dumps(publisher,indent=2)+'\n',encoding='utf-8')
    write_report(out, report, publisher)
    print(json.dumps(dict(output=str(out), fingerprint=fingerprint, recommendedCandidate=candidate,
                         selectionChecks=selection_checks, forwardPooled=pooled,
                         withheld={k:v['metrics'] for k,v in checks.items()})), flush=True)


def write_report(out, report, publisher):
    p = report['forwardPooled']; selected = report['recommendedCandidate']; own = report['withheldByCandidate'][selected]
    text = f'''PERFORMANCE DISPLAY TESTS: EXPERIMENTAL PUBLICATION

Recommendation: {selected}. The declared recent-prior selection checks are
{json.dumps(report['selectionChecks'],sort_keys=True)}.

The only changed candidate input is its general venue/division prior, learned
from completed earlier seasons. Teams do not inherit previous-year effects.
Ridge1 and context-prior strength64 were fixed before this test. Known seasons
remain retrospective; this is not an untouched or prospective validation claim.

Forward2024-2025 FBS-FCS mean error: baseline
{100*p['FBS-FCS']['baseline']['meanFbsOrientedResidual']:.6f}pp, recent-prior
{100*p['FBS-FCS']['recentPrior']['meanFbsOrientedResidual']:.6f}pp.
FBS-FBS pooled MSE: baseline {p['FBS-FBS']['baseline']['mse']:.10f},
recent-prior {p['FBS-FBS']['recentPrior']['mse']:.10f}.
All per-year/group comparisons, prior estimates and declared selection rules
are in tests.json.gz. No settings were chosen from the2026 order.

As-of-date withheld-game check for selected candidate: {own['gamesWithheld']} FBS
games removed individually from the joint effect+context fit. It retains every
other eligible game completed by the publication cutoff, including games later
than the omitted kickoff. It is descriptive, NOT a pregame prediction test.
FBS-FBS withheld RMSE: {100*own['metrics']['FBS-FBS']['rmse']:.6f}pp.
FBS-FCS withheld RMSE: {100*own['metrics']['FBS-FCS']['rmse']:.6f}pp;
FBS-oriented withheld mean error: {100*own['metrics']['FBS-FCS']['meanFbsOrientedResidual']:.6f}pp.
Maximum individual rank movement after one omitted FBS game:
{own['maximumIndividualRankMovement']}. Games altering Top25 membership:
{own['gamesChangingTop25Membership']}. These are influence diagnostics, not
calibrated confidence intervals. Exact removal matches independent full joint
normal equations; minimum removal denominator {own['minimumRemovalDenominator']:.8f}.

Every selected current score has exact conditional per-game reconciliation.
Current source coverage: {publisher['coverage']['acceptedFbsInvolvingGames']}/
{publisher['coverage']['completedFbsInvolvingContextGames']} FBS games,
{publisher['coverage']['completeFbsTeams']} complete FBS teams, at the exact
saved snapshot cutoff {publisher['source']['asOf']}.

Original forecasting gate: FAILED, unchanged. OriginalV2 historical repeated
FBS-FCS bias was -2.295530pp against the2pp target. Publishing a separately
labeled experimental descriptive view does not turn that earlier result into
a pass. Preserve the scope, date, source coverage and limitations in the UI.

Files: publisher-input.json provides derived FBS scores, score explanations,
coverage, chosen config and validation metadata. tests.json.gz retains the full
derived experiment. No raw API records/normalized source-stat arrays are public.
API calls for this test:0. SOR and Predictive Strength were not changed.
'''
    (out/'REPORT.txt').write_text(text,encoding='utf-8')


if __name__ == '__main__':
    main()
