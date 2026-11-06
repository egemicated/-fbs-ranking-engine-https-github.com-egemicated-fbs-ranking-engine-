"""Pure research success-rate graph; configuration and source eligibility are external.

fit_advanced_performance(teams, observations, config) consumes two offensive
observations per game. Each observation has gameId, teamId, opponentId, rate
(0..1), plays (>0), and oriented venue (-1/0/1). It makes no provider calls,
chooses no settings, imports no team history and never writes production data.
"""
from __future__ import annotations

import math

import numpy as np


VERSION = "net-success-rate-division-ridge-v1"
RANK_TOLERANCE = 1e-12


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _division_sign(a, b):
    return (a == "fbs") - (b == "fbs")


def _prepare(teams, observations, config):
    if not isinstance(config, dict) or set(config) != {"ridge", "homeRate", "divisionRate"}:
        raise ValueError("Explicit ridge, homeRate and divisionRate are required; no fitted defaults")
    if not all(_finite(config[k]) for k in config) or config["ridge"] <= 0:
        raise ValueError("Finite coefficients and a positive ridge are required")
    if not isinstance(teams, list) or not teams or not isinstance(observations, list):
        raise ValueError("Team identities and paired offensive observations are required")
    by_id = {}
    for team in teams:
        if (not isinstance(team, dict) or
                any(not isinstance(team.get(k), str) or not team[k] for k in ("id", "name", "division"))):
            raise ValueError("Explicit team identity, name and subdivision are required")
        if team["division"] not in ("fbs", "fcs"):
            raise ValueError("Only explicit FBS/FCS team membership is supported")
        if team["id"] in by_id:
            raise ValueError("Duplicate team identity")
        by_id[team["id"]] = dict(team)
    if not any(t["division"] == "fbs" for t in by_id.values()):
        raise ValueError("Source FBS membership is required")
    grouped = {}
    for row in observations:
        if not isinstance(row, dict) or not isinstance(row.get("gameId"), str) or not row["gameId"]:
            raise ValueError("Explicit game identity is required")
        a, b = row.get("teamId"), row.get("opponentId")
        if not isinstance(a, str) or not isinstance(b, str) or a not in by_id or b not in by_id or a == b:
            raise ValueError("Invalid offensive/opponent identity")
        if not _finite(row.get("rate")) or not 0 <= row["rate"] <= 1:
            raise ValueError("Observed success rates must be finite numbers in 0..1")
        if type(row.get("plays")) is not int or row["plays"] <= 0:
            raise ValueError("Positive integer source-play denominators are required")
        if type(row.get("venue")) is not int or row["venue"] not in (-1, 0, 1):
            raise ValueError("Explicit oriented venue must be -1, 0 or 1")
        grouped.setdefault(row["gameId"], []).append(row)
    games = []
    for game_id, pair in sorted(grouped.items()):
        if len(pair) != 2:
            raise ValueError("Each game requires exactly two offensive observations")
        a, b = sorted(pair, key=lambda row: row["teamId"])
        if a["teamId"] != b["opponentId"] or b["teamId"] != a["opponentId"]:
            raise ValueError("Paired observations must have reciprocal participant identities")
        if a["venue"] != -b["venue"]:
            raise ValueError("Paired observations must have opposite oriented venues")
        division = _division_sign(by_id[a["teamId"]]["division"], by_id[b["teamId"]]["division"])
        net = float(a["rate"] - b["rate"])
        games.append(dict(gameId=game_id, a=a["teamId"], b=b["teamId"], venue=a["venue"],
                          divisionSign=division, rateA=float(a["rate"]), rateB=float(b["rate"]),
                          playsA=a["plays"], playsB=b["plays"], netRate=net,
                          adjustedNetRate=net-config["homeRate"]*a["venue"]-config["divisionRate"]*division))
    return [by_id[k] for k in sorted(by_id)], games


