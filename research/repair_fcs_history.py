"""Versioned offline known-node FCS coverage supplement; never changes production.

Build: python research/repair_fcs_history.py
Restore: python research/repair_fcs_history.py --restore
Provider seasonType is preserved: ESPN labels some FCS playoff rounds regular.
"""
from __future__ import annotations
import copy
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
PARENT=HERE/'datasets/historical-coverage-v1'
OUTPUT=HERE/'datasets/fcs-coverage-v1'
CACHE=HERE/'cache/fcs-history'
VERSION='fcs-coverage-v1'

def sha(raw):return hashlib.sha256(raw).hexdigest()
def encode(value):return (json.dumps(value,indent=2)+'\n').encode('utf-8')
def moment(value):
    if not isinstance(value,str):raise ValueError('date missing')
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None:raise ValueError('timezone missing')
    return parsed.astimezone(timezone.utc)
def canonical_date(value):return moment(value).isoformat(timespec='milliseconds').replace('+00:00','Z')

def normalize_event(event,year,teams):
    if event.get('season',{}).get('year')!=year:return None,'not-target-season'
    typ=event.get('season',{}).get('type')
    if typ in (5,6):
        try:spring_date=moment(event.get('date'))
        except (ValueError,TypeError):return None,'invalid-date'
        if year!=2020 or spring_date.year!=2021 or not 1<=spring_date.month<=6:return None,'spring-calendar-outside-season2020'
    elif typ not in (2,3):return None,'not-regular-or-postseason'
    if event.get('status',{}).get('type',{}).get('completed') is not True:return None,'not-completed'
    comps=event.get('competitions',[])
    if len(comps)!=1:return None,'competition-count'
    comp=comps[0];players=comp.get('competitors',[])
    home=[t for t in players if t.get('homeAway')=='home'];away=[t for t in players if t.get('homeAway')=='away']
    if len(home)!=1 or len(away)!=1 or len(players)!=2:return None,'ambiguous-orientation'
    h,a=home[0],away[0];hid,aid=str(h.get('id','')),str(a.get('id',''))
    if hid==aid or hid not in teams or aid not in teams:return None,'identity-not-in-parent-season'
    if teams[hid]['division']!='fcs' or teams[aid]['division']!='fcs':return None,'not-parent-fcs-vs-fcs'
    if type(comp.get('neutralSite')) is not bool:return None,'venue-not-explicit'
    scores=[h.get('score'),a.get('score')]
    if any(not isinstance(s,(str,int)) or isinstance(s,bool) or not str(s).isdigit() for s in scores):return None,'invalid-scores'
    hp,ap=map(int,scores)
    if hp==ap:return None,'tied-final-needs-separate-policy'
    if type(h.get('winner')) is not bool or type(a.get('winner')) is not bool or h['winner']!=(hp>ap) or a['winner']!=(ap>hp):return None,'winner-score-conflict'
    week=event.get('week',{}).get('number')
    if type(week) is not int or week<1:return None,'week-not-explicit'
    try:
        date=canonical_date(event.get('date'))
        if comp.get('date') and moment(comp['date'])!=moment(date):return None,'event-competition-date-conflict'
    except (ValueError,TypeError):return None,'invalid-date'
    ident=event.get('id')
    if not isinstance(ident,str) or not ident:return None,'invalid-event-id'
    return dict(id=ident,week=week,seasonType='regular' if typ in (2,5) else 'postseason',startDate=date,completed=True,
                neutral=comp['neutralSite'],home=hid,away=aid,homePoints=hp,awayPoints=ap),None

def score_map(game):return {game['home']:game['homePoints'],game['away']:game['awayPoints']}
def conflicts(existing,candidate):
    result=[]
    if set(score_map(existing))!=set(score_map(candidate)):return ['participants']
    if score_map(existing)!=score_map(candidate):result.append('scores')
    if existing['completed']!=candidate['completed']:result.append('completion')
    if existing['neutral']!=candidate['neutral']:result.append('neutral')
    # Home/away orientation is consequential even when team-oriented scores agree.
    if (existing['home'],existing['away'])!=(candidate['home'],candidate['away']):result.append('orientation')
    if moment(existing['startDate'])!=moment(candidate['startDate']):result.append('kickoff')
    if existing['week']!=candidate['week'] or existing['seasonType']!=candidate['seasonType']:result.append('calendar-label')
    return result
def logical_key(g):return tuple(sorted((g['home'],g['away'])))+(moment(g['startDate']).date().isoformat(),)

