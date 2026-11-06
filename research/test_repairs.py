import copy
import hashlib
import json
import unittest
from pathlib import Path

from compare_merit import ROOT
from investigate import duplicate_candidates
from repair_history import normalize_event

HERE=Path(__file__).resolve().parent


def event():
    return {"id":"example","season":{"year":2021,"type":3},"week":{"number":1},"date":"2022-01-01T12:00Z",
            "status":{"type":{"completed":True}},"curatedRank":999,
            "competitions":[{"neutralSite":True,"competitors":[
                {"id":"a","homeAway":"home","score":"21","winner":True},
                {"id":"b","homeAway":"away","score":"7","winner":False}]}]}


class RepairChecks(unittest.TestCase):
    teams={"a":{"division":"fbs"},"b":{"division":"fbs"}}

    def test_result_whitelist_excludes_supplied_polls(self):
        game,reason=normalize_event(event(),2021,self.teams)
        self.assertIsNone(reason)
        self.assertNotIn("curatedRank",game)
        self.assertEqual(game["homePoints"],21)
        self.assertEqual(game["seasonType"],"postseason")

    def test_cancelled_wrong_year_and_inconsistent_winner_are_excluded(self):
        e=event();e["status"]["type"]["completed"]=False
        self.assertEqual(normalize_event(e,2021,self.teams)[1],"not-completed")
        self.assertEqual(normalize_event(event(),2022,self.teams)[1],"not-target-postseason")
        e=event();e["competitions"][0]["competitors"][0]["winner"]=False
        self.assertEqual(normalize_event(e,2021,self.teams)[1],"winner-score-conflict")

    def test_incomplete_identity_or_venue_is_never_invented(self):
        e=event();del e["competitions"][0]["neutralSite"]
        self.assertEqual(normalize_event(e,2021,self.teams)[1],"venue-not-explicit")
        self.assertEqual(normalize_event(event(),2021,{"a":{"division":"fbs"}})[1],"identity-not-in-season-source")
        self.assertEqual(normalize_event({},2021,self.teams)[1],"missing-event-id")

    def test_repaired_version_retains_original_records_except_explicit_drops(self):
        directory=HERE/"datasets/historical-coverage-v1"
        manifest=json.loads((directory/"manifest.json").read_text())
        self.assertEqual(manifest["totals"]["addedPostseasonGames"],674)
        self.assertEqual(manifest["totals"]["removedDuplicateOccurrences"],8)
        for year,audit in manifest["seasons"].items():
            raw=(ROOT/f"data/seasons/{year}.json").read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),audit["inputSha256"])
            original=json.loads(raw)
            encoded=(directory/f"seasons/{year}.json").read_bytes()
            self.assertEqual(hashlib.sha256(encoded).hexdigest(),audit["outputSha256"])
            fixed=json.loads(encoded);by_id={g["id"]:g for g in fixed["games"]}
            self.assertEqual(original["teams"],fixed["teams"])
            for g in original["games"]:
                if g["id"] not in audit["removedDuplicates"]:self.assertEqual(g,by_id[g["id"]])
            self.assertEqual(duplicate_candidates(fixed),[])
            self.assertEqual(audit["crossSourceConflicts"],[])

    def test_both_extra_2013_provider_ids_are_excluded(self):
        manifest=json.loads((HERE/"datasets/historical-coverage-v1/manifest.json").read_text())
        resolutions=manifest["seasons"]["2013"]["crossArchiveDuplicateResolutions"]
        self.assertEqual({r["kept"] for r in resolutions},{"333550309","340010061"})
        self.assertEqual({i for r in resolutions for i in r["excluded"]},{"400520954","400521191"})


if __name__=="__main__": unittest.main(verbosity=2)
