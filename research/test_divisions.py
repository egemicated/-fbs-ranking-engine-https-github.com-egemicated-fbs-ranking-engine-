"""Correctness and isolation checks for a new, offline division experiment."""
import copy
import json
import unittest

import numpy as np

from compare_merit import ORIGINAL, fit_network, merit
from replay_weekly import adapt
from test_research import fixture
from division_experiment import (division_indicator, division_merit, extract_observations,
                                fit_mapping, predict)


class DivisionChecks(unittest.TestCase):
    def test_orientation_and_neutral_symmetry(self):
        x=np.array([[.2,1,1],[-.1,0,-1],[.3,-1,0]])
        beta=np.array([4.2,.4,1.1])
        np.testing.assert_allclose(predict(x,beta)+predict(-x,beta),1,atol=1e-14)
        neutral=x.copy();neutral[:,1]=0
        altered=beta.copy();altered[1]=99
        np.testing.assert_array_equal(predict(neutral,beta),predict(neutral,altered))

    def test_zero_gap_and_fbs_only_invariance(self):
        x=np.array([[.2,1,1],[-.1,0,-1],[.3,-1,0]])
        np.testing.assert_array_equal(predict(x,(*ORIGINAL,0)),predict(x,ORIGINAL))
        self.assertEqual(predict(x[2:],(*ORIGINAL,9))[0],predict(x[2:],(*ORIGINAL,0))[0])

    def test_unknown_is_never_assumed_fcs(self):
        with self.assertRaises(ValueError): division_indicator("fbs","unknown")
        self.assertEqual(division_indicator("fbs","fcs"),1)
        self.assertEqual(division_indicator("fcs","fbs"),-1)
        data=fixture();data["teams"][1]["division"]="unknown"
        result=extract_observations(data)
        self.assertNotIn("g1",result["prior-week-only"]["ids"].tolist())
        self.assertNotIn("g1",result["excluded-game-final-network"]["ids"].tolist())

    def test_target_results_do_not_enter_pregame_features(self):
        data=fixture();other=copy.deepcopy(data);other["games"][2]["homePoints"]=99
        before=extract_observations(data)["prior-week-only"]
        after=extract_observations(other)["prior-week-only"]
        i=before["ids"].tolist().index("g3")
        np.testing.assert_array_equal(before["x"][i],after["x"][i])
        self.assertNotEqual(before["y"][i],after["y"][i])

    def test_zero_gap_merit_exactly_reproduces_original(self):
        data=fixture();data["teams"][3]["division"]="fcs"
        network=fit_network(adapt(data,data["games"]))
        old=merit(network,ORIGINAL);new=division_merit(network,(*ORIGINAL,0))
        json.dumps(new)  # Research artifacts must contain portable JSON scalars.
        a={r["id"]:r for r in old};b={r["id"]:r for r in new}
        self.assertEqual(a.keys(),b.keys())
        for identity in a:
            self.assertAlmostEqual(a[identity]["sor"],b[identity]["sor"],places=13)
            self.assertAlmostEqual(a[identity]["expectedWins"],b[identity]["expectedWins"],places=13)
            self.assertEqual(a[identity]["sorRank"],b[identity]["sorRank"])

    def test_fixed_gap_only_changes_crossdivision_game_probability(self):
        data=fixture();data["teams"][3]["division"]="fcs"
        net=fit_network(adapt(data,data["games"]))
        a={r["id"]:r for r in division_merit(net,(*ORIGINAL,0))}
        b={r["id"]:r for r in division_merit(net,(*ORIGINAL,1))}
        self.assertEqual(a["0"]["colley"],b["0"]["colley"])
        self.assertEqual(a["1"]["sor"],b["1"]["sor"])
        self.assertGreater(b["0"]["expectedWins"],a["0"]["expectedWins"])

    def test_fit_recovers_known_probabilities_without_sign_restriction(self):
        rng=np.random.default_rng(4)
        x=np.column_stack((rng.normal(0,.2,1000),rng.integers(-1,2,1000),rng.integers(-1,2,1000)))
        true=np.array([4.,.3,-.8]);y=predict(x,true)
        beta,diagnostic=fit_mapping(x,y)
        np.testing.assert_allclose(beta,true,atol=1e-8)
        self.assertLess(diagnostic["maxAbsGradient"],1e-7)

    def test_unknown_direct_fbs_opponent_refuses_new_sor(self):
        data=fixture();data["teams"][3]["division"]="unknown"
        net=fit_network(adapt(data,data["games"]))
        with self.assertRaises(ValueError): division_merit(net,(*ORIGINAL,1))

    def test_nonfbs_tie_is_context_but_fbs_tie_rejected(self):
        data=fixture();data["teams"][2]["division"]="fcs";data["teams"][3]["division"]="fcs"
        data["games"][1]["homePoints"]=7
        division_merit(fit_network(adapt(data,data["games"])),(*ORIGINAL,1))
        data["games"][0]["homePoints"]=7
        with self.assertRaises(ValueError): division_merit(fit_network(adapt(data,data["games"])),(*ORIGINAL,1))


if __name__=="__main__":unittest.main(verbosity=2)
