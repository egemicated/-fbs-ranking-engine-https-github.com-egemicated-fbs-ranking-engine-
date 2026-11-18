// Render retained research evidence; no provider fetch or production artifact write.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..'), directory = join(root, 'research/results/historical-foundation-v1');
const raw = await readFile(join(directory, 'audit.json.gz'));
const meta = JSON.parse(await readFile(join(directory, 'audit.metadata.json')));
assert.equal(createHash('sha256').update(raw).digest('hex'), meta.compressedSha256);
const expanded = gunzipSync(raw);
assert.equal(createHash('sha256').update(expanded).digest('hex'), meta.uncompressedSha256);
const a = JSON.parse(expanded);
let pythonValidation;
try { pythonValidation = JSON.parse(await readFile(join(directory, 'python-validation.json'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (pythonValidation) {
  assert.equal(pythonValidation.failures + pythonValidation.errors + pythonValidation.skipped, 0);
  assert.equal(pythonValidation.protectedInputsUnchanged, true);
  assert.equal(createHash('sha256').update(await readFile(join(directory, 'python-all-tests.txt'))).digest('hex'), pythonValidation.testOutputSha256);
}
const pythonStatus = pythonValidation ? `All ${pythonValidation.testsRun} existing Python research/model tests passed with zero failures, errors or skips after obtaining official portable CPython 3.13.9 and pinned NumPy 2.3.5. Byte-identical shipping Python modules ran in a private scratch mirror, with explicit junctions to the exact existing archive and current shipping JavaScript/publications; no test or ROOT constant was modified. Network connections were blocked and protected input hashes stayed unchanged. See [Python validation evidence](../research/results/historical-foundation-v1/python-validation.json) and the [runtime and path-override explanation](historical-python-validation-2026-11-18.md).` :
  'Existing Python research tests are **unverified** here: the Windows launcher finds no installed Python and WSL is absent. This is not represented as a passing Python suite. The Node safeguards do not replace every older Python experiment.';
const lineage = JSON.parse(await readFile(join(directory, 'lineage-sensitivity.json')));
const f = value => value == null ? 'unavailable' : value.toFixed(6);
const percent = value => value == null ? 'unavailable' : (value * 100).toFixed(3) + '%';
const interval = value => '[' + value.map(number => number.toFixed(6)).join(', ') + ']';
const table = (headers, rows) => [headers.join(' | '), headers.map(() => '---').join(' | '), ...rows.map(row => row.join(' | '))].map(line => '| ' + line + ' |').join('\n');
const csv = value => /[",\n]/.test(String(value)) ? '"' + String(value).replaceAll('"', '""') + '"' : value;
const metricFields = ['games', 'accuracy', 'brier', 'logLoss', 'marginMAE', 'calibrationError10Bins', 'meanProbabilityError'];
const metricRows = [], calibrationRows = [];
for (const [variant, comparison] of Object.entries(a.comparison)) {
  for (const [scope, source] of [['season', comparison.bySeason], ['conference', comparison.byConference]]) {
    for (const [key, divisions] of Object.entries(source)) for (const [division, mappings] of Object.entries(divisions)) {
      for (const [mapping, results] of Object.entries(mappings)) {
        if (!results.original.games) continue;
        metricRows.push([variant, scope, key, division, mapping, ...metricFields.map(field => results.original[field]), ...metricFields.map(field => results.candidate[field])]);
      }
    }
  }
  for (const [division, mappings] of Object.entries(comparison.byDivision)) for (const [mapping, results] of Object.entries(mappings)) {
    for (const [dataset, result] of [['original', results.original], ['candidate', results.candidate]]) for (const bin of result.reliability) {
      calibrationRows.push([variant, division, mapping, dataset, bin.lower, bin.upper, bin.games, bin.meanProbability, bin.actualHomeWinRate]);
    }
  }
}
await writeFile(join(directory, 'season-and-conference-metrics.csv'), [['variant', 'scope', 'key', 'population', 'mapping', ...metricFields.map(field => 'original_' + field), ...metricFields.map(field => 'candidate_' + field)], ...metricRows].map(row => row.map(csv).join(',')).join('\n') + '\n');
await writeFile(join(directory, 'probability-reliability.csv'), [['variant', 'population', 'mapping', 'dataset', 'binLower', 'binUpper', 'games', 'meanHomeProbability', 'actualHomeWinRate'], ...calibrationRows].map(row => row.map(csv).join(',')).join('\n') + '\n');
const total = fn => a.coverage.reduce((sum, row) => sum + fn(row), 0);
const coverageTable = table(['Season', 'Recorded / completed original', 'Completed FBS repair / with FCS supplement', 'Independent scores original / supplemented', 'Added FBS postseason', 'Added FCS', 'Duplicates removed', 'Labeled postseason original / FBS repair', 'FCS source differences'], a.coverage.map(row => [row.year,
  `${row.original.recorded} / ${row.original.completed}`, `${row.historicalRepaired.completed} / ${row.fcsSupplemented.completed}`,
  `${row.independentVerification.original.independentExactScoreGames} / ${row.independentVerification['fcs-coverage-v1'].independentExactScoreGames}`,
  row.addedFbsPostseason, row.addedFcsGames, row.removedDuplicateOccurrences, `${row.original.providerLabeledPostseason} / ${row.historicalRepaired.providerLabeledPostseason}`, row.sourceDiscrepancies.fcsExistingConflicts.length]));
const modelTable = table(['Population (2021–2025)', 'Variant', 'Games', 'Winner accuracy', 'Brier', 'Log loss', 'Calibration error, 10 bins'], ['FBS-FBS', 'FBS-FCS', 'FCS-FCS'].flatMap(division => ['original', 'historical-coverage-v1', 'fcs-coverage-v1'].map(variant => {
  const row = a.comparison[variant].byDivision[division].frozenCalibrated.candidate;
  return [division, variant, row.games, percent(row.accuracy), f(row.brier), f(row.logLoss), f(row.calibrationError10Bins)];
})));
const uncertaintyTable = table(['Variant minus original', 'Population', 'Δ accuracy', 'Δ Brier (95% sensitivity)', 'Δ log loss (95% sensitivity)'], ['historical-coverage-v1', 'fcs-coverage-v1'].flatMap(variant => ['FBS-FBS', 'FBS-FCS', 'FCS-FCS'].map(division => {
  const delta = a.comparison[variant].byDivision[division].frozenCalibrated.pairedSensitivity.candidateMinusOriginal;
  return [variant, division, `${f(delta.accuracy.difference)} ${interval(delta.accuracy.sensitivity95)}`, `${f(delta.brier.difference)} ${interval(delta.brier.sensitivity95)}`, `${f(delta.logLoss.difference)} ${interval(delta.logLoss.sensitivity95)}`];
})));
const seasonTable = table(['Season', 'FBS–FBS games', 'Accuracy original / FBS repair', 'Brier original / FBS repair', 'Log loss original / FBS repair'], a.protocol.evaluationSeasons.map(year => {
  const results = a.comparison['historical-coverage-v1'].bySeason[year]['FBS-FBS'].frozenCalibrated;
  return [year, results.original.games, `${percent(results.original.accuracy)} / ${percent(results.candidate.accuracy)}`, `${f(results.original.brier)} / ${f(results.candidate.brier)}`, `${f(results.original.logLoss)} / ${f(results.candidate.logLoss)}`];
}));
const missingTable = table(['Season', 'Missing original FBS postseason recovered', 'Missing original primary FCS categories', 'Primary score conflicts original', 'Still missing primary FCS after supplement', 'Other known missing results'], a.coverage.map(row => [row.year, row.addedFbsPostseason,
  row.independentVerification.original.knownCategoryMissing, row.independentVerification.original.primaryScoreConflicts,
  row.independentVerification['fcs-coverage-v1'].knownCategoryMissing,
  row.year === 2009 ? '10 named Northeastern games; Hofstra count gap 10 overlaps' : row.year === 2020 ? '2 New Mexico State spring games' : 'not fully enumerated']));
const old = a.comparison['historical-coverage-v1'].previousFbsComparison2023to2025;
const compact = Object.fromEntries(Object.entries(a.comparison).map(([variant, comparison]) => [variant, {
  ownTargetGames: comparison.ownTargetGames, additionalTargets: comparison.candidateOnlyTargets.length,
  divisionMetrics: Object.fromEntries(Object.entries(comparison.byDivision).map(([division, mappings]) => [division,
    Object.fromEntries(Object.entries(mappings).map(([mapping, scores]) => [mapping, { original: Object.fromEntries(metricFields.map(key => [key, scores.original[key]])),
      candidate: Object.fromEntries(metricFields.map(key => [key, scores.candidate[key]])), pairedSensitivity: scores.pairedSensitivity }]))])) }]));
await writeFile(join(directory, 'summary.json'), JSON.stringify({ protocol: a.protocol, config: a.config, scales: a.scales, comparison: compact,
  allSeasonMissingTotal: null, currentSensitivity: lineage.currentScenario, productionChanges: false, cfbdCalls: 0 }, null, 2) + '\n');
const document = `# Historical foundation and fixed-model validation, November 18, 2026

The frozen corrections are reproducible and the predictive differences remain mixed and small. Keep the production prior and model unchanged. This audit does not certify complete historical schedules or earn model promotion. It adds an explicit coverage ledger, stratified validation, source checks and regression safeguards; it makes no public website or numerical production change.

## Preserved baseline and evidence

Engine 0.2.0 uses ridge 3, retention 0.75, home advantage 2.5, margin cap 28 and baseline probability scale 14. Frozen public calibration scales are ${a.scales['FBS-FBS']} for FBS–FBS and ${a.scales['FCS-FCS']} for FCS–FCS; FBS–FCS remains uncalibrated at scale 14. SOR does not carry these team historical priors. No polls, betting lines or third-party team ratings entered this replay.

All 22 original 2004–2025 raw CSV hashes and normalized team/game objects reproduced. All 22 historical-repair outputs and 12 FCS-supplement outputs matched their frozen release hashes. The committed 2025 prior reproduced within 1e-9. All 95 cached source files matched recorded hashes. The 674 added FBS games reproduce from their cached events, including teams, scores, orientation, completion, venue, season and date; 593 also have matching legacy archive scores. Those archives can share ESPN/CFBD upstream data, so that agreement establishes consistency rather than independent verification. The research restores no absent team nodes.

Independent exact-score fixture checks cover ${total(row => row.independentVerification.original.independentExactScoreGames)} original and ${total(row => row.independentVerification['fcs-coverage-v1'].independentExactScoreGames)} supplemented game identities. They cover 253 normal-season NCAA FCS tournament results, 11 non-pandemic SWAC titles, 10 Celebration Bowls, 13 Michigan 2024 results and one Northeastern 2009 result after supplementation. The retained NCAA/school evidence includes explicit score adjudications; these finite checks verify score/identity agreement, not every kickoff, venue, regular-season schedule or historical as-published availability. A zero verified count means no applicable independent fixture was checked.

The compressed releases remain immutable: historical SHA256 ${a.releaseChecksums.historical}; FCS SHA256 ${a.releaseChecksums.fcs}. Full per-file hashes, source URLs, source retrieval timestamps when retained, and all checks are in [audit.metadata.json](../research/results/historical-foundation-v1/audit.metadata.json) and [audit.json.gz](../research/results/historical-foundation-v1/audit.json.gz). Original source files were read directly from the existing sibling cache and hashed again after replay; no originals were copied over or changed.

## Per-season coverage

Counts include all source divisions in the retained graph. “Completed” means a completed game row, not a claim of complete coverage. Labeled postseason follows the provider; FCS tournaments often appear under regular-season labels. Original 2004–2022 archives have zero provider-labeled postseason rows. FBS repairs recover 674 games; eight original duplicate occurrences are removed. The distinct FCS supplement adds 34 games and corrects three absolute scores without changing winners. Every other original game field and every roster are preserved.

${coverageTable}

Source discrepancy counts are the 70 FCS existing-record differences retained in the frozen manifest; three score cases have primary-source corrections, while other calendar/orientation/venue/date differences remain explicit. FBS added-game legacy score conflicts are zero after the repair's exclusions. Two extra 2013 provider IDs were excluded using explicit unique identity corroboration; they are separate from the eight original duplicate removals. The 2004 duplicate variants also contain venue ambiguity that identity removal does not resolve.

${missingTable}

Exact total missing games is **unknown in every season**. Zero in a checked category does not certify the whole season. The CSV retains that distinction explicitly: [season-coverage.csv](../research/results/historical-foundation-v1/season-coverage.csv). The original primary FCS categories have 49 absent games and three score conflicts; supplementation resolves 33 absent category fixtures and those score conflicts, leaving the 15 spring-season-2020 NCAA games and its SWAC championship missing. One of the 34 FCS additions is outside those finite championship categories.

## Membership, pandemic boundaries and inactive programs

The original roster is built from schedule appearances rather than a complete membership registry. Every season's conference and subdivision fields are retained, but full independent classification/membership certification remains unfinished. Historical transition cases, including Florida A&M's 2004 source classification, remain source-designated rather than silently relabeled.

The 2020 roster omits UConn, Old Dominion and New Mexico State despite appearances in adjacent seasons. These are different cases: [UConn cancelled 2020–21 competition](https://uconnhuskies.com/news/2020/8/5/uconn-football-announces-cancellation-of-2020-season-due-to-risks-associated-with-covid-19), and [Old Dominion cancelled fall 2020 sports](https://odusports.com/news/2020/08/10/old-dominion-athletics-announces-cancellation-of-fall-sports-season). They do not justify invented played games. [New Mexico State's primary schedule](https://nmstatesports.com/schedule.aspx?path=football&season=2020-21) assigns its 17–43 loss to Tarleton on February 21, 2021 and 36–29 win over Dixie State on March 7 to postponed season 2020. Both are missing here because the parent roster omits the program. They are preserved as dated research exceptions with scores, without inventing provider IDs, kickoff times or venue flags. Spring 2021 season-2020 football must remain separate from fall season 2021.

Inactive-program incompleteness is measurable: the [Northeastern school history](https://nuhuskies.com/sports/2013/7/18/GEN_0718133257.aspx) and [CAA 2009 statistics](https://static.caasports.com/custompages/stats/FB/2009/nu.htm) list 11 results; this archive retains only its Boston College loss. Ten named games remain absent. [Hofstra's final-season announcement](https://gohofstra.com/news/2009/12/3/HOFSTRA_TO_END_INTERCOLLEGIATE_FOOTBALL_PROGRAM_TO_INVEST_IN_ACADEMIC_INITIATIVES.aspx) confirms a 5–6 record, while this archive has one game. The two count gaps overlap and are not summed as 20 unique missing games. Jacksonville has 12 2019 rows, but this was not independently certified as a full schedule here. No absence after a program closes is treated as evidence of a missing played season. All selected exceptions are retained in [primary-historical-exceptions-2026-11-18.json](../research/primary-historical-exceptions-2026-11-18.json).

## Forward-time comparison

The protocol was recorded before this new stratified run, **after earlier aggregate results and these seasons were already inspected**. No season here is an untouched holdout. The 2021–2022 seasons also helped select the original Strength settings; those seasons are sensitivity evidence rather than independent evaluation periods. No weights, probability coefficients or model settings were fitted or selected in this audit. Each source competition week freezes before its earliest kickoff. Only earlier processed-week results whose kickoff is at least 24 hours earlier enter a graph; prior-season results must satisfy the same chronology. Synthetic regressions check current-week outcomes, future outcomes, rescheduled games and invalid prior chronology. Historical corrections and roster metadata remain retrospective, so this is a leakage-guarded replay of retained data, not proof of actual historical forecast availability. Exactly 50% probabilities receive half a correct winner, and actual tied games are excluded.

Use the same original target identities and winners for each paired comparison. The historical repair contributes 80 additional evaluation targets and the FCS supplement 10 more; all 90 are retained separately in the artifact and excluded from the headline same-game comparison. Three winner-preserving FCS target-score corrections provide the same corrected margin to both forecasts for margin-error comparison. Conference slices use source season-specific memberships; a game counts once in each participating conference and slices overlap.

The following uses existing frozen division-specific calibration where supported. The FCS numbers use recursively rebuilt priors consistently across variants; they are not the public 3,293-game validation, which uses repaired target seasons with original saved priors. The same-support FCS comparison contains 3,283 original targets.

${modelTable}

The FBS–FCS calibration error remains about 0.296 despite high winner accuracy; the largely home-FBS schedule and sparse lower-division context prevent describing these as validated cross-division odds. FCS and FBS calibrations were fitted previously with their documented source/prior conventions. Applying their fixed scales here measures archive sensitivity, not a fresh calibration fit or independent validation.

${seasonTable}

All season/division/conference metrics are reproducible in [season-and-conference-metrics.csv](../research/results/historical-foundation-v1/season-and-conference-metrics.csv). All probability-bin counts, mean home probabilities and observed home win rates are in [probability-reliability.csv](../research/results/historical-foundation-v1/probability-reliability.csv). Small conference samples are not independent validation cohorts.

The earlier 2023–2025 comparison reproduces exactly on 2,398 FBS–FBS games: baseline scale-14 Brier ${f(old.baselineScale14.original.brier)} → ${f(old.baselineScale14.candidate.brier)}, log loss ${f(old.baselineScale14.original.logLoss)} → ${f(old.baselineScale14.candidate.logLoss)}, accuracy ${percent(old.baselineScale14.original.accuracy)} → ${percent(old.baselineScale14.candidate.accuracy)}. Under frozen FBS calibration, Brier is ${f(old.frozenCalibrated.original.brier)} → ${f(old.frozenCalibrated.candidate.brier)} and log loss ${f(old.frozenCalibrated.original.logLoss)} → ${f(old.frozenCalibrated.candidate.logLoss)}. Calibration error worsens ${f(old.frozenCalibrated.original.calibrationError10Bins)} → ${f(old.frozenCalibrated.candidate.calibrationError10Bins)}. The different directions do not support a blanket accuracy-improvement claim.

## Uncertainty and history sensitivity

${uncertaintyTable}

Intervals are 2,000 seeded paired season/week-block resamples. Negative loss deltas are better; positive accuracy deltas are better. Blocks share teams and the data were examined before this protocol. These are sensitivity intervals, not calibrated prospective significance tests. Tiny duplicate-only loss changes are about 1e-8 on the prior 2023–2025 comparison and do not justify an accuracy claim.

Starting the same original archive at 2014 instead of 2004 gives FBS–FBS calibrated Brier ${f(a.comparison['original-start-2014'].byDivision['FBS-FBS'].frozenCalibrated.candidate.brier)} versus ${f(a.comparison.original.byDivision['FBS-FBS'].frozenCalibrated.original.brier)} over 2021–2025. The 2004 initialization is slightly better on probability loss while the truncated run wins one more game. The effects are tiny and no history window was selected. This bounded truncation experiment cannot establish that pre-2004 or nineteenth-century records help.

The separately reproduced current-snapshot sensitivity changes FBS Predictive Strength by at most ${lineage.currentScenario.maximumFbsStrengthChange.toFixed(9)} points. UCLA/Arizona exchange 19/18 and Baylor/Penn State exchange 27/28; Top 25 membership stays the same. This is the exact November 18 snapshot ${lineage.currentScenario.snapshotHash}. No saved publication was replaced, and this calculation does not alter current SOR.

## Deeper-history decision

[CFBD's current data-availability documentation](https://api.collegefootballdata.com/data-availability) lists games from 1869 with 1871 unavailable, AP from 1936, plays/Coaches Poll from 2001, box scores/rosters from 2004 and CFP from 2014. It explicitly warns that supported ranges do not guarantee every team, game or field, and historical records may be corrected later. Year-aware affiliations are available, but no pre-2004 source records were ingested or independently audited in this run. No claim of pre-2004 predictive value is justified.

Comparability must be era-specific. The [NCAA rules history](https://s3.amazonaws.com/fs.ncaa.org/Docs/stats/football_records/FBS.pdf) documents the 1906 forward-pass change and scoring-system changes; [NCAA overtime history](https://www.ncaa.com/news/football/2025-01-01/how-college-football-overtime-works) distinguishes pre-1996 ties and later overtime formats. Division and conference structures also changed. These facts make unadjusted pooling scientifically unsound. If further research is authorized, a small 2001–2003 game/affiliation pilot with independent school/NCAA checks is the closest comparable period; freeze its protocol before examination and evaluate genuinely new future evidence. Older records may remain reference material. No mass import, new historical public page or production initialization change was performed.

## Verification, recovery and remaining limits

- 59 relevant Node tests passed, including 11 new research checks; zero failures/skips. Existing engine, logical-duplicate, ranking-history, SOR and division research tests were included. The broader release test result is reported by the main stabilization work.
- The new audit and the earlier lineage reproducer both passed offline, including raw normalization, source-event reconstruction, complete original-game preservation apart from listed changes, release checksums, saved FBS validation reproduction within 1e-12 and prior reproduction within 1e-9.
- ${pythonStatus}
- Production model/input/prior hashes were unchanged during the audit. Frozen original and research versions remain recoverable separately. Rollback needs no numerical deployment because this work made none; use the originals and existing prior. Compact repair releases reconstruct their exact outputs only with matching parent hashes and fail closed on mismatches.
- Full regular-season completeness, complete historical classification/conference membership, inactive-program universes, ambiguous dates/venues and true historical publication availability remain unverified. Exact missing totals stay unknown. Independent future evidence remains required before a material promotion.
- There were zero CFBD API calls, no provider import, no paid services, no added scheduled job and no change to Render/Supabase/GitHub Actions resources. Public primary websites were read for the bounded exceptions and era review.

Reproduce from the repository using existing exact caches (this machine's sibling path is shown):

\`\`\`powershell
node --test --test-reporter=tap research/historical_foundation.test.js test/engine.test.js test/data-quality.test.js test/ranking-history.test.js research/lib/sor_candidate.test.mjs research/lib/division_candidate.test.mjs
node research/historical_foundation.mjs --data-dir ../fbs-ranking-engine/data --repaired-dir ../fbs-ranking-engine/research/datasets/historical-coverage-v1/seasons --fcs-dir ../fbs-ranking-engine/research/datasets/fcs-coverage-v1/seasons --cache-dir ../fbs-ranking-engine/research/cache
node research/audit_historical_lineage.mjs --data-dir ../fbs-ranking-engine/data --repaired-dir ../fbs-ranking-engine/research/datasets/historical-coverage-v1/seasons > research/results/historical-foundation-v1/lineage-sensitivity.json
node research/report_historical_foundation.mjs
\`\`\`

The script accepts different cache paths, rejects checksum mismatches and writes only under research/results. A fresh clone without exact ignored caches cannot reproduce by itself; source hashes/URLs and compact supplements are retained rather than claiming self-contained historical ground truth. AP/CFP historical edition recovery and pregame ranking coverage are reported separately by the poll audit and are not model inputs here.
`;
await writeFile(join(root, 'reports/historical-foundation-validation-2026-11-18.md'), document);
console.log('Wrote historical foundation report, summary, season/conference and calibration CSVs.');