def fit_advanced_performance(teams, observations, config):
    """Fit equal-game-weight ridge effects to opponent net success rates.

    With z=+1 for FBS-versus-FCS, -1 reversed, otherwise zero, minimize
      sum_games[(netRate - H*venue - D*z - effectA + effectB)**2]
        + ridge*sum_teams[effect**2].
    The reported total is effect + D/2 (FBS) or effect - D/2 (FCS), so the
    observed-game prediction is totalA-totalB+H*venue. This population effect is
    explicit and must be estimated in success-rate units outside this function.
    """
    teams, games = _prepare(teams, observations, config)
    ids = {t["id"]: i for i, t in enumerate(teams)}
    matrix = np.eye(len(teams)) * config["ridge"]
    rhs = np.zeros(len(teams))
    parent = list(range(len(teams)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    stats = [dict(games=0, offensiveRatePlaySum=0., offensivePlays=0,
                  opponentRatePlaySum=0., opponentPlays=0, netSum=0.,
                  minPlays=None, opponents=set(), evidence=[]) for _ in teams]
    for game in games:
        a, b = ids[game["a"]], ids[game["b"]]
        matrix[a, a] += 1; matrix[b, b] += 1
        matrix[a, b] -= 1; matrix[b, a] -= 1
        rhs[a] += game["adjustedNetRate"]; rhs[b] -= game["adjustedNetRate"]
        parent[find(a)] = find(b)
        for i, j, suffix, opposite, sign in ((a, b, "A", "B", 1), (b, a, "B", "A", -1)):
            s = stats[i]; s["games"] += 1; s["opponents"].add(j)
            s["offensivePlays"] += game[f"plays{suffix}"]
            s["opponentPlays"] += game[f"plays{opposite}"]
            s["offensiveRatePlaySum"] += game[f"rate{suffix}"]*game[f"plays{suffix}"]
            s["opponentRatePlaySum"] += game[f"rate{opposite}"]*game[f"plays{opposite}"]
            s["netSum"] += sign*game["netRate"]
            s["minPlays"] = min(s["minPlays"], game[f"plays{suffix}"]) if s["minPlays"] is not None else game[f"plays{suffix}"]
            s["evidence"].append((game, j, sign))
    effects = np.linalg.solve(matrix, rhs)
    normal_residual = float(np.max(np.abs(matrix @ effects-rhs)))
    if not np.all(np.isfinite(effects)) or normal_residual > 1e-9*max(1., float(np.max(np.abs(rhs)))):
        raise ValueError("Success-rate solve did not converge")
    component_sizes = {}
    for i in range(len(teams)):
        root = find(i); component_sizes[root] = component_sizes.get(root, 0)+1
    offsets = [config["divisionRate"]*(.5 if t["division"] == "fbs" else -.5) for t in teams]
    totals = effects + np.array(offsets)
    ratings = []
    for i, team in enumerate(teams):
        s = stats[i]; denominator = s["games"]+config["ridge"]
        contributions = []
        for game, j, sign in s["evidence"]:
            observed = sign*game["netRate"]/denominator
            venue = -config["homeRate"]*sign*game["venue"]/denominator
            division = -config["divisionRate"]*sign*game["divisionSign"]/denominator
            opponent = float(effects[j])/denominator
            contributions.append(dict(gameId=game["gameId"], opponentId=teams[j]["id"],
                                      observedNetContribution=observed, venueContribution=venue,
                                      divisionAdjustmentContribution=division, opponentContribution=opponent,
                                      effectContribution=observed+venue+division+opponent))
        explanation = dict(denominator=denominator, measuredGames=s["games"], ridge=config["ridge"],
                           divisionOffset=offsets[i],
                           observedNetContribution=sum(c["observedNetContribution"] for c in contributions),
                           venueContribution=sum(c["venueContribution"] for c in contributions),
                           divisionAdjustmentContribution=sum(c["divisionAdjustmentContribution"] for c in contributions),
                           opponentContribution=sum(c["opponentContribution"] for c in contributions),
                           gameContributions=contributions)
        explanation["reconstructedEffect"] = sum(c["effectContribution"] for c in contributions)
        explanation["reconstructedRating"] = explanation["reconstructedEffect"]+offsets[i]
        explanation["reconciliationError"] = explanation["reconstructedRating"]-float(totals[i])
        offense = s["offensiveRatePlaySum"]/s["offensivePlays"] if s["offensivePlays"] else None
        defense = s["opponentRatePlaySum"]/s["opponentPlays"] if s["opponentPlays"] else None
        ratings.append(dict(id=team["id"], team=team["name"], division=team["division"],
                            rating=float(totals[i]), effect=float(effects[i]), divisionOffset=offsets[i], rank=None,
                            measuredGames=s["games"], offensivePlays=s["offensivePlays"], opponentPlays=s["opponentPlays"],
                            rawOffenseRate=offense, rawDefenseRateAllowed=defense,
                            rawNetRate=offense-defense if offense is not None else None,
                            meanGameNetRate=s["netSum"]/s["games"] if s["games"] else None,
                            minOffensivePlaysInMeasuredGame=s["minPlays"],
                            minOpponentMeasuredGames=min((stats[j]["games"] for j in s["opponents"]), default=None),
                            connectedTeams=component_sizes[find(i)], provisional=s["games"] < 4,
                            explanation=explanation))
    rows = sorted((r for r in ratings if r["division"] == "fbs"),
                  key=lambda r: (not bool(r["measuredGames"]), -r["rating"], r["id"]))
    last_distinct, shared_rank = None, None
    for position, row in enumerate(rows, 1):
        if not row["measuredGames"]:
            continue
        if last_distinct is None or abs(row["rating"]-last_distinct) > RANK_TOLERANCE:
            shared_rank = position; last_distinct = row["rating"]
        row["rank"] = shared_rank
    evidence = []
    for game in games:
        a, b = ids[game["a"]], ids[game["b"]]
        prediction = float(totals[a]-totals[b]+config["homeRate"]*game["venue"])
        evidence.append(dict(gameId=game["gameId"], a=game["a"], b=game["b"],
                             venue=game["venue"], divisionSign=game["divisionSign"],
                             netRate=game["netRate"], adjustedNetRate=game["adjustedNetRate"],
                             predictedNetRate=prediction, residual=game["netRate"]-prediction, weight=1))
    return dict(modelId=VERSION, status="research-only opponent-adjusted net-success-rate candidate", config=dict(config),
                units="success-rate fraction; multiply by 100 for percentage points",
                weighting="one observation and weight1 per paired measured game; play counts are diagnostics only",
                reference="Individual ridge effects center on zero; total adds explicit +D/2 FBS or -D/2 FCS population offset",
                scope="Observed scrimmage success-rate efficiency on the source's eligible plays; no complete football/special-teams grade is claimed",
                rankTolerance=RANK_TOLERANCE, gamesUsed=len(games),
                measuredFbsTeams=sum(bool(r["measuredGames"]) for r in rows), sourceFbsTeams=len(rows),
                maxNormalEquationResidual=normal_residual,
                maxExplanationReconciliationError=max(abs(r["explanation"]["reconciliationError"]) for r in ratings),
                rows=rows, ratings=ratings, gameEvidence=evidence)
