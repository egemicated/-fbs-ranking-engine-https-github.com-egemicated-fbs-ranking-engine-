"""Strict, offline, raw-stat performance research inputs. Never writes live data."""
from __future__ import annotations
import csv
import hashlib
import io
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
CACHE=HERE/'cache/performance'
OUTPUT=HERE/'datasets/performance-box-v1'
YEARS=[2014,2015,2016,2017,2018,2019,2023,2024,2025,2026]
RAW_FIELDS=('firstDowns','thirdDownEff','fourthDownEff','totalYards','netPassingYards',
    'completionAttempts','rushingYards','rushingAttempts','totalPenaltiesYards',
    'turnovers','fumblesLost','interceptions','possessionTime')
MISSING={'','NA','NaN','null','None'}
sha=lambda b:hashlib.sha256(b).hexdigest()

class StatError(ValueError):pass

def integer(value,field,*,signed=False,required=False):
    if value is None or str(value).strip() in MISSING:
        if required:raise StatError('missing-'+field)
        return None
    value=str(value).strip()
    if not re.fullmatch(r'-?\d+' if signed else r'\d+',value):raise StatError('invalid-'+field)
    return int(value)

def fraction(value,field,separator,*,required=False):
    if value is None or str(value).strip() in MISSING:
        if required:raise StatError('missing-'+field)
        return None,None
    match=re.fullmatch(r'(\d+)'+re.escape(separator)+r'(\d+)',str(value).strip())
    if not match:raise StatError('invalid-'+field)
    return int(match[1]),int(match[2])

def normalize_row(row):
    # Deliberately ignore source yard averages and all fields outside this map.
    yards=integer(row.get('totalYards'),'yards',signed=True,required=True)
    passing=integer(row.get('netPassingYards'),'passingYards',signed=True,required=True)
    rushing=integer(row.get('rushingYards'),'rushingYards',signed=True,required=True)
    completions,attempts=fraction(row.get('completionAttempts'),'passingAttempts','/',required=True)
    rush_attempts=integer(row.get('rushingAttempts'),'rushingAttempts',required=True)
    if completions>attempts:raise StatError('completions-exceed-attempts')
    if yards!=passing+rushing:raise StatError('yards-components-disagree')
    if rush_attempts==0 and rushing!=0:raise StatError('rushing-yards-without-attempts')
    if attempts==0 and passing!=0:raise StatError('passing-yards-without-attempts')
    plays=attempts+rush_attempts
    if plays<=0:raise StatError('no-offensive-plays')
    third_made,third_attempts=fraction(row.get('thirdDownEff'),'thirdDown','-')
    fourth_made,fourth_attempts=fraction(row.get('fourthDownEff'),'fourthDown','-')
    for name,made,total in (('third',third_made,third_attempts),('fourth',fourth_made,fourth_attempts)):
        if made is not None and made>total:raise StatError(name+'-made-exceeds-attempts')
    penalties,penalty_yards=fraction(row.get('totalPenaltiesYards'),'penalties','-')
    turnovers=integer(row.get('turnovers'),'turnovers')
    fumbles=integer(row.get('fumblesLost'),'fumblesLost')
    interceptions=integer(row.get('interceptions'),'interceptions')
    if all(v is not None for v in (turnovers,fumbles,interceptions)) and turnovers!=fumbles+interceptions:raise StatError('turnover-components-disagree')
    minutes,seconds=fraction(row.get('possessionTime'),'possession',':')
    if seconds is not None and seconds>=60:raise StatError('invalid-possession-seconds')
    return dict(yards=yards,plays=plays,passingYards=passing,passingAttempts=attempts,completions=completions,
        rushingYards=rushing,rushingAttempts=rush_attempts,firstDowns=integer(row.get('firstDowns'),'firstDowns'),
        thirdDownMade=third_made,thirdDownAttempts=third_attempts,fourthDownMade=fourth_made,fourthDownAttempts=fourth_attempts,
        turnovers=turnovers,fumblesLost=fumbles,interceptions=interceptions,penalties=penalties,penaltyYards=penalty_yards,
        possessionSeconds=None if minutes is None else minutes*60+seconds,yardsPerPlay=yards/plays)

