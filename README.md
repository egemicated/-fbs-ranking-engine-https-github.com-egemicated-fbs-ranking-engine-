# Independent FBS Ranking Engine

An independent, experimental college football ranking engine. No human polls,
recruiting ratings, betting lines, third-party team ratings, conference bonuses,
or manual team overrides enter its calculations. No website design yet.

## Run

Requires Node.js 24. No external runtime packages or database.

```sh
npm test
npm run import -- --from 2004 --to 2025
npm run backtest -- --mode tune
npm run build
npm run report
npm start
```

The API serves `/rankings`, `/rankings/2025`, and `/health` on port 3000.
Viewing rankings requires no account or password. There are no public write or
administration endpoints. Data acquisition/builds run from the command line or
deployment pipeline. HTTPS is provided by the host. Credentials belong in host
environment variables, never in source code or API responses.

To update the current season, run `npm run import -- --from 2026 --to 2026 --refresh`
and `npm run build`. To reconstruct a cutoff use
`npm run build -- --before 2025-10-01T00:00:00Z`.

## Two separate ratings

**Achievement (primary national and conference rank)** is the Colley matrix
method applied to this season's completed results. Every modeled team starts
equal. Wins, losses, ties and the opponent network determine the score; prior
seasons, score margin, venue and conference labels do not change it. Identical
achievement scores share a rank; idle teams are unranked.

**Strength (experimental predictive rating)** fits opponent-adjusted, bounded
score margins with a location adjustment. It starts with our own previous
season's strength, regressed toward zero. It uses no imported team ratings.
Hyperparameters are selected using forward predictions in 2019–2022; 2023–2025
are a separate evaluation window. Probabilities are explicitly uncalibrated.

See [METHODOLOGY.md](METHODOLOGY.md) for equations, assumptions, and limitations.

## First validation run

The selected model predicted 71.27% of winners in 2,398 FBS-vs-FBS games from
2023–2025, versus 58.63% for the simple home-only baseline. Log loss was 0.5812
versus 0.6778; Brier score was 0.1971 versus 0.2424. These are preliminary
retrospective benchmarks, not evidence of superiority to mature ranking
systems or calibrated betting probabilities. See
[reports/validation.json](reports/validation.json).

The first import contains 138 teams classified FBS in the 2026 schedule.
All have completed games. The historical files cover 2004–2026, but contain
no postseason rows before 2023 and omit some inactive programs in 2020.
One exact duplicate fixture was removed; two incomplete final scores were
excluded. See [reports/data-quality.json](reports/data-quality.json).

## Data and provenance

The default importer uses the public schedule CSVs from
[sportsdataverse/cfbfastR-data](https://github.com/sportsdataverse/cfbfastR-data),
whose [schedule loader documentation](https://cfbfastr.sportsdataverse.org/reference/load_cfb_schedules.html)
attributes games and schedules to CollegeFootballData.com. Source-supplied Elo
and win probabilities are discarded through a field whitelist. Original files,
retrieval times and SHA-256 checksums are retained locally. Raw and normalized
data are excluded from Git. Source availability and downstream usage rights
must be reviewed before broad redistribution of raw data.

The weekly publisher uses CFBD directly: store `CFBD_API_KEY` as a GitHub Actions
repository secret. For a local manual import, set the same environment variable
and add `--provider cfbd` to import. It fetches a year-specific
FBS roster and game period scores. No key is needed for the default public
schedule import. See [CFBD data availability](https://api.collegefootballdata.com/data-availability).

## Storage

`data/raw/` preserves downloaded source files; `data/seasons/` holds normalized
seasons; `data/snapshots/` holds reproducible ratings; `data/reports/` holds
validation reports and individual predictions. `data/model.json` holds selected
parameters. Local JSON files keep the first engine simple; a database is not
needed for immutable season snapshots. Hosting may rebuild these files from
source during deployment rather than require a paid persistent disk.

## Render deployment

Use one Node web service with build command `npm run prepare:render` and start
command `npm start`. Set `RANKING_SEASON=2026` and `NODE_ENV=production`.
The preparation script runs tests, imports the historical schedules afresh,
and generates all season snapshots before the service starts. No data API key
or paid database is required. Render supplies `PORT`, `RENDER`, and HTTPS.

The service exposes the JSON API only. The free plan can sleep when idle.

## Weekly CFBD publication

`.github/workflows/weekly.yml` targets **Sunday at 08:00 America/Denver**, using
GitHub's timezone-aware schedule (including daylight saving time). GitHub jobs
and the subsequent Render deployment can start late; this is a target start
time, not an exact publication-time guarantee.

Set the repository secret `CFBD_API_KEY` once. The workflow fetches the current
season's games and FBS roster (two API calls per update, normally 8–10/month),
uses our stored prior-season strength from `published/prior-2025.json`, and
commits the derived `published/latest.json`. Render automatically deploys that
commit. No paid cron service, database, or additional user login is required.
The workflow uses a standard Linux runner and a five-minute maximum, drawing
from GitHub's included Actions usage; it does not enable paid usage or alter
billing settings. No workflow artifacts or caches are uploaded.

Confirmed completed Saturday games count even if they finished less than
24 hours earlier. In-progress games do not count. Data missing from CFBD at
retrieval waits until the next successful publication. Failed imports leave
the previous snapshot intact. API traffic never spends CFBD calls. The key
never leaves GitHub's secret-backed job environment for Render or a browser.

Run the workflow manually for setup or an intentional one-off update; creating
or updating `published/refresh-request.json` on main also requests a run. To
move to another season, update `RANKING_SEASON` in the workflow and Render,
and supply our calculated strength prior for that season's previous year.

Render builds continue reconstructing archived historical seasons, then restore
the committed weekly snapshot as the authoritative current-season publication.
Restarts and source-code deploys therefore preserve that publication until the
next successful weekly update. Historical CSV coverage limitations remain.