def apply_patch(parent,patch):
    result=copy.deepcopy(parent)
    assert not ({g['id'] for g in result['games']}&{g['id'] for g in patch['addGames']})
    byid={g['id']:g for g in result['games']}
    for correction in patch.get('scoreCorrections',[]):
        game=byid[correction['id']]
        assert all(game.get(k)==v for k,v in correction['expected'].items()),'Adjudication does not match exact parent game'
        assert set(correction['correctedScores'])=={'homePoints','awayPoints'},'Only explicit score fields may change'
        assert all(type(v) is int and v>=0 for v in correction['correctedScores'].values())
        oldmargin=game['homePoints']-game['awayPoints'];newmargin=correction['correctedScores']['homePoints']-correction['correctedScores']['awayPoints']
        assert oldmargin*newmargin>0,'This narrow repair does not adjudicate changed winners or ties'
        game.update(correction['correctedScores'])
    result['games'].extend(patch['addGames'])
    result['source']['fcsResearchRepair']=patch['repairMetadata']
    return result

def package(manifest):
    release={'version':VERSION,'manifest':manifest,'seasons':{}}
    for year,audit in manifest['seasons'].items():
        data=json.loads((OUTPUT/f'seasons/{year}.json').read_text())
        added=set(audit['addedIds'])
        release['seasons'][year]={'parentSha256':audit['inputSha256'],'outputSha256':audit['outputSha256'],
          'addGames':[g for g in data['games'] if g['id'] in added], 'scoreCorrections':audit['scoreCorrections'],
          'repairMetadata':data['source']['fcsResearchRepair']}
    blob=gzip.compress(json.dumps(release,separators=(',',':')).encode(),mtime=0)
    target=HERE/f'releases/{VERSION}.json.gz';target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(blob)
    metadata={'version':VERSION,'file':target.name,'sha256':sha(blob),'bytes':len(blob),'datasetFingerprint':manifest['datasetFingerprint'],
              'addedGames':manifest['totals']['addedGames'],'scoreCorrections':manifest['totals']['scoreCorrections'],'years':list(manifest['seasons'])}
    target.with_name(f'{VERSION}.metadata.json').write_bytes(encode(metadata))
    return metadata

def restore():
    target=HERE/f'releases/{VERSION}.json.gz';meta=json.loads(target.with_name(f'{VERSION}.metadata.json').read_text());blob=target.read_bytes()
    assert sha(blob)==meta['sha256'],'Release checksum mismatch'
    release=json.loads(gzip.decompress(blob));assert release['version']==VERSION
    (OUTPUT/'seasons').mkdir(parents=True,exist_ok=True)
    for year,patch in release['seasons'].items():
        raw=(PARENT/f'seasons/{year}.json').read_bytes();assert sha(raw)==patch['parentSha256'],f'Parent mismatch {year}'
        raw=encode(apply_patch(json.loads(raw),patch));assert sha(raw)==patch['outputSha256'],f'Reconstructed checksum mismatch {year}'
        (OUTPUT/f'seasons/{year}.json').write_bytes(raw)
    (OUTPUT/'manifest.json').write_bytes(encode(release['manifest']))
    print(json.dumps({'restoredYears':len(release['seasons']),'addedGames':meta['addedGames'],'releaseSha256':meta['sha256']}))

