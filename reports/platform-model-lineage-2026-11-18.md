# Model and historical-input audit

This audit used the November 18, 2026 publication at
`2026-11-18T12:30:14.250Z` and its snapshot hash
`a36df50d7f94c050e03b2d5df03cba802067d8dd2a1732f715a3ea3cc57dc4c1`.
All investigation and comparison calculations ran offline using saved data.
No production model parameters, historical inputs, current results or saved
forecast timestamps were changed.

## Production lineage

The Render static build reads `published/latest.json`, the matching
`published/performance-latest.json`, saved FBS and FCS picks and verified
conference archives. It does not rebuild historical team ratings or fetch
provider data. The CFBD results job uses the committed
`published/prior-2025.json` for Predictive Strength priors.

The production historical archive remains the original SportsDataverse
schedule import. The frozen `historical-coverage-v1` research release has
674 added completed FBS postseason games from 2004–2022 and eight explicit
duplicate removals. Its compressed release SHA256 is
`00757b0602c79df47fa9ed2b7b3c523ee28f56683650841bca1d5a6dcc74fc39`.
Each of the 22 original and repaired season-file hashes was verified against
that release. Rebuilding the original history reproduced the committed
2025 Predictive Strength prior within 1e-9.

Historical team ratings and the retained historical backtest depend on these
original archives. Current SOR evaluates current-season achieved outcomes
using frozen population coefficients. The SOR coefficients already have their
own repaired-history calibration lineage. Current Predictive Strength carries
earlier team Strength through the retained 0.75 factor, so archive repairs can
propagate through the prior. The live current-season outcomes graph continues
to come from CFBD.

## Before-and-after coverage comparison

Both runs used the identical frozen engine settings and the scale-14 baseline
probability link. Changing only archive coverage isolates the data effect.
These numbers do not represent the separately calibrated public win odds.

| Metric on 2,398 FBS–FBS games, 2023–2025 | Original archive | Repaired archive |
| --- | --- | --- |
| Correct winner rate | 71.2677% | 71.1009% |
| Brier score | 0.197123 | 0.197075 |
| Log loss | 0.581152 | 0.581035 |
| Margin MAE, points | 13.072436 | 13.072706 |

This comparison uses previously examined retrospective seasons. Probability
scores improved slightly while winner accuracy and margin error worsened
slightly. It does not establish future predictive superiority.

As a separate sensitivity calculation, applying the repaired prior to the
same November 18 graph changed FBS Strength by at most 0.005245 points.
UCLA and Arizona exchanged Predictive ranks 19 and 18. Baylor and Penn State
exchanged 27 and 28. Top 25 membership was unchanged. SOR does not use this
historical team prior. The sensitivity did not replace any saved publication.

The read-only reproducer prints all source hashes and result summaries.

```powershell
node research/audit_historical_lineage.mjs --data-dir PATH_TO_ORIGINAL_DATA --repaired-dir PATH_TO_VERIFIED_REPAIRED_SEASONS
```

It requires the exact saved source versions and rejects checksum mismatches.
It makes no network request and writes no data. The compact release can
restore the repaired research seasons with `research/apply_release.py`.

## Forecast and ranking validation status

| Surface | Existing evidence | Remaining limit |
| --- | --- | --- |
| FBS–FBS win probability | Scale 6.147406563247917 fitted on 4,367 preweek games, 2014–2019. In 2,398 held-out games, 2023–2025, Brier improved from 0.197123 to 0.183246 and log loss from 0.581152 to 0.541354. | Retrospective corrected data with a 24-hour result buffer. Future evidence remains separate. |
| FCS–FCS Weekly Picks | Scale 6.74434303402901 fitted on 3,777 games, 2014–2019. In 3,293 games, 2021–2025, Brier improved from 0.197734 to 0.185814 and log loss from 0.582568 to 0.548432. Winner accuracy was 70.6561%. | Sparse spring-2020 coverage was excluded as target data. Neutral-site evidence is limited. |
| FBS–FCS win estimates | Uses the fixed Strength margin and scale 14. | Cross-division probability calibration remains unavailable. |
| FBS SOR | Fixed division-aware achieved-results method with exact game removal and a source-designated FBS reference population. | Retrospective SOR tail probabilities do not constitute future-game odds or rank confidence intervals. |
| FCS SOR | FCS reference population and explicit FBS/FCS opponent adjustment. | Transfers the FBS SOR coefficients. FCS-specific SOR calibration remains untested and the view remains Experimental. |
| Performance | Exact same-snapshot matching and coverage validation. The retained recent-prior candidate has separate retrospective checks. | Experimental descriptive ranking. The original cross-division forecast bias gate failed and remains documented. It does not incorporate every turnover, special-team or short-field effect. |
| Final-margin range | The 22-point half-width covered 963 of 1,158 2024–2025 finals, after fitting in 2023 with at least four earlier games per team. | Pooled retrospective coverage, with no validated team-specific rank or probability confidence intervals. |
| Conference quality | Reconciles raw outcomes, opponent ratings and the documented capped-margin score. | Experimental descriptive score. Historical forecasting validation is pending. |

The current graph has 632 FBS–FBS, 123 FBS–FCS and 590 FCS–FCS
games. It also includes 48 unknown-subdivision nodes and 106
unknown-involved network games. Direct FBS opponents must be classified before
official SOR is published. Unknown nodes retain their label and can influence
the network indirectly. They do not silently become FBS or FCS.

The separate `fcs-coverage-v1` research supplement contains 34 added games and
three narrowly adjudicated score corrections. It corroborates 253 of 253
normal-season FCS tournament identities across the checked seasons, while the
15 spring-2020 tournament games remain missing because the original roster
largely omits those teams. This finite tournament check does not certify all
regular-season lower-division schedule coverage.

## Public reporting

Current conference SOR, Predictive Strength and Performance comparisons cover
all available FBS teams. AP and CFP remain Top 25 polls, with other covered
teams displayed as unranked. The 2025 conference archive has end-of-season
Predictive Strength and SOS but no verified as-published SOR, Performance or
poll history. Pregame displays use only saved or dated editions that were
available before kickoff.

The model report card reuses `validWeeklyPick` and `weeklyPicksScore` to grade
only saved pregame forecasts. It keeps historical replays and current estimates
outside the live tally. Ties and unavailable results remain ungraded. The SOR
comparison uses published team scores and schedule evidence, without adding
a head-to-head override or creating a predictive ranking.

Recommendation for a future model promotion is to compare calibrated repaired
inputs under a newly versioned validation protocol and collect prospective
evidence. This release makes the lineage and limitations clearer while retaining
the numerical production model and immutable saved results.
