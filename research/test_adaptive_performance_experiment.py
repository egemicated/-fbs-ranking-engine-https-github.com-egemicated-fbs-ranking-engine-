import copy
import unittest

from adaptive_performance_experiment import features, adaptive_prediction
from adaptive_performance_model import fit_adaptive_performance
from advanced_performance_experiment import observations


def game(identity, date, week, home='a', away='b', rate=.6):
    return dict(id=identity,startDate=date,week=week,seasonType='regular',completed=True,
                neutral=False,home=home,away=away,
                stats=dict(home=dict(rate=rate,plays=100),away=dict(rate=.4,plays=100)))


class AdaptiveReplayChecks(unittest.TestCase):
    def fixture(self):
        teams=[dict(id=i,name=i,division='fcs' if i=='c' else 'fbs') for i in ['a','b','c']]
        games=[game('old','2025-08-01T12:00:00Z',1),
               game('target','2025-08-08T12:00:00Z',2,'a','c'),
               game('same','2025-08-09T12:00:00Z',2),
               game('future','2025-08-15T12:00:00Z',3)]
        data=dict(year=2025,teams=teams,games=games)
        return data,copy.deepcopy(data)

    def test_same_week_and_future_statistics_cannot_move_context_or_team_features(self):
        data,parent=self.fixture();first={r['id']:r for r in features(data,parent,1)}['target']
        for g in data['games'][1:]:g['stats']['home']['rate']=.99
        second={r['id']:r for r in features(data,parent,1)}['target']
        for key in ['contextQ','contextB','contextGames','adjusted','naive','early']:
            self.assertEqual(first[key],second[key])

    def test_affine_replay_prediction_matches_full_joint_refit_on_identical_past(self):
        data,parent=self.fixture();row={r['id']:r for r in features(data,parent,1)}['target']
        config=dict(ridge=1.,contextPriorStrength=4.,homePrior=.02,divisionPrior=.15)
        direct=fit_adaptive_performance(data['teams'],observations(data['games'][:1]),config)
        rates={r['id']:r['rating'] for r in direct['ratings']}
        expected=rates['a']-rates['c']+direct['contextFit']['homeRate']
        self.assertAlmostEqual(adaptive_prediction(row,config),expected,places=12)

    def test_missing_early_target_preserves_full_week_and_day_buffer(self):
        data,parent=self.fixture();data['games'][0]['startDate']='2025-08-07T13:00:00Z'
        parent['games'][0]['startDate']=data['games'][0]['startDate']
        data['games']=[g for g in data['games'] if g['id']!='target']
        row={r['id']:r for r in features(data,parent,1)}['same']
        self.assertEqual(row['contextGames'],0);self.assertEqual(row['contextQ'],[[0.,0.],[0.,0.]])
        self.assertEqual(row['contextB'],[0.,0.])


if __name__=='__main__':unittest.main()
