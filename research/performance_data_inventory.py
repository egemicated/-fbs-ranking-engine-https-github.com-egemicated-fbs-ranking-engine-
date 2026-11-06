"""Offline inventory of actual game-stat fields; no provider calls or live writes.

Optional public CSV probes live under research/cache/performance-inventory.
Only documented raw box-score fields are assessed as model-input candidates.
"""
from __future__ import annotations
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
HERE=ROOT/'research'
PROBES=HERE/'cache/performance'
FIELDS=('game_id','season','week','team_id','team_display_name','home_away',
        'first_downs','third_down_eff','fourth_down_eff','total_yards','net_passing_yards',
        'completion_attempts','yards_per_pass','rushing_yards','rushing_attempts',
        'yards_per_rush_attempt','total_penalties_yards','turnovers','fumbles_lost',
        'interceptions','possession_time')
RAW_NAMES={'firstDowns','thirdDownEff','fourthDownEff','totalYards','netPassingYards',
           'completionAttempts','yardsPerPass','rushingYards','rushingAttempts',
           'yardsPerRushAttempt','totalPenaltiesYards','turnovers','fumblesLost',
           'interceptions','possessionTime','sacks','totalOffensivePlays'}

def sha(raw):return hashlib.sha256(raw).hexdigest()
def relative(path):return path.relative_to(ROOT).as_posix()
def csv_header(path):
    with path.open(encoding='utf-8-sig',newline='') as stream:return next(csv.reader(stream))
def division_graph(year):
    if year==2026:
        data=json.loads((ROOT/'published/latest.json').read_text())
        teams={t['id']:t for t in data['ratings']};edges={}
        for t in data['ratings']:
            for g in t['contributions']:edges[g['gameId']]=(t['id'],g['opponentId'])
        source={'kind':'published CFBD outcome graph','asOf':data['asOf'],'snapshotHash':data['snapshotHash']}
    else:
        path=HERE/f'datasets/fcs-coverage-v1/seasons/{year}.json'
        if not path.exists():path=HERE/f'datasets/historical-coverage-v1/seasons/{year}.json'
        data=json.loads(path.read_text());teams={t['id']:t for t in data['teams']}
        edges={g['id']:(g['home'],g['away']) for g in data['games'] if g['completed']}
        source={'kind':'stored repaired historical outcomes','path':relative(path),'sha256':sha(path.read_bytes())}
    expected={identity:pair for identity,pair in edges.items() if any(teams[i]['division']=='fbs' for i in pair)}
    return teams,expected,source

def box_probe(path):
    raw=path.read_bytes();rows=list(csv.DictReader(raw.decode('utf-8-sig').splitlines()));columns=list(rows[0]) if rows else csv_header(path)
    year=int(path.stem.split('_')[-1]);teams,expected,source=division_graph(year)
    by_game=defaultdict(list)
    for row in rows:by_game[row['game_id']].append(row)
    paired={i for i,rr in by_game.items() if len(rr)==2 and len({r['team_id'] for r in rr})==2 and {r['home_away'] for r in rr}=={'home','away'}}
    matched=set(expected)&paired;missing=set(expected)-paired
    pair_conflicts=[i for i in matched if {r['team_id'] for r in by_game[i]}!=set(expected[i])]
    target_rows=[r for i in matched for r in by_game[i]]
    availability={f:sum(r.get(f,'').strip() not in ('','NA','NaN','null','None') for r in target_rows) for f in sorted(RAW_NAMES) if f in columns}
    groups=Counter('-'.join(sorted(teams[i]['division'] for i in expected[g])) for g in matched)
    return {'file':relative(path),'sha256':sha(raw),'bytes':len(raw),'columns':columns,'rows':len(rows),
        'seasonsInRows':dict(Counter(r.get('season') for r in rows)),'uniqueGames':len(by_game),'pairedGames':len(paired),
        'invalidPairIds':sorted(set(by_game)-paired),'expectedFbsInvolvingGames':len(expected),'matchedFbsInvolvingGames':len(matched),
        'matchedByDivisionPair':dict(groups),'participantConflicts':pair_conflicts,'missingFbsGameIds':sorted(missing),
        'matchedTeamRows':len(target_rows),'nonmissingWhitelistedFieldCounts':availability,
        'additionalColumnsExcluded':sorted(set(columns)-(RAW_NAMES|{'game_id','season','team_id','team_name','team_abbreviation','home_away'})),'outcomeReference':source,
        'schemaDifference':'Actual release uses camelCase statistic names and has no date, score or week column; documentation describes a newer snake_case reshaping. Exact source columns are recorded here.',
        'rowGrain':'Two team rows per game, with opponent defense recovered by pairing stable game/team IDs.'}

