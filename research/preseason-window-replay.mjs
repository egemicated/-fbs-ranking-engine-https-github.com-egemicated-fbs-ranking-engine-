// Compare preseason history length and carryover on the same archived games.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { rankSeason } from '../src/engine.js';
import { replayPreseason } from './preseason-team-baseline.mjs';

const root = new URL('../', import.meta.url);
const fitYears = [2014, 2015, 2016, 2017, 2018, 2019];
const selectYears = [2021, 2022];
const testYears = [2023, 2024, 2025];
const years = [...fitYears, ...selectYears, ...testYears];
const baselineId = 'four-years';
const sourceHashes = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function read(path) {
  const bytes = await readFile(new URL(path, root));
  sourceHashes[path] = hash(bytes);
  return JSON.parse(bytes);
}

const config = await read('data/model.json');
const seasons = await Promise.all(Array.from({ length: 22 }, (_, index) => read(`data/seasons/${2004 + index}.json`)));
const archive = new Map(seasons.map(season => [season.year, season]));
const startYear = seasons[0].year;
const replay = replayPreseason(seasons, config, years);
const windows = [1, 2, 4, 6, 8, 10].map(window => ({
  id: window === 4 ? baselineId : `window-${window}`, window, historicalRetention: config.retention,
}));
windows.push({ id: 'all-earlier', window: null, historicalRetention: config.retention });
const retentions = [0, .25, .5, .75, .9, 1].map(value => ({
  id: value === config.retention ? baselineId : `retention-${value}`, window: 4, historicalRetention: value,
}));
const candidates = [...new Map([...windows, ...retentions].map(candidate => [candidate.id, candidate])).values()];

const priors = new Map();
function history(first, last, retention, marginCap) {
  const key = `${first}:${last}:${retention}:${marginCap}`;
  if (priors.has(key)) return priors.get(key);
  const season = archive.get(last);
  assert.ok(season && first >= startYear && first <= last, `Missing prior season ${last}`);
  const previous = first === last ? null : history(first, last - 1, retention, marginCap);
  const rated = rankSeason(season, { config: { ...config, retention, marginCap }, previous });
  // The engine reads only these prior fields when building the next season.
  const prior = { season: rated.season, snapshotHash: rated.snapshotHash,
    ratings: rated.ratings.map(({ id, strength }) => ({ id, strength })) };
  priors.set(key, prior);
  return prior;
}

function preseason(year, candidate) {
  const first = candidate.window === null ? startYear : year - candidate.window;
  const previous = history(first, year - 1, candidate.historicalRetention, candidate.marginCap ?? config.marginCap);
  const opening = rankSeason({ year, teams: archive.get(year).teams, games: [] }, { config, previous });
  assert.equal(opening.gamesUsed, 0);
  return new Map(opening.rankings.map(team => [team.id, team.strength]));
}

const sigmoid = value => 1 / (1 + Math.exp(-value));
function fitScale(rows) {
  const unit = config.probabilityScale;
  const gradient = slope => rows.reduce((sum, row) => {
    const x = row.edge / unit;
    return sum + x * (sigmoid(x * slope) - row.outcome);
  }, .01 * slope);
  assert.ok(rows.length && gradient(0) < 0);
  let low = 0, high = 1;
  while (gradient(high) < 0) high *= 2;
  for (let i = 0; i < 60; i++) {
    const middle = (low + high) / 2;
    if (gradient(middle) < 0) low = middle;
    else high = middle;
  }
  return unit / ((low + high) / 2);
}

function score(rows, scale) {
  let logLoss = 0, brier = 0, accuracy = 0;
  const totals = new Map();
  for (const { season, home, away, outcome, edge } of rows) {
    const p = sigmoid(edge / scale);
    logLoss -= Math.log(outcome ? p : 1 - p);
    brier += (p - outcome) ** 2;
    accuracy += p === .5 ? .5 : Number((p > .5) === Boolean(outcome));
    for (const [id, expected, actual] of [[home, p, outcome], [away, 1 - p, 1 - outcome]]) {
      const key = `${season}:${id}`;
      totals.set(key, (totals.get(key) ?? 0) + expected - actual);
    }
  }
  return { games: rows.length, logLoss: logLoss / rows.length, brier: brier / rows.length,
    accuracy: accuracy / rows.length, winError: [...totals.values()].reduce((sum, error) => sum + Math.abs(error), 0) / totals.size };
}

function evaluate(candidate) {
  const byYear = new Map(years.map(year => [year, preseason(year, candidate)]));
  const rows = replay.rows.map(row => {
    const teams = byYear.get(row.season);
    const edge = teams.get(row.home) - teams.get(row.away) + (row.neutral ? 0 : config.homeAdvantage);
    if (candidate.id === baselineId) assert.equal(edge, row.edges.fourYears);
    return { ...row, edge };
  });
  const select = set => rows.filter(row => set.includes(row.season));
  const scale = fitScale(select(fitYears));
  return { ...candidate, scale, selection: score(select(selectYears), scale), evaluation: score(select(testYears), scale),
    byYear: Object.fromEntries(testYears.map(year => [year, score(select([year]), scale)])) };
}

const results = candidates.map(evaluate);

function preferred(group) {
  const ids = new Set(group.map(row => row.id));
  return results.filter(row => ids.has(row.id)).sort((a, b) =>
    a.selection.logLoss - b.selection.logLoss || a.id.localeCompare(b.id))[0].id;
}

const selectedWindow = preferred(windows);
const selectedRetention = preferred(retentions);
const combined = [];
if (process.argv.includes('--combined')) {
  const { selectedCap } = await read('research/results/preseason-margin-cap/results.json');
  assert.ok(Number.isFinite(selectedCap) && selectedCap > 0);
  const historicalRetention = retentions.find(row => row.id === selectedRetention).historicalRetention;
  const selectedLength = windows.find(row => row.id === selectedWindow).window;
  // Combine only the settings selected in the earlier comparison. These are
  // a retrospective follow-up and do not select on any 2023–25 outcomes.
  for (const window of new Set([4, selectedLength])) {
    combined.push(evaluate({ id: window === 4 ? 'combined-four' : 'combined-longer', window,
      historicalRetention, marginCap: selectedCap }));
  }
}

const output = {
  fitYears, selectYears, testYears, baselineId,
  selectedWindow, selectedRetention, combined,
  scope: 'Retrospective archive regular-tagged FBS–FBS fixtures, including some conference title games. Each candidate forecasts from earlier seasons only.',
  protocol: 'Fit a separate odds scale per candidate on 2014–2019; choose by log loss in 2021–2022. Historical retention changes how much carries between input seasons. Every candidate keeps the same .75 shrinkage into the target preseason and the same nominal venue edge.',
  results, sourceHashes, cfbdCalls: 0,
};
const directory = new URL('research/results/preseason-window/', root);
await mkdir(directory, { recursive: true });
await writeFile(new URL('results.json', directory), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ selectedWindow, selectedRetention,
  results: [...results, ...combined].map(({ id, selection, evaluation }) => ({ id, selectionLogLoss: selection.logLoss, ...evaluation })) }, null, 2));
