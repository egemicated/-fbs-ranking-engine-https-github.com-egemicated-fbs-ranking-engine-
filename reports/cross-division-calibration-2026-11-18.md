# FBS–FCS probability-link research

Status: offline Experimental candidate. No production ranking, forecast, probability policy, prior, published snapshot, or saved-pick change. Zero provider/API calls.

The existing cross-division probabilities substantially underestimate FBS teams on the retained schedules. A two-parameter correction improves retrospective probability scoring, but its apparent winner improvement is exactly matched by picking the FBS team in every game. It has not demonstrated a new ability to identify FCS upsets.

## Frozen experiment

The joint protocol is `research/division-calibration-protocol-v1.json`, SHA256 `d155cd2829f73752281e9d0cf6ed5d891c612084ea62cb193978d6d4467c7790`. The retained clarification, SHA256 `2cb0b795694a62ed3b7d4dc8888a25ec90d1d56508a5c0bd1001cfd0c44d6da0`, makes the chronology rule explicit: the latest included kickoff plus 24 hours must be no later than the forecast cutoff. It changes no candidate or split.

The primary source is the original, checksum-matched 2004–2025 source archive, including its recursively rebuilt original priors. No repaired historical prior was substituted. The runner verifies all 22 original season hashes, frozen production engine/history/config hashes, retained audit checksum and replay implementation hash. It reproduces every field of the 602 retained 2021–2025 cross-division audit forecasts exactly.

For each source competition week, the Strength graph is frozen before that week's earliest kickoff. The graph uses only earlier processed weeks whose kickoff plus 24 hours precedes that cutoff. Target-week results never enter their forecast graph. Prior seasons receive the same buffer check. Both sides must have explicit season-specific source FBS/FCS labels; unknown divisions are excluded rather than inferred.

* Fit: 2014–2017, 424 games.
* Select family: 2018–2019, 226 games, lowest natural-log loss. Within 0.000001 of the global minimum, prefer fewer fitted coefficients and then listed order.
* Refit the selected family: 2014–2019, 650 games.
* Final retrospective evaluation: 2021–2025, 602 games.
* 2020: separate stress description, 34 games; never used to select/refit the link. Original 2020 results remain in subsequent priors.

All final evaluation seasons were previously inspected. The original Strength engine also used 2021–2022 in its earlier setting selection. These are chronological retrospective comparisons, not a fresh untouched holdout or an actual historical saved-pick record. Historical source availability cannot be certified from the current archive.

## Formula and selection

Let `m` be the existing home Strength margin, including the unchanged 2.5-point home advantage (zero at neutral venues). Let `s` be +1 for an FBS home team and −1 for an FCS home team. `sigmoid(z) = 1 / (1 + exp(−z))`.

The frozen family list was:

1. Baseline: `sigmoid(m / 14)`.
2. Temperature: `sigmoid(a × m / 14)`.
3. Division offset: `sigmoid(m / 14 + d × s)`.
4. Temperature plus division: `sigmoid(a × m / 14 + d × s)`.

Fits minimize summed Bernoulli negative log likelihood plus `0.5 × 0.01 × sum(fitted coefficients²)`. Fixed coefficients are not penalized. Fits must converge and fitted margin slopes must be positive; invalid candidates are rejected. No separate venue coefficient or home-label intercept was fitted. Swapping sides, signs and venue preserves probability complementarity.

| Family | 2018–2019 selection log loss | Selection Brier loss |
| --- | ---: | ---: |
| Baseline | 0.460691 | 0.142519 |
| Temperature | 0.308700 | 0.097787 |
| Division offset | 0.166264 | 0.039686 |
| Temperature plus division | **0.150811** | **0.038528** |

The fourth family was selected before final-period metrics were calculated. Its locked refit coefficients are `a = 2.329814851971762`, `d = 1.869996947261027`:

`P(home wins) = sigmoid(m / 6.009061187051651 + 1.869996947261027 × s)`.

This changes only the probability mapping. It does not change Strength points or predicted margins. The signed division term is an empirical correction for these selected schedules, not a causal estimate of the subdivision gap at a neutral venue.

## Retrospective result

The diagnostic constant uses only the older refit sample's FBS win rate, 92.9231%. It was not eligible for model selection.

| Measure, 602 games | Existing mapping | Selected candidate | Older FBS-win-rate constant |
| --- | ---: | ---: | ---: |
| Correct winners | 532 | 568 | 568 |
| Incorrect winners | 70 | 34 | 34 |
| Winner accuracy | 88.3721% | 94.3522% | 94.3522% |
| Brier loss, lower is better | 0.138591 | 0.047202 | 0.053493 |
| Natural-log loss, lower is better | 0.454484 | 0.171150 | 0.218826 |
| Mean predicted FBS chance | 64.5787% | 93.8091% | 92.9231% |
| Actual FBS win rate | 94.3522% | 94.3522% | 94.3522% |
| Ten-bin calibration error | 0.297735 | 0.009332 | 0.014291 |