def build():
    source_manifest=json.loads((CACHE/'manifest.json').read_text())
    adjudication_path=HERE/'results/fcs-score-adjudications.json'
    adjudication=json.loads(adjudication_path.read_text())
    manifest={'version':VERSION,'parentVersion':'historical-coverage-v1','parentManifestSha256':sha((PARENT/'manifest.json').read_bytes()),
      'sourceManifestSha256':sha((CACHE/'manifest.json').read_bytes()),'sources':source_manifest['sources'],'seasons':{},
      'scoreAdjudicationSha256':sha(adjudication_path.read_bytes()),
      'scope':'Missing late FCS games: known-parent-FCS-node completed games absent from Nov/Dec/Jan source windows, plus known-node pandemic spring coverage. ESPN calendar labels are preserved; season2020 spring5/6 map to regular/postseason with explicit provenance.',
      'limitations':['Free retrospective source responses do not prove historical as-of publication or independent upstream evidence.',
        'Only existing season-specific FCS identities qualify. Membership is not expanded or independently certified.',
        'ESPN calendar labels can call FCS playoff games regular. Labeled-postseason counts are not playoff completeness counts.',
        'Source month/group responses do not alone prove complete regular-season schedules.',
        '2020 parent roster omits most spring2021FCS participants; this repair does not invent missing nodes.',
        'Existing conflicts remain unchanged except three exact-field score corrections separately verified against NCAA and school primary sources. No venue or date is changed.',
        'Lowerdivision context and all-season missing regular games remain separate coverage concerns.'],
      'totals':{'addedGames':0,'scoreCorrections':0,'existingCorroborated':0,'existingConflicts':0,'sourceConflicts':0,'logicalDuplicatesExcluded':0}}
    sources={}
    for source in source_manifest['sources']:
        raw=(CACHE/source['file']).read_bytes();assert sha(raw)==source['sha256'],f"Source checksum {source['file']}"
        payload=json.loads(raw);assert len(payload['events'])<1000
        sources[source['file']]=payload['events']
    (OUTPUT/'seasons').mkdir(parents=True,exist_ok=True)
    for year in range(2014,2026):
        raw=(PARENT/f'seasons/{year}.json').read_bytes();parent=json.loads(raw);teams={t['id']:t for t in parent['teams']}
        audit={'inputSha256':sha(raw),'addedIds':[],'added':[],'scoreCorrections':adjudication['seasons'].get(str(year),[]),'existingCorroborated':[],'existingConflicts':[],'sourceConflicts':[], 'logicalDuplicatesExcluded':[],'exclusions':[]}
        candidates={};origin={};original_types={};bad=set()
        for source in source_manifest['sources']:
            if source['targetSeason']!=year:continue
            for event in sources[source['file']]:
                game,reason=normalize_event(event,year,teams)
                if reason:audit['exclusions'].append({'id':event.get('id'),'source':source['file'],'reason':reason});continue
                ident=game['id'];origin.setdefault(ident,[]).append(source['file']);original_types.setdefault(ident,set()).add(event['season']['type'])
                if ident in candidates and game!=candidates[ident]:
                    bad.add(ident);audit['sourceConflicts'].append({'id':ident,'source':source['file'],'fields':conflicts(candidates[ident],game)})
                else:candidates[ident]=game
        existing={g['id']:g for g in parent['games']};keys={}
        for g in parent['games']:keys.setdefault(logical_key(g),[]).append(g['id'])
        added=[]
        for ident,game in sorted(candidates.items(),key=lambda pair:(pair[1]['startDate'],pair[0])):
            if ident in bad:continue
            if ident in existing:
                diff=conflicts(existing[ident],game)
                if diff:audit['existingConflicts'].append({'id':ident,'fields':diff,'sources':origin[ident],
                    'parentGame':existing[ident],'candidateGame':game,'originalSourceSeasonTypes':sorted(original_types[ident])})
                else:audit['existingCorroborated'].append(ident)
                continue
            key=logical_key(game)
            if key in keys:
                audit['logicalDuplicatesExcluded'].append({'id':ident,'existingIds':keys[key],'sources':origin[ident]});continue
            keys[key]=[ident];added.append(game);audit['addedIds'].append(ident)
            audit['added'].append({'id':ident,'startDate':game['startDate'],'sources':origin[ident],
                'originalSourceSeasonTypes':sorted(original_types[ident]),'normalizedSeasonType':game['seasonType']})
        repair={'version':VERSION,'parentVersion':'historical-coverage-v1','parentSha256':sha(raw),'addedIds':audit['addedIds'],
                'scoreCorrectionIds':[c['id'] for c in audit['scoreCorrections']],
                'sourceUrls':[s['url'] for s in source_manifest['sources'] if s['targetSeason']==year],
                'seasonTypePolicy':'Preserve source calendar labels, including FCS playoffs labeled regular. Season2020-only spring5/6 map to regular/postseason; original types are retained in the audit.'}
        for correction in audit['scoreCorrections']:
            candidate=candidates[correction['id']]
            assert all(candidate[k]==v for k,v in correction['correctedScores'].items()),'Public candidate disagrees with primary adjudication'
            assert len(correction['sourceUrls'])>=2 and 'ncaa.org' in correction['sourceUrls'][0]
        result=apply_patch(parent,{'addGames':added,'scoreCorrections':audit['scoreCorrections'],'repairMetadata':repair});encoded=encode(result)
        audit['outputSha256']=sha(encoded)
        audit['existingFcsFcsGames']=sum(g['completed'] and teams[g['home']]['division']=='fcs' and teams[g['away']]['division']=='fcs' for g in parent['games'])
        audit['outputFcsFcsGames']=audit['existingFcsFcsGames']+len(added)
        (OUTPUT/f'seasons/{year}.json').write_bytes(encoded);manifest['seasons'][str(year)]=audit
        manifest['totals']['addedGames']+=len(added)
        manifest['totals']['scoreCorrections']+=len(audit['scoreCorrections'])
        for key in ('existingCorroborated','existingConflicts','sourceConflicts','logicalDuplicatesExcluded'):manifest['totals'][key]+=len(audit[key])
    manifest['datasetFingerprint']=sha(json.dumps(manifest,sort_keys=True).encode())
    (OUTPUT/'manifest.json').write_bytes(encode(manifest));meta=package(manifest)
    print(json.dumps({'totals':manifest['totals'],'release':meta,'years':[{'year':y,'added':len(a['addedIds']),'existingConflicts':len(a['existingConflicts']),'sourceConflicts':len(a['sourceConflicts']),'excluded':len(a['exclusions'])} for y,a in manifest['seasons'].items()]},indent=2))

if __name__=='__main__':restore() if '--restore' in sys.argv else build()
