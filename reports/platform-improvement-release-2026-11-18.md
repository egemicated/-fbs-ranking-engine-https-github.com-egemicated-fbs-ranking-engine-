# FBS Intelligence platform improvements

This release extends the existing static application, saved publications,
Google/Supabase account, and Render service. It introduces no sports-data API
requests or paid service. Existing hash URLs remain supported.

## Completed changes

| Area | Implemented behavior |
| --- | --- |
| Matchup Lab | Invalid or identical IDs produce a selection prompt. Each selector disables its opponent. Shared links and rapid changes follow the same validation. FBS and FCS teams can be explored with their existing approved scales. Mixed-subdivision estimates have an explicit uncalibrated label. |
| Contest privacy | Public participant picks become available per confirmed kickoff. The database enforces the rule, including legacy immediate-sharing clients. Owners retain access to their saved picks. Existing nickname and public-visibility controls remain usable. |
| Conference Strength | Opponent-ranking reference replaces ambiguous wording. Coverage appears before rank filtering, unavailable options are disabled, and empty states distinguish unavailable evidence from valid zero matches. Winning, losing, .500 and missing-record opponent categories reconcile. Experimental score and formula remain accessible. |
| Teams | FBS and FCS use the same directory, search and conference filters, with distinct ranks and counts. Saved-team indicators link to the shared account preference. |
| My Teams | The account can save multiple FBS or FCS teams. The first remains the Home team. A centralized view includes ranks, movement, records, next game and available saved odds, recent results, availability and relevant links. Preferences synchronize through the existing Supabase account. |
| Game discovery | Shared filters support My Teams, conference, Mountain game day, status, close games and SOR-ranked teams. Weekly Picks retains the full unfiltered scorecard. Scoreboard retains live-first sections, custom order and in-place refresh, and adds a completed-games collapse control. |
| Model Report Card | Saved live accuracy, season record, correct/incorrect counts, Brier score, probability bands, confident wins/misses, closest games and covered SOR upset calls. Replays and upcoming estimates retain their separate provenance. FBS and FCS reports have separate populations. |
| Earned-ranking comparison | Same-subdivision SOR comparison shows records, scores, reference probabilities, expected wins, schedule strength, best wins, losses, common opponents, head-to-head and venue evidence. It links naturally to profiles and Matchup Lab. |
| Public discovery | 281 prerendered public pages include Home, both rankings/directories, 266 team profiles, Conference Strength, Matchup Lab, SOR comparison, model reports, methodology and information pages. Sitemap, robots file, canonical URLs and Open Graph/Twitter metadata are generated from published data. Team social previews identify the school, SOR rank, record and date. |
| Trust and accounts | About, factual privacy/account information, use/contest information, public discrepancy reports, and private authenticated account/support requests. Account deletion is requested for owner review. |
| Formatting | Shared record, probability, signed-change and numeric utilities handle small probabilities, negative zero and missing values. Record articles and player-stat singular/plural summaries were corrected. |
| Historical validation | Verified the original and repaired archive lineage and reproduced before-and-after results offline. The recovered postseason release remains outside production team priors. The detailed audit is linked from Methodology. |
| Quality gate | Static builds execute the application/data tests before producing a publication. GitHub checks additionally install Chromium and run browser checks, responsive routes, form labels, shared links, JSON, SEO and game filtering. |

## Main components and infrastructure

The existing `frontend/app.js` remains the route and shared-layout entry point.
New modules are `format.js`, `game-filters.js`, `my-teams-store.js`,
`my-teams.js`, `model-report.js`, `sor-compare.js`, `platform-info.js` and
`page-routes.js`. They use existing team details, ranking history, saved picks,
availability pages and the account client.

`scripts/prerender-pages.js` writes public HTML and PNG social images during
the existing `scripts/prepare-static.js` build. The build supports Render's
existing direct Node command by installing pinned production dependencies from
the lockfile if the image renderer is absent. `sharp` 0.35.5 renders PNG assets.
`playwright` 1.62.1 is a development dependency for browser checks. No new
framework, running server, paid API, or paid testing platform is required.

The additive database migration is
`supabase/migrations/20261118192613_platform_preferences_and_pick_privacy.sql`.
It preserves existing picks, extends the existing preference row with ordered
`team_ids`, and adds private support/account requests. The compatibility trigger
keeps the legacy primary-team field and seen-update behavior consistent. Private
request tables are denied to direct clients and exposed through authenticated,
owner-scoped RPCs.

An owner can review pending requests in the Supabase SQL editor with
`select id, user_id, kind, message, status, created_at from support_private.account_requests where status = 'pending' order by created_at`.
The app collects no extra contact field. Account deletion and historical record
handling remain owner-reviewed actions.

## Verification and model integrity

The local suite passed 321 Node tests. Database checks ran in PostgreSQL with
transaction rollback for guests, owners and other participants. They cover
kickoff visibility, late edits, legacy clients, saved-pick preservation,
preference ownership and private account-request isolation. Additional
production read-only checks verify unchanged saved-pick counts and migrated
primary preferences.

`scripts/browser-quality.mjs` verifies 15 core views at 320, 390, 768 and
1440 pixels. It also checks duplicate matchups, labels, keyboard focus, metadata,
PNG and JSON availability, clean team URL restoration, controlled scoreboard
fixtures and authenticated preference/request UI adapters. Independent local
browser verification exercised actual public data, guest states, division/week
changes, filters and reduced motion. An actual Google OAuth sign-in using a
person's live account was not automated. These are basic accessibility checks,
not a complete WCAG conformance audit.

No engine mathematics, ranking parameters, calibrated scales, production
historical inputs, saved prediction timestamps, published snapshots or CFBD
refresh schedule are changed. Matchup Lab now exposes the already-approved
FCS forecast scale and retains explicit coverage labels. Current and
hypothetical results continue to use separate states.

The archive comparison and its numeric results are documented in
[the model-lineage audit](platform-model-lineage-2026-11-18.md).
The CFP selection rules were reviewed against the
[official 2026 format](https://collegefootballplayoff.com/sports/2026/8/9/bracket-place-holder).
Existing selection logic was retained.

## Remaining limits and owner actions

- Formal legal terms and jurisdiction-specific privacy obligations need owner
  review. The published information pages describe actual features and data
  flow without adding legal warranties or inventing retention periods.
- Deletion requests require manual review. There is no automatic account purge
  or automatic email notification service. The private request queue is available
  in the existing Supabase dashboard.
- The Render service remains configured for commit-triggered deployments.
  Its build now runs application/data checks. The broader browser workflow is
  a separate GitHub check. The local browser gate must pass before a release is
  pushed, and the deployed result must be verified.
- Pregame coverage depends on genuinely saved editions. FCS SOR and Performance
  remain Experimental, cross-subdivision probabilities are uncalibrated, and
  team-specific ranking confidence intervals remain unavailable.
- The historical postseason repairs remain research-only because the measured
  forecast changes are small and mixed. Promoting them would require a separate
  validated model/input release.

Production entry points include `/`, `/teams/fcs/`, `/team/252/`,
`/conference-strength/`, `/model-reports/fbs/`, `/model-reports/fcs/` and
`/methodology/`. Existing bookmarks such as `/#team/252` and
`/#compare/weekly/regular:12` continue to work.
