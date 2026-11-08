/** Offline sensitivity of the four-season preseason forecast to archive repairs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { rankSeason } from '../src/engine.js';
import { replayPreseason } from './preseason-team-baseline.mjs';

const root = new URL('../', import.meta.url);
const calibrationYears = [2014, 2015, 2016, 2017, 2018, 2019];
const holdoutYears = [2023, 2024, 2025];
const sourceHashes = {};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const load = async path => {
  const bytes = await readFile(new URL(path, root));
  sourceHashes[path] = digest(bytes);
  return JSON.parse(bytes);
};

function sigmoid(value) {
  const small = Math.exp(-Math.abs(value));
  return value >= 0 ? 1 / (1 + small) : small / (1 + small);
}

// Same standardized slope, fixed penalty and bisection as the baseline replay.
function fitScale(rows, unit) {
  const gradient = slope => rows.reduce((sum, game) => {
    const edge = game.edges.fourYears / unit;
    return sum + edge * (sigmoid(edge * slope) - game.outcome);
  }, 0.01 * slope);
  assert.ok(rows.length > 0 && gradient(0) < 0);
  let low = 0;
  let high = 1;
  while (gradient(high) < 0) high *= 2;
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    if (gradient(middle) < 0) low = middle;
    else high = middle;
  }
  const slope = (low + high) / 2;
  assert.ok(Math.abs(gradient(slope)) < 1e-8);
  return unit / slope;
}

const fixtureKey = game => `${game.season}:${game.gameId}`;
const fixtureFields = ['home', 'away', 'week', 'neutral', 'startDate', 'homePoints', 'awayPoints', 'outcome'];

function matchFixtures(original, repaired) {
  const originalById = new Map(original.map(game => [fixtureKey(game), game]));
  const repairedById = new Map(repaired.map(game => [fixtureKey(game), game]));
  assert.equal(originalById.size, original.length);
  assert.equal(repairedById.size, repaired.length);
  const pairs = [];
  const originalOnly = [];
  const disagreements = [];
  for (const [key, before] of originalById) {
    const after = repairedById.get(key);
    if (!after) {
      originalOnly.push(key);
      continue;
    }
    const fields = fixtureFields.filter(field => before[field] !== after[field]);
    if (fields.length) disagreements.push({ key, fields });
    else pairs.push({ before, after });
  }
  const repairedOnly = [...repairedById.keys()].filter(key => !originalById.has(key));
  return { pairs, coverage: { originalGames: original.length, repairedGames: repaired.length,
    matchedGames: pairs.length, originalOnly, repairedOnly, disagreements,
    fixtureSha256: digest(JSON.stringify(pairs.map(({ before }) => [fixtureKey(before),
      ...fixtureFields.map(field => before[field])])) ) } };
}

function archiveCoverage(original, repaired) {
  const count = season => {
    const divisions = new Map(season.teams.map(team => [team.id, team.division]));
    const result = { teams: divisions.size, fbsTeams: [...divisions.values()].filter(value => value === 'fbs').length,
      completed: 0, completedFbsInvolving: 0, completedFcsOnly: 0, completedPostseason: 0 };
    for (const game of season.games) if (game.completed) {
      result.completed++;
      const home = divisions.get(game.home);
      const away = divisions.get(game.away);
      if (home === 'fbs' || away === 'fbs') result.completedFbsInvolving++;
      if (home === 'fcs' && away === 'fcs') result.completedFcsOnly++;
      if (game.seasonType === 'postseason') result.completedPostseason++;
    }
    return result;
  };
  const before = new Map(original.games.filter(game => game.completed).map(game => [game.id, game]));
  const after = new Map(repaired.games.filter(game => game.completed).map(game => [game.id, game]));
  const fields = ['home', 'away', 'neutral', 'startDate', 'seasonType', 'homePoints', 'awayPoints'];
  const edited = [...before].flatMap(([id, game]) => {
    if (!after.has(id)) return [];
    const changed = fields.filter(field => game[field] !== after.get(id)[field]);
    return changed.length ? [{ gameId: id, fields: changed }] : [];
  });
  return { year: original.year, original: count(original), repaired: count(repaired),
    added: [...after.keys()].filter(id => !before.has(id)).length,
    removed: [...before.keys()].filter(id => !after.has(id)).length, edited };
}

function predict(game, scale) {
  return sigmoid(game.edges.fourYears / scale);
}

function losses(p, outcome) {
  return { logLoss: -Math.log(Math.max(1e-12, outcome ? p : 1 - p)),
    brier: (p - outcome) ** 2, accuracy: p === 0.5 ? 0.5 : Number((p > 0.5) === Boolean(outcome)) };
}

function evaluate(rows, scale) {
  assert.ok(rows.length > 0);
  const sums = { logLoss: 0, brier: 0, accuracy: 0 };
  const wins = new Map();
  for (const game of rows) {
    const p = predict(game, scale);
    const score = losses(p, game.outcome);
    for (const field of Object.keys(sums)) sums[field] += score[field];
    for (const [team, expected, actual] of [[game.home, p, game.outcome], [game.away, 1 - p, 1 - game.outcome]]) {
      const key = `${game.season}:${team}`;
      wins.set(key, (wins.get(key) ?? 0) + expected - actual);
    }
  }
  return { games: rows.length, ...Object.fromEntries(Object.entries(sums).map(([field, sum]) => [field, sum / rows.length])),
    teamSeasons: wins.size, expectedWinsMAE: [...wins.values()].reduce((sum, value) => sum + Math.abs(value), 0) / wins.size };
}

function compare(pairs, originalScale, repairedScale) {
  const original = evaluate(pairs.map(pair => pair.before), originalScale);
  const repaired = evaluate(pairs.map(pair => pair.after), repairedScale);
  const delta = Object.fromEntries(['logLoss', 'brier', 'accuracy', 'expectedWinsMAE'].map(field =>
    [field, repaired[field] - original[field]]));
  const shifts = pairs.map(({ before, after }) => Math.abs(predict(after, repairedScale) - predict(before, originalScale)));
  const changedPicks = pairs.filter(({ before, after }) => Math.sign(before.edges.fourYears) !== Math.sign(after.edges.fourYears)).length;
  return { original, repaired, delta, changedPicks,
    probabilityShift: { meanAbsolute: shifts.reduce((sum, value) => sum + value, 0) / shifts.length, maximumAbsolute: Math.max(...shifts) } };
}

function pairedWeekSensitivity(pairs, originalScale, repairedScale) {
  const fields = ['logLoss', 'brier', 'accuracy'];
  const byYear = new Map();
  for (const { before, after } of pairs) {
    const blocks = byYear.get(before.season) ?? new Map();
    const block = blocks.get(before.week) ?? { games: 0, totals: [0, 0, 0] };
    const base = losses(predict(before, originalScale), before.outcome);
    const next = losses(predict(after, repairedScale), after.outcome);
    block.games++;
    fields.forEach((field, index) => { block.totals[index] += next[field] - base[field]; });
    blocks.set(before.week, block);
    byYear.set(before.season, blocks);
  }
  const groups = [...byYear.values()].map(blocks => [...blocks.values()]);
  const draws = 2000;
  const seed = 20261107;
  let state = seed;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const samples = fields.map(() => []);
  for (let draw = 0; draw < draws; draw++) {
    let games = 0;
    const sums = fields.map(() => 0);
    for (const blocks of groups) for (let index = 0; index < blocks.length; index++) {
      const block = blocks[Math.floor(random() * blocks.length)];
      games += block.games;
      fields.forEach((_, field) => { sums[field] += block.totals[field]; });
    }
    fields.forEach((_, field) => samples[field].push(sums[field] / games));
  }
  const quantile = (values, fraction) => {
    const index = (values.length - 1) * fraction;
    const low = Math.floor(index);
    return values[low] + (index - low) * (values[Math.ceil(index)] - values[low]);
  };
  return { draws, seed, blocksByYear: Object.fromEntries([...byYear].map(([year, blocks]) => [year, blocks.size])),
    paired95Ranges: Object.fromEntries(fields.map((field, index) => {
      const ordered = samples[index].sort((a, b) => a - b);
      return [field, [quantile(ordered, 0.025), quantile(ordered, 0.975)]];
    })),
    interpretation: 'Paired season-stratified week-block resampling with fitted scales held fixed. Teams recur across weeks. These ranges describe sensitivity and do not establish prospective significance.' };
}

function combinedRows(seasons, rows, config, candidate) {
  const targets = new Set(rows.map(row => row.season));
  const byYear = new Map();
  const historical = { ...config, retention: candidate.historicalRetention, marginCap: candidate.marginCap };
  let previous = null;
  for (const season of seasons) {
    if (targets.has(season.year)) {
      assert.equal(previous.season, season.year - 1);
      const opening = rankSeason({ year: season.year, teams: season.teams, games: [] }, { config, previous });
      assert.equal(opening.gamesUsed, 0);
      byYear.set(season.year, new Map(opening.rankings.map(team => [team.id, team.strength])));
    }
    if (season.year === Math.max(...targets)) break;
    previous = rankSeason(season, { config: historical, previous });
  }
  return rows.map(row => {
    const teams = byYear.get(row.season);
    const edge = teams.get(row.home) - teams.get(row.away) + (row.neutral ? 0 : config.homeAdvantage);
    assert.ok(Number.isFinite(edge));
    return { ...row, edges: { fourYears: edge } };
  });
}

async function checkCombined(original, repaired, train, test, config, originalScale, repairedScale) {
  const selection = await load('research/results/preseason-window/results.json');
  const candidate = selection.combined.find(row => row.id === 'combined-longer');
  assert.ok(candidate && candidate.window === null && candidate.historicalRetention === 1 && candidate.marginCap === 42);
  const allPairs = [...train.pairs, ...test.pairs];
  const originalRows = combinedRows(original, allPairs.map(pair => pair.before), config, candidate);
  const repairedRows = combinedRows(repaired, allPairs.map(pair => pair.after), config, candidate);
  const split = train.pairs.length;
  const originalCandidateScale = fitScale(originalRows.slice(0, split), config.probabilityScale);
  const repairedCandidateScale = fitScale(repairedRows.slice(0, split), config.probabilityScale);
  const originalCandidate = originalRows.slice(split);
  const repairedCandidate = repairedRows.slice(split);
  assert.ok(Math.abs(originalCandidateScale - candidate.scale) < 1e-10, 'Original combined scale did not reproduce');
  const reproduced = evaluate(originalCandidate, originalCandidateScale);
  for (const [field, selectedField] of [['games', 'games'], ['logLoss', 'logLoss'], ['brier', 'brier'], ['accuracy', 'accuracy'], ['expectedWinsMAE', 'winError']]) {
    assert.ok(Math.abs(reproduced[field] - candidate.evaluation[selectedField]) < 1e-10, `Original combined ${field} did not reproduce`);
  }
  const comparisons = {};
  for (const [label, baselineKey, candidates, baselineScale, candidateScale] of [
    ['originalArchive', 'before', originalCandidate, originalScale, originalCandidateScale],
    ['repairedArchive', 'after', repairedCandidate, repairedScale, repairedCandidateScale],
  ]) {
    const pairs = test.pairs.map((pair, index) => ({ before: pair[baselineKey], after: candidates[index] }));
    const present = subset => {
      const { original: baseline, repaired: combined, ...difference } = compare(subset, baselineScale, candidateScale);
      return { baseline, combined, ...difference };
    };
    comparisons[label] = { baselineScale, candidateScale, pooled: present(pairs),
      byYear: Object.fromEntries(holdoutYears.map(year => [year, present(pairs.filter(pair => pair.before.season === year))])),
      pairedWeekSensitivity: pairedWeekSensitivity(pairs, baselineScale, candidateScale) };
  }
  return { rule: { historyStartYear: original[0].year, historicalRetention: candidate.historicalRetention,
    marginCap: candidate.marginCap, targetRetention: config.retention, homeAdvantage: config.homeAdvantage },
    protocol: 'Hold the earlier-selected combined rule fixed, refit only the probability scale on the common 2014–2019 fixtures, and compare against four years on the same archive and holdout fixtures. This is a repeated retrospective sensitivity check.',
    originalReproduction: true, ...comparisons };
}

const config = await load('data/model.json');
const years = Array.from({ length: 22 }, (_, index) => 2004 + index);
const [original, repaired, reference] = await Promise.all([
  Promise.all(years.map(year => load(`data/seasons/${year}.json`))),
  Promise.all(years.map(year => load(`research/datasets/${year >= 2014 ? 'fcs-coverage-v1' : 'historical-coverage-v1'}/seasons/${year}.json`))),
  load('research/cache/preseason-team-baseline/result.json'),
]);
const targets = [...calibrationYears, ...holdoutYears];
const originalReplay = replayPreseason(original, config, targets);
const repairedReplay = replayPreseason(repaired, config, targets);
const select = (replay, set) => replay.rows.filter(game => set.includes(game.season));
const beforeTrain = select(originalReplay, calibrationYears);
const beforeTest = select(originalReplay, holdoutYears);
const nativeScale = fitScale(beforeTrain, config.probabilityScale);
const nativeEvaluation = evaluate(beforeTest, nativeScale);
assert.ok(Math.abs(nativeScale - reference.models.fourYears.scale) < 1e-10, 'Stored original scale did not reproduce');
for (const field of ['games', 'logLoss', 'brier', 'accuracy', 'teamSeasons', 'expectedWinsMAE']) {
  assert.ok(Math.abs(nativeEvaluation[field] - reference.evaluation.originalStrengthHoldout.fourYears[field]) < 1e-10,
    `Stored original holdout ${field} did not reproduce`);
}
const train = matchFixtures(beforeTrain, select(repairedReplay, calibrationYears));
const test = matchFixtures(beforeTest, select(repairedReplay, holdoutYears));
const originalScale = fitScale(train.pairs.map(pair => pair.before), config.probabilityScale);
const repairedScale = fitScale(train.pairs.map(pair => pair.after), config.probabilityScale);
const paired = compare(test.pairs, originalScale, repairedScale);
const fixed = compare(test.pairs, nativeScale, nativeScale);
const byYear = Object.fromEntries(holdoutYears.map(year => [year,
  compare(test.pairs.filter(pair => pair.before.season === year), originalScale, repairedScale)]));
const uncertainty = pairedWeekSensitivity(test.pairs, originalScale, repairedScale);
const nativeInputCoverage = original.map((season, index) => archiveCoverage(season, repaired[index]));
const combinedChallenger = await checkCombined(original, repaired, train, test, config, originalScale, repairedScale);
for (const path of ['src/engine.js', 'research/preseason-team-baseline.mjs', 'research/preseason-archive-robustness.mjs']) {
  sourceHashes[path] = digest(await readFile(new URL(path, root)));
}
const report = { experiment: 'preseason-archive-robustness-v1', calibrationYears, holdoutYears, config,
  protocol: { scope: reference.scope, history: reference.protocol.fourYears,
    calibration: 'Separate penalized logistic scales fit on identical matched 2014–2019 games. Fixed-scale comparison uses the stored original mapping for both archives.',
    match: 'Exact season/game ID, participants, orientation, week, kickoff, venue and outcome points.',
    repairs: 'Historical coverage release plus FCS supplement where available.',
    delta: 'Repaired minus original. Lower log loss, Brier and wins MAE are better. Higher accuracy is better.' },
  fixtureCoverage: { calibration: train.coverage, holdout: test.coverage },
  originalReproduction: { passed: true, scale: nativeScale, holdout: nativeEvaluation },
  models: { originalScale, repairedScale }, pooled: paired, byYear,
  fixedOriginalScale: fixed, pairedWeekSensitivity: uncertainty, nativeInputCoverage, combinedChallenger,
  limits: ['Retrospective fixture archives include some regular-tagged conference title games.',
    'Original and repaired seasons share upstream data. Repairs do not certify archive completeness or point-in-time availability.',
    'Only three previously inspected holdout seasons are compared. Descriptive resampling holds fitted scales fixed.'],
  sourceHashes: Object.fromEntries(Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b))), cfbdCalls: 0 };
const directory = new URL('research/results/preseason-archive-robustness/', root);
await mkdir(directory, { recursive: true });
await writeFile(new URL('results.json', directory), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ coverage: report.fixtureCoverage, models: report.models, pooled: paired, byYear,
  fixed: fixed.delta, uncertainty,
  combined: Object.fromEntries(['originalArchive', 'repairedArchive'].map(key => [key, {
    pooled: combinedChallenger[key].pooled,
    byYear: Object.fromEntries(Object.entries(combinedChallenger[key].byYear).map(([year, row]) => [year, row.delta])),
    uncertainty: combinedChallenger[key].pairedWeekSensitivity,
  }])) }, null, 2));
