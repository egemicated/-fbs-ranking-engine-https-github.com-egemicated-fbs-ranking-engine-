# Division calibration research — November 18, 2026

Keep the published rankings, SOR coefficients and existing saved predictions. Continue the new FBS–FCS probability challenger as a separate prospective research trial. The retrospective improvement is substantial, but its winner accuracy equals simply choosing FBS every time. Dedicated FCS SOR refits show only small, uncertain improvements and do not justify a production change.

## Findings

| FBS–FCS games, 2021–2025 | Current probability mapping | Research challenger | Older-season FBS win-rate comparator |
|---|---:|---:|---:|
| Games | 602 | 602 | 602 |
| Correct winners | 532 | 568 | 568 |
| Winner accuracy | 88.37% | 94.35% | 94.35% |
| Brier loss, lower is better | 0.138591 | 0.047202 | 0.053493 |
| Log loss, lower is better | 0.454484 | 0.171150 | 0.218826 |

The current mapping assigned the FBS team an average 64.58% win probability. FBS actually won 94.35% of these games. The challenger averaged 93.81%. It improved probability scoring against both the current mapping and an unconditional FBS probability estimated from 2014–2019. However, it favored FBS in **all 602 games** and missed all 34 FCS upsets. It has not demonstrated an advantage at identifying upset winners. In 2025 alone, the constant comparator also had a slightly better Brier score than the challenger; the challenger had better log loss. This is a promising probability correction, not evidence of universal superiority.

The sample is heavily selected: 595 evaluation games list FBS at home, seven are source-designated neutral games and none list FCS at home. Do not infer a causal neutral-field subdivision advantage or claim validated away-FBS probabilities. The four initial future observations below are also FBS home games and cannot resolve that gap.

For FCS SOR, the primary frozen selection retained the current transferred coefficients. That comparison has a documented weakness: those production coefficients originally used 2014–2019 FBS-involving games, including 226 cross-division outcomes in the new selection window. The 1,277 FCS–FCS selection games also contributed graph context. New FCS fits only used 2014–2017 before selection. Retaining the baseline is conservative; it does **not** prove that FCS-specific estimation is worse.

A dated, explicitly post-selection diagnostic refitted all three predeclared families through 2019 and evaluated the same 3,895 later games. The three-coefficient FCS refit reduced descriptive log loss from 0.482084 to 0.481753 and Brier from 0.160891 to 0.160751. Both paired week-block sensitivity ranges included zero. No family was reselected using this diagnostic. An equal-training-cutoff control study and genuine future evidence are needed before a stronger claim.

The separate prior-week Colley diagnostic improved probability losses but selected five fewer correct winners. It is neither the live Predictive Strength engine nor the final-network SOR calculation, and its coefficients were not transferred into either. All 128 current FCS scores and ranks reproduced the retained matching static publication exactly; the selected primary model changes none of them.

## Formula and evidence rules

The challenger changes only the conversion from existing Strength points to a probability:

```text
margin = home Strength − away Strength + existing venue points
venue points = 2.5 for a nonneutral home game, otherwise 0
division sign = +1 if home is FBS, −1 if home is FCS
log odds = 2.329814851971762 × margin / 14
           + 1.869996947261027 × division sign
probability home wins = 1 / (1 + exp(−log odds))
```

This does not change Strength points, predicted margins, SOR, team records or the opponent network. The division term is an empirical calibration correction for these selected schedules. It is not a mandatory winner rule or a new scoring-margin bonus.

The frozen protocol fits 2014–2017, selects the family using 2018–2019 log loss, then refits that family through 2019 before evaluating 2021–2025. Four cross-division families and three FCS SOR families were specified; the baseline was eligible. Positive fitted slopes, convergence, penalty scope, orientation symmetry, and deterministic tie-breaking are checked. Preweek graphs exclude the entire target competition week and require each earlier result's kickoff plus 24 hours to precede the cutoff.

Every evaluation season had already been inspected by this project. Seasons 2021–2022 also influenced original Strength settings. These are chronology-guarded retrospective tests, **not an untouched holdout** or an actual saved-live-pick record. Historical corrections do not certify what data existed at each old kickoff.

SOR's final-network excluded-game context intentionally includes other later season results. It describes schedule difficulty after those results; it is never presented as a pregame forecast. Better per-game probability losses also cannot establish a uniquely fairer earned ranking, validate the hypothetical average-reference substitution, or prove independent game outcomes in the record-tail calculation.

