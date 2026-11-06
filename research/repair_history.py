"""Versioned historical repair; canonical data and published ratings are untouched.

Adds verified-schema completed FBS postseason games from cached ESPN scoreboards,
cross-checks older scores against the public cfbfastR game-info archive, and applies
the eight explicit identity-only duplicate adjudications. Never imports poll fields.
"""
import copy
import csv
import hashlib
import json
from pathlib import Path

from compare_merit import ROOT
from investigate import duplicate_candidates

HERE=Path(__file__).resolve().parent


def sha(data): return hashlib.sha256(data).hexdigest()


def normalize_event(event,year,teams):
    if not event.get("id"): return None,"missing-event-id"
    if event.get("season",{}).get("year")!=year or event.get("season",{}).get("type")!=3:
        return None,"not-target-postseason"
    if not event.get("status",{}).get("type",{}).get("completed"):
        return None,"not-completed"
    competitions=event.get("competitions",[])
    if len(competitions)!=1: return None,"competition-count"
    game=competitions[0]
    players=game.get("competitors",[])
    home=[t for t in players if t.get("homeAway")=="home"]
    away=[t for t in players if t.get("homeAway")=="away"]
    if len(home)!=1 or len(away)!=1: return None,"missing-orientation"
    home,away=home[0],away[0]
    hid,aid=str(home["id"]),str(away["id"])
    if hid not in teams or aid not in teams: return None,"identity-not-in-season-source"
    if teams[hid]["division"]!="fbs" or teams[aid]["division"]!="fbs": return None,"not-fbs-vs-fbs"
    if type(game.get("neutralSite")) is not bool: return None,"venue-not-explicit"
    try: hp,ap=int(home["score"]),int(away["score"])
    except (KeyError,ValueError,TypeError): return None,"invalid-score"
    if min(hp,ap)<0 or hp==ap: return None,"invalid-final-score"
    if home.get("winner")!=(hp>ap) or away.get("winner")!=(ap>hp): return None,"winner-score-conflict"
    week=event.get("week",{}).get("number")
    if type(week) is not int: return None,"week-not-explicit"
    return dict(id=str(event["id"]),week=week,seasonType="postseason",startDate=event["date"],
                completed=True,neutral=game["neutralSite"],home=hid,away=aid,homePoints=hp,awayPoints=ap),None


