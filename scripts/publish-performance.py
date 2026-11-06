"""Publish a separate, derived-only experimental Performance snapshot.

Render only reads the resulting JSON. The optional weekly collector makes one
CFBD request in CI; cached research inputs can be published without any request.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'research'))
from adaptive_performance_model import fit_adaptive_performance
from advanced_performance_ingest import normalize_advanced


class PublicationError(ValueError):
    """A safe, user-readable publication rejection."""


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def timestamp(value):
    if not isinstance(value, str):
        raise PublicationError('A dated primary snapshot is required')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise PublicationError('Primary snapshot timestamp is invalid') from exc
    if parsed.tzinfo is None:
        raise PublicationError('Primary snapshot timestamp needs a timezone')
    return parsed


def snapshot_context(snapshot):
    """Recover only the primary snapshot's exact completed-game graph."""
    if (not isinstance(snapshot, dict) or type(snapshot.get('season')) is not int or
            snapshot.get('source', {}).get('provider') != 'cfbd' or
            not re.fullmatch(r'[a-f0-9]{64}', str(snapshot.get('snapshotHash', '')))):
        raise PublicationError('Performance requires the full dated CFBD primary snapshot')
    timestamp(snapshot.get('asOf'))
    raw_teams = snapshot.get('ratings')
    if not isinstance(raw_teams, list) or not raw_teams:
        raise PublicationError('Primary snapshot opponent evidence is missing')
    config = snapshot.get('config', {})
    cap, home_advantage = config.get('marginCap'), config.get('homeAdvantage')
    if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in [cap, home_advantage]):
        raise PublicationError('Primary venue-recovery settings are invalid')
    teams, occurrences = {}, {}
    for row in raw_teams:
        identity = row.get('id')
        if (not isinstance(identity, str) or not identity or identity in teams or
                not isinstance(row.get('name'), str) or not isinstance(row.get('division'), str) or
                not isinstance(row.get('contributions'), list) or row.get('games') != len(row['contributions'])):
            raise PublicationError('Primary team identity or game evidence is invalid')
        teams[identity] = {k: row.get(k) for k in ['id', 'name', 'division', 'conference']}
        for game in row['contributions']:
            game_id = game.get('gameId')
            if not isinstance(game_id, str) or not game_id:
                raise PublicationError('Primary game identity is invalid')
            occurrences.setdefault(game_id, []).append((identity, game))
    games = []
    for identity, pair in sorted(occurrences.items()):
        if len(pair) != 2:
            raise PublicationError('Primary game evidence is not paired')
        (a, left), (b, right) = pair
        margin, adjusted = left.get('finalMargin'), left.get('adjustedMargin')
        if (a == b or left.get('opponentId') != b or right.get('opponentId') != a or
                type(margin) is not int or right.get('finalMargin') != -margin or
                type(adjusted) not in (int, float) or not math.isfinite(adjusted) or
                type(right.get('adjustedMargin')) not in (int, float) or
                abs(adjusted+right['adjustedMargin']) > 1e-8):
            raise PublicationError('Primary game participants or margins disagree')
        outcome = (margin > 0)-(margin < 0)
        venues = {venue for base in {margin, outcome} for venue in [-1, 0, 1]
                  if abs(cap*math.tanh(base/cap)-venue*home_advantage-adjusted) < 1e-8}
        if len(venues) != 1:
            raise PublicationError('Primary game venue is ambiguous')
        venue = venues.pop()
        home, away = (a, b) if venue >= 0 else (b, a)
        games.append(dict(id=identity, home=home, away=away, neutral=venue == 0,
                          completed=True, startDate=None, week=None, seasonType=None,
                          outcome=outcome if home == a else -outcome))
    if type(snapshot.get('gamesUsed')) is not int or len(games) != snapshot['gamesUsed']:
        raise PublicationError('Primary game count does not match paired evidence')
    fbs = {t['id'] for t in teams.values() if t['division'] == 'fbs'}
    rows = snapshot.get('rankings')
    if (not isinstance(rows, list) or len(rows) != len(fbs) or
            {r.get('id') for r in rows} != fbs or snapshot.get('fbsTeams') != len(fbs)):
        raise PublicationError('Primary FBS population does not match its rankings')
    return dict(teams=list(teams.values()), games=games,
                source=dict(kind='Exact primary completed-game graph', snapshotHash=snapshot['snapshotHash']))


