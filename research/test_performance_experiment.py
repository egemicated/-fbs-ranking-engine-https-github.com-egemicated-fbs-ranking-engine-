"""Chronological feature checks on a small schedule with missing box scores."""
import copy
import unittest

from performance_experiment import preweek_features


def game(identity, date, week, home='a', away='b', net=1.):
    return dict(id=identity,startDate=date,week=week,seasonType='regular',
                completed=True,neutral=False,home=home,away=away,
                stats={'home':{'yards':int((5+net)*50),'plays':50,'yardsPerPlay':5+net},
                       'away':{'yards':250,'plays':50,'yardsPerPlay':5.}})


class ChronologicalFeatures(unittest.TestCase):
    def fixtures(self):
        teams=[dict(id=i,name=i,division='fbs') for i in ('a','b','c')]
        games=[game('past','2025-08-01T12:00:00Z',1),
               game('target','2025-08-08T12:00:00Z',2),
               game('same-week','2025-08-09T12:00:00Z',2,'a','c'),
               game('future','2025-08-15T12:00:00Z',3)]
        data=dict(year=2025,teams=teams,games=games)
        return data,dict(year=2025,teams=teams,games=copy.deepcopy(games))

    def test_target_same_week_and_future_stats_cannot_change_target_prediction(self):
        data,parent=self.fixtures()
        first={r['id']:r for r in preweek_features(data,parent,2)}['target']
        poisoned=copy.deepcopy(data)
        for g in poisoned['games'][1:]:
            g['stats']['home'].update(yards=2000,yardsPerPlay=40.)
        second={r['id']:r for r in preweek_features(poisoned,parent,2)}['target']
        for key in ('neutralPrediction','homeResponse','naiveDifference','early'):
            self.assertEqual(first[key],second[key])
        self.assertNotEqual(first['target'],second['target'])

    def test_unmeasured_game_still_anchors_week_cutoff_and_24_hour_buffer(self):
        data,parent=self.fixtures()
        # This past-week game is only 23h before the full next-week cutoff.
        data['games'][0]['startDate']='2025-08-07T13:00:00Z'
        parent['games'][0]['startDate']=data['games'][0]['startDate']
        # Remove the earliest target's stats. Its scheduled kickoff still
        # determines what was knowable for the entire held-out week.
        data['games']=[g for g in data['games'] if g['id']!='target']
        rows={r['id']:r for r in preweek_features(data,parent,2)}
        self.assertEqual(rows['same-week']['neutralPrediction'],0.)
        self.assertEqual(rows['same-week']['homeResponse'],1.)
        self.assertTrue(rows['same-week']['early'])

    def test_eligible_old_statistics_do_influence_later_features(self):
        data,parent=self.fixtures()
        first={r['id']:r for r in preweek_features(data,parent,2)}['target']
        data['games'][0]['stats']['home'].update(yards=500,yardsPerPlay=10.)
        second={r['id']:r for r in preweek_features(data,parent,2)}['target']
        self.assertNotEqual(first['neutralPrediction'],second['neutralPrediction'])


if __name__=='__main__':unittest.main()
