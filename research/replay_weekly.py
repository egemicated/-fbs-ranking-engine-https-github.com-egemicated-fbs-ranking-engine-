"""Cutoff-safe, offline achievement comparison. Writes only research/results/weekly.

Run: python research/replay_weekly.py
No new calibration, no polls, no provider access, and no production imports/writes.
"""
from __future__ import annotations

import csv
import hashlib
import html
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from compare_merit import ROOT, fit_network, merit

RESEARCH = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def timestamp(value):
    parsed=datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp requires an explicit timezone")
    return parsed.timestamp()


def protected_hashes():
    files = []
    for folder in ("src", "frontend", "published", ".github"):
        files.extend(p for p in (ROOT/folder).rglob("*") if p.is_file())
    files.extend(ROOT/f for f in ("data/model.json", "package.json", "METHODOLOGY.md", "deployment.json"))
    return {str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in sorted(files)}


def audit_season(data):
    ids = [t["id"] for t in data["teams"]]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate team identity")
    ids = set(ids)
    games = set()
    for g in data["games"]:
        if g["id"] in games or g["home"] == g["away"] or not {g["home"],g["away"]} <= ids:
            raise ValueError(f"Invalid game identity {g['id']}")
        games.add(g["id"])
        timestamp(g["startDate"])
        if not isinstance(g["completed"],bool) or not isinstance(g["neutral"],bool):
            raise ValueError("Completion and venue must be explicit booleans")
        if g["seasonType"] not in ("regular","postseason"):
            raise ValueError("Unrecognized season type")
        if g["completed"] and any(type(g[k]) is not int or g[k]<0 for k in ("homePoints","awayPoints")):
            raise ValueError("Invalid completed score")
    return dict(teams=len(ids), sourceFbsTeams=sum(t["division"]=="fbs" for t in data["teams"]),
                divisionCounts=dict(Counter(t["division"] for t in data["teams"])),
                completedGames=sum(g["completed"] for g in data["games"]),
                incompleteExcluded=sum(not g["completed"] for g in data["games"]),
                completedPostseasonGames=sum(g["completed"] and g["seasonType"]=="postseason" for g in data["games"]))


def weekly_groups(data):
    groups = defaultdict(list)
    for g in data["games"]:
        if g["completed"]:
            groups[(g["seasonType"],g["week"])].append(g)
    return sorted(groups.items(),key=lambda item:(min(timestamp(g["startDate"]) for g in item[1]),item[0]))


def available_games(data, seen, cutoff):
    return sorted((g for g in data["games"] if g["completed"] and g["id"] in seen
                   and timestamp(g["startDate"])+86400 <= cutoff),key=lambda g:g["id"])


def adapt(data, games):
    return dict(teams=sorted(data["teams"],key=lambda t:t["id"]),games=[dict(
        id=g["id"],a=g["home"],b=g["away"],
        outcome=(g["homePoints"]>g["awayPoints"])-(g["homePoints"]<g["awayPoints"]),
        venue=0 if g["neutral"] else 1) for g in games])


def connection_diagnostics(network):
    parent=list(range(len(network["teams"])))
    def find(i):
        while parent[i]!=i:
            parent[i]=parent[parent[i]]; i=parent[i]
        return i
    for a,b in zip(network["a"],network["b"]):
        parent[find(int(a))]=find(int(b))
    # Count components containing FBS teams, rather than irrelevant isolated nodes.
    return len({find(int(i)) for i in network["fbs"]})


def compute_checkpoint(data, games, label, cutoff, previous, parameters):
    network=fit_network(adapt(data,games))
    rows=merit(network,parameters)
    for row in rows:
        row["provisional"]=row["wins"]+row["losses"]<4
    old={r["id"]:r for r in previous}
    movements={}
    for field in ("colleyRank","sorRank"):
        moves=[abs(r[field]-old[r["id"]][field]) for r in rows if r["id"] in old]
        movements[field]=dict(comparedTeams=len(moves),meanAbsoluteChange=sum(moves)/len(moves) if moves else None,
                              maxAbsoluteChange=max(moves) if moves else None)
    colley25={r["id"] for r in rows if r["colleyRank"]<=25}
    sor25={r["id"] for r in rows if r["sorRank"]<=25}
    gaps=[dict(team=r["team"],record=f'{r["wins"]}-{r["losses"]}',colley=r["colleyRank"],sor=r["sorRank"],
               absoluteDifference=abs(r["colleyRank"]-r["sorRank"])) for r in rows]
    return dict(label=label,cutoff=datetime.fromtimestamp(cutoff,timezone.utc).isoformat(),games=len(games),
                eligibleGameIdsHash=digest(json.dumps([g["id"] for g in games],separators=(",",":")).encode()),
                rankedFbsTeams=len(rows),provisionalFbsTeams=sum(r["provisional"] for r in rows),
                fbsConnectedComponents=connection_diagnostics(network),
                colleyTop25Teams=len(colley25),sorTop25Teams=len(sor25),top25Overlap=len(colley25&sor25),
                top25Union=len(colley25|sor25),weekMovement=movements,
                largestDifferences=sorted(gaps,key=lambda x:(-x["absoluteDifference"],x["team"]))[:10],rows=rows)


