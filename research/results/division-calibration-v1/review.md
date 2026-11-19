# Independent calibration research review — November 18, 2026

Decision: the offline evidence is suitable for review and an explicitly separate prospective cross-division shadow. It does not authorize a production model change. Keep the present FCS SOR coefficients and Experimental label. No blocking implementation issue remains in the reviewed research calculators or shadow recorder.

## Scope and evidence actually checked

This review inspected the frozen joint protocol, its retained buffer clarification, both calibration runners, the independent FCS feature exporter, their test files, the cross-division report, and the optional prospective recorder. The reviewer independently recomputed reported probabilities and proper scores from the final per-game artifacts, rather than relying only on their summaries. The reviewer did not independently refit every logistic model or rerun the entire Python feature export; those executions and their checksums are recorded by the implementing researcher.

The original protocol SHA256 is `d155cd2829f73752281e9d0cf6ed5d891c612084ea62cb193978d6d4467c7790`. The clarification preserves that file and states the operational buffer correctly: included result kickoff plus 24 hours must be no later than the forecast cutoff. It changes no family, split, penalty or production parameter.

Newly fitted candidate families use 2014–2017 for fitting and 2018–2019 for selection; each runner refits its chosen family on 2014–2019 and calculates later-period scores after that lock. Baselines remain eligible. Final-period outcomes and 2026 rank appearance are not used for selection. All evaluation years were previously inspected; this is not an untouched holdout. The original Strength settings also used 2021–2022 during their earlier development.

There is a specific additional FCS selection limitation: its transferred production baseline was originally fitted on FBS-involving 2014–2019 games. Therefore 226 cross-division games in the 2018–2019 selection cohort directly contributed outcomes to that baseline's earlier fit, while newly fitted FCS families use only 2014–2017 at that selection stage. Other FCS results also entered that earlier fit's full-network features. The transferred-versus-new-family selection comparison is not an equal-information, independent selection test. Keeping the incumbent is a conservative decision under the declared rule, not proof that FCS-specific coefficients cannot improve SOR assumptions. A later diagnostic evaluating all prespecified families must be explicitly dated and labeled postfit, without reselecting the primary family.

## Cross-division findings

- The runner verifies all 22 original normalized-season hashes, frozen engine/history/config hashes, replay implementation hash and retained audit checksum. Its 602 evaluation predictions exactly reproduce the previous audit's original target rows. The same preweek replay excludes target-week results and enforces the 24-hour buffer, including prior-season inputs.
- The selected temperature-plus-signed-division coefficients are `[2.329814851971762, 1.869996947261027]`. Signed FBS orientation and the absence of a free home-label intercept preserve probability complementarity. Fixed coefficients are not penalized, and nonpositive fitted slopes are rejected.
- Independent per-row recomputation confirms 602 games, Brier loss `0.04720166178308628`, natural-log loss `0.17114985207341588`, and 568 correct winners. The selected model favors FBS in every evaluation game and misses every one of the 34 FCS victories. Its 94.3522% winner accuracy therefore exactly equals always choosing FBS.
- The older-training-rate diagnostic has Brier `0.05349282274076437` and log loss `0.21882626337539055`. The selected link improves pooled probability scoring beyond this constant, but has no winner-accuracy advantage over it. Its 2025 Brier loss is worse than the constant's, while its 2025 log loss is better. Do not omit that mixed result.
- There are 595 source-FBS-home evaluation games, seven source-neutral games and zero FCS-home games. Two FCS-home training games cannot establish general venue-specific behavior. No causal neutral-field subdivision gap is identified.
- Outcome-conditioned upset checks are correctly labeled postfit descriptions and do not alter family selection. They expose overconfident misses that a pooled accuracy percentage would hide.

## FCS SOR findings

