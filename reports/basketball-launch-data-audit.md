# Basketball launch data audit

The current snapshot was checked at **10:47 p.m. Mountain Time on November 20, 2026** (November 21, 05:47:03 UTC). CollegeBasketballData uses ending year 2027 for the 2026–27 men's Division I season. The season registry and full schedule came from the authenticated November 20 collection at 23:32:45 UTC. The latest check reconciled games in the rolling window and completed a separate season-to-date player-box pass. Dates are tracked as UTC timestamps, including games that cross midnight.

## Coverage and reconciliation

| Evidence | Verified coverage |
| --- | --- |
| Division I registry | 365 schools, 32 conferences, all have a mascot, conference membership, and at least one scheduled and completed game |
| Team records | 365 of 365 overall and conference records reconciled with the model snapshot. All venue splits reconcile to overall records |
| Ranking eligibility | 365 of 365 ranked in SOR, 364 qualify for Experimental Performance |
| Published schedule | 6,007 games involving at least one Division I team |
| Upcoming scheduled games | 4,869. Of these, 2,818 have a confirmed time and 2,051 have a time still pending |
| Other schedule states | 7 scheduled past their published date, 1 in progress at cutoff, 4 postponed, 0 canceled, 2 unverified finals |
| Completed | 1,124 verified finals, including 855 Division I vs. Division I and 269 other opponents |
| Division I team box scores | 855 of 855 (100%) have both sides and all requested core counting fields |
| Division I possession inputs | 855 of 855 (100%). Two games required the estimation formula |
| All finals with usable player evidence | 1,109 of 1,124 (98.7%) have a recorded player appearance on a Division I side |
| Division I player box scores | 842 of 855 (98.5%) have recorded appearances on both sides. The remaining 13 lack sufficient player evidence on at least one side |
| Player identities | 5,018 player-team memberships with recorded appearances across all 365 Division I teams |

The full schedule source returned 1,598, 2,895, 1,535, and 0 records in consecutive season windows. Each response was below the documented 3,000-record ceiling. The registry returned exactly 365 rows. The later rolling reconciliation added three game IDs and removed 20 previously scheduled IDs that the provider omitted from the rechecked window. It preserved every known final and found no changes to previously final scores. Checks found zero duplicate game IDs, duplicate scheduled fixtures, unresolved game venue classifications, or conflicts between schedule-listed and season membership conference IDs. Eighteen games lack a named facility even though home, road, or neutral status is known.

Two records supplied as final have identical 0–0 scores. They remain unverified and excluded from stats, rankings, and grading. Two conflicting team box records were excluded, both outside Division I vs. Division I. No tournament-labeled games were supplied in this edition. Future postseason fixtures will appear as CollegeBasketballData supplies eligible participants and schedules.

The first player check returned exactly 1,000 team-side rows in one window. The published documentation describes a 1,000-game limit. Acquisition treats a response of 1,000 rows as potentially truncated, splits on time, and discards the earlier capped slice. Replacing it with three smaller windows yielded 840, 882, and 542 rows before de-duplicating inclusive boundary timestamps. Response hashes match the locally retained evidence. [CBBD games and player box scores](https://api.collegebasketballdata.com/api/games)

| Season | Registry teams | Verified finals | Division I vs. Division I finals | With paired team boxes |
| --- | ---: | ---: | ---: | ---: |
| 2021–22 | 358 | 5,966 | 5,475 | 5,475 |
| 2022–23 | 363 | 6,222 | 5,715 | 5,714 |
| 2023–24 | 362 | 6,243 | 5,726 | 5,726 |
| 2024–25 | 364 | 6,292 | 5,764 | 5,762 |
| 2025–26 | 365 | 6,300 | 5,752 | 5,752 |
| 2026–27 at cutoff | 365 | 1,124 | 855 | 855 |

Historical seasons retain the existing checked archives. Player backfill was confined to the current season.

## Calculations

- Overall scores, margins and home, road, neutral, and conference records come from verified finals. The published game designation determines conference games. SOR continues to use only the eligible Division I evidence in the existing engine.
- Team and opponent box statistics use matched Division I vs. Division I finals. Counting totals include the number of games supplying each field. Shooting ratios sum makes and attempts across covered games before division. Three-point attempt share uses 3PA ÷ FGA.
- Effective field-goal percentage is (FGM + 0.5 × 3PM) ÷ FGA. True shooting percentage is PTS ÷ [2 × (FGA + 0.44 × FTA)]. Free-throw rate is FTA ÷ FGA. Rebound shares divide offensive or defensive boards by the corresponding combined recovery opportunities on that end.
- The box evidence uses the mean of the two team possession counts. When a count is missing, the existing estimator uses FGA − ORB + TOV + 0.475 × FTA. Pace is possessions per 40 minutes in games with a verified regulation/overtime length. Turnover rate uses turnovers ÷ possessions. Points per possession uses points ÷ possessions. The adjusted efficiency, net efficiency, and schedule strength values come from the existing model.
- Player summaries group by season, team ID, and provider athlete ID. Game IDs, participating school IDs, side, season, and start timestamps must agree with the completed schedule. Per-game values use recorded appearances and may be incomplete. Shooting ratios use actual attempts. Recent lines are the three most recent recorded appearances. Zero attempts produce no percentage. Roster membership, injuries, and availability require independent evidence.

## Quota and product boundaries

The authenticated free-tier check returned a 1,000-call shared monthly allowance, with 71 calls already used. The release data reconciliation used nine metered calls over two attempts, including the capped player-window recovery. The ending balance was 920 with a December 1 reset at midnight UTC. The ordinary rolling plan reuses the registry between deliberate registry checks, reserves 750 shared calls for football and contingency, and limits basketball to 250 per month. [CBBD account-info operation](https://api.collegebasketballdata.com/api/info)

The existing Free account verified successful access to the team registry, schedule, team boxes, and player boxes. The provider documents a Tier 1 requirement for its dedicated live scoreboard and Tier 2 for the team leaderboard and full website shooting profiles. Detailed API shooting-by-location endpoints require team or conference slices. Broader shooting profiles, play-by-play, lineup research, and weekly player-roster acquisition were outside this release verification. [CBBD API access](https://www.collegebasketballdata.com/about) · [CBBD statistics reference](https://api.collegebasketballdata.com/api/stats)

The provider allows reasonable display of factual information within a product and publication of independently derived analytics. Store raw responses and the normalized season inputs privately. The application should serve view-specific evidence and summaries. [CBBD terms](https://collegebasketballdata.com/terms)

## Verification

Twenty targeted Node tests passed across acquisition, advanced statistics, and the ranking/prediction model. Coverage included bounded date plans, no duplicate inclusive date boundaries, provider quota enforcement, missing-page rollback, player identity and timing checks, venue records, missing denominators, possession evidence, deterministic SOR, model probability symmetry, and separation of live predictions from retrospective replays. This audit covers the local dataset and calculations at the cutoff.

Replaying the five cached historical seasons independently produced the same complete validation report as the committed edition, including its source hashes and selected configuration. The 5,752-game holdout reproduced 70.54% accuracy, 0.18836 Brier score, 0.55417 log loss, and 9.87 points mean absolute margin error. These are retrospective results. [Basketball methodology and replay protocol](full-court-basketball-methodology.md)
