"""Pure joint-ridge success-rate research model with adaptive population context.

Only the caller chooses eligible observations and older-season priors. This
module makes no requests, reads no historical/current source files, selects no
settings and does not write outputs. Individual team effects never carry over.
"""
from __future__ import annotations

import math

import numpy as np

from advanced_performance_model import fit_advanced_performance


VERSION = "adaptive-net-success-rate-joint-ridge-v2"


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _array(value, shape, name):
    array = np.asarray(value)
    if array.shape != shape or array.dtype.kind not in "iuf" or not np.all(np.isfinite(array)):
        raise ValueError(f"{name} must contain finite real numbers with shape {shape}")
    return array.astype(float)


def posterior_context(Q, b, prior, strength):
    """Solve the two-context Schur complement with an explicit quadratic prior.

    Q = Z' [I - X(X'X + ridge I)^-1 X'] Z; b uses that same residualizer on y.
    Order is [homeRate, divisionRate]. The return values are derived coefficients
    and diagnostics; no observation or previous team-season rating is supplied.
    """
    if not _finite(strength) or strength <= 0:
        raise ValueError("A finite positive context prior strength is required")
    q = _array(Q, (2, 2), "Q"); vector = _array(b, (2,), "b")
    center = _array(prior, (2,), "prior")
    scale = max(1., float(np.max(np.abs(q))))
    symmetry_error = float(np.max(np.abs(q-q.T)))
    if symmetry_error > 1e-10*scale:
        raise ValueError("The residualized context matrix must be symmetric")
    q = (q+q.T)/2
    if float(np.linalg.eigvalsh(q)[0]) < -1e-10*scale:
        raise ValueError("The residualized context matrix must be positive semidefinite")
    matrix = q+strength*np.eye(2)
    if float(np.linalg.eigvalsh(matrix)[0]) <= 0:
        raise ValueError("The regularized context matrix must be positive definite")
    # Solve for the shift, avoiding subtraction of almost equal large prior
    # terms when strength is large. This is algebraically the same normal fit.
    shift_rhs = vector-q @ center
    shift = np.linalg.solve(matrix, shift_rhs)
    context = center+shift
    residual = float(np.max(np.abs(matrix @ shift-shift_rhs)))
    if not np.all(np.isfinite(context)) or residual > 1e-10*max(1., float(np.max(np.abs(shift_rhs)))):
        raise ValueError("Adaptive population-context solve did not converge")
    return dict(homeRate=float(context[0]), divisionRate=float(context[1]),
                prior=[float(v) for v in center], strength=float(strength),
                priorShift=[float(v) for v in shift],
                Q=[[float(v) for v in row] for row in q], b=[float(v) for v in vector],
                normalEquationResidual=residual, inputSymmetryError=symmetry_error,
                designConditionNumber=float(np.linalg.cond(matrix)))


def fit_adaptive_performance(teams, observations, config):
    """Minimize ||y-Xr-Zc||² + ridge||r||² + strength||c-prior||².

    Team effects r are current-input-only. c contains venue and FBS/FCS
    population effects in success-rate units; older priors can be updated by the
    supplied completed-game evidence. Each measured game retains weight one.
    The original model supplies conditional team effects and exact explanations.
    """
    required = {"ridge", "contextPriorStrength", "homePrior", "divisionPrior"}
    if not isinstance(config, dict) or set(config) != required:
        raise ValueError("Explicit ridge, contextPriorStrength, homePrior and divisionPrior are required")
    if (not all(_finite(config[k]) for k in required) or
            config["ridge"] <= 0 or config["contextPriorStrength"] <= 0):
        raise ValueError("Finite priors and positive ridge/context prior strength are required")
    bases = [fit_advanced_performance(teams, observations,
             dict(ridge=config["ridge"], homeRate=home, divisionRate=division))
             for home, division in ((0., 0.), (1., 0.), (0., 1.))]
    zero, home, division = [result["gameEvidence"] for result in bases]
    q = np.zeros((2, 2)); b = np.zeros(2)
    for base, h, d in zip(zero, home, division):
        if (base["gameId"], base["a"], base["b"]) != (h["gameId"], h["a"], h["b"]) or (
                base["gameId"], base["a"], base["b"]) != (d["gameId"], d["a"], d["b"]):
            raise ValueError("Conditional basis games are not aligned")
        z = np.array([base["venue"], base["divisionSign"]], dtype=float)
        response = np.array([h["predictedNetRate"]-base["predictedNetRate"],
                             d["predictedNetRate"]-base["predictedNetRate"]])
        q += np.outer(z, response)
        b += z*(base["netRate"]-base["predictedNetRate"])
    context = posterior_context(q, b, [config["homePrior"], config["divisionPrior"]],
                                config["contextPriorStrength"])
    fitted = fit_advanced_performance(teams, observations,
               dict(ridge=config["ridge"], homeRate=context["homeRate"], divisionRate=context["divisionRate"]))
    observed_residual_sums = np.zeros(2)
    for game in fitted["gameEvidence"]:
        observed_residual_sums += np.array([game["venue"], game["divisionSign"]])*game["residual"]
    prior_pull = config["contextPriorStrength"]*np.array(context["priorShift"])
    direct_residual = float(np.max(np.abs(observed_residual_sums-prior_pull)))
    if direct_residual > 1e-9*max(1., float(np.max(np.abs(observed_residual_sums)))):
        raise ValueError("Adaptive joint context stationarity did not reconcile")
    context.update(observedResidualContextSums=[float(v) for v in observed_residual_sums],
                   priorPull=[float(v) for v in prior_pull],
                   maxDirectContextStationarityResidual=direct_residual,
                   objective="Unit-game squared residuals + ridge*sum(individual effects²) + strength*sum((context-prior)²)")
    fitted["baseModelId"] = fitted["modelId"]
    fitted["modelId"] = VERSION
    fitted["status"] = "research-only success-rate candidate with adaptive population context"
    fitted["adaptiveConfig"] = dict(config)
    fitted["contextFit"] = context
    fitted["jointObjective"] = (sum(g["residual"]**2 for g in fitted["gameEvidence"])
                               +config["ridge"]*sum(r["effect"]**2 for r in fitted["ratings"])
                               +config["contextPriorStrength"]*sum(v**2 for v in context["priorShift"]))
    return fitted
