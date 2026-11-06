"""Offline research only. Does not import a provider, alter published data, or deploy.

Run with Python + numpy. All outputs stay in research/results.
Original frozen calibration: pinned Vanta commit 149db3ac59a1cf6619df93331a9f0ef36a5be5ef.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "research/results"
ORIGINAL = (4.2967562253807925, 0.47455471946025424)


def sigmoid(z):
    return 1 / (1 + np.exp(-np.clip(z, -40, 40)))


def tail_probability(probabilities, wins):
    distribution = np.zeros(len(probabilities) + 1)
    distribution[0] = 1
    for p in probabilities:
        old = distribution.copy()
        distribution *= 1 - p
        distribution[1:] += old[:-1] * p
    return float(np.sum(distribution[wins:]))


def current_dataset(snapshot):
    """Recover outcome edges and venue from already published symmetric evidence.

    No invented dates/scores: the merit calculation only needs outcomes and venue.
    Venue must have exactly one interpretation under the published strength formula,
    including the documented OT alternative. Ambiguity is a hard error.
    """
    teams = snapshot["ratings"]
    by_id = {t["id"]: t for t in teams}
    seen, games = set(), []
    for team in teams:
        for d in team["contributions"]:
            if d["gameId"] in seen:
                continue
            seen.add(d["gameId"])
            other = by_id[d["opponentId"]]
            reverse = [x for x in other["contributions"] if x["gameId"] == d["gameId"]]
            assert len(reverse) == 1
            assert abs(reverse[0]["adjustedMargin"] + d["adjustedMargin"]) < 1e-9
            assert reverse[0]["finalMargin"] == -d["finalMargin"]
            margin = d["finalMargin"]
            outcome = int(np.sign(margin))
            venues = set()
            for base in {margin, outcome}:
                bounded = snapshot["config"]["marginCap"] * math.tanh(base / snapshot["config"]["marginCap"])
                for venue in (-1, 0, 1):
                    target = bounded - venue * snapshot["config"]["homeAdvantage"]
                    if abs(target - d["adjustedMargin"]) < 1e-8:
                        venues.add(venue)
            assert len(venues) == 1, (d["gameId"], venues)
            venue = venues.pop()
            games.append({"id": d["gameId"], "a": team["id"], "b": other["id"],
                          "outcome": outcome, "venue": venue})
    assert len(games) == snapshot["gamesUsed"]
    return {"year": snapshot["season"], "teams": teams, "games": games}


def archive_dataset(year):
    data = json.loads((ROOT / f"data/seasons/{year}.json").read_text())
    games = [{"id": g["id"], "a": g["home"], "b": g["away"],
              "outcome": int(np.sign(g["homePoints"] - g["awayPoints"])),
              "venue": 0 if g["neutral"] else 1}
             for g in data["games"] if g["completed"]]
    return {"year": year, "teams": data["teams"], "games": games}


def fit_network(dataset, d1_only=False):
    teams = [t for t in dataset["teams"] if not d1_only or t["division"] in ("fbs", "fcs")]
    ids = {t["id"]: i for i, t in enumerate(teams)}
    games = [g for g in dataset["games"] if g["a"] in ids and g["b"] in ids]
    n = len(teams)
    a = np.array([ids[g["a"]] for g in games], dtype=int)
    b = np.array([ids[g["b"]] for g in games], dtype=int)
    y = np.array([g["outcome"] for g in games], dtype=float)
    venue = np.array([g["venue"] for g in games], dtype=float)
    matrix = np.eye(n) * 2
    rhs = np.zeros(n)
    np.add.at(matrix, (a, a), 1)
    np.add.at(matrix, (b, b), 1)
    np.add.at(matrix, (a, b), -1)
    np.add.at(matrix, (b, a), -1)
    np.add.at(rhs, a, y / 2)
    np.add.at(rhs, b, -y / 2)
    inverse = np.linalg.inv(matrix)
    ratings = .5 + inverse @ rhs
    fbs = np.array([i for i, t in enumerate(teams) if t["division"] == "fbs"], dtype=int)
    assert np.max(np.abs(matrix @ (ratings - .5) - rhs)) < 1e-10
    return dict(teams=teams, games=games, a=a, b=b, y=y, venue=venue,
                inverse=inverse, ratings=ratings, fbs=fbs)


def loo_context(network):
    a, b, inv, r, fbs = (network[k] for k in ("a", "b", "inverse", "ratings", "fbs"))
    # A' = A - vv^T and rhs' = rhs - outcome*v/2.
    # Exact one-occurrence downdate: r' = r + A^-1 v * (v^T r - outcome/2)/(1-v^T A^-1 v).
    denom = 1 - (inv[a, a] + inv[b, b] - 2 * inv[a, b])
    assert not len(denom) or np.min(denom) > 1e-10
    factor = (r[a] - r[b] - network["y"] / 2) / denom
    reference_columns = inv[fbs, :].mean(axis=0)
    reference = r[fbs].mean() + (reference_columns[a] - reference_columns[b]) * factor
    home = r[a] + (inv[a, a] - inv[a, b]) * factor
    away = r[b] + (inv[a, b] - inv[b, b]) * factor
    return dict(reference=reference, home=home, away=away)


def merit(network, parameters=ORIGINAL, reference_shift=0.0):
    context = loo_context(network)
    slope, home = parameters
    pa = sigmoid(slope * (context["reference"] + reference_shift - context["away"]) + home * network["venue"])
    pb = sigmoid(slope * (context["reference"] + reference_shift - context["home"]) - home * network["venue"])
    rows = []
    for i in network["fbs"]:
        left, right = network["a"] == i, network["b"] == i
        probs = np.concatenate((pa[left], pb[right]))
        outcomes = np.concatenate((network["y"][left], -network["y"][right]))
        # Historical ties are not defined by the original SOR specification.
        assert not np.any(outcomes == 0), "Tie requires a separately specified merit policy"
        wins = int(np.sum(outcomes > 0))
        tail = tail_probability(probs, wins)
        row = network["teams"][i]
        rows.append(dict(id=row["id"], team=row["name"], wins=wins, losses=len(probs)-wins,
                         colley=float(network["ratings"][i]), sor=-math.log10(max(tail, 1e-300)),
                         tail=tail, oagv=float(wins - sum(probs)), expectedWins=float(sum(probs))))
    active = [r for r in rows if r["wins"] + r["losses"]]
    for field in ("colley", "sor", "oagv"):
        last, rank = None, None
        for position, row in enumerate(sorted(active, key=lambda r: (-r[field], r["id"])), 1):
            if last is None or abs(row[field] - last) > 1e-9:
                rank = position
            row[field + "Rank"] = rank
            last = row[field]
    return sorted(active, key=lambda r: (r["sorRank"], r["id"]))


def calibration_observations(network):
    context = loo_context(network)
    fbs = set(network["fbs"])
    mask = np.array([a in fbs and b in fbs and y != 0 for a, b, y in zip(network["a"], network["b"], network["y"])])
    x = np.column_stack((context["home"] - context["away"], network["venue"]))[mask]
    y = (network["y"][mask] > 0).astype(float)
    return x, y


def fit_logistic(x, y):
    beta = np.array(ORIGINAL)
    for _ in range(100):
        p = sigmoid(x @ beta)
        gradient = x.T @ (y - p)
        hessian = x.T @ (x * (p * (1-p))[:, None]) + np.eye(2)*1e-8
        step = np.linalg.solve(hessian, gradient)
        beta += step
        if np.max(np.abs(step)) < 1e-10:
            break
    assert np.all(np.isfinite(beta))
    return tuple(float(b) for b in beta)


def probability_metrics(x, y, beta):
    p = np.clip(sigmoid(x @ beta), 1e-12, 1-1e-12)
    bins = []
    for low in np.arange(0, 1, .1):
        mask = (p >= low) & (p < low+.1)
        if np.any(mask):
            bins.append(dict(lower=round(float(low), 1), games=int(sum(mask)),
                             predicted=float(p[mask].mean()), observed=float(y[mask].mean())))
    return dict(games=len(y), logLoss=float(np.mean(-y*np.log(p)-(1-y)*np.log(1-p))),
                brier=float(np.mean((p-y)**2)), bins=bins,
                scope="Retrospective leave-one-game-out reconstruction, NOT pregame forecasts")


def calibration_sensitivity(x, y, beta, groups):
    old = np.clip(sigmoid(x @ np.array(ORIGINAL)), 1e-12, 1-1e-12)
    new = np.clip(sigmoid(x @ np.array(beta)), 1e-12, 1-1e-12)
    delta = (-y*np.log(old)-(1-y)*np.log(1-old))-(-y*np.log(new)-(1-y)*np.log(1-new))
    blocks = sorted(set(groups))
    totals = np.array([sum(delta[np.array(groups)==g]) for g in blocks])
    counts = np.array([sum(np.array(groups)==g) for g in blocks])
    rng = np.random.default_rng(20261105)
    samples = rng.integers(0,len(blocks),(2000,len(blocks)))
    means = totals[samples].sum(axis=1)/counts[samples].sum(axis=1)
    return dict(meanLogLossReduction=float(delta.mean()),
                relativeLogLossReduction=float(delta.mean()/np.mean(-y*np.log(old)-(1-y)*np.log(1-old))),
                pairedSeasonWeekResamplingRange95=[float(v) for v in np.quantile(means,[.025,.975])],
                blocks=len(blocks),replicates=2000,seed=20261105,
                limitation="Descriptive resampling with fitted parameters held fixed; teams cross week blocks. Not independent prospective evidence or a proof of ranking quality.")


def differences(left, right, lkey="colleyRank", rkey="sorRank"):
    other = {r["id"]: r for r in right}
    result = [dict(team=r["team"], old=r[lkey], new=other[r["id"]][rkey],
                   change=r[lkey]-other[r["id"]][rkey]) for r in left if r["id"] in other]
    return sorted(result, key=lambda r: -abs(r["change"]))


def remove_game(network, index):
    reduced = dict(network)
    a, b = network["a"][index], network["b"][index]
    z = network["inverse"][:, a] - network["inverse"][:, b]
    denominator = 1-z[a]+z[b]
    reduced["inverse"] = network["inverse"] + np.outer(z, z)/denominator
    factor = (network["ratings"][a] - network["ratings"][b] - network["y"][index]/2)/denominator
    reduced["ratings"] = network["ratings"] + z*factor
    for key in ("a", "b", "y", "venue"):
        reduced[key] = np.delete(network[key], index)
    reduced["games"] = [g for j,g in enumerate(network["games"]) if j != index]
    return reduced


def test_math():
    assert abs(tail_probability([.5,.5], 1)-.75) < 1e-12
    assert abs(tail_probability([.2,.7], 2)-.14) < 1e-12
    assert tail_probability([.3,.6], 0) == 1
    assert tail_probability([.3,.6], 2) < tail_probability([.3,.6], 1)
    # Includes a repeated matchup to verify that exactly one occurrence is removed.
    data = dict(teams=[dict(id=str(i), name=str(i), division="fbs") for i in range(3)], games=[
        dict(id="a", a="0", b="1", outcome=1, venue=1),
        dict(id="b", a="0", b="1", outcome=-1, venue=-1),
        dict(id="c", a="1", b="2", outcome=1, venue=0)])
    net = fit_network(data)
    context = loo_context(net)
    for j in range(len(data["games"])):
        brute = fit_network(dict(teams=data["teams"], games=[g for i,g in enumerate(data["games"]) if i!=j]))
        reduced = remove_game(net, j)
        assert np.max(np.abs(brute["ratings"]-reduced["ratings"])) < 1e-12
        assert np.max(np.abs(brute["inverse"]-reduced["inverse"])) < 1e-12
        assert abs(context["reference"][j]-brute["ratings"].mean()) < 1e-12
        assert abs(context["away"][j]-brute["ratings"][net["b"][j]]) < 1e-12
    return "Exact LOO vs brute-force refits, repeated-matchup removal, inverse update, probability tails passed"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    checks = test_math()
    snapshot_bytes = (ROOT / "published/latest.json").read_bytes()
    snapshot = json.loads(snapshot_bytes)
    data = current_dataset(snapshot)
    current = fit_network(data)
    by_id = {t["id"]:t for t in snapshot["ratings"]}
    max_error = max(abs(current["ratings"][i]-by_id[t["id"]]["achievement"]) for i,t in enumerate(current["teams"]))
    assert max_error < 1e-9
    original = merit(current)
    for row in original:
        stored = by_id[row["id"]]
        assert (row["wins"],row["losses"],row["colleyRank"]) == (stored["wins"],stored["losses"],stored["rank"])
    print("Reconstructed current graph matches live snapshot; researching historical calibration", flush=True)
    training_x, training_y, evaluation_x, evaluation_y, evaluation_groups = [], [], [], [], []
    historical = {}
    hashes = {}
    for year in [2014,2015,2016,2017,2018,2019,2023,2024,2025]:
        net = fit_network(archive_dataset(year))
        x,y = calibration_observations(net)
        hashes[str(year)] = hashlib.sha256((ROOT/f"data/seasons/{year}.json").read_bytes()).hexdigest()
        if year <= 2019:
            training_x.append(x); training_y.append(y)
        else:
            evaluation_x.append(x); evaluation_y.append(y)
            raw = json.loads((ROOT/f"data/seasons/{year}.json").read_text())
            group_by_id = {g["id"]:f'{year}:{g["seasonType"]}:{g["week"]}' for g in raw["games"]}
            fbs = set(net["fbs"])
            evaluation_groups.extend(group_by_id[g["id"]] for j,g in enumerate(net["games"])
                                     if net["a"][j] in fbs and net["b"][j] in fbs and net["y"][j]!=0)
            historical[str(year)] = {"rows":merit(net), "originalCalibration":probability_metrics(x,y,ORIGINAL)}
        print("Historical season",year,"eligible FBS matchup observations",len(y),flush=True)
    xtrain,ytrain=np.concatenate(training_x),np.concatenate(training_y)
    beta=fit_logistic(xtrain,ytrain)
    xeval,yeval=np.concatenate(evaluation_x),np.concatenate(evaluation_y)
    candidate=merit(current,beta)
    d1_net=fit_network(data,True)
    d1=merit(d1_net)
    neutral=merit(current,(ORIGINAL[0],0))
    stronger_reference=merit(current,ORIGINAL,reference_shift=.1)
    # Sensitivity to every one-game removal involving at least one FBS team.
    # These are perturbation ranges, not confidence intervals or bootstrap bands.
    fbs=set(current["fbs"])
    eligible=[i for i,(a,b) in enumerate(zip(current["a"],current["b"])) if a in fbs or b in fbs]
    ranges={r["id"]:dict(team=r["team"],colleyMin=r["colleyRank"],colleyMax=r["colleyRank"],
                           sorMin=r["sorRank"],sorMax=r["sorRank"],top25Count=0) for r in original}
    print("Testing all",len(eligible),"FBS-involving game removals",flush=True)
    for count,j in enumerate(eligible,1):
        for r in merit(remove_game(current,j)):
            span=ranges[r["id"]]
            span["colleyMin"]=min(span["colleyMin"],r["colleyRank"])
            span["colleyMax"]=max(span["colleyMax"],r["colleyRank"])
            span["sorMin"]=min(span["sorMin"],r["sorRank"])
            span["sorMax"]=max(span["sorMax"],r["sorRank"])
            span["top25Count"]+=int(r["sorRank"]<=25)
        if count%100==0:
            print("Sensitivity",count,"/",len(eligible),flush=True)
    candidate_metrics=probability_metrics(xeval,yeval,beta)
    original_metrics=probability_metrics(xeval,yeval,ORIGINAL)
    for year in historical:
        net=fit_network(archive_dataset(int(year)))
        x,y=calibration_observations(net)
        historical[year]["matchingContextCalibration"]=probability_metrics(x,y,beta)
    report=dict(status="OFFLINE RESEARCH ONLY; no production change",checks=checks,
        source=dict(asOf=snapshot["asOf"],snapshotHash=snapshot["snapshotHash"],
                    fileSha256=hashlib.sha256(snapshot_bytes).hexdigest(),archiveHashes=hashes,
                    reconstructedColleyMaxError=max_error,teams=len(data["teams"]),games=len(data["games"]),
                    reconstruction="Outcome edges and venue recovered from paired published contributions; no new API calls"),
        originalParameters=ORIGINAL,matchingContextParameters=beta,trainingGames=len(ytrain),
        calibration=dict(original=original_metrics,matchingContext=candidate_metrics,
                         improvementSensitivity=calibration_sensitivity(xeval,yeval,beta,evaluation_groups),
                         limitation="Parameters fitted on 2014-2019 final-snapshot LOO FBS matchups; assessed on 2023-2025 previously consumed retrospective archives. Other season games are visible: NOT pregame prediction accuracy or independent proof of better rankings."),
        current=original,candidate=candidate,d1Only=d1,noVenue=neutral,strongerReference=stronger_reference,
        differences=differences(original,original),calibrationSensitivity=differences(original,candidate,"sorRank","sorRank"),
        populationSensitivity=differences(original,d1,"sorRank","sorRank"),
        d1Coverage=dict(teams=len(d1_net["teams"]),games=len(d1_net["games"])),
        deletionSensitivity=dict(method="Remove each FBS-involving game once and recalculate exact nested LOO SOR",games=len(eligible),
                                 ranges=list(ranges.values()),limitation="Sensitivity ranges, NOT probabilities/confidence intervals; deletion changes record and schedule."),
        historical=historical,
        limitations=["No AP or Coaches Poll data was loaded or used to tune anything.",
                     "Original parameters are reproduced, but the original data snapshot is not: comparisons use our stored games.",
                     "Current data contains lower-division and unknown-classification opponents; D1-only version excludes them.",
                     "Historical lower-division coverage differs by season; 2014-2019 archive omits postseason.",
                     "SOR treats game outcomes as independent conditional on estimated probabilities and ignores score margins.",
                     "A stronger reference team changes the meaning and can change order; +0.1 Colley shift is sensitivity only.",
                     "LOO reduces own-game circularity but still uses other games from the same season.",
                     "No mathematical comparison alone establishes the objectively correct Top 25."])
    (OUT/"merit-comparison.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(dict(checks=checks,matchingContextParameters=beta,calibration=report["calibration"],
                          top25=[dict(team=r["team"],record=f'{r["wins"]}-{r["losses"]}',colley=r["colleyRank"],sor=r["sorRank"]) for r in original[:25]],
                          biggestDifferences=report["differences"][:12]),indent=2),flush=True)


if __name__ == "__main__":
    main()
