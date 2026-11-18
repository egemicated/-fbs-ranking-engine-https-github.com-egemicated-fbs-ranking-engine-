# FBS Intelligence accuracy and stabilization release

Prepared November 18, 2026. This implements the correctness/security work under
the feature freeze. It does not certify that every historical game or real
account workflow has been independently verified. Unresolved evidence is
listed explicitly below.

## 1. Historical data

The [baseline](accuracy-stability-baseline-2026-11-18.md) records production
revision `ccd98b3`, model settings, source cutoff, saved-data counts and recovery
points before changes. Previously fixed self-matchups, FCS directory, account
preferences, ranking explanations and other working features were preserved.

### AP and CFP comparison history

| Season | AP editions before / after | CFP editions before / after | AP-covered games | CFP-covered games | Games before first CFP release |
| --- | --- | --- | --- | --- | --- |
| 2025 | 0 / 17 | 0 / 6 | 371 / 371 | 68 | 303 |
| 2026 at retained November 18 cutoff | 3 / 12 | 3 / 3 | 302 / 302 | 6 | 296 |

The game denominators include separate FBS/FCS results. FBS interconference
counts remain 245 for 2025 and 179 for 2026. Within those FBS-only games, AP
covers all 245/179; CFP covers 62/5, with 183/174 preceding the first release.
FCS opponents are not assigned FBS poll ranks. Confirmed unranked teams are
distinct from missing editions, uncertain times and polls that did not exist.

All 950 retained team/rank pairs reconciled to dated corroboration. AP dates
use AP or attributed syndicated AP reports, with full-row secondary tables;
CFP uses official archives and the documented December 2, 2025 media-guide
correction. This is not a claim that all AP rows were independently extracted
from AP-owned full-poll pages. Source URLs, response hashes, stable identities,
ties and the discrepancy are retained for offline reproduction.

Every one of the 747 actual game/poll associations in the deployed comparison
data has an availability bound strictly before kickoff. Where exact release
instants are unverified, the bound conservatively ends the Eastern publication
day. Final AP remains season-ending context and never enters pregame matching.
No source week number is treated as proof of a publication date.

The nine recovered AP comparison editions with unverified result cutoffs keep
`gamesThrough: null`. They display the poll and its release date without
fabricating matching SOR/Forge columns. Future CFP comparison cutoffs also
remain unknown until supported, rather than assuming the preceding Saturday.

See the complete [poll coverage and source report](historical-polls-2026-11-18.md),
[release ledger](../research/poll-release-ledger.json), and
[coverage reconciliation](../research/poll-coverage-comparison.json).

### Existing historical foundation

The [per-season historical ledger](historical-foundation-validation-2026-11-18.md)
reports every 2004–2025 season's recorded/completed games, finite independent
score checks, missing checked categories, duplicates, postseason labels and
source discrepancies. All 22 original normalizations, 22 repaired-season hashes,
12 FCS-supplement hashes and 95 cached sources were verified. The original
2025 prior reproduced within 1e-9.

The retained candidate contains 674 recovered FBS postseason games and eight
duplicate removals. Its separate FCS supplement adds 34 results and corrects
three scores. Independent exact-score fixtures cover 288 supplemented game
identities; that is not a certification of all retained games. Seventy FCS
source differences remain visible in the audit.

Exact all-schedule missing totals remain unknown. Known residuals include
15 spring-season-2020 NCAA tournament games, the 2020 SWAC title, two New
Mexico State spring results, ten named Northeastern 2009 results and an
overlapping Hofstra count gap. Nonplaying/cancelled programs were distinguished
from missing played games. Full historical membership/classification and
inactive-program coverage remain uncertified.

No pre-2004 import was launched. The era review documents source ranges and
rules/classification differences. A bounded initialization sensitivity used
the existing archive beginning in 2014 versus 2004; it does not establish the
value of importing earlier football or justify pooling nineteenth-century
results with modern FBS.

## 2. Model accuracy and integrity

