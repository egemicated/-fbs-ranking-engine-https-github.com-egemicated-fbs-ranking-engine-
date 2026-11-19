# FCS-specific SOR calibration research — November 18, 2026

Keep the current FCS SOR coefficients while evaluating this research. The frozen selection rule retained the transferred production coefficients, but the baseline had already used part of the selection period in its original fitting. This is a conservative hold decision, **not independent proof that FCS-specific fitting is worse**. No ranking mathematics, public predictions, publications, historical inputs or scheduled jobs changed. FCS SOR remains Experimental. This branch used zero CFBD calls.

## What was tested

The shared frozen protocol is `research/division-calibration-protocol-v1.json` (SHA256 `d155cd2829f73752281e9d0cf6ed5d891c612084ea62cb193978d6d4467c7790`), with the retained buffer clarification `division-calibration-protocol-v1-clarification.json`. Fit 2014–2017, select the family on 2018–2019 log loss, refit only that chosen family on 2014–2019, and then evaluate 2021–2025. All these seasons were previously inspected; this is retrospective evidence, not an untouched holdout. Source records are retrospectively corrected and do not prove what was available in real time.

Three candidates were declared before fitting:

1. Existing transferred coefficients: slope `5.159563190867806`, home log odds `0.3809700209732449`, division log odds `2.401314541603099`.
2. Fit the slope and home coefficient to FCS-involving games, keeping the division coefficient fixed.
3. Fit all three coefficients to FCS-involving games.

The link is `sigmoid(slope × Colley difference + home coefficient × signed venue + division coefficient × signed FBS–FCS indicator)`. There is no intercept, scoring margin, preseason credit, poll or conference effect. The penalty is `0.5 × 0.01 × sum(fitted coefficients²)`; fixed coefficients are excluded from the penalty. The ordinary log loss, without that penalty, selects the family. Fits must converge and have a positive slope. The transfer baseline is eligible, and ties within `0.000001` favor fewer fitted coefficients.

The primary context removes the target game exactly from the final season's Colley network. **Other later results remain in that network. These are descriptive outcome-link measurements, not pregame forecasts.** They investigate the probability assumptions used in SOR. Improved link scores alone would not establish a fairer achievement ordering or validate independent-game tail probabilities.

## Primary result: keep the baseline

There were 2,924 initial fitting games and 1,503 selection games involving FCS teams. Each decisive known-D1 game appears once, including FCS–FCS and FBS–FCS games. Other source divisions remain network context, without becoming eligible scored targets.

| Candidate fitted on 2014–2017 | Selection log loss, 2018–2019 | Selection Brier |
|---|---:|---:|
| Current transferred coefficients | **0.510593** | **0.172299** |
| FCS slope/home, fixed division coefficient | 0.511220 | 0.172520 |
| FCS slope/home/division | 0.511582 | 0.172602 |

Lower scores are better. The unchanged baseline won the declared selection rule. The two fitted selection candidates had coefficients `[5.240690, 0.321331, 2.401315]` and `[5.220278, 0.327581, 2.277321]`, respectively. Their later outcomes were not used to choose another candidate.

The baseline comparison has a material limitation: its transferred FBS coefficients were originally fitted on 2014–2019 FBS-involving games. That includes the 226 FBS–FCS targets in the 2018–2019 selection slice; the other 1,277 FCS–FCS selection outcomes contributed indirectly to its full outcome network. The new candidates were fitted only on 2014–2017 before selection. The comparison therefore favors the baseline through unequal selection-period exposure. Retaining production is conservative, but these selection scores cannot establish a fair independent superiority claim.

The selected unchanged model subsequently scored 3,895 retrospective evaluation games: 3,293 FCS–FCS and 602 FBS–FCS. Its final-network descriptive log loss was `0.482084` and Brier `0.160891`. These values must not be shown as the site's live predictive record. Since selection retained the baseline, all paired model differences and their resampling bounds are exactly zero.

All 128 current FCS teams were reconstructed using the production FCS publisher. Scores, ranks, actual records and scored-game records matched the retained production static export for snapshot `a36df50d7f94c050e03b2d5df03cba802067d8dd2a1732f715a3ea3cc57dc4c1`, cutoff `2026-11-18T12:30:14.250Z`, with **zero score reproduction error**. The export reference and its origin hash are retained in the research artifacts. Since the chosen model is unchanged, Top 25 membership and every rank are unchanged. This verifies parity against a retained static export; it is not a new network request to the public service.

## Explicit post-selection diagnostic

