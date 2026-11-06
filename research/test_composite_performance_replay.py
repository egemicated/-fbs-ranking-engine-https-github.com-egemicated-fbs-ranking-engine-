"""Meaningful math and no-future checks for historical composite Performance."""
import copy
import unittest

from composite_performance_replay import checkpoint, pure_agreement, recent_prior_from_data, replay_data


class CompositePerformanceReplayTests(unittest.TestCase):
    def setUp(self):
        self.teams = [dict(id='a', name='Alpha', division='fbs'),
                      dict(id='b', name='Beta', division='fbs'),
                      dict(id='c', name='Context', division='fcs')]
        self.config = dict(ridge=1, contextPriorStrength=64, homePrior=.012, divisionPrior=.21)
        self.games = [self.game('one', 'a', 'c', .60, .25, 1, '2024-08-20T12:00:00Z'),
                      self.game('two', 'b', 'a', .35, .45, 2, '2024-08-27T12:00:00Z'),
                      self.game('three', 'a', 'b', .40, .48, 3, '2024-09-03T12:00:00Z')]

    @staticmethod
    def game(identity, home, away, home_rate, away_rate, week, date):
        return dict(id=identity, home=home, away=away, neutral=False, completed=True,
                    seasonType='regular', week=week, startDate=date,
                    homePoints=28, awayPoints=14,
                    stats=dict(home=dict(rate=home_rate, plays=100), away=dict(rate=away_rate, plays=100)))

    def test_direct_joint_matches_deployed_formula(self):
        result = checkpoint(self.teams, self.games, self.config)
        self.assertLess(pure_agreement(self.teams, self.games, self.config, result), 1e-12)
        self.assertAlmostEqual(sum(row['score'] for row in result['rows'].values()), 0.)
        self.assertEqual(result['rows']['a']['measuredGames'], 3)

    def test_no_games_unranked(self):
        result = checkpoint(self.teams, [], self.config)
        self.assertIsNone(result['rows']['a']['score'])
        self.assertIsNone(result['rows']['b']['score'])
        self.assertAlmostEqual(result['context']['divisionRate'], self.config['divisionPrior'])

    def test_future_stats_cannot_change_past_checkpoint(self):
        data = dict(year=2024, teams=self.teams, games=self.games)
        parent = copy.deepcopy(data)
        prior = dict(priorSeason=2023, latestPriorKickoff=None, config=self.config)
        baseline = replay_data(data, parent, prior)
        changed = copy.deepcopy(data)
        changed['games'][2]['stats']['home']['rate'] = .99
        altered = replay_data(changed, parent, prior)
        self.assertEqual(baseline['checkpoints'][:3], altered['checkpoints'][:3])
        self.assertNotIn('three', baseline['checkpoints'][2]['eligibleGameIds'])
        self.assertEqual(baseline['checkpoints'][2]['targetGameIds'], ['three'])

    def test_missing_future_success_does_not_drop_outcome_target(self):
        parent = dict(year=2024, teams=self.teams, games=self.games)
        data = dict(year=2024, teams=self.teams, games=self.games[:2])
        prior = dict(priorSeason=2023, latestPriorKickoff=None, config=self.config)
        result = replay_data(data, parent, prior)
        self.assertEqual(result['checkpoints'][2]['targetGameIds'], ['three'])

    def test_prior_year_must_be_earlier(self):
        with self.assertRaisesRegex(ValueError, 'preceding season'):
            recent_prior_from_data(dict(year=2024), 2024)

    def test_disagreeing_source_timing_is_rejected(self):
        data = dict(year=2024, teams=self.teams, games=self.games)
        parent = copy.deepcopy(data)
        parent['games'][0]['startDate'] = '2024-08-20T13:00:00Z'
        prior = dict(priorSeason=2023, latestPriorKickoff=None, config=self.config)
        with self.assertRaisesRegex(ValueError, 'timing disagrees'):
            replay_data(data, parent, prior)

    def test_previous_season_must_be_available(self):
        data = dict(year=2024, teams=self.teams, games=self.games)
        prior = dict(priorSeason=2023, latestPriorKickoff=99999999999, config=self.config)
        with self.assertRaisesRegex(ValueError, 'not available'):
            replay_data(data, copy.deepcopy(data), prior)

    def test_24_hour_availability_buffer(self):
        games = copy.deepcopy(self.games)
        games[1]['startDate'] = '2024-08-21T00:00:00Z'
        data = dict(year=2024, teams=self.teams, games=games)
        prior = dict(priorSeason=2023, latestPriorKickoff=None, config=self.config)
        result = replay_data(data, copy.deepcopy(data), prior)
        self.assertEqual(result['checkpoints'][1]['eligibleGameIds'], [])


if __name__ == '__main__':
    unittest.main()
