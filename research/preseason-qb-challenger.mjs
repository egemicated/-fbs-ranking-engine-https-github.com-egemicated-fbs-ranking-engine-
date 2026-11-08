/** Test whether lagged school passing production improves preseason win odds. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { replayPreseason } from './preseason-team-baseline.mjs';

const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root)));
const trainingYears = [2022, 2023];
const evaluationYears = [2024, 2025];
const priorAttempts = 100;
const penalty = 0.01;

function schoolPassing(source, seasonsByYear, targetYear) {
  const players = new Map();
  const leaders = new Map();
  let attempts = 0;
  let yards = 0;
  for (let year = targetYear - 4; year < targetYear; year++) {
    const fbs = new Set(seasonsByYear.get(year).teams.filter(team => team.division === 'fbs').map(team => team.id));
    assert.ok(Array.isArray(source.seasons[year]), `Missing passing counts for ${year}`);
    const seen = new Set();
    for (const row of source.seasons[year]) {
      if (!fbs.has(row.teamId)) continue;
      assert.ok(typeof row.athleteId === 'string' && row.athleteId.length);
      assert.ok(Number.isInteger(row.attempts) && row.attempts >= 0 && Number.isInteger(row.yards));
      const key = `${row.teamId}:${row.athleteId}`;
      assert.ok(!seen.has(key), 'Duplicate player-team season');
      seen.add(key);
      if (!row.attempts) continue;
      const totals = players.get(row.athleteId) ?? { attempts: 0, yards: 0 };
      totals.attempts += row.attempts;
      totals.yards += row.yards;
      players.set(row.athleteId, totals);
      attempts += row.attempts;
      yards += row.yards;
      if (year === targetYear - 1) {
        const incumbent = leaders.get(row.teamId);
        if (!incumbent || row.attempts > incumbent.attempts ||
            (row.attempts === incumbent.attempts && row.athleteId < incumbent.athleteId)) leaders.set(row.teamId, row);
      }
    }
  }
  assert.ok(attempts > 0, `Missing prior FBS passing attempts for ${targetYear}`);
  const mean = yards / attempts;
  const rates = new Map([...leaders].map(([team, leader]) => {
    const counts = players.get(leader.athleteId);
    return [team, (counts.yards + priorAttempts * mean) / (counts.attempts + priorAttempts)];
  }));
  return { mean, rates };
}

function sigmoid(value) {
  const tail = Math.exp(-Math.abs(value));
  return value >= 0 ? 1 / (1 + tail) : tail / (1 + tail);
}

function fit(rows, columns) {
  const scale = columns.map(column => Math.sqrt(rows.reduce((sum, row) => sum + row[column] ** 2, 0) / rows.length));
  assert.ok(scale.every(value => value > 0 && Number.isFinite(value)), 'Calibration features need finite variation');
  const x = rows.map(row => columns.map((column, index) => row[column] / scale[index]));
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const objective = coefficients => x.reduce((sum, row, index) => {
    const z = dot(row, coefficients);
    return sum + Math.max(0, z) + Math.log1p(Math.exp(-Math.abs(z))) - rows[index].outcome * z;
  }, penalty * dot(coefficients, coefficients) / 2);
  let beta = columns.map(() => 0);
  for (let iteration = 0; iteration < 40; iteration++) {
    const gradient = beta.map(value => penalty * value);
    const hessian = beta.map((_, a) => beta.map((_, b) => a === b ? penalty : 0));
    for (const [index, row] of x.entries()) {
      const probability = sigmoid(dot(row, beta));
      for (let a = 0; a < beta.length; a++) {
        gradient[a] += row[a] * (probability - rows[index].outcome);
        for (let b = 0; b < beta.length; b++) hessian[a][b] += row[a] * row[b] * probability * (1 - probability);
      }
    }
    if (Math.max(...gradient.map(Math.abs)) < 1e-8) {
      return { columns, coefficients: beta.map((value, index) => value / scale[index]), trainingGames: rows.length };
    }
    let step;
    if (beta.length === 1) {
      step = [gradient[0] / hessian[0][0]];
    } else {
      const [[a, b], [, d]] = hessian;
      const determinant = a * d - b * b;
      assert.ok(determinant > 0, 'Calibration Hessian must be positive definite');
      step = [(d * gradient[0] - b * gradient[1]) / determinant, (a * gradient[1] - b * gradient[0]) / determinant];
    }
    const previous = objective(beta);
    let amount = 1;
    while (amount > 1e-8) {
      const candidate = beta.map((value, index) => value - amount * step[index]);
      if (objective(candidate) <= previous + 1e-9) {
        beta = candidate;
        break;
      }
      amount /= 2;
    }
    assert.ok(amount > 1e-8, 'Calibration line search failed');
  }
  throw new Error('Calibration did not converge');
}

function evaluate(rows, model) {
  let logLoss = 0;
  let brier = 0;
  let accuracy = 0;
  for (const row of rows) {
    const probability = sigmoid(model.columns.reduce((sum, column, index) => sum + row[column] * model.coefficients[index], 0));
    logLoss -= Math.log(Math.max(1e-12, row.outcome ? probability : 1 - probability));
    brier += (probability - row.outcome) ** 2;
    accuracy += probability === 0.5 ? 0.5 : Number((probability > 0.5) === Boolean(row.outcome));
  }
  return { games: rows.length, logLoss: logLoss / rows.length, brier: brier / rows.length, accuracy: accuracy / rows.length };
}

const sourceBytes = await readFile(new URL('research/cache/preseason-player/passing-seasons.json', root));
const source = JSON.parse(sourceBytes);
const config = await read('data/model.json');
const seasons = await Promise.all(Array.from({ length: 22 }, (_, index) => read(`data/seasons/${2004 + index}.json`)));
const byYear = new Map(seasons.map(season => [season.year, season]));
const years = [...trainingYears, ...evaluationYears];
const passing = new Map(years.map(year => [year, schoolPassing(source, byYear, year)]));
const { rows: fixtures } = replayPreseason(seasons, config, years);
const rows = fixtures.map(game => {
  const { rates, mean } = passing.get(game.season);
  return { ...game, strength: game.edges.fourYears,
    priorPassing: (rates.get(game.home) ?? mean) - (rates.get(game.away) ?? mean),
    bothLeadersObserved: rates.has(game.home) && rates.has(game.away) };
});
const train = rows.filter(row => trainingYears.includes(row.season));
const test = rows.filter(row => evaluationYears.includes(row.season));
const models = { strength: fit(train, ['strength']), strengthWithPriorPassing: fit(train, ['strength', 'priorPassing']) };
function compare(cohort) {
  const scores = Object.fromEntries(Object.entries(models).map(([name, model]) => [name, evaluate(cohort, model)]));
  return { ...scores, bothLeadersObserved: cohort.filter(row => row.bothLeadersObserved).length,
    pairedDelta: { logLoss: scores.strengthWithPriorPassing.logLoss - scores.strength.logLoss,
      brier: scores.strengthWithPriorPassing.brier - scores.strength.brier } };
}
const report = {
  sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'), trainingYears, evaluationYears, priorAttempts, penalty, models,
  feature: 'Find each school’s leading passer by recorded attempts in t−1. Pool that athlete’s FBS yards and attempts across t−4…t−1, shrink toward the same window’s FBS mean, and use the home-away difference. An unavailable leader receives that neutral mean.',
  scope: 'Lagged school predictor using recorded passing production. Each preseason replay assumes the archived fixture list. Player roles, school membership and playing time in the forecast season are outside this feature.',
  evaluation: compare(test), byYear: Object.fromEntries(evaluationYears.map(year => [year, compare(test.filter(row => row.season === year))])),
  cfbdCalls: 0,
};
await writeFile(new URL('research/cache/preseason-player/team-passing-challenger.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
