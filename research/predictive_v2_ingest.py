"""Offline recorded-count inputs for the original predictive challenger.

Every completed parent outcome remains in ``games`` even when its statistics
are unavailable. Counts come from the pinned ESPN/Sportsdataverse box archive;
identities, dates, results and subdivisions come from the repaired CFBD parent.
No provider efficiency average, rating, PPA value or success flag is consumed.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import csv
from datetime import datetime
import hashlib
import io
import json
from pathlib import Path
import re


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE = HERE / 'cache/performance'
PARENTS = HERE / 'datasets/fcs-coverage-v1/seasons'
YEARS = (2014, 2015, 2016, 2017, 2018, 2019, 2023, 2024, 2025)
FEATURES = ('ypp', 'passingYpp', 'rushingYpp', 'completionRate', 'firstDownRate',
            'thirdDownRate', 'fourthDownRate', 'turnoverRate', 'penaltyYardsPerPlay')
GROUPS = {'efficiency': FEATURES[:4], 'sustain': FEATURES[4:7], 'mistakes': FEATURES[7:]}
MISSING = {'', 'NA', 'NaN', 'nan', 'null', 'None'}
SHA = lambda raw: hashlib.sha256(raw).hexdigest()


class InputError(ValueError):
    """Unusable identity, source contract or recorded count."""


def _identity(value):
    if type(value) is int and value >= 0:
        return str(value)
    if isinstance(value, str) and value and value.isascii() and value.isdecimal():
        return value
    raise InputError('invalid-identity')


def _count(value, *, signed=False):
    if value is None or str(value).strip() in MISSING:
        return None
    text = str(value).strip()
    if type(value) is bool or not re.fullmatch(r'-?\d+' if signed else r'\d+', text):
        raise InputError('invalid-integer')
    return int(text)


def _pair(value, separator):
    if value is None or str(value).strip() in MISSING:
        return None, None
    match = re.fullmatch(r'(\d+)' + re.escape(separator) + r'(\d+)', str(value).strip())
    if not match:
        raise InputError('invalid-count-pair')
    return int(match[1]), int(match[2])


def parse_stats(row):
    """Rebuild nine metrics; a broken field invalidates only dependent metrics."""
    raw = {}; field_issues = {}; issues = {}; features = {}; denominators = {}

    def count(name, source, signed=False):
        try:
            value = _count(row.get(source), signed=signed)
            if value is None:
                field_issues[name] = 'missing'
        except InputError as error:
            value = None; field_issues[name] = str(error)
        raw[name] = value

    def pair(first, second, source, separator):
        try:
            one, two = _pair(row.get(source), separator)
            if one is None:
                field_issues[first] = field_issues[second] = 'missing'
        except InputError as error:
            one = two = None; field_issues[first] = field_issues[second] = str(error)
        raw[first] = one; raw[second] = two

    for name, source, signed in [
        ('yards', 'totalYards', True), ('passingYards', 'netPassingYards', True),
        ('rushingYards', 'rushingYards', True), ('rushingAttempts', 'rushingAttempts', False),
        ('firstDowns', 'firstDowns', False), ('turnovers', 'turnovers', False),
        ('fumblesLost', 'fumblesLost', False), ('interceptions', 'interceptions', False)]:
        count(name, source, signed)
    pair('completions', 'passingAttempts', 'completionAttempts', '/')
    pair('thirdDownMade', 'thirdDownAttempts', 'thirdDownEff', '-')
    pair('fourthDownMade', 'fourthDownAttempts', 'fourthDownEff', '-')
    pair('penalties', 'penaltyYards', 'totalPenaltiesYards', '-')
    pair('possessionMinutes', 'possessionRemainderSeconds', 'possessionTime', ':')
    minutes, seconds = raw['possessionMinutes'], raw['possessionRemainderSeconds']
    raw['possessionSeconds'] = minutes * 60 + seconds if minutes is not None and seconds is not None and seconds < 60 else None
    if seconds is not None and seconds >= 60:
        field_issues['possessionSeconds'] = 'invalid-possession-seconds'
    attempts, rushes = raw['passingAttempts'], raw['rushingAttempts']
    raw['plays'] = attempts + rushes if attempts is not None and rushes is not None else None

    def ratio(metric, numerator, denominator, blocked=None):
        top, bottom = raw.get(numerator), raw.get(denominator)
        denominators[metric] = bottom
        if blocked:
            features[metric] = None; issues[metric] = blocked
        elif top is None or bottom is None:
            features[metric] = None; issues[metric] = 'missing-or-invalid-count'
        elif bottom == 0:
            features[metric] = None
            issues[metric] = 'zero-opportunities' if top == 0 else 'nonzero-count-without-opportunities'
        else:
            features[metric] = top / bottom

    yard_issue = None
    if all(raw[key] is not None for key in ('yards', 'passingYards', 'rushingYards')):
        if raw['yards'] != raw['passingYards'] + raw['rushingYards']:
            yard_issue = 'yards-components-disagree'
    for numerator, denominator in [('passingYards', 'passingAttempts'), ('rushingYards', 'rushingAttempts')]:
        if raw[denominator] == 0 and raw[numerator] not in (0, None):
            yard_issue = 'nonzero-yards-without-attempts'
    ratio('ypp', 'yards', 'plays', yard_issue)
    ratio('passingYpp', 'passingYards', 'passingAttempts', yard_issue)
    ratio('rushingYpp', 'rushingYards', 'rushingAttempts', yard_issue)
    for metric, numerator, denominator in [
        ('completionRate', 'completions', 'passingAttempts'),
        ('thirdDownRate', 'thirdDownMade', 'thirdDownAttempts'),
        ('fourthDownRate', 'fourthDownMade', 'fourthDownAttempts')]:
        invalid = raw[numerator] is not None and raw[denominator] is not None and raw[numerator] > raw[denominator]
        ratio(metric, numerator, denominator, 'made-exceeds-attempts' if invalid else None)
    ratio('firstDownRate', 'firstDowns', 'plays')
    turnover_issue = None
    if all(raw[key] is not None for key in ('turnovers', 'fumblesLost', 'interceptions')):
        if raw['turnovers'] != raw['fumblesLost'] + raw['interceptions']:
            turnover_issue = 'turnover-components-disagree'
    ratio('turnoverRate', 'turnovers', 'plays', turnover_issue)
    ratio('penaltyYardsPerPlay', 'penaltyYards', 'plays')
    return dict(raw=raw, features={name: features[name] for name in FEATURES},
                denominators={name: denominators[name] for name in FEATURES},
                issues=issues, fieldIssues=field_issues)


def _parent(parent, year):
    if parent.get('year') != year:
        raise InputError('wrong-parent-season')
    teams = {}
    for team in parent['teams']:
        identity = _identity(team['id'])
        if identity in teams or not isinstance(team.get('division'), str):
            raise InputError('duplicate-or-invalid-parent-team')
        teams[identity] = dict(team, id=identity)
    games = []; identities = set()
    for game in parent['games']:
        identity = _identity(game['id'])
        if identity in identities or type(game.get('completed')) is not bool:
            raise InputError('duplicate-or-invalid-parent-game')
        identities.add(identity)
        if not game['completed']:
            continue
        home, away = _identity(game['home']), _identity(game['away'])
        if home == away or home not in teams or away not in teams or type(game.get('neutral')) is not bool:
            raise InputError('invalid-parent-participants-or-venue')
        if any(type(game.get(key)) is not int or game[key] < 0 for key in ('homePoints', 'awayPoints')):
            raise InputError('invalid-parent-final-score')
        try:
            parsed = datetime.fromisoformat(game['startDate'].replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                raise ValueError()
        except (KeyError, AttributeError, ValueError):
            raise InputError('missing-or-invalid-parent-timing') from None
        games.append(dict(game, id=identity, home=home, away=away))
    return teams, games


def normalize_season(text, year, parent):
    teams, parent_games = _parent(parent, year)
    by_game = defaultdict(list); rows = list(csv.DictReader(io.StringIO(text)))
    for row in rows:
        if _count(row.get('season')) != year:
            raise InputError('wrong-source-season')
        identity = _identity(row.get('game_id'))
        _identity(row.get('team_id'))
        by_game[identity].append(row)
    output = []; pair_reasons = Counter(); feature_issues = Counter(); neutral_flips = []
    expected_by_team = Counter(); paired_by_team = Counter(); metric_by_team = {name: Counter() for name in FEATURES}
    expected_fbs = set(); expected_d1 = set(); paired_ids = set(); metric_ids = {name: set() for name in FEATURES}
    parent_ids = {game['id'] for game in parent_games}
    for game in parent_games:
        home, away, identity = game['home'], game['away'], game['id']
        known = all(teams[team]['division'] in ('fbs', 'fcs') for team in (home, away))
        is_fbs = any(teams[team]['division'] == 'fbs' for team in (home, away))
        stats = None; problem = None
        if not known:
            problem = 'outside-known-fbs-fcs-context'
        else:
            expected_d1.add(identity)
            if is_fbs:
                expected_fbs.add(identity)
            expected_by_team.update((home, away))
            pair = by_game.get(identity, [])
            if len(pair) != 2:
                problem = 'missing-box-pair' if not pair else 'one-sided-box' if len(pair) == 1 else 'duplicate-box-rows'
            elif {row['team_id'] for row in pair} != {home, away}:
                problem = 'box-participants-disagree'
            elif {row.get('home_away') for row in pair} != {'home', 'away'}:
                problem = 'invalid-box-venue-pair'
            else:
                box_home = next(row['team_id'] for row in pair if row['home_away'] == 'home')
                if box_home != home and not game['neutral']:
                    problem = 'nonneutral-box-orientation-disagrees'
                else:
                    if box_home != home:
                        neutral_flips.append(identity)
                    mapped = {row['team_id']: row for row in pair}
                    stats = {side: parse_stats(mapped[game[side]]) for side in ('home', 'away')}
                    paired_ids.add(identity); paired_by_team.update((home, away))
                    for metric in FEATURES:
                        if all(stats[side]['features'][metric] is not None for side in ('home', 'away')):
                            metric_ids[metric].add(identity); metric_by_team[metric].update((home, away))
                    for side in ('home', 'away'):
                        feature_issues.update(f'{name}:{reason}' for name, reason in stats[side]['issues'].items())
        if problem:
            pair_reasons[problem] += 1
        output.append(dict(game, knownD1=known, stats=stats, statIssues=[] if problem is None else [problem]))
    audit = dict(sourceTeamRows=len(rows), sourceGameIds=len(by_game), parentCompletedGames=len(parent_games),
                 sourceGameIdsOutsideCompletedParent=sorted(set(by_game)-parent_ids),
                 expectedKnownD1Games=len(expected_d1), expectedFbsGames=len(expected_fbs),
                 pairedBoxGames=len(paired_ids), pairedFbsBoxGames=len(paired_ids & expected_fbs),
                 pairIssueCounts=dict(pair_reasons), featureIssueCounts=dict(feature_issues),
                 neutralOrientationDifferences=neutral_flips,
                 featureCoverage={name: dict(pairedGames=len(ids), pairedFbsGames=len(ids & expected_fbs),
                     expectedFbsGames=len(expected_fbs), missingFbsGameIds=sorted(expected_fbs-ids),
                     missingKnownD1GameIds=sorted(expected_d1-ids)) for name, ids in metric_ids.items()},
                 teamCoverage={identity: dict(expectedGames=expected_by_team[identity], pairedBoxGames=paired_by_team[identity],
                     featureGames={name: metric_by_team[name][identity] for name in FEATURES}) for identity in sorted(teams)})
    return dict(version='original-raw-count-predictive-v2-input-v1', year=year, teams=list(teams.values()), games=output,
                supportsHistoricalReplay=True, audit=audit,
                formulas={'ypp': 'totalYards/(recorded passing attempts+rushing attempts)',
                    'passingYpp': 'recorded netPassingYards/recorded passingAttempts; NOT sack-adjusted true dropbacks',
                    'rushingYpp': 'recorded rushingYards/recorded rushingAttempts; preserves source NCAA sack accounting',
                    'completionRate': 'recorded completions/passingAttempts', 'firstDownRate': 'recorded firstDowns/offense plays',
                    'thirdDownRate': 'recorded thirdDownMade/thirdDownAttempts',
                    'fourthDownRate': 'recorded fourthDownMade/fourthDownAttempts; zero attempts is unavailable, not0',
                    'turnoverRate': 'recorded team turnovers/offense plays; team events may include nonscrimmage fumbles',
                    'penaltyYardsPerPlay': 'recorded whole-team penaltyYards/offense plays; not a penalty-opportunity rate'},
                inputPolicy='Recorded raw counts only; exact stable game/team IDs and completed parent timing/results. '
                    'No provider averages, success flags, PPA/EPA/WPA/QBR, ratings, polls, recruiting or betting fields. '
                    'Defense uses the opposite offense observation. No extra sack subtraction or duplicate event bonus. '
                    'Nullable features preserve all completed parent outcomes and separate metric denominators.')


def load_year(year, *, cache_dir=CACHE, parent_dir=PARENTS, manifest_path=None):
    """Load only retained historical seasons; this function never fetches files."""
    if type(year) is not int or year not in YEARS:
        raise InputError('unsupported-or-uncached-history-year;2026-has-no-honest-parent-timing-replay')
    cache_dir, parent_dir = Path(cache_dir), Path(parent_dir)
    manifest_path = Path(manifest_path) if manifest_path else cache_dir/'manifest.json'
    manifest_raw = manifest_path.read_bytes(); manifest = json.loads(manifest_raw)
    entries = [entry for entry in manifest['files'] if entry['year'] == year]
    if len(entries) != 1:
        raise InputError('missing-or-duplicate-source-manifest-year')
    entry = entries[0]; source_path = cache_dir/f'team_box_{year}.csv'
    if entry.get('name') != source_path.name:
        raise InputError('source-manifest-name-disagrees')
    raw = source_path.read_bytes()
    if SHA(raw) != entry['sha256'] or len(raw) != entry['bytes']:
        raise InputError('cached-source-checksum-or-length-mismatch')
    parent_path = parent_dir/f'{year}.json'; parent_raw = parent_path.read_bytes()
    result = normalize_season(raw.decode('utf-8-sig'), year, json.loads(parent_raw))
    result.update(sourceSha256=SHA(raw), parentSha256=SHA(parent_raw),
                  sourceManifestSha256=SHA(manifest_raw),
                  source=dict(provider=manifest['provider'], retainedFile=source_path.name,
                              originalSource='ESPN recorded team box scores, retained through Sportsdataverse release',
                              parentSource='Repaired CFBD season-specific identities, scores, subdivision and timing',
                              metadata=entry, cfbdCalls=0))
    return result
