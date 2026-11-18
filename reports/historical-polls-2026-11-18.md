# AP and CFP historical ranking reconciliation — November 18, 2026

The comparison archives now contain all 17 independently dated 2025 AP editions (including the August 11 preseason and January 20, 2026 final), six 2025 CFP editions beginning November 4, 12 available 2026 AP editions beginning August 17, and the three official 2026 CFP editions released November 3, 10, and 17. The delayed November 16 AP release is recorded explicitly.

## Verified baseline and coverage change

Baseline was measured before implementation against production revision `ccd98b38bb97bf68d884d2063a2b4c3a7c1cea0d`. The original 2025 result publication and independent ranking artifacts remain unchanged. These counts describe unique Conference Strength result games, not all games played during either season.

| Season | Result games | FBS interconference | FBS/FCS | AP editions before → after | CFP editions before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2025 | 371 | 245 | 126 | 0 → 17 | 0 → 6 |
| 2026 through saved November 18 publication | 302 | 179 | 123 | 3 → 12 | 3 → 3 |

| Season/poll | Pregame edition available before → after | Before first poll existed after repair | Genuinely missing after repair | Publication time uncertain after repair |
| --- | ---: | ---: | ---: | ---: |
| 2025 AP | 0 → 371 | 0 | 0 | 0 |
| 2025 CFP | 0 → 68 | 303 | 0 | 0 |
| 2026 AP | 6 → 302 | 0 | 0 | 0 |
| 2026 CFP | 6 → 6 | 296 | 0 | 0 |

An available edition can confirm an FBS team is unranked. It does not mean either opponent was ranked. For FBS/FCS games the FCS team remains not applicable to the FBS AP/CFP field. The table counts edition availability for the game; frontend opponent coverage uses the selected opponent and deduplicates both conference perspectives.

For **FBS interconference games alone**, 2025 has 245 AP-covered games and 62 CFP-covered games, with 183 games before the first CFP release. The 2026 equivalent is 179 AP-covered games and five CFP-covered games, with 174 games before the first CFP release. The remaining CFP-covered 2025/2026 games in the preceding table involve FCS opponents.

## Source evidence and reproducibility

Two explicitly bounded CFBD `/rankings?year=...&seasonType=both` requests recovered the 2025 and 2026 seasons. GitHub Actions run `44414021171`, artifact `14479166332`, retained normalized AP/CFP facts and response SHA-256 values without credentials or raw provider responses. The run completed with 934 provider requests remaining. There were no additional CFBD recovery calls.

All **950 team/rank pairs** matched corroboration: 425 AP and 150 CFP pairs for 2025; 300 AP and 75 CFP pairs for 2026. AP publication dates were checked against AP reports and explicitly attributed syndicated AP reports. The season tables provide secondary full-row corroboration; they are not represented as AP-owned sources. CFP corroboration comes from the official historical table and current structured archive.

