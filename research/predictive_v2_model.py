"""Original, pure opponent-adjusted offense/allowance unit model.

One metric's observed team-game value is modeled as

    intercept + offense[team] + allowance[opponent]
        + homeEffect * orientedVenue
        + divisionEffect * (offenseIsFbs - opponentIsFbs).

Higher allowance means that a defense permits more of the measured quantity;
it is not a universal "better" score. A downstream older-only outcome model
must learn which metric directions and combinations help predictions. There
are no polls, recruiting, betting inputs, previous team effects, source calls,
feature selection or implicit numerical settings in this module.

Each retained metric game has one or two observed offensive values. Some
opportunity rates are undefined on one side (for example zero fourth-down
attempts); the available side can remain without inventing its reciprocal.
When both sides are present, identities and oriented venues must reconcile.
The caller owns source validation, opportunity eligibility and past-only
cutoffs. Empty or sparse evidence is kept explicit through measured counts.
"""
from __future__ import annotations

from collections import defaultdict
import math

import numpy as np


VERSION = "original-recorded-stat-offense-allowance-ridge-v1"
CONFIG_KEYS = {"ridge", "contextPriorStrength", "interceptPrior", "homePrior", "divisionPrior"}


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _settings(config):
    if not isinstance(config, dict) or set(config) != CONFIG_KEYS:
        raise ValueError("Explicit ridge, contextPriorStrength and all three context priors are required")
    if not all(_finite(config[key]) for key in CONFIG_KEYS) or config["ridge"] <= 0 or config["contextPriorStrength"] <= 0:
        raise ValueError("Finite context priors and positive ridge/prior strength are required")
    return {key: float(config[key]) for key in sorted(CONFIG_KEYS)}


def _teams(teams):
    if not isinstance(teams, list) or not teams:
        raise ValueError("An explicit nonempty FBS/FCS team population is required")
    by_id = {}
    for team in teams:
        if (not isinstance(team, dict) or any(not isinstance(team.get(key), str) or not team[key]
                                             for key in ("id", "name", "division")) or
                team["division"] not in ("fbs", "fcs") or team["id"] in by_id):
            raise ValueError("Team identities and FBS/FCS membership must be explicit and unique")
        by_id[team["id"]] = dict(team)
    if not any(team["division"] == "fbs" for team in by_id.values()):
        raise ValueError("At least one source-designated FBS team is required")
    return [by_id[key] for key in sorted(by_id)]


def _observations(observations, teams):
    if not isinstance(observations, list):
        raise ValueError("Metric observations must be a list")
    population = {team["id"] for team in teams}
    grouped = defaultdict(list)
    for row in observations:
        if not isinstance(row, dict) or not isinstance(row.get("gameId"), str) or not row["gameId"]:
            raise ValueError("An explicit game identity is required")
        a, b = row.get("offense"), row.get("defense")
        if not isinstance(a, str) or not isinstance(b, str) or a == b or a not in population or b not in population:
            raise ValueError("Metric offense/opponent identities are invalid")
        if not _finite(row.get("value")):
            raise ValueError("Observed metric values must be finite; missing is not zero")
        if type(row.get("venue")) is not int or row["venue"] not in (-1, 0, 1):
            raise ValueError("An explicit oriented venue -1/0/1 is required")
        grouped[row["gameId"]].append(dict(gameId=row["gameId"], offense=a, defense=b,
                                           value=float(row["value"]), venue=row["venue"]))
    result = []
    for identity, pair in sorted(grouped.items()):
        if len(pair) not in (1, 2):
            raise ValueError("Each metric game needs at most one observation per offensive team")
        if len(pair) == 1:
            result.append(pair[0])
            continue
        first, second = sorted(pair, key=lambda row: row["offense"])
        if (first["offense"] != second["defense"] or first["defense"] != second["offense"] or
                first["venue"] != -second["venue"]):
            raise ValueError("Metric game observations must be reciprocal with opposite venues")
        result.extend((first, second))
    return result


def _design_key(observations):
    return tuple((row["gameId"], row["offense"], row["defense"], row["venue"]) for row in observations)


