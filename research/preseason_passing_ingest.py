"""Normalize locally cached public ESPN player boxes for preseason research.

The caller owns feature cutoff enforcement. A season's completed player boxes
cannot supply that same season's preseason roster, starters or performance.
This script makes no requests and only writes in the private research cache.
"""
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re


HERE = Path(__file__).resolve().parent
CACHE = HERE / 'cache/preseason-player'
FIELDS = ('completions', 'attempts', 'yards', 'touchdowns', 'interceptions')
COUNT_COLUMNS = ('passingYards', 'passingTouchdowns', 'interceptions')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')


def passing_counts(row):
    if not row['completions/passingAttempts']:
        if row.get('stat_1'):
            raise ValueError('unverified-positional-stat-columns')
        raise ValueError('missing-named-completions-attempts')
    pair = re.fullmatch(r'([0-9]+)/([0-9]+)', row['completions/passingAttempts'])
    counts = [row[key] for key in COUNT_COLUMNS]
    if not pair or not re.fullmatch(r'-?[0-9]+', counts[0]) or any(
            not re.fullmatch(r'[0-9]+', x) for x in counts[1:]):
        raise ValueError('invalid-or-missing-passing-count')
    completions, attempts = map(int, pair.groups())
    yards, touchdowns, interceptions = map(int, counts)
    if completions > attempts or touchdowns > completions or interceptions > attempts-completions:
        raise ValueError('inconsistent-passing-counts')
    if completions == 0 and yards != 0:
        raise ValueError('yards-without-completion')
    return dict(zip(FIELDS, (completions, attempts, yards, touchdowns, interceptions)))


def normalize_season(source):
    year = source['year']
    path = CACHE / source['name']
    raw = path.read_bytes()
    if len(raw) != source['size'] or digest(raw) != source['sha']:
        raise ValueError(f'Player box archive checksum mismatch for {year}')
    reference = HERE / f'datasets/fcs-coverage-v1/seasons/{year}.json'
    reference_bytes = reference.read_bytes()
    context = json.loads(reference_bytes)
    teams = {team['id']: team for team in context['teams']}
    games = {game['id']: game for game in context['games'] if game['completed']}
    if len(games) != sum(game['completed'] for game in context['games']):
        raise ValueError(f'Duplicate completed game ID in {year} reference')
    sides = defaultdict(dict)
    invalid_sides = set()
    reasons = Counter()
    source_rows = 0
    with gzip.open(path, 'rt', encoding='utf-8-sig', newline='') as stream:
        records = csv.DictReader(stream)
        required = {'category', 'game_id', 'team_id', 'athlete_id', 'athlete_name',
                    'season', 'completions/passingAttempts', *COUNT_COLUMNS}
        if not required.issubset(records.fieldnames or []):
            raise ValueError(f'Unexpected player box schema for {year}')
        for record in records:
            if record['category'] != 'passing':
                continue
            source_rows += 1
            game_id, team_id, athlete_id = (record[key] for key in ('game_id', 'team_id', 'athlete_id'))
            game = games.get(game_id)
            if game is None:
                reasons['outside-completed-reference'] += 1
                continue
            if team_id not in (game['home'], game['away']):
                reasons['team-not-a-game-participant'] += 1
                continue
            if teams[team_id]['division'] not in ('fbs', 'fcs'):
                reasons['team-outside-fbs-fcs'] += 1
                continue
            # ESPN uses negative identifiers for unattributed "Team" passing
            # lines. The named passer's volume excludes these team-only plays.
            if re.fullmatch(r'-[1-9][0-9]*', athlete_id) and record['athlete_name'].strip().casefold() == 'team':
                reasons['team-only-no-athlete-attribution'] += 1
                continue
            side = (game_id, team_id)
            try:
                if record['season'] != str(year):
                    raise ValueError('wrong-season')
                if not re.fullmatch(r'[1-9][0-9]*', athlete_id) or not record['athlete_name']:
                    raise ValueError('invalid-athlete-identity')
                if athlete_id in sides[side]:
                    raise ValueError('duplicate-athlete-game-side')
                counts = passing_counts(record)
            except ValueError as error:
                invalid_sides.add(side)
                reasons[str(error)] += 1
                continue
            sides[side][athlete_id] = dict(gameId=game_id, teamId=team_id, athleteId=athlete_id,
                                          name=record['athlete_name'], kickoff=game['startDate'],
                                          seasonType=game['seasonType'], **counts)
    rows = [row for side, records in sorted(sides.items()) if side not in invalid_sides
            for _, row in sorted(records.items())]
    observed_sides = {(row['gameId'], row['teamId']) for row in rows}
    expected_fbs = {(game['id'], team) for game in games.values() for team in (game['home'], game['away'])
                    if teams[team]['division'] == 'fbs'}
    fbs_ids = {team['id'] for team in teams.values() if team['division'] == 'fbs'}
    observed_fbs = expected_fbs & observed_sides
    totals = defaultdict(list)
    for row in rows:
        totals[row['teamId'], row['athleteId']].append(row)
    season_rows = []
    for (team_id, athlete_id), group in sorted(totals.items()):
        names = Counter(row['name'] for row in group)
        name = min(names, key=lambda n: (-names[n], n))
        season_rows.append(dict(teamId=team_id, athleteId=athlete_id, name=name,
                                gamesWithAttempts=sum(row['attempts'] > 0 for row in group),
                                **{field: sum(row[field] for row in group) for field in FIELDS}))
    audit = dict(inputPassingRows=source_rows, acceptedPassingRows=len(rows),
                 acceptedGameSides=len(observed_sides), rejectedGameSides=len(invalid_sides),
                 expectedFbsGameSides=len(expected_fbs), acceptedFbsGameSides=len(observed_fbs),
                 sourceFbsTeams=len(fbs_ids), representedFbsTeams=len({i for _, i in observed_fbs}),
                 acceptedByDivision=dict(Counter(teams[i]['division'] for _, i in observed_sides)),
                 excludedRows=dict(reasons), referenceSha256=digest(reference_bytes))
    output = dict(season=year, rows=rows, audit=audit, source=source)
    (CACHE / f'passing-games-{year}.json.gz').write_bytes(gzip.compress(encode(output), mtime=0))
    return season_rows, audit


def main():
    manifest = json.loads((CACHE / 'source-manifest.json').read_bytes())
    totals, audit = {}, {}
    for source in manifest['sources']:
        year = str(source['year'])
        totals[year], audit[year] = normalize_season(source)
        print(year, json.dumps(audit[year], sort_keys=True))
    (CACHE / 'passing-seasons.json').write_bytes(encode(dict(seasons=totals, audit=audit,
        scope='Observed passing production only. Missing game sides are not zero. No starter, snap or roster inference.',
        sources=manifest['sources'])))


if __name__ == '__main__':
    main()
