"""Offline past-only replay of the unchanged production SOR/Strength formulas.

This module does not fetch, deploy, fit model settings, or write live files.
Historical source and previously published priors are corrected retrospective
artifacts, not proof of contemporaneous data availability.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np

from compare_merit import fit_network
from division_experiment import division_merit
from replay_weekly import adapt, audit_season, available_games, timestamp, weekly_groups


ROOT = Path(__file__).resolve().parents[1]
sha = lambda data: hashlib.sha256(data).hexdigest()


def compute_checkpoint(data, games, previous, config, parameters):
    """Evaluate one explicitly eligible current-season graph.

    SOR reuses the exact excluded-game-reference Python implementation, checked
    against the public JS calculator. Strength solves the same ridge normal
    equations as rankSeason, including decayed own-team history and OT handling.
    The caller alone chooses the eligible game graph.
    """
    if previous is not None and previous['season'] >= data['year']:
        raise ValueError('Historical strength prior must precede the target season')
    ordered = dict(data, teams=sorted(data['teams'], key=lambda team: team['id']))
    games = sorted(games, key=lambda game: game['id'])
    network = fit_network(adapt(ordered, games))
    sor = {row['id']: row for row in division_merit(network, tuple(parameters[key] for key in
           ('slope', 'homeLogOdds', 'divisionLogOdds')))}
    ids = {team['id']: index for index, team in enumerate(network['teams'])}
    size = len(ids)
    ridge = config['ridge']
    matrix = np.eye(size) * ridge
    previous_rows = {row['id']: row for row in (previous or {}).get('ratings', [])}
    gap = data['year'] - previous['season'] if previous is not None else 0
    prior = np.array([previous_rows.get(team['id'], {}).get('strength', 0) *
                     config['retention'] ** gap for team in network['teams']])
    rhs = ridge * prior
    counts = np.zeros(size, dtype=int)
    wins = np.zeros(size, dtype=int)
    losses = np.zeros(size, dtype=int)
    for game in games:
        a, b = ids[game['home']], ids[game['away']]
        margin = game['homePoints'] - game['awayPoints']
        outcome = int(np.sign(margin))
        base = outcome if game.get('regulationMargin') == 0 else margin
        target = config['marginCap'] * np.tanh(base / config['marginCap'])
        target -= 0 if game['neutral'] else config['homeAdvantage']
        matrix[a, a] += 1; matrix[b, b] += 1
        matrix[a, b] -= 1; matrix[b, a] -= 1
        rhs[a] += target; rhs[b] -= target
        counts[a] += 1; counts[b] += 1
        if outcome:
            wins[a if outcome > 0 else b] += 1
            losses[b if outcome > 0 else a] += 1
    strength = np.linalg.solve(matrix, rhs)
    residual = float(np.max(np.abs(matrix @ strength - rhs)))
    if residual > 1e-9:
        raise ValueError('Historical strength normal equations failed to reconcile')
    rows = {}
    for team in network['teams']:
        if team['division'] != 'fbs':
            continue
        i = ids[team['id']]
        achievement = sor.get(team['id'])
        rows[team['id']] = dict(id=team['id'], team=team['name'], division='fbs',
            conference=team.get('conference'), games=int(counts[i]), wins=int(wins[i]), losses=int(losses[i]),
            # JS returns a literal tail=1 before convolution for wins=0.
            # Avoid tiny negative/positive zero-win scores from roundoff in the
            # research helper's full probability distribution.
            sor=float(achievement['sor']) if achievement and wins[i] else 0.,
            colley=float(network['ratings'][i]), strength=float(strength[i]),
            preseasonStrength=float(prior[i]))
    return dict(rows=rows, maximumStrengthNormalResidual=residual)


def replay(data, previous, config, parameters, include_final=False):
    """Common parent competition-week cutoffs plus a full 24h result buffer."""
    audit_season(data)
    checkpoints = []; seen = set()
    for (kind, week), targets in weekly_groups(data):
        cutoff = min(timestamp(game['startDate']) for game in targets)
        games = available_games(data, seen, cutoff)
        eligible = {game['id'] for game in games}
        target_ids = {game['id'] for game in targets}
        if eligible & target_ids:
            raise ValueError('A target-week result entered its own ranking')
        if any(timestamp(game['startDate']) + 86400 > cutoff for game in games):
            raise ValueError('A game without the result availability buffer entered a ranking')
        fitted = compute_checkpoint(data, games, previous, config, parameters)
        checkpoints.append(dict(block=f'{data["year"]}:{kind}:{week}', kind=kind, week=week,
            label=f'before {kind} week {week}', cutoff=datetime.fromtimestamp(cutoff, timezone.utc).isoformat(),
            eligibleGameIds=sorted(eligible), targetGameIds=sorted(target_ids), targets=targets, **fitted))
        seen.update(target_ids)
    if include_final and seen:
        cutoff = max(timestamp(game['startDate']) for game in data['games'] if game['completed']) + 86400
        games = available_games(data, seen, cutoff)
        checkpoints.append(dict(block=f'{data["year"]}:final', kind='final', week=None,
            label='end of available source season', cutoff=datetime.fromtimestamp(cutoff, timezone.utc).isoformat(),
            eligibleGameIds=[game['id'] for game in games], targetGameIds=[], targets=[],
            **compute_checkpoint(data, games, previous, config, parameters)))
    return checkpoints


def replay_year(year, include_final=False):
    # The repaired parent is also the source of normalized Performance game
    # identities and competition weeks. Mixing the base archive here would
    # silently omit added FCS context and move some historical cutoffs.
    source_path = ROOT / f'research/datasets/fcs-coverage-v1/seasons/{year}.json'
    base_source_path = ROOT / f'data/seasons/{year}.json'
    prior_path = ROOT / f'data/snapshots/{year - 1}.json'
    config_path = ROOT / 'data/model.json'
    policy_path = ROOT / 'data/publication-model.json'
    raw, prior_raw, config_raw, policy_raw = [path.read_bytes() for path in
                                             (source_path, prior_path, config_path, policy_path)]
    data, previous, config, policy = [json.loads(value) for value in
                                      (raw, prior_raw, config_raw, policy_raw)]
    if data['year'] != year or previous['season'] != year - 1:
        raise ValueError('Stored source/prior years do not match the requested replay')
    if previous['config'] != config:
        raise ValueError('Stored historical strength prior uses different model settings')
    checkpoints = replay(data, previous, config, policy['parameters'], include_final)
    audit = audit_season(data)
    audit.update(priorSeason=previous['season'], checkpointCount=len(checkpoints),
        maximumStrengthNormalResidual=max(point['maximumStrengthNormalResidual'] for point in checkpoints),
        targetExcludedAtEveryCheckpoint=all(not set(point['targetGameIds']) & set(point['eligibleGameIds']) for point in checkpoints),
        sourceCalls=0, limitations=[
            'Corrected retrospective source, not contemporaneously saved game-result availability.',
            'Current-season graph uses repaired fcs-coverage-v1 parent, identical to Performance timing context.',
            'Whole parent competition-week exclusion and a 24h kickoff buffer are conservative timing proxies.',
            'Previous own-team Strength is retained exactly as production; SOR has no historical team credit.',
            'Stored prior snapshot was generated from the production archive chain; older archive incompleteness remains.',
            'Current frozen SOR parameters were selected with previously inspected historical evidence; no untouched claim.'
        ])
    paths = (source_path, base_source_path, prior_path, config_path, policy_path,
             Path(__file__), ROOT / 'research/compare_merit.py', ROOT / 'research/division_experiment.py',
             ROOT / 'src/engine.js', ROOT / 'research/lib/division_candidate.mjs')
    return dict(year=year, checkpoints=checkpoints, sourceSha256=sha(raw),
        provenance={str(path.relative_to(ROOT)): sha(path.read_bytes()) for path in paths}, audit=audit)
