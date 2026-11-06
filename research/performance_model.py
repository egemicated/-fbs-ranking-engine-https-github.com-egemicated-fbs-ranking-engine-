"""Pure offline net-yards/play prototype, not an approved performance ranking.

Call fit_performance(teams, observations, {"ridge": ..., "homeYpp": ...}).
Each completed eligible game needs two offensive box observations with fields
gameId, teamId, opponentId, yards, plays, venue (-1 away, 0 neutral, 1 home).
The caller owns cutoff eligibility and source validation; this module never
fetches, chooses settings, reads history or writes files.
"""
from __future__ import annotations

import math

import numpy as np


VERSION = "net-ypp-ridge-prototype-v1"


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _prepare(teams, observations, config):
    if not isinstance(config, dict) or set(config) != {"ridge", "homeYpp"}:
        raise ValueError("Explicit ridge and homeYpp settings are required; no fitted defaults")
    if not _finite(config["ridge"]) or config["ridge"] <= 0 or not _finite(config["homeYpp"]):
        raise ValueError("Invalid performance settings")
    if not isinstance(teams, list) or not teams or not isinstance(observations, list):
        raise ValueError("Teams and paired offensive observations are required")
    by_id = {}
    for team in teams:
        if not isinstance(team, dict) or any(not isinstance(team.get(k), str) or not team[k] for k in ("id", "name", "division")):
            raise ValueError("Invalid team identity or subdivision")
        if team["id"] in by_id:
            raise ValueError("Duplicate team identity")
        by_id[team["id"]] = dict(team)
    if not any(t["division"] == "fbs" for t in by_id.values()):
        raise ValueError("Source FBS membership is required")
    grouped = {}
    for row in observations:
        if not isinstance(row, dict) or not isinstance(row.get("gameId"), str) or not row["gameId"]:
            raise ValueError("Invalid game identity")
        a, b = row.get("teamId"), row.get("opponentId")
        if a not in by_id or b not in by_id or a == b:
            raise ValueError("Invalid offensive/opponent identity")
        if type(row.get("yards")) is not int or type(row.get("plays")) is not int or row["plays"] <= 0:
            raise ValueError("Integer yards and positive integer play denominators are required")
        if type(row.get("venue")) is not int or row["venue"] not in (-1, 0, 1):
            raise ValueError("Explicit oriented venue is required")
        grouped.setdefault(row["gameId"], []).append(row)
    games = []
    for game_id, pair in sorted(grouped.items()):
        if len(pair) != 2:
            raise ValueError("Each measured game requires exactly two offensive observations")
        a, b = sorted(pair, key=lambda row: row["teamId"])
        if a["teamId"] != b["opponentId"] or b["teamId"] != a["opponentId"] or a["teamId"] == b["teamId"]:
            raise ValueError("Paired observations disagree on participants")
        if a["venue"] != -b["venue"]:
            raise ValueError("Paired observations disagree on venue")
        rate_a, rate_b = a["yards"] / a["plays"], b["yards"] / b["plays"]
        games.append(dict(gameId=game_id, a=a["teamId"], b=b["teamId"], venue=a["venue"],
                          yardsA=a["yards"], yardsB=b["yards"], playsA=a["plays"], playsB=b["plays"],
                          offenseYppA=rate_a, offenseYppB=rate_b, netYpp=rate_a-rate_b,
                          adjustedNetYpp=rate_a-rate_b-config["homeYpp"]*a["venue"]))
    return [by_id[k] for k in sorted(by_id)], games