The independent engine, SOR coefficients, probability scales, original
production prior and saved forecast timestamps are unchanged. Original game
results, season memberships, archived publications and conference quality
calculations are unchanged. Poll data remains comparison metadata only.

The following are same-game, forward-chronology retrospective comparisons with
fixed existing calibration. These seasons were already inspected; 2021–2022
also contributed to original parameter selection. No period here is a fresh
untouched holdout, no weights were fitted, and no model was promoted.

| Population, 2021–2025 | Games | Original accuracy | Repaired accuracy | Original Brier | Repaired Brier | Original log loss | Repaired log loss |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FBS/FBS | 3,864 | 70.937% | 70.963% | 0.185856 | 0.185682 | 0.549174 | 0.548720 |
| FBS/FCS | 602 | 88.372% | 88.538% | 0.138591 | 0.138560 | 0.454484 | 0.454394 |
| FCS/FCS | 3,283 | 70.652% | 70.804% | 0.185670 | 0.185678 | 0.548054 | 0.548064 |

The FBS/FBS Brier difference is about -0.000174, with a paired week-block
95% resampling sensitivity interval of [-0.000496, +0.000120]. Mixed seasons
and an interval spanning zero do not establish a meaningful improvement.
The earlier 2023–2025 evaluation and the distinct FCS supplement are reproduced
separately. Full season/conference, calibration-bin and uncertainty evidence is
in the historical report and its linked CSVs.

Cross-subdivision odds remain uncalibrated; the replay's approximately 0.296
calibration error illustrates why high winner accuracy does not validate those
probabilities. FCS-specific SOR calibration, Experimental Performance limits,
unknown-subdivision context and team-specific confidence-interval limitations
remain disclosed. None was hidden or converted into a validated claim.

## 3. Confirmed corrections

| Defect | Cause and correction | Verification and production effect |
| --- | --- | --- |
| Missing AP/CFP history | Comparison inputs had only recent/current editions. Added verified, timestamp-safe comparison archives and future append-only archival. | Offline reconciliation, strict before-kickoff tests and live coverage checks. Historical poll metrics improve; independent ranks and outcomes do not change. |
| Early CFP games called missing | Rank availability lacked a not-yet-released state. Added explicit availability categories and coverage labels. | Source/game enumeration and browser filters/details for both seasons. No artificial rank or zero. |
| Unknown poll result cutoff aligned by assumption | Calendar cutoffs could be inferred for future editions. Preserve unknown cutoffs and refuse SOR/Forge alignment. | Null-cutoff regression plus all nine recovered AP editions in browser checks. Existing verified editions remain intact. |
| Source correction overwrote a saved edition | CFP save logic accepted changed rows. Conflicting saved fields now stop for reconciliation. | Immutable-edition tests. No existing saved edition was overwritten. |
| Future aggregate pick disclosure | Unanimous tallies could expose private participants without sharing consent. Require confirmed kickoff and public/shared, valid pregame picks. | Regression fails against baseline and passes corrected SQL; live records preserved. |
| Postponed pick disclosure | An elapsed retained scheduled time could release a pending game's picks. Exclude pending games from both public endpoints. | Negative SQL and stale-cache UI regressions; live pending/future public counts zero. |
| Three obsolete SQL expectations | Tests still expected removed immediate sharing and older validation errors. Updated assertions to current intended rules. | Baseline 7/10 passed; corrected 11/11 pass, with all fixtures rolled back. |
| Incomplete release gate | Node tests ran implicitly; SQL was absent and Render started before browser checks. Added explicit CI stages, isolated SQL and exact-revision hosted release checks. | Hosted Node/SQL/browser success and Render wait/pass logs. Failed checks retain the prior deployment. |
| Potential partial bundle publication | Optional/failed companion generation could leave stale picks or missing current conference data. Require aligned companions and validate candidate before committing. | Coherence tests and real-CLI failed/empty-import fault injection preserve old publication bytes. |
| Mobile clipping | Card text and conference select width constraints hid content. Reuse existing components with minimal wrapping/width corrections. | Four viewport checks, inner-text measurements and browser interactions; no redesign. |

