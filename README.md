# The Games Decide

[The Games Decide](https://www.thegamesdecide.com/) publishes independent college football rankings, team evidence, and saved pregame forecasts. Strength of Record (SOR) ranks achieved results. Predictive Strength estimates future matchups. Human polls and Forge’s AI-authored ballot have their own comparison views.

## Architecture

- **Website** — Native HTML, CSS, and browser modules in `frontend/`. The static build creates crawlable public pages, social previews, and versioned publication metadata. Public rankings and team evidence are available without an account.
- **Publication** — The engine in `src/` and publishers in `scripts/` turn season data into snapshots, predictions, and source evidence. Render serves `static-dist/` from committed inputs. Cloudflare manages the public domain.
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
| [ESPN](https://www.espn.com/college-football/scoreboard) | Scoreboard and kickoff verification, school images, and some poll ingestion. The live endpoint and image references require separate rights review before broader use. |
| [AP](https://apnews.com/hub/ap-top-25-college-football-poll), [AFCA](https://www.afca.com/polls/), [CFP](https://collegefootballplayoff.com/rankings) | Dated human-poll comparisons and official playoff context. The ranking engine calculates SOR independently. |
| [Official conference availability reports](src/player-availability.js) | Game-specific reported statuses and source links where an official feed is covered. |

The [results workflow](.github/workflows/weekly.yml) checks daily at **2:45 a.m. Eastern Time**, and the [official availability workflow](.github/workflows/player-availability.yml) uses the same time from August through January. Each has a **4:45 a.m. Eastern** backup that checks for a successful run before making provider requests. The saved schedule also guards whether the results check needs a new pull. A full refresh uses two CFBD calls for results and FBS membership, plus one shared advanced-statistics request for optional Experimental Performance. The [player workflow](.github/workflows/player-stats.yml) uses the existing encrypted cache on Sundays when due. The [CFP bracket workflow](.github/workflows/cfp-bracket.yml) uses one postseason results call on scheduled playoff game nights. Most publication work and all ordinary page visits use stored data.

The workflow saves forecasts before confirmed kickoff, grades final results, and retains capture timestamps on valid saved picks. Failed imports leave the previous publication in service. Performance renders only when its season, cutoff, and base snapshot align with the primary rankings. Game-day availability reports posted after the overnight check can still be archived on the following morning when the official feed retains them. Poll archives and official playoff releases keep their separate schedules. Kickoff or contest-only recovery modes can use the committed slate with zero CFBD calls.

Public artifacts include rankings, team explanations, saved and retrospective model records, and published poll and conference views. Keep raw provider responses, normalized source caches, API keys, and private account records outside the public build and repository. `data/raw/`, `data/seasons/`, and research caches are local or job-workspace paths. Source checksums, derived evidence, and historical snapshots support auditing. Public distribution rights depend on the source and the artifact.

## Account and operational boundaries

The browser uses the Supabase project URL and its publishable key. Privileged keys for contest grading and support dispatch belong in GitHub Actions secrets or the relevant Supabase server settings. Account preferences, support requests, and private picks are isolated by database rules. Public contest picks require the participant’s sharing preference and the corresponding confirmed kickoff. The administrator interface requires a provisioned role and a second authentication factor. Database migrations and email-provider changes are separate from the static deployment.

The production origin is `https://www.thegamesdecide.com`. Preserve its existing account callback allowlist and Supabase provider callback when working on authentication. Use disposable test identities and the isolated database harness for account changes. Current privacy, support, and methodology explanations are available from the site footer.

## Recovery and history

To roll back a code release, revert its code on the current main branch, run Engine checks on the new revision, and verify the previous behavior on Render. Keep later valid data publications and account records. For a bad data update, identify the affected publication files, restore a verified version with matching ranking, forecast, and companion cutoffs, then verify the identifiers after deployment. Use the designated workflow recovery modes for a missed results or grading run. See the [publication reliability report](reports/publication-reliability-2026-11-18.md).

The [legacy Node web-service runbook](https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/blob/4dd4a5b1a99944a91a60073463ee32b5c6540264/README.md) records the original deployment and first validation results. Historical archives and research evidence remain in Git. No project-wide open-source license is recorded. Bundled Barlow fonts carry their [SIL Open Font License](frontend/fonts/OFL.txt). The stadium image’s creation record is in [asset notes](frontend/assets/ASSET-NOTES.txt).
