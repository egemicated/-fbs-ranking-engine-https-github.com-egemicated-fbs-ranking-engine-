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
node research/preseason-margin-cap.mjs
node research/preseason-window-replay.mjs --combined
node research/preseason-venue-challenger.mjs
node research/preseason-archive-robustness.mjs
node research/prepare-preseason-preview.mjs
```

The passing ingest uses the pinned 2018–2025 [SportsDataverse player-box releases](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_cfb_player_box) cached under `research/cache/preseason-player`. The team and player replays reuse the locally normalized season archives. `research/results/preseason-units/results.json` records the offline yards-per-play comparison and its source checksums. The Render publish directory is `preseason-preview`, containing derived replay outputs only.

## Dated roster and coach tests

The quarterback ledger uses official preseason delegate lists and dated school evidence. A media-day listing supplies a named candidate for that school. Starting roles and complete quarterback rooms need their own evidence. The test fits on 2023 and evaluates 2024–2025. Both teams must have exactly one uniquely identified media-day candidate with prior FBS passing attempts. Unsupported fixtures keep the original Strength probability. `--pilot-shrinkage` reruns the same cohort with the shrinkage from the earlier individual player test. [ACC and school evidence](preseason-roster-evidence.json) · [Big 12 evidence](preseason-big12-qb-evidence.json) · [SEC evidence](preseason-sec-qb-evidence.json) · [Primary results](results/preseason-roster-qb/results.json) · [Shrinkage sensitivity](results/preseason-roster-qb/pilot-shrinkage.json)

The head-coach test uses dated SEC announcements to identify who held the role heading into the season. The feature measures continuity across consecutive preseasons. Its 2024–2025 evaluation uses SEC opponents only and fits separately from the quarterback test. [Coaching evidence](preseason-coaching-evidence.json) · [Coaching results](results/preseason-coaching/results.json)

## History and weighting tests

We fitted odds on 2014–2019, used 2021–2022 to select settings, and scored 2,264 common archive fixtures in 2023–2025. The archive contains some conference titles tagged as regular-season games. The combined challenger retains all earlier years from 2004, carries the prior rating into each historical fit at 100%, and uses the 42-point smooth margin scale. Its final shrinkage into the forecast season is still 75%. The home edge stays at 2.5 points.

Longer history alone made a small difference. The combined rule improved both probability scores in each of the three later years on the original and repaired histories. The difference in winners picked was small. These are retrospective results from familiar seasons. The preview forecasts keep the original baseline. [Window and combined results](results/preseason-window/results.json) · [Margin-scale results](results/preseason-margin-cap/results.json) · [Archive sensitivity](results/preseason-archive-robustness/results.json)

## 2027 prospective comparison

The [trial protocol](../preseason-preview/data/trial-2027.json) freezes two models: a 2023–2026 baseline and a 2004–2026 challenger. Both carry 75% of the final historical rating into the new season. Both use a 2.5-point home edge, zero on neutral ground, and the probability scales fitted on 2014–2019. The challenger carries more history between training seasons and lets large margins carry more weight. Neither fits on 2027 results, polls, or someone else's ratings.

1. **Prepare the inputs before the first 2027 FBS kickoff, including an FBS–FCS opener.** Retain the original normalized 2004–2025 history used in the [window tests](results/preseason-window/results.json), and close out the 2026 archive using the final regular-season and postseason results. Both models use the same source for any year they share. Keep these files private. Save a dated normalized 2027 schedule and roster snapshot with the stable team and game IDs used by the history and results. Cross-check the national opener and check for any earlier FBS fixtures, known matchups and venue flags, duplicate games, and placeholder postseason rows. Include later games with a scheduled date even when their exact kickoff time is pending.
2. **Run capture on the frozen protocol and publish the forecast before the opener.** Record the forecast fingerprint, preview-branch commit, Render deploy time, and verification of the public URL. A timestamp inside the generated JSON alone does not establish when it became public. If the deadline is missed, leave this trial unpublished. Do not backdate or replace the forecast. Publish the derived forecast only; keep the original provider files and their provenance for reproduction.
3. **Score the same games for both models.** Use a later normalized 2027 results snapshot with consistent game and team IDs. Unplayed, unmatched, canceled, and materially changed fixtures stay out of the common denominator. A kickoff update alone does not change either prediction; count those updates separately. Added games are disclosed and left out. Use the final regular-season results for the decision. If publishing an interim scorecard, treat it as progress and retain that snapshot.

### Input format

Use the same `{ year, teams, games }` shape as a normalized season file. Add `retrievedAt` and `openingKickoff` as timezone-qualified timestamps and `source.provider` as a short public name, with an optional `source.publicUrl` citation. Teams use string IDs, names, lowercase divisions, and conferences. Games use string IDs, home and away team IDs, `neutral`, `seasonType`, and `startDate`. Preserve source labels or flags for any conference titles mislabeled as regular season. Use `startTimeTbd: true` for placeholder times (a date-only value is also accepted), and record `startTimeTbd: false` on the verified opener and any other confirmed kickoff. If kickoff times remain unverified on the opener date, run capture before that date starts in UTC. Use scheduled rows with `completed: false` or omit that flag, and leave scores unset. Do not derive this snapshot from results after kickoff.

Capture expects one normalized `YYYY.json` per season from 2004 to 2026. The 2026 file must contain completed postseason evidence and carry a `source.fetchedAt` or `source.retrievedAt` on or after February 1, 2027 and after the final included FBS game. Mark any known cancellations explicitly or use an archive that has already removed them. Run capture and scoring from the frozen trial checkout so the configured engine pin remains valid.

```text
node research/preseason-trial-capture.mjs --schedule path/to/verified-2027-schedule.json --history-dir data/seasons --output preseason-preview/data/trial-2027-forecast.json
node research/preseason-trial-score.mjs --forecast preseason-preview/data/trial-2027-forecast.json --results path/to/normalized-2027-results.json --output preseason-preview/data/trial-2027-scorecard.json
```

Brier score and log loss reward useful win probabilities; lower is better on both. Pick accuracy and mean absolute error in expected team wins on the common scored slate are secondary. Check the overall paired difference, team and conference breakdowns, coverage, and sensitivity to leaving out weeks or conferences. Overlapping team and conference slices are diagnostic, not independent trials. Retain the baseline if results are mixed or coverage is too thin to support a season-wide conclusion. This is a comparison of preseason probabilities, separate from the official FBS Strength of Record ranking.

Both commands work offline with saved inputs. The Trial tab reads static files; it makes no CollegeFootballData requests. The 2027 capture and release require the verified preseason inputs and a publish step; the weekly production refresh does not perform them.