The candidate favored the FBS team in all 602 evaluation games. All 34 FCS upsets were missed. It changed 76 baseline winner selections, yielding 36 more correct selections overall, but **has no winner-accuracy advantage over always choosing FBS**. Its useful evidence is the substantially better probability scoring than the live mapping and better pooled probability scoring than the older-rate constant.

Reliability bins and mean bias are oriented to the FBS team, independent of the nominal home label. Home-oriented fixed bins from earlier audits can therefore differ slightly. Proper losses and winner accuracy are invariant to that orientation. Ten-bin error is bin-sensitive and is not sufficient evidence by itself.

| Season | Games | Existing Brier | Candidate Brier | Constant Brier | Existing log loss | Candidate log loss | Constant log loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2021 | 117 | 0.162559 | 0.089824 | 0.093056 | 0.506505 | 0.311524 | 0.337494 |
| 2022 | 120 | 0.143423 | 0.052105 | 0.062239 | 0.465894 | 0.182202 | 0.245060 |
| 2023 | 118 | 0.132562 | 0.027221 | 0.034109 | 0.441633 | 0.108737 | 0.160684 |
| 2024 | 121 | 0.127063 | 0.033786 | 0.047577 | 0.431264 | 0.121050 | 0.201081 |
| 2025 | 126 | 0.128451 | 0.034549 | **0.032261** | 0.429646 | 0.136839 | 0.155142 |

The candidate improves both losses over the existing mapping in each evaluation season. Against the constant, 2025 Brier loss is worse while log loss is better. That disagreement should remain visible.

## Stability, coverage, and failure cases

The 2,000 paired season/competition-week block resamples use seed 20261118 and 48 retained evaluation blocks. Candidate-minus-baseline sensitivity intervals are:

* Brier loss: −0.101854 to −0.079190.
* Log loss: −0.316548 to −0.245684.
* Accuracy: +3.259 to +8.553 percentage points.

These are resampling sensitivity intervals, not certified prospective confidence intervals. Weeks share teams and all seasons were previously inspected. They compare against the live mapping, not the constant diagnostic.

Leaving out each of the six refit seasons gives equivalent scales from 5.7047 to 6.4786 and division offsets from 1.7485 to 1.9676. All fits are finite, positive-slope, and converged. These stability diagnostics did not change selection.

Venue support is highly uneven: 595 evaluation games have FBS at home, seven are source-labeled neutral, and zero have FCS at home. On the seven neutral games, candidate accuracy falls from 7/7 to 6/7 while probability losses improve. Seven observations cannot establish neutral-venue performance, and FCS-home performance is unavailable. No independent home-versus-division effect is identified.

The separate 2020 stress sample improves from 31/34 to 33/34 winners, Brier 0.118391 to 0.028911, and log loss 0.406046 to 0.117223. COVID scheduling and sparse cross-division support limit its relevance.

Postfit outcome-conditioned checks are descriptive only. In the 34 actual FCS upsets, mean candidate FBS probability is 82.6930%, Brier loss is 0.697133, and log loss is 2.021142, worse than the existing mapping on those upset cases. The much larger FBS-win group drives the pooled gain. Among the strongest mistaken favorites were Tulsa over UC Davis (97.76%, lost 17–19), Washington over Montana (97.08%, lost 7–13), and Florida State over Jacksonville State (96.69%, lost 17–20), all in 2021. These cases reinforce that an improved average probability link does not solve player availability, early-season uncertainty, or upset identification.

## Recommendation and reproducibility

Keep this candidate offline/Experimental and begin an immutable paired prospective shadow using the same source snapshot and kickoff eligibility for both mappings. Do not compare a new candidate's later snapshot with older saved production picks as if their information were identical. Preserve original forecasts and production behavior. Further genuine future evidence, independent review, and Bryan's approval are required for any promotion.

Reproduce with `node research/cross-division-calibration.mjs`, using checksum-matched original seasons from sibling `fbs-ranking-engine/data/seasons`. The runner has no network code. Run `node --test research/cross-division-calibration.test.js` for the ten focused tests. Detailed metrics, reliability counts, source/protected hashes, case checks, and coefficients are in `research/results/division-calibration-v1/cross-division-summary.json`; target rows and chronology checkpoints are in the paired `cross-division-predictions.json.gz` artifact. All protected publication, prior, policy, and existing saved-forecast bytes were checked unchanged before and after the run.
