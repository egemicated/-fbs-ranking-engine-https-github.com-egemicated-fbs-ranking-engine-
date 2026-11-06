"""Offline current-snapshot opponent inventory; writes beside this script only.

Sparse-record flags describe available evidence, not proven schedule omissions.
No division labels are independently certified by this inventory.
"""
from collections import Counter, defaultdict
import csv
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = ROOT / "published/latest.json"


def main():
    raw = SOURCE.read_bytes()
    data = json.loads(raw)
    teams = {t["id"]: t for t in data["ratings"]}
    fbs = {i for i,t in teams.items() if t["division"] == "fbs"}
    parent = {i:i for i in teams}
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    contributions = defaultdict(list)
    for tid,t in teams.items():
        rows = t["contributions"]
        assert t["games"] == len(rows), tid
        assert (t["wins"],t["losses"],t["ties"]) == tuple(sum(g["result"] == result for g in rows) for result in ("W","L","T")), tid
        for g in rows:
            contributions[g["gameId"]].append((tid,g))

    edge_types = Counter()
    direct_fcs = defaultdict(list)
    direct_other = defaultdict(list)
    edges = []
    for game_id, observations in contributions.items():
        assert len(observations) == 2, game_id
        (a,ag),(b,bg) = observations
        assert ag["opponentId"] == b and bg["opponentId"] == a
        assert ag["finalMargin"] == -bg["finalMargin"]
        assert abs(ag["adjustedMargin"] + bg["adjustedMargin"]) < 1e-9
        parent[find(a)] = find(b)
        edges.append((a,b))
        divisions = sorted([teams[a]["division"],teams[b]["division"]])
        edge_types[" / ".join(divisions)] += 1
        for tid,other,g in ((a,b,ag),(b,a,bg)):
            if tid not in fbs or other in fbs:
                continue
            entry = dict(fbsId=tid,fbsTeam=teams[tid]["name"],fbsRank=teams[tid]["rank"],
                         opponentId=other,opponent=teams[other]["name"],division=teams[other]["division"],
                         gameId=game_id,result=g["result"],margin=g["finalMargin"],
                         opponentGames=teams[other]["games"],opponentRecord=f'{teams[other]["wins"]}-{teams[other]["losses"]}')
            if teams[other]["division"] == "fcs": direct_fcs[other].append(entry)
            else: direct_other[other].append(entry)

    components = defaultdict(list)
    for tid in teams:
        components[find(tid)].append(tid)
    component_sizes = {tid:len(components[find(tid)]) for tid in teams}
    for tid,t in teams.items():
        assert t["evidence"]["connectedTeams"] == component_sizes[tid], tid

    direct_rows=[]
    for tid,games in direct_fcs.items():
        t=teams[tid]
        direct_rows.append(dict(id=tid,team=t["name"],record=f'{t["wins"]}-{t["losses"]}',games=t["games"],
                                availableOpponentCount=len(set(g["opponentId"] for g in t["contributions"])),
                                fbsGames=len(games),componentTeams=component_sizes[tid],
                                sparseAvailableEvidence=t["games"]<4,
                                fbsOpponents=[g["fbsTeam"] for g in games],fbsGameEvidence=games))
    direct_rows.sort(key=lambda t:(t["games"],-t["fbsGames"],t["team"]))
    network_priorities=[]
    for tid in direct_fcs:
        team=teams[tid]
        unknown=[dict(id=g["opponentId"],team=teams[g["opponentId"]]["name"],games=teams[g["opponentId"]]["games"])
                 for g in team["contributions"] if teams[g["opponentId"]]["division"]=="unknown"]
        sparse=[dict(id=g["opponentId"],team=teams[g["opponentId"]]["name"],games=teams[g["opponentId"]]["games"])
                for g in team["contributions"] if teams[g["opponentId"]]["games"]<4]
        if unknown or sparse:
            network_priorities.append(dict(team=team["name"],id=tid,unknownOpponents=unknown,sparseOpponents=sparse,
                                           fbsClients=[g["fbsTeam"] for g in direct_fcs[tid]]))
    network_priorities.sort(key=lambda t:(-len(t["sparseOpponents"]),-len(t["unknownOpponents"]),t["team"]))
    degree = {tid:len(set(g["opponentId"] for g in t["contributions"])) for tid,t in teams.items()}
    fcs_teams = [t for t in teams.values() if t["division"]=="fcs"]
    fbs_fbs=sum(a in fbs and b in fbs for a,b in edges)
    fbs_fcs=sum(len(games) for games in direct_fcs.values())
    fbs_other=sum(len(games) for games in direct_other.values())
    per_fbs=[]
    for tid in sorted(fbs,key=lambda i:(teams[i]["rank"] or 9999,teams[i]["name"])):
        t=teams[tid]; counts=Counter(teams[g["opponentId"]]["division"] for g in t["contributions"])
        per_fbs.append(dict(id=tid,team=t["name"],rank=t["rank"],games=t["games"],opponentDivisionCounts=dict(counts),
                            directFcsOpponents=[dict(id=g["opponentId"],team=teams[g["opponentId"]]["name"],availableGames=teams[g["opponentId"]]["games"])
                                                for g in t["contributions"] if teams[g["opponentId"]]["division"]=="fcs"],
                            connectedTeams=component_sizes[tid]))
    sparse_all=[dict(id=t["id"],team=t["name"],division=t["division"],games=t["games"],degree=degree[t["id"]],
                     componentTeams=component_sizes[t["id"]]) for t in teams.values() if t["games"]<4]
    result=dict(snapshotAsOf=data["asOf"],snapshotHash=data["snapshotHash"],sourceFileSha256=hashlib.sha256(raw).hexdigest(),
                integrity=dict(recordsReconcile=True,pairedContributionSymmetry=True,evidenceComponentSizesMatch=True),
                summary=dict(modeledTeams=len(teams),divisionCounts=dict(Counter(t["division"] for t in teams.values())),
                             completedEdges=len(edges),fbsVsFbsEdges=fbs_fbs,fbsVsFcsEdges=fbs_fcs,fbsVsOtherEdges=fbs_other,
                             fbsInvolvingEdges=fbs_fbs+fbs_fcs+fbs_other,
                             uniqueDirectFcsOpponents=len(direct_fcs),uniqueDirectOtherOpponents=len(direct_other),
                             fbsTeamsWithFcsOpponents=sum(bool(t["directFcsOpponents"]) for t in per_fbs),
                             directFcsMinimumGames=min((t["games"] for t in direct_rows),default=None),
                             directFcsMaximumGames=max((t["games"] for t in direct_rows),default=None),
                             directFcsSparseCount=sum(t["sparseAvailableEvidence"] for t in direct_rows),
                             sourceFcsTeams=len(fcs_teams),sourceFcsBelowFourGames=sum(t["games"]<4 for t in fcs_teams),
                             connectedComponents=len(components),fbsComponents=len({find(i) for i in fbs}),
                             fbsComponentSizes=sorted({component_sizes[i] for i in fbs}),
                             isolatedNodes=sum(len(rows)==1 for rows in components.values())),
                edgeDivisionCounts=dict(edge_types),directFcs=direct_rows,directOther=direct_other,perFbs=per_fbs,
                sparseAll=sparse_all,indirectNetworkPriorities=network_priorities,
                componentDivisionCounts=[dict(teams=len(ids),divisionCounts=dict(Counter(teams[i]["division"] for i in ids)))
                                         for ids in sorted(components.values(),key=lambda rows:-len(rows))],
                caveats=["A plausible number of completed games is not proof of a complete schedule.",
                         "The snapshot lacks raw kickoff dates/full scores. Independence, time eligibility, duplicate identity and division membership require source checks.",
                         "All source classification labels are reported, not independently certified.",
                         "Sparse is defined as fewer than four observed completed games; this is a prioritization flag, not an inferred missing-game count."])
    assert len(edges)==data["gamesUsed"]
    (HERE/"inventory.json").write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    with (HERE/"direct-fcs-games.csv").open("w",newline="",encoding="utf-8-sig") as f:
        flat=[entry for row in direct_rows for entry in row["fbsGameEvidence"]]
        writer=csv.DictWriter(f,fieldnames=list(flat[0]) if flat else ["fbsTeam"])
        writer.writeheader();writer.writerows(flat)
    print(json.dumps(result["summary"],indent=2))
    print("SPARSE_DIRECT",json.dumps([t for t in direct_rows if t["sparseAvailableEvidence"]],ensure_ascii=False))
    print("LEAST_OBSERVED_DIRECT",json.dumps([{k:t[k] for k in ("team","games","record","fbsOpponents")} for t in direct_rows[:12]],ensure_ascii=False))


if __name__=="__main__": main()
