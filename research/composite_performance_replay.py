"""Offline past-only replay of the deployed recent-prior Performance model.

Only derived scores and source/eligibility hashes enter the private cache. The
source statistics, normalizations and production files are never rewritten.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np

from advanced_performance_experiment import observations
from advanced_performance_model import _prepare
from adaptive_performance_model import fit_adaptive_performance
from replay_weekly import available_games, timestamp, weekly_groups


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SHA = lambda value: hashlib.sha256(value).hexdigest()
VERSION = "composite-past-only-performance-v1"


def baseline_config():
    protocol = json.loads((HERE / 'performance_display_protocol.json').read_bytes())
    return dict(protocol['baseline']['config'])


def recent_prior_from_data(data, target_year):
    """Keep only H/D learned in the completed preceding season; discard effects."""
    if data['year'] != target_year - 1:
        raise ValueError('The population prior must use the preceding season only')
    estimator = dict(baseline_config(), ridge=1, contextPriorStrength=1)
    fitted = fit_adaptive_performance(data['teams'], observations(data['games']), estimator)
    config = dict(ridge=1, contextPriorStrength=64,
                  homePrior=fitted['contextFit']['homeRate'],
                  divisionPrior=fitted['contextFit']['divisionRate'])
    return dict(priorSeason=data['year'], estimatorConfig=estimator, config=config,
                games=fitted['gamesUsed'], latestPriorKickoff=max(
                    (timestamp(g['startDate']) for g in data['games']), default=None),
                retainedFields=['homeRate', 'divisionRate'], previousTeamEffectsRetained=False)


def checkpoint(teams, games, config):
    """Exact augmented normal equations for the unchanged joint-ridge objective."""
    ordered, evidence = _prepare(teams, observations(games),
                                dict(ridge=config['ridge'], homeRate=0., divisionRate=0.))
    ids = {t['id']: index for index, t in enumerate(ordered)}
    count = len(ordered)
    design = np.zeros((len(evidence), count + 2))
    target = np.zeros(len(evidence))
    measured = Counter()
    for index, game in enumerate(evidence):
        design[index, ids[game['a']]] = 1.
        design[index, ids[game['b']]] = -1.
        design[index, count:] = [game['venue'], game['divisionSign']]
        target[index] = game['netRate']
        measured[game['a']] += 1
        measured[game['b']] += 1
    penalties = np.array([config['ridge']] * count + [config['contextPriorStrength']] * 2)
    normal = np.diag(penalties) + design.T @ design
    rhs = design.T @ target
    rhs[count:] += config['contextPriorStrength'] * np.array([config['homePrior'], config['divisionPrior']])
    theta = np.linalg.solve(normal, rhs)
    residual = float(np.max(np.abs(normal @ theta - rhs)))
    if not np.all(np.isfinite(theta)) or residual > 1e-10:
        raise ValueError('Joint Performance normal equations failed to reconcile')
    ratings = {team['id']: float(theta[index] + (.5 if team['division'] == 'fbs' else -.5) * theta[-1])
               for index, team in enumerate(ordered)}
    active_fbs = [ratings[t['id']] for t in ordered if t['division'] == 'fbs' and measured[t['id']] > 0]
    reference = float(np.mean(active_fbs)) if active_fbs else None
    rows = {team['id']: dict(rating=ratings[team['id']], measuredGames=measured[team['id']],
                            score=100 * (ratings[team['id']] - reference)
                            if measured[team['id']] > 0 else None)
            for team in ordered if team['division'] == 'fbs'}
    return dict(rows=rows, allRatings=ratings, context=dict(homeRate=float(theta[-2]),
                divisionRate=float(theta[-1])), reference=reference, gamesUsed=len(evidence),
                normalEquationResidual=residual)


def pure_agreement(teams, games, config, result):
    """Independent production-equivalent Schur solution versus the direct fit."""
    pure = fit_adaptive_performance(teams, observations(games), config)
    agreement = max(abs(row['rating'] - result['allRatings'][row['id']]) for row in pure['ratings'])
    agreement = max(agreement, abs(pure['contextFit']['homeRate'] - result['context']['homeRate']),
                    abs(pure['contextFit']['divisionRate'] - result['context']['divisionRate']))
    if agreement > 1e-10:
        raise ValueError('Direct joint fit disagrees with deployed Performance formula')
    return float(agreement)


def replay_data(data, parent, prior, verify=True):
    if data['year'] != parent['year'] or prior['priorSeason'] != data['year'] - 1:
        raise ValueError('Season identities do not match their past-only population prior')
    by_id = {game['id']: game for game in data['games']}
    if len(by_id) != len(data['games']):
        raise ValueError('Duplicate normalized game identity')
    parent_by_id = {game['id']: game for game in parent['games']}
    if len(parent_by_id) != len(parent['games']):
        raise ValueError('Duplicate parent outcome game identity')
    if not set(by_id) <= set(parent_by_id):
        raise ValueError('Normalized game identities are not in the parent outcome graph')
    for identity, game in by_id.items():
        outcome = parent_by_id[identity]
        if any(game[field] != outcome[field] for field in
               ['home', 'away', 'neutral', 'completed', 'startDate', 'week', 'seasonType']):
            raise ValueError('Normalized identity, venue or timing disagrees with the parent outcome graph')
    groups = weekly_groups(parent)
    if groups and prior['latestPriorKickoff'] is not None:
        if prior['latestPriorKickoff'] + 86400 > min(timestamp(g['startDate']) for g in groups[0][1]):
            raise ValueError('Previous-season prior was not available before the target season')
    parent_divisions = {team['id']: team['division'] for team in parent['teams']}
    seen = set()
    result = []
    checks = []
    verification_indices = {len(groups) // 2, len(groups) - 1} if verify else set()
    for group_index, ((kind, week), targets) in enumerate(groups):
        cutoff = min(timestamp(game['startDate']) for game in targets)
        parent_past = available_games(parent, seen, cutoff)
        parent_eligible_ids = {game['id'] for game in parent_past}
        past = [by_id[identity] for identity in sorted(parent_eligible_ids & set(by_id))]
        target_ids = {game['id'] for game in targets}
        if target_ids & {game['id'] for game in past}:
            raise ValueError('Target-week statistics leaked into a preweek fit')
        if any(timestamp(game['startDate']) + 86400 > cutoff for game in past):
            raise ValueError('A future statistic entered a preweek fit')
        fitted = checkpoint(data['teams'], past, prior['config'])
        if group_index in verification_indices:
            checks.append(pure_agreement(data['teams'], past, prior['config'], fitted))
        parent_fbs_games = [game for game in parent_past if 'fbs' in
                            (parent_divisions[game['home']], parent_divisions[game['away']])]
        covered_fbs = sum(game['id'] in by_id for game in parent_fbs_games)
        result.append(dict(block=f'{data["year"]}:{kind}:{week}', kind=kind, week=week,
            cutoff=cutoff, cutoffUtc=datetime.fromtimestamp(cutoff, timezone.utc).isoformat(),
            eligibleGameIds=[game['id'] for game in past],
            parentEligibleGameIds=sorted(parent_eligible_ids), targetGameIds=sorted(target_ids),
            rows=fitted['rows'], context=fitted['context'], reference=fitted['reference'],
            normalEquationResidual=fitted['normalEquationResidual'],
            coverage=dict(expectedFbsGames=len(parent_fbs_games), coveredFbsGames=covered_fbs,
                          missingFbsGameIds=sorted(game['id'] for game in parent_fbs_games if game['id'] not in by_id),
                          ratio=covered_fbs / len(parent_fbs_games) if parent_fbs_games else None)))
        seen.update(target_ids)
    return dict(year=data['year'], prior=prior, checkpoints=result,
                audit=dict(pastOnly=True, targetExcluded=True, availabilityBufferHours=24,
                           maxIndependentPureAgreement=max(checks, default=None),
                           independentPureChecks=len(checks), sourceCalls=0,
                           scope='Provider-covered PPA-eligible-play net success rate; individual FBS/FCS context',
                           previousTeamEffectsRetained=False))


def replay_year(year, use_cache=True, verify=True):
    paths = dict(source=HERE / f'datasets/advanced-success-v1/seasons/{year}.json',
                 parent=HERE / f'datasets/fcs-coverage-v1/seasons/{year}.json',
                 prior=HERE / f'datasets/advanced-success-v1/seasons/{year - 1}.json')
    sources = {name: path.read_bytes() for name, path in paths.items()}
    pins = {name: SHA(value) for name, value in sources.items()}
    code_paths = [Path(__file__), HERE / 'advanced_performance_model.py', HERE / 'advanced_performance_experiment.py',
                  HERE / 'adaptive_performance_model.py', HERE / 'replay_weekly.py', HERE / 'performance_display_protocol.json']
    code_pins = {path.name: SHA(path.read_bytes()) for path in code_paths}
    fingerprint = SHA(json.dumps(dict(version=VERSION, sources=pins, code=code_pins,
                                     numpyVersion=np.__version__, verify=verify), sort_keys=True).encode())
    cache = HERE / f'cache/composite-history-performance/{year}-{fingerprint}.json'
    if use_cache and cache.exists():
        return json.loads(cache.read_bytes())
    data, parent, previous = [json.loads(sources[name]) for name in ['source', 'parent', 'prior']]
    if data['year'] != year or parent['year'] != year or previous['year'] != year - 1:
        raise ValueError('Stored source years do not match the requested replay')
    prior = recent_prior_from_data(previous, year)
    result = replay_data(data, parent, prior, verify=verify)
    result.update(version=VERSION, fingerprint=fingerprint, sourceSha256=pins, implementationSha256=code_pins)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--years', type=int, nargs='+', default=[2018, 2019, 2024, 2025])
    args = parser.parse_args()
    for year in args.years:
        result = replay_year(year)
        print(json.dumps(dict(year=year, fingerprint=result['fingerprint'], checkpoints=len(result['checkpoints']),
                              audit=result['audit'])), flush=True)


if __name__ == '__main__':
    main()
