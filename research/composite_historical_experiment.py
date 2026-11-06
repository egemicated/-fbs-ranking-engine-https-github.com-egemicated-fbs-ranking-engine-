"""Offline, past-week-only comparison of the frozen three-model preview.

The protocol is a research declaration, not a new production ranking policy.
"""
from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np

from compare_merit import sigmoid
from division_experiment import fit_mapping
from replay_weekly import timestamp

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SHA = lambda raw: hashlib.sha256(raw).hexdigest()
COMPONENTS = ('sor', 'strength', 'performance')
FAMILIES = {
    'sor': ('sor',), 'strength': ('strength',), 'performance': ('performance',),
    'triple': COMPONENTS,
    'sor+strength': ('sor', 'strength'),
    'sor+performance': ('sor', 'performance'),
    'strength+performance': ('strength', 'performance'),
}
TOLERANCE = 1e-10


def percentiles(scores):
    """Return midrank percentiles and genuine competition ranks, without a tiebreak."""
    if not scores or any(not np.isfinite(value) for value in scores.values()):
        raise ValueError('A nonempty finite common population is required')
    order = sorted(scores, key=lambda identity: (-scores[identity], identity))
    result = {}; ranks = {}; start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and abs(scores[order[end]] - scores[order[start]]) <= TOLERANCE:
            end += 1
        midrank = (start + 1 + end) / 2
        value = 100 * (len(order) - midrank) / (len(order) - 1) if len(order) > 1 else 50.
        for identity in order[start:end]:
            result[identity] = value; ranks[identity] = start + 1
        start = end
    return result, ranks


def keyed_rows(value):
    return value if isinstance(value, dict) else {row['id']: row for row in value}