The [release ledger](../research/poll-release-ledger.json) records a source URL for each edition. It also records a genuine source discrepancy: the official 2025 week-by-week table labels both North Texas and James Madison No. 24 on December 2. The [official December 2 media guide, page 27](https://collegefootballplayoff.com/documents/download/2025/12/2/CFP_HISTORICAL_MEDIA_GUIDE_2025-1202.pdf) identifies North Texas No. 24 and James Madison No. 25. The compiler applies only this documented correction to its corroboration facts; it does not alter the downloaded source or saved game publication.

Committed evidence:

- `published/poll-history/2025.json` and `2026.json`: stable team IDs, explicit ranks and ties, release dates, edition kinds, source provenance and checksums.
- `research/poll-provider/`: allowlisted provider facts and original recovery manifest.
- `research/poll-crosschecks.json`: frozen derived corroboration facts and source-response checksums, permitting offline replay.
- `research/poll-verification.json`: reconciliation totals.
- `research/poll-coverage-comparison.json`: before/after counts, interconference ranked wins and unchanged input checksums.

Reproduce the reconciliation without a network call:

```text
node scripts/compile-poll-history.js research/poll-provider
```

The compiler matches complete team/rank vectors to the independently dated editions; it does not infer publication dates from CFBD week numbers. Explicit CFBD IDs must agree with the selected season's saved team membership and name. AP competition ties are preserved, including the November 16, 2025 tie at No. 6 and the 2026 preseason tie at No. 14.

## Pregame eligibility and unchanged calculations

Verified exact release instants can be used only strictly before confirmed kickoff. Historical sources here establish dates, not trustworthy exact release times. The conservative availability bound is the end of that **Eastern calendar day**, including daylight-saving transitions. An unknown same-day release time therefore produces an explicit uncertain state rather than an invented timestamp. Placeholder kickoffs remain conservative. The actual stored kickoff governs postponed/rescheduled eligibility; provider week numbers do not.

The final AP edition remains season-ending current context. It is excluded from pregame use, including a hypothetical incorrectly labelled postponed game after that final edition. Every actual 2025 game's AP pregame field precedes kickoff; the January 19 championship uses the December 7 poll rather than the January 20 final. CFP's December 7 selection-final is a committee edition published before playoff games and remains eligible for those games.

Ranked/unranked, no poll yet, missing, publication time uncertain, and not applicable are separate states. An edition known to be missing from the release ledger blocks stale fallback. Early-season CFP games are no longer described as missing historical data.

The results, scores, season-specific conference memberships, independent SOR/Predictive Strength values and historical prior were preserved. Conference quality scores were compared for every conference and were identical before and after enrichment. Human polls remain comparison metadata and never enter the independent ranking engine.

The corrected **FBS interconference pregame** totals are:

| Season/poll | Top 10 wins | Top 25 wins |
| --- | ---: | ---: |
| 2025 AP | 10 | 28 |
| 2025 CFP, after the committee began publishing | 6 | 15 |
| 2026 AP through the saved publication | 4 | 7 |
| 2026 CFP, after the committee began publishing | 1 | 1 |

## Future archival and existing comparison page

`archive-ap-history.js` retrieves the publicly distributed AP field from ESPN once per scheduled attempt. It stores the actual observation time, never ESPN's nominal midnight metadata as an exact AP release time. A newly observed edition becomes pregame-eligible only after that observation. The source response checksum, stable IDs and field completeness are validated. Repeated identical observations preserve the earliest saved evidence; changed saved fields fail for reconciliation.

The existing Compare Rankings AP archive now contains all 12 recovered 2026 editions. Its three previously saved edition objects are preserved. The nine recovered editions have `gamesThrough: null` where the exact cutoff was not independently established. Such editions cannot be aligned to a purported same-cutoff SOR/Forge snapshot. The future AP script appends the same verified field to both comparison consumers. This is an explicit remaining metadata limitation, not a guessed Saturday cutoff.

The CFP publisher reuses its existing single official-page response to archive the actual releases. Its promotional banner is ignored, since it can advertise a later show. Conflicting saved CFP rows now fail rather than overwrite a historical edition. The upcoming November 24, December 1 and December 6 comparison cutoffs remain null, avoiding a guessed Saturday cutoff when a game could be postponed to Sunday. Future archival uses zero CFBD requests; the separate AP schedule makes one free public ESPN request daily at 15:47 Mountain during August–January (seven requests weekly), catching delayed editions and the Tuesday final poll after a Monday championship. It publishes only when a new edition appears. Workflow scheduling and production verification are covered by the root release report.

## Validation and limits

The existing 14 focused baseline tests passed before editing. Subsequent targeted tests cover exact kickoff boundaries, source-date/DST bounds, missing releases, uncertain times, preseason, AP ties, stable-ID errors, final AP exclusion, preserved source/model values, CFP archive parsing, immutable editions, null future cutoffs, redacted provider failures and both publication consumers. One combined targeted run passed 40 tests, including the existing rankings hub tests. A complete-suite checkpoint passed 350 tests with zero failures/skips before the last cutoff/UI regressions were added; the release owner will report the final complete-suite result.

Live public AP-distributor and CFP-source checks succeeded: both archivers recognized the existing edition and preserved it. This does not certify that future upstream releases or GitHub schedules can never fail. Exact historical AP/CFP release instants remain unverified; no currently eligible comparison game is left ambiguous under the conservative bounds. The older 2025 result publication remains intact for rollback; deleting/reverting only the added comparison history restores the prior conference view without touching user data or model inputs.
