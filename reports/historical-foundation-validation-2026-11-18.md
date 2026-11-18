# Historical foundation and fixed-model validation, November 18, 2026

The frozen corrections are reproducible and the predictive differences remain mixed and small. Keep the production prior and model unchanged. This audit does not certify complete historical schedules or earn model promotion. It adds an explicit coverage ledger, stratified validation, source checks and regression safeguards; it makes no public website or numerical production change.

## Preserved baseline and evidence

Engine 0.2.0 uses ridge 3, retention 0.75, home advantage 2.5, margin cap 28 and baseline probability scale 14. Frozen public calibration scales are 6.147406563247917 for FBS–FBS and 6.74434303402901 for FCS–FCS; FBS–FCS remains uncalibrated at scale 14. SOR does not carry these team historical priors. No polls, betting lines or third-party team ratings entered this replay.

All 22 original 2004–2025 raw CSV hashes and normalized team/game objects reproduced. All 22 historical-repair outputs and 12 FCS-supplement outputs matched their frozen release hashes. The committed 2025 prior reproduced within 1e-9. All 95 cached source files matched recorded hashes. The 674 added FBS games reproduce from their cached events, including teams, scores, orientation, completion, venue, season and date; 593 also have matching legacy archive scores. Those archives can share ESPN/CFBD upstream data, so that agreement establishes consistency rather than independent verification. The research restores no absent team nodes.

Independent exact-score fixture checks cover 252 original and 288 supplemented game identities. They cover 253 normal-season NCAA FCS tournament results, 11 non-pandemic SWAC titles, 10 Celebration Bowls, 13 Michigan 2024 results and one Northeastern 2009 result after supplementation. The retained NCAA/school evidence includes explicit score adjudications; these finite checks verify score/identity agreement, not every kickoff, venue, regular-season schedule or historical as-published availability. A zero verified count means no applicable independent fixture was checked.

The compressed releases remain immutable: historical SHA256 00757b0602c79df47fa9ed2b7b3c523ee28f56683650841bca1d5a6dcc74fc39; FCS SHA256 5b493c3e3ec9e13b4f52670daf22d012912093810b377ed54d444f5c0b3aa699. Full per-file hashes, source URLs, source retrieval timestamps when retained, and all checks are in [audit.metadata.json](../research/results/historical-foundation-v1/audit.metadata.json) and [audit.json.gz](../research/results/historical-foundation-v1/audit.json.gz). Original source files were read directly from the existing sibling cache and hashed again after replay; no originals were copied over or changed.

## Per-season coverage

Counts include all source divisions in the retained graph. “Completed” means a completed game row, not a claim of complete coverage. Labeled postseason follows the provider; FCS tournaments often appear under regular-season labels. Original 2004–2022 archives have zero provider-labeled postseason rows. FBS repairs recover 674 games; eight original duplicate occurrences are removed. The distinct FCS supplement adds 34 games and corrects three absolute scores without changing winners. Every other original game field and every roster are preserved.