## 4. Security and saved data

The [security report](security-ci-stabilization-2026-11-18.md) documents RLS,
function grants, private schemas, owner checks, direct REST denials and
postponed/void/TBD/sharing behavior. Production's 134 picks and player row
retained exact canonical aggregate digests. There are no future or pending
choices in the public player response. Preferences and private requests retain
owner isolation. Newer live preference/seen-state activity was preserved.

Only two function bodies were replaced in production; no table records were
inserted, updated or deleted by that migration. Synthetic accounts and fixtures
were used in the disposable database. No destructive production testing or
real account mutation was performed.

The verified Git bundle and private DPAPI-encrypted eight-table backup remain
outside the public repository. A full restore drill verified all eight tables
against the encrypted source under constraints in a disposable database, then
removed that database. The backup requires the same Windows profile and omits
Auth secrets. Do not restore it over newer user activity or claim it is an
off-device disaster-recovery service.

The exact ignored historical inputs are backed up separately in the private
`historical-inputs.zip`: 177 original payload files plus an embedded manifest,
178 verified ZIP entries, 8,509,047 compressed bytes. It contains 22 raw CSVs,
22 original normalized seasons, 22 FBS-repaired seasons, 12 FCS-supplement
seasons, 95 cached source responses and four manifests. Every entry's size and
SHA256 passed readback verification, ZIP CRC passed, and all original files
remained unchanged. ZIP SHA256:
`db6611565ed62282def1b0c12ed4c3cc7762ebae248a3f679741fcae0721d339`.
This closes the gap between the committed Git bundle and the ignored exact
parent data needed to reproduce the research. It contains no user database
backup, Auth credentials or test mirror. Private recovery instructions require
extraction to a separate directory and hash verification before any restoration.

## 5. Testing

| Scope | Result |
| --- | --- |
| Complete Node suite, local and hosted | 356 passed, 0 failed, 0 skipped |
| Isolated SQL, local PostgreSQL 18 and hosted PostgreSQL 17 | 12 migrations applied; 11 suites passed, 0 failed |
| Existing Python research/model tests | 135 passed, 0 failures/errors/skips; the 32-test core subset is included |
| Hosted conditional Performance/publisher suites | 75 passed, 0 failures, 1 private-cache check skipped; that checksum check passed in the full local research run |
| Automated browser release gate, local/hosted/live | 72 responsive routes plus historical filters, metadata, JSON, duplicates, shared URLs and controlled account UI passed |
| Expanded local responsive audit | 208 route-width checks passed |
| Expanded local interaction audit | 34 groups passed |
| Local social-preview validation | 267 unique 1200×630 PNGs passed |
| Production sitemap and metadata | All 281 URLs returned 200 with matching canonicals and social metadata |
| Failed import recovery | HTTP failure and empty result fault injections left prior publication byte-identical |
| Private backup recovery | Eight-table restoration and bidirectional row equality passed |

The [website audit](website-functionality-accessibility-2026-11-18.md) distinguishes
real published-data browser checks from fixture scoreboards and controlled
account adapters. The [Python report](historical-python-validation-2026-11-18.md)
documents the verified portable runtime, pinned NumPy, scratch paths, network
block and unchanged source/input checksums.

Actual Google consent/sign-in/sign-out, real cross-device preference persistence,
expired live sessions and real live support/deletion submissions remain
unverified. SQL identity/permission tests and UI adapters do not replace them.
Accessibility checks are substantial basic checks, not full WCAG certification.

## 6. Production and recovery verification

Code revision `7d096d4dbad922973f71734915d700685f6f422f` passed Engine checks
[run 44421082930](https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/actions/runs/44421082930)
and the existing conditional Performance checks
[run 44421082965](https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/actions/runs/44421082965).
Render deployment `dep-dbv39bavcj2c73c1uieg` waited for the exact revision's
allowlisted CI checks, logged success at `2026-11-18T23:30:27Z`, then deployed at
`2026-11-18T23:30:57Z` (4:30 p.m. Mountain Standard Time). A regression ensures
Engine success cannot override failing or pending Performance checks. The
first hosted gate run on `fc21be8` also passed before this final hardening.

