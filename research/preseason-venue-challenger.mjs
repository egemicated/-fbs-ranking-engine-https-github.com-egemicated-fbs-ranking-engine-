/** Older-only probability calibration for the fixed four-year preseason ratings. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { VERSION } from '../src/engine.js';
import { replayPreseason } from './preseason-team-baseline.mjs';

const root = new URL('../', import.meta.url);
const trainingYears = [2014, 2015, 2016, 2017, 2018, 2019];
const selectionYears = [2021, 2022];
const evaluationYears = [2023, 2024, 2025];
const families = ['fixedEdgeTemperature', 'learnedVenue', 'venueSpecificSlope'];
const penalty = 0.01;
const sourceHashes = {};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function load(path) {
  const bytes = await readFile(new URL(path, root));
  sourceHashes[path] = sha(bytes);
  return JSON.parse(bytes);
}

function sigmoid(logOdds) {
  const tail = Math.exp(-Math.abs(logOdds));
  return logOdds >= 0 ? 1 / (1 + tail) : tail / (1 + tail);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function solve(matrix, rhs) {
  const a = matrix.map((row, index) => [...row, rhs[index]]);
  const size = rhs.length;
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    [a[column], a[pivot]] = [a[pivot], a[column]];
    assert.ok(Math.abs(a[column][column]) > 1e-12, 'Calibration system is singular');
    for (let row = column + 1; row < size; row++) {
      const ratio = a[row][column] / a[column][column];
      for (let index = column; index <= size; index++) a[row][index] -= ratio * a[column][index];
    }
  }
  const solution = Array(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    const residual = a[row][size] - dot(a[row].slice(row + 1, size), solution.slice(row + 1));
    solution[row] = residual / a[row][row];
  }
  return solution;
}

function features(game, family, config) {
  const difference = game.strengthDifference / config.probabilityScale;
  if (family === 'fixedEdgeTemperature') return [difference + game.venue * config.homeAdvantage / config.probabilityScale];
  const shared = [difference, game.venue];
  return family === 'learnedVenue' ? shared : [...shared, difference * Math.abs(game.venue)];
}

function fit(rows, family, config) {
  assert.ok(rows.length, 'Empty calibration sample');
  const design = rows.map(row => features(row, family, config));
  let beta = design[0].map(() => 0);
  const objective = coefficients => design.reduce((sum, row, index) => {
    const z = dot(row, coefficients);
    return sum + Math.max(0, z) + Math.log1p(Math.exp(-Math.abs(z))) - rows[index].outcome * z;
  }, penalty * dot(coefficients, coefficients) / 2);
  for (let iteration = 0; iteration < 50; iteration++) {
    const gradient = beta.map(value => penalty * value);
    const hessian = beta.map((_, a) => beta.map((_, b) => a === b ? penalty : 0));
    for (const [index, row] of design.entries()) {
      const probability = sigmoid(dot(row, beta));
      for (let a = 0; a < beta.length; a++) {
        gradient[a] += row[a] * (probability - rows[index].outcome);
        for (let b = 0; b < beta.length; b++) hessian[a][b] += row[a] * row[b] * probability * (1 - probability);
      }
    }
    const maxGradient = Math.max(...gradient.map(Math.abs));
    if (maxGradient < 1e-8) {
      const neutralSlope = beta[0] / config.probabilityScale;
      const homeSlope = (beta[0] + (beta[2] ?? 0)) / config.probabilityScale;
      const homeLogOdds = family === 'fixedEdgeTemperature' ? neutralSlope * config.homeAdvantage : beta[1];
      assert.ok(neutralSlope > 0 && homeSlope > 0, 'Strength slopes must be positive');
      return { family, trainingGames: rows.length, coefficients: beta, maxGradient,
        neutralLogOddsPerPoint: neutralSlope, homeLogOddsPerPoint: homeSlope, homeLogOdds,
        equivalentHomeEdgePoints: homeLogOdds / homeSlope,
        equalStrengthHomeWinProbability: sigmoid(homeLogOdds) };
    }
    const step = solve(hessian, gradient);
    const previous = objective(beta);
    let amount = 1;
    while (amount > 1e-9) {
      const candidate = beta.map((value, index) => value - amount * step[index]);
      if (objective(candidate) <= previous + 1e-9) { beta = candidate; break; }
      amount /= 2;
    }
    assert.ok(amount > 1e-9, 'Calibration line search did not improve the fit');
  }
  throw new Error('Probability calibration did not converge');
}

function probability(game, model) {
  const slope = game.venue ? model.homeLogOddsPerPoint : model.neutralLogOddsPerPoint;
  return sigmoid(slope * game.strengthDifference + game.venue * model.homeLogOdds);
}

function score(rows, model) {
  if (!rows.length) return { games: 0 };
  let brier = 0;
  let logLoss = 0;
  let predicted = 0;
  let wins = 0;
  let correct = 0;
  for (const game of rows) {
    const p = probability(game, model);
    brier += (p - game.outcome) ** 2;
    logLoss -= Math.log(Math.max(1e-12, game.outcome ? p : 1 - p));
    predicted += p;
    wins += game.outcome;
    correct += p === 0.5 ? 0.5 : Number((p > 0.5) === Boolean(game.outcome));
  }
  const games = rows.length;
  return { games, brier: brier / games, logLoss: logLoss / games, accuracy: correct / games,
    meanProbability: predicted / games, observedHomeWinRate: wins / games, meanProbabilityError: (predicted - wins) / games };
}

const config = await load('data/model.json');
const seasons = await Promise.all(Array.from({ length: 22 }, (_, index) => load(`data/seasons/${2004 + index}.json`)));
const { rows: replay } = replayPreseason(seasons, config, [...trainingYears, ...selectionYears, ...evaluationYears]);
const rows = replay.map(game => {
  const venue = Number(!game.neutral);
  return { ...game, venue, strengthDifference: game.edges.fourYears - config.homeAdvantage * venue };
});
const forYears = years => rows.filter(game => years.includes(game.season));
const train = forYears(trainingYears);
const models = Object.fromEntries(families.map(family => [family, fit(train, family, config)]));
const compare = cohort => Object.fromEntries(families.map(family => [family, score(cohort, models[family])]));
const selection = compare(forYears(selectionYears));
const selectedFamily = families.reduce((best, family) => selection[family].logLoss < selection[best].logLoss ? family : best);
const evaluation = forYears(evaluationYears);
const groups = { all: compare(evaluation), home: compare(evaluation.filter(game => game.venue)),
  neutral: compare(evaluation.filter(game => !game.venue)),
  byYear: Object.fromEntries(evaluationYears.map(year => [year, compare(forYears([year]))])) };
for (const model of Object.values(models)) for (const row of evaluation) {
  const reversed = { venue: -row.venue, strengthDifference: -row.strengthDifference };
  assert.ok(Math.abs(probability(row, model) + probability(reversed, model) - 1) < 1e-12);
}
for (const path of ['src/engine.js', 'research/preseason-team-baseline.mjs', 'research/preseason-venue-challenger.mjs']) {
  sourceHashes[path] = sha(await readFile(new URL(path, root)));
}
const report = { modelVersion: VERSION, config, trainingYears, selectionYears, evaluationYears, penalty, selectedFamily,
  protocol: 'Fit each probability link using earlier games only. Select the family by pooled 2021–2022 log loss. Score all fixed families on the identical 2023–2025 cohort.',
  scope: 'Corrected archive regular-tagged FBS–FBS games, including some title games. The four-year team Strength fit is fixed. Venue comes from the realized historical schedule.',
  interpretation: 'Equivalent home edge is a probability calibration term on the model rating scale. Neutral and home strata differ in fixture composition.',
  models, selection, evaluation: groups,
  sourceHashes: Object.fromEntries(Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b))), cfbdCalls: 0 };
const directory = new URL('research/cache/preseason-team-baseline/', root);
await mkdir(directory, { recursive: true });
await writeFile(new URL('venue-challenger.json', directory), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ selectedFamily, models, selection, evaluation: groups.all, neutral: groups.neutral }, null, 2));
