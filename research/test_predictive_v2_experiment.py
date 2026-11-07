"""Time isolation, older-only selection and prediction invariants."""
import copy
import json
from pathlib import Path
import unittest

import numpy as np

from predictive_v2_experiment import (prepare_observations, replay_features, feature_columns,
    logistic_fit, probabilities, score, choose_configuration, paired_blocks, predict_matchup)
from predictive_v2_ingest import FEATURES

PROTOCOL = json.loads((Path(__file__).parent/'predictive-v2-protocol.json').read_bytes())


def learning_rows():
    rows=[]
    for index,(value,y,venue) in enumerate([(-3,0,0),(-2,0,1),(-1,1,1),(-.5,0,0),(.5,1,0),(1,0,1),(2,1,1),(3,1,0)]):
        rows.append(dict(year=2014,block=f'2014:regular:{index//2}',id=str(index),y=y,venue=venue,
                         features=dict(strength=value,venue=venue)))
    return rows


def replay_fixture():
    teams=[dict(id=identity,name=identity,division='fbs') for identity in ['1','2','3']]
    def side(value): return dict(features={name:value for name in FEATURES})
    past=dict(id='past',home='1',away='2',startDate='2024-09-01T00:00:00Z',neutral=False,
              knownD1=True,stats=dict(home=side(1.),away=side(.5)))
    target=dict(id='future',home='1',away='2',startDate='2024-09-10T00:00:00Z',neutral=False,
                completed=True,homePoints=21,awayPoints=14,knownD1=True,stats=dict(home=side(3.),away=side(2.)))
    data=dict(year=2024,parentSha256='same-parent',teams=teams,games=[past,target],audit={},sourceSha256='raw',sourceManifestSha256='manifest')
    rows={team['id']:dict(id=team['id'],team=team['name'],games=4,strength=2-int(team['id'])) for team in teams}
    outcomes=dict(year=2024,sourceSha256='same-parent',provenance={},checkpoints=[dict(block='2024:regular:3',kind='regular',week=3,
                  cutoff='2024-09-10T00:00:00Z',targets=[target],eligibleGameIds=['past'],rows=rows)])
    return data,outcomes


class ExperimentTests(unittest.TestCase):
    def test_each_opposing_unit_uses_observed_values_without_missing_counterpart(self):
        data,_=replay_fixture();past=data['games'][0]
        past['stats']['home']['features']['fourthDownRate']=None
        observations,counts=prepare_observations([past])
        self.assertEqual(len(observations['ypp']),2)
        self.assertEqual(len(observations['fourthDownRate']),1)
        self.assertEqual(counts['1'],1)

    def test_target_statistics_are_not_features_or_an_eligibility_filter(self):
        data,outcomes=replay_fixture()
        first=replay_features(data,outcomes,1,PROTOCOL)
        data['games'][1]['stats']=None
        second=replay_features(data,outcomes,1,PROTOCOL)
        self.assertEqual(first['rows'],second['rows'])
        self.assertEqual(len(second['rows']),1)

    def test_target_result_change_only_changes_target_label(self):
        data,outcomes=replay_fixture();first=replay_features(data,outcomes,1,PROTOCOL)
        outcomes['checkpoints'][0]['targets'][0]['homePoints']=0
        second=replay_features(data,outcomes,1,PROTOCOL)
        self.assertEqual(first['rows'][0]['features'],second['rows'][0]['features'])
        self.assertNotEqual(first['rows'][0]['y'],second['rows'][0]['y'])

    def test_future_graph_and_availability_buffer_are_enforced(self):
        data,outcomes=replay_fixture();outcomes['checkpoints'][0]['eligibleGameIds'].append('future')
        with self.assertRaises(ValueError): replay_features(data,outcomes,1,PROTOCOL)
        data,outcomes=replay_fixture();data['games'][0]['startDate']='2024-09-09T12:00:00Z'
        with self.assertRaises(ValueError): replay_features(data,outcomes,1,PROTOCOL)

    def test_parent_graph_mismatch_is_rejected(self):
        data,outcomes=replay_fixture();data['parentSha256']='different'
        with self.assertRaises(ValueError): replay_features(data,outcomes,1,PROTOCOL)

    def test_logistic_scaling_is_older_training_only_and_neutral_symmetric(self):
        rows=learning_rows();model=logistic_fit(rows,['strength','venue'],1.)
        p=probabilities([dict(features=dict(strength=2,venue=0)),dict(features=dict(strength=-2,venue=0))],model)
        self.assertAlmostEqual(float(sum(p)),1.)
        before=copy.deepcopy(model)
        probabilities([dict(features=dict(strength=1e6,venue=1))],model)
        self.assertEqual(model,before)
        self.assertEqual(model['trainingYears'],[2014])

    def test_positive_unit_scaling_preserves_predictions(self):
        rows=learning_rows();a=logistic_fit(rows,['strength','venue'],1.)
        scaled=copy.deepcopy(rows)
        for row in scaled:row['features']['strength']*=7
        b=logistic_fit(scaled,['strength','venue'],1.)
        np.testing.assert_allclose(probabilities(rows,a),probabilities(scaled,b),atol=1e-12)

    def test_older_loss_selects_without_consulting_later_performance(self):
        entries=[dict(family='strength+all-counts',ridge=1,penalty=.1,validation=dict(logLoss=.6),laterAccuracy=.99),
                 dict(family='strength+efficiency',ridge=4,penalty=1,validation=dict(logLoss=.5),laterAccuracy=.1)]
        self.assertEqual(choose_configuration(entries,PROTOCOL)['family'],'strength+efficiency')
        entries[1]['validation']['logLoss']=.6
        self.assertEqual(choose_configuration(entries,PROTOCOL)['penalty'],1)

    def test_finite_shrunken_fit_handles_collinear_and_zero_features(self):
        rows=learning_rows()
        for row in rows:row['features'].update(duplicate=row['features']['strength'],zero=0)
        model=logistic_fit(rows,['strength','duplicate','zero','venue'],.1)
        self.assertTrue(all(np.isfinite(model['coefficients'])))
        self.assertEqual(model['scale'][2],1.)
        self.assertEqual(model['coefficients'][2],0.)

    def test_fixed_feature_families_and_paired_comparison_reproduce(self):
        self.assertEqual(len(feature_columns('strength+all-counts',PROTOCOL)),11)
        rows=learning_rows();a=logistic_fit(rows,['strength','venue'],1.)
        self.assertEqual(score(rows,a)['games'],8)
        result=paired_blocks(rows,a,a,replicates=20)
        self.assertEqual(result['logLoss']['weekBlockSensitivity95'],[0.,0.])

    def test_research_forecast_explanation_reconciles_and_preserves_neutral_reversal(self):
        fitted=logistic_fit(learning_rows(),['strength','venue'],1.)
        artifact=dict(logistic=fitted)
        first=predict_matchup(artifact,{},dict(a=2.,b=-1.),'a','b',0)
        opposite=predict_matchup(artifact,{},dict(a=2.,b=-1.),'b','a',0)
        self.assertAlmostEqual(first['homeWinProbability']+opposite['homeWinProbability'],1.)
        self.assertAlmostEqual(sum(first['logOddsContributions'].values()),first['logOdds'])
        self.assertEqual(first['status'],'research-only')
        with self.assertRaises(ValueError):
            predict_matchup(dict(logistic=dict(columns=['providerPPA'])),{},dict(a=2.,b=-1.),'a','b')


if __name__ == '__main__':
    unittest.main()