def replay(data, parameters):
    seen=set(); previous=[]; result=[]
    groups=weekly_groups(data)
    for (kind,week),target in groups:
        cutoff=min(timestamp(g["startDate"]) for g in target)
        games=available_games(data,seen,cutoff)
        assert not {g["id"] for g in target}&{g["id"] for g in games}
        point=compute_checkpoint(data,games,f"before {kind} week {week}",cutoff,previous,parameters)
        result.append(point); previous=point["rows"]
        seen.update(g["id"] for g in target)
    if groups:
        cutoff=max(timestamp(g["startDate"]) for g in data["games"] if g["completed"])+86400
        games=available_games(data,seen,cutoff)
        result.append(compute_checkpoint(data,games,"end of available source season",cutoff,previous,parameters))
    return result


def write_report(report, output):
    summary=[]
    for year,season in report["seasons"].items():
        points=season["checkpoints"]
        established=[p for p in points if p["rankedFbsTeams"]>=25 and p["provisionalFbsTeams"]==0]
        overlaps=[p["top25Overlap"] for p in established]
        summary.append(dict(season=year,checkpoints=len(points),established=len(established),
                            meanOverlap=round(sum(overlaps)/len(overlaps),2) if overlaps else None,
                            finalOverlap=points[-1]["top25Overlap"],
                            postseasonGames=season["audit"]["completedPostseasonGames"]))
    report["summary"]=summary
    (output/"weekly-replay.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    with (output/"weekly-rankings.csv").open("w",newline="",encoding="utf-8-sig") as f:
        keys=["season","checkpoint","cutoff","team","record","games","provisional","colleyRank","sorRank","colleyScore","sorScore","referenceMatchProbability"]
        writer=csv.DictWriter(f,fieldnames=keys); writer.writeheader()
        for year,season in report["seasons"].items():
            for point in season["checkpoints"]:
                for row in point["rows"]:
                    writer.writerow(dict(season=year,checkpoint=point["label"],cutoff=point["cutoff"],team=row["team"],
                                         record=f'{row["wins"]}-{row["losses"]}',games=row["wins"]+row["losses"],
                                         provisional=row["provisional"],colleyRank=row["colleyRank"],sorRank=row["sorRank"],
                                         colleyScore=row["colley"],sorScore=row["sor"],referenceMatchProbability=row["tail"]))
    headers=["Season","Snapshots","Established snapshots*","Mean shared Top 25*","Final shared Top 25","Postseason games"]
    body="".join("<tr>"+"".join(f"<td>{html.escape(str(v))}</td>" for v in row.values())+"</tr>" for row in summary)
    examples=[]
    for year,season in report["seasons"].items():
        final=season["checkpoints"][-1]
        candidates=[g for g in final["largestDifferences"] if min(g["colley"],g["sor"])<=25]
        examples.extend(dict(year=year,**g) for g in candidates[:3])
    examples_html="".join(f"<li>{e['year']}: {html.escape(e['team'])} ({e['record']}), Colley #{e['colley']}, SOR #{e['sor']}.</li>" for e in examples)
    document=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FBS weekly ranking evaluation</title>
<style>body{{font:16px/1.6 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 24px;color:#172b40}}table{{border-collapse:collapse;width:100%}}th,td{{text-align:left;padding:10px;border-bottom:1px solid #d6dfe7}}th,.note{{background:#edf3f8}}.note{{padding:16px}}.scroll{{overflow:auto}}code{{overflow-wrap:anywhere}}a{{color:#145a90}}</style>
<h1>Historical weekly evaluation</h1><p class="note"><strong>Production remains unchanged.</strong> This replay compares the current Colley achievement calculation with frozen original-parameter SOR. It does not select a new engine.</p>
<p>Standard version {report['protocol']['version']}; run fingerprint <code>{report['runFingerprint']}</code>. Both candidates receive exactly the same eligible games at every cutoff. Only prior competition weeks with kickoff at least 24 hours earlier enter a preweek snapshot. This is a conservative reconstruction, not proof of actual historical publication times.</p>
<div class="scroll"><table><thead><tr>{''.join('<th>'+h+'</th>' for h in headers)}</tr></thead><tbody>{body}</tbody></table></div>
<p>*Established means all ranked FBS teams have at least four completed games and at least 25 teams are ranked. Shared Top 25 is descriptive agreement, not an accuracy score. Tied ranks can make the set larger than 25.</p>
<h2>What this establishes</h2><p>The weekly comparison now runs under a written, fingerprinted standard, with reproducible input hashes and automatic eligibility checks. Team-level rankings, records, sample-size flags, connected FBS components and week-to-week movement are saved for inspection. Checks also cover exact game removal, neutral venues, team/conference renaming, input ordering and future-result isolation.</p>
<h2>Examples worth investigating</h2><ul>{examples_html}</ul><p>These are model disagreements, not mistakes established by the test. Individual game evidence must explain a proposed change. No human polls or prestige bonuses were used.</p>
<h2>Limits</h2><ul><li>All years are previously inspected retrospective data. No prospective superiority is claimed.</li><li>2021–2022 have no postseason in this source. Their last checkpoints are not complete final-season rankings.</li><li>Opponent coverage and source FBS membership still require independent audit. Sparse lower-division schedules can affect both models.</li><li>Venue and reference-team assumptions affect SOR. Its fixed coefficients were estimated in the earlier research; they are not retuned here.</li><li>Early weeks can contain little evidence and disconnected schedules; those conditions are flagged, not filled with past-season achievement credit.</li><li>Movement and agreement are diagnostics. Neither is an automatic model-selection target.</li></ul>
<h2>Decision</h2><p>Keep the current engine. Use this research record to inspect consequential weekly disagreements, resolve data-coverage concerns, and validate the SOR probability mapping. A challenger must remain frozen before genuinely future evaluation. Historical predictive strength and margin caps remain a separate investigation.</p>
<p><a href="weekly-rankings.csv">All-team weekly CSV</a> · <a href="weekly-replay.json">Detailed results, audits and hashes</a></p><p>No CFBD calls, paid infrastructure, deployed changes, or new scheduled jobs were needed. Protected production files matched their pre-run hashes.</p></html>'''
    (output/"weekly-review.html").write_text(document,encoding="utf-8")


def main():
    protocol_bytes=(RESEARCH/"evaluation-standard.json").read_bytes()
    protocol=json.loads(protocol_bytes)
    before=protected_hashes()
    seasons={}
    hashes={}
    parameters=(protocol["candidates"]["frozenSorSlope"],protocol["candidates"]["frozenSorHomeLogOdds"])
    for year in protocol["historicalReplay"]["years"]:
        data_bytes=(ROOT/f"data/seasons/{year}.json").read_bytes()
        data=json.loads(data_bytes)
        hashes[str(year)]=digest(data_bytes)
        audit=audit_season(data)
        points=replay(data,parameters)
        seasons[str(year)]=dict(audit=audit,checkpoints=points)
        print(year,len(points),"snapshots; final Top-25 overlap",points[-1]["top25Overlap"],flush=True)
    assert protected_hashes()==before,"Protected production inputs changed during research"
    implementation_hashes={name:digest((RESEARCH/name).read_bytes()) for name in ("compare_merit.py","replay_weekly.py","test_research.py")}
    fingerprint=digest(protocol_bytes+json.dumps(dict(inputs=hashes,implementation=implementation_hashes),sort_keys=True).encode())
    output=RESEARCH/"results/weekly"/fingerprint[:12]
    output.mkdir(parents=True,exist_ok=True)
    report=dict(status="Offline retrospective research; no model promotion",protocol=protocol,
                protocolSha256=digest(protocol_bytes),runFingerprint=fingerprint,inputSha256=hashes,implementationSha256=implementation_hashes,
                protectedProductionFiles=before,productionUnchanged=True,seasons=seasons)
    write_report(report,output)
    print(json.dumps(dict(output=str(output),summary=report["summary"]),indent=2),flush=True)


if __name__=="__main__":
    main()
