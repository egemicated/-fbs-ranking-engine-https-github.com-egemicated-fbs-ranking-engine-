"""Algebra/accounting checks on a pure research model; no source calls or tuning."""
import copy
import unittest

from advanced_performance_model import fit_advanced_performance


def teams():
    return [dict(id="a", name="Alpha", division="fbs"),
            dict(id="b", name="Beta", division="fbs"),
            dict(id="c", name="Gamma", division="fcs"),
            dict(id="d", name="Delta", division="fcs"),
            dict(id="idle", name="Idle", division="fbs")]


def pair(identity="one", a="a", b="b", rate_a=.6, rate_b=.2, venue=0, plays_a=50, plays_b=50):
    return [dict(gameId=identity, teamId=a, opponentId=b, rate=rate_a, plays=plays_a, venue=venue),
            dict(gameId=identity, teamId=b, opponentId=a, rate=rate_b, plays=plays_b, venue=-venue)]


def config(ridge=2, home=0, division=0):
    return dict(ridge=ridge, homeRate=home, divisionRate=division)


def by_id(result):
    return {row["id"]: row for row in result["ratings"]}


class AdvancedPerformanceChecks(unittest.TestCase):
    def test_one_pair_has_analytic_solution_with_one_game_weight(self):
        result = fit_advanced_performance(teams(), pair(), config())
        rows = by_id(result)
        self.assertAlmostEqual(rows["a"]["effect"], .1)
        self.assertAlmostEqual(rows["b"]["effect"], -.1)
        self.assertEqual(result["gamesUsed"], 1)
        self.assertEqual(result["gameEvidence"][0]["weight"], 1)
        self.assertEqual(rows["a"]["measuredGames"], 1)
        self.assertEqual(rows["a"]["explanation"]["denominator"], 3)
        self.assertLess(result["maxNormalEquationResidual"], 1e-12)

    def test_population_offsets_and_venue_enter_the_observed_equation_once(self):
        result = fit_advanced_performance(teams(), pair(a="a", b="c", rate_a=.7, rate_b=.4, venue=1),
                                          config(home=.02, division=.1))
        rows = by_id(result); game = result["gameEvidence"][0]
        self.assertAlmostEqual(game["adjustedNetRate"], .18)
        self.assertAlmostEqual(rows["a"]["effect"], .045)
        self.assertAlmostEqual(rows["a"]["rating"], .095)
        self.assertAlmostEqual(rows["c"]["rating"], -.095)
        self.assertEqual(rows["a"]["divisionOffset"], .05)
        self.assertEqual(rows["c"]["divisionOffset"], -.05)
        self.assertAlmostEqual(game["predictedNetRate"], .21)
        self.assertAlmostEqual(game["predictedNetRate"], rows["a"]["rating"]-rows["c"]["rating"]+.02)
        self.assertAlmostEqual(game["residual"], .09)

    def test_joint_home_and_division_response_is_exactly_affine(self):
        observations = (pair("one", "a", "b", .6, .4, 1) +
                        pair("two", "a", "c", .7, .3, -1) +
                        pair("three", "c", "d", .5, .6, 1) +
                        pair("four", "d", "b", .3, .55, 0))
        def run(home, division):
            return by_id(fit_advanced_performance(teams(), observations, config(home=home, division=division)))
        zero, home, division, actual = run(0, 0), run(1, 0), run(0, 1), run(.031, .12)
        for identity in zero:
            for field in ("effect", "rating"):
                expected = zero[identity][field] + .031*(home[identity][field]-zero[identity][field]) + .12*(division[identity][field]-zero[identity][field])
                self.assertAlmostEqual(actual[identity][field], expected, places=12)

    def test_game_contributions_exactly_reconcile_every_total_score(self):
        observations = (pair("one", "a", "b", .6, .4, 1) +
                        pair("two", "a", "c", .7, .3, -1) +
                        pair("three", "c", "d", .5, .6, 1))
        result = fit_advanced_performance(teams(), observations, config(ridge=.5, home=.02, division=.1))
        for row in result["ratings"]:
            explanation = row["explanation"]
            self.assertAlmostEqual(sum(g["effectContribution"] for g in explanation["gameContributions"]), row["effect"], places=12)
            self.assertAlmostEqual(explanation["reconstructedRating"], row["rating"], places=12)
            self.assertAlmostEqual(sum(explanation[k] for k in ("observedNetContribution", "venueContribution", "divisionAdjustmentContribution", "opponentContribution")), row["effect"], places=12)
            self.assertEqual(len(explanation["gameContributions"]), row["measuredGames"])
        self.assertLess(result["maxExplanationReconciliationError"], 1e-12)

    def test_observed_residuals_independently_satisfy_regularized_equations(self):
        observations = pair("one", "a", "b", .7, .4, 1) + pair("two", "a", "c", .6, .2, 0)
        result = fit_advanced_performance(teams(), observations, config(ridge=.7, home=.01, division=.08))
        residual_sums = {row["id"]: 0. for row in result["ratings"]}
        for game in result["gameEvidence"]:
            residual_sums[game["a"]] += game["residual"]
            residual_sums[game["b"]] -= game["residual"]
        for row in result["ratings"]:
            self.assertAlmostEqual(residual_sums[row["id"]], .7*row["effect"], places=12)
        self.assertAlmostEqual(sum(row["effect"] for row in result["ratings"]), 0, places=12)

    def test_rate_fit_does_not_reward_more_plays(self):
        observations = pair("one", "a", "b", .6, .4, 1) + pair("two", "a", "c", .7, .3, 0)
        first = fit_advanced_performance(teams(), observations, config(home=.02, division=.1))
        longer = copy.deepcopy(observations)
        for row in longer:
            row["plays"] *= 100 if row["teamId"] == "a" else 7
        second = fit_advanced_performance(teams(), longer, config(home=.02, division=.1))
        self.assertEqual({r["id"]: r["rating"] for r in first["ratings"]}, {r["id"]: r["rating"] for r in second["ratings"]})
        self.assertEqual(first["gameEvidence"], second["gameEvidence"])

    def test_orientation_recoding_and_names_do_not_change_numeric_results(self):
        source_teams = teams(); observations = pair("one", "a", "c", .65, .35, 1) + pair("two", "b", "c", .5, .3, -1)
        before = copy.deepcopy((source_teams, observations))
        first = fit_advanced_performance(source_teams, observations, config(home=.03, division=.11))
        recode = {"a": "z", "b": "b", "c": "a", "d": "d", "idle": "idle"}
        recoded_teams = [dict(t, id=recode[t["id"]], conference="prestige", humanPoll=1) for t in source_teams][::-1]
        recoded_rows = [dict(row, teamId=recode[row["teamId"]], opponentId=recode[row["opponentId"]], win=True, ppa=10000) for row in observations][::-1]
        second = fit_advanced_performance(recoded_teams, recoded_rows, config(home=.03, division=.11))
        self.assertEqual((source_teams, observations), before)
        by_name = {r["team"]: r for r in second["ratings"]}
        for row in first["ratings"]:
            self.assertAlmostEqual(row["rating"], by_name[row["team"]]["rating"], places=12)
        renamed = [dict(t, name="Changed", conference="Other") for t in source_teams]
        third = fit_advanced_performance(renamed, observations, config(home=.03, division=.11))
        self.assertEqual({r["id"]: r["rating"] for r in first["ratings"]}, {r["id"]: r["rating"] for r in third["ratings"]})

    def test_idle_teams_are_unranked_and_equal_evidence_shares_rank(self):
        result = fit_advanced_performance(teams(), pair(rate_a=.4, rate_b=.4), config(division=.1))
        rows = by_id(result)
        self.assertEqual((rows["a"]["rank"], rows["b"]["rank"]), (1, 1))
        self.assertIsNone(rows["idle"]["rank"])
        self.assertIsNone(rows["idle"]["rawOffenseRate"])
        self.assertEqual(rows["idle"]["rating"], .05)
        self.assertTrue(rows["idle"]["provisional"])
        self.assertEqual(rows["a"]["connectedTeams"], 2)
        self.assertNotIn("c", [r["id"] for r in result["rows"]])

    def test_fcs_internal_games_and_opponent_coverage_remain_individual(self):
        result = fit_advanced_performance(teams(), pair("cross", "a", "c", .6, .3) + pair("fcs", "c", "d", .5, .2),
                                          config(division=.1))
        rows = by_id(result)
        self.assertEqual(rows["a"]["minOpponentMeasuredGames"], 2)
        self.assertEqual(rows["c"]["measuredGames"], 2)
        self.assertEqual(rows["a"]["connectedTeams"], 3)
        self.assertNotEqual(rows["c"]["effect"], rows["d"]["effect"])

    def test_bad_or_partial_evidence_is_rejected_instead_of_filled(self):
        observations = pair()
        variants = [observations[:1], observations+observations,
                    [observations[0], dict(observations[1], venue=1)],
                    [observations[0], dict(observations[1], opponentId="c")]]
        for field, value in (("rate", None), ("rate", float("nan")), ("rate", 1.1),
                             ("rate", -.1), ("rate", True), ("plays", 0), ("plays", True), ("venue", True),
                             ("teamId", []), ("opponentId", None)):
            variants.append([dict(observations[0], **{field: value}), observations[1]])
        for rows in variants:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                fit_advanced_performance(teams(), rows, config())
        for bad in ({}, config(ridge=0), config(home=float("inf")), dict(config(), pollWeight=1)):
            with self.subTest(config=bad), self.assertRaises(ValueError):
                fit_advanced_performance(teams(), observations, bad)
        for bad_teams in ([dict(teams()[0], division="unknown")]+teams()[1:], teams()+[teams()[0]]):
            with self.assertRaises(ValueError): fit_advanced_performance(bad_teams, observations, config())

    def test_negative_learned_venue_and_division_coefficients_are_allowed(self):
        result = fit_advanced_performance(teams(), pair(a="a", b="c", venue=1), config(home=-.02, division=-.1))
        self.assertAlmostEqual(result["gameEvidence"][0]["adjustedNetRate"], .52)
        self.assertLess(by_id(result)["a"]["divisionOffset"], 0)


if __name__ == "__main__": unittest.main(verbosity=2)