def fit_performance(teams, observations, config):
    """Equal-game-weight ridge fit of net YPP to team-effect differences.

    Minimize sum_games([(netYpp - homeYpp*venue) - (r_a-r_b)]**2)
             + ridge*sum_teams[r_team**2].

    These are one-dimensional net-efficiency ratings. Offensive YPP and defensive
    YPP allowed below are raw diagnostics, not separately adjusted unit ratings.
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

    stats = [dict(games=0, offensiveYards=0, offensivePlays=0, opponentYards=0, opponentPlays=0,
                  netSum=0., minPlays=None, opponents=set()) for _ in teams]
    for g in games:
        a, b = ids[g["a"]], ids[g["b"]]
        matrix[a, a] += 1; matrix[b, b] += 1
        matrix[a, b] -= 1; matrix[b, a] -= 1
        rhs[a] += g["adjustedNetYpp"]; rhs[b] -= g["adjustedNetYpp"]
        parent[find(a)] = find(b)
        for i, j, suffix, opposite, sign in ((a, b, "A", "B", 1), (b, a, "B", "A", -1)):
            s = stats[i]; s["games"] += 1; s["opponents"].add(j)
            s["offensiveYards"] += g[f"yards{suffix}"]; s["offensivePlays"] += g[f"plays{suffix}"]
            s["opponentYards"] += g[f"yards{opposite}"]; s["opponentPlays"] += g[f"plays{opposite}"]
            s["netSum"] += sign*g["netYpp"]
            s["minPlays"] = min(s["minPlays"], g[f"plays{suffix}"]) if s["minPlays"] is not None else g[f"plays{suffix}"]
    fitted = np.linalg.solve(matrix, rhs)
    residual = float(np.max(np.abs(matrix @ fitted-rhs)))
    if not np.all(np.isfinite(fitted)) or residual > 1e-8:
        raise ValueError("Performance solve did not converge")
    component_sizes = {}
    for i in range(len(teams)):
        key = find(i); component_sizes[key] = component_sizes.get(key, 0)+1
    ratings = []
    for i, team in enumerate(teams):
        s = stats[i]
        offense = s["offensiveYards"]/s["offensivePlays"] if s["offensivePlays"] else None
        defense = s["opponentYards"]/s["opponentPlays"] if s["opponentPlays"] else None
        ratings.append(dict(id=team["id"], team=team["name"], division=team["division"], rating=float(fitted[i]),
                            rank=None, measuredGames=s["games"], offensivePlays=s["offensivePlays"],
                            opponentPlays=s["opponentPlays"], rawOffenseYpp=offense, rawDefenseYppAllowed=defense,
                            rawNetYpp=offense-defense if offense is not None else None,
                            meanGameNetYpp=s["netSum"]/s["games"] if s["games"] else None,
                            minOffensivePlaysInMeasuredGame=s["minPlays"],
                            minOpponentMeasuredGames=min((stats[j]["games"] for j in s["opponents"]), default=None),
                            connectedTeams=component_sizes[find(i)], provisional=s["games"] < 4))
    rows = sorted((r for r in ratings if r["division"] == "fbs"),
                  key=lambda r: (not bool(r["measuredGames"]), -r["rating"], r["id"]))
    last, shared_rank = None, None
    for position, row in enumerate(rows, 1):
        if not row["measuredGames"]:
            continue
        if last is None or abs(row["rating"]-last) > 1e-9:
            shared_rank = position
        row["rank"] = shared_rank; last = row["rating"]
    evidence = []
    for g in games:
        fitted_difference = float(fitted[ids[g["a"]]]-fitted[ids[g["b"]]])
        evidence.append(dict(g, fittedNetYpp=fitted_difference+config["homeYpp"]*g["venue"],
                             residual=g["adjustedNetYpp"]-fitted_difference, weight=1))
    return dict(modelId=VERSION, status="research-only scrimmage-efficiency prototype", config=dict(config),
                units="opponent-adjusted net yards per scrimmage play", weighting="one observation and weight1 per matched game",
                reference="ridge effects centered on zero across modeled teams; no prior-season team credit",
                scope="Net scrimmage efficiency only. Raw offense/defense rates are diagnostics; special teams, field position and situational execution are not fully measured.",
                gamesUsed=len(games), measuredFbsTeams=sum(bool(r["measuredGames"]) for r in rows),
                sourceFbsTeams=len(rows), maxNormalEquationResidual=residual, rows=rows, ratings=ratings, gameEvidence=evidence)
