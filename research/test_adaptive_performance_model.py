"""Joint-normal-equation and unit/accounting checks; no source data or tuning."""
import copy
import unittest

import numpy as np

from adaptive_performance_model import fit_adaptive_performance, posterior_context
from advanced_performance_model import fit_advanced_performance


def teams():
    return [dict(id=i, name=i.upper(), division="fbs" if i in ("a", "b", "idle") else "fcs")
            for i in ("a", "b", "c", "d", "idle")]


def pair(identity="one", a="a", b="c", ra=.6, rb=.3, venue=0):
    return [dict(gameId=identity, teamId=a, opponentId=b, rate=ra, plays=100, venue=venue),
            dict(gameId=identity, teamId=b, opponentId=a, rate=rb, plays=100, venue=-venue)]


def config(ridge=2., strength=4., home=.02, division=.1):
    return dict(ridge=ridge, contextPriorStrength=strength, homePrior=home, divisionPrior=division)


class AdaptivePerformanceChecks(unittest.TestCase):
    def test_matches_independent_augmented_joint_normal_equations(self):
        source_teams = teams()
        observations = pair("one", "a", "b", .6, .4, 1)+pair("two", "a", "c", .7, .3, -1)+pair("three", "c", "d", .5, .6, 1)+pair("four", "d", "b", .2, .55, 0)
        settings = config(); result = fit_adaptive_performance(source_teams, observations, settings)
        index = {t["id"]: i for i, t in enumerate(source_teams)}; divisions = {t["id"]: t["division"] for t in source_teams}
        x, y = [], []
        for first in observations[::2]:
            second = next(r for r in observations if r["gameId"] == first["gameId"] and r["teamId"] == first["opponentId"])
            row = np.zeros(len(index)+2); row[index[first["teamId"]]] = 1; row[index[first["opponentId"]]] = -1
            row[-2] = first["venue"]; row[-1] = int(divisions[first["teamId"]] == "fbs")-int(divisions[first["opponentId"]] == "fbs")
            x.append(row); y.append(first["rate"]-second["rate"])
        x, y = np.array(x), np.array(y)
        regularizer = np.diag([settings["ridge"]]*len(index)+[settings["contextPriorStrength"]]*2)
        rhs = x.T@y; rhs[-2:] += settings["contextPriorStrength"]*np.array([settings["homePrior"], settings["divisionPrior"]])
        expected = np.linalg.solve(x.T@x+regularizer, rhs)
        self.assertAlmostEqual(result["contextFit"]["homeRate"], expected[-2], places=12)
        self.assertAlmostEqual(result["contextFit"]["divisionRate"], expected[-1], places=12)
        for team in result["ratings"]:
            self.assertAlmostEqual(team["effect"], expected[index[team["id"]]], places=12)
            offset = expected[-1]*(.5 if team["division"] == "fbs" else -.5)
            self.assertAlmostEqual(team["rating"], expected[index[team["id"]]]+offset, places=12)
            self.assertAlmostEqual(team["explanation"]["reconstructedRating"], team["rating"], places=12)
        objective = float(np.sum((y-x@expected)**2)+expected@regularizer@expected
                          -2*settings["contextPriorStrength"]*np.array([settings["homePrior"], settings["divisionPrior"]])@expected[-2:]
                          +settings["contextPriorStrength"]*(settings["homePrior"]**2+settings["divisionPrior"]**2))
        self.assertAlmostEqual(result["jointObjective"], objective, places=12)
        self.assertLess(result["contextFit"]["maxDirectContextStationarityResidual"], 1e-12)

    def test_empty_evidence_returns_population_prior_without_ranking_idle_teams(self):
        settings = config(home=-.02, division=.13)
        result = fit_adaptive_performance(teams(), [], settings)
        self.assertEqual(result["gamesUsed"], 0)
        self.assertEqual(result["contextFit"]["homeRate"], settings["homePrior"])
        self.assertEqual(result["contextFit"]["divisionRate"], settings["divisionPrior"])
        self.assertEqual(result["contextFit"]["Q"], [[0., 0.], [0., 0.]])
        self.assertTrue(all(t["rank"] is None for t in result["rows"]))
        self.assertTrue(all(t["effect"] == 0 for t in result["ratings"]))

    def test_cross_division_completed_evidence_updates_the_prior_analytically(self):
        result = fit_adaptive_performance(teams(), pair(), config(strength=1., home=0.))
        context = result["contextFit"]
        self.assertAlmostEqual(context["Q"][1][1], .5)
        self.assertAlmostEqual(context["b"][1], .15)
        self.assertAlmostEqual(context["divisionRate"], 1/6)
        self.assertEqual(context["homeRate"], 0.)

    def test_large_prior_strength_approaches_the_fixed_context_model(self):
        observations = pair(venue=1)+pair("two", "b", "d", .5, .4, -1)
        settings = config(strength=1e10)
        result = fit_adaptive_performance(teams(), observations, settings)
        fixed = fit_advanced_performance(teams(), observations,
                                        dict(ridge=2., homeRate=.02, divisionRate=.1))
        for field, value in (("homeRate", .02), ("divisionRate", .1)):
            self.assertAlmostEqual(result["contextFit"][field], value, places=9)
        expected = {t["id"]: t["rating"] for t in fixed["ratings"]}
        for row in result["ratings"]:
            self.assertAlmostEqual(row["rating"], expected[row["id"]], places=9)

    def test_target_and_prior_unit_scaling_is_linear_without_play_volume_weights(self):
        observations = pair("one", "a", "c", .3, .1, 1)+pair("two", "b", "c", .2, .1, -1)
        settings = config(); original = fit_adaptive_performance(teams(), observations, settings)
        scaled = copy.deepcopy(observations)
        for row in scaled:
            row["rate"] *= 2; row["plays"] *= 13
        doubled = fit_adaptive_performance(teams(), scaled, config(home=.04, division=.2))
        a = {t["id"]: t for t in original["ratings"]}
        for row in doubled["ratings"]:
            self.assertAlmostEqual(row["rating"], 2*a[row["id"]]["rating"], places=12)
        self.assertAlmostEqual(doubled["contextFit"]["homeRate"], 2*original["contextFit"]["homeRate"], places=12)
        self.assertAlmostEqual(doubled["contextFit"]["divisionRate"], 2*original["contextFit"]["divisionRate"], places=12)

    def test_reordering_names_and_irrelevant_time_metadata_do_not_change_evidence(self):
        source_teams = teams(); observations = pair(venue=1)+pair("two", "b", "d", .5, .4, -1)
        before = copy.deepcopy((source_teams, observations))
        first = fit_adaptive_performance(source_teams, observations, config())
        changed_teams = [dict(t, name="Renamed", conference="Prestige", priorStrength=100) for t in source_teams[::-1]]
        changed_rows = [dict(r, date="2999-01-01", finalMargin=99, humanPoll=1) for r in observations[::-1]]
        second = fit_adaptive_performance(changed_teams, changed_rows, config())
        self.assertEqual(first["contextFit"], second["contextFit"])
        self.assertEqual(first["gameEvidence"], second["gameEvidence"])
        self.assertEqual((source_teams, observations), before)
        # The caller owns cutoff eligibility: dates are never ranking features.

    def test_context_helper_rejects_asymmetry_nonfinite_nonpositive_and_wrong_shapes(self):
        invalid = [([[1, 1], [0, 1]], [0., 0.], [0., 0.], 1),
                   ([[-1, 0], [0, 1]], [0., 0.], [0., 0.], 1),
                   ([[1, 0], [0, 1]], [float("nan"), 0.], [0., 0.], 1),
                   ([[1, 0], [0, 1]], [0., 0.], [0., 0.], 0),
                   ([[1, 0], [0, 1]], [0., 0.], [0., 0.], True),
                   ([[True, False], [False, True]], [0., 0.], [0., 0.], 1),
                   ([[1, 0], [0, 1]], [0., 0.], [0.], 1)]
        for q, b, prior, strength in invalid:
            with self.subTest(Q=q, b=b, prior=prior, strength=strength), self.assertRaises(ValueError):
                posterior_context(q, b, prior, strength)
        for bad in ({}, dict(config(), unknown=1), config(ridge=0), config(strength=-1), config(home=float("inf"))):
            with self.subTest(config=bad), self.assertRaises(ValueError):
                fit_adaptive_performance(teams(), pair(), bad)


if __name__ == "__main__": unittest.main(verbosity=2)