- The exporter independently rebuilds every selected preweek and exact final-network leave-one-game-out feature for 2014–2025 and compares it with the retained cache. Recorded maximum feature discrepancy is about `1.11e-15`. The frozen parent report, release, manifests and original → FBS repair → FCS supplement checksum chain are verified. The runner checks those hashes and the exporter's source hash before fitting.
- Final-network excluded-game features include other later-season results. They are valid descriptive outcome-link evidence under the declared experiment; they are not historical pregame forecasts. The separate preweek diagnostic is fitted and selected independently and cannot replace the primary result.
- The primary selection keeps the transferred production coefficients. Selection log losses are `0.5105926566376147` for transferred, `0.5112201418231216` for FCS slope/home, and `0.5115819855102901` for all three FCS coefficients. The changed fits do not beat the baseline under the frozen selection rule, but the baseline's prior exposure to the selection period prevents interpreting this result as a fair independent comparison of the fits.
- Independent final-artifact recomputation confirms 3,895 later descriptive games, Brier `0.16089078413390867`, log loss `0.48208428328460295`, and 2,960 correct outcomes. These values describe final-network reconstructions, not live forecast accuracy. Chosen-model versus baseline deltas are exactly zero.
- The current production FCS calculation reproduces with zero score error across 128 teams and 25/25 Top 25 overlap. Its scored-game exclusions and mean source-FCS reference are preserved.
- The separate preweek Colley diagnostic selects FCS slope/home and has Brier `0.1828811244140419`, log loss `0.5388187105797929`, and 2,785/3,895 correct. Proper scores improve slightly but winner accuracy declines from 71.6303% to 71.5019%. This is not the live margin-based Predictive Strength engine and is not evidence to change live Strength calibration or descriptive SOR coefficients.
- A better actual-team probability link would not alone validate the mean-reference substitution, independent-game record-tail assumption or a uniquely fair achievement order. Keep those limitations visible.

The final FCS compressed result checked here has SHA256 `7b9e56f3b9e9f3135b6d3305f76288c12229a9048d7c08ddb5e692e28791ce3f`. Its last code-hash update and compact summary formatting preserve all previously checked coefficient and per-game values; full reliability bins remain in the compressed result.

The coordinating researcher retained an explicit diagnostic amendment declared at `2026-11-19T00:19:34Z`, after inspecting primary results, SHA256 `7af297dcc74e1905be35c1f6cfaa0734e0472ddc882311f05e9f07da6dbff810`. It refits and reports all three already declared families on identical 2014–2019 data in both contexts. No new family, source, penalty or selection rule is introduced, and the primary selected family is not changed. The reviewer independently recomputed all six sets of 3,895 diagnostic probabilities and aggregate losses from the final artifact.

For the descriptive final-network context, transferred / FCS slope-home / FCS all have log losses `0.4820842833 / 0.4817791686 / 0.4817532272` and Brier losses `0.1608907841 / 0.1607525245 / 0.1607510439`. The FCS-all candidate has a tiny descriptive gain, while its paired loss-delta sensitivity intervals include zero. These inspected postfit differences justify further fair testing, not production selection. The separate preweek diagnostics retain the earlier small proper-score gain and slight winner-accuracy decline. This diagnostic does not repair the original selection-period exposure or create an untouched holdout.

## Recorder and preservation checks

The optional cross-division recorder uses confirmed, still-scheduled fixtures with matching snapshot/weekly source identities, explicit FBS/FCS labels, actual capture time after the parameter freeze, and kickoff strictly in the next seven days. Both candidate and baseline use the same current Strength graph. The cached source is allowed to predate the parameter freeze and that limitation is explicit; existing public saved picks are preserved and are not relabeled as paired observations.

Exclusive writes, repeat-input identity checks, prewrite kickoff guards and postwrite kickoff guards prevent a late or overwritten observation from being retained. Future grading must independently check corrected kickoff, participants, venue and first eligible capture; a retained ungraded forecast is pending evidence, not a successful prediction. The initial capture was manual; later optional research wiring reuses the existing refresh workflow and adds no separate recurring schedule.