def join_replays(outcomes, performance):
    """Join identical checkpoints, never filter targets by their future statistics."""
    year = outcomes['year']
    if performance['year'] != year:
        raise ValueError('Mismatched replay years')
    perf = {point['block']: point for point in performance['checkpoints']}
    rows = []; diagnostics = []; exclusions = Counter(); all_targets = set()
    for point in outcomes['checkpoints']:
        block = point['block']
        if block not in perf:
            raise ValueError(f'Missing Performance checkpoint {block}')
        other = perf[block]
        outcome_cutoff = timestamp(point['cutoff']) if isinstance(point['cutoff'], str) else point['cutoff']
        performance_cutoff = timestamp(other['cutoff']) if isinstance(other['cutoff'], str) else other['cutoff']
        if outcome_cutoff != performance_cutoff:
            raise ValueError('Component cutoff disagreement')
        targets = point.get('targets', [])
        target_ids = {game['id'] for game in targets}
        if target_ids != set(other['targetGameIds']):
            raise ValueError('Component target graph disagreement')
        past_ids = set(point['eligibleGameIds']); stat_ids = set(other['eligibleGameIds'])
        if set(other['parentEligibleGameIds']) != past_ids:
            raise ValueError('Component parent game graph disagreement')
        if not stat_ids <= past_ids or target_ids & (past_ids | stat_ids):
            raise ValueError('Source graph mismatch or target-game leakage')
        a = keyed_rows(point['rows']); b = keyed_rows(other['rows'])
        common = sorted(identity for identity in a.keys() & b.keys()
                        if a[identity].get('division', 'fbs') == 'fbs'
                        and a[identity]['games'] >= 1 and b[identity]['measuredGames'] >= 1
                        and b[identity].get('score') is not None)
        scores = {
            'sor': {identity: a[identity]['sor'] for identity in common},
            'strength': {identity: a[identity]['strength'] for identity in common},
            'performance': {identity: b[identity]['score'] for identity in common},
        }
        normalized = {}; component_ranks = {}
        if common:
            for family in COMPONENTS:
                normalized[family], component_ranks[family] = percentiles(scores[family])
        indices = {family: {identity: float(np.mean([normalized[key][identity] for key in members]))
                            for identity in common} for family, members in FAMILIES.items()}
        correlations = {}
        if len(common) > 2:
            for first, second in [('sor', 'strength'), ('sor', 'performance'), ('strength', 'performance')]:
                x = [normalized[first][identity] for identity in common]
                y = [normalized[second][identity] for identity in common]
                correlations[first + ':' + second] = float(np.corrcoef(x, y)[0, 1]) if np.std(x) and np.std(y) else None
        point_counts = Counter()
        for game in targets:
            home, away = game['home'], game['away']
            if game['id'] in all_targets:
                raise ValueError('Duplicate historical target game')
            all_targets.add(game['id'])
            if a.get(home, {}).get('division', 'unknown') != 'fbs' or a.get(away, {}).get('division', 'unknown') != 'fbs':
                point_counts['nonFbsFbs'] += 1; continue
            point_counts['fbsFbsTargets'] += 1
            outcome_count = min(a[home]['games'], a[away]['games'])
            point_counts['nativeOutcomePairEligible'] += int(outcome_count >= 1)
            point_counts['nativeEstablishedOutcomePairEligible'] += int(outcome_count >= 4)
            if home not in common or away not in common:
                exclusions['notInCommonPopulation'] += 1
                point_counts['notInCommonPopulation'] += 1; continue
            if game['homePoints'] == game['awayPoints']:
                raise ValueError('Tied modern FBS result requires an explicit policy')
            counts = [a[home]['games'], a[away]['games'], b[home]['measuredGames'], b[away]['measuredGames']]
            primary = min(counts) >= 4
            point_counts['eligibleSecondary'] += 1; point_counts['eligiblePrimary'] += int(primary)
            exclusions['earlyOnly'] += int(not primary)
            differences = {family: indices[family][home] - indices[family][away] for family in FAMILIES}
            component_picks = [np.sign(differences[family]) if abs(differences[family]) > TOLERANCE else 0 for family in COMPONENTS]
            rows.append(dict(id=game['id'], year=year, block=block,
                             kind=point.get('kind', point.get('seasonType')), week=point['week'],
                             home=home, away=away, homeTeam=a[home].get('team', home), awayTeam=a[away].get('team', away),
                             venue=int(not game['neutral']), y=int(game['homePoints'] > game['awayPoints']),
                             primary=primary, priorCounts=counts, differences=differences,
                             top25=any(component_ranks[family][identity] <= 25 for family in COMPONENTS for identity in (home, away)),
                             componentDisagreement=len(set(component_picks)) > 1))
        diagnostics.append(dict(block=block, cutoff=point['cutoff'], outcomeGames=len(past_ids),
                                performanceGames=len(stat_ids), commonFbsTeams=len(common),
                                counts=dict(point_counts), performanceCoverage=other.get('coverage'),
                                percentileCorrelations=correlations))
    if set(perf) != {point['block'] for point in outcomes['checkpoints']}:
        raise ValueError('Extra unmatched Performance checkpoint')
    return rows, dict(checkpoints=diagnostics, exclusions=dict(exclusions),
                      fbsFbsTargets=sum(point['counts'].get('fbsFbsTargets', 0) for point in diagnostics),
                      nativeOutcomePairEligible=sum(point['counts'].get('nativeOutcomePairEligible', 0) for point in diagnostics),
                      nativeEstablishedOutcomePairEligible=sum(point['counts'].get('nativeEstablishedOutcomePairEligible', 0) for point in diagnostics),
                      eligibleSecondary=len(rows), eligiblePrimary=sum(row['primary'] for row in rows))


def calibrate(rows):
    training = [row for row in rows if row['primary']]
    if not training:
        raise ValueError('No older calibration games')
    result = {}
    y = np.array([row['y'] for row in training])
    for family in FAMILIES:
        x = np.array([[row['differences'][family] / 100, row['venue']] for row in training])
        if np.linalg.matrix_rank(x) != 2:
            raise ValueError('Calibration index/venue design is not identified')
        beta, diagnostics = fit_mapping(x, y)
        if not np.isfinite(diagnostics['hessianConditionNumber']):
            raise ValueError('Calibration Hessian is singular')
        result[family] = dict(coefficients=beta.tolist(), diagnostics=diagnostics, games=len(y))
    return result


def loss_arrays(rows, family, calibration):
    difference = np.array([row['differences'][family] for row in rows])
    y = np.array([row['y'] for row in rows])
    tied = abs(difference) <= TOLERANCE
    accuracy = np.where(tied, .5, (difference > 0) == y).astype(float)
    x = np.array([[row['differences'][family] / 100, row['venue']] for row in rows]).reshape((-1, 2))
    p = np.clip(sigmoid(x @ np.array(calibration[family]['coefficients'])), 1e-12, 1 - 1e-12)
    return dict(accuracy=accuracy, brier=(p-y)**2, logLoss=-y*np.log(p)-(1-y)*np.log(1-p),
                probabilities=p, probabilityAccuracy=np.where(abs(p-.5) <= TOLERANCE, .5, (p > .5) == y).astype(float),
                probabilityError=p-y, tied=tied)


