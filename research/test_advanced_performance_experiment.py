import copy
import unittest

from advanced_performance_experiment import preweek_features, calibrate, prediction, bootstrap


def game(identity, date, week, home='a', away='b', rate=.6):
    return dict(id=identity,startDate=date,week=week,seasonType='regular',completed=True,
                neutral=False,home=home,away=away,
                stats=dict(home=dict(rate=rate,plays=100),away=dict(rate=.4,plays=100)))


class AdvancedExperimentChecks(unittest.TestCase):
    def fixtures(self):
        teams=[dict(id=i,name=i,division='fcs' if i=='c' else 'fbs') for i in ['a','b','c']]
        games=[game('old','2025-08-01T12:00:00Z',1),game('target','2025-08-08T12:00:00Z',2),
               game('same','2025-08-09T12:00:00Z',2,'a','c'),game('future','2025-08-15T12:00:00Z',3)]
        data=dict(year=2025,teams=teams,games=games)
        return data,copy.deepcopy(data)

    def test_future_and_same_week_rates_do_not_change_pregame_features(self):
        data,parent=self.fixtures();first={r['id']:r for r in preweek_features(data,parent,2)}['target']
        for g in data['games'][1:]:g['stats']['home']['rate']=.99
        second={r['id']:r for r in preweek_features(data,parent,2)}['target']
        for field in ['adjusted','naive','early']:self.assertEqual(first[field],second[field])
        self.assertNotEqual(first['target'],second['target'])

    def test_missing_earliest_box_cannot_shift_full_schedule_cutoff(self):
        data,parent=self.fixtures();data['games'][0]['startDate']='2025-08-07T13:00:00Z'
        parent['games'][0]['startDate']=data['games'][0]['startDate']
        data['games']=[g for g in data['games'] if g['id']!='target']
        row={r['id']:r for r in preweek_features(data,parent,2)}['same']
        self.assertEqual(row['adjusted'],[0.,1.,1.]);self.assertEqual(row['naive'],[0.,1.,1.])

    def test_raw_control_learns_scale_and_context_without_rank_or_sign_constraints(self):
        rows=[]
        for b,h,d in [(.1,1,0),(.3,0,1),(-.2,1,1),(.4,-1,0),(.2,1,-1)]:
            rows.append(dict(naive=[b,h,d],target=.7*b-.02*h+.1*d))
        config=calibrate(rows,'naive')
        self.assertAlmostEqual(config['scale'],.7)
        self.assertAlmostEqual(config['venueFeatureWeight'],-.02)
        self.assertAlmostEqual(config['divisionFeatureWeight'],.1)
        self.assertEqual(config['designRank'],3)
        for row in rows:self.assertAlmostEqual(prediction(row,'naive',config),row['target'])

    def test_dependent_week_block_bootstrap_is_paired_and_deterministic(self):
        rows=[dict(block=str(i//2),target=0.,adjusted=[0.,0.,0.],naive=[.1+i*.001,0.,0.]) for i in range(20)]
        configs=dict(adjusted=dict(homeRate=0.,divisionRate=0.),naive=dict(scale=1.,venueFeatureWeight=0.,divisionFeatureWeight=0.))
        settings=dict(seed=1729,replicates=100,interval=[.025,.975])
        first=bootstrap(rows,configs,settings);self.assertEqual(first,bootstrap(rows,configs,settings))
        self.assertEqual(first['blocks'],10);self.assertGreater(first['interval'][0],0.)


if __name__=='__main__':unittest.main()