def load_context(year):
    if year==2026:
        from compare_merit import current_dataset
        path=ROOT/'published/latest.json';raw=path.read_bytes();snapshot=json.loads(raw);network=current_dataset(snapshot)
        teams={t['id']:{k:t[k] for k in ('id','name','division','conference')} for t in snapshot['ratings']}
        margins={g['gameId']:(t['id'],g['finalMargin']) for t in snapshot['ratings'] for g in t['contributions']}
        games={}
        for g in network['games']:
            home,away=(g['a'],g['b']) if g['venue']>=0 else (g['b'],g['a'])
            who,margin=margins[g['id']]
            games[g['id']]={'id':g['id'],'home':home,'away':away,'neutral':g['venue']==0,
                'homePoints':None,'awayPoints':None,'startDate':None,'week':None,'seasonType':None,
                'finalMargin':margin if who==home else -margin,'homeAwayKnown':g['venue']!=0}
        source={'kind':'published CFBD confirmed-completed graph','path':'published/latest.json','sha256':sha(raw),
            'asOf':snapshot['asOf'],'snapshotHash':snapshot['snapshotHash'],
            'limits':'Snapshot contributions have no absolute scores, kickoff dates or weeks. They remain null; current-source outcome eligibility is inherited by exact game ID. No 2026 pregame replay claim.'}
    else:
        path=HERE/f'datasets/fcs-coverage-v1/seasons/{year}.json';raw=path.read_bytes();data=json.loads(raw)
        teams={t['id']:t for t in data['teams']};games={}
        for g in data['games']:
            if g['completed']:games[g['id']]={**g,'finalMargin':g['homePoints']-g['awayPoints'],'homeAwayKnown':True}
        source={'kind':'repaired historical outcome data','path':path.relative_to(ROOT).as_posix(),'sha256':sha(raw)}
    return {'teams':teams,'games':games,'source':source}

