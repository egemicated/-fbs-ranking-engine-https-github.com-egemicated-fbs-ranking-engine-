/** Test fixed preseason Strength margin scales on identical archived fixtures. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { replayPreseason } from './preseason-team-baseline.mjs';

const root = new URL('../', import.meta.url);
const calibrationYears = [2014, 2015, 2016, 2017, 2018, 2019];
const selectionYears = [2021, 2022];
const comparisonYears = [2023, 2024, 2025];
const years = [...calibrationYears, ...selectionYears, ...comparisonYears];
const caps = [14, 28, 42];
const penalty = .01;

const sourceHashes = {};
async function load(path) {
  const bytes = await readFile(new URL(path, root));
  sourceHashes[path] = createHash('sha256').update(bytes).digest('hex');
  return JSON.parse(bytes);
}

function sigmoid(logOdds) {
  const small = Math.exp(-Math.abs(logOdds));
  return logOdds >= 0 ? 1 / (1 + small) : small / (1 + small);
}

function fitScale(rows, unit) {
  // The same single-slope logistic calibration used by the team baseline.
  const gradient = slope => rows.reduce((sum, row) => {
    const edge = row.edges.fourYears / unit;
    return sum + edge * (sigmoid(edge * slope) - row.outcome);
  }, penalty * slope);
  assert.ok(rows.length && gradient(0) < 0, 'Calibration requires a positive signal');
  let lower = 0;
  let upper = 1;
  while (gradient(upper) < 0) upper *= 2;
  for (let step = 0; step < 60; step++) {
    const middle = (lower + upper) / 2;
    if (gradient(middle) < 0) lower = middle;
    else upper = middle;
  }
  const slope = (lower + upper) / 2;
  assert.ok(Math.abs(gradient(slope)) < 1e-8, 'Probability fit failed to converge');
  return unit / slope;
}

function score(rows, scale) {
  assert.ok(rows.length);
  const sums = { brier: 0, logLoss: 0, accuracy: 0 };
  const wins = new Map();
  for (const row of rows) {
    const p = sigmoid(row.edges.fourYears / scale);
    sums.brier += (p - row.outcome) ** 2;
    sums.logLoss -= Math.log(Math.max(1e-12, row.outcome ? p : 1 - p));
    sums.accuracy += p === .5 ? .5 : Number((p > .5) === Boolean(row.outcome));
    for (const [id, prediction, actual] of [[row.home, p, row.outcome], [row.away, 1 - p, 1 - row.outcome]]) {
      const key = `${row.season}:${id}`;
      wins.set(key, (wins.get(key) ?? 0) + prediction - actual);
    }
  }
  return { games: rows.length, ...Object.fromEntries(Object.entries(sums).map(([key, value]) => [key, value / rows.length])),
    expectedWinsMAE: [...wins.values()].reduce((sum, value) => sum + Math.abs(value), 0) / wins.size };
}

const [seasons, currentConfig] = await Promise.all([
  Promise.all(Array.from({ length: 22 }, (_, i) => load(`data/seasons/${2004 + i}.json`))),
  load('data/model.json'),
]);
assert.ok(caps.includes(currentConfig.marginCap), 'Include the current margin cap as a benchmark');
const fields = ['season', 'gameId', 'home', 'away', 'neutral', 'startDate', 'outcome'];
const cohort = row => fields.map(field => row[field]);
const fits = caps.map(cap => {
  const { rows, checkpoints } = replayPreseason(seasons, { ...currentConfig, marginCap: cap }, years);
  for (const year of years) assert.deepEqual(checkpoints[year].windowYears, [year - 4, year - 3, year - 2, year - 1]);
  const calibration = rows.filter(row => calibrationYears.includes(row.season));
  const scale = fitScale(calibration, currentConfig.probabilityScale);
  return { cap, scale, calibrationGames: calibration.length, rows,
    selection: score(rows.filter(row => selectionYears.includes(row.season)), scale) };
});
const benchmark = fits.find(fit => fit.cap === currentConfig.marginCap);
for (const fit of fits) assert.deepEqual(fit.rows.map(cohort), benchmark.rows.map(cohort), 'Cohort mismatch across cap settings');

const selected = [...fits].sort((a, b) => a.selection.logLoss - b.selection.logLoss ||
  a.selection.brier - b.selection.brier || Math.abs(a.cap - benchmark.cap) - Math.abs(b.cap - benchmark.cap))[0];
const results = fits.map(fit => {
  const { rows, ...summary } = fit;
  return { ...summary, comparison: score(rows.filter(row => comparisonYears.includes(row.season)), fit.scale),
    byYear: Object.fromEntries([...selectionYears, ...comparisonYears].map(year =>
      [year, score(rows.filter(row => row.season === year), fit.scale)])) };
});
for (const path of ['src/engine.js', 'research/preseason-team-baseline.mjs', 'research/preseason-margin-cap.mjs']) {
  sourceHashes[path] = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
}
const report = {
  status: 'retrospective research only',
  scope: 'Decided archive regular-tagged FBS–FBS games, including some conference title games.',
  configuration: { current: currentConfig, caps, formula: 'cap * tanh(margin / cap)',
    penalty, calibrationYears, selectionYears, comparisonYears, priorSeasons: 4,
    choice: 'Lowest 2021–2022 log loss, then Brier, then closest to the current cap.' },
  limitation: 'Retrospective comparison on familiar later years. The shared existing Strength settings were selected partly on 2019–2022, so the cap-selection split is conditional on those settings.',
  selectedCap: selected.cap,
  selectedComparisonDelta: Object.fromEntries(['brier', 'logLoss', 'accuracy', 'expectedWinsMAE'].map(key => [key,
    results.find(result => result.cap === selected.cap).comparison[key] -
      results.find(result => result.cap === benchmark.cap).comparison[key]])),
  adjustedMarginExamples: Object.fromEntries(caps.map(cap => [cap,
    Object.fromEntries([7, 14, 28, 42, 56].map(margin => [margin, cap * Math.tanh(margin / cap)]))])),
  results,
  sourceHashes: Object.fromEntries(Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b))),
  cfbdCalls: 0,
};
const output = new URL('research/results/preseason-margin-cap/', root);
await mkdir(output, { recursive: true });
await writeFile(new URL('results.json', output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ selectedCap: report.selectedCap, selectedComparisonDelta: report.selectedComparisonDelta,
  results }, null, 2));
