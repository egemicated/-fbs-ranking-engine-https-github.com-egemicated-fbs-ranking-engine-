"""Read-only data audit and game-level diagnosis. No provider requests or deploys.

Reads cached inputs and primary-source spot-check fixtures; writes research/results/audit.
"""
from __future__ import annotations

import csv
import hashlib
import html
import json
import math
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from compare_merit import ROOT, ORIGINAL, current_dataset, fit_network, loo_context, merit, sigmoid
from replay_weekly import protected_hashes, timestamp

HERE=Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def duplicate_candidates(data):
    """Flag logical identity collisions without silently choosing a source row.

    Multiple games between the same schools on different UTC dates are preserved.
    A same-date collision is a review candidate, not automatic deletion authority.
    """
    groups=defaultdict(list)
    for game in data["games"]:
        if not game["completed"]:
            continue
        pair=tuple(sorted((game["home"],game["away"])))
        day=datetime.fromtimestamp(timestamp(game["startDate"]),timezone.utc).date().isoformat()
        groups[(pair,day)].append(game)
    result=[]
    for (pair,day),games in groups.items():
        if len(games)<2:
            continue
        scores={tuple((g["homePoints"] if g["home"]==i else g["awayPoints"]) for i in pair) for g in games}
        result.append(dict(teamIds=list(pair),date=day,ids=[g["id"] for g in games],
                           scoreConflict=len(scores)>1,venueConflict=len({g["neutral"] for g in games})>1,
                           action="Review required; no automatic source selection"))
    return result


def scope_network(dataset, exclude_unknown=False, fbs_games_only=False):
    teams=[t for t in dataset["teams"] if not exclude_unknown or t["division"]!="unknown"]
    ids={t["id"] for t in teams}
    fbs={t["id"] for t in teams if t["division"]=="fbs"}
    games=[g for g in dataset["games"] if {g["a"],g["b"]}<=ids and
           (not fbs_games_only or g["a"] in fbs or g["b"] in fbs)]
    return fit_network(dict(teams=teams,games=games))


def current_game_rows(network, parameters=ORIGINAL, leave_out=True):
    context=loo_context(network)
    if not leave_out:
        reference=float(np.mean(network["ratings"][network["fbs"]]))
        context=dict(reference=np.full(len(network["a"]),reference),
                     home=network["ratings"][network["a"]],away=network["ratings"][network["b"]])
    result=defaultdict(list)
    for j,g in enumerate(network["games"]):
        for side in (1,-1):
            index=int(network["a"][j] if side==1 else network["b"][j])
            opponent_index=int(network["b"][j] if side==1 else network["a"][j])
            team=network["teams"][index]; opponent=network["teams"][opponent_index]
            opponent_rating=float(context["away"][j] if side==1 else context["home"][j])
            venue=float(network["venue"][j])*side
            prob=float(sigmoid(parameters[0]*(context["reference"][j]-opponent_rating)+parameters[1]*venue))
            outcome=int(network["y"][j])*side
            result[team["id"]].append(dict(gameId=g["id"],opponentId=opponent["id"],opponent=opponent["name"],
                                          opponentDivision=opponent["division"],result="W" if outcome>0 else "L" if outcome<0 else "T",
                                          venue="home" if venue>0 else "away" if venue<0 else "neutral",
                                          referenceWinProbability=prob,gameValue=(1 if outcome>0 else 0)-prob,
                                          opponentLooColley=opponent_rating))
    return result


