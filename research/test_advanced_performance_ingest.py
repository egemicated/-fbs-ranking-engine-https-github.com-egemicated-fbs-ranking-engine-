"""Exact paired identity and missingness checks for the advanced success metric."""
import copy
import unittest
from unittest.mock import patch

from advanced_performance_ingest import AdvancedStatError, normalize_advanced, read_context


def context():
    return dict(teams=[dict(id='1', name='Alpha', division='fbs', conference='X'),
                       dict(id='2', name='Beta', division='fbs', conference='Y'),
                       dict(id='3', name='Gamma', division='fcs', conference='Z'),
                       dict(id='4', name='Delta', division='ii', conference='Q')],
                games=[dict(id='101', home='1', away='2', neutral=False, completed=True,
                            startDate='2025-09-01T18:00:00Z', week=1, seasonType='regular'),
                       dict(id='102', home='2', away='3', neutral=True, completed=True,
                            startDate='2025-09-08T18:00:00Z', week=2, seasonType='regular'),
                       dict(id='103', home='1', away='4', neutral=False, completed=True,
                            startDate='2025-09-15T18:00:00Z', week=3, seasonType='regular')],
                source={'kind':'fixture'})


def pair(game=101, home='Alpha', away='Beta', home_rate=.5, away_rate=.4):
    return [dict(gameId=game, season=2025, team=home, opponent=away,
                 offense={'plays':70,'successRate':home_rate}, defense={'plays':60,'successRate':away_rate}),
            dict(gameId=game, season=2025, team=away, opponent=home,
                 offense={'plays':60,'successRate':away_rate}, defense={'plays':70,'successRate':home_rate})]


