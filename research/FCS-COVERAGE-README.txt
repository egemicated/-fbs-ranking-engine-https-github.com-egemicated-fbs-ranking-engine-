FCS COVERAGE RESEARCH SUPPLEMENT (fcs-coverage-v1)

Purpose
Test the division-calibration model using better historical opponent coverage.
This supplement is a separate, versioned child of historical-coverage-v1.
Production data, snapshots, engine, frozen SOR protocol and deployment are untouched.

Important calendar correction
An ESPN seasonType of regular does not establish that a game was outside the
FCS playoffs. ESPN often labels early FCS playoff rounds using the FBS calendar.
The older files already contained many early playoff rounds. Completeness must
be checked by actual NCAA tournament identities, not by the postseason flag.

What changed
34 completed games between known, season-specific FCS nodes were added:
2014-2019: four each; 2021: six; 2022: four; 2020 and 2023-2025: none.
These include one November regular game, late tournament games and Celebration
Bowl games. Not all additions are NCAA tournament games.

Three 2022 quarterfinal absolute scores were corrected against the NCAA records
book and winning-school primary sources. The winners are unchanged:
NDSU-Samford 24-3 -> 27-9; Montana State-William & Mary 55-0 -> 55-7;
South Dakota State-Holy Cross 41-21 -> 42-21.
Exact old fields, expected identities, new score fields and source URLs are in
results/fcs-score-adjudications.json. No date, venue or participant is overwritten.
The NCAA PDF also has known score/date typos, so it is not treated as infallible.
Its semantic tournament comparison is recorded separately under results/round2.
That independent crossmatch found all 23 correct pair/winner/score identities in
each normal season 2014-2019 and 2021-2025: 253 of 253. Season2020 remains zero
of 15 because its spring participants are largely absent from the parent roster.
Across all 268 expected tournament games, the parent had 224 exact results,
41 missing and three wrong absolute scores; this supplement has 253 exact,
15 missing and zero score conflicts. Date checks allow UTC following-day rollover.

Evidence and costs
38 public unauthenticated ESPN month responses were cached: Nov/Dec/Jan windows
for seasons 2014-2025, plus April/May 2021 for the season-2020 spring investigation.
One additional exploratory public request preceded the cached acquisition.
18 already cached Dec/Jan group80 responses were reused without requests.
The group81 filter alone omitted eight qualifying missing games recovered from
those group80 windows; a single group filter does not establish completeness.
All 56 source bytes are checksum-verified. Old group80 source manifests did not
record retrieval timestamps; this gap is disclosed, not filled with invented dates.
CFBD calls: zero. No authentication, paid services or scheduled jobs were used.

Remaining limits
The monthly windows are not proof of all-season regular coverage. Known-parent
FCS identities are required; no membership is invented. Spring season-2020 types
5/6 map to regular/postseason only for dates in January-June 2021. Original source
types are retained in each addition's audit. No spring games qualified with both
identities in the existing 17-node 2020 FCS roster; 2020 remains anomalous.
1,875 existing events were corroborated. There were 70 historical-input field
disagreements: three scores explicitly adjudicated, 67 retained unchanged
(36 neutral flags, 27 calendar labels, two kickoff times and two orientations).
These counts concern this finite source window, not independent source-wide
accuracy. Lower-division context remains incomplete in older years.

Reproduce from the project folder
1. Existing cached sources: node research/fetch_fcs_history.mjs
   A fully cached rerun makes no public requests. Missing files need public access.
2. Build: python research/repair_fcs_history.py
3. Tests: python research/test_fcs_repairs.py
4. Offline restore: python research/repair_fcs_history.py --restore

The compact releases/fcs-coverage-v1.json.gz contains additions, exact score
corrections, source manifests and parent/output checksums. Restoration requires
the matching historical-coverage-v1 parent files and verifies all 12 output hashes.
Tests cover eligibility, spring season/date isolation, source labels, score/winner
validation, venue/date ambiguity, duplicate protection, narrow correction guards,
unchanged rosters, preserved parent fields and exact frozen reconstruction.