def build():
    version="historical-coverage-v1"
    directory=HERE/"datasets"/version; (directory/"seasons").mkdir(parents=True,exist_ok=True)
    source_manifest=json.loads((HERE/"cache/espn-postseason-sources.json").read_text())
    sources={str(x["year"]):x for x in source_manifest}
    legacy_rows=list(csv.DictReader((HERE/"cache/cfb_games_info.csv").open(encoding="utf-8")))
    legacy={str(g["game_id"]):g for g in legacy_rows if g["season_type"]=="postseason" and 2004<=int(g["season"])<=2020}
    adjudications=json.loads((HERE/"duplicate-adjudications.json").read_text())
    report=dict(version=version,scope="FBS postseason coverage and eight identity-only duplicate repairs; not a claim of complete lower-division histories",
                legacySource=dict(url="https://github.com/sportsdataverse/cfbfastR-data/blob/main/schedules/cfb_games_info.csv",
                                  sha256=sha((HERE/"cache/cfb_games_info.csv").read_bytes())),
                scoreboardSources=source_manifest,adjudicationSha256=sha((HERE/"duplicate-adjudications.json").read_bytes()),seasons={},
                limitations=["Source-designated FBS membership is not independently certified for every season.",
                             "2020 source roster still omits three adjacent-year FBS teams; no membership or games are invented.",
                             "Lower-division missing schedules/postseason and 2004 venue conflicts remain unresolved.",
                             "Only whitelisted results/venues are imported; no supplied rankings, odds, probabilities, injuries or player data.",
                             "Postseason kickoff/venue values follow ESPN and may differ from older providers. Corrections are explicitly versioned.",
                             "Historical overtime treatment is unchanged: no new regulation-margin correction is inferred."])
    totals=dict(addedPostseasonGames=0,removedDuplicateOccurrences=0,crossCheckedOlderScores=0)
    for year in range(2004,2026):
        original_bytes=(ROOT/f"data/seasons/{year}.json").read_bytes(); data=json.loads(original_bytes)
        original=json.loads(original_bytes)
        teams={t["id"]:t for t in data["teams"]}; ids={g["id"] for g in data["games"]}
        audit=dict(inputSha256=sha(original_bytes),added=[],excluded=[],crossSourceConflicts=[],orientationDifferences=[],removedDuplicates=[],existingPostseason=sum(g["completed"] and g["seasonType"]=="postseason" for g in data["games"]))
        patch=adjudications["seasons"].get(str(year))
        if patch:
            assert set(patch["dropIds"]+patch["keepIds"])<=ids
            drops=set(patch["dropIds"])
            data["games"]=[g for g in data["games"] if g["id"] not in drops]
            audit["removedDuplicates"]=patch["dropIds"]
            totals["removedDuplicateOccurrences"]+=len(drops)
        if year<=2022:
            for month in (year*100+12,(year+1)*100+1):
                path=HERE/f"cache/espn-month-{month}.json"; raw=path.read_bytes()
                assert sha(raw)==sources[str(month)]["sha256"]
                payload=json.loads(raw)
                assert len(payload["events"])<1000,"Potential source truncation"
                for event in payload["events"]:
                    normalized,reason=normalize_event(event,year,teams)
                    if reason:
                        audit["excluded"].append(dict(id=event.get("id"),reason=reason)); continue
                    if normalized["id"] in ids:
                        audit["excluded"].append(dict(id=event["id"],reason="already-present")); continue
                    old=legacy.get(normalized["id"])
                    if old and old["home_points"] not in ("NA","") and old["away_points"] not in ("NA",""):
                        expected={old["home_id"]:int(old["home_points"]),old["away_id"]:int(old["away_points"])}
                        actual={normalized["home"]:normalized["homePoints"],normalized["away"]:normalized["awayPoints"]}
                        if expected!=actual:
                            audit["crossSourceConflicts"].append(dict(id=event["id"],archive=expected,scoreboard=actual)); continue
                        if old["home_id"]!=normalized["home"]:
                            audit["orientationDifferences"].append(event["id"])
                        totals["crossCheckedOlderScores"]+=1
                    data["games"].append(normalized); ids.add(normalized["id"])
                    audit["added"].append(dict(id=event["id"],sourceMonth=month))
            totals["addedPostseasonGames"]+=len(audit["added"])
        # The supplemental provider can also expose two IDs for one game. Resolve
        # only when one ID is uniquely corroborated by the second archive and the
        # team-oriented scores agree; otherwise stop for evidence review.
        audit["crossArchiveDuplicateResolutions"]=[]
        for collision in duplicate_candidates(data):
            corroborated=[i for i in collision["ids"] if i in legacy]
            added_ids={x["id"] for x in audit["added"]}
            assert not collision["scoreConflict"] and len(corroborated)==1 and set(collision["ids"])<=added_ids, f"Unresolved identity collision in repaired {year}: {collision}"
            keeper=corroborated[0]; drops=set(collision["ids"])-{keeper}
            data["games"]=[g for g in data["games"] if g["id"] not in drops]
            audit["added"]=[g for g in audit["added"] if g["id"] not in drops]
            audit["excluded"].extend(dict(id=i,reason="duplicate-extra-provider-id; unique cross-archive identity retained") for i in sorted(drops))
            audit["crossArchiveDuplicateResolutions"].append(dict(kept=keeper,excluded=sorted(drops),venueConflict=collision["venueConflict"]))
            totals["addedPostseasonGames"]-=len(drops)
        assert not duplicate_candidates(data),f"Unresolved identity collision in repaired {year}"
        data["source"]={**data["source"],"researchRepair":dict(version=version,parentSha256=audit["inputSha256"],
                              addedPostseasonIds=[x["id"] for x in audit["added"]],removedDuplicateIds=audit["removedDuplicates"],
                              sourceUrls=[sources[str(m)]["url"] for m in (year*100+12,(year+1)*100+1)] if year<=2022 else [])}
        encoded=(json.dumps(data,indent=2)+"\n").encode()
        (directory/f"seasons/{year}.json").write_bytes(encoded)
        audit["outputSha256"]=sha(encoded); audit["repairedPostseason"]=sum(g["completed"] and g["seasonType"]=="postseason" for g in data["games"])
        report["seasons"][str(year)]=audit
    report["totals"]=totals
    report["datasetFingerprint"]=sha(json.dumps(report,sort_keys=True).encode())
    (directory/"manifest.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(dict(directory=str(directory),totals=totals,
                         years=[dict(year=y,added=len(a["added"]),conflicts=len(a["crossSourceConflicts"]),postseason=a["repairedPostseason"]) for y,a in report["seasons"].items()]),indent=2))


if __name__=="__main__": build()