def _system(teams, observations, config):
    """Build one shared exact ridge normal system, excluding target values."""
    count = len(teams)
    ids = {team["id"]: index for index, team in enumerate(teams)}
    divisions = {team["id"]: team["division"] for team in teams}
    normal = np.diag([config["ridge"]] * (2 * count) + [config["contextPriorStrength"]] * 3)
    design = np.zeros((len(observations), 2 * count + 3))
    measured = {team["id"]: dict(offenseGames=0, defenseGames=0, gameIds=set()) for team in teams}
    for index, row in enumerate(observations):
        a, b = row["offense"], row["defense"]
        design[index, ids[a]] = 1.
        design[index, count + ids[b]] = 1.
        division = int(divisions[a] == "fbs") - int(divisions[b] == "fbs")
        design[index, -3:] = [1., row["venue"], division]
        measured[a]["offenseGames"] += 1
        measured[b]["defenseGames"] += 1
        measured[a]["gameIds"].add(row["gameId"])
        measured[b]["gameIds"].add(row["gameId"])
    normal += design.T @ design
    prior = np.zeros(2 * count + 3)
    prior[-3:] = [config["interceptPrior"], config["homePrior"], config["divisionPrior"]]
    penalties = np.array([config["ridge"]] * (2 * count) + [config["contextPriorStrength"]] * 3)
    return normal, design, penalties, prior, measured


def _finish(teams, observations, config, coefficients, design, target, normal, rhs,
            penalties, prior, measured, shared_columns):
    residual = float(np.max(np.abs(normal @ coefficients - rhs)))
    if not np.all(np.isfinite(coefficients)) or residual > 1e-8 * max(1., float(np.max(np.abs(rhs)))):
        raise ValueError("Unit normal equations failed to reconcile")
    context = dict(intercept=float(coefficients[-3]), homeEffect=float(coefficients[-2]),
                   divisionEffect=float(coefficients[-1]))
    count = len(teams)
    rows = []
    for index, team in enumerate(teams):
        division_offset = (.5 if team["division"] == "fbs" else -.5) * context["divisionEffect"]
        offense = float(coefficients[index]); allowance = float(coefficients[count + index])
        counts = measured[team["id"]]
        rows.append(dict(id=team["id"], name=team["name"], division=team["division"],
                         offenseEffect=offense, allowanceEffect=allowance,
                         divisionOffenseOffset=division_offset, divisionAllowanceOffset=-division_offset,
                         totalOffenseEffect=offense + division_offset,
                         totalAllowanceEffect=allowance - division_offset,
                         measuredGames=len(counts["gameIds"]), offenseGames=counts["offenseGames"],
                         defenseGames=counts["defenseGames"],
                         measured=counts["offenseGames"] > 0 and counts["defenseGames"] > 0))
    observed_residual = target - design @ coefficients
    objective = float(observed_residual @ observed_residual + np.sum(penalties * (coefficients - prior) ** 2))
    game_counts = defaultdict(int)
    for row in observations:
        game_counts[row["gameId"]] += 1
    return dict(modelId=VERSION, config=dict(config), context=context, ratings=rows,
                gamesUsed=len(game_counts), observationsUsed=len(observations),
                coverage=dict(pairedGames=sum(count == 2 for count in game_counts.values()),
                              oneSidedGames=sum(count == 1 for count in game_counts.values()),
                              oneSidedGameIds=sorted(identity for identity, count in game_counts.items() if count == 1)),
                fitDiagnostics=dict(maximumNormalEquationResidual=residual, objective=objective,
                                    sharedSolveRhsColumns=shared_columns),
                units="Same units as the input metric; not win probabilities or a universal team rank",
                formula="value = intercept + offenseEffect + opponentAllowanceEffect + homeEffect*venue + divisionEffect*(offenseIsFbs-opponentIsFbs)",
                weighting="One observation per team per retained game; no play-volume or manual game weights",
                interpretation="Current supplied evidence only; no previous team effects. Positive allowance permits more of the measured quantity. Idle units have zero individual effects and explicit zero measured counts. No rank is invented for them.")


