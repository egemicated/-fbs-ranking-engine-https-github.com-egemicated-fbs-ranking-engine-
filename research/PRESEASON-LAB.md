# Preseason Lab preview

The separate static preview publishes the 2025 four-season Strength replay. It uses 2021–2024 team results and archived 2025 fixtures. The visible 753-game cohort excludes nine conference title games marked in `data/raw/2025.csv`. FBS–FCS games and bowls are outside the forecast comparison. The scorecard on the Testing tab retains the common 2023–2025 archive cohort used for the experiments, including some title games.

The player experiment rates prior FBS passing yards per attempt with sample-size shrinkage. It scores future player-seasons conditional on at least 100 observed attempts. The dated examples establish school affiliation and prior production. Nationwide preseason rosters remain unverified, so player and coaching features are pending in the team forecast.

Run these commands with the private archived inputs in the workspace:

```text
node research/preseason-team-baseline.mjs
python research/preseason_passing_ingest.py
node research/preseason-qb-replay.mjs
node research/preseason-qb-challenger.mjs
node research/preseason-roster-qb-challenger.mjs research/preseason-roster-evidence.json research/preseason-big12-qb-evidence.json research/preseason-sec-qb-evidence.json
node research/preseason-coaching-replay.mjs
node research/prepare-preseason-preview.mjs
```

The passing ingest uses the pinned 2018–2025 [SportsDataverse player-box releases](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_cfb_player_box) cached under `research/cache/preseason-player`. The team and player replays reuse the locally normalized season archives. `research/results/preseason-units/results.json` records the offline yards-per-play comparison and its source checksums. The Render publish directory is `preseason-preview`, containing derived replay outputs only.

## Dated roster and coach tests

The quarterback ledger uses official preseason delegate lists and dated school evidence. A media-day listing supplies a named candidate for that school. Starting roles and complete quarterback rooms need their own evidence. The test fits on 2023 and evaluates 2024–2025. Both teams must have exactly one uniquely identified media-day candidate with prior FBS passing attempts. Unsupported fixtures keep the original Strength probability. `--pilot-shrinkage` reruns the same cohort with the shrinkage from the earlier individual player test. [ACC and school evidence](preseason-roster-evidence.json) · [Big 12 evidence](preseason-big12-qb-evidence.json) · [SEC evidence](preseason-sec-qb-evidence.json) · [Primary results](results/preseason-roster-qb/results.json) · [Shrinkage sensitivity](results/preseason-roster-qb/pilot-shrinkage.json)

The head-coach test uses dated SEC announcements to identify who held the role heading into the season. The feature measures continuity across consecutive preseasons. Its 2024–2025 evaluation uses SEC opponents only and fits separately from the quarterback test. [Coaching evidence](preseason-coaching-evidence.json) · [Coaching results](results/preseason-coaching/results.json)
