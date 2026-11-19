# Ranking history and pregame evidence audit

This is a comparison-data and provenance repair. It changes no production ranking formula, probability coefficient, historical prior, saved forecast, contest pick or game result. No CFBD or other provider request was made. Counts below refer to the retained November 18 source cutoff, `2026-11-18T12:30:09.923Z`; they are not a claim that no later games have finished.

## Findings and corrections

| Finding | Actual cause | Correction | Verification / status |
|---|---|---|---|
| SOR pregame coverage was 2 of 179 FBS interconference games, with 177 described as missing | All 177 games precede the first retained saved SOR capture. The latest uncovered kickoff was November 7 Mountain Time. The first retained SOR file was recorded November 8. This is not an ID or week-number mismatch. | Keep 2 covered games; identify the other 177 as **before the saved archive**, separately from a missing edition inside its coverage period. Replays never fill the gap. | Derived game-by-game counts reconcile to 179; staged source/Node checks passed. |
| Updating a weekly history edition could discard earlier captures from that week | Weekly display retains the latest edition for each competition week; the same structure also supplied pregame evidence. | Preserve a separate compact immutable observation ledger containing team IDs/ranks, publication identity, source provenance and conservative availability bounds. Weekly selection remains the latest per week. | Three weekly saved editions and the existing replay remain unchanged; the publication test retains earlier partial-week observations after the week completes. |
| Ten valid old Git captures were not all available to the conference evidence selector | Eight distinct SOR publications existed in committed `published/latest.json`/matching Weekly Picks files. Two later Git captures repeated already-saved publications. | Restore the eight unique saved rank vectors, retaining the earliest source for a repeated publication hash. Each has 138 unique FBS IDs. No rank was recomputed from today's model or results. | Source commits, exact snapshot/schedule file SHA-256 values and recording times are retained in the ledger and recovery report. |
| Historical game research spanning 2004–2025 could be mistaken for weekly ranking history | The datasets have different purposes. Older games train/test models; they do not establish that weekly rankings were published then. | Add a compact archive explanation: three saved weekly editions, one replay, eight retained observations, with links to existing prior-season conference evidence. | Replay labels, unknown replay scores, partial-week labels and model-compatible movement comparisons remain intact. |
| AP/CFP backfill was described as a remaining broad gap | The earlier poll repair already resolved available 2025/2026 AP/CFP editions. CFP did not exist early in either season. | Preserve those repairs and their explicit pre-release states. Do not repeat provider calls or substitute a later poll. | AP covers all 245/179 eligible interconference games in 2025/2026; CFP covers 62/5, with the other 183/174 preceding the committee's first release. |

The earliest raw November 6 retained graph is explicitly Colley rather than a saved SOR rank vector. SOR was introduced on the site November 6, but this audit did not recover an exact retained served SOR artifact from that deployment. Re-running today's publication code against that old graph would be a reconstruction, so it was not inserted as genuine saved pregame evidence.

## Time and source integrity

Recovered observations are labeled **repository-recorded snapshots**, not exact historical Render deployment instants. Availability is conservatively bounded after the complete Mountain calendar day of the Git recording time. The graph's older `asOf` cannot backdate that bound. A confirmed kickoff must be strictly later than it; unconfirmed kickoff dates stay conservative. Repeated pulls retain the original observation rather than rewriting its date. Invalid hashes, duplicate publication identities, changed rank vectors and mismatched FBS membership fail validation.

The two covered November 14 FBS interconference games now use the retained November 13 snapshot rather than the latest-per-week November 8 entry. Their historical rank values may therefore change legitimately; current team ranks, conference quality formula and game results do not. The available-before boundary for each chosen snapshot precedes kickoff. The UI provides a link to the saved source within expanded game evidence.

Future `saveSorHistory` calls retain compact pipeline-recorded observations separately from the display edition. Those are saved-file observations, not claims that the static site deployed at the same instant. This preserves within-week evidence without changing the weekly display or introducing another scheduled job.

## Reproducible interconference coverage

| Season / reference | Eligible FBS interconference games | Pregame covered | Before retained archive | Before first CFP release | Other missing |
|---|---:|---:|---:|---:|---:|
| 2026 SOR | 179 | 2 | 177 | 0 | 0 |
| 2026 AP | 179 | 179 | 0 | 0 | 0 |
| 2026 CFP | 179 | 5 | 0 | 174 | 0 |
| 2025 AP | 245 | 245 | 0 | 0 | 0 |
| 2025 CFP | 245 | 62 | 0 | 183 | 0 |

2026 Predictive Strength and Performance do not currently provide archived pregame ranks to this comparison consumer: coverage remains 0 of 179, and their pregame filters stay unavailable. The 2025 archived Predictive Strength field is explicitly season-end context; no 2025 saved SOR or Performance series was recovered. Current or season-end values are never silently substituted for pregame values. FBS/FCS results remain separate: 123 such games in the 2026 retained conference dataset and 126 in 2025.