| Season | Recorded / completed original | Completed FBS repair / with FCS supplement | Independent scores original / supplemented | Added FBS postseason | Added FCS | Duplicates removed | Labeled postseason original / FBS repair | FCS source differences |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2004 | 693 / 693 | 714 / 714 | 0 / 0 | 28 | 0 | 7 | 0 / 28 | 0 |
| 2005 | 690 / 690 | 718 / 718 | 0 / 0 | 28 | 0 | 0 | 0 / 28 | 0 |
| 2006 | 760 / 760 | 792 / 792 | 0 / 0 | 32 | 0 | 0 | 0 / 32 | 0 |
| 2007 | 766 / 766 | 798 / 798 | 0 / 0 | 32 | 0 | 0 | 0 / 32 | 0 |
| 2008 | 770 / 770 | 804 / 804 | 0 / 0 | 34 | 0 | 0 | 0 / 34 | 0 |
| 2009 | 774 / 774 | 808 / 808 | 1 / 1 | 34 | 0 | 0 | 0 / 34 | 0 |
| 2010 | 773 / 773 | 808 / 808 | 0 / 0 | 35 | 0 | 0 | 0 / 35 | 0 |
| 2011 | 777 / 777 | 812 / 812 | 0 / 0 | 35 | 0 | 0 | 0 / 35 | 0 |
| 2012 | 805 / 805 | 840 / 840 | 0 / 0 | 35 | 0 | 0 | 0 / 35 | 0 |
| 2013 | 813 / 813 | 848 / 848 | 0 / 0 | 35 | 0 | 0 | 0 / 35 | 0 |
| 2014 | 1542 / 1542 | 1581 / 1585 | 21 / 24 | 39 | 4 | 0 | 0 / 39 | 13 |
| 2015 | 1491 / 1491 | 1532 / 1536 | 21 / 25 | 41 | 4 | 0 | 0 / 41 | 11 |
| 2016 | 1502 / 1502 | 1543 / 1547 | 21 / 25 | 41 | 4 | 0 | 0 / 41 | 2 |
| 2017 | 1505 / 1505 | 1545 / 1549 | 21 / 25 | 40 | 4 | 0 | 0 / 40 | 2 |
| 2018 | 1511 / 1511 | 1550 / 1554 | 21 / 25 | 39 | 4 | 0 | 0 / 39 | 2 |
| 2019 | 1577 / 1577 | 1617 / 1621 | 21 / 25 | 40 | 4 | 0 | 0 / 40 | 7 |
| 2020 | 563 / 563 | 589 / 589 | 0 / 0 | 26 | 0 | 0 | 0 / 26 | 0 |
| 2021 | 2408 / 2408 | 2446 / 2452 | 19 / 25 | 38 | 6 | 0 | 0 / 38 | 1 |
| 2022 | 3657 / 3657 | 3699 / 3703 | 18 / 25 | 42 | 4 | 0 | 0 / 42 | 5 |
| 2023 | 3734 / 3724 | 3724 / 3724 | 25 / 25 | 0 | 0 | 0 | 139 / 139 | 23 |
| 2024 | 3801 / 3799 | 3799 / 3799 | 38 / 38 | 0 | 0 | 0 | 54 / 54 | 1 |
| 2025 | 3831 / 3829 | 3828 / 3828 | 25 / 25 | 0 | 0 | 1 | 86 / 86 | 3 |

Source discrepancy counts are the 70 FCS existing-record differences retained in the frozen manifest; three score cases have primary-source corrections, while other calendar/orientation/venue/date differences remain explicit. FBS added-game legacy score conflicts are zero after the repair's exclusions. Two extra 2013 provider IDs were excluded using explicit unique identity corroboration; they are separate from the eight original duplicate removals. The 2004 duplicate variants also contain venue ambiguity that identity removal does not resolve.

| Season | Missing original FBS postseason recovered | Missing original primary FCS categories | Primary score conflicts original | Still missing primary FCS after supplement | Other known missing results |
| --- | --- | --- | --- | --- | --- |
| 2004 | 28 | 0 | 0 | 0 | not fully enumerated |
| 2005 | 28 | 0 | 0 | 0 | not fully enumerated |
| 2006 | 32 | 0 | 0 | 0 | not fully enumerated |
| 2007 | 32 | 0 | 0 | 0 | not fully enumerated |
| 2008 | 34 | 0 | 0 | 0 | not fully enumerated |
| 2009 | 34 | 0 | 0 | 0 | 10 named Northeastern games; Hofstra count gap 10 overlaps |
| 2010 | 35 | 0 | 0 | 0 | not fully enumerated |
| 2011 | 35 | 0 | 0 | 0 | not fully enumerated |
| 2012 | 35 | 0 | 0 | 0 | not fully enumerated |
| 2013 | 35 | 0 | 0 | 0 | not fully enumerated |
| 2014 | 39 | 3 | 0 | 0 | not fully enumerated |
| 2015 | 41 | 4 | 0 | 0 | not fully enumerated |
| 2016 | 41 | 4 | 0 | 0 | not fully enumerated |
| 2017 | 40 | 4 | 0 | 0 | not fully enumerated |
| 2018 | 39 | 4 | 0 | 0 | not fully enumerated |
| 2019 | 40 | 4 | 0 | 0 | not fully enumerated |
| 2020 | 26 | 16 | 0 | 16 | 2 New Mexico State spring games |
| 2021 | 38 | 6 | 0 | 0 | not fully enumerated |
| 2022 | 42 | 4 | 3 | 0 | not fully enumerated |
| 2023 | 0 | 0 | 0 | 0 | not fully enumerated |
| 2024 | 0 | 0 | 0 | 0 | not fully enumerated |
| 2025 | 0 | 0 | 0 | 0 | not fully enumerated |

Exact total missing games is **unknown in every season**. Zero in a checked category does not certify the whole season. The CSV retains that distinction explicitly: [season-coverage.csv](../research/results/historical-foundation-v1/season-coverage.csv). The original primary FCS categories have 49 absent games and three score conflicts; supplementation resolves 33 absent category fixtures and those score conflicts, leaving the 15 spring-season-2020 NCAA games and its SWAC championship missing. One of the 34 FCS additions is outside those finite championship categories.

