import copy
import json
import unittest

from compare_merit import ROOT,current_dataset,fit_network,merit
from investigate import duplicate_candidates,current_game_rows
from test_research import fixture


class AuditChecks(unittest.TestCase):
    def test_different_ids_and_times_flag_same_game(self):
        data=fixture(); duplicate=copy.deepcopy(data["games"][0])
        duplicate["id"]="different-id"; duplicate["startDate"]="2024-09-01T19:00:00Z"
        data["games"].append(duplicate)
        flags=duplicate_candidates(data)
        self.assertEqual(len(flags),1)
        self.assertFalse(flags[0]["scoreConflict"])
        self.assertIn("Review required",flags[0]["action"])

    def test_conflicting_scores_are_not_silently_resolved(self):
        data=fixture(); duplicate=copy.deepcopy(data["games"][0])
        duplicate["id"]="conflict"; duplicate["homePoints"]=70
        data["games"].append(duplicate)
        self.assertTrue(duplicate_candidates(data)[0]["scoreConflict"])

    def test_real_rematches_are_preserved(self):
        data=fixture(); rematch=copy.deepcopy(data["games"][0])
        rematch["id"]="rematch"; rematch["startDate"]="2024-12-22T12:00:00Z"
        data["games"].append(rematch)
        self.assertEqual(duplicate_candidates(data),[])

    def test_orientation_and_offset_normalization(self):
        data=fixture(); duplicate=copy.deepcopy(data["games"][0])
        duplicate.update(id="reverse",home="1",away="0",homePoints=7,awayPoints=10,
                         startDate="2024-09-01T06:00:00-06:00")
        data["games"].append(duplicate)
        flags=duplicate_candidates(data)
        self.assertEqual(len(flags),1)
        self.assertFalse(flags[0]["scoreConflict"])

    def test_known_eight_duplicates_are_detected(self):
        counts={}
        for year in (2004,2025):
            data=json.loads((ROOT/f"data/seasons/{year}.json").read_text())
            counts[year]=len(duplicate_candidates(data))
        self.assertEqual(counts,{2004:7,2025:1})

    def test_case_game_values_reconcile_with_season_model(self):
        snapshot=json.loads((ROOT/"published/latest.json").read_text())
        network=fit_network(current_dataset(snapshot)); games=current_game_rows(network)
        for row in merit(network):
            details=games[row["id"]]
            self.assertAlmostEqual(sum(g["referenceWinProbability"] for g in details),row["expectedWins"],places=10)
            self.assertAlmostEqual(sum(g["gameValue"] for g in details),row["oagv"],places=10)


if __name__=="__main__":
    unittest.main(verbosity=2)
