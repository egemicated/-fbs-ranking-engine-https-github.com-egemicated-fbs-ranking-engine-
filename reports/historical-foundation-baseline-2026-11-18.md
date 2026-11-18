# Historical foundation baseline, November 18, 2026

Recorded before implementation changes for Phases 2–4. The worktree was clean.
The production engine is version 0.2.0; committed `data/model.json` specifies
ridge 3, retention 0.75, home advantage 2.5, margin cap 28 and probability
scale 14. Public probability calibration is separate from that baseline link.

The worktree omits ignored raw seasons and research caches. Exact cached
2004–2025 originals and repaired seasons were found in the sibling
`../fbs-ranking-engine` workspace. All 22 original and all 22 repaired file
checksums matched the frozen historical-coverage-v1 release before any edits.
The release SHA256 is
`00757b0602c79df47fa9ed2b7b3c523ee28f56683650841bca1d5a6dcc74fc39`.
It records 674 added FBS postseason results and eight explicit duplicate
removals. The production original files and prior remain unchanged.

Existing completed work includes an offline original/repaired FBS comparison,
primary-source duplicate adjudications, the separate 34-game/three-score FCS
supplement, and finite NCAA FCS tournament checks. Repeating provider imports
is unnecessary. Existing reports correctly describe mixed tiny effects and
retain the production model. Previously inspected evaluation seasons cannot
be called an untouched holdout.

Confirmed evidence/reporting gaps are a missing consolidated per-season
coverage ledger, no consolidated conference and cross-division comparison
under identical fixed settings, and limited uncertainty/calibration reporting
for the archive-only comparison. Agreement between SportsDataverse, cfbfastR
and ESPN is consistency evidence; these can share upstream data and cannot
be counted as independent verification of every result.

Unresolved data limitations include omitted 2020 programs, sparse spring-2020
FCS context, historical classification/conference certification, inactive
program coverage, venue/date discrepancies and incomplete lower-division
regular-season coverage. Exact total missing games is unknown until a full
independent season universe is available. Provider-labeled postseason counts
are not equivalent to FCS tournament completeness.

Node 24.14.1 is available. The Windows Python launcher reports no installed
Python and WSL is unavailable, so the existing Python research suite is
currently unverified in this environment. Relevant Node reproduction and
regression checks will be recorded in the final research report. No historical
data, model, ranking or public page change is authorized by this audit alone.
