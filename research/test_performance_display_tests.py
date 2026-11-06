import copy
import unittest

import numpy as np

from adaptive_performance_model import fit_adaptive_performance
from performance_display_tests import joint_system, omitted_coefficients, withheld_check, ranks, validate_forward_pairs


def fixture():
    teams = [dict(id=i, name=i, division='fbs' if i in 'abc' else 'fcs') for i in ['a', 'b', 'c', 'x', 'y']]
    games = [('1','a','b',.6,.4,1),('2','c','a',.5,.7,1),('3','b','x',.7,.3,1),
             ('4','a','y',.6,.4,0),('5','x','y',.4,.5,1),('6','c','x',.55,.35,1),('7','b','c',.4,.5,0)]
    observations = []
    for identity,a,b,ra,rb,venue in games:
        observations.extend([dict(gameId=identity,teamId=a,opponentId=b,rate=ra,plays=100,venue=venue),
                             dict(gameId=identity,teamId=b,opponentId=a,rate=rb,plays=100,venue=-venue)])
    config = dict(ridge=1.,contextPriorStrength=4.,homePrior=.02,divisionPrior=.15)
    return teams,observations,config


class PerformanceDisplayChecks(unittest.TestCase):
    def test_augmented_joint_solution_matches_separate_schur_model(self):
        teams,observations,config=fixture();fitted=fit_adaptive_performance(teams,observations,config)
        ordered,_,_,theta,_,normal,rhs=joint_system(teams,fitted['gameEvidence'],config)
        effects={t['id']:t['effect'] for t in fitted['ratings']}
        expected=[effects[t['id']] for t in ordered]+[fitted['contextFit']['homeRate'],fitted['contextFit']['divisionRate']]
        np.testing.assert_allclose(theta,expected,atol=1e-12,rtol=0)
        np.testing.assert_allclose(normal@theta,rhs,atol=1e-12,rtol=0)

    def test_sherman_morrison_withholding_matches_every_brute_force_joint_refit(self):
        teams,observations,config=fixture();fitted=fit_adaptive_performance(teams,observations,config)
        ordered,design,target,theta,inverse,_,_=joint_system(teams,fitted['gameEvidence'],config)
        for row,game in enumerate(fitted['gameEvidence']):
            actual,denominator=omitted_coefficients(theta,inverse,design[row],target[row])
            brute=fit_adaptive_performance(teams,[o for o in observations if o['gameId']!=game['gameId']],config)
            effects={t['id']:t['effect'] for t in brute['ratings']}
            expected=[effects[t['id']] for t in ordered]+[brute['contextFit']['homeRate'],brute['contextFit']['divisionRate']]
            with self.subTest(game=game['gameId']):
                np.testing.assert_allclose(actual,expected,atol=1e-12,rtol=0)
                self.assertGreater(denominator,0)

    def test_omitted_target_values_cannot_influence_deleted_fit_or_context(self):
        teams,observations,config=fixture();original=copy.deepcopy(observations)
        results=[]
        for poisoned in [False,True]:
            if poisoned:
                for o in observations:
                    if o['gameId']=='3':o['rate']=.99 if o['teamId']=='b' else .01
            fitted=fit_adaptive_performance(teams,observations,config)
            _,design,target,theta,inverse,_,_=joint_system(teams,fitted['gameEvidence'],config)
            index=next(i for i,g in enumerate(fitted['gameEvidence']) if g['gameId']=='3')
            results.append(omitted_coefficients(theta,inverse,design[index],target[index])[0])
        np.testing.assert_allclose(results[0],results[1],atol=1e-12,rtol=0)
        self.assertNotEqual(observations,original)

    def test_descriptive_check_counts_only_fbs_targets_and_exposes_scope(self):
        teams,observations,config=fixture();fitted=fit_adaptive_performance(teams,observations,config)
        report=withheld_check(teams,fitted,config)
        self.assertEqual(report['gamesWithheld'],6)
        self.assertEqual(report['metrics']['FBS-FBS']['games'],3)
        self.assertEqual(report['metrics']['FBS-FCS']['games'],3)
        self.assertIn('NOT a pregame',report['scope'])
        self.assertLess(report['independentJointAgreement'],1e-12)

    def test_shared_ranks_and_inactive_rows_do_not_receive_synthetic_position(self):
        values=dict(a=.1,b=.1,c=.2,d=1.)
        result,order=ranks(values,list(values),dict(a=2,b=2,c=2,d=0))
        self.assertEqual(result,dict(a=2,b=2,c=1,d=None));self.assertEqual(order,['c','a','b'])

    def test_prior_season_must_precede_unique_target_season(self):
        validate_forward_pairs([[2023,2024],[2024,2025],[2025,2026]])
        for pairs in [[],[[2024,2024]],[[2025,2024]],[[2023,2024],[2022,2024]],[[True,2024]]]:
            with self.subTest(pairs=pairs),self.assertRaises(ValueError):validate_forward_pairs(pairs)


if __name__=='__main__':unittest.main()