The actual retained observation contains four upcoming cross-division games. Independent input-file/checksum checks passed. Its capture at `2026-11-19T00:17:45.238Z` follows the actual parameter freeze at `2026-11-19T00:17:44.341Z` and precedes all four November 21 kickoffs. All four outcomes remain pending in this research record.

The separate grader was reviewed after the observation freeze. It verifies the original frozen manifest, exact model identity, observation checksums, probability/margin reconciliation, source chronology and current published-source alignment. It selects the earliest valid capture before examining results and does not replace an ineligible first capture with a later favorable one. Changed participants/venue/divisions, cancellations, tied finals and out-of-window reschedules are excluded explicitly; postponed, missing, unconfirmed or unresolved results remain pending. Exactly 50% probabilities receive half accuracy credit. The final grader writes its research result atomically after validation, avoiding a partially truncated report being staged by the workflow. Its implementation is pinned separately rather than changing the already frozen model manifest.

The actual CLI grading artifact at `2026-11-19T00:23:54.106Z` reports zero graded games, four pending games and zero exclusions; accuracy and proper-score fields remain null. The reviewer independently verified that artifact's checksum, the evaluator implementation pin, the companion's workflow checksum and the pending/empty-score state. The coordinator also reran capture and reported `created: false`, preserving the original observation time rather than replacing it.

Before operational wiring, the reviewer independently hashed all 476 protected current files listed in the FCS result and confirmed they matched the recorded baseline. The final operational check finds one intentional exception: `.github/workflows/weekly.yml` adds optional research capture/grading after the existing successful weekly-picks publication, plus narrowly scoped research artifact staging. The other 475 files still match. Both new steps use `continue-on-error`; no provider pull or schedule is added, and research failures do not block the existing public publication. These scripts contain no provider fetch; no API call was needed. Production model, policy, prior, published snapshot, existing saved forecasts and website source remain unchanged.

## Executed tests and corrections

The reviewer ran:

`node --test research/cross-division-calibration.test.js research/fcs-sor-calibration.test.mjs research/capture-cross-division-shadow.test.mjs research/evaluate-cross-division-shadow.test.mjs research/historical_foundation.test.js research/lib/division_candidate.test.mjs`

Result: **58 passed, zero failures, zero skips**. This covers 10 cross-division tests, nine FCS tests, seven shadow-recorder tests, 14 prospective-grader tests, 11 existing chronology/support tests and seven existing exact excluded-game/forecast invariance tests. It includes orientation symmetry, finite fits, fixed-coefficient handling, missing-data states, exact 50% accuracy credit, complexity tie-breaking, deterministic paired blocks, current FCS scope parity, immutable before-kickoff capture, first-capture selection, source/result reconciliation and cancellation/reschedule/tie handling.

Issues raised and corrected during review:

1. Ambiguous previous-season buffer wording: retained dated clarification, unchanged replay rule.
2. Undeclared positive-slope floor: removed projection; invalid nonpositive slopes are rejected.
3. Sequential near-tie family selection: corrected to global minimum plus declared tolerance, then complexity and family order; regression test added. Actual selected coefficients did not change.
4. Insufficient explicit FCS parent lineage guards: added frozen parent/release/manifest/hash-chain verification before fitting.
5. Misleading “prior games” wording for final-network samples: changed to available network games, distinguishing later descriptive context from genuinely prior results.
6. Unequal selection-period exposure of the existing SOR coefficients: explicitly documented and bounded by a dated, nonselecting diagnostic amendment.
7. Plain latest-report write in the optional grader: changed to the existing atomic writer before freezing its implementation.

No website or browser interaction was required for these research-only additions. The coordinating researcher reports final `npm test` results of 396 passed, zero failures and zero skips, plus unchanged checksums for 383 core production files. This reviewer independently executed the 58-test subset above; it does not claim to have executed that broader 396-test run. Final Git/publication checks are reported separately by the coordinator. The first scheduled execution of the optional research steps remains future operational evidence.
