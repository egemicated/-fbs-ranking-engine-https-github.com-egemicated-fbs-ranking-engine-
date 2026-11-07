/** Offline calibration of the site's fixed Strength graph using recorded results. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { backtest } from '../src/history.js';
import { VERSION, rankSeason, predict } from '../src/engine.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceHashes = {};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function load(path) {
  const bytes = await readFile(root + path);
  sourceHashes[path] = sha(bytes);
  return JSON.parse(bytes);
}

// Earlier archived results calibrate the score-to-probability link. Known later
// seasons measure retrospective generalization under the locked mapping.
const fitYears = [2014, 2015, 2016, 2017];
const selectionYears = [2018, 2019];
const evaluationYears = [2021, 2022, 2023, 2024, 2025];
const originalStrengthHoldoutYears = [2023, 2024, 2025];
const originalStrengthSelectionYears = [2019, 2020, 2021, 2022];
const calibrationYears = [...fitYears, ...selectionYears];
const allYears = [...calibrationYears, ...evaluationYears];
const families = ['temperature', 'splitVenue'];
const penalty = 0.01;
assert.ok(process.argv.slice(2).every(arg => arg === '--repaired'), 'Supported option: --repaired');

function sigmoid(value) {
  const e = Math.exp(-Math.abs(value));
  return value >= 0 ? 1 / (1 + e) : e / (1 + e);
}

function features(game, family, config) {
  const venue = Number(game.baselineProbability !== 0.5);
  return family === 'temperature' ? [game.homeMargin / config.probabilityScale] :
    [(game.homeMargin - venue * config.homeAdvantage) / config.probabilityScale, venue];
}

function fit(rows, family, config) {
  assert.ok(rows.length > 0, 'Calibration requires completed games');
  const x = rows.map(game => features(game, family, config));
  const outcome = rows.map(game => game.outcome);
  let beta = family === 'temperature' ? [1] : [1, config.homeAdvantage / config.probabilityScale];
  const dot = (a, b) => a.reduce((total, value, index) => total + value * b[index], 0);
  const objective = coefficients => x.reduce((total, row, index) => {
    const z = dot(row, coefficients);
    return total + Math.max(z, 0) + Math.log1p(Math.exp(-Math.abs(z))) - outcome[index] * z;
  }, penalty * dot(coefficients, coefficients) / 2);
  let gradient;
  for (let iteration = 0; iteration < 50; iteration++) {
    gradient = beta.map(value => penalty * value);
    const hessian = beta.map((_, a) => beta.map((_, b) => a === b ? penalty : 0));
    for (let index = 0; index < x.length; index++) {
      const row = x[index];
      const probability = sigmoid(dot(row, beta));
      const variance = probability * (1 - probability);
      for (let a = 0; a < beta.length; a++) {
        gradient[a] += row[a] * (probability - outcome[index]);
        for (let b = 0; b < beta.length; b++) hessian[a][b] += row[a] * row[b] * variance;
      }
    }
    if (Math.max(...gradient.map(Math.abs)) < 1e-8) break;
    let step;
    if (beta.length === 1) {
      step = [gradient[0] / hessian[0][0]];
    } else {
      const [[a, b], [, d]] = hessian;
      const determinant = a * d - b * b;
      assert.ok(determinant > 0, 'Calibration Hessian must be positive definite');
      step = [(d * gradient[0] - b * gradient[1]) / determinant,
        (a * gradient[1] - b * gradient[0]) / determinant];
    }
    const previous = objective(beta);
    let amount = 1;
    let candidate;
    do {
      candidate = beta.map((value, index) => value - amount * step[index]);
      amount /= 2;
    } while (objective(candidate) > previous + 1e-9 && amount > 1e-10);
    assert.ok(objective(candidate) <= previous + 1e-9, 'Calibration objective increased');
    beta = candidate;
  }
  const maxGradient = Math.max(...gradient.map(Math.abs));
  assert.ok(maxGradient < 1e-7 && beta[0] > 0, 'Calibration did not converge to a positive slope');
  return { family, coefficients: beta, strengthLogOddsPerPoint: beta[0] / config.probabilityScale,
    equivalentScale: config.probabilityScale / beta[0],
    venueLogOdds: family === 'temperature' ? beta[0] * config.homeAdvantage / config.probabilityScale : beta[1],
    trainingGames: rows.length, maxGradient };
}

function forecast(game, fitted, config) {
  if (!fitted) return game.homeWinProbability;
  const row = features(game, fitted.family, config);
  return sigmoid(row.reduce((sum, value, index) => sum + value * fitted.coefficients[index], 0));
}

function score(rows, fitted, config, includeReliability = false) {
  const bins = Array.from({ length: 10 }, () => ({ games: 0, probabilitySum: 0, wins: 0 }));
  let brier = 0, logLoss = 0, accuracy = 0, bias = 0;
  for (const row of rows) {
    const p = forecast(row, fitted, config);
    const y = row.outcome;
    brier += (p - y) ** 2;
    logLoss -= y ? Math.log(Math.max(p, 1e-12)) : Math.log(Math.max(1 - p, 1e-12));
    accuracy += p === 0.5 ? 0.5 : Number((p > 0.5) === Boolean(y));
    bias += p - y;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.games++;
    bin.probabilitySum += p;
    bin.wins += y;
  }
  const result = { games: rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length,
    accuracy: accuracy / rows.length, meanProbabilityError: bias / rows.length };
  if (includeReliability) {
    result.reliability = bins.flatMap((bin, index) => bin.games ? [{ range: [index / 10, (index + 1) / 10],
      games: bin.games, meanProbability: bin.probabilitySum / bin.games, actualHomeWinRate: bin.wins / bin.games }] : []);
    result.fixedBinCalibrationError = bins.reduce((sum, bin) => sum + Math.abs(bin.probabilitySum - bin.wins), 0) / rows.length;
  }
  return result;
}

async function repairedEvaluation(config) {
  // Isolate repaired current-year inputs while keeping the production-archive
  // prior for that year. The repair does not change calibration coefficients.
  const rows = [];
  for (const year of evaluationYears) {
    const season = await load(`research/datasets/fcs-coverage-v1/seasons/${year}.json`);
    const previous = await load(`data/snapshots/${year - 1}.json`);
    assert.equal(season.year, year);
    assert.equal(previous.season, year - 1);
    assert.deepEqual(previous.config, config);
    const fbs = new Set(season.teams.filter(team => team.division === 'fbs').map(team => team.id));
    const completed = season.games.filter(game => game.completed);
    const weeks = new Map();
    for (const game of completed) {
      const key = `${game.seasonType}:${game.week}`;
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(game);
    }
    const groups = [...weeks.values()].map(targets => ({ targets,
      cutoff: Math.min(...targets.map(game => Date.parse(game.startDate))) })).sort((a, b) => a.cutoff - b.cutoff);
    const seen = new Set();
    for (const { targets, cutoff } of groups) {
      const eligible = new Set(completed.filter(game => seen.has(game.id) && Date.parse(game.startDate) + 86400000 <= cutoff).map(game => game.id));
      assert.ok(targets.every(game => !eligible.has(game.id)), 'Target game entered a preweek graph');
      const snapshot = rankSeason(season, { config, previous, gameIds: eligible });
      for (const game of targets) {
        if (!fbs.has(game.home) || !fbs.has(game.away) || game.homePoints === game.awayPoints) continue;
        rows.push({ season: year, gameId: game.id, week: game.week, seasonType: game.seasonType,
          outcome: Number(game.homePoints > game.awayPoints), baselineProbability: game.neutral ? 0.5 : 0.58,
          ...predict(snapshot, game) });
      }
      for (const game of targets) seen.add(game.id);
    }
  }
  return rows;
}

function evaluation(rows, models, config) {
  const compare = selected => Object.fromEntries(Object.entries(models).map(([name, model]) => [name, score(selected, model, config, true)]));
  return { pooled: compare(rows),
    originalStrengthHeldOut: compare(rows.filter(game => originalStrengthHoldoutYears.includes(game.season))),
    byYear: Object.fromEntries(evaluationYears.map(year => [year, compare(rows.filter(game => game.season === year))])) };
}

const config = await load('data/model.json');
const published = await load('published/latest.json');
assert.deepEqual(published.config, config);
assert.equal(published.modelVersion, VERSION);
const seasons = await Promise.all(Array.from({ length: 22 }, (_, index) => load(`data/seasons/${2004 + index}.json`)));
const archive = backtest(seasons, { config, evaluateYears: allYears }).predictions;
const onlyYears = (rows, years) => rows.filter(game => years.includes(game.season));
const fittedEarlier = Object.fromEntries(families.map(family => [family, fit(onlyYears(archive, fitYears), family, config)]));
const selection = Object.fromEntries(families.map(family => [family, score(onlyYears(archive, selectionYears), fittedEarlier[family], config)]));
const selectedFamily = families.reduce((best, family) => selection[family].logLoss < selection[best].logLoss ? family : best);
const calibrationGames = onlyYears(archive, calibrationYears);
const models = { current: null, ...Object.fromEntries(families.map(family => [family, fit(calibrationGames, family, config)])) };
const scaleSensitivity = calibrationYears.map(year => ({ omittedCalibrationYear: year,
  scale: fit(calibrationGames.filter(game => game.season !== year), 'temperature', config).equivalentScale }));
const repaired = process.argv.includes('--repaired') ? await repairedEvaluation(config) : null;
for (const path of ['src/engine.js', 'src/history.js', 'frontend/app.js', 'research/strength-probability-calibration.mjs']) {
  sourceHashes[path] = sha(await readFile(root + path));
}
const result = { modelVersion: VERSION, strengthConfig: config, currentSnapshotHash: published.snapshotHash,
  sources: 'Recorded scores, team identities, venue and dates from the shipping archive. Repaired current-year history is a sensitivity with archived priors and identical probability coefficients.',
  protocol: { fitYears, selectionYears, calibrationYears, evaluationYears, originalStrengthHoldoutYears, originalStrengthSelectionYears,
    penalty, criterion: 'Earlier validation log loss',
    calibrationFeatures: ['Current adjusted Strength margin', 'Strength difference and a signed venue term'],
    cutoff: 'Freeze before the earliest game in the whole competition week, using earlier processed weeks and a 24-hour kickoff buffer.',
    eligibleGames: 'Completed, untied FBS versus FBS games; all earlier eligible opponents stay in the strength graph.',
    accuracyTieCredit: 0.5,
    limitation: 'Corrected retrospective seasons, already familiar to this project. The 2021–22 seasons were held out from this calibration but helped select the original Strength settings. Historical source availability and future performance remain unverified.' },
  currentFormula: 'sigmoid((team A Strength minus team B Strength + signed venue * 2.5) / 14)',
  selectedFamily, selection, models, scaleSensitivity, archive: evaluation(onlyYears(archive, evaluationYears), models, config),
  repairedSensitivity: repaired ? evaluation(repaired, models, config) : null, sourceHashes,
  cfbdCalls: 0, productionChanges: false };
await mkdir(root + 'research/results', { recursive: true });
await writeFile(root + 'research/results/strength-probability-calibration.json', JSON.stringify(result, null, 2) + '\n');
const withoutBins = scores => Object.fromEntries(Object.entries(scores).map(([name, { reliability, ...rest }]) => [name, rest]));
console.log(JSON.stringify({ selectedFamily, selection, models, scaleSensitivity,
  archive: withoutBins(result.archive.pooled),
  originalStrengthHeldOut: withoutBins(result.archive.originalStrengthHeldOut),
  repairedSensitivity: result.repairedSensitivity ? withoutBins(result.repairedSensitivity.pooled) : null }, null, 2));
