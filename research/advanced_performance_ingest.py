"""Private, offline normalization of CFBD advanced success-rate observations.

The source aggregates PPA-eligible plays even when garbage-time filtering is
disabled. A success rate is not a complete box-score play census. This module
uses no PPA values, source rankings, betting inputs, scores or prior ratings as
performance features. It performs no requests and writes no files.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import copy
import hashlib
import json
import math
from pathlib import Path


TOLERANCE = 1e-7
SUCCESS_COUNT_TOLERANCE = 1e-5


class AdvancedStatError(ValueError):
    """An observation or its identity is unsuitable for the declared metric."""


def _identity(value):
    if type(value) is int and value >= 0:
        return str(value)
    if isinstance(value, str) and value and value.isascii() and value.isdecimal():
        return value
    raise AdvancedStatError('invalid-identity')


def _rate(value):
    if type(value) not in (int, float) or not 0 <= value <= 1 or not math.isfinite(value):
        raise AdvancedStatError('invalid-or-missing-success-rate')
    return float(value)


def _plays(value):
    if type(value) is not int or value <= 0:
        raise AdvancedStatError('invalid-or-missing-play-count')
    return value


def _stat(value):
    rate, plays = _rate(value.get('successRate')), _plays(value.get('plays'))
    count = rate * plays
    if abs(count-round(count)) > SUCCESS_COUNT_TOLERANCE:
        raise AdvancedStatError('success-rate-does-not-reconstruct-integer-count')
    return dict(rate=rate, plays=plays, successes=int(round(count)))


def _context(context):
    if not isinstance(context, dict):
        raise AdvancedStatError('invalid-context')
    raw_teams, raw_games = context.get('teams'), context.get('games')
    if isinstance(raw_teams, dict):
        raw_teams = list(raw_teams.values())
    if isinstance(raw_games, dict):
        raw_games = list(raw_games.values())
    if not isinstance(raw_teams, list) or not isinstance(raw_games, list):
        raise AdvancedStatError('context-needs-teams-and-completed-games')
    teams = {}
    for raw in raw_teams:
        if not isinstance(raw, dict):
            raise AdvancedStatError('invalid-context-team')
        identity = _identity(raw.get('id'))
        if identity in teams or not isinstance(raw.get('name'), str) or not raw['name'] or not isinstance(raw.get('division'), str):
            raise AdvancedStatError('invalid-or-duplicate-context-team')
        aliases = raw.get('aliases', [])
        if not isinstance(aliases, list) or any(not isinstance(a,str) or not a for a in aliases):
            raise AdvancedStatError('invalid-explicit-team-aliases')
        teams[identity] = dict(id=identity, name=raw['name'], division=raw['division'], conference=raw.get('conference'))
        if aliases:
            teams[identity]['aliases'] = sorted(set(aliases)-{raw['name']})
    games = {}
    for raw in raw_games:
        if not isinstance(raw, dict):
            raise AdvancedStatError('invalid-context-game')
        if raw.get('completed') is False:
            continue
        if 'completed' in raw and raw['completed'] is not True:
            raise AdvancedStatError('invalid-context-completion')
        identity = _identity(raw.get('id'))
        home, away = _identity(raw.get('home')), _identity(raw.get('away'))
        if identity in games or home == away or home not in teams or away not in teams or type(raw.get('neutral')) is not bool:
            raise AdvancedStatError('invalid-or-duplicate-context-game')
        games[identity] = dict(id=identity, home=home, away=away, neutral=raw['neutral'], completed=True,
                               startDate=raw.get('startDate'), week=raw.get('week'), seasonType=raw.get('seasonType'))
    return teams, games


def read_context(year):
    """Load repaired completed histories, or the saved 2026 outcome graph.

    The 2026 graph has no recovered kickoff/week fields, so those stay null.
    It supports a current illustration, never a claimed 2026 pregame replay.
    """
    if type(year) is not int or not 2014 <= year <= 2026:
        raise AdvancedStatError('unsupported-context-year')
    from performance_ingest import load_context
    loaded = load_context(year)
    # The two providers share stable ESPN team IDs. Only an exact ID link to the
    # already saved CFBD graph may authorize a different display name. There is
    # no fuzzy alias search or extra roster request, and the source is pinned.
    path = Path(__file__).resolve().parents[1]/'published/latest.json'
    raw = path.read_bytes(); snapshot = json.loads(raw)
    if snapshot.get('source',{}).get('provider') != 'cfbd':
        raise AdvancedStatError('alias-source-must-be-cfbd')
    canonical = {str(t['id']):t['name'] for t in snapshot['ratings']}
    teams=[]
    for identity, team in loaded['teams'].items():
        item=copy.deepcopy(team); alias=canonical.get(str(identity))
        if alias and alias!=item['name']:
            item['aliases']=sorted(set(item.get('aliases',[]))|{alias})
        teams.append(item)
    return dict(teams=teams,
                games=[{**g, 'completed': True} for g in loaded['games'].values()],
                source=copy.deepcopy(loaded['source']),
                aliasSource={'path':'published/latest.json','sha256':hashlib.sha256(raw).hexdigest(),
                             'snapshotHash':snapshot.get('snapshotHash'),
                             'policy':'Exact stable team ID links only; additional name from the saved CFBD graph'})


def normalize_advanced(rows, context, year):
    """Join exact game IDs and reciprocal canonical names, keeping whole pairs.

    Context contains completed games; an explicit completed=False is excluded.
    Unknown/D2 divisions are audited and excluded, never reclassified as FCS.
    Missing/invalid rate or play fields exclude the pair rather than become zero.
    Only the two offensive success rates and their play counts become features.
    """
    if not isinstance(rows, list) or type(year) is not int:
        raise AdvancedStatError('rows-must-be-array-and-year-integer')
    teams, all_games = _context(context)
    known = {identity: t for identity, t in teams.items() if t['division'] in ('fbs', 'fcs')}
    expected = {identity: g for identity, g in all_games.items() if g['home'] in known and g['away'] in known}
    expected_counts = Counter(i for g in expected.values() for i in (g['home'], g['away']))
    by_game, blocked = defaultdict(list), defaultdict(set)
    malformed_rows = wrong_season_rows = 0
    for row in rows:
        if not isinstance(row, dict):
            malformed_rows += 1
            continue
        try:
            identity = _identity(row.get('gameId'))
        except AdvancedStatError:
            malformed_rows += 1
            continue
        by_game[identity].append(row)
        if type(row.get('season')) is not int or row['season'] != year:
            wrong_season_rows += 1
            blocked[identity].add('wrong-season')
        if any(not isinstance(row.get(k), str) or not row[k] for k in ('team', 'opponent')):
            malformed_rows += 1
            blocked[identity].add('invalid-participant-name')
    output, excluded, alias_joins = [], [], []
    alias_joined_rows = 0
    for identity, g in sorted(expected.items()):
        reasons = set(blocked[identity])
        pair = by_game.get(identity, [])
        if len(pair) != 2:
            reasons.add('missing-pair' if not pair else 'one-team-only' if len(pair) == 1 else 'duplicate-or-extra-rows')
        participants = [known[g['home']], known[g['away']]]
        names=[{team['name'],*team.get('aliases',[])} for team in participants]
        matched = [[r for r in pair if isinstance(r.get('team'),str) and isinstance(r.get('opponent'),str)
                    and r['team'] in names[i] and r['opponent'] in names[1-i]]
                   for i in (0,1)]
        if names[0]&names[1]:
            reasons.add('ambiguous-context-participant-names')
        if len(pair) == 2 and any(len(found) != 1 for found in matched):
            reasons.add('exact-participant-names-disagree-or-ambiguous')
        stats = None
        if not reasons:
            paired = [found[0] for found in matched]
            try:
                own, defense = [], []
                for row in paired:
                    if not isinstance(row.get('offense'), dict) or not isinstance(row.get('defense'), dict):
                        raise AdvancedStatError('missing-offense-or-defense')
                    own.append(_stat(row['offense']))
                    defense.append(_stat(row['defense']))
                for i in (0, 1):
                    opposite = defense[1-i]
                    if own[i]['plays'] != opposite['plays'] or not math.isclose(own[i]['rate'], opposite['rate'], rel_tol=TOLERANCE, abs_tol=TOLERANCE):
                        raise AdvancedStatError('offense-defense-mirror-disagreement')
                stats = dict(home=own[0], away=own[1])
            except AdvancedStatError as error:
                reasons.add(str(error))
        if reasons:
            excluded.append(dict(id=identity, reasons=sorted(reasons)))
        else:
            output.append({**g, 'stats': stats})
            for i, found in enumerate(matched):
                row=found[0];team=participants[i]
                if row['team']!=team['name'] or row['opponent']!=participants[1-i]['name']:
                    alias_joined_rows+=1
                if row['team']!=team['name']:
                    alias_joins.append(dict(gameId=identity,teamId=team['id'],canonicalName=team['name'],sourceName=row['team']))
    accepted = {g['id'] for g in output}
    counts = Counter(i for g in output for i in (g['home'], g['away']))
    group = lambda g: '-'.join(sorted(known[g[k]]['division'] for k in ('home', 'away')))
    fbs_game = lambda g: any(known[g[k]]['division'] == 'fbs' for k in ('home', 'away'))
    team_coverage = {i: dict(name=t['name'], division=t['division'], expectedGames=expected_counts[i],
                             statGames=counts[i], missingGames=expected_counts[i]-counts[i])
                     for i, t in sorted(known.items())}
    ineligible = [dict(id=i, participants=[teams[g[k]]['division'] for k in ('home', 'away')],
                       involvesFbs=any(teams[g[k]]['division'] == 'fbs' for k in ('home', 'away')))
                  for i, g in sorted(all_games.items()) if i not in expected]
    audit = dict(inputRows=len(rows), inputGameIds=len(by_game), malformedRows=malformed_rows,
                 wrongSeasonRows=wrong_season_rows, expectedKnownD1Games=len(expected),
                 completedFbsInvolvingContextGames=sum(any(teams[g[k]]['division'] == 'fbs' for k in ('home', 'away')) for g in all_games.values()),
                 expectedFbsInvolvingGames=sum(fbs_game(g) for g in expected.values()),
                 acceptedKnownD1Games=len(output), acceptedFbsInvolvingGames=sum(fbs_game(g) for g in output),
                 expectedByDivisionPair=dict(sorted(Counter(group(g) for g in expected.values()).items())),
                 acceptedByDivisionPair=dict(sorted(Counter(group(g) for g in output).items())),
                 missingExpectedGameIds=sorted(set(expected)-accepted),
                 missingFbsGameIds=sorted(i for i, g in expected.items() if fbs_game(g) and i not in accepted),
                 excluded=excluded, exclusionReasons=dict(sorted(Counter(reason for item in excluded for reason in item['reasons']).items())),
                 outsideContextGameIds=sorted(set(by_game)-set(all_games)), excludedContextGames=ineligible,
                 ineligibleContextRowGameIds=sorted(set(by_game)&(set(all_games)-set(expected))),
                 teamCoverage=team_coverage, sourceFbsTeams=sum(t['division']=='fbs' for t in known.values()),
                 representedFbsTeams=sum(t['division']=='fbs' and counts[i]>0 for i,t in known.items()),
                 completeFbsTeams=sum(t['division']=='fbs' and expected_counts[i]>0 and counts[i]==expected_counts[i] for i,t in known.items()),
                 aliasJoinedRows=alias_joined_rows,aliasJoins=alias_joins,
                 mirrorTolerance=TOLERANCE,successCountTolerance=SUCCESS_COUNT_TOLERANCE)
    return dict(schemaVersion=1, datasetVersion='performance-advanced-success-v1', year=year,
                teams=[known[i] for i in sorted(known)], games=output, audit=audit,
                outcomeReference=copy.deepcopy(context.get('source', {})),
                aliasSource=copy.deepcopy(context.get('aliasSource', {})),
                fieldDefinition={'rate':'CFBD offense.successRate on provider PPA-eligible plays',
                                 'plays':'CFBD offense.plays; not reconstructed box-score plays',
                                 'successes':'Rate times plays must reconstruct an integer within 1e-5; original rate is preserved. Failing pairs are excluded, not repaired.'},
                inputPolicy='Exact completed-game ID plus reciprocal canonical names or explicitly provided ID-linked aliases; paired valid success rates and positive play counts; integer-success and offense/defense mirror checks. No PPA values, polls, betting, scores or prior ratings are model features. Missing is unavailable, not zero.',
                limitations=['The provider gates observations on non-null PPA even when excludeGarbageTime=false; these are not every box-score scrimmage play.',
                             'A numeric zero does not independently certify the upstream opportunity definition. Source success-rate definitions/provenance must be audited separately.',
                             '2026 saved-graph kickoff/week fields may be null; no current-year pregame replay can be inferred from those missing fields.'])