def audit_archives():
    raw=subprocess.run(["node","research/audit_sources.mjs"],cwd=ROOT,capture_output=True,text=True,check=True)
    normalized=json.loads(raw.stdout)
    assert all(x["normalizedMatches"] and x["rawHashMatches"] for x in normalized)
    details={}
    for year in range(2004,2027):
        data=json.loads((ROOT/f"data/seasons/{year}.json").read_text())
        teams={t["id"]:t for t in data["teams"]}
        complete=[g for g in data["games"] if g["completed"]]
        fbs={i for i,t in teams.items() if t["division"]=="fbs"}
        fbs_games=[g for g in complete if g["home"] in fbs or g["away"] in fbs]
        counts=Counter(i for g in complete for i in (g["home"],g["away"]))
        candidates=duplicate_candidates(data)
        details[str(year)]=dict(fbsGames=len(fbs_games),fbsVsFbs=sum(g["home"] in fbs and g["away"] in fbs for g in complete),
                               nonFbsOnlyGames=len(complete)-len(fbs_games),
                               lowerDivisionTeamsWithAtMostOneGame=sum(counts[i]<=1 for i,t in teams.items() if t["division"]!="fbs"),
                               fbsNoCompletedGames=[teams[i]["name"] for i in sorted(fbs) if counts[i]==0],
                               duplicatePairSameUtcDate=[dict(teams=[teams[i]["name"] for i in c["teamIds"]],**c) for c in candidates])
    old=json.loads((ROOT/"data/seasons/2019.json").read_text())
    middle=json.loads((ROOT/"data/seasons/2020.json").read_text())
    later=json.loads((ROOT/"data/seasons/2021.json").read_text())
    fbs=lambda d:{t["id"]:t["name"] for t in d["teams"] if t["division"]=="fbs"}
    a,b,c=fbs(old),fbs(middle),fbs(later)
    omissions=[a[i] for i in sorted(set(a)&set(c)-set(b))]
    return dict(rawNormalization=normalized,details=details,
                absentIn2020ButFbsInBothAdjacentSources=omissions,
                membershipCaveat="Adjacent-year continuity flags a roster gap, not independent membership certification.")


def check_official_fixtures(snapshot):
    fixtures=json.loads((HERE/"official-spot-checks.json").read_text())
    checks=[]
    for source in fixtures["sources"]:
        if source["kind"]=="current_snapshot_margins":
            team=next(t for t in snapshot["rankings"] if t["name"]==source["team"])
            stored={g["opponentName"]:g for g in team["contributions"]}
            actual={g["opponent"]:g for g in source["games"]}
            assert set(stored)==set(actual)
            for name,g in actual.items():
                assert stored[name]["finalMargin"]==g["pointsFor"]-g["pointsAgainst"],name
            assert f'{team["wins"]}-{team["losses"]}'==source["record"]
            checks.append(dict(team=source["team"],year=source["season"],games=len(actual),passed=True,
                               checked="Opponent set, record, outcome and score margin; not absolute scores or dates",url=source["url"]))
        else:
            data=json.loads((ROOT/f'data/seasons/{source["season"]}.json').read_text())
            teams={t["id"]:t for t in data["teams"]}; tid=next(i for i,t in teams.items() if t["name"]==source["team"])
            stored={teams[g["away"] if g["home"]==tid else g["home"]]["name"]:
                    (g["homePoints"],g["awayPoints"]) if g["home"]==tid else (g["awayPoints"],g["homePoints"])
                    for g in data["games"] if g["completed"] and tid in (g["home"],g["away"])}
            actual={g["opponent"]:(g["pointsFor"],g["pointsAgainst"]) for g in source["games"]}
            assert stored==actual,(stored,actual)
            checks.append(dict(team=source["team"],year=source["season"],games=len(actual),passed=True,
                               checked="Opponent set and complete final scores",url=source["url"]))
    return checks