After identifying the unequal baseline exposure, a dated amendment was recorded at `2026-11-19T00:19:34Z` (November 18 Mountain Time): `research/division-calibration-protocol-v1-diagnostic-amendment.json`, SHA256 `7af297dcc74e1905be35c1f6cfaa0734e0472ddc882311f05e9f07da6dbff810`. It permits only the three already declared families, the same 2014–2019 refit window, the same penalty, and the same 2021–2025 target identities. **This was declared after inspecting the primary results. It is a post-selection diagnostic, not preregistered confirmation.** The original primary selection and results remain intact; these extra scores do not reselect or promote a model.

| Final-network mapping, same 2014–2019 cutoff | Later descriptive log loss | Later descriptive Brier |
|---|---:|---:|
| Transferred production baseline | 0.482084 | 0.160891 |
| FCS slope/home refit | 0.481779 | 0.160753 |
| FCS slope/home/division refit | 0.481753 | 0.160751 |

The three-coefficient refit is `[4.988390644434694, 0.33156159476574554, 2.4213706414875666]`. Its small point improvements do not provide strong evidence for a change: the candidate-minus-baseline log-loss sensitivity range is `[-0.001104, +0.000409]`, and the Brier range is `[-0.000393, +0.000105]`. Both span zero. Identical target games and equal training cutoffs improve comparability, but do not undo prior inspection, source coverage limitations or the different fitting populations. A separately declared equal-cutoff control study and genuine future evidence would be needed for a stronger claim.

The same bounded diagnostic is retained for the preweek context separately. No fitted coefficient crosses from that context into the excluded-game SOR calculation.

## Separate preweek diagnostic

The same three families were fitted and selected independently using only earlier competition weeks whose kickoff plus 24 hours precedes the entire target week's cutoff. The target week's outcomes never enter its network. No preseason prior is used by this Colley diagnostic.

This diagnostic selected the FCS slope/home family. Its final refit coefficients are `[4.066416506341563, 0.3294214977075805, 2.401314541603099]`. On 3,895 later games:

| Metric | Transferred baseline | Selected preweek diagnostic |
|---|---:|---:|
| Log loss | 0.542093 | 0.538819 |
| Brier | 0.184043 | 0.182881 |
| Winner accuracy | 71.630% | 71.502% |

The candidate reduced probability losses but selected five fewer correct winners. The paired competition-week 95% sensitivity ranges were `[-0.006231, -0.000288]` for log-loss change and `[-0.002100, -0.000209]` for Brier change. These are descriptive resampling intervals, not definitive prospective confidence intervals. Games share teams, schedules and source coverage.

**This is not a comparison against the live Predictive Strength forecast.** It is a separately fitted Colley preweek mapping. It cannot justify changing the SOR coefficients, which were selected in the distinct excluded-game context, or replacing the stronger existing predictive engine. No diagnostic coefficients were transferred across contexts.

## Data and validation

The exporter verified the frozen Round 2 report's uncompressed hash, the FCS repair release and manifest, its historical-repair parent manifest, and the original → FBS-repaired → FCS-supplement hashes for each 2014–2025 season. Every selected cached feature was then independently rebuilt from the full source graph: preweek features with the 24-hour cutoff and final-network features with exact matrix downdates. All twelve seasons matched their cached rows, outcomes, subdivision groups, blocks and small-sample markers, within a maximum feature error of `1.1102230246251565e-15`.

The late evaluation contains 595 FBS-home cross-division games, seven neutral games, and **zero FCS-home games**. Unsupported venue slices remain missing; they are not treated as zero performance. The selected schedules cannot identify a causal neutral-field division gap. Final-network small-sample markers count other games in that network, while preweek markers count prior eligible games. Source coverage and retrospective subdivision labels remain limitations.

Leave-one-refit-season-out coefficients and convergence diagnostics are retained for every declared candidate. They are stability diagnostics, without changing the chosen family. The 2020 stress slice has only 49 eligible source games and is explicitly incomplete.

Nine focused Node tests passed: fixed coefficients and penalty scope; converged fitted gradients; nonpositive-slope rejection; side/venue reversal and complementarity; empty slices and 50% ties; complexity tie breaks; deterministic block resampling; production FCS record/scored-game parity; and unique known-division targets with preweek buffers. The numerical run also verified protected production files and saved observations remained byte-identical.

Reproduction:

```text
python research/export_fcs_sor_features.py --input-root ../fbs-ranking-engine
node --test research/fcs-sor-calibration.test.mjs
node research/fcs-sor-calibration.mjs
```

The Python export needs NumPy and the exact retained source datasets/cache. Once the checked compressed feature fixture exists, the JavaScript fit, scores, resampling and current-rank illustration run using Node without additional libraries or API requests. Artifacts are in `research/results/division-calibration-v1/fcs-*`; the compressed detailed result preserves per-game evaluation probabilities and protected hashes. No production changes are proposed from this branch.