Live verification before and after the final gate hardening confirmed the ranking bundle exactly
equals the tested build: 138 FBS teams, 128 FCS teams, source cutoff
`2026-11-18T12:30:14.250Z`, snapshot hash
`a36df50d7f94c050e03b2d5df03cba802067d8dd2a1732f715a3ea3cc57dc4c1`.
FBS picks, FCS picks and Performance match that source hash. All 281 public
URLs passed, as did the live 72-route browser gate. The final gate-only revision
changed no frontend assets or publication data; all 281 URLs and bundle checks
were repeated after that deployment. The unchanged source cutoff
is intentional: no fresh game/stat pull was launched for this stabilization.
The [machine-readable live evidence](stabilization-live-verification-2026-11-18.json)
contains the reconciled historical counts and 747 before-kickoff associations.

The [publication report](publication-reliability-2026-11-18.md) records the
candidate/CI safeguards, existing scheduled-run evidence and rollback steps.
The next 03:45 daily execution and the new AP archive schedule have not yet
occurred under this release; they must be observed before calling those exact
scheduled executions verified. GitHub can still delay/drop scheduled events.
Database sync validation remains separate from the static CI deployment gate.

## 7. Remaining limitations and review priorities

- Full historical schedule and membership certification, inactive-program gaps,
  uncertain dates/venues and original as-published availability remain incomplete.
- Exact historical AP/CFP publication instants are unverified where only a date
  is supported; conservative bounds are used rather than invented timestamps.
- Historical repairs are not promoted. Predictive effects are small/mixed and
  no untouched retrospective holdout is available.
- Pre-2004 predictive value, FBS/FCS calibration, FCS-specific SOR calibration
  and team-level confidence intervals remain unproven.
- Real disposable-account OAuth/session/cross-device flows still need testing.
- Formal privacy/terms review and account-deletion processing remain owner tasks.
  The existing leaked-password-protection advisory is unchanged; Google sign-in
  is enabled. No blanket security or legal-compliance claim is made.
- Unauthenticated GitHub verification can fail closed on rate limits; see the
  documented retry procedure. Future timed jobs/upstream releases are not
  guaranteed by successful script and historical-run checks.
- The hosted Performance job does not possess the private normalized research
  cache and skips its cache-checksum test. That test was executed successfully
  in the 135-test local run; it is not reported as a hosted pass. Conditional
  workflow registration remains subject to GitHub event handling; the gate
  enforces the latest registered Engine/Performance runs for the exact revision.

These are explicit remaining work, not completed validation. The release is
ready for an independent review of the implemented corrections with those
boundaries.

## 8. Cost, usage and technical changes

Exactly two CFBD calls recovered the two poll seasons. The last header reported
934 calls remaining at 3:42 p.m. MST on November 18; this is the observed quota,
not a guarantee that no other authorized job has used calls since. No other
CFBD request was made by this project. Research/model tests used cached data.

No paid service, API plan, hosted database branch, new Render service or new
production dependency was introduced. Portable Python/NumPy was local test-only.
Existing public GitHub runners, Render build/CDN and Supabase resources were
reused. Extra CI/guard time consumes existing build resources; account invoices
and unlimited included allowances were not independently audited.

Result-pull timing remains 03:45 daily plus the existing Sunday backup. Future
poll archival uses zero extra CFBD calls: one public AP distributor request
daily during August–January, and the CFP publisher reuses its official response.

Main changes are the poll-history/comparison modules and archivers, Conference
Strength availability rendering, two privacy RPC implementations, updated SQL
regressions, isolated SQL CI runner, exact-revision release guard, coherent-bundle
validator, rollback tests, expanded browser gate, and the two narrow CSS fixes.
They are separated into reviewable commits. Public historical pages, new ranking
methods, a redesign and unapproved model promotions were not added.