def context_with_season(snapshot, season):
    """Validate dates/identity from a CFBD season without widening the cutoff."""
    context = snapshot_context(snapshot)
    if (not isinstance(season, dict) or season.get('year') != snapshot['season'] or
            season.get('source', {}).get('provider') != 'cfbd' or
            not isinstance(season.get('games'), list) or not isinstance(season.get('teams'), list)):
        raise PublicationError('Weekly Performance context must be the matching normalized CFBD season')
    teams = {str(t.get('id')): t for t in season['teams']}
    if len(teams) != len(season['teams']):
        raise PublicationError('Normalized season team identities are duplicated')
    for team in context['teams']:
        other = teams.get(team['id'])
        if not other or any(other.get(k) != team.get(k) for k in ['name', 'division']):
            raise PublicationError('Normalized season membership differs from the primary snapshot')
    records = {}
    for game in season['games']:
        identity = str(game.get('id'))
        if identity in records:
            raise PublicationError('Normalized season game identities are duplicated')
        records[identity] = game
    cutoff = timestamp(snapshot['asOf'])
    for game in context['games']:
        record = records.get(game['id'])
        if (not record or record.get('completed') is not True or
                {record.get('home'), record.get('away')} != {game['home'], game['away']} or
                record.get('neutral') is not game['neutral'] or
                (not game['neutral'] and record.get('home') != game['home']) or
                any(type(record.get(k)) is not int or record[k] < 0 for k in ['homePoints', 'awayPoints'])):
            raise PublicationError('Normalized season disagrees with an eligible primary game')
        margin = record['homePoints']-record['awayPoints']
        if record['home'] != game['home']:
            margin = -margin
        if (margin > 0)-(margin < 0) != game['outcome'] or timestamp(record.get('startDate')) > cutoff:
            raise PublicationError('Normalized season outcome or kickoff disagrees with the primary cutoff')
        for field in ['startDate', 'week', 'seasonType']:
            game[field] = record.get(field)
    # Extra scheduled or newer completed season games cannot widen this graph.
    return context


def validate_policy(policy, season):
    if (not isinstance(policy, dict) or not isinstance(policy.get('id'), str) or
            policy.get('status') != 'experimental' or policy.get('season') != season or
            not isinstance(policy.get('parameters'), dict)):
        raise PublicationError('Experimental Performance policy is invalid for this season')
    required = {'ridge', 'contextPriorStrength', 'homePrior', 'divisionPrior'}
    p = policy['parameters']
    if (set(p) != required or any(type(p[k]) not in (int, float) or not math.isfinite(p[k]) for k in required) or
            p['ridge'] <= 0 or p['contextPriorStrength'] <= 0):
        raise PublicationError('Performance model parameters must be explicit finite values')
    for name, expected in policy.get('implementationSha256', {}).items():
        path = (ROOT/name).resolve()
        if ROOT not in path.parents or sha(path.read_bytes()) != expected:
            raise PublicationError('Pinned Performance implementation changed; version its policy')
    if policy.get('candidateProtocolSha256'):
        path = (ROOT/policy.get('candidateProtocolPath', '')).resolve()
        if ROOT not in path.parents or not path.is_file() or sha(path.read_bytes()) != policy['candidateProtocolSha256']:
            raise PublicationError('Pinned Performance selection protocol changed; version its policy')


