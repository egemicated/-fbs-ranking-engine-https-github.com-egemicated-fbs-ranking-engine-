# FBS Intelligence validation audit

## Coverage

The 2004–2025 production archive contains 34,729 modeled game records. It includes 15,495 FBS–FBS games, 2,139 FBS–FCS games, and 7,056 FCS–FCS games. There are 421 records involving an unclassified team, including 12 direct FBS records. That count includes both occurrences of one duplicated matchup. The archive derives memberships from the available schedules and cannot establish coverage of teams absent from those schedules.

The 2004–2013 files contain zero FCS–FCS games. The 2020 file contains 15. The NCAA lists FCS championship games missing from the archive in 2013 and 2019–2022. The spring championship belongs to the 2020 season even though it was played in May 2021. [NCAA championship history](https://www.ncaa.com/history/football/fcs) · [2020 bracket](https://www.ncaa.com/brackets/print/football/fcs/2020)

A separate research release recovered 674 FBS postseason games from 2004–2022 and removed eight duplicate groups. The live historical inputs still use the original archive. [Historical coverage release](../research/REPAIRS-README.txt) · [FCS coverage release](../research/FCS-COVERAGE-README.txt)

The November 5, 2026 Mountain Time snapshot contains 2,842 modeled records, including 505 FBS–FBS games, 122 FBS–FCS games, and 467 FCS–FCS games. Every direct FBS opponent is classified. There are 48 teams with an unknown subdivision, 46 of which appear in 95 modeled games. Those 95 records can influence the FBS network indirectly. As a sensitivity test, omitting all 95 changed 14 ranks and preserved Top 25 membership. Official SOR requires every completed direct FBS opponent to be classified as FBS or FCS.

Four confirmed canceled lower-division slots in that snapshot are present as scoreless ties. Removing them in a replay changed zero FBS ranks. The weekly importer now checks and excludes those exact canceled slots. Four other entries with invalid or incomplete final scores were excluded from the original snapshot. [Cancellation rules and sources](../src/data-quality.js)

## Matchup validation

Win odds use the existing opponent-adjusted Strength margin and a logistic scale fitted to 4,367 FBS–FBS games from 2014–2019. The probability replay holds out each target week and uses a 24-hour kickoff buffer for prior results. The test uses corrected archives, so the dates approximate when results would have been available.

Across 2,398 games from 2023–2025 held out from the original Strength selection, the new scale improved Brier score from 0.1971 to 0.1832 and log loss from 0.5812 to 0.5414. Lower is better for both scores. The same teams were favored. Both scores improved in each of the three years. The extended 2021–2025 replay includes years used to select the underlying Strength settings. [Exact parameters and results](../data/matchup-validation.json) · [Calibration replay](../research/strength-probability-calibration.mjs)

The final-margin range uses the rounded-up 80th percentile of absolute error from 573 matchups in 2023. With at least four earlier games for both teams, the resulting 22-point half-width covered 963 of 1,158 finals in 2024–2025 (83.2%). This is pooled retrospective coverage. Confidence intervals for team ranks and individual win probabilities remain unvalidated. [Margin replay](../research/strength_margin_interval_experiment.mjs)

## Performance

The November 5 snapshot joined provider-covered play stats for all 627 eligible FBS-involving games and all 467 eligible FCS–FCS context games. These are within-snapshot joins. The original historical FBS–FCS next-game test had 2.30 percentage points of bias against a 2-point target. The separate current candidate passed its own retrospective selection checks. Performance remains an experimental descriptive model. [Performance display validation](../research/results/performance-display/3121ef979307/REPORT.txt)
