"""Math and same-game eligibility safeguards for the composite comparison."""
import copy
import unittest

import composite_historical_experiment as model


def fixture():
    past = ['past'+str(index) for index in range(6)]
    target = dict(id='target', home='1', away='2', homePoints=24, awayPoints=20, neutral=True)
    a = {identity: dict(id=identity, team='Team'+identity, division='fbs', games=4,
                        sor=sor, strength=strength)
         for identity, sor, strength in [('1', 3, 1), ('2', 2, 3), ('3', 1, 2)]}
    b = {identity: dict(score=score, measuredGames=4) for identity, score in [('1',2),('2',1),('3',3)]}
    outcome = dict(year=2024, checkpoints=[dict(block='2024:regular:5', kind='regular', week=5,
                   cutoff='2024-10-01T00:00:00+00:00', eligibleGameIds=past, rows=a, targets=[target])])
    performance = dict(year=2024, checkpoints=[dict(block='2024:regular:5', cutoff=1727740800,
                       eligibleGameIds=past, parentEligibleGameIds=past, targetGameIds=['target'], rows=b)])
    return outcome, performance


class CompositeTests(unittest.TestCase):
    def test_midrank_ties_and_affine_scale_invariance(self):
        scores = {'a': 9., 'b': 4., 'c': 4., 'd': 1.}
        values, ranks = model.percentiles(scores)
        self.assertEqual(values, {'a':100., 'b':50., 'c':50., 'd':0.})
        self.assertEqual(ranks, {'a':1, 'b':2, 'c':2, 'd':4})
        self.assertEqual(model.percentiles({key: 7*value+13 for key,value in scores.items()}), (values,ranks))

    def test_ties_do_not_depend_on_identity_or_input_order(self):
        values, _ = model.percentiles({'z':3.,'a':3.,'b':1.})
        self.assertEqual(values['z'],values['a'])
        self.assertEqual(model.percentiles({'b':1.,'a':3.,'z':3.})[0],values)

    def test_actual_equal_rank_blend_preserves_tie(self):
        outcome, performance = fixture()
        rows, audit = model.join_replays(outcome, performance)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['differences']['triple'],0.)
        self.assertEqual(audit['eligiblePrimary'],1)
        self.assertTrue(rows[0]['componentDisagreement'])

    def test_missing_future_target_stat_does_not_exclude_outcome(self):
        outcome, performance = fixture()
        self.assertNotIn('target',performance['checkpoints'][0]['eligibleGameIds'])
        self.assertEqual(len(model.join_replays(outcome,performance)[0]),1)

    def test_unmeasured_team_is_excluded_not_zero_filled(self):
        outcome, performance = fixture()
        performance['checkpoints'][0]['rows']['1'].update(score=None,measuredGames=0)
        rows, audit = model.join_replays(outcome,performance)
        self.assertEqual(rows,[])
        self.assertEqual(audit['exclusions']['notInCommonPopulation'],1)

    def test_same_graph_cutoff_and_target_exclusion_are_enforced(self):
        mutations = [
            lambda point: point.update(cutoff=1727740801),
            lambda point: point.update(parentEligibleGameIds=[]),
            lambda point: point.update(targetGameIds=['different']),
            lambda point: point['eligibleGameIds'].append('target'),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                outcome, performance = fixture()
                mutate(performance['checkpoints'][0])
                with self.assertRaises(ValueError): model.join_replays(outcome,performance)

    def test_boundary_top25_includes_whole_tied_group(self):
        scores={str(i):float(100-i) for i in range(24)}
        scores.update(a=0.,b=0.)
        _, ranks=model.percentiles(scores)
        self.assertEqual(ranks['a'],25)
        self.assertEqual(ranks['b'],25)

    def test_tie_credit_and_probabilities_are_not_conflated(self):
        outcome, performance=fixture(); rows,_=model.join_replays(outcome,performance)
        calibration={family:dict(coefficients=[0.,0.]) for family in model.FAMILIES}
        metrics=model.metrics(rows,calibration)['models']
        self.assertEqual(metrics['triple']['accuracy'],.5)
        self.assertEqual(metrics['sor']['accuracy'],1.)
        self.assertEqual(metrics['strength']['accuracy'],0.)
        self.assertEqual(metrics['triple']['brier'],.25)
        self.assertEqual(metrics['triple']['probabilityAccuracy'],.5)

    def test_paired_week_resampling_is_reproducible(self):
        outcome, performance=fixture(); rows,_=model.join_replays(outcome,performance)
        rows += [dict(copy.deepcopy(rows[0]),id='other',block='2024:regular:6')]
        calibration={family:dict(coefficients=[0.,0.]) for family in model.FAMILIES}
        a=model.paired_sensitivity(rows,calibration,replicates=30)
        b=model.paired_sensitivity(rows,calibration,replicates=30)
        self.assertEqual(a,b)
        self.assertEqual(a['sor']['accuracy']['sensitivity95'],[-.5,-.5])


if __name__ == '__main__':
    unittest.main()
