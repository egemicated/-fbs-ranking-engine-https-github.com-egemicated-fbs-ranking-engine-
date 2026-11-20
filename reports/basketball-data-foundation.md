# Basketball data foundation

The basketball population is NCAA Division I men’s basketball. Season IDs use the year in which the season ends. The 2026–27 season is 2027. The CFBD football feed and CBBD basketball feed use separate hosts and share the same account allowance. [Provider coverage](https://api.collegebasketballdata.com/data-availability)

## Provider coverage and access

| Data | Evidence and treatment |
| --- | --- |
| School and conference | The core import uses `/teams?season=YYYY` for identity, mascot, team colors, and memberships valid for the requested season. Provider sources confirm this query filters to recorded memberships for that season. It may omit unrecorded independents. A game against an opponent outside the registry remains visible in that team’s schedule and outside the D-I-only model sample. [Teams API](https://api.collegebasketballdata.com/api/teams) · [Provider implementation](https://github.com/CFBD/cbb-api/blob/main/src/app/teams/service.ts) |
| Schedules and results | `/games` includes the scheduled tipoff, whether the time is TBD, neutral site, conference-game flag, status, scores, period scores, seeds, and tournament metadata where recorded. The provider documents games beginning in 1949 with variable historical coverage. The importer requires a positive, stable ID for each side. It holds malformed, tied, and future-dated finals out of the model. It validates response windows and does not claim an individual known fixture is present unless it appears in the source. [Games API](https://api.collegebasketballdata.com/api/games) |
| Team statistics | `/games/teams` provides the team’s and opponent’s box scores, game minutes, possessions, pace, and four factors where recorded. Broad coverage starts around the 2005 season. The importer verifies participants and compares score totals against the game result. It keeps the basic rates and counts used by the independent models and supports possession estimates when the necessary box fields exist. Season summaries are derived from these boxes and schedules. Missing remains missing. [Games API](https://api.collegebasketballdata.com/api/games) · [Stats API](https://api.collegebasketballdata.com/api/stats) |
| Players and richer game evidence | Rosters, season and game statistics, shot locations, play-by-play, lineups, and substitutions are documented with varying dates and gaps. The provider documents no standard player availability report in its core data catalog. These families are deferred for quota and coverage reasons. The lineup and shooting explorer tools have separate access levels. [Provider coverage](https://api.collegebasketballdata.com/data-availability) · [Access tiers](https://collegebasketballdata.com/api-tiers) |
| External benchmarks | The provider documents AP and Coaches Polls, Elo, SRS, and adjusted offensive and defensive ratings. They are available for separate comparison with appropriate temporal provenance. They were excluded from ingestion for model inputs. [Provider coverage](https://api.collegebasketballdata.com/data-availability) |
| Near-live scores | The free tier excludes `/scoreboard`. CBBD says regular postgame data is usually updated within minutes after completion. That claim is a source description, not a measured freshness guarantee. The preview uses dated schedule and results snapshots. [Access tiers](https://collegebasketballdata.com/api-tiers) · [CBBD update information](https://collegebasketballdata.com/about) |
| Usage rights | Current terms permit independently derived models, analytics, and rankings and reasonable display of supporting game facts. The terms restrict bulk redistribution and do not transfer rights to logos, broadcasts, tournament marks, or likenesses. Raw provider responses and normalized full seasons remain private and ignored by Git. [CBBD terms](https://collegebasketballdata.com/terms) |

## Quota and failure controls

The initial private acquisition checked the supplied credential through the unmetered `/info` endpoint. It observed 1,000 calls remaining before acquisition and **929 remaining after 71 successful basketball requests**, with a UTC reset on December 1, 2026. The current-season load used seven calls and the five historical seasons used 64. The earlier football production observation of 914 remaining came from the football workflow’s credential. These observations do not establish that the supplied basketball credential is the same account. If we conservatively plan as though both usages belong to a single 1,000-call pool, 86 previously used football calls plus 71 basketball calls leave 843.

### Acquired coverage

| Season | Registry teams | Games and scheduled fixtures | Confirmed finals | D-I versus D-I finals | D-I finals with reconciled boxes | API calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2021–22 | 358 | 6,387 | 5,966 | 5,475 | 5,475 | 12 |
| 2022–23 | 363 | 6,261 | 6,222 | 5,715 | 5,714 | 13 |
| 2023–24 | 362 | 6,249 | 6,243 | 5,726 | 5,726 | 13 |
| 2024–25 | 364 | 6,299 | 6,292 | 5,764 | 5,762 | 13 |
| 2025–26 | 365 | 6,318 | 6,300 | 5,752 | 5,752 | 13 |
| 2026–27 through the Nov. 20 acquisition | 365 | 6,024 | 1,076 | 813 | 813 | 7 |
| Total | — | 37,538 | 32,099 | 29,245 | 29,242 | 71 |

Every registry team had a schedule in the acquired scope. Two 2026–27 source records labeled final lacked a valid supported score, both against opponents outside the D-I registry. Those games remain unverified. Three historical D-I finals lack a reconciled team box, so score-only methods can use their outcomes and box-dependent methods exclude missing inputs. The five historical NCAA Tournament fields each include 67 games. Counts are from the available provider data and do not prove every event on an independent official schedule is present.

The initial guard protects **600 requests for football and 150 for contingency**, caps private basketball acquisition at **250 reservations per reset period**, and limits one invocation to **90 attempted metered calls**. The private ledger records each attempt before its network request. HTTP 429 monthly exhaustion stops immediately. Bounded retries count against the reservation conservatively. The client respects the lower of locally accounted remaining calls and the latest provider header. A retry after more than five seconds of required backoff is deferred to another invocation. A local exclusive lock prevents overlapping acquisitions using this cache. Repeat runs use the actual aggregate balance, and do not assume that usage outside the local basketball ledger was exclusively football.

`/info` reports the live shared limit, used calls, remaining calls and the UTC reset time without spending a call. A failed or invalid quota check blocks acquisition. The configured reserves are intentionally conservative until representative workflow data supports changing them. The production football jobs currently do not share this local lock. Coordinating concurrent remote football and basketball automation through one global reservation service is a future production integration decision. [CBBD usage and access](https://api.collegebasketballdata.com/usage-and-access) · [Quota response](https://api.collegebasketballdata.com/api/info)

Historical schedules are gathered in four contiguous half-open windows per season, including the offseason around the supported dates. Team box-score partitions are sized by completed-game counts. A 3,000-row response triggers recursive subdivision. The importer deduplicates stable IDs across inclusive provider boundaries and refuses inconsistent duplicates. A rolling current-season refresh revisits the last 14 days and upcoming schedule, preserving cached older data. An explicit full refresh detects corrections beyond that window. An unexplained disappearance of a previously observed final stops the import rather than dropping it.

A validated season is written with an atomic replacement. An unchanged payload keeps the published season artifact and saves the observation in a separate private checkpoint. Corrections retain old content-addressed snapshots and a record of changed fields. API responses, hashes, parsed inputs, local locks, and usage ledger live under the ignored `research/cache/basketball/` directory. The normalized season file lives under the ignored `data/seasons/basketball/` directory. A process interruption can leave a lock file. Before clearing it, verify that no acquisition still owns it.

## Local usage

```powershell
node scripts/refresh-basketball-data.mjs --dry-run --season 2027 --season 2026 --season 2025
node scripts/refresh-basketball-data.mjs --info
node scripts/refresh-basketball-data.mjs --season 2027 --season 2026 --season 2025 --max-calls 45
```

Use an existing key through the process environment as `CBBD_API_KEY` or `CFBD_API_KEY`. A dry run without a key reports the estimated scope and leaves the quota unknown. A dry run with a key queries only the unmetered `/info`. The estimate is conservative planning, and the live per-attempt reserve still applies if source partitioning needs additional requests.

An offline fallback uses CSVs downloaded with the provider’s free, user-facing exporter. Give the season-specific team export and one or more uncapped date-window game exports. Optional box-score exports feed efficiency data. The resulting snapshot records each input’s SHA-256 and only claims the exported coverage. It cannot replace a full API schedule. No API key is required for this path. [Official CSV exporter](https://www.collegebasketballdata.com/exporter)

```powershell
node scripts/refresh-basketball-data.mjs --season 2027 --teams-csv data/raw/basketball/exports/2027-teams.csv --games-csv data/raw/basketball/exports/2027-games.csv --boxes-csv data/raw/basketball/exports/2027-boxes.csv
```

Run `node --test test/basketball-data.test.js` for the import, correction, cap subdivision, rolling boundary, secret handling, quota, concurrent reservation, and failed-refresh regressions. This test suite uses fixtures and no real provider requests.
