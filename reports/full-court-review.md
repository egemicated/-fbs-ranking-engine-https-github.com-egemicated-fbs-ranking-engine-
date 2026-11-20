# Operation Full Court private review

Open [the local preview](http://127.0.0.1:4318/) on Bryan’s computer. From the worktree, use the existing locked dependencies and run:

```powershell
node scripts/prepare-static.js --build-only
node scripts/serve-basketball-preview.mjs --port 4318
```

This build binds to `127.0.0.1`. It has no production deployment or public tunnel. The provider key is needed for a new acquisition and is unnecessary for opening the cached preview. One authorized reader on the same machine can review in a separate browser session. Anyone reviewing remotely would need a separately approved access-controlled environment.

## What to explore

- Use the sport switches to move between two working experiences. Football remains available through `/football/` and its existing deep links. Basketball uses clean routes under `/basketball/`.
- Start with the current Top Five. Open rankings to switch among Strength of Record, Predictive Strength, and Performance Experimental. Search by team or mascot, compare conference results, and change seasons.
- Pick two different D-I teams in Matchup Lab. Compare home, away, and neutral courts. The prediction uses a basketball-only model and estimates a margin without inventing an exact score.
- Use Scoreboard and Daily Picks by Mountain Time date. Saved predictions show their actual capture times. Model Report Card separates eligible future and completed forecasts from retrospective validation. Ranking History compares genuine saved editions as they accumulate.
- In March Madness, try the new 76-team progression, open the current unofficial projection, or edit and grade a bracket against the official 2026 tournament. The unannounced 2027 field has an upcoming state.
- Use a disposable Local profile for private contest and bracket testing. Practice contest picks have server-side tipoff deadlines and ownership. Bracket drafts use the browser and local profile. No production users or records enter these routes.

## Current data and shared allowance

| Season | Teams | Schedule and result records | Verified finals | D-I finals with boxes |
| --- | ---: | ---: | ---: | ---: |
| 2026–27 | 365 | 6,024 | 1,076 | 813 |

Across six seasons, there are **37,538 schedule and result records**, **32,099 verified finals**, and reconciled boxes for **29,242 of 29,245 D-I finals**. Two current records described as finals by the source did not carry valid score evidence and were excluded. The full breakdown, field coverage, tiers, and acquisition controls are in [the data foundation report](basketball-data-foundation.md).

The acquisition used **71 calls**. The supplied basketball key showed **929 of 1,000** remaining. The separate existing football workflow last reported **914**. Provider terms describe a shared allowance and those two readings cannot establish that these credentials debit the exact same account. Budgeting as if the 86 previously observed football calls and 71 basketball calls came out of one allowance yields **843** remaining, including the protected 750. No paid tiers were used. [CollegeBasketballData tiers](https://collegebasketballdata.com/api-tiers) · [Provider terms](https://collegebasketballdata.com/terms)

## Models and results

The current preview uses games available as of **November 20, 2026 at 4:32 p.m. Mountain Time**. Houston, Florida, High Point, Virginia, and Kansas form the current SOR Top Five. The independent SOR rank uses a reference team with Colley 0.5 and the Poisson-binomial tail over eligible D-I opponents and venues. The separate Predictive Strength model uses fitted venue and opponent-adjusted point margin. Performance Experimental uses opponent-adjusted points per 100 possessions from reconciled game boxes. The coefficients, leave-one-game-out method, small-sample treatment, and sensitivity to alternative reference strengths are documented in [the model methodology](full-court-basketball-methodology.md).

| Held-out 2025–26 test | Result |
| --- | ---: |
| D-I games | 5,752 |
| Winner accuracy | 70.54% |
| Brier score | 0.18836 |
| Log loss | 0.55417 |
| Expected calibration error | 1.59 pp |
| Margin mean absolute error | 9.87 points |
| Neutral-site accuracy | 63.70% (679 games) |
| NCAA tournament accuracy | 74.63% (67 games) |

Training used the seasons ending 2022–24, model selection used 2025, and the 2026 holdout was reserved for evaluation. The reproducible [validation results](full-court-basketball-validation.json) record the baselines, comparisons, and slices. No fixture from the historical replay enters the prospective forecast record.

## Refresh and production review

The [Intelligent Refresh Plan](intelligent-refresh-plan.md) records the actual release and workflow evidence available, maps all existing jobs, simulates delayed and missed updates, and provides exact Mountain Time and scheduler times. It recommends retaining football at **12:45 a.m. MT** with a **2:45 a.m. MT** backup on ordinary dates, and testing basketball at **4:15 a.m. MT** with a **6:15 a.m. MT** guarded backup and a **10:15 a.m. MT** forecast capture from cached results. The basketball times are a tested proposal. No schedule was activated.

The [architecture record](full-court-architecture.md) gives the starting SHA and separates football-only assets and policies from preview code. The [account and security report](basketball-account-boundaries.md) records the read-only production catalog review and isolated SQL regressions. Data acquisition caches are ignored by Git and are excluded from the local server’s static files. Browser tests verify denial for the cache and credential paths. League branding is text-only. School accents use the provider’s color fields with a neutral fallback.

## Verification

- The browser suite rendered 16 destinations at 320, 390, 768, 1100, and 1440 pixels. It exercised both sport switches, team search, historical team links, the identical-team guard, keyboard bracket advancement, projection, practice registration and picks, and private file denial.
- Local Chromium measured median DOMContentLoaded of 17 ms and median transfer of 202 KiB across those visits. The largest HTML response was 122 KiB, a scrollable conference matrix and supporting tables. These are local measurements with external requests blocked.
- The standalone tournament browser suite passed on mobile, tablet, and desktop. It exercised save/reopen, keyboard selection, historical grading, and model-favorite advancement. The existing football browser gate passed 168 route and viewport checks.
- The isolated database applied all 15 repository migrations and passed 14 SQL suites. No production account, pick, or forecast rows were read or changed. Preserve actual deployed data as the source of truth during any public rollout.

## Before a public release

Review the proposed schedule and quota ownership, especially the two credential readings. Add budget reservation across both runners if both are activated. Confirm permitted public display of the exact data surfaces and future token handling. Stage sport-qualified Supabase preferences and contests with isolated data, review the additive migration and rollback, and test lock and privacy behavior again. Keep production changes inactive until Bryan approves the design, data rights, authentication plan, NCAA field import, and release. Use the existing protected production workflow when approved.

Live in-progress clocks are outside the free tier. Individual player and shot/lineup backfills were deferred. The 2027 official bracket awaits the actual field. Refreshed status must not be represented as live coverage. Historical ranking replays and live forecasts require distinct labels. No paid service, production basketball deployment, or production schedule change was introduced.
