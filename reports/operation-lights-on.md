# Operation Lights On release review

## Launch decision

Basketball went live at 11:36 p.m. Mountain on November 20, 2026. Render deploy dep-dc0jm2u8bjmc73ajk1cg serves checked commit 0f6b9ddbddf7340a8d8a6d815e0bda8ea54b7dc4 and publication 359fe2963dc0454681607ce4. Public probes verified 17 routes, six private or preview path exclusions, and the apex redirect. The public index and current season JSON also matched the committed file hashes. [Basketball](https://www.thegamesdecide.com/basketball/) · [Sports hub](https://www.thegamesdecide.com/sports/) · [Exact production release checks](https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/actions/runs/44876047822)

The existing football baseline was commit 120bb7651f4583a4ccffb73aff33e409acda009a on Render deployment dep-dc05d0huobas73alsvl0. The checked intermediate code-only deployment dep-dc0jk5u7bikc739h7cjg serves commit 5541da13aff2847c287363cfb564ababc5199870 and is the immediate rollback target if the basketball edition needs to be withdrawn. Verify the retained target in Render before executing a rollback. [Render rollback behavior](https://render.com/docs/rollbacks)

## Data and models

| Release evidence | Result |
| --- | --- |
| Latest verified basketball provider cutoff | November 20, 2026, at 10:47 p.m. Mountain |
| 2026–27 men’s Division I | 365 schools, 32 conferences, 6,007 known fixtures |
| Finals | 1,124 verified, including 855 Division I vs. Division I |
| Team box scores | Both sides in all 855 Division I games |
| Player box scores | Both sides in 842 of 855 Division I games. Player evidence for all 365 teams |
| Missing or disputed evidence | 13 Division I games without complete paired player coverage, two unverified 0–0 results excluded, two conflicting team boxes outside Division I |
| Prior seasons | Five archived seasons dating to 2021–22, with retrospective analyses distinguished from saved editions |
| Historical forecast holdout | 5,752 games, 70.54% accuracy, 0.18836 Brier score, 0.55417 log loss, 9.87 points mean absolute margin error |
| Production football source cutoff | November 20, 2026, at 7:13 a.m. Mountain for the weekly game publication and 7:17 a.m. for player pages |

The historical basketball replay regenerated the checked-in validation report exactly. SOR, Predictive Strength, Experimental Performance and forecast grading retain their existing computations. Player averages use recorded appearances, so coverage varies. Box statistics and efficiency include eligible game counts. No verified basketball injury or availability reports were available. [Data audit and calculations](basketball-launch-data-audit.md)

Saved forecasts keep their original pre-tipoff capture timestamp and evidence cutoff. The preflight sample contained 143 forecasts, including 35 graded and 108 pending. The live publication reconciled two new or corrected results and used 856 Division I finals for its rankings. It published 144 saved forecasts, including 36 graded and 108 pending. The 36-game sample showed 72.22% accuracy and a 0.1961 Brier score, separate from the historical holdout. Two elapsed games were still awaiting results from the provider.

The candidate leaves all committed football ranking inputs, snapshots, saved forecasts and Supabase migrations intact. A read-only production aggregate independently matched two ordered archived checksums for all 134 original contest picks. Football contest deadline logic is retained. Unresolved kickoff times remain locked. Previously verified times carry forward only when the same published fixture and placeholder time still match.

## Website and rights

The production-shaped build creates 381 basketball and shared routes alongside 292 existing football routes. The basketball homepage, rankings, directory, team profiles, conference comparisons, Matchup Lab, scoreboard, daily picks, report card, ranking history, methodology and March Madness use a single versioned publication. Profiles include venue and scoring splits, Four Factors, efficiency, pace, recent results and player summaries. Matchup Lab includes both teams’ covered leaders with their game counts.

The shared sports hub is the homepage, with /sports/ retained as an alias. Football has its own home at /football/ and uses the same GD header and footer as basketball. Existing football page links, legacy bookmarks and account callbacks continue to open their intended destinations. The local basketball contest and practice profile are excluded from the public build. Bracket practice uses the verified historical field or the clearly labeled GD projection, with drafts saved in the current browser. The 2027 format was checked against the NCAA’s published 76-team field, 32 automatic bids, 44 at-large bids, and 12 Opening Round matchups. [NCAA championship expansion](https://www.ncaa.org/championships/march-madness/expansion-what-to-know/) · [Official selection framework](https://www.ncaa.org/championships/march-madness/selections-101/division-i-mens-basketball-championship/)

The publisher verifies every display file against one manifest. Private caches, normalized season files, raw provider responses, original per-game box objects, practice account files and credentials stay outside that build. The daily scoreboard covers a rolling set of dates. Team and conference game detail and report-card samples are bounded. Earlier seasons retain rankings and team evidence, while some historical game details are outside the publication window. The provider allows reasonable factual display and derived analysis and specifies no exact redistribution-volume threshold. Broader exports and existing football bulk files warrant written clarification. [CBBD terms](https://collegebasketballdata.com/terms) · [CFBD terms](https://collegefootballdata.com/terms)

The live football scoreboard uses the existing same-origin published schedule and results. Gamecast remains available as an outbound link for live information. On-site updates and TV detail depend on what the publication contains. The separate ESPN AP-archive job has an unresolved rights dependency. Free basketball coverage supplies published schedules, status and finals. The dedicated real-time scoreboard requires a higher tier. [Disney/ESPN terms](https://disneytermsofuse.com/english/) · [CBBD access tiers](https://www.collegebasketballdata.com/about)

## Operations and quota

Basketball’s enabled Mountain Time schedule is 4:15 a.m. primary, 6:15 a.m. guarded recovery, 10:15 a.m. cache-only capture and publication check, and 10:45 p.m. in March and April when a postseason result is due. Football keeps its existing schedule. Failed data runs and builds retain the previous valid version with its source timestamp. The workflow requires a verified encrypted cache and stops if the archived forecast ledger cannot be restored. The restore saved the encrypted cache on main, and the first guarded manual refresh saved the updated cache and published the new edition. The temporary restore-link secret was removed. The private backup remains in Supabase. The first automatic run had yet to occur at the time of deployment. [Production restore](https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/actions/runs/44875754885) · [First production refresh](https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/actions/runs/44875984023)

Nine metered basketball calls were used for initial source reconciliation and capped-window recovery. Hosted checks verified that the football and basketball credentials share one allowance. The production restore spent zero calls, and the first production refresh made five attempts after confirming that allowance. Overlap-month planning is 160–280 combined requests. Basketball caps are 250 attempts per reset and 12 per scheduled run, with a 750-call reserve for football and contingencies. [Operations runbook](basketball-managed-refresh.md)

## Production security

Live HTTPS checks confirmed Strict-Transport-Security with max-age=300 on both hostnames. The apex preserved the basketball route when redirecting to www with HTTP 301. The www responses retained CSP framing restrictions, X-Frame-Options DENY, X-Content-Type-Options nosniff, and Referrer-Policy no-referrer. Subdomains and preload are outside the trial. To reverse the trial, serve max-age=0 for the same HTTPS hostname and retain HTTPS until the five-minute caches expire. Render’s code rollback does not revert custom headers. [Render response headers](https://render.com/docs/static-site-headers) · [Cloudflare HSTS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)

Isolated database tests covered existing migrations, contest privacy, account ownership, and administrator MFA. The managed Auth tests used a pinned runtime, local SMTP, and a seeded Google identity. Production account return URLs were checked without credentials. Live Google OAuth, email receipt, password recovery, and AAL2 sessions have yet to be exercised with this candidate. Supabase’s leaked-password advisor finding requires a paid tier. The existing password and MFA policies are in place. [Supabase password security](https://supabase.com/docs/guides/auth/password-security)

## Verification and rollback

- All 540 Node tests passed, including the exact-revision gate fixtures. Six football Chromium suites passed, including 189 responsive route checks, account fixtures, team carousel, scoreboard filters and freshness, navigation, and browser security policy.
- The public basketball build passed 112 route and viewport combinations from 320 through 1920 pixels. Interactive checks covered matchup changes and duplicate teams, player and advanced team evidence, ranking filters, conference game evidence, browser-local practice drafts, and absence of preview-only files.
- All 15 migrations and 14 SQL suites passed in a disposable PostgreSQL instance. The managed Auth harness passed 13 checks with local SMTP and disposable databases.
- The exact live publication passed hosted GitHub checks. Live desktop and phone browser checks verified the sports hub, basketball home, rankings and the Matchup Lab venue and player controls. The football and account routes were also checked in production. If rollback is needed, pause basketball refresh and restore the prior Render release or revert the release commit through the protected workflow. Supabase requires no rollback migration.