def build_performance(snapshot, rows, policy, source, *, context=None, generated_at=None):
    validate_policy(policy, snapshot.get('season'))
    baseline = snapshot_context(snapshot)
    if context is not None:
        def identities(value):
            return {g['id']: (frozenset([g['home'], g['away']]), None if g['neutral'] else g['home'], g['neutral'])
                    for g in value['games']}
        if identities(context) != identities(baseline):
            raise PublicationError('Performance context differs from the exact primary graph')
        def membership(value):
            return {str(t['id']): (t['name'], t['division']) for t in value['teams']}
        if membership(context) != membership(baseline):
            raise PublicationError('Performance context membership differs from the primary snapshot')
    context = context if context is not None else baseline
    normalized = normalize_advanced(rows, context, snapshot['season'])
    audit = normalized['audit']
    expected = audit['completedFbsInvolvingContextGames']
    if (expected <= 0 or audit['expectedFbsInvolvingGames'] != expected or
            audit['acceptedFbsInvolvingGames'] != expected or
            audit['sourceFbsTeams'] != snapshot['fbsTeams']):
        raise PublicationError('Complete matching FBS advanced-stat coverage is required; preserving the previous Performance snapshot')
    if not isinstance(source, dict) or not re.fullmatch(r'[a-f0-9]{64}', str(source.get('sha256', ''))):
        raise PublicationError('Performance source checksum is required')
    observations = [dict(gameId=g['id'], teamId=g[side], opponentId=g[other],
                         rate=g['stats'][side]['rate'], plays=g['stats'][side]['plays'],
                         venue=0 if g['neutral'] else sign)
                    for g in normalized['games'] for side, other, sign in [('home', 'away', 1), ('away', 'home', -1)]]
    fitted = fit_adaptive_performance(normalized['teams'], observations, policy['parameters'])
    measured = [t for t in fitted['rows'] if t['measuredGames']]
    if not measured or fitted['maxExplanationReconciliationError'] > 1e-9:
        raise PublicationError('Performance scores did not reconcile')
    reference = sum(t['rating'] for t in measured)/len(measured)
    rankings = []
    team_names = {t['id']: t['name'] for t in normalized['teams']}
    for team in fitted['rows']:
        coverage = audit['teamCoverage'][team['id']]
        explanation = copy.deepcopy(team['explanation'])
        for game in explanation['gameContributions']:
            game['opponentName'] = team_names[game['opponentId']]
        explanation['fbsReferenceAdjustment'] = -reference
        explanation['reconstructedScore'] = 100*(explanation['reconstructedRating']-reference) if team['measuredGames'] else None
        score = 100*(team['rating']-reference) if team['measuredGames'] else None
        if score is not None and abs(score-explanation['reconstructedScore']) > 1e-9:
            raise PublicationError('Displayed Performance score did not reconcile')
        rankings.append(dict(id=team['id'], name=team['team'], rank=team['rank'], score=score,
            measuredGames=team['measuredGames'], expectedGames=coverage['expectedGames'],
            offensiveSuccessRate=team['rawOffenseRate'], defensiveSuccessRateAllowed=team['rawDefenseRateAllowed'],
            provisional=team['provisional'], minOpponentMeasuredGames=team['minOpponentMeasuredGames'],
            connectedTeams=team['connectedTeams'], explanation=explanation))
    generated_at = generated_at or utc_now()
    timestamp(generated_at)
    payload = dict(season=snapshot['season'], asOf=snapshot['asOf'], baseSnapshotHash=snapshot['snapshotHash'],
        generatedAt=generated_at, modelPublishedAt=generated_at, status='experimental',
        method=dict(id=policy['id'], name='Scrimmage consistency', version=policy.get('version'),
                    units='Percentage points above the measured FBS mean',
                    configuration=copy.deepcopy(policy['parameters']),
                    definition='Opponent-adjusted net success rate on provider-covered plays; one weight per measured game',
                    sourceModel=fitted['modelId'], scope='Experimental scrimmage consistency, not complete team performance'),
        limitations=copy.deepcopy(policy.get('limitations', [])), validation=copy.deepcopy(policy.get('validation', {})),
        coverage=dict(measuredFbsTeams=fitted['measuredFbsTeams'], sourceFbsTeams=fitted['sourceFbsTeams'],
            measuredFbsGames=audit['acceptedFbsInvolvingGames'], eligibleFbsGames=expected,
            measuredFcsContextGames=audit['acceptedByDivisionPair'].get('fcs-fcs', 0),
            eligibleFcsContextGames=audit['expectedByDivisionPair'].get('fcs-fcs', 0)),
        source={key: source.get(key) for key in ['endpoint', 'fetchedAt', 'loadedAt', 'sha256', 'requestCount', 'remainingCalls']},
        reference=dict(measuredFbsMean=reference, teamEffects='Current-season only; no inherited team ranking points'),
        context=dict(homeRate=fitted['contextFit']['homeRate'], divisionRate=fitted['contextFit']['divisionRate']),
        rankings=rankings)
    payload['method']['priorSeason'] = policy.get('priorSeason')
    payload['method']['priorProvenance'] = copy.deepcopy(policy.get('priorSource'))
    payload['method']['researchFingerprint'] = policy.get('researchFingerprint')
    payload['method']['selectionProtocolSha256'] = policy.get('candidateProtocolSha256')
    stable = copy.deepcopy(payload)
    for key in ['generatedAt', 'modelPublishedAt']:
        stable.pop(key)
    for key in ['fetchedAt', 'loadedAt', 'requestCount', 'remainingCalls']:
        stable['source'].pop(key, None)
    payload['publicationHash'] = sha(canonical(stable))
    return payload