Brier and log loss assess probability quality; reliability bins and sample counts are reported separately. A lower Brier score alone does not establish better calibration. See the [primary proper-scoring research](https://sites.stat.washington.edu/raftery/Research/PDF/Gneiting2007jasa.pdf) and [calibration documentation](https://scikit-learn.org/stable/modules/calibration.html). Resampling uses 2,000 seeded paired season/competition-week blocks; shared teams, few seasons and prior inspection limit interpretation. These are sensitivity intervals rather than definitive prospective confidence intervals.

## Future trial

The coefficients and capture implementation were frozen at **2026-11-19 00:17:44.341 UTC** (November 18 at 5:17:44 p.m. MST). Four research forecasts were actually saved at **00:17:45.238 UTC**, before the November 21 kickoffs. Both sides of each comparison use the same November 18 published Strength checkpoint. Earlier public picks, including their original saved times, remain intact.

| November 21 game | Same-checkpoint current mapping | Challenger |
|---|---:|---:|
| Wofford at Ole Miss | 82.37% Ole Miss | 99.58% Ole Miss |
| Tennessee Tech at Mississippi State | 56.44% Mississippi State | 92.23% Mississippi State |
| Chattanooga at Alabama | 84.14% Alabama | 99.69% Alabama |
| Samford at Auburn | 81.10% Auburn | 99.48% Auburn |

These percentages are experimental research observations, not replacements for the website's saved picks. Four games are a starting sample, not enough to validate promotion. No future result was filled in.

Optional capture and grading steps are added to the existing results workflow after a successful weekly-pick publication. They use already downloaded data, add no provider request or schedule, and cannot block the public publication if research fails. Only separate research observations and grading artifacts are staged. This operational addition follows the initial manual capture; the original coefficient freeze remains unchanged.

The grader selects the first valid immutable capture per game independently of the result. It checks the frozen model, input hashes, actual capture time, identity, subdivision, venue, confirmed corrected kickoff and seven-day horizon. Later forecasts cannot replace an inconvenient first forecast. Canceled, postponed, tied, unresolved and changed-identity cases are handled explicitly. No graded games means evidence is pending, not success. Future parameter or implementation changes require a new freeze; there is no automatic production promotion.

## Sources, artifacts and verification

- [Cross-division findings](cross-division-calibration-2026-11-18.md): exact original 2004–2025 source hashes, recursive priors, 602 reproduced target forecasts, selection, per-season/venue results, upset cases, reliability bins and uncertainty.
- [FCS SOR findings](fcs-sor-calibration-2026-11-18.md): original → FBS-repaired → FCS-supplement source chain, all 12 seasons' independently reconstructed features, separate contexts and current publication parity. Maximum feature difference was `1.1102230246251565e-15`.
- [Frozen protocol](../research/division-calibration-protocol-v1.json), [buffer clarification](../research/division-calibration-protocol-v1-clarification.json), and [dated post-selection diagnostic amendment](../research/division-calibration-protocol-v1-diagnostic-amendment.json).
- [Independent review](../research/results/division-calibration-v1/review.md), detailed checked artifacts in `research/results/division-calibration-v1/`, and immutable future observations in `research/cross-division-calibration-observations/`.

No production engine source, calibration policy, historical input, saved prior, published snapshot, existing observation or user record was changed. The only existing operational file changed is `.github/workflows/weekly.yml`, to run and preserve the separate nonblocking research trial. No frontend, database, service, provider budget or refresh time changed. Zero CFBD calls and no new paid service or dependency were required.

No browser or mobile checks are claimed: this release changes no public interface. Numerical/source verification, automated tests, CLI capture/grading checks and independent review cover the changed research behavior. The first actual scheduled execution of the new steps remains future operational evidence.

Final verification: `npm test` passed **396/396 tests**, with zero failures or skips. The real capture CLI reused the existing immutable observation without changing its original capture time. The real grading CLI reported **four pending, zero graded, zero excluded**, with unavailable accuracy and probability-loss values. All 383 protected core/policy/publication/observation files checked by the cross-division manifest remained byte-identical. The broader FCS manifest has one intentional later operational change, `.github/workflows/weekly.yml`; the numerical research itself changed none of those protected files. See [test log](../research/results/division-calibration-v1/all-node-tests.log).
