# Operation Clean Slate

## A. Production QA

The baseline was live revision `1963802465d955ed0481a0a629a1be8fb61e19c8`, backed by Engine checks run `44877999073`. The release candidate was built against the same committed data.

| Area | Result | Evidence |
| --- | --- | --- |
| Matchup Lab | Fixed | Both sports update teams and venue in place. Football now reshapes the team controls before restoring focus and scroll. At 390 and 1440 px, tests verified keyboard focus, exact scroll where the document permits, Back/Forward, and direct shared URLs. |
| Basketball rankings | Fixed | Compared displayed ranks and scores for the top 25 under each of SOR, Predictive Strength, and Performance Experimental against the versioned publication. The model version and cutoff are visible. The warning is injected when a request fails. A simulated HTTP 503 preserved the last valid rows and URL. Retry succeeded. Empty results have their own state. |
| All Sports homepage | Fixed | One main landmark and one primary heading in the raw document. Both sport links work with JavaScript disabled. Root and `/sports/` serve the same document, with root as the canonical URL. The sitemap, social preview, and structured metadata describe both sports. |
| March Madness | Fixed | Public 76-team practice opens the SOR projection when available, with a historical field fallback. The narrow Round select fits its full label. Chromium verified mouse-wheel zoom around the pointer, drag, fit/reset, fullscreen, keyboard, region and Final Four jumps, advancement, downstream pick invalidation, and reopening a saved practice bracket. Both the historical 68-team field and the 76-team projection were exercised. |
| Responsive layout | Pass | 105 page/width checks and 14 menu, search and sport-switch flows on both the production baseline and local build, across 320, 360, 390, 768, 1024, 1440 and 1920 px. Checked both scoreboards, long mascot names, basketball conference cells, Matchup Lab and footer layout. Device sizes and touch were emulated in Chromium. |
| Authentication | Pass in isolated tests | Existing browser tests covered 13 callback cases, including old root verification/recovery links, Google return paths, expired links and missing verifier. An account-shell HTTP 503 leaves the URL intact with a retry control. Ordinary homepage visits never request the account app. Anonymous production account and admin gates worked. |
| Basketball scheduling | First unattended run pending at baseline | The schedule and enablement flag are present. Hosted seed and manual refresh succeeded. An actual scheduled run is needed to verify unattended operation end to end. |

## B. Legacy presentation and compatibility

The public build emits the shared GD masthead and footer for both sports. It no longer creates a duplicate football root on a multi-sport build or embeds the prerendered football page in a template on the homepage. Old authentication callbacks load the existing same-origin account shell on demand and pass the original URL and browser session state to managed Auth. Canonical football URLs and the old root bookmark bridge remain. A football-only offline build and the private basketball preview remain supported development tools.

## C. Repository inventory and removals

The baseline inventory covered 3,290 tracked paths. Of those, 2,595 were committed publication JSON, 259 were research, 85 were in `frontend/`, 82 were test units, 72 were reports, 57 were scripts, 42 were in `basketball/`, 35 were in `supabase/`, 33 were in `src/`, and 14 were workflows. The remaining 16 paths include configuration, model inputs, previous audit records and test support.

| Classification | Paths and consumers | Disposition |
| --- | --- | --- |
| Active | `frontend/` runtime and assets, `basketball/` public views and model engine, `src/` football engine and development API, `scripts/prepare-static.js`, `scripts/prepare-basketball-static.mjs`, `published/`, `test/` and managed database migrations | Retained. Followed imports, browser scripts, asset URLs, build output, workflows and versioned publication references. |
| Shared | GD masthead, footer, sport routing, typography, layout, team search and comparison controls | Shared base rules live in `frontend/base.css`. Public portal initializes only the styles it uses. Football and basketball retain their sport-specific model and presentation code. |
| Legacy compatibility | Root hash bookmarks, old account URLs, canonical aliases, managed Auth and date-stamped public archives | Retained. Removed the embedded football document only. |
| Research and history | `research/`, dated reports, model settings and published archival results, saved pregame figures, validation evidence | Retained. Models and source archives are separate from production web assets. |
| Redundant or obsolete | Two earlier FBS brand images, two uncompressed TTFs, inactive stadium PNG, original Render Node builder and npm alias | Removed. The five binaries had no browser references and were already excluded from the static deployment. The original stadium source and all old revisions remain in Git. Render service configuration confirms the Node builder is superseded. |
| Unreferenced for public use | Practice accounts, local basketball preview routes, unpublished bracket payloads and development screenshots | Kept the supported isolated preview path. Private assets were confirmed absent from the public build. Test screenshots are local and ignored. |
| Unknown or external | Old Markdown links and experimental research entry points that might have external callers | Retained where an absence of consumers was unproven. |