def metrics(rows, calibration):
    if not rows:
        return dict(games=0, models={})
    result = {}
    for family in FAMILIES:
        arrays = loss_arrays(rows, family, calibration)
        result[family] = {name: float(np.mean(arrays[name])) for name in
                          ('accuracy', 'brier', 'logLoss', 'probabilityAccuracy', 'probabilityError')}
        result[family]['rankingTies'] = int(np.sum(arrays['tied']))
    return dict(games=len(rows), models=result)


def paired_sensitivity(rows, calibration, seed=1729, replicates=2000):
    """Resample identical week blocks within year; never treat games as independent."""
    if not rows:
        return {}
    rng = np.random.default_rng(seed)
    arrays = {family: loss_arrays(rows, family, calibration) for family in FAMILIES}
    result = {}
    for component in COMPONENTS:
        differences = np.column_stack([arrays['triple'][metric] - arrays[component][metric]
                                       for metric in ('accuracy', 'brier', 'logLoss')])
        strata = []
        for year in sorted({row['year'] for row in rows}):
            blocks = sorted({row['block'] for row in rows if row['year'] == year})
            sums = []; counts = []
            for block in blocks:
                mask = np.array([row['block'] == block for row in rows])
                sums.append(np.sum(differences[mask], axis=0)); counts.append(int(sum(mask)))
            strata.append((np.array(sums), np.array(counts)))
        samples = np.zeros((replicates, 3)); totals = np.zeros(replicates)
        for sums, counts in strata:
            selected = rng.integers(len(counts), size=(replicates, len(counts)))
            samples += np.sum(sums[selected], axis=1); totals += np.sum(counts[selected], axis=1)
        samples /= totals[:, None]
        result[component] = {metric: dict(tripleMinusStandalone=float(np.mean(differences[:, index])),
                                         sensitivity95=np.quantile(samples[:, index], [.025, .975]).tolist())
                             for index, metric in enumerate(('accuracy', 'brier', 'logLoss'))}
    return result


def summarize(rows, calibration, evaluation_years):
    primary = [row for row in rows if row['primary']]
    groups = {
        'regular': [row for row in primary if row['kind'] == 'regular'],
        'postseason': [row for row in primary if row['kind'] == 'postseason'],
        'neutral': [row for row in primary if not row['venue']],
        'homeVenue': [row for row in primary if row['venue']],
        'componentTop25': [row for row in primary if row['top25']],
        'componentsDisagree': [row for row in primary if row['componentDisagreement']],
    }
    return dict(primary=metrics(primary, calibration), allEligible=metrics(rows, calibration),
                byYear={str(year): metrics([row for row in primary if row['year'] == year], calibration) for year in evaluation_years},
                groups={name: metrics(subset, calibration) for name, subset in groups.items()},
                pairedWeekBlockSensitivity=paired_sensitivity(primary, calibration))


def verify_protected():
    before = json.loads((HERE/'cache/composite-historical/protected-before.json').read_bytes())
    changed = [name for name, digest in before.items() if SHA((ROOT/name).read_bytes()) != digest]
    if changed:
        raise ValueError('Protected production files changed: ' + ', '.join(changed))
    return dict(files=len(before), changed=changed)


