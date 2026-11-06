"""Meaningful eligibility, non-overwrite and frozen-reconstruction checks."""
import copy
import gzip
import json
import unittest
from pathlib import Path
from repair_fcs_history import (HERE,PARENT,OUTPUT,VERSION,normalize_event,conflicts,logical_key,apply_patch,encode,sha)

def fixture():
    return {'id':'123','date':'2015-01-10T18:00Z','season':{'year':2014,'type':3},'week':{'number':1},
      'status':{'type':{'completed':True}},'competitions':[{'date':'2015-01-10T18:00Z','neutralSite':True,
      'competitors':[{'id':'a','homeAway':'home','score':'29','winner':True},{'id':'b','homeAway':'away','score':'27','winner':False}]}]}

class FcsRepairTests(unittest.TestCase):
    def setUp(self):self.teams={'a':{'division':'fcs'},'b':{'division':'fcs'}}
    def test_known_season_completed_fcs_match_qualifies(self):
        game,error=normalize_event(fixture(),2014,self.teams)
        self.assertIsNone(error);self.assertEqual(game['startDate'],'2015-01-10T18:00:00.000Z');self.assertEqual(game['homePoints'],29)
    def test_regular_label_preserved_for_fcs_playoff(self):
        event=fixture();event['season']['type']=2
        self.assertEqual(normalize_event(event,2014,self.teams)[0]['seasonType'],'regular')
    def test_spring_types_require_season2020_and_spring2021_dates(self):
        event=fixture();event['season']={'year':2020,'type':5};event['date']='2021-04-10T18:00Z';event['competitions'][0]['date']=event['date']
        self.assertEqual(normalize_event(event,2020,self.teams)[0]['seasonType'],'regular')
        event['season']['type']=6
        self.assertEqual(normalize_event(event,2020,self.teams)[0]['seasonType'],'postseason')
        event['season']['year']=2021
        self.assertEqual(normalize_event(event,2021,self.teams)[1],'spring-calendar-outside-season2020')
    def test_future_wrong_season_unknown_node_and_fbs_rejected(self):
        for change,expected in [
          (lambda e:e['season'].update(year=2015),'not-target-season'),
          (lambda e:e['status']['type'].update(completed=False),'not-completed'),
          (lambda e:e['competitions'][0]['competitors'][1].update(id='new'),'identity-not-in-parent-season')]:
            event=fixture();change(event);self.assertEqual(normalize_event(event,2014,self.teams)[1],expected)
        teams=copy.deepcopy(self.teams);teams['b']['division']='fbs'
        self.assertEqual(normalize_event(fixture(),2014,teams)[1],'not-parent-fcs-vs-fcs')
    def test_ambiguous_scores_winner_venue_dates_rejected(self):
        for change,expected in [
          (lambda e:e['competitions'][0]['competitors'][0].update(score='29.0'),'invalid-scores'),
          (lambda e:e['competitions'][0]['competitors'][0].update(winner=False),'winner-score-conflict'),
          (lambda e:e['competitions'][0].update(neutralSite='true'),'venue-not-explicit'),
          (lambda e:e.update(date='2015-01-10T18:00'),'invalid-date'),
          (lambda e:e['competitions'][0].update(date='2015-01-10T19:00Z'),'event-competition-date-conflict')]:
            event=fixture();change(event);self.assertEqual(normalize_event(event,2014,self.teams)[1],expected)
    def test_same_scores_reversed_orientation_is_still_material_conflict(self):
        game=normalize_event(fixture(),2014,self.teams)[0];reverse={**game,'home':'b','away':'a','homePoints':27,'awayPoints':29}
        self.assertEqual(conflicts(game,reverse),['orientation'])
        self.assertEqual(logical_key(game),logical_key(reverse))
    def test_additions_cannot_overwrite_existing_id(self):
        game=normalize_event(fixture(),2014,self.teams)[0]
        with self.assertRaises(AssertionError):apply_patch({'games':[game],'source':{}},{'addGames':[game],'repairMetadata':{}})
    def test_score_correction_requires_exact_parent_and_cannot_change_other_fields(self):
        game=normalize_event(fixture(),2014,self.teams)[0]
        correction={'id':game['id'],'expected':{'homePoints':29,'awayPoints':27},'correctedScores':{'homePoints':30,'awayPoints':27}}
        patch={'addGames':[],'scoreCorrections':[correction],'repairMetadata':{}}
        self.assertEqual(apply_patch({'games':[game],'source':{}},patch)['games'][0]['homePoints'],30)
        bad=copy.deepcopy(patch);bad['scoreCorrections'][0]['expected']['homePoints']=28
        with self.assertRaises(AssertionError):apply_patch({'games':[game],'source':{}},bad)
        bad=copy.deepcopy(patch);bad['scoreCorrections'][0]['correctedScores']['neutral']=False
        with self.assertRaises(AssertionError):apply_patch({'games':[game],'source':{}},bad)
    def test_frozen_release_reconstructs_outputs_and_preserves_parent_games(self):
        target=HERE/f'releases/{VERSION}.json.gz';meta=json.loads(target.with_name(f'{VERSION}.metadata.json').read_text());raw=target.read_bytes()
        self.assertEqual(sha(raw),meta['sha256']);release=json.loads(gzip.decompress(raw));added=0
        for year,patch in release['seasons'].items():
            original=(PARENT/f'seasons/{year}.json').read_bytes();self.assertEqual(sha(original),patch['parentSha256'])
            parent=json.loads(original);result=apply_patch(parent,patch)
            self.assertEqual(result['teams'],parent['teams'])
            expected=copy.deepcopy(parent['games']);byid={g['id']:g for g in expected}
            for correction in patch.get('scoreCorrections',[]):byid[correction['id']].update(correction['correctedScores'])
            self.assertEqual(result['games'][:len(parent['games'])],expected)
            self.assertEqual(result['source']['researchRepair'],parent['source']['researchRepair'])
            self.assertEqual(sha(encode(result)),patch['outputSha256']);self.assertEqual(encode(result),(OUTPUT/f'seasons/{year}.json').read_bytes())
            self.assertEqual(len(result['games']),len({g['id'] for g in result['games']}));keys=[logical_key(g) for g in result['games']]
            self.assertEqual(len(keys),len(set(keys)));teams={t['id']:t for t in result['teams']}
            for game in patch['addGames']:
                self.assertTrue(game['completed']);self.assertEqual({teams[game[k]]['division'] for k in ('home','away')},{'fcs'})
            added+=len(patch['addGames'])
        self.assertEqual(added,meta['addedGames'])

if __name__=='__main__':unittest.main()