The removed binaries total 2,913,048 bytes. There is no frontend dependency addition. Basketball loads the public bracket client on the March Madness route, so rankings skip its rendering, graph, and historical bracket script downloads.

## D. Workflows and freshness

Fourteen workflow definitions remain. Reviewed results, player statistics, official availability, poll archives/recovery, CFP field/bracket, basketball publication, support delivery, Engine checks and performance/research workflows. Three older advanced-stat workflows are expressly tied to their research ref and request paths. No production workflow was proven redundant. No refresh guards, retry windows, automated schedules, or provider budgets were changed.

At baseline, football’s latest scores and picks were published Nov. 20 at 7:13 a.m. Mountain. Basketball’s first edition `359fe2963dc0454681607ce4` had a Nov. 20, 11:32:04 p.m. Mountain source cutoff. The hosted basketball seed used zero metered requests. The manual refresh used five metered attempts, reconciled two results, and retained two delayed finals for correction. The live indexes and versioned basketball season data matched the committed manifest. The schedule checks primary at 4:15 a.m., recovery at 6:15 a.m. and cache-only pregame publication at 10:15 a.m. Mountain in season, with optional later postseason runs. Football schedules 2:45 a.m. Eastern and a 4:45 a.m. Eastern backup, equivalent to 12:45 and 2:45 a.m. Mountain on Nov. 21.

The existing quota plan estimates 160–280 total calls in a typical month when both regular seasons overlap. The shared free tier has 1,000 per monthly reset. Basketball verifies the linked account and quota, reserves 600 football calls plus 150 contingency calls, and caps its own tracked attempts at 250 per reset and 12 per scheduled run. Public logs intentionally omit the exact live balance. This audit made zero additional metered requests. See [basketball operations](basketball-managed-refresh.md).

## E. Build and browser measurements

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Generated HTML pages | 683 | 683 |
| Total static output | 108,686,775 bytes | 108,710,567 bytes |
| Generated CSS, JS, font and image assets | 365 | 366 |
| Raw root HTML | 23,992 bytes | 7,038 bytes |
| Root CSS transfer, compressed | 22,580 bytes | 10,946 bytes |
| Root JS transfer, compressed | 14,152 bytes | 14,436 bytes |
| Root browser requests | 21 | 19 |
| Basketball rankings JS transfer, compressed | 49,647 bytes | 34,032 bytes |
| Basketball rankings browser requests | 30 | 28 |

The extra asset is the reusable base stylesheet. Published output grew by about 24 KB while the normal homepage transferred about half as much CSS. Root image transfer remained unchanged at 237,477 bytes on the 390 px viewport. Cold-cache Chromium measurements used five paired observations per width on a local Brotli server. Median root largest contentful paint was 84 to 80 ms at 390 px and 100 to 88 ms at 1440 px. Treat these times as local observations. The build-only invocations were approximately 10 to 12 seconds, with overlapping checks varying system load.

## F. Data integrity

Before and after builds had identical SHA-256 hashes for all 609 football data files and 2,250 basketball data files. Football and basketball model code, settings, original publications, pregame forecasts, and archive inputs are outside the edit set. There was no production database operation or storage change. All 134 original contest picks were verified in the preceding launch audit and this release does not touch the contest. No provider dataset or private artifact was introduced to the public build.

## G. Verification and release

The candidate passed 540 Node tests and the local static build. Browser suites exercise public and private routes, 13 synthetic callback cases, conference filtering and sorting, the published scoreboard, followed teams, basketball publication, and protected asset exclusions. Independent bracket and responsive browser results are recorded above. The production promotion uses the existing exact-commit Engine and Render checks. Live baseline verification found 200 responses on public routes, five-minute HSTS on both HTTPS hostnames, apex-to-www path preservation, and intact CSP, anti-framing, MIME, referrer and permissions headers. The previous checked dual-sport deployment remains available as a rollback target. A code rollback can revert this patch on current main while retaining any newer data publication.

## H. Verification limits

No actual password reset, email delivery, Google sign-in or admin MFA session was performed against real production users during this audit. Provider Auth and database isolation are covered by the existing hosted checks. The production Supabase advisor reported zero errors and a warning for leaked-password protection, which requires a paid tier. Browser touch was emulated. On the 1024 px bracket workspace, touch zoom buttons work and there is no two-finger canvas zoom. Hosted scheduled work can be delayed by GitHub. The first unattended basketball run and exact current quota require their own production evidence. Existing source-rights questions are recorded in the launch report. [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