def main():
    from composite_outcome_replay import replay_year as outcome_replay
    from composite_performance_replay import replay_year as performance_replay
    protocol_path = HERE/'composite-historical-protocol.json'
    protocol = json.loads(protocol_path.read_bytes())
    years = protocol['time']['probabilityCalibrationYears'] + protocol['time']['supplementaryEvaluationYears'] + protocol['time']['primaryEvaluationYears']
    joined = {}; sources = {}; audits = {}
    for year in years:
        outcomes = outcome_replay(year); performance = performance_replay(year)
        joined[year], audits[str(year)] = join_replays(outcomes, performance)
        sources[str(year)] = dict(outcomes={key: value for key, value in outcomes.items() if key != 'checkpoints'},
                                  performance={key: value for key, value in performance.items() if key != 'checkpoints'})
        print('Joined', year, audits[str(year)]['eligiblePrimary'], 'established games', flush=True)
    calibration_rows = [row for year in protocol['time']['probabilityCalibrationYears'] for row in joined[year]]
    calibration = calibrate(calibration_rows)
    evaluation_years = protocol['time']['primaryEvaluationYears']
    evaluated = [row for year in evaluation_years for row in joined[year]]
    secondary_years = protocol['time']['supplementaryEvaluationYears']
    supplementary = [row for year in secondary_years for row in joined[year]]
    code_paths = ['composite_historical_experiment.py', 'composite_outcome_replay.py', 'composite_performance_replay.py']
    code_hashes = {path: SHA((HERE/path).read_bytes()) for path in code_paths}
    metadata = dict(protocolSha256=SHA(protocol_path.read_bytes()), implementationSha256=code_hashes, sources=sources)
    fingerprint = SHA(json.dumps(metadata, sort_keys=True).encode())
    report = dict(protocol=protocol, fingerprint=fingerprint, **metadata, calibration=calibration, audits=audits,
                  evaluation=summarize(evaluated, calibration, evaluation_years),
                  supplementary=summarize(supplementary, calibration, secondary_years),
                  productionProtection=verify_protected(), cfbdCalls=0, liveChanges=False)
    output = HERE/'results/composite-historical'/fingerprint[:12]; output.mkdir(parents=True, exist_ok=True)
    (output/'results.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    all_rows = calibration_rows + supplementary + evaluated
    with (output/'game-predictions.csv').open('w', newline='', encoding='utf-8') as stream:
        fieldnames = ['year','block','id','home','away','homeTeam','awayTeam','y','venue','primary']
        fieldnames += [family + suffix for family in FAMILIES for suffix in ('IndexDifference','HomeWinProbability')]
        writer = csv.DictWriter(stream, fieldnames=fieldnames); writer.writeheader()
        probabilities = {family: loss_arrays(all_rows, family, calibration)['probabilities'] for family in FAMILIES}
        for index, row in enumerate(all_rows):
            record = {key: row[key] for key in fieldnames[:10]}
            for family in FAMILIES:
                record[family+'IndexDifference'] = row['differences'][family]
                record[family+'HomeWinProbability'] = probabilities[family][index]
            writer.writerow(record)
    write_report(output, report)
    print(json.dumps(dict(output=str(output), fingerprint=fingerprint,
                          primary=report['evaluation']['primary'], protected=report['productionProtection']), indent=2), flush=True)


def write_report(output, report):
    result = report['evaluation']
    lines = ['THREE-MODEL HISTORICAL COMPARISON', 'Protocol: '+report['protocol']['id'], 'Fingerprint: '+report['fingerprint'],
             'Primary: established FBS-FBS games, 2024-2025; corrected, previously inspected retrospective data.',
             'Same-game support; no current-week/future game in a checkpoint. No polls, no weight search.',
             'Probabilities are separately calibrated on2018-2019 only; the index itself is not a probability.', '',
             'Model | Games | Rank-pick accuracy | Brier (lower) | Log loss (lower)']
    for family, values in result['primary']['models'].items():
        lines.append(f"{family} | {result['primary']['games']} | {100*values['accuracy']:.3f}% | {values['brier']:.6f} | {values['logLoss']:.6f}")
    for year, summary in result['byYear'].items():
        lines += ['', f'{year}: {summary["games"]} games']
        for family, values in summary['models'].items():
            lines.append(f"{family}: {100*values['accuracy']:.3f}% accuracy; Brier {values['brier']:.6f}; log loss {values['logLoss']:.6f}")
    lines += ['', 'Paired week-block sensitivity intervals: triple minus each standalone. Positive accuracy is better; negative Brier/logloss is better.']
    for component, values in result['pairedWeekBlockSensitivity'].items():
        lines.append(component+': '+json.dumps(values))
    lines += ['', 'Interpretation limits:',
              'Future-game prediction assesses predictive usefulness, not a uniquely correct earned-achievement ranking.',
              'Blending imports own-team historical Strength priors and margin evidence into the combined index.',
              'Performance/Strength overlap; ablations are diagnostics, not a search for publishable winning weights.',
              'Previously inspected seasons and the selected Performance variant prevent an untouched-test claim.',
              'Resampled weeks share teams; intervals are sensitivity summaries, not calibrated prospective significance.',
              'No public formula/deployment change and zero CFBD calls.',
              'Protected production files: '+str(report['productionProtection']['files'])+' unchanged.']
    (output/'REPORT.txt').write_text('\n'.join(lines)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