The machine report retains all per-reference counts, the covered game IDs/source bounds, per-season historical data ledger, reciprocal matrix checks and protected input checksums. No selected-season result, conference membership, current SOR/Predictive rating or scoring parameter was overwritten. The 2025 archive still assigns Boise State to the Mountain West and Texas State to the Sun Belt; the regression separately verifies their stored 2026 Pac-12 realignment. Use the actual stored source memberships rather than substituting today's conference names.

## Historical game coverage, 2004–2025

Every season remains **partially covered**, not certified complete. Exact all-season missing totals are unknown. These are game counts in the retained original and research-repaired datasets, not counts of FBS-only games or independently confirmed complete schedules. Research repairs remain unpromoted.

| Season | Original completed | FBS-repaired completed | With research FCS supplement | Known remaining primary FCS fixture gaps |
|---|---:|---:|---:|---:|
| 2004 | 693 | 714 | 714 | Not certified |
| 2005 | 690 | 718 | 718 | Not certified |
| 2006 | 760 | 792 | 792 | Not certified |
| 2007 | 766 | 798 | 798 | Not certified |
| 2008 | 770 | 804 | 804 | Not certified |
| 2009 | 774 | 808 | 808 | Not certified |
| 2010 | 773 | 808 | 808 | Not certified |
| 2011 | 777 | 812 | 812 | Not certified |
| 2012 | 805 | 840 | 840 | Not certified |
| 2013 | 813 | 848 | 848 | Not certified |
| 2014 | 1,542 | 1,581 | 1,585 | 0 checked-category gaps |
| 2015 | 1,491 | 1,532 | 1,536 | 0 checked-category gaps |
| 2016 | 1,502 | 1,543 | 1,547 | 0 checked-category gaps |
| 2017 | 1,505 | 1,545 | 1,549 | 0 checked-category gaps |
| 2018 | 1,511 | 1,550 | 1,554 | 0 checked-category gaps |
| 2019 | 1,577 | 1,617 | 1,621 | 0 checked-category gaps |
| 2020 | 563 | 589 | 589 | 16 |
| 2021 | 2,408 | 2,446 | 2,452 | 0 checked-category gaps |
| 2022 | 3,657 | 3,699 | 3,703 | 0 checked-category gaps |
| 2023 | 3,724 | 3,724 | 3,724 | 0 checked-category gaps |
| 2024 | 3,799 | 3,799 | 3,799 | 0 checked-category gaps |
| 2025 | 3,829 | 3,828 | 3,828 | 0 checked-category gaps |

Zero in a finite checked category is not a completeness certificate. The original 2004–2013 inputs have no FCS–FCS games. Remaining measured problems include the spring-2020 NCAA/SWAC fixtures, two New Mexico State spring games and incomplete inactive-program schedules. The older repair recovers 674 FBS postseason games and removes eight duplicate occurrences; the FCS supplement adds 34 games and three winner-preserving score corrections. Those remain research-only. Year-specific membership, subdivision, neutral-site/date and inactive-program universes have not been independently certified in full. The original season-ending/publication/replay distinctions and unknown subdivision handling remain in force.

See the prior [historical foundation report](historical-foundation-validation-2026-11-18.md), [per-season source ledger](../research/results/historical-foundation-v1/season-coverage.csv), [poll source reconciliation](historical-polls-2026-11-18.md), and [division calibration report](division-calibration-research-2026-11-18.md). Frozen challenger coefficients, prospective forecasts and the unchanged production SOR remain separate; this audit makes no accuracy-improvement claim.

## Verification and limits

The focused suite passed **37 tests**, covering source alignment, immutable same-week observations, hash conflicts, replay exclusion, strict pre-kickoff availability, unconfirmed kickoffs, Mountain DST boundaries, stable IDs, realignment, poll chronology, reciprocal conference matrices and frontend explanations. A second recovery run without `--write` reports eight observations and `modified: false`. Integrated browser and production checks belong to the coordinating release; no live verification is claimed by this subtask.

Reproduce locally without a provider call:

```text
node scripts/recover-sor-publications.js
node scripts/audit-ranking-history-coverage.js
node --test test/sor-history-publications.test.js test/ranking-history.test.js test/frontend-ranking-history.test.js test/conference-publication.test.js test/conference-metrics.test.js test/conference-strength-ui.test.js test/poll-history.test.js
```

Recovery writes require the explicit `--write` flag and local retained Git objects. The committed proof files retain the source commits/checksums if a shallow clone lacks those old objects. No new historical ranking series was fabricated merely to fill the interface.

Evidence: [recovery metadata](sor-publication-recovery-2026-11-19.json), [coverage and integrity audit](ranking-history-coverage-2026-11-19.json).