class AdvancedIngestChecks(unittest.TestCase):
    def test_exact_pair_recovers_metadata_and_does_not_mutate_or_use_ppa(self):
        rows=pair(); original=copy.deepcopy(rows); ctx=context(); before=copy.deepcopy(ctx)
        normalized=normalize_advanced(rows,ctx,2025)
        self.assertEqual(rows,original);self.assertEqual(ctx,before)
        game=normalized['games'][0]
        self.assertEqual(game['stats'],{'home':{'rate':.5,'plays':70,'successes':35},'away':{'rate':.4,'plays':60,'successes':24}})
        self.assertEqual((game['home'],game['away'],game['week']),('1','2',1))
        poisoned=copy.deepcopy(rows)
        for row in poisoned:
            row.update(apPoll=1,fpi=999,elo=123,spread=20)
            row['offense'].update(ppa=1000,explosiveness=900,rank=1)
        self.assertEqual(normalized,normalize_advanced(poisoned,ctx,2025))
        self.assertEqual(normalized,normalize_advanced(rows[::-1],ctx,2025))

    def test_coverage_denominator_includes_missing_games_and_preserves_fcs(self):
        normalized=normalize_advanced(pair(),context(),2025);a=normalized['audit']
        self.assertEqual((a['expectedFbsInvolvingGames'],a['acceptedFbsInvolvingGames']),(2,1))
        self.assertEqual(a['completedFbsInvolvingContextGames'],3)
        self.assertEqual(a['missingFbsGameIds'],['102']);self.assertEqual(a['expectedByDivisionPair'],{'fbs-fbs':1,'fbs-fcs':1})
        self.assertEqual(a['teamCoverage']['2']['expectedGames'],2);self.assertEqual(a['teamCoverage']['2']['missingGames'],1)
        self.assertEqual(a['excludedContextGames'][0]['participants'],['fbs','ii'])
        self.assertEqual({t['division'] for t in normalized['teams']},{'fbs','fcs'})
        both=normalize_advanced(pair()+pair(102,'Beta','Gamma'),context(),2025)
        self.assertEqual(both['audit']['completeFbsTeams'],2)
        self.assertTrue(both['games'][1]['neutral'])

    def test_missing_invalid_or_zero_denominator_excludes_whole_pair(self):
        for side,field,value in [('offense','plays',0),('defense','plays',None),('offense','plays',True),
                                 ('offense','successRate',None),('offense','successRate',float('nan')),
                                 ('offense','successRate',1.01),('defense','successRate',-.1)]:
            rows=pair();rows[0][side][field]=value
            with self.subTest(side=side,field=field,value=value):
                result=normalize_advanced(rows,context(),2025)
                self.assertEqual(result['games'],[]);self.assertEqual(result['audit']['acceptedFbsInvolvingGames'],0)
        zeros=pair(home_rate=0.,away_rate=0.)
        self.assertEqual(normalize_advanced(zeros,context(),2025)['games'][0]['stats']['home']['rate'],0.)

    def test_mirror_rates_and_play_counts_are_verified(self):
        for field,value in [('successRate',.2),('plays',72)]:
            rows=pair();rows[1]['defense'][field]=value
            result=normalize_advanced(rows,context(),2025)
            self.assertEqual(result['audit']['exclusionReasons']['offense-defense-mirror-disagreement'],1)
        rows=pair();rows[1]['defense']['successRate']+=1e-8
        self.assertEqual(len(normalize_advanced(rows,context(),2025)['games']),1)

    def test_success_rate_must_reconstruct_integer_opportunities(self):
        rows=pair(home_rate=.501)
        result=normalize_advanced(rows,context(),2025)
        self.assertEqual(result['games'],[])
        self.assertEqual(result['audit']['exclusionReasons']['success-rate-does-not-reconstruct-integer-count'],1)
        rows=pair(home_rate=.5+1e-8)
        result=normalize_advanced(rows,context(),2025)
        self.assertEqual(result['games'][0]['stats']['home']['successes'],35)
        self.assertEqual(result['games'][0]['stats']['home']['rate'],.5+1e-8)

    def test_only_explicit_aliases_authorize_alternate_names_and_ambiguous_sets_fail(self):
        ctx=context();ctx['teams'][0]['aliases']=['A'];ctx['aliasSource']={'sha256':'fixture-pinned-id-link'}
        rows=pair(home='A');result=normalize_advanced(rows,ctx,2025)
        self.assertEqual(len(result['games']),1)
        self.assertEqual(result['audit']['aliasJoinedRows'],2)
        self.assertEqual(result['audit']['aliasJoins'],[{'gameId':'101','teamId':'1','canonicalName':'Alpha','sourceName':'A'}])
        self.assertEqual(result['aliasSource'],ctx['aliasSource'])
        self.assertEqual(normalize_advanced(rows,context(),2025)['games'],[])
        ctx['teams'][1]['aliases']=['A']
        result=normalize_advanced(rows,ctx,2025)
        self.assertEqual(result['games'],[])
        self.assertEqual(result['audit']['exclusionReasons']['ambiguous-context-participant-names'],1)

    def test_duplicates_aliases_one_sided_wrong_seasons_never_form_pairs(self):
        for rows in [pair()[:1],pair()+pair()[:1],pair(home='ALPHA'),pair(home='Alpha '),
                     [{**pair()[0],'season':2024},pair()[1]],
                     [pair()[0],{**pair()[1],'team':'Gamma'}]]:
            with self.subTest(rows=rows):
                self.assertEqual(normalize_advanced(rows,context(),2025)['games'],[])
        rows=pair();rows.append({**pair()[0],'season':2024})
        result=normalize_advanced(rows,context(),2025)
        self.assertEqual(result['audit']['wrongSeasonRows'],1);self.assertEqual(result['games'],[])

    def test_unknown_and_malformed_rows_are_audited_without_fuzzy_matching(self):
        rows=pair()+pair(999)+[None,{'gameId':'n/a'},dict(gameId=101,season=2025,team=None,opponent='Beta')]
        result=normalize_advanced(rows,context(),2025)
        self.assertEqual(result['audit']['outsideContextGameIds'],['999'])
        self.assertEqual(result['audit']['malformedRows'],3)
        self.assertEqual(result['games'],[])

    def test_malformed_name_containers_and_huge_rates_are_rejected_without_crashing(self):
        for value in [[],{},['Alpha']]:
            rows=pair();rows[0]['team']=value
            result=normalize_advanced(rows,context(),2025)
            self.assertEqual(result['games'],[]);self.assertEqual(result['audit']['malformedRows'],1)
        rows=pair();rows[0]['offense']['successRate']=10**1000
        self.assertEqual(normalize_advanced(rows,context(),2025)['games'],[])

    def test_context_lists_and_maps_agree_and_unfinished_games_are_excluded(self):
        ctx=context();mapped={**ctx,'teams':{t['id']:t for t in ctx['teams']},'games':{g['id']:g for g in ctx['games']}}
        self.assertEqual(normalize_advanced(pair(),ctx,2025),normalize_advanced(pair(),mapped,2025))
        ctx['games'][0]['completed']=False
        self.assertEqual(normalize_advanced(pair(),ctx,2025)['audit']['expectedFbsInvolvingGames'],1)
        duplicate=context();duplicate['games'].append(copy.deepcopy(duplicate['games'][0]))
        with self.assertRaises(AdvancedStatError):normalize_advanced(pair(),duplicate,2025)
        with self.assertRaises(AdvancedStatError):normalize_advanced({},context(),2025)

    def test_current_context_keeps_missing_kickoff_null_and_uses_existing_loader(self):
        ctx=context();g=ctx['games'][0];g.update(startDate=None,week=None,seasonType=None)
        loaded={'teams':{t['id']:t for t in ctx['teams']},'games':{g['id']:g},'source':{'kind':'saved graph'}}
        with patch('performance_ingest.load_context',return_value=loaded) as load:
            restored=read_context(2026)
        load.assert_called_once_with(2026)
        rows=[{**r,'season':2026} for r in pair()]
        game=normalize_advanced(rows,restored,2026)['games'][0]
        self.assertIsNone(game['startDate']);self.assertIsNone(game['week']);self.assertIsNone(game['seasonType'])
        with self.assertRaises(AdvancedStatError):read_context(2013)


if __name__=='__main__':unittest.main()
