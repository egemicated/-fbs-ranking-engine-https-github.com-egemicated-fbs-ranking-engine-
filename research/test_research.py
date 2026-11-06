"""Meaningful offline safeguards for the research comparison, not production tests."""
import copy
import json
import shutil
import subprocess
import unittest

import numpy as np

from compare_merit import ORIGINAL, ROOT, fit_network, merit, tail_probability, test_math
from replay_weekly import adapt, audit_season, available_games, replay, timestamp, weekly_groups


def fixture():
    return dict(year=2024,teams=[dict(id=str(i),name=f"Team {i}",division="fbs",conference="Example") for i in range(4)],games=[
        dict(id="g1",home="0",away="1",homePoints=10,awayPoints=7,completed=True,neutral=False,
             week=1,seasonType="regular",startDate="2024-09-01T12:00:00Z"),
        dict(id="g2",home="2",away="3",homePoints=17,awayPoints=7,completed=True,neutral=True,
             week=1,seasonType="regular",startDate="2024-09-01T16:00:00Z"),
        dict(id="g3",home="0",away="2",homePoints=21,awayPoints=28,completed=True,neutral=False,
             week=2,seasonType="regular",startDate="2024-09-08T12:00:00Z"),
        dict(id="g4",home="0",away="3",homePoints=14,awayPoints=7,completed=True,neutral=False,
             week=1,seasonType="postseason",startDate="2024-12-08T12:00:00Z")])


class ResearchChecks(unittest.TestCase):
    def test_exact_loo_and_probability_math(self):
        self.assertIn("passed",test_math())

    def test_cutoff_boundary_and_completion(self):
        data=fixture()
        cutoff=timestamp("2024-09-02T12:00:00Z")
        seen={g["id"] for g in data["games"]}
        self.assertEqual([g["id"] for g in available_games(data,seen,cutoff)],["g1"])
        data["games"][0]["completed"]=False
        self.assertEqual(available_games(data,seen,cutoff),[])

    def test_later_outcomes_cannot_change_past_rankings(self):
        data=fixture(); changed=copy.deepcopy(data)
        changed["games"][2]["homePoints"]=100
        first=replay(data,ORIGINAL); second=replay(changed,ORIGINAL)
        # The target week-2 result may not enter its own preweek checkpoint.
        self.assertEqual(first[1],second[1])
        self.assertEqual(first[0]["rows"],[])
        self.assertNotEqual(first[-1]["rows"],second[-1]["rows"])

    def test_season_type_disambiguates_week_numbers(self):
        groups=weekly_groups(fixture())
        self.assertEqual([key for key,_ in groups],[("regular",1),("regular",2),("postseason",1)])

    def test_renaming_and_input_order_do_not_change_scores(self):
        data=fixture(); changed=copy.deepcopy(data)
        changed["teams"].reverse(); changed["games"].reverse()
        for team in changed["teams"]:
            team["name"]="Renamed "+team["id"]; team["conference"]="Different"
        def numeric(d):
            rows=merit(fit_network(adapt(d,sorted(d["games"],key=lambda g:g["id"]))),ORIGINAL)
            return {r["id"]:(r["colley"],r["sor"],r["colleyRank"],r["sorRank"]) for r in rows}
        self.assertEqual(numeric(data),numeric(changed))

    def test_margin_does_not_change_achievement(self):
        data=fixture(); changed=copy.deepcopy(data)
        changed["games"][0]["homePoints"]=77
        self.assertEqual(replay(data,ORIGINAL),replay(changed,ORIGINAL))

    def test_neutral_game_reversal_is_symmetric(self):
        data=fixture(); game=copy.deepcopy(data["games"][1])
        original=merit(fit_network(adapt(data,[game])))
        game["home"],game["away"]=game["away"],game["home"]
        game["homePoints"],game["awayPoints"]=game["awayPoints"],game["homePoints"]
        flipped=merit(fit_network(adapt(data,[game])))
        for a,b in zip(original,flipped):
            self.assertEqual(a["id"],b["id"])
            self.assertAlmostEqual(a["sor"],b["sor"],places=12)

    def test_fixed_schedule_more_wins_improves_sor(self):
        probs=[.2,.4,.8,.6]
        self.assertTrue(all(tail_probability(probs,w)>tail_probability(probs,w+1) for w in range(4)))

    def test_unknown_division_is_not_published_as_fbs(self):
        data=fixture(); data["teams"][0]["division"]="unknown"
        rows=merit(fit_network(adapt(data,data["games"])))
        self.assertNotIn("0",[r["id"] for r in rows])

    def test_bad_source_data_fails_explicitly(self):
        data=fixture(); data["games"].append(copy.deepcopy(data["games"][0]))
        with self.assertRaises(ValueError): audit_season(data)
        data=fixture(); data["games"][0]["homePoints"]=None
        with self.assertRaises(ValueError): audit_season(data)
        with self.assertRaises(ValueError): timestamp("2024-09-01T12:00:00")

    def test_equal_results_share_ranks(self):
        data=fixture(); data["games"]=data["games"][:2]
        rows=merit(fit_network(adapt(data,data["games"])))
        winners=[r for r in rows if r["wins"]==1]
        self.assertEqual([r["colleyRank"] for r in winners],[1,1])

    def test_colley_matches_the_production_implementation(self):
        # Cross-language check uses the real production engine, without writing it.
        node=shutil.which("node")
        self.assertIsNotNone(node,"Node is required for the production-equivalence check")
        data=fixture()
        script="""import {rankSeason} from './src/engine.js';
        let raw=''; for await (const chunk of process.stdin) raw+=chunk;
        const out=rankSeason(JSON.parse(raw));
        console.log(JSON.stringify(out.rankings.map(r=>({id:r.id,score:r.achievement,rank:r.rank}))));"""
        result=subprocess.run([node,"--input-type=module","-e",script],input=json.dumps(data),text=True,
                              cwd=ROOT,capture_output=True,check=True)
        production={r["id"]:r for r in json.loads(result.stdout)}
        for row in merit(fit_network(adapt(data,data["games"]))):
            self.assertAlmostEqual(row["colley"],production[row["id"]]["score"],places=10)
            self.assertEqual(row["colleyRank"],production[row["id"]]["rank"])


if __name__=="__main__":
    unittest.main(verbosity=2)
