# The Games Decide

[The Games Decide](https://www.thegamesdecide.com/) publishes independent college football and men’s Division I basketball rankings, team evidence, and saved pregame forecasts. Strength of Record (SOR) ranks achieved results. Predictive Strength estimates future matchups. Football also publishes comparison views for human polls and Forge’s AI-authored ballot.

## Architecture

- **Website** — The All Sports portal is at `/`, football is at `/football/`, and basketball is at `/basketball/`. Both sports use the same masthead, footer, and base styles. Football routes and account behavior live in `frontend/`. Basketball pages and shared navigation live in `basketball/`. Public rankings and team evidence are available without an account.
- **Publication** — The football engine in `src/` and basketball engine in `basketball/` produce independent snapshots, predictions, and source evidence. `scripts/prepare-static.js` builds crawlable pages, social previews, and versioned data from committed publications. Render serves the generated `static-dist/` directory. Cloudflare manages the public domain.
- **Accounts** — Supabase Auth handles email verification, password recovery, Google sign-in, and user sessions. Database policies and functions enforce account ownership, contest deadlines, and administrative access. Private support requests use Supabase and a server-side email notification path. See the [database runbook](supabase/README.md) and [account release evidence](reports/account-platform-release-2026-11-18.md).
- **Research** — `research/` and `reports/` retain experiments, validation evidence, and data lineage. Frozen challenger forecasts and retrospective replays have their own evidence. Production SOR and its approved parameters are documented in [METHODOLOGY.md](METHODOLOGY.md).

## Build and verify locally

Use Node.js 24 and the committed lockfile.

```sh
npm ci
npm test
node scripts/prepare-static.js --build-only
npx playwright install chromium
node scripts/browser-quality.mjs
```

Run the browser against `static-dist/` as the quality script does. `npm run preview` still serves the development API at `http://127.0.0.1:3100`. Both paths use committed publications and make zero CFBD requests. A plain `node scripts/prepare-static.js` runs the Node checks as well as building. The isolated [PostgreSQL test procedure](supabase/README.md) uses a disposable database.

Render’s static site runs `node scripts/prepare-static.js` and publishes `static-dist/`. The build verifies a successful **Engine checks** run for the exact main commit before publishing. That workflow runs Node tests, isolated PostgreSQL checks, pinned managed Auth checks, and desktop/mobile browser suites. Render repeats the artifact integrity checks when it generates the site. Automatic data commits dispatch Engine checks explicitly because GitHub’s bot-token pushes do not trigger another push workflow. Failed or unavailable release evidence blocks the new deployment.

## Publication and sources

| Source | Platform use |
| --- | --- |
| [CollegeFootballData](https://collegefootballdata.com/) | Results, schedule, team classifications, player statistics, and inputs for the site’s own ratings. See [source terms](https://collegefootballdata.com/terms). |
| [sportsdataverse/cfbfastR](https://cfbfastr.sportsdataverse.org/reference/load_cfb_schedules.html) | Historical schedule inputs for reproducibility. The import discards source Elo and source win probabilities. |
| [CollegeBasketballData](https://collegebasketballdata.com/) | Men’s Division I results, schedules, stats where available, and model inputs. Basketball publishes a bounded set of summaries and independent analysis from the versioned edition. |
| [ESPN](https://www.espn.com/college-football/scoreboard) | External football Gamecast links and some archived AP poll ingestion. The AP archive workflow has a rights dependency recorded in the [launch report](reports/operation-lights-on.md). |
| [AP](https://apnews.com/hub/ap-top-25-college-football-poll), [AFCA](https://www.afca.com/polls/), [CFP](https://collegefootballplayoff.com/rankings) | Dated human-poll comparisons and official playoff context. The ranking engine calculates SOR independently. |
| [Official conference availability reports](src/player-availability.js) | Game-specific reported statuses and source links where an official feed is covered. |

One Codex automation starts the daily site refresh at **7:30 a.m. MST (UTC−7)**. It dispatches the [football results](.github/workflows/weekly.yml), [official availability](.github/workflows/player-availability.yml), [incremental football player stats](.github/workflows/player-stats.yml), and [basketball](.github/workflows/basketball-refresh.yml) workflows as needed. The GitHub workflows validate and publish fresh data. They have no independent scheduled triggers. A full football results update uses two CFBD calls for results and FBS membership, plus one optional shared advanced-statistics request for Experimental Performance. The postseason bracket can grade from the saved daily finals. Most publication work and ordinary page visits use stored data.

The workflow saves forecasts before confirmed kickoff, grades final results, and retains capture timestamps on valid saved picks. Failed imports leave the previous publication in service. Performance renders only when its season, cutoff, and base snapshot align with the primary rankings. The following morning can archive availability reports posted after the previous check when the official feed retains them. Kickoff or contest-only recovery modes can use the committed slate with zero CFBD calls.

Basketball shares the provider quota with football. Its daily workflow authenticates an encrypted working cache, budgets calls against the football reserve, saves eligible forecasts before tipoff, and publishes only when meaningful data changes. The [basketball operations runbook](reports/basketball-managed-refresh.md) documents the original rollout, budget controls, and recovery.

The daily refresh also checks the football AP, Coaches, and CFP editions. Codex checks football AP and Coaches again on Sundays at **2:00 p.m. MST**, and CFP on Tuesdays at **10:00 p.m. MST**. An officially announced football AP or Coaches delay gets a one-time check at the announced time. If Tuesday evening’s expected CFP release is unavailable, Codex schedules one Wednesday check at **8:00 a.m. MST**. The basketball AP and Coaches check runs on Mondays at **2:00 p.m. Eastern** during the season. New editions are dated and published separately from the site’s own rankings.

The Codex automations run in the local app and need the computer awake and online. Operators can still dispatch the existing workflows in GitHub when a scheduled check is missed.

Public artifacts include rankings, team explanations, saved and retrospective model records, and published poll and conference views. Keep raw provider responses, normalized source caches, API keys, and private account records outside the public build and repository. `data/raw/`, `data/seasons/`, and research caches are local or job-workspace paths. Source checksums, derived evidence, and historical snapshots support auditing. Public distribution rights depend on the source and the artifact.

## Account and operational boundaries

The browser uses the Supabase project URL and its publishable key. Privileged keys for contest grading and support dispatch belong in GitHub Actions secrets or the relevant Supabase server settings. Account preferences, support requests, and private picks are isolated by database rules. Public contest picks require the participant’s sharing preference and the corresponding confirmed kickoff. The administrator interface requires a provisioned role and a second authentication factor. Database migrations and email-provider changes are separate from the static deployment.

The production origin is `https://www.thegamesdecide.com`. Preserve its existing account callback allowlist and Supabase provider callback when working on authentication. Use disposable test identities and the isolated database harness for account changes. Current privacy, support, and methodology explanations are available from the site footer.

Older root auth URLs load the existing `/account` shell in the same document so the managed SDK receives the original callback credentials and browser state. Ordinary portal visits skip that account request. The root bookmark bridge resolves historical football fragments to their corresponding clean URLs.

## Recovery and history

To roll back a code release, revert its code on the current main branch, run Engine checks on the new revision, and verify the previous behavior on Render. Keep later valid data publications and account records. For a bad data update, identify the affected publication files, restore a verified version with matching ranking, forecast, and companion cutoffs, then verify the identifiers after deployment. Use the designated workflow recovery modes for a missed results or grading run. See the [publication reliability report](reports/publication-reliability-2026-11-18.md).

The [legacy Node web-service runbook](https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/blob/4dd4a5b1a99944a91a60073463ee32b5c6540264/README.md) records the original deployment and first validation results. Historical archives and research evidence remain in Git. No project-wide open-source license is recorded. Bundled Barlow fonts carry their [SIL Open Font License](frontend/fonts/OFL.txt). The stadium image’s creation record is in [asset notes](frontend/assets/ASSET-NOTES.txt).