def compare_archive_snapshot(snapshot, dataset):
    archive=json.loads((ROOT/"data/seasons/2026.json").read_text())
    by_id={t["id"]:t for t in snapshot["ratings"]}
    current={}
    for team in snapshot["ratings"]:
        for g in team["contributions"]:
            current[(g["gameId"],team["id"])]=g
    matched=[]; conflicting=[]; archived_missing=[]
    venue_conflicts=[]
    reconstructed={g["id"]:g for g in dataset["games"]}
    for g in archive["games"]:
        if not g["completed"]:
            continue
        key=(g["id"],g["home"])
        if key not in current:
            archived_missing.append(g["id"]); continue
        row=current[key]; matched.append(g["id"])
        evidence=reconstructed[g["id"]]
        home_venue=evidence["venue"] if evidence["a"]==g["home"] else -evidence["venue"]
        if home_venue!=(0 if g["neutral"] else 1):
            venue_conflicts.append(g["id"])
        if row["finalMargin"]!=g["homePoints"]-g["awayPoints"] or row["opponentId"]!=g["away"]:
            conflicting.append(g["id"])
    assert not conflicting
    roster={t["id"] for t in archive["teams"] if t["division"]=="fbs"}
    current_roster={t["id"] for t in snapshot["rankings"]}
    unknown=[t for t in snapshot["ratings"] if t["division"]=="unknown"]
    fbs_unknown=[]
    for t in snapshot["rankings"]:
        for g in t["contributions"]:
            if by_id[g["opponentId"]]["division"]=="unknown":
                fbs_unknown.append(dict(team=t["name"],opponent=g["opponentName"],gameId=g["gameId"]))
    return dict(sharedCompletedGames=len(matched),marginOrIdentityConflicts=conflicting,venueConflicts=venue_conflicts,
                completedArchiveGamesAbsentInCurrent=archived_missing,rostersMatch=roster==current_roster,
                caveat="Two imports ultimately derive from CFBD; agreement is consistency evidence, not source independence.",
                unknownTeams=len(unknown),directFbsGamesAgainstUnknown=fbs_unknown,
                currentRawCfbdFileAvailable=(ROOT/"data/raw/cfbd-2026.json").exists(),
                incompleteFinalIds=snapshot["source"]["audit"]["incompleteFinals"])


def model_sensitivity(dataset, original_rows, new_parameters):
    full=fit_network(dataset)
    variants={
        "original":original_rows,
        "noVenue":merit(full,(ORIGINAL[0],0)),
        "changedSlopeOnly":merit(full,(new_parameters[0],ORIGINAL[1])),
        "changedVenueOnly":merit(full,(ORIGINAL[0],new_parameters[1])),
        "changedBoth":merit(full,new_parameters),
        "excludeUnknown":merit(scope_network(dataset,exclude_unknown=True)),
        "fbsInvolvingGamesOnly":merit(scope_network(dataset,fbs_games_only=True)),
        "d1Only":merit(fit_network(dataset,d1_only=True))}
    original={r["id"]:r for r in original_rows}
    summary={}
    for name,rows in variants.items():
        changes=[dict(team=r["team"],original=original[r["id"]]["sorRank"],variant=r["sorRank"],
                      movement=original[r["id"]]["sorRank"]-r["sorRank"]) for r in rows]
        top={r["id"] for r in rows if r["sorRank"]<=25}
        base={r["id"] for r in original_rows if r["sorRank"]<=25}
        summary[name]=dict(sharedTop25=len(top&base),maxRankChange=max(abs(c["movement"]) for c in changes),
                           largestChanges=sorted(changes,key=lambda c:-abs(c["movement"]))[:10])
    return variants,summary


def calibration_by_reference_band():
    from compare_merit import archive_dataset,calibration_observations,probability_metrics
    previous=json.loads((HERE/"results/merit-comparison.json").read_text())
    result={}
    for year in (2023,2024,2025):
        network=fit_network(archive_dataset(year)); context=loo_context(network)
        x,y=calibration_observations(network)
        fbs=set(network["fbs"])
        ids=[j for j,(a,b,outcome) in enumerate(zip(network["a"],network["b"],network["y"])) if a in fbs and b in fbs and outcome!=0]
        # A proxy for evaluating the probability mapping near the average reference.
        # If the near-reference team is away, reverse outcome and the venue sign.
        points=[]
        for k,j in enumerate(ids):
            for side in (1,-1):
                team_strength=context["home"][j] if side==1 else context["away"][j]
                if abs(team_strength-context["reference"][j])<=.1:
                    points.append((x[k]*side,y[k] if side==1 else 1-y[k]))
        xx=np.array([a for a,b in points]); yy=np.array([b for a,b in points])
        result[str(year)]={"original":probability_metrics(xx,yy,ORIGINAL),
                           "recalibrated":probability_metrics(xx,yy,previous["matchingContextParameters"]),
                           "caveat":"Retrospective average-strength neighborhood proxy. A game may appear in both orientations; rows are not independent. No new parameter fitting."}
    return result


