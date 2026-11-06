"""Meaningful accounting and algebra checks; no provider calls or chosen settings."""
import copy
import unittest

from performance_model import fit_performance


def fixture():
    teams = [dict(id=i, name=i.upper(), division="fcs" if i == "c" else "fbs") for i in ("a", "b", "c", "idle")]
    rows = [dict(gameId="one", teamId="a", opponentId="b", yards=100, plays=20, venue=0),
            dict(gameId="one", teamId="b", opponentId="a", yards=60, plays=20, venue=0)]
    return teams, rows


class PerformanceChecks(unittest.TestCase):
    def test_single_game_has_analytic_solution_and_idle_teams_are_unranked(self):
        teams, observations = fixture(); result = fit_performance(teams, observations, dict(ridge=2, homeYpp=0))
        rows = {r["id"]: r for r in result["rows"]}
        self.assertAlmostEqual(rows["a"]["rating"], .5); self.assertAlmostEqual(rows["b"]["rating"], -.5)
        self.assertEqual((rows["a"]["rank"], rows["b"]["rank"]), (1, 2))
        self.assertIsNone(rows["idle"]["rank"]); self.assertIsNone(rows["idle"]["rawOffenseYpp"])
        self.assertEqual(result["gamesUsed"], 1); self.assertEqual(result["gameEvidence"][0]["weight"], 1)

    def test_reordered_renamed_inputs_and_irrelevant_wins_margins_do_not_change_scores(self):
        teams, rows = fixture(); original = copy.deepcopy((teams, rows)); first = fit_performance(teams, rows, dict(ridge=2, homeYpp=.2))
        teams.reverse(); rows.reverse()
        for t in teams: t.update(name="renamed", conference="prestige", wins=99, pollRank=1)
        for r in rows: r.update(finalMargin=100, score=90, sacks=20, turnovers=5)
        second = fit_performance(teams, rows, dict(ridge=2, homeYpp=.2))
        self.assertEqual({r["id"]: r["rating"] for r in first["ratings"]}, {r["id"]: r["rating"] for r in second["ratings"]})
        self.assertEqual(first["gameEvidence"], second["gameEvidence"])
        self.assertEqual(original[1][0]["yards"], 100)

    def test_equal_rates_do_not_reward_play_volume_and_negative_yards_are_valid(self):
        teams, rows = fixture(); first = fit_performance(teams, rows, dict(ridge=2, homeYpp=0))
        rows[0]["yards"] *= 4; rows[0]["plays"] *= 4
        second = fit_performance(teams, rows, dict(ridge=2, homeYpp=0))
        self.assertEqual(first["rows"][0]["rating"], second["rows"][0]["rating"])
        rows[0]["yards"] = -8
        self.assertLess(fit_performance(teams, rows, dict(ridge=2, homeYpp=0))["rows"][-2]["rating"], 0)

    def test_venue_is_oriented_once_and_units_scale_linearly(self):
        teams, rows = fixture(); rows[0]["venue"] = 1; rows[1]["venue"] = -1
        result = fit_performance(teams, rows, dict(ridge=2, homeYpp=.5))
        self.assertEqual(result["rows"][0]["rating"], .375)
        scaled = copy.deepcopy(rows)
        for r in scaled: r["yards"] *= 3
        after = fit_performance(teams, scaled, dict(ridge=2, homeYpp=1.5))
        self.assertAlmostEqual(after["rows"][0]["rating"], 3*result["rows"][0]["rating"])
        self.assertEqual(result["gameEvidence"][0]["adjustedNetYpp"], 1.5)

    def test_home_response_is_affine_for_cutoff_safe_older_parameter_calibration(self):
        teams, rows = fixture(); rows[0]["venue"] = 1; rows[1]["venue"] = -1
        rows.extend([dict(gameId="two", teamId="b", opponentId="c", yards=90, plays=25, venue=-1),
                     dict(gameId="two", teamId="c", opponentId="b", yards=30, plays=25, venue=1)])
        def fitted(home):
            return {r["id"]: r["rating"] for r in fit_performance(teams, rows, dict(ridge=2, homeYpp=home))["ratings"]}
        zero, unit, actual = fitted(0), fitted(1), fitted(.37)
        for identity, value in actual.items():
            self.assertAlmostEqual(value, zero[identity]+.37*(unit[identity]-zero[identity]), places=12)

    def test_missing_duplicate_conflicting_and_zero_denominator_data_are_rejected(self):
        teams, rows = fixture()
        variants = [rows[:1], rows+rows, [rows[0], dict(rows[1], venue=1)], [rows[0], dict(rows[1], opponentId="c")],
                    [dict(rows[0], plays=0), rows[1]], [dict(rows[0], yards=None), rows[1]], [dict(rows[0], plays=True), rows[1]]]
        for observations in variants:
            with self.subTest(observations=observations):
                with self.assertRaises(ValueError): fit_performance(teams, observations, dict(ridge=2, homeYpp=0))
        for config in ({}, dict(ridge=0, homeYpp=0), dict(ridge=2, homeYpp=float("nan")), dict(ridge=2, homeYpp=0, pollWeight=1)):
            with self.assertRaises(ValueError): fit_performance(teams, rows, config)

    def test_fcs_opponents_are_modeled_without_human_bonus_or_forced_publication(self):
        teams, rows = fixture(); rows[0]["opponentId"] = "c"; rows[1].update(teamId="c", opponentId="a")
        result = fit_performance(teams, rows, dict(ridge=2, homeYpp=0))
        self.assertEqual(result["rows"][0]["id"], "a"); self.assertNotIn("c", [r["id"] for r in result["rows"]])
        self.assertAlmostEqual(next(r for r in result["ratings"] if r["id"] == "c")["rating"], -.5)
        self.assertEqual(result["rows"][0]["minOpponentMeasuredGames"], 1)

    def test_same_evidence_shares_rank_and_inputs_are_unchanged(self):
        teams, rows = fixture(); rows[1]["yards"] = 100; before = copy.deepcopy((teams, rows))
        result = fit_performance(teams, rows, dict(ridge=2, homeYpp=0))
        self.assertEqual([r["rank"] for r in result["rows"] if r["measuredGames"]], [1, 1])
        self.assertEqual((teams, rows), before)


if __name__ == "__main__": unittest.main(verbosity=2)
