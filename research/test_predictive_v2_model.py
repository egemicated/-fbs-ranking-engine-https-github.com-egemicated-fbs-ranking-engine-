"""Independent normal-system, attribution and invariance checks for unit fits."""
import copy
import json
import unittest

import numpy as np

from predictive_v2_model import fit_units, fit_unit_metrics, matchup_features


def teams():
    return [dict(id=identity, name=identity.upper(), division="fbs" if identity in ("a", "b", "idle") else "fcs")
            for identity in ("a", "b", "c", "d", "idle")]


def pair(game="one", offense="a", defense="b", first=7., second=4., venue=1):
    return [dict(gameId=game, offense=offense, defense=defense, value=first, venue=venue),
            dict(gameId=game, offense=defense, defense=offense, value=second, venue=-venue)]


def config(**changes):
    return dict(ridge=2., contextPriorStrength=.2, interceptPrior=4.5, homePrior=.1, divisionPrior=.5, **changes)


def sample():
    return pair() + pair("two", "b", "c", 6., 3., -1) + pair("three", "c", "d", 5., 5.5, 0) + pair("four", "d", "a", 2., 7., 1)


class OriginalUnitChecks(unittest.TestCase):
    def test_exact_fit_matches_independent_augmented_normal_equations(self):
        population = teams(); observations = sample(); settings = config()
        fitted = fit_units(population, observations, settings)
        ids = {team["id"]: index for index, team in enumerate(population)}; n = len(ids)
        divisions = {team["id"]: team["division"] for team in population}
        x = np.zeros((len(observations), 2*n+3))
        for index, row in enumerate(observations):
            x[index, ids[row["offense"]]] = 1
            x[index, n+ids[row["defense"]]] = 1
            x[index, -3:] = [1., row["venue"], int(divisions[row["offense"]] == "fbs") - int(divisions[row["defense"]] == "fbs")]
        y = np.array([row["value"] for row in observations])
        penalties = np.diag([settings["ridge"]]*(2*n)+[settings["contextPriorStrength"]]*3)
        prior = np.zeros(2*n+3); prior[-3:] = [settings["interceptPrior"], settings["homePrior"], settings["divisionPrior"]]
        expected = np.linalg.solve(x.T@x+penalties, x.T@y+penalties@prior)
        actual = {row["id"]: row for row in fitted["ratings"]}
        for identity, index in ids.items():
            self.assertAlmostEqual(actual[identity]["offenseEffect"], expected[index], places=12)
            self.assertAlmostEqual(actual[identity]["allowanceEffect"], expected[n+index], places=12)
        for field, value in zip(("intercept", "homeEffect", "divisionEffect"), expected[-3:]):
            self.assertAlmostEqual(fitted["context"][field], value, places=12)
        objective = float(np.sum((y-x@expected)**2)+(expected-prior)@penalties@(expected-prior))
        self.assertAlmostEqual(fitted["fitDiagnostics"]["objective"], objective, places=11)
        self.assertLess(fitted["fitDiagnostics"]["maximumNormalEquationResidual"], 1e-11)

    def test_empty_evidence_keeps_prior_and_explicit_unmeasured_units(self):
        fitted = fit_units(teams(), [], config())
        self.assertEqual(fitted["gamesUsed"], 0)
        self.assertEqual(fitted["context"], dict(intercept=4.5, homeEffect=.1, divisionEffect=.5))
        for row in fitted["ratings"]:
            self.assertEqual(row["offenseEffect"], 0.)
            self.assertEqual(row["allowanceEffect"], 0.)
            self.assertFalse(row["measured"])
            self.assertEqual(row["measuredGames"], 0)
        predicted = matchup_features(fitted, "a", "c", 1)
        self.assertAlmostEqual(predicted["difference"], 1.2)
        self.assertFalse(predicted["measuredBoth"])

    def test_shared_design_multiple_rhs_equals_independent_fits(self):
        observations = sample(); alternate = copy.deepcopy(observations)
        for index, row in enumerate(alternate): row["value"] = (index+1)/17
        together = fit_unit_metrics(teams(), {"ypp": observations, "rate": alternate}, config())
        for family, rows in (("ypp", observations), ("rate", alternate)):
            independent = fit_units(teams(), rows, config())
            for row, expected in zip(together[family]["ratings"], independent["ratings"]):
                self.assertAlmostEqual(row["offenseEffect"], expected["offenseEffect"], places=12)
                self.assertAlmostEqual(row["allowanceEffect"], expected["allowanceEffect"], places=12)
            self.assertEqual(together[family]["fitDiagnostics"]["sharedSolveRhsColumns"], 2)

    def test_different_missing_metric_games_do_not_share_or_impute_a_design(self):
        all_rows = sample(); partial = pair()
        together = fit_unit_metrics(teams(), {"full": all_rows, "partial": partial, "empty": []}, config())
        self.assertEqual(together["full"]["gamesUsed"], 4)
        self.assertEqual(together["partial"]["gamesUsed"], 1)
        self.assertEqual(together["empty"]["gamesUsed"], 0)
        empty_d = next(row for row in together["partial"]["ratings"] if row["id"] == "d")
        self.assertFalse(empty_d["measured"])
        self.assertEqual(together["partial"]["fitDiagnostics"]["sharedSolveRhsColumns"], 1)

    def test_matchup_reconciles_units_context_and_swapped_orientation(self):
        fitted = fit_units(teams(), sample(), config())
        forward = matchup_features(fitted, "a", "c", 1)
        reverse = matchup_features(fitted, "c", "a", -1)
        self.assertAlmostEqual(forward["homeExpected"], reverse["awayExpected"], places=12)
        self.assertAlmostEqual(forward["awayExpected"], reverse["homeExpected"], places=12)
        self.assertAlmostEqual(forward["difference"], -reverse["difference"], places=12)
        self.assertAlmostEqual(forward["difference"], sum(forward["components"].values()), places=12)
        neutral = matchup_features(fitted, "a", "c", 0)
        self.assertAlmostEqual(forward["difference"]-neutral["difference"], 2*fitted["context"]["homeEffect"], places=12)
        rows = {row["id"]: row for row in fitted["ratings"]}
        expected_home = fitted["context"]["intercept"]+rows["a"]["totalOffenseEffect"]+rows["c"]["totalAllowanceEffect"]+fitted["context"]["homeEffect"]
        self.assertAlmostEqual(forward["homeExpected"], expected_home, places=12)

    def test_linear_unit_scaling_scales_effects_and_context_without_manual_direction(self):
        observations = sample(); settings = config(); original = fit_units(teams(), observations, settings)
        scaled = copy.deepcopy(observations)
        for row in scaled: row["value"] *= -3
        settings.update(interceptPrior=-13.5, homePrior=-.3, divisionPrior=-1.5)
        transformed = fit_units(teams(), scaled, settings)
        for field, value in original["context"].items():
            self.assertAlmostEqual(transformed["context"][field], -3*value, places=11)
        for row, expected in zip(transformed["ratings"], original["ratings"]):
            for field in ("offenseEffect", "allowanceEffect"):
                self.assertAlmostEqual(row[field], -3*expected[field], places=11)

    def test_input_order_labels_irrelevant_rank_fields_and_nonmutation(self):
        population = teams(); observations = sample(); original = copy.deepcopy((population, observations))
        first = fit_units(population, observations, config())
        shuffled_teams = list(reversed(copy.deepcopy(population)))
        for team in shuffled_teams: team.update(name="Different "+team["id"], conference="Changed", pollRank=1)
        shuffled_observations = list(reversed(copy.deepcopy(observations)))
        for row in shuffled_observations: row.update(ppa=99999, bettingLine=-70, pollRank=1)
        second = fit_units(shuffled_teams, shuffled_observations, config())
        self.assertEqual(first["context"], second["context"])
        for left, right in zip(first["ratings"], second["ratings"]):
            self.assertEqual(left["offenseEffect"], right["offenseEffect"])
            self.assertEqual(left["allowanceEffect"], right["allowanceEffect"])
        self.assertEqual((population, observations), original)
        json.dumps(first, allow_nan=False)

    def test_one_sided_opportunity_is_retained_without_inventing_reciprocal_value(self):
        fitted=fit_units(teams(),pair()[:1],config())
        self.assertEqual(fitted["gamesUsed"],1)
        self.assertEqual(fitted["observationsUsed"],1)
        self.assertEqual(fitted["coverage"],dict(pairedGames=0,oneSidedGames=1,oneSidedGameIds=["one"]))
        rows={row["id"]:row for row in fitted["ratings"]}
        self.assertEqual(rows["a"]["offenseGames"],1)
        self.assertEqual(rows["a"]["defenseGames"],0)
        self.assertEqual(rows["b"]["offenseGames"],0)
        self.assertEqual(rows["b"]["defenseGames"],1)
        self.assertEqual(rows["a"]["allowanceEffect"],0.)
        self.assertEqual(rows["b"]["offenseEffect"],0.)
        self.assertFalse(matchup_features(fitted,"a","b")["measuredBoth"])

    def test_duplicate_nonreciprocal_and_bad_venue_games_fail(self):
        changes = [lambda rows: rows.extend(copy.deepcopy(rows)),
                   lambda rows: rows[1].update(defense="c"), lambda rows: rows[1].update(venue=1),
                   lambda rows: rows[0].update(value=float("nan")), lambda rows: rows[0].update(value=True)]
        for change in changes:
            observations = pair(); change(observations)
            with self.subTest(change=change), self.assertRaises(ValueError):
                fit_units(teams(), observations, config())

    def test_explicit_population_config_and_known_matchups_are_required(self):
        for population in ([], [dict(id="a", name="A", division="unknown")], teams()+[teams()[0]]):
            with self.assertRaises(ValueError): fit_units(population, [], config())
        for settings in ({}, dict(config(), ridge=0), dict(config(), contextPriorStrength=-1), dict(config(), hiddenWeight=2)):
            with self.assertRaises(ValueError): fit_units(teams(), [], settings)
        fitted = fit_units(teams(), [], config())
        for a, b, venue in (("a", "a", 0), ("unknown", "b", 1), ("a", "b", True), ("a", "b", 2)):
            with self.assertRaises(ValueError): matchup_features(fitted, a, b, venue)


if __name__ == "__main__":
    unittest.main()