def main():
    before=protected_hashes()
    snapshot_bytes=(ROOT/"published/latest.json").read_bytes(); snapshot=json.loads(snapshot_bytes)
    dataset=current_dataset(snapshot); network=fit_network(dataset)
    original=merit(network); games=current_game_rows(network)
    old_report=json.loads((HERE/"results/merit-comparison.json").read_text())
    assert old_report["source"]["snapshotHash"]==snapshot["snapshotHash"]
    parameters=tuple(old_report["matchingContextParameters"])
    variants,sensitivity=model_sensitivity(dataset,original,parameters)
    print("Model sensitivity computed; auditing all stored archive imports",flush=True)
    archives=audit_archives()
    official=check_official_fixtures(snapshot)
    consistency=compare_archive_snapshot(snapshot,dataset)
    duplicate_impact=json.loads(subprocess.run(["node","research/duplicate_impact.mjs"],cwd=ROOT,capture_output=True,text=True,check=True).stdout)
    names={t["id"]:t for t in snapshot["ratings"]}
    sos_order=sorted(snapshot["rankings"],key=lambda t:-t["achievementScheduleStrength"])
    current_sos={t["id"]:i+1 for i,t in enumerate(sos_order)}
    probabilities={i:sum(g["referenceWinProbability"] for g in rows)/len(rows) for i,rows in games.items() if names[i]["division"]=="fbs" and rows}
    aligned_sos={i:k+1 for k,(i,p) in enumerate(sorted(probabilities.items(),key=lambda pair:(pair[1],pair[0])))}
    selected=[]
    for name in ("Texas","UTSA","New Mexico","Miami","Utah","UCLA"):
        team=next(t for t in snapshot["rankings"] if t["name"]==name)
        tid=team["id"]; row=next(r for r in original if r["id"]==tid)
        evidence=games[tid]
        assert abs(sum(g["referenceWinProbability"] for g in evidence)-row["expectedWins"])<1e-10
        assert abs(sum(g["gameValue"] for g in evidence)-row["oagv"])<1e-10
        for g in evidence:
            opponent=names[g["opponentId"]]
            g["opponentCurrentRank"]=opponent.get("rank")
            g["opponentRecord"]=f'{opponent["wins"]}-{opponent["losses"]}'
        selected.append(dict(team=name,record=f'{team["wins"]}-{team["losses"]}',colleyRank=team["rank"],sorRank=row["sorRank"],
                             currentSosRank=current_sos[tid],sorAlignedMeanDifficultyRank=aligned_sos[tid],
                             referenceExpectedWins=row["expectedWins"],referenceMatchProbability=row["tail"],
                             venueCounts=dict(Counter(g["venue"] for g in evidence)),
                             venueNeutralSorRank=next(r for r in variants["noVenue"] if r["id"]==tid)["sorRank"],
                             variants={key:next(r for r in rows if r["id"]==tid)["sorRank"] for key,rows in variants.items()},games=evidence))
    print("Checking reference-neighborhood probability behavior",flush=True)
    calibration=calibration_by_reference_band()
    assert before==protected_hashes()
    implementation_hashes={name:sha((HERE/name).read_bytes()) for name in ("investigate.py","audit_sources.mjs","duplicate_impact.mjs","compare_merit.py","replay_weekly.py","official-spot-checks.json","duplicate-adjudications.json")}
    input_hashes={str(y):sha((ROOT/f"data/seasons/{y}.json").read_bytes()) for y in range(2004,2027)}
    fingerprint=sha(snapshot_bytes+json.dumps(dict(implementation=implementation_hashes,inputs=input_hashes),sort_keys=True).encode())
    output=HERE/"results/audit"/fingerprint[:12]; output.mkdir(parents=True,exist_ok=True)
    report=dict(status="Offline research, no production change",snapshotAsOf=snapshot["asOf"],snapshotHash=snapshot["snapshotHash"],
                auditFingerprint=fingerprint,sourceAudit=archives,officialSpotChecks=official,
                duplicateImpact=duplicate_impact,implementationSha256=implementation_hashes,inputSha256=input_hashes,
                archiveCurrentConsistency=consistency,modelSensitivity=sensitivity,selectedTeams=selected,
                referenceNeighborhoodCalibration=calibration,protectedProductionUnchanged=True,
                limitations=["The direct current CFBD response file is not available locally; contribution symmetry can be verified, but dates, final-score completeness and all venue flags cannot be independently reconstructed from it.",
                             "Official cross-checks cover two selected team-seasons, not all teams or seasons.",
                             "Complete season-specific FBS membership remains uncertified; adjacent-year roster continuity is only a gap flag.",
                             "No new CFBD calls. Public official websites were consulted for the two independent spot-check fixtures.",
                             "An alternative aligned SOS is descriptive mean reference-team game difficulty, not the full season SOR or an independent bonus.",
                             "No recalibration was selected or promoted. All model variations are sensitivity experiments."])
    (output/"audit-and-cases.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    write_report(report,output)
    print(json.dumps(dict(output=str(output),officialSpotChecks=official,consistency=consistency,
                          selected=[{k:t[k] for k in ("team","colleyRank","sorRank","currentSosRank","sorAlignedMeanDifficultyRank","venueCounts","venueNeutralSorRank","variants")} for t in selected],
                          archive2020Omissions=archives["absentIn2020ButFbsInBothAdjacentSources"],
                          duplicateImpact=duplicate_impact,
                          calibration=[dict(year=y,observations=c["original"]["games"],originalLogLoss=c["original"]["logLoss"],recalibratedLogLoss=c["recalibrated"]["logLoss"]) for y,c in calibration.items()]),indent=2),flush=True)


def write_report(report,output):
    selected=report["selectedTeams"]
    rows="".join(f"<tr><td>{html.escape(t['team'])}</td><td>{t['record']}</td><td>{t['colleyRank']}</td><td>{t['sorRank']}</td><td>{t['currentSosRank']}</td><td>{t['sorAlignedMeanDifficultyRank']}</td><td>{t['venueNeutralSorRank']}</td></tr>" for t in selected)
    cases=""
    for t in selected:
        body="".join(f"<tr><td>{html.escape(g['opponent'])}</td><td>{g['opponentRecord']}</td><td>{g['opponentCurrentRank'] or '—'}</td><td>{g['result']}</td><td>{g['venue']}</td><td>{g['referenceWinProbability']:.1%}</td><td>{g['gameValue']:+.3f}</td></tr>" for g in t["games"])
        cases+=f"<h3>{html.escape(t['team'])}: {t['record']}</h3><p>Average-rated FBS reference expected wins: {t['referenceExpectedWins']:.2f}; chance of matching or exceeding the actual win total: {t['referenceMatchProbability']:.2%}. Venue counts: {html.escape(str(t['venueCounts']))}.</p><div class='scroll'><table><tr><th>Opponent</th><th>Record</th><th>Current rank</th><th>Result</th><th>Venue</th><th>Reference win probability</th><th>OAGV</th></tr>{body}</table></div>"
    source_rows="".join(f"<tr><td>{s['year']}</td><td>{s['sourceFbsTeams']}</td><td>{s['completedGames']}</td><td>{s['completedPostseason']}</td><td>{s['unknownDivisionTeams']}</td><td>Yes</td></tr>" for s in report["sourceAudit"]["rawNormalization"])
    calibration_rows="".join(f"<tr><td>{year}</td><td>{c['original']['games']}</td><td>{c['original']['logLoss']:.6f}</td><td>{c['recalibrated']['logLoss']:.6f}</td></tr>" for year,c in report["referenceNeighborhoodCalibration"].items())
    checks="".join(f"<li>{html.escape(c['team'])} {c['year']}: {c['games']} games matched ({html.escape(c['checked'])}). <a href='{html.escape(c['url'],quote=True)}'>Official source</a>.</li>" for c in report["officialSpotChecks"])
    unknown=report["archiveCurrentConsistency"]["unknownTeams"]
    common=report["archiveCurrentConsistency"]["sharedCompletedGames"]
    omissions=", ".join(report["sourceAudit"]["absentIn2020ButFbsInBothAdjacentSources"])
    duplicate_summary="".join(f"<li>{c['year']} {html.escape(c['team'])}: remove {c['removedOccurrences']} duplicate occurrences; stored record {c['originalRecord']} becomes {c['researchRecord']}, matching the official school record. {c['fbsAchievementRankChanges']} FBS achievement positions change in that historical season. <a href='{html.escape(c['source'],quote=True)}'>Official evidence</a>.</li>" for c in report["duplicateImpact"]["affectedSeasons"])
    current_impact=report["duplicateImpact"]["current2026"]
    document=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FBS data audit and ranking cases</title>
<style>body{{font:16px/1.6 system-ui,sans-serif;max-width:1150px;margin:36px auto;padding:0 24px;color:#172b40}}table{{width:100%;border-collapse:collapse;font-size:14px}}th,td{{padding:9px;border-bottom:1px solid #d8e2eb;text-align:left}}th,.note{{background:#edf3f8}}.note{{padding:16px}}.scroll{{overflow:auto}}h2{{margin-top:34px}}a{{color:#145a90}}code{{overflow-wrap:anywhere}}</style>
<h1>Data audit and game-level explanations</h1><p class="note"><strong>Keep production unchanged.</strong> The audit supports the integrity of our stored imports, but exposes coverage and evidence-retention gaps. Venue explains a substantial part of the Texas ranking disagreement. This does not establish a winning replacement.</p>
<p>Stored current snapshot: {report['snapshotAsOf']} (November 5, 2026 Mountain Time). Research fingerprint: <code>{report['auditFingerprint']}</code>.</p>
<h2>1. What passed</h2><p>All 23 stored CSVs (2004–2026) match their recorded SHA-256 source checksums and reproduce the saved normalized teams and games through the production importer. This establishes file integrity and import reproducibility, not external completeness. {common} completed games shared by the 2026 archive and current snapshot agree on opponent identity and final margin; the FBS roster identity sets also agree. Those imports share an upstream provider, so agreement is not independent verification.</p><ul>{checks}</ul>
<h2>2. Actual defects and coverage gaps</h2><p><strong>Eight duplicated historical games were confirmed.</strong> The production importer only merges identical team pairings with identical kickoff timestamps. Different provider IDs and times on the same date survived that check. School results establish that these were single games. A research-only identity overlay, with explicit keep/drop IDs, measures the effect:</p><ul>{duplicate_summary}</ul><p>Rebuilding history with only those duplicate removals changes the current predictive strength by at most {current_impact['maxFbsStrengthChange']:.8f} model points and changes {current_impact['predictiveRankChanges']} current predictive positions. Current achievement and SOR are unchanged because they contain no historical team credit. This is an identity-only experiment: some 2004 duplicate variants also disagree on venue; no venue or classification repair is claimed.</p>
<ul><li><strong>Missing postseason history:</strong> zero postseason rows in every 2004–2022 archive. These cannot be advertised as complete final seasons. They still influenced historical predictive priors and older calibration data; current Colley and SOR achievement have no prior-season team credit.</li><li><strong>Roster gaps:</strong> {html.escape(omissions)} are present as FBS in both adjacent 2019/2021 sources but absent in the 2020 source. This demonstrates that schedule appearance is not a complete membership registry. No absent team should receive an invented record.</li><li><strong>Current raw response retention:</strong> the full direct CFBD response is not present in this local research workspace. We can verify contribution symmetry and recover outcome edges and venue under the published transform, but cannot complete an independent audit of current dates, absolute scores, or the four quarantined final records from that evidence alone.</li><li><strong>Uncertain opponent classifications:</strong> the current graph contains {unknown} unknown-division nodes. None is a direct opponent in a completed FBS game in this snapshot. They are modeled individually, not assigned invented FBS status. Removing these nodes in a sensitivity run leaves SOR Top 25 membership unchanged, although indirect effects exist.</li><li><strong>Coverage changed over time:</strong> early archives largely contain FBS-involving games; later ones contain far more lower-division-only games. That can affect opponent ratings and the transferability of old probability calibration.</li></ul>
<h2>3. Why Texas and UTSA differ</h2><p>Colley gives Texas enough credit for its stronger opponent network to place its 6–2 record above UTSA's 7–1. Original-parameter SOR asks a different question: its estimated average FBS reference has about a 4.2% chance of matching Texas's six wins, versus about 3.4% of matching UTSA's seven wins. That puts UTSA ahead under this SOR specification.</p>
<p>Texas has six home games, one away game and one neutral game in the stored completed schedule. Accounting for home advantage makes its record less surprising than treating all venues as neutral. In an all-teams no-venue sensitivity experiment, Texas moves from SOR #15 to #7; UTSA moves #12 to #16. This is a material model assumption, not a reason to remove venue simply to improve Texas's position.</p>
<div class="scroll"><table><tr><th>Team</th><th>Record</th><th>Colley</th><th>SOR</th><th>Current SOS</th><th>SOR-aligned SOS*</th><th>No-venue SOR</th></tr>{rows}</table></div>
<p>*Experimental SOS ordering uses average difficulty from the same reference probabilities, including exact game removal and venue. #1 is toughest. Current SOS uses mean opponent Colley. Neither SOS is added again as a bonus. A high average difficulty and a rare complete win total are different measurements.</p>
<h2>4. Does the previous recalibration help near the reference team?</h2><p>For an exploratory check, select FBS-vs-FBS observations where a team's leave-one-game-out Colley strength is within 0.1 of that game's average FBS reference. This is a proxy, not an observation of a hypothetical reference team. The subset was investigated after the earlier overall results were known; it is not a fresh independent validation.</p><table><tr><th>Season</th><th>Oriented observations</th><th>Original log loss</th><th>Recalibrated log loss</th></tr>{calibration_rows}</table><p>Lower is better. Both orientations may be included for a game; rows are not independent. These are retrospective excluded-game calculations with other season results visible, not forecasts. No new parameters were fitted. The recalibrated mapping improves this particular slice in each year, but that is an exploratory signal, not proof of better rankings.</p>
<h2>5. Game-level evidence</h2><p>The win probability belongs to the hypothetical average-rated FBS reference, not the actual team. OAGV equals actual win indicator minus that probability. It is an additive diagnostic; it does not decompose SOR exactly. Opponent records and ranks are from the stored full snapshot, while reference probabilities use the evaluated game's exact removal.</p>{cases}
<h2>6. Archive coverage</h2><div class="scroll"><table><tr><th>Season</th><th>Source FBS teams</th><th>Completed games</th><th>Completed postseason</th><th>Unknown-division teams</th><th>Raw/import match</th></tr>{source_rows}</table></div>
<h2>Decision and priorities</h2><ol><li>Keep current production Colley and its separate predictive model unchanged during research.</li><li>Use the confirmed duplicate cases to strengthen identity checks and produce a versioned correction dataset; ambiguous duplicates should be flagged instead of silently choosing an occurrence.</li><li>Before promoting a challenger, retain the next existing weekly response as audit evidence without adding provider calls; verify all quarantined records and membership against authoritative sources.</li><li>Repair historical coverage in a separate research dataset, preserving the existing version and prior results, before rerunning calibration.</li><li>Keep the original SOR parameters as a comparison; no sensitivity experiment here earns promotion.</li><li>Validate venue assumptions across consistent historical populations, then freeze the candidate before collecting genuinely future evidence.</li></ol><p>These are recommendations, not production changes made by this script. No new CFBD calls or paid services were used; public official sources were consulted for spot checks and duplicate adjudication. Protected production files were unchanged.</p>
<p><a href="audit-and-cases.json">Detailed audit, game evidence and sensitivity variants</a> · <a href="selected-team-games.csv">Selected-team game CSV</a></p></html>'''
    (output/"research-findings.html").write_text(document,encoding="utf-8")
    with (output/"selected-team-games.csv").open("w",newline="",encoding="utf-8-sig") as f:
        keys=["team"]+list(selected[0]["games"][0])
        writer=csv.DictWriter(f,fieldnames=keys); writer.writeheader()
        for team in selected:
            for g in team["games"]:
                writer.writerow(dict(team=team["team"],**g))


if __name__=="__main__":
    main()
