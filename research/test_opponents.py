import copy
import json
import unittest
from pathlib import Path

from audit_opponents import normalize_schedule_event,compare_to_snapshot,cutoff_class,team_audit,candidate_edges,run_sensitivity
from compare_merit import fit_network,merit


def public_event():
    return dict(id='g',date='2026-10-31T12:00Z',season={'year':2026},competitions=[dict(neutralSite=False,
        status={'type':{'completed':True}},competitors=[dict(id='a',homeAway='home',score={'value':21},winner=True),
                                                     dict(id='b',homeAway='away',score={'value':7},winner=False)])])


class OpponentChecks(unittest.TestCase):
    def test_normalization_whitelists_and_rejects_invalid_finals(self):
        event=public_event();event['curatedRank']=999
        row,reason=normalize_schedule_event(event,2026)
        self.assertIsNone(reason);self.assertEqual(row['homePoints'],21);self.assertNotIn('curatedRank',row)
        event['competitions'][0]['competitors'][0]['score']['value']=None
        self.assertEqual(normalize_schedule_event(event,2026)[1],'invalid-score-or-date')

    def test_orientation_and_venue_are_compared_by_team(self):
        game,_=normalize_schedule_event(public_event(),2026)
        edge=dict(a='b',b='a',outcome=-1,finalMargin=-14,venue=-1)
        self.assertEqual(compare_to_snapshot(game,edge),[])
        edge['venue']=0
        self.assertEqual(compare_to_snapshot(game,edge),['venue'])

    def test_recent_finals_and_future_kickoffs_do_not_become_candidate_omissions(self):
        game,_=normalize_schedule_event(public_event(),2026)
        self.assertEqual(cutoff_class(game,'2026-10-31T13:00Z'),'within-24h-buffer')
        self.assertEqual(cutoff_class(game,'2026-10-30T13:00Z'),'after-snapshot-kickoff')
        self.assertEqual(cutoff_class(game,'2026-11-01T12:00Z'),'conservative-before-cutoff')
        game.update(cutoffClass='within-24h-buffer',conflicts=[])
        self.assertEqual(candidate_edges({'g':game},{'teams':[{'id':'a'},{'id':'b'}],'games':[]})[0],[])

    def test_invalid_extra_final_forces_review(self):
        source={'id':'a'};stored=dict(name='A',division='fbs',games=0,wins=0,losses=0,contributions=[])
        per={'a':{'eventIds':[],'excluded':[{'id':'bad','reason':'invalid-score-or-date'}]}}
        result=team_audit(source,stored,per,{})
        self.assertEqual(result['status'],'review-required')

    def test_recent_extra_is_explicitly_held_aside(self):
        source={'id':'a'};stored=dict(name='A',division='fbs',games=0,wins=0,losses=0,contributions=[])
        per={'a':{'eventIds':['recent'],'excluded':[]}}
        result=team_audit(source,stored,per,{'recent':{'cutoffClass':'within-24h-buffer','conflicts':[]}})
        self.assertEqual(result['status'],'corroborated-in-later-schedule')
        self.assertEqual(result['laterOrRecentPublicExtras'],['recent'])

    def test_unknown_identity_is_not_invented(self):
        game,_=normalize_schedule_event(public_event(),2026);game.update(cutoffClass='conservative-before-cutoff',conflicts=[])
        added,unresolved=candidate_edges({'g':game},{'teams':[{'id':'a'}],'games':[]})
        self.assertEqual(added,[]);self.assertEqual(len(unresolved),1)

    def test_early_direct_fcs_is_not_withheld_as_indirect_sparse_evidence(self):
        teams=[dict(id='a',name='A',division='fbs',games=1),dict(id='b',name='B',division='fbs',games=1),
               dict(id='c',name='C',division='fcs',games=3),dict(id='d',name='D',division='fcs',games=2),
               dict(id='e',name='E',division='unknown',games=1)]
        games=[dict(id='1',a='a',b='c',outcome=1,venue=1),dict(id='2',a='b',b='d',outcome=1,venue=1),
               dict(id='3',a='c',b='d',outcome=1,venue=1),dict(id='4',a='c',b='e',outcome=1,venue=1)]
        data=dict(teams=teams,games=games);rows=merit(fit_network(data))
        result=run_sensitivity(data,rows,{})
        self.assertEqual({x['nodeId'] for x in result['scenarios']},{'e'})


if __name__=='__main__':unittest.main(verbosity=2)