def fit_unit_metrics(teams, metrics, config):
    """Fit fixed metric families, batching identical designs into one solve.

    ``metrics`` maps caller-chosen metric names to their available observations.
    Missing metric opportunities must be omitted rather than imputed. A
    one-sided observation contributes only the observed offense and opposing
    allowance unit, with separate opportunity coverage reported. Identical
    eligible designs share a multiple-RHS exact solution; no metric's values
    enter another metric's coefficients.
    """
    settings = _settings(config); ordered = _teams(teams)
    if not isinstance(metrics, dict) or not metrics or any(not isinstance(name, str) or not name for name in metrics):
        raise ValueError("At least one explicitly named metric family is required")
    prepared = {name: _observations(rows, ordered) for name, rows in metrics.items()}
    groups = defaultdict(list)
    for name, rows in prepared.items():
        groups[_design_key(rows)].append(name)
    results = {}
    for names in groups.values():
        observations = prepared[names[0]]
        normal, design, penalties, prior, measured = _system(ordered, observations, settings)
        targets = np.column_stack([np.array([row["value"] for row in prepared[name]]) for name in names])
        rhs = design.T @ targets + (penalties * prior)[:, None]
        coefficients = (np.repeat(prior[:, None], len(names), axis=1) if not observations
                        else np.linalg.solve(normal, rhs))
        for column, name in enumerate(names):
            results[name] = _finish(ordered, prepared[name], settings, coefficients[:, column], design,
                                    targets[:, column], normal, rhs[:, column], penalties, prior, measured, len(names))
    return {name: results[name] for name in metrics}


def fit_units(teams, observations, config):
    """Fit a single recorded metric; no timing, source calls or selection here."""
    return fit_unit_metrics(teams, {"metric": observations}, config)["metric"]


def matchup_features(fitted, home, away, venue=1):
    """Predict two opposing units from an already fitted, target-excluded graph.

    ``venue`` is +1 when the first team is actually home, -1 when away, and 0
    at a neutral site. Generic linear metric predictions are deliberately not
    clipped or represented as probabilities. Swapping teams and venue reverses
    the difference exactly.
    """
    if fitted.get("modelId") != VERSION or type(venue) is not int or venue not in (-1, 0, 1):
        raise ValueError("A fitted unit model and explicit -1/0/1 venue are required")
    rows = {row["id"]: row for row in fitted["ratings"]}
    if home == away or home not in rows or away not in rows:
        raise ValueError("Distinct known matchup team identities are required")
    a, b = rows[home], rows[away]; context = fitted["context"]
    subdivision = int(a["division"] == "fbs") - int(b["division"] == "fbs")
    home_context = context["homeEffect"] * venue
    division_context = context["divisionEffect"] * subdivision
    home_expected = context["intercept"] + a["offenseEffect"] + b["allowanceEffect"] + home_context + division_context
    away_expected = context["intercept"] + b["offenseEffect"] + a["allowanceEffect"] - home_context - division_context
    offense_difference = a["offenseEffect"] - b["offenseEffect"]
    allowance_difference = b["allowanceEffect"] - a["allowanceEffect"]
    terms = dict(offenseDifference=offense_difference, opponentAllowanceDifference=allowance_difference,
                 venueDifference=2 * home_context, subdivisionDifference=2 * division_context)
    difference = home_expected - away_expected
    if not all(_finite(value) for value in [home_expected, away_expected, difference]) or abs(sum(terms.values()) - difference) > 1e-10:
        raise ValueError("Predicted unit matchup does not reconcile")
    return dict(home=home, away=away, venue=venue, homeExpected=float(home_expected),
                awayExpected=float(away_expected), difference=float(difference), components=terms,
                homeMeasuredGames=a["measuredGames"], awayMeasuredGames=b["measuredGames"],
                homeOffenseGames=a["offenseGames"], homeDefenseGames=a["defenseGames"],
                awayOffenseGames=b["offenseGames"], awayDefenseGames=b["defenseGames"],
                measuredBoth=bool(a["measured"] and b["measured"]))