def normalize_season(text,year,context):
    rows=list(csv.DictReader(io.StringIO(text)));bygame=defaultdict(list)
    for row in rows:
        if integer(row.get('season'),'season',required=True)!=year:raise StatError('wrong-source-season')
        for key in ('game_id','team_id'):
            if not re.fullmatch(r'\d+',row.get(key,'')):raise StatError('invalid-'+key)
        bygame[row['game_id']].append(row)
    teams=context['teams'];known={i:t for i,t in teams.items() if t['division'] in ('fbs','fcs')}
    expected={i:g for i,g in context['games'].items() if {g['home'],g['away']}<=set(known)}
    audit={'inputTeamRows':len(rows),'inputGameIds':len(bygame),'excluded':[],'neutralOrientationDifferences':[],
        'expectedKnownD1Games':len(expected),'expectedFbsInvolvingGames':sum(any(known[g[k]]['division']=='fbs' for k in ('home','away')) for g in expected.values())}
    output=[]
    for identity,rr in sorted(bygame.items()):
        def exclude(reason):audit['excluded'].append({'id':identity,'reason':reason})
        if len(rr)!=2 or len({r['team_id'] for r in rr})!=2 or {r['home_away'] for r in rr}!={'home','away'}:exclude('invalid-two-team-pair');continue
        if identity not in expected:exclude('not-in-known-D1-outcome-reference');continue
        g=expected[identity];pair={r['team_id']:r for r in rr}
        if set(pair)!={g['home'],g['away']}:exclude('participants-disagree');continue
        box_home=next(r['team_id'] for r in rr if r['home_away']=='home')
        if box_home!=g['home']:
            if not g['neutral']:exclude('nonneutral-home-away-disagrees');continue
            audit['neutralOrientationDifferences'].append(identity)
        try:stats={side:normalize_row(pair[g[side]]) for side in ('home','away')}
        except StatError as error:exclude(str(error));continue
        result={k:g[k] for k in ('id','home','away','neutral','startDate','week','seasonType','homePoints','awayPoints','finalMargin')}
        result['outcome']=(g['finalMargin']>0)-(g['finalMargin']<0);result['stats']=stats
        result['homeAwaySource']='outcome reference, arbitrary listed orientation when neutral and source home unavailable' if not g['homeAwayKnown'] else 'outcome reference'
        output.append(result)
    accepted={g['id'] for g in output};counts=Counter(i for g in output for i in (g['home'],g['away']));expected_counts=Counter(i for g in expected.values() for i in (g['home'],g['away']))
    audit['acceptedKnownD1Games']=len(output);audit['acceptedFbsInvolvingGames']=sum(any(known[g[k]]['division']=='fbs' for k in ('home','away')) for g in output)
    audit['acceptedByDivisionPair']=dict(Counter('-'.join(sorted(known[g[k]]['division'] for k in ('home','away'))) for g in output))
    audit['missingExpectedGameIds']=sorted(set(expected)-accepted)
    audit['exclusionReasons']=dict(Counter(g['reason'] for g in audit['excluded']))
    audit['teamCoverage']={i:{'name':t['name'],'division':t['division'],'expectedGames':expected_counts[i],'statGames':counts[i],
        'missingGames':expected_counts[i]-counts[i]} for i,t in sorted(known.items())}
    return {'schemaVersion':1,'datasetVersion':'performance-box-v1','year':year,'teams':list(known.values()),'games':output,'outcomeReference':context['source'],'audit':audit,
        'playsDefinition':'Raw college total-offense play denominator = passing attempts + rushing attempts. Recorded rushing totals already contain NCAA sacks; never add sacks again.',
        'inputPolicy':'Use only exact paired raw-stat game/team identities; missing values are not zero, invalid required-stat games excluded as complete pairs. No polls, odds, ratings, probabilities, EPA/QBR/WPA or provider yard averages.'}

def build():
    manifest=json.loads((CACHE/'manifest.json').read_text());files={f['year']:f for f in manifest['files']}
    (OUTPUT/'seasons').mkdir(parents=True,exist_ok=True);report={'datasetVersion':'performance-box-v1','cfbdCalls':0,'sourceManifestSha256':sha((CACHE/'manifest.json').read_bytes()),'seasons':{}}
    for year in YEARS:
        path=CACHE/f'team_box_{year}.csv';raw=path.read_bytes();assert sha(raw)==files[year]['sha256'],'Cached source hash mismatch'
        data=normalize_season(raw.decode('utf-8-sig'),year,load_context(year));data['source']={**files[year],'provider':manifest['provider'],'schemaUrl':manifest['schemaUrl']}
        encoded=(json.dumps(data,indent=2)+'\n').encode();out=OUTPUT/f'seasons/{year}.json';out.write_bytes(encoded)
        report['seasons'][str(year)]={'sha256':sha(encoded),'rawSourceSha256':sha(raw),'games':len(data['games']),
            'acceptedByDivisionPair':data['audit']['acceptedByDivisionPair'],'expectedFbsInvolvingGames':data['audit']['expectedFbsInvolvingGames'],
            'acceptedFbsInvolvingGames':data['audit']['acceptedFbsInvolvingGames'],'exclusionReasons':data['audit']['exclusionReasons'],
            'fbsTeamsWithStats':sum(t['division']=='fbs' and t['statGames']>0 for t in data['audit']['teamCoverage'].values()),
            'fbsTeamsWithCompleteStats':sum(t['division']=='fbs' and t['statGames']==t['expectedGames'] for t in data['audit']['teamCoverage'].values())}
    report['datasetFingerprint']=sha(json.dumps(report,sort_keys=True).encode());(OUTPUT/'manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))

if __name__=='__main__':build()
