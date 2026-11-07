"""Current illustration invariants; no invented history or provider outputs."""
import copy
import csv
import io
import math
import unittest

from predictive_v2_current_preview import build_preview, recover_graph, shared_ranks


def csv_text(rows):
    stream=io.StringIO();writer=csv.DictWriter(stream,fieldnames=list(rows[0]))
    writer.writeheader();writer.writerows(rows);return stream.getvalue()


def fixture(count=4):
    config=dict(ridge=3,retention=.75,homeAdvantage=2.5,marginCap=28,probabilityScale=14)
    snapshot=dict(season=2026,asOf='2026-11-06T03:39:55.757Z',snapshotHash='a'*64,
                  source=dict(provider='cfbd'),config=config,gamesUsed=count,ratings=[],rankings=[])
    rows=[]
    for identity,strength in [('1',1.),('2',-1.)]:
        team=dict(id=identity,name='Team'+identity,division='fbs',conference='Example',strength=strength,
                  games=count,wins=count if identity=='1' else 0,losses=0 if identity=='1' else count,contributions=[])
        for index in range(count):
            team['contributions'].append(dict(gameId=str(index+1),opponentId='2' if identity=='1' else '1',
                finalMargin=14 if identity=='1' else -14,
                adjustedMargin=(28*math.tanh(14/28)-2.5)*(1 if identity=='1' else -1)))
            row=dict(game_id=str(index+1),team_id=identity,season='2026',home_away='home' if identity=='1' else 'away',
                     totalYards='400' if identity=='1' else '300',netPassingYards='300' if identity=='1' else '200',
                     rushingYards='100',rushingAttempts='20',completionAttempts='20/30',firstDowns='20',
                     thirdDownEff='5-10',fourthDownEff='1-2',totalPenaltiesYards='5-40',possessionTime='30:00',
                     turnovers='1',fumblesLost='0',interceptions='1')
            rows.append(row)
        snapshot['ratings'].append(team);snapshot['rankings'].append(copy.deepcopy(team))
    sor=copy.deepcopy(snapshot)
    for index,row in enumerate(sor['rankings'],1):row['displayRank']=index
    performance=dict(season=2026,asOf=snapshot['asOf'],baseSnapshotHash=snapshot['snapshotHash'],
                     rankings=[dict(id='1',rank=2),dict(id='2',rank=1)])
    artifact=dict(id='fixture-research',family='strength+efficiency',status='research-only',trainedThroughSeason=2019,
                  experimentFingerprint='older-fixed',currentOwnStrengthConfiguration=config,
                  unitConfiguration=dict(ridge=1,contextPriorStrength=.01,interceptPrior=0,homePrior=0,divisionPrior=0),
                  logistic=dict(columns=['strength','ypp','passingYpp','rushingYpp','completionRate','venue'],
                                coefficients=[1.,.5,.2,.3,.1,.1],scale=[1.]*6))
    return snapshot,rows,artifact,sor,performance


def build(data):
    snapshot,rows,artifact,sor,performance=data
    return build_preview(snapshot,csv_text(rows),artifact,sor,performance,provenance=dict(sourceDataRequests=0),generated_at='2026-11-06T22:00:00Z')


class CurrentPreviewTests(unittest.TestCase):
    def test_preserves_actual_cutoff_graph_and_component_reconciliation(self):
        data=fixture();output=build(data)
        self.assertEqual(output['asOf'],data[0]['asOf'])
        self.assertEqual(output['baseSnapshotHash'],data[0]['snapshotHash'])
        self.assertEqual(output['coverage']['rankedFbsTeams'],2)
        self.assertEqual(output['coverage']['pairedFbsGames'],4)
        self.assertLess(output['validation']['portableNeutralLogOddsAgreement'],1e-10)
        for row in output['rankings']:self.assertAlmostEqual(sum(row['components'].values()),row['score'])

    def test_recovered_graph_never_invents_kickoff_timestamps(self):
        _,games=recover_graph(fixture()[0])
        self.assertEqual(len(games),4)
        self.assertTrue(all('startDate' not in game for game in games))

    def test_boxes_outside_retained_completed_graph_do_not_change_scores(self):
        data=fixture();first=build(data)
        outside=copy.deepcopy(data[1][0]);outside.update(game_id='future',totalYards='99999')
        data[1].append(outside)
        second=build(data)
        self.assertEqual(first['rankings'],second['rankings'])
        self.assertEqual(second['coverage']['ignoredBoxGameIdsOutsidePrimary'],1)

    def test_partial_boxes_are_counted_without_fictitious_raw_observations(self):
        data=fixture(5);data[1][:]=[row for row in data[1] if row['game_id']!='5']
        output=build(data)
        self.assertEqual(output['coverage']['pairedFbsGames'],4)
        self.assertEqual(output['coverage']['expectedFbsGames'],5)
        self.assertEqual(output['coverage']['missingFbsGameIds'],['5'])
        self.assertTrue(all(row['basicMeasuredGames']==4 for row in output['rankings']))
        data=fixture(4);data[1][:]=[row for row in data[1] if row['game_id']!='4']
        with self.assertRaises(ValueError):build(data)

    def test_duplicated_or_wrong_orientation_boxes_do_not_enter_unit_fits(self):
        data=fixture(5);data[1].append(copy.deepcopy(data[1][0]))
        output=build(data)
        self.assertEqual(output['coverage']['pairedFbsGames'],4)
        self.assertEqual(output['coverage']['rawBoxPairIssueCounts']['partial-or-duplicate-box'],1)
        data=fixture(5)
        for row in data[1]:
            if row['game_id']=='1':row['home_away']='away' if row['home_away']=='home' else 'home'
        output=build(data)
        self.assertEqual(output['coverage']['rawBoxPairIssueCounts']['recorded-venue-disagrees'],1)

    def test_stale_comparisons_and_different_model_settings_fail(self):
        data=fixture();data[3]['snapshotHash']='b'*64
        with self.assertRaises(ValueError):build(data)
        data=fixture();data[4]['asOf']='2026-11-05T00:00:00Z'
        with self.assertRaises(ValueError):build(data)
        data=fixture();data[2]['currentOwnStrengthConfiguration']=dict(data[2]['currentOwnStrengthConfiguration'],ridge=99)
        with self.assertRaises(ValueError):build(data)

    def test_provider_model_columns_cannot_sneak_into_candidate(self):
        data=fixture();data[2]['logistic']['columns'][1]='providerPPA'
        with self.assertRaises(ValueError):build(data)

    def test_corrupt_primary_game_reciprocity_is_rejected(self):
        data=fixture();data[0]['ratings'][0]['contributions'][0]['finalMargin']=20
        with self.assertRaises(ValueError):build(data)

    def test_tied_scores_share_rank_and_neutral_orientation_is_immaterial(self):
        self.assertEqual(shared_ranks({'a':1.,'b':1.,'c':0.}),{'a':1,'b':1,'c':3})
        data=fixture()
        for team in data[0]['ratings']:
            sign=1 if team['id']=='1' else -1
            team['contributions'][0]['adjustedMargin']=sign*28*math.tanh(14/28)
        first=build(data)
        for row in data[1]:
            if row['game_id']=='1':row['home_away']='away' if row['home_away']=='home' else 'home'
        self.assertEqual(first['rankings'],build(data)['rankings'])


if __name__=='__main__':
    unittest.main()
