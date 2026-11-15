"""Publish FBS Performance and a derived FCS view with one shared source pull."""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys

BASE_PATH = Path(__file__).with_name('publish-performance.py')
BASE_SPEC = importlib.util.spec_from_file_location('frozen_performance_publisher', BASE_PATH)
base = importlib.util.module_from_spec(BASE_SPEC)
BASE_SPEC.loader.exec_module(base)

from advanced_performance_model import fit_advanced_performance

ROOT = base.ROOT
PublicationError = base.PublicationError


def fcs_rows(fitted, teams, coverage):
    by_id = {t['id']: t for t in teams}
    ratings = sorted((r for r in fitted['ratings'] if r['division'] == 'fcs'),
                     key=lambda r: (not bool(r['measuredGames']), -r['rating'], r['id']))
    measured = [r for r in ratings if r['measuredGames']]
    reference = sum(r['rating'] for r in measured)/len(measured) if measured else None
    last_distinct, rank = None, None
    rows = []
    for position, rating in enumerate(ratings, 1):
        identity = rating['id']
        count = rating['measuredGames']
        expected = coverage[identity]['expectedGames']
        if count and (last_distinct is None or abs(rating['rating']-last_distinct) > fitted['rankTolerance']):
            last_distinct, rank = rating['rating'], position
        explanation = copy.deepcopy(rating['explanation'])
        for game in explanation['gameContributions']:
            game['opponentName'] = by_id[game['opponentId']]['name']
        score = 100*(rating['rating']-reference) if count else None
        explanation['fcsReferenceAdjustment'] = -reference if reference is not None else None
        explanation['reconstructedScore'] = 100*(explanation['reconstructedRating']-reference) if count else None
        if count and abs(score-explanation['reconstructedScore']) > 1e-9:
            raise PublicationError('Displayed FCS Performance score did not reconcile')
        rows.append(dict(id=identity, name=rating['team'], conference=by_id[identity].get('conference'),
                         rank=rank if count else None, score=score, measuredGames=count, expectedGames=expected,
                         offensiveSuccessRate=rating['rawOffenseRate'], defensiveSuccessRateAllowed=rating['rawDefenseRateAllowed'],
                         provisional=rating['provisional'] or count < expected,
                         minOpponentMeasuredGames=rating['minOpponentMeasuredGames'], connectedTeams=rating['connectedTeams'],
                         explanation=explanation))
    return rows, reference, len(measured)


def build_performance(snapshot, rows, policy, source, *, context=None, generated_at=None):
    payload = base.build_performance(snapshot, rows, policy, source, context=context, generated_at=generated_at)
    baseline = base.snapshot_context(snapshot)
    if not any(t['division'] == 'fcs' for t in baseline['teams']):
        return payload
    normalized = base.normalize_advanced(rows, context if context is not None else baseline, snapshot['season'])
    observations = [dict(gameId=g['id'], teamId=g[side], opponentId=g[other],
                         rate=g['stats'][side]['rate'], plays=g['stats'][side]['plays'],
                         venue=0 if g['neutral'] else sign)
                    for g in normalized['games'] for side, other, sign in [('home', 'away', 1), ('away', 'home', -1)]]
    # Reuse the frozen adaptive fit's exact context and recover the FCS rows with
    # its original conditional solver. The frozen FBS scores stay in the payload.
    fitted = fit_advanced_performance(normalized['teams'], observations,
                                      dict(ridge=policy['parameters']['ridge'], **payload['context']))
    audit = normalized['audit']
    rankings, reference, measured = fcs_rows(fitted, baseline['teams'], audit['teamCoverage'])
    payload['fcsRankings'] = rankings
    payload['coverage'].update(measuredFcsTeams=measured, sourceFcsTeams=len(rankings),
        measuredFcsGames=sum(audit['acceptedByDivisionPair'].get(pair, 0) for pair in ('fbs-fcs', 'fcs-fcs')),
        eligibleFcsGames=sum(audit['expectedByDivisionPair'].get(pair, 0) for pair in ('fbs-fcs', 'fcs-fcs')))
    payload['reference']['measuredFcsMean'] = reference
    payload['method']['fcsUnits'] = 'Percentage points above the measured FCS mean'
    stable = {key: value for key, value in payload.items() if key not in ('generatedAt', 'modelPublishedAt', 'publicationHash')}
    stable['source'] = {key: value for key, value in payload['source'].items()
                        if key not in ('fetchedAt', 'loadedAt', 'requestCount', 'remainingCalls')}
    payload['publicationHash'] = base.sha(base.canonical(stable))
    return payload


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, default=ROOT/'published/latest.json')
    parser.add_argument('--season', type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--source-manifest', type=Path)
    parser.add_argument('--config', type=Path, default=ROOT/'data/performance-model.json')
    parser.add_argument('--output', type=Path, default=ROOT/'published/performance-latest.json')
    args = parser.parse_args(argv)
    try:
        snapshot = json.loads(args.snapshot.read_bytes())
        policy = json.loads(args.config.read_bytes())
        base.validate_policy(policy, snapshot.get('season'))
        context = base.context_with_season(snapshot, json.loads(args.season.read_bytes())) if args.season else base.snapshot_context(snapshot)
        if args.source:
            raw = args.source.read_bytes()
            rows, checksum = json.loads(raw), base.sha(raw)
            fetched_at = None
            if args.source_manifest:
                manifest = json.loads(args.source_manifest.read_bytes())
                matches = [item for item in manifest.get('files', [])
                           if item.get('year') == snapshot['season'] and item.get('rawSha256') == checksum]
                if len(matches) != 1:
                    raise PublicationError('Cached Performance source is not pinned by its manifest')
                fetched_at = matches[0].get('completedAt')
            source = dict(endpoint=f'https://api.collegefootballdata.com/stats/game/advanced?year={snapshot["season"]}&seasonType=both&excludeGarbageTime=false',
                          fetchedAt=fetched_at, loadedAt=base.utc_now(), sha256=checksum, requestCount=0)
        else:
            if args.source_manifest:
                raise PublicationError('--source-manifest requires --source')
            rows, source = base.fetch_source(snapshot['season'], os.environ.get('CFBD_API_KEY'),
                                             cache_dir=ROOT/'research/cache/weekly-performance')
        payload = build_performance(snapshot, rows, policy, source, context=context)
        base.atomic_publication(args.output, payload)
        print(json.dumps(dict(status='published-experimental', season=payload['season'],
                              teams=payload['coverage']['measuredFbsTeams'], games=payload['coverage']['measuredFbsGames'],
                              fcsTeams=payload['coverage'].get('measuredFcsTeams', 0), fcsGames=payload['coverage'].get('measuredFcsGames', 0),
                              cfbdCalls=source['requestCount'], publicationHash=payload['publicationHash'])))
        return 0
    except PublicationError as exc:
        print('Performance update rejected: '+str(exc), file=sys.stderr)
    except Exception:
        print('Performance update failed; the previous public artifact was preserved.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