def atomic_publication(path, payload):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.'+path.name+'-', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(json.dumps(payload, indent=2, allow_nan=False).encode()+b'\n')
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def publish_to_file(snapshot, rows, policy, source, output, **options):
    # Build/validate everything before replacing the existing public artifact.
    payload = build_performance(snapshot, rows, policy, source, **options)
    atomic_publication(output, payload)
    return payload


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PublicationError('CFBD redirect rejected; no retry was made')


def fetch_source(year, api_key, *, opener=None, cache_dir=None):
    if type(year) is not int or not 2004 <= year <= 2100:
        raise PublicationError('Performance source season is invalid')
    if not isinstance(api_key, str) or not api_key:
        raise PublicationError('CFBD_API_KEY is missing from the private CI environment')
    endpoint = f'https://api.collegefootballdata.com/stats/game/advanced?year={year}&seasonType=both&excludeGarbageTime=false'
    request = Request(endpoint, headers={'Authorization': 'Bearer '+api_key, 'User-Agent': 'FBS-Intelligence-Performance/1'})
    opener = opener if opener is not None else build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=60) as response:
            raw = response.read(64*1024*1024+1)
            if len(raw) > 64*1024*1024:
                raise PublicationError('CFBD Performance response exceeded the expected size; no retry was made')
            quota = response.headers.get('x-calllimit-remaining')
            remaining = int(quota) if quota is not None and re.fullmatch(r'\d+', quota) else None
    except HTTPError as exc:
        raise PublicationError(f'CFBD returned HTTP {exc.code}; no retry was made') from None
    except PublicationError:
        raise
    except Exception:
        raise PublicationError('CFBD Performance request failed; no retry was made') from None
    try:
        rows = json.loads(raw)
    except (ValueError, UnicodeError):
        raise PublicationError('CFBD Performance response was not valid JSON; no retry was made') from None
    if not isinstance(rows, list):
        raise PublicationError('CFBD Performance response was not an array; no retry was made')
    checksum = sha(raw)
    if cache_dir is not None:
        folder = Path(cache_dir); folder.mkdir(parents=True, exist_ok=True)
        (folder/f'{year}-{checksum}.json').write_bytes(raw)
    return rows, dict(endpoint=endpoint, fetchedAt=utc_now(), sha256=checksum, requestCount=1, remainingCalls=remaining)


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
        snapshot = json.loads(args.snapshot.read_bytes()); policy = json.loads(args.config.read_bytes())
        validate_policy(policy, snapshot.get('season'))
        context = context_with_season(snapshot, json.loads(args.season.read_bytes())) if args.season else snapshot_context(snapshot)
        if args.source:
            raw = args.source.read_bytes(); rows = json.loads(raw); fetched_at = None
            if args.source_manifest:
                manifest = json.loads(args.source_manifest.read_bytes())
                candidates = [f for f in manifest.get('files', []) if f.get('year') == snapshot['season'] and f.get('rawSha256') == sha(raw)]
                if len(candidates) != 1:
                    raise PublicationError('Cached Performance source is not pinned by its manifest')
                fetched_at = candidates[0].get('completedAt')
            source = dict(endpoint=f'https://api.collegefootballdata.com/stats/game/advanced?year={snapshot["season"]}&seasonType=both&excludeGarbageTime=false',
                          fetchedAt=fetched_at, loadedAt=utc_now(), sha256=sha(raw), requestCount=0)
        else:
            if args.source_manifest:
                raise PublicationError('--source-manifest requires --source')
            rows, source = fetch_source(snapshot['season'], os.environ.get('CFBD_API_KEY'), cache_dir=ROOT/'research/cache/weekly-performance')
        payload = publish_to_file(snapshot, rows, policy, source, args.output, context=context)
        print(json.dumps(dict(status='published-experimental', season=payload['season'],
                              teams=payload['coverage']['measuredFbsTeams'], games=payload['coverage']['measuredFbsGames'],
                              cfbdCalls=source['requestCount'], publicationHash=payload['publicationHash'])))
        return 0
    except PublicationError as exc:
        print('Performance update rejected: '+str(exc), file=sys.stderr)
    except Exception:
        print('Performance update failed; the previous public artifact was preserved.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