## Membership, pandemic boundaries and inactive programs

The original roster is built from schedule appearances rather than a complete membership registry. Every season's conference and subdivision fields are retained, but full independent classification/membership certification remains unfinished. Historical transition cases, including Florida A&M's 2004 source classification, remain source-designated rather than silently relabeled.

The 2020 roster omits UConn, Old Dominion and New Mexico State despite appearances in adjacent seasons. These are different cases: [UConn cancelled 2020–21 competition](https://uconnhuskies.com/news/2020/8/5/uconn-football-announces-cancellation-of-2020-season-due-to-risks-associated-with-covid-19), and [Old Dominion cancelled fall 2020 sports](https://odusports.com/news/2020/08/10/old-dominion-athletics-announces-cancellation-of-fall-sports-season). They do not justify invented played games. [New Mexico State's primary schedule](https://nmstatesports.com/schedule.aspx?path=football&season=2020-21) assigns its 17–43 loss to Tarleton on February 21, 2021 and 36–29 win over Dixie State on March 7 to postponed season 2020. Both are missing here because the parent roster omits the program. They are preserved as dated research exceptions with scores, without inventing provider IDs, kickoff times or venue flags. Spring 2021 season-2020 football must remain separate from fall season 2021.

Inactive-program incompleteness is measurable: the [Northeastern school history](https://nuhuskies.com/sports/2013/7/18/GEN_0718133257.aspx) and [CAA 2009 statistics](https://static.caasports.com/custompages/stats/FB/2009/nu.htm) list 11 results; this archive retains only its Boston College loss. Ten named games remain absent. [Hofstra's final-season announcement](https://gohofstra.com/news/2009/12/3/HOFSTRA_TO_END_INTERCOLLEGIATE_FOOTBALL_PROGRAM_TO_INVEST_IN_ACADEMIC_INITIATIVES.aspx) confirms a 5–6 record, while this archive has one game. The two count gaps overlap and are not summed as 20 unique missing games. Jacksonville has 12 2019 rows, but this was not independently certified as a full schedule here. No absence after a program closes is treated as evidence of a missing played season. All selected exceptions are retained in [primary-historical-exceptions-2026-11-18.json](../research/primary-historical-exceptions-2026-11-18.json).

## Forward-time comparison

The protocol was recorded before this new stratified run, **after earlier aggregate results and these seasons were already inspected**. No season here is an untouched holdout. The 2021–2022 seasons also helped select the original Strength settings; those seasons are sensitivity evidence rather than independent evaluation periods. No weights, probability coefficients or model settings were fitted or selected in this audit. Each source competition week freezes before its earliest kickoff. Only earlier processed-week results whose kickoff is at least 24 hours earlier enter a graph; prior-season results must satisfy the same chronology. Synthetic regressions check current-week outcomes, future outcomes, rescheduled games and invalid prior chronology. Historical corrections and roster metadata remain retrospective, so this is a leakage-guarded replay of retained data, not proof of actual historical forecast availability. Exactly 50% probabilities receive half a correct winner, and actual tied games are excluded.

Use the same original target identities and winners for each paired comparison. The historical repair contributes 80 additional evaluation targets and the FCS supplement 10 more; all 90 are retained separately in the artifact and excluded from the headline same-game comparison. Three winner-preserving FCS target-score corrections provide the same corrected margin to both forecasts for margin-error comparison. Conference slices use source season-specific memberships; a game counts once in each participating conference and slices overlap.

The following uses existing frozen division-specific calibration where supported. The FCS numbers use recursively rebuilt priors consistently across variants; they are not the public 3,293-game validation, which uses repaired target seasons with original saved priors. The same-support FCS comparison contains 3,283 original targets.

| Population (2021–2025) | Variant | Games | Winner accuracy | Brier | Log loss | Calibration error, 10 bins |
| --- | --- | --- | --- | --- | --- | --- |
| FBS-FBS | original | 3864 | 70.937% | 0.185856 | 0.549174 | 0.024717 |
| FBS-FBS | historical-coverage-v1 | 3864 | 70.963% | 0.185682 | 0.548720 | 0.025354 |
| FBS-FBS | fcs-coverage-v1 | 3864 | 70.937% | 0.185675 | 0.548716 | 0.025424 |
| FBS-FCS | original | 602 | 88.372% | 0.138591 | 0.454484 | 0.296493 |
| FBS-FCS | historical-coverage-v1 | 602 | 88.538% | 0.138560 | 0.454394 | 0.296445 |
| FBS-FCS | fcs-coverage-v1 | 602 | 88.538% | 0.138527 | 0.454317 | 0.296392 |
| FCS-FCS | original | 3283 | 70.652% | 0.185670 | 0.548054 | 0.027437 |
| FCS-FCS | historical-coverage-v1 | 3283 | 70.804% | 0.185678 | 0.548064 | 0.025388 |
| FCS-FCS | fcs-coverage-v1 | 3283 | 70.804% | 0.185672 | 0.548034 | 0.025427 |

The FBS–FCS calibration error remains about 0.296 despite high winner accuracy; the largely home-FBS schedule and sparse lower-division context prevent describing these as validated cross-division odds. FCS and FBS calibrations were fitted previously with their documented source/prior conventions. Applying their fixed scales here measures archive sensitivity, not a fresh calibration fit or independent validation.

| Season | FBS–FBS games | Accuracy original / FBS repair | Brier original / FBS repair | Log loss original / FBS repair |
| --- | --- | --- | --- | --- |
| 2021 | 732 | 71.585% / 71.311% | 0.184738 / 0.184000 | 0.550042 / 0.548200 |
| 2022 | 734 | 69.210% / 70.163% | 0.195499 / 0.195345 | 0.573854 / 0.573624 |
| 2023 | 792 | 72.096% / 71.717% | 0.180066 / 0.180054 | 0.536336 / 0.536041 |
| 2024 | 798 | 69.048% / 68.922% | 0.192075 / 0.192063 | 0.560854 / 0.560856 |
| 2025 | 808 | 72.649% / 72.649% | 0.177645 / 0.177642 | 0.527015 / 0.527009 |

All season/division/conference metrics are reproducible in [season-and-conference-metrics.csv](../research/results/historical-foundation-v1/season-and-conference-metrics.csv). All probability-bin counts, mean home probabilities and observed home win rates are in [probability-reliability.csv](../research/results/historical-foundation-v1/probability-reliability.csv). Small conference samples are not independent validation cohorts.

The earlier 2023–2025 comparison reproduces exactly on 2,398 FBS–FBS games: baseline scale-14 Brier 0.197123 → 0.197075, log loss 0.581152 → 0.581035, accuracy 71.268% → 71.101%. Under frozen FBS calibration, Brier is 0.183246 → 0.183238 and log loss 0.541354 → 0.541256. Calibration error worsens 0.031614 → 0.034772. The different directions do not support a blanket accuracy-improvement claim.

## Uncertainty and history sensitivity

| Variant minus original | Population | Δ accuracy | Δ Brier (95% sensitivity) | Δ log loss (95% sensitivity) |
| --- | --- | --- | --- | --- |
| historical-coverage-v1 | FBS-FBS | 0.000259 [-0.003082, 0.003899] | -0.000174 [-0.000496, 0.000120] | -0.000454 [-0.001222, 0.000234] |
| historical-coverage-v1 | FBS-FCS | 0.001661 [0.000000, 0.005495] | -0.000032 [-0.000265, 0.000198] | -0.000089 [-0.000619, 0.000434] |
| historical-coverage-v1 | FCS-FCS | 0.001523 [0.000000, 0.003153] | 0.000009 [-0.000034, 0.000049] | 0.000010 [-0.000090, 0.000107] |
| fcs-coverage-v1 | FBS-FBS | 0.000000 [-0.003338, 0.003689] | -0.000181 [-0.000505, 0.000116] | -0.000458 [-0.001221, 0.000239] |
| fcs-coverage-v1 | FBS-FCS | 0.001661 [0.000000, 0.005495] | -0.000064 [-0.000295, 0.000162] | -0.000167 [-0.000684, 0.000364] |
| fcs-coverage-v1 | FCS-FCS | 0.001523 [-0.000295, 0.003413] | 0.000002 [-0.000075, 0.000083] | -0.000020 [-0.000198, 0.000164] |

Intervals are 2,000 seeded paired season/week-block resamples. Negative loss deltas are better; positive accuracy deltas are better. Blocks share teams and the data were examined before this protocol. These are sensitivity intervals, not calibrated prospective significance tests. Tiny duplicate-only loss changes are about 1e-8 on the prior 2023–2025 comparison and do not justify an accuracy claim.

Starting the same original archive at 2014 instead of 2004 gives FBS–FBS calibrated Brier 0.185866 versus 0.185856 over 2021–2025. The 2004 initialization is slightly better on probability loss while the truncated run wins one more game. The effects are tiny and no history window was selected. This bounded truncation experiment cannot establish that pre-2004 or nineteenth-century records help.

The separately reproduced current-snapshot sensitivity changes FBS Predictive Strength by at most 0.005245471 points. UCLA/Arizona exchange 19/18 and Baylor/Penn State exchange 27/28; Top 25 membership stays the same. This is the exact November 18 snapshot a36df50d7f94c050e03b2d5df03cba802067d8dd2a1732f715a3ea3cc57dc4c1. No saved publication was replaced, and this calculation does not alter current SOR.

## Deeper-history decision

[CFBD's current data-availability documentation](https://api.collegefootballdata.com/data-availability) lists games from 1869 with 1871 unavailable, AP from 1936, plays/Coaches Poll from 2001, box scores/rosters from 2004 and CFP from 2014. It explicitly warns that supported ranges do not guarantee every team, game or field, and historical records may be corrected later. Year-aware affiliations are available, but no pre-2004 source records were ingested or independently audited in this run. No claim of pre-2004 predictive value is justified.

Comparability must be era-specific. The [NCAA rules history](https://s3.amazonaws.com/fs.ncaa.org/Docs/stats/football_records/FBS.pdf) documents the 1906 forward-pass change and scoring-system changes; [NCAA overtime history](https://www.ncaa.com/news/football/2025-01-01/how-college-football-overtime-works) distinguishes pre-1996 ties and later overtime formats. Division and conference structures also changed. These facts make unadjusted pooling scientifically unsound. If further research is authorized, a small 2001–2003 game/affiliation pilot with independent school/NCAA checks is the closest comparable period; freeze its protocol before examination and evaluate genuinely new future evidence. Older records may remain reference material. No mass import, new historical public page or production initialization change was performed.

## Verification, recovery and remaining limits

- 59 relevant Node tests passed, including 11 new research checks; zero failures/skips. Existing engine, logical-duplicate, ranking-history, SOR and division research tests were included. The broader release test result is reported by the main stabilization work.
- The new audit and the earlier lineage reproducer both passed offline, including raw normalization, source-event reconstruction, complete original-game preservation apart from listed changes, release checksums, saved FBS validation reproduction within 1e-12 and prior reproduction within 1e-9.
- All 135 existing Python research/model tests passed with zero failures, errors or skips after obtaining official portable CPython 3.13.9 and pinned NumPy 2.3.5. Byte-identical shipping Python modules ran in a private scratch mirror, with explicit junctions to the exact existing archive and current shipping JavaScript/publications; no test or ROOT constant was modified. Network connections were blocked and protected input hashes stayed unchanged. See [Python validation evidence](../research/results/historical-foundation-v1/python-validation.json) and the [runtime and path-override explanation](historical-python-validation-2026-11-18.md).
- Production model/input/prior hashes were unchanged during the audit. Frozen original and research versions remain recoverable separately. Rollback needs no numerical deployment because this work made none; use the originals and existing prior. Compact repair releases reconstruct their exact outputs only with matching parent hashes and fail closed on mismatches.
- Full regular-season completeness, complete historical classification/conference membership, inactive-program universes, ambiguous dates/venues and true historical publication availability remain unverified. Exact missing totals stay unknown. Independent future evidence remains required before a material promotion.
- There were zero CFBD API calls, no provider import, no paid services, no added scheduled job and no change to Render/Supabase/GitHub Actions resources. Public primary websites were read for the bounded exceptions and era review.

Reproduce from the repository using existing exact caches (this machine's sibling path is shown):

```powershell
node --test --test-reporter=tap research/historical_foundation.test.js test/engine.test.js test/data-quality.test.js test/ranking-history.test.js research/lib/sor_candidate.test.mjs research/lib/division_candidate.test.mjs
node research/historical_foundation.mjs --data-dir ../fbs-ranking-engine/data --repaired-dir ../fbs-ranking-engine/research/datasets/historical-coverage-v1/seasons --fcs-dir ../fbs-ranking-engine/research/datasets/fcs-coverage-v1/seasons --cache-dir ../fbs-ranking-engine/research/cache
node research/audit_historical_lineage.mjs --data-dir ../fbs-ranking-engine/data --repaired-dir ../fbs-ranking-engine/research/datasets/historical-coverage-v1/seasons > research/results/historical-foundation-v1/lineage-sensitivity.json
node research/report_historical_foundation.mjs
```

The script accepts different cache paths, rejects checksum mismatches and writes only under research/results. A fresh clone without exact ignored caches cannot reproduce by itself; source hashes/URLs and compact supplements are retained rather than claiming self-contained historical ground truth. AP/CFP historical edition recovery and pregame ranking coverage are reported separately by the poll audit and are not model inputs here.
