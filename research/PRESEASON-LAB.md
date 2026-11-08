# Preseason Lab preview

The separate static preview publishes the 2025 four-season Strength replay. It uses 2021–2024 team results and archived 2025 fixtures. The visible 753-game cohort excludes nine conference title games marked in `data/raw/2025.csv`. FBS–FCS games and bowls are outside the forecast comparison. The scorecard on the Testing tab retains the common 2023–2025 archive cohort used for the experiments, including some title games.

The player experiment rates prior FBS passing yards per attempt with sample-size shrinkage. It scores future player-seasons conditional on at least 100 observed attempts. The dated examples establish school affiliation and prior production. Nationwide preseason rosters remain unverified, so player and coaching features are pending in the team forecast.

Run these commands with the private archived inputs in the workspace:

```text
node research/preseason-team-baseline.mjs
python research/preseason_passing_ingest.py
node research/preseason-qb-replay.mjs
node research/preseason-qb-challenger.mjs
node research/prepare-preseason-preview.mjs
```

The passing ingest uses the pinned 2018–2025 [SportsDataverse player-box releases](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_cfb_player_box) cached under `research/cache/preseason-player`. The team and player replays reuse the locally normalized season archives. `research/results/preseason-units/results.json` records the offline yards-per-play comparison and its source checksums. The Render publish directory is `preseason-preview`, containing derived replay outputs only.
