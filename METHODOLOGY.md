# Methodology v0.1.0

## Achievement

Let L be the undirected game multigraph Laplacian, with one edge per completed
game. Solve `(2I + L) x = (wins - losses)/2`, then `achievement = 0.5 + x`.
Ties add a graph edge but contribute zero to the right side. This is the
[Colley matrix](https://www.colleyrankings.com/matrate.pdf), not a claim that we
invented its mathematics. It is an auditable first benchmark for earned rank.
All teams in the source schedule are modeled individually, including FCS and
other opponents; only teams marked FBS in that season are published as FBS.
This avoids treating all FCS opponents as one fixed-strength team. Incomplete
lower-division schedules can still affect schedule estimates.

History does not contribute to earned achievement. That prevents last season's
performance from supplying unearned credit this season. We nevertheless
reconstruct our own achievement and strength for every historical season.

## Strength

For each game, start with home points minus away points. If period scores
confirm an overtime tie at the end of regulation, replace this margin with +1
or -1 for the eventual winner. Compute:

`target = cap * tanh(margin/cap) - (neutral ? 0 : homeAdvantage)`

Solve `(lambda I + L) strength = gameTargets + lambda * preseasonStrength`,
where each target adds positively for the home team and negatively for the
away team. `preseasonStrength = previousOwnStrength * retention^seasonGap`.
New teams start at zero; there is no prestige or subdivision bonus. Positive
regularization identifies disconnected teams. Defaults are provisional:
lambda 5, retention .65, home advantage 2.5, cap 28. The selection command
compares lambda {3,5,8} and retention {0,.5,.75} by 2019–2022 weekly log loss.
Other constants are engineering defaults, not fitted or claimed optimal.

Predicted margin is strength difference plus venue advantage. Experimental
win probability is logistic(predicted margin / 14). This scale is not yet
calibrated. Margin fitting is bounded, so predicted margins should not be
treated as betting spreads. The reported prior weight `lambda/(lambda+games)`
is the direct coefficient share, not an exact total historical influence:
opponents' priors also propagate through the network.

## Validation and reproducibility

Each competition week is predicted before any game in that week enters the
training set. Only prior-season snapshots and previously completed weeks may
contribute. A 24-hour buffer after kickoff approximates final-score availability.
Regular-season and postseason week numbers are distinct. Parameter selection
uses 2019–2022; evaluation uses 2023–2025. Historical seasons before 2019 provide
warmup. All FBS-vs-FBS non-tied games are evaluated, including postseason.
Log loss, Brier score, accuracy and margin MAE are reported; a fixed home-only
baseline is included. Achievement is audited with invariant tests, rather than
tuned to predict games or agree with human polls.

Snapshots contain model version, config, source provenance, prior season,
input hash, records, opponent scores, per-game contributions, sample sizes,
and connected-component sizes. Rank ties use a 1e-9 tolerance. Hashes include
the previous snapshot hash, preserving the historical lineage. To reproduce a
run, retain the same raw files and config. Source refreshes can change history.

## Known limitations and next evidence needed

- Results are retrospective corrected data, not exact as-published snapshots.
- The initial public CSV import has no postseason rows in 2004–2022. Those
  historical snapshots cover available regular-season results, not complete
  final-season resumes. FBS membership follows source classifications and
  still needs an independent historical membership audit.
- Default CSVs do not contain period scores; overtime uses bounded final margin.
- Garbage time and play-by-play efficiency are not modeled in v0.1.
- Teams absent from an entire season's schedule cannot be discovered by CSVs;
  direct CFBD mode uses its separate year-specific FBS roster.
- Lower-division schedule completeness and sparse conference crossover may
  affect inference. Connected-component and sample-size fields expose some
  limitations; they are not statistical confidence intervals.
- Conference labels only group published rankings; they are never model inputs.
- Offense/defense efficiency, special teams, confidence intervals and probability
  calibration require a subsequent validated model version.
- Wins do not guarantee a rank increase: opponents' results change the network.
- Health indicates the process is running; a missing season returns 503 rather
  than fabricated rankings. Source retrieval timestamps expose data freshness.

This is a transparent statistical model with human-chosen rules, not a claim of
perfect objectivity. No individual may manually alter a team's calculated rank.
