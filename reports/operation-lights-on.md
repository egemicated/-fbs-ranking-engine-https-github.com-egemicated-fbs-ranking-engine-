# Operation Lights On release review

## Launch decision

Production is serving the previous football release. The basketball candidate builds through the existing Render static-site build and has been exercised on an isolated local server. The existing GitHub/Render protected workflow remains the production release path.

The cutover is held until the exact candidate passes the hosted checks, the production football and basketball credentials are verified against the same allowance, the encrypted basketball cache and original forecast ledger are installed in Actions, and authenticated production journeys can be checked. The two-domain security check is still partial.

The observed production baseline is commit 120bb7651f4583a4ccffb73aff33e409acda009a on main. Three public files match that revision byte for byte, including two changed player-summary files unique to it. The Render connection needs the owner to confirm a workspace before the team can independently verify the live deployment ID and its retention. [Render rollback behavior](https://render.com/docs/rollbacks)

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

Saved forecasts keep their original pre-tipoff capture timestamp and evidence cutoff. This build has 143 saved forecasts, including 35 qualifying graded forecasts and 108 pending. The graded group had 25 correct calls and a 0.1953 Brier score. That small sample is shown separately from the historical holdout. The forecasts had no production exposure.

The candidate leaves all committed football ranking inputs, snapshots, saved forecasts and Supabase migrations intact. A read-only production aggregate independently matched two ordered archived checksums for all 134 original contest picks. Football contest deadline logic is retained. Unresolved kickoff times remain locked. Previously verified times carry forward only when the same published fixture and placeholder time still match.

## Website and rights

The production-shaped build creates 381 basketball and shared routes alongside 292 existing football routes. The basketball homepage, rankings, directory, team profiles, conference comparisons, Matchup Lab, scoreboard, daily picks, report card, ranking history, methodology and March Madness use a single versioned publication. Profiles include venue and scoring splits, Four Factors, efficiency, pace, recent results and player summaries. Matchup Lab includes both teams’ covered leaders with their game counts.

The sports hub lives at /sports/. Existing football home links and account callbacks keep their URLs. Football gets direct access to the hub and basketball while preserving its header and account controls. Basketball uses the shared GD navigation and links to the existing account center. The local basketball contest and practice profile are excluded from the public build. Bracket practice uses the verified historical field or the clearly labeled GD projection, with drafts saved in the current browser. The 2027 format was checked against the NCAA’s published 76-team field, 32 automatic bids, 44 at-large bids, and 12 Opening Round matchups. [NCAA championship expansion](https://www.ncaa.org/championships/march-madness/expansion-what-to-know/) · [Official selection framework](https://www.ncaa.org/championships/march-madness/selections-101/division-i-mens-basketball-championship/)

The publisher verifies every display file against one manifest. Private caches, normalized season files, raw provider responses, original per-game box objects, practice account files and credentials stay outside that build. The daily scoreboard covers a rolling set of dates. Team and conference game detail and report-card samples are bounded. Earlier seasons retain rankings and team evidence, while some historical game details are outside the publication window. The provider allows reasonable factual display and derived analysis and specifies no exact redistribution-volume threshold. Broader exports and existing football bulk files warrant written clarification. [CBBD terms](https://collegebasketballdata.com/terms) · [CFBD terms](https://collegefootballdata.com/terms)

The football candidate uses the existing same-origin published schedule and results for Scoreboard and removes automatic ESPN kickoff and live-score requests. Gamecast remains available for live information. The candidate’s on-site updates and TV detail depend on what the publication contains. Production continues to use its preexisting configuration. The separate ESPN AP-archive job has an unresolved rights dependency. Free basketball coverage supplies published schedules, status and finals. The dedicated real-time scoreboard requires a higher tier. [Disney/ESPN terms](https://disneytermsofuse.com/english/) · [CBBD access tiers](https://www.collegebasketballdata.com/about)

## Operations and quota

Basketball’s proposed Mountain Time schedule is 4:15 a.m. primary, 6:15 a.m. guarded recovery, 10:15 a.m. cache-only capture and publication check, and 10:45 p.m. in March and April when a postseason result is due. Football keeps its existing schedule. Failed data runs and builds retain the previous valid version with its source timestamp. The workflow requires a verified encrypted cache and stops if the archived forecast ledger cannot be restored. The isolated runner passed end-to-end source replay, failed-provider recovery and a no-change run. Hosted basketball refresh has yet to run.

Nine metered basketball calls were used for source reconciliation and capped-window recovery. The authenticated basketball credential showed 920 of 1,000 remaining, with a December 1 reset at midnight UTC. The production football credential’s relationship to that balance needs verification using the non-metered authenticated quota endpoints. Overlap-month planning is 160–280 combined requests. Basketball caps are 250 attempts per reset and 12 per scheduled run, with a 750-call reserve for football and contingencies. [Operations runbook](basketball-managed-refresh.md)

## Production security

Direct HTTPS responses from the www homepage, rankings, team 252, account, verification and recovery routes each returned one Strict-Transport-Security header with max-age=300 after the owner’s configuration change. The apex HTTPS response redirects to www with HTTP 301 and still omits HSTS on that hop. Both HTTP hostnames redirect to HTTPS. The www responses retained CSP framing restrictions, X-Frame-Options DENY, X-Content-Type-Options nosniff, and Referrer-Policy no-referrer. Subdomains and preload are outside the trial.

Apply the same short policy on the apex redirect if its controlling edge can return the header. Verify the apex directly without following redirects before increasing the duration. To reverse the trial, serve max-age=0 for the same HTTPS hostname and retain HTTPS until the five-minute caches expire. Render’s code rollback does not revert custom headers. [Render response headers](https://render.com/docs/static-site-headers) · [Cloudflare HSTS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)

Isolated database tests covered existing migrations, contest privacy, account ownership, and administrator MFA. The managed Auth tests used a pinned runtime, local SMTP, and a seeded Google identity. Production account return URLs were checked without credentials. Live Google OAuth, email receipt, password recovery, and AAL2 sessions have yet to be exercised with this candidate. Supabase’s leaked-password advisor finding requires a paid tier. The existing password and MFA policies are in place. [Supabase password security](https://supabase.com/docs/guides/auth/password-security)

## Verification and rollback

- All 540 Node tests passed, including the exact-revision gate fixtures. Six football Chromium suites passed, including 189 responsive route checks, account fixtures, team carousel, scoreboard filters and freshness, navigation, and browser security policy.
- The public basketball build passed 112 route and viewport combinations from 320 through 1920 pixels. Interactive checks covered matchup changes and duplicate teams, player and advanced team evidence, ranking filters, conference game evidence, browser-local practice drafts, and absence of preview-only files.
- All 15 migrations and 14 SQL suites passed in a disposable PostgreSQL instance. The managed Auth harness passed 13 checks with local SMTP and disposable databases.
- For production, match the retained deployment to the rollback SHA. Install the encrypted state and verify the shared quota. Run the existing GitHub checks and Render deployment for the exact reviewed release. Verify both sports, production Auth, source markers, and a guarded hosted refresh. If rollback is needed, pause basketball publication and restore the prior Render release or revert the release commit through the protected workflow. Supabase requires no rollback migration.
