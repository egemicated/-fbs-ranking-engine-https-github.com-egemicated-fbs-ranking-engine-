# Website functionality and accessibility verification — November 18, 2026

Forge performed this independent browser audit against the local `static-dist` publication after the poll-history, privacy, and responsive CSS corrections. It supplements the Node, database, and release checks documented elsewhere. It is not a production deployment verification.

## Results

| Verification | Passed | Failed |
| --- | ---: | ---: |
| 52 existing route variants at 320, 390, 768, and 1440 pixels | 208 | 0 |
| Functional, keyboard, and controlled-account test groups | 34 | 0 |
| Sitemap URLs: HTTP 200, title, matching canonical, social-image declaration | 281 | 0 |
| Generated pages: English language, description, matching Open Graph URL, app route, substantive initial HTML | 281 | 0 |
| Unique declared social images: valid PNG, 1200 × 630 | 267 | 0 |

The final responsive scan found no document horizontal overflow, detected text clipping, unlabeled form controls, empty text/accessible-name controls, `undefined`/`NaN`/invalid-date output, or uncaught browser runtime errors. Horizontally scrollable data tables remain intentional. These automated checks do not constitute exhaustive assistive-technology certification.

The sitemap still contains 281 pages, including 266 team pages. The browser exercised representative FBS and FCS profiles; all generated team-page URLs and metadata were checked. Initial HTML includes substantive descriptions and navigation before JavaScript runs, and `robots.txt` permits crawling and names the sitemap.

## Functional coverage

- FBS and FCS SOR, Predictive Strength, and Experimental Performance views: active method, team search, empty search results, conference filtering, and all-team counts (138 FBS; 128 FCS).
- FBS/FCS directories: search, empty states, reset, and card counts. Representative profiles: Overview, Results, Players, Availability, and Model details; roster search and position filtering; reported and unavailable availability states.
- Matchup Lab: neutral/home/away margin calculations against published team strengths and home advantage; venue persistence after reload; opponent options disable the selected team; shared same-team and invalid-team URLs show an explanation without a forecast.
- Conference Records, Quality Rankings, and Compare Conferences: 2025/2026 routes, available ranking references, pregame-filter availability, expanded matchup details, conference reversal, and win/loss-filter reconciliation.
- FBS/FCS Weekly Picks: week selection, My Teams guest filter and explanation, restoring all games. Model Report Card: division separation, week selection, valid displayed values, and the separate historical-replay disclosure.
- CFP scenarios: selecting winners, filling favorites, clearing/resetting outcomes, rejecting a duplicate-team hypothetical, adding/removing a valid hypothetical, and completing recalculation.
- Historical bracket demo: filling all 11 picks, changing an earlier winner and removing invalid downstream advancement, and keyboard round selection. Current bracket and leaderboard route shells were also included in responsive checks.
- Controlled six-game scoreboard feed: live games first, live/final/upcoming filters, close-final filtering, conference/day/Top 25 filters, collapsing finals, refreshing, keyboard reorder, and resetting order. This is fixture-based browser verification, not verification of ESPN's live feed.
- At all four widths: skip link retains the current route and focuses main content; More opens by keyboard and closes with Escape; ranking-method focus survives rendering; reduced-motion preference disables running animations and smooth scrolling.
- About, methodology, privacy, terms, support, and account routes, plus ranking comparisons, ranking movement/history, My Teams, and existing bracket/scenario navigation were covered by responsive route checks.

## Historical ranking UI reconciliation

The rebuilt UI exposes 17 AP and six CFP editions for 2025, and 12 AP and three CFP editions for 2026. For SEC versus Big Ten, browser result counts matched an independent enumeration of the published game and opponent-rank fields:

| Season/reference | All games | Snapshot Top 25 opponents | Pregame Top 25 opponents | Pregame after reversal |
| --- | ---: | ---: | ---: | ---: |
| 2025 AP | 7 | 5 | 4 | 6 |
| 2025 CFP | 7 | 5 | 3 | 3 |
| 2026 AP | 3 | 1 | 1 | 2 |
| 2026 CFP | 3 | 1 | 0 | 0 |

The historical snapshot option is labeled season-end where applicable. Pregame filtering is disabled for methods without pregame evidence, including historical Predictive Strength. Early 2025 and 2026 games with `no-poll-yet` display “Not yet released” and explain that no CFP poll existed before the game; they are not presented as missing historical CFP evidence.

All nine AP comparison editions whose exact game cutoff is unverified, including preseason `#polls/ap/-1`, display the unverified-cutoff explanation and leave SOR and Forge comparison columns as dashes. AP ranks remain visible. The `#polls/ap/0` fallback also renders without invalid dates or values.

## Confirmed usability corrections

1. **Long directory names clipped at 320 pixels.** Six FBS/FCS cards exceeded their inner width even though the document itself did not overflow. Examples included Northwestern (148 pixels of content inside a 139-pixel card) and Massachusetts (157/139). Root applied `.team-card > div { min-width: 0; }` and `overflow-wrap: anywhere` for card headings in `frontend/styles.css`. The final four-width scan detected zero clipping candidates.
2. **The directory conference selection was unreadable on mobile.** At 320 and 390 pixels, the control was 69 pixels wide; “All conferences” requires approximately 116 pixels including padding. The existing `max-width: none` mobile override was extended from rankings toolbars to all toolbars. The actual rebuilt directory control is now 150 pixels wide at both widths, with readable text and no document overflow. Ranking filters also passed the final responsive scan.

The settled guest My Team panel measured 98.14 pixels high at 390 pixels with a heading, sign-in explanation, and My Teams link. No additional size change was justified. Branding and the existing layout were preserved.

## Controlled account checks and limits

Disposable in-memory adapters verified header session restoration, local sign-out invocation, Google-provider invocation and return URL, and reacting to auth events. They also verified support and account-deletion request forms, changing back to a signed-out state, saving two FBS and two FCS teams, and switching between two adapter accounts without displaying or overwriting the other account's choices. These are three explicitly controlled account test groups, not evidence of live database isolation.

No real Google login, real multi-account preference persistence, expired production session, live support/deletion submission, or live saved-pick save/edit/lock/scoring operation was performed by this browser audit. Those remain dependent on the separate database integration/security checks and any authorized disposable-account or post-deployment verification. Account-library/network access in the local browser was intermittently unavailable; the UI either remained loading during a short observation or displayed a retry state. External logo and live-feed delivery are not certified by the local checks.

## Evidence and reproducibility

Final machine-readable evidence and representative screenshots are in local `reports/browser-audit-2026-11-18/`:

- `broad-results.json`: the 208 route checks and 281 fetched page records.
- `interaction-results.json`: all 34 final passing groups, observed counts, and controlled-adapter markers.
- `social-metadata-results.json`: 281 initial-HTML checks and 267 image metadata checks.
- `visual-*`, `directory-select-after-*`, and `home-guest-settled-390.png`: selected mobile, tablet, and desktop evidence. Earlier screenshots in this temporary directory may show the pre-correction state; final JSON files supersede earlier harness runs.

The temporary reproducibility scripts are `reports/.tmp-expanded-browser-audit.mjs`, `reports/.tmp-interaction-browser-audit.mjs`, and `reports/.tmp-social-metadata-audit.mjs`. They use installed Playwright with installed Chrome, a loopback static server, and existing publication files. The raw QA directory and temporary scripts are local artifacts and need not be included in the release commit.

No CollegeFootballData calls, production user-data mutations, deployment, new hosting resource, paid service, or recurring infrastructure was introduced by this audit. Live database permissions and preservation of saved records are reported by the separate security workstream.