def main():
    schedules=[]
    for path in sorted((ROOT/'data/raw').glob('*.csv'))+[HERE/'cache/cfb_games_info.csv']:
        if not path.exists():continue
        header=csv_header(path)
        schedules.append({'file':relative(path),'bytes':path.stat().st_size,'columns':header,
            'rawBoxFieldsPresent':sorted(set(header)&(set(FIELDS)-{'game_id','season','week'})),
            'excludedNonRawFields':[h for h in header if any(s in h.lower() for s in ('elo','prob','rating','spread','poll','excitement'))]})
    files=set((HERE/'cache').glob('espn-*.json'))
    for folder in ('opponents','fcs-history'):
        files.update((HERE/f'cache/{folder}').rglob('*.json'))
    stats=Counter();leaders=Counter();events_with_stats=set();files_with_stats=set();boxscore_blocks=0;json_files=0
    for path in sorted(files):
        if path.name.endswith('.metadata.json') or path.name=='manifest.json':continue
        try:data=json.loads(path.read_text(encoding='utf-8'))
        except (UnicodeDecodeError,json.JSONDecodeError):continue
        if not isinstance(data,dict):continue
        json_files+=1
        if isinstance(data.get('boxscore'),dict) and data['boxscore'].get('teams'):boxscore_blocks+=1
        for event in data.get('events',[]):
            for comp in event.get('competitions',[]):
                for competitor in comp.get('competitors',[]):
                    for statistic in competitor.get('statistics',[]):
                        if statistic.get('name') in RAW_NAMES:
                            stats[statistic['name']]+=1;events_with_stats.add(event.get('id'));files_with_stats.add(relative(path))
                    for leader in competitor.get('leaders',[]):leaders[leader.get('name','unknown')]+=1
    probes=[box_probe(p) for p in sorted(PROBES.glob('team_box_*.csv'))]
    sources=json.loads((PROBES/'manifest.json').read_text()) if (PROBES/'manifest.json').exists() else {}
    normalized_manifest_path=HERE/'datasets/performance-box-v1/manifest.json'
    normalized_manifest=json.loads(normalized_manifest_path.read_text()) if normalized_manifest_path.exists() else {}
    report={'status':'Read-only inventory for a separate research performance model; no current model or publication changes',
      'cfbdCalls':0,'localScheduleCsvs':schedules,'existingEspnCache':{'jsonFilesRead':json_files,'topLevelTeamBoxscoreBlocks':boxscore_blocks,
        'competitorRawStatOccurrenceCounts':dict(stats),'distinctEventsWithRawTeamStatistics':len(events_with_stats),'filesWithRawTeamStatistics':sorted(files_with_stats),
        'individualLeaderCategoryOccurrences':dict(leaders),'leaderCaution':'Individual game leaders are incomplete player summaries and cannot substitute for full team totals.'},
      'publicBoxscoreProbes':probes,'publicSourceMetadata':sources,'rawInputWhitelist':sorted(RAW_NAMES),
      'validatedDatasetManifest':normalized_manifest,
      'derivedInputsToAudit':['Opponent total/pass/rush yards allowed by pairing exactly two team rows per game.',
        'Offensive play proxy from passing attempts plus rushing attempts only after confirming NCAA sack accounting; never add sacks twice.',
        'Yards per play and turnover rates require validated denominators and missingness rules.',
        'Third/fourth down conversions, completions/attempts, penalties and possession are structured strings, not ready numeric totals.'],
      'excludedInputs':['Human polls','Source power rankings/FPI/Elo','Provider win probabilities, odds and betting lines','Provider EPA/QBR/WPA/advanced model outputs until their underlying definitions and training are independently reviewed','Any fields outside the explicit raw whitelist'],
      'limitations':['Bulk release update time is retrieval provenance, not historical publication time.',
        'No full FBS/FCS or all-season coverage claim follows from one file or documented schema; compare exact game and team identities.',
        'The current published outcome graph and cached sportsdataverse schedule have different sources and coverage; do not join by team name alone.',
        'Missing box scores must remain missing, with coverage disclosed; never impute them as zero performance.',
        'Current-season files can lag the weekly confirmed-final outcome publication; keep each model cutoff explicit.',
        'Drive, sack and special-team detail may require separate raw data, not model-enriched tables.']}
    out=HERE/'results/performance/local-inventory.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(out),'existingCache':report['existingEspnCache'],'probeSummary':[{k:v for k,v in p.items() if k in ('file','bytes','rows','uniqueGames','pairedGames','expectedFbsInvolvingGames','matchedFbsInvolvingGames','matchedByDivisionPair','participantConflicts','nonmissingWhitelistedFieldCounts','additionalColumnsExcluded')} for p in probes]},indent=2))

if __name__=='__main__':main()
