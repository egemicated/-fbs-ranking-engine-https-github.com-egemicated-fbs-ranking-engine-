# Prospective blend scoreboard

The weekly evaluator writes `latest.json` after scoring previously saved
observations against the existing confirmed results. No additional provider
request, parameter fitting, automatic model selection or public rank change is
performed.

Primary comparisons require both opponents to have at least four completed
outcome games and four measured Performance games at capture. Secondary results
include both teams with at least one of each. Every model uses the same games;
ranking ties earn half credit. Venue-aware probabilities use only the frozen
2018–2019 calibration, and are scored separately with Brier error and log loss.

Pending, excluded and rescheduled fixtures are reported. Repeated observations
are not independent games. Zero scored games means evidence is still pending,
not that the experiment passed. Future-game prediction cannot establish a
uniquely correct earned-achievement ranking. Any change to public rankings
requires a separate review of benefits and tradeoffs.

At setup, the first capture and scoreboard are pending the next successful
Sunday 08:00 America/Denver refresh. The current three public rankings continue
to operate independently.
