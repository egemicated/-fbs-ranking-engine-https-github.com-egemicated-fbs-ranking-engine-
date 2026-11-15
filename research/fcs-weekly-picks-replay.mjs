import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rankSeason, VERSION } from '../src/engine.js';

// Locked before evaluating: train one probability scale on 2014–19. Report
// 2021–25 as retrospective held-out seasons; the spring 2020 archive is sparse.
const fitYears = [2014, 2015, 2016, 2017, 2018, 2019];
const evaluationYears = [2021, 2022, 2023, 2024, 2025];
// Pass the path to the local archive, followed by --release to emit the serving config.
const args = process.argv.slice(2);
const archiveRoot = args.find(arg => arg !== '--release') ?? '.';
const archiveName = 'research/datasets/fcs-coverage-v1/seasons';
const cutoffBuffer = 86_400_000;
const sourceHashes = {};
async function readJson(root, path) {
  const bytes = await readFile(join(root, path));
  if (root === archiveRoot) sourceHashes[path] = createHash('sha256').update(bytes).digest('hex');
  return JSON.parse(bytes);
}
const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('data/model.json', root)));
const fbsScale = JSON.parse(await readFile(new URL('data/matchup-validation.json', root))).winProbability.scale;
const logistic = value => 1 / (1 + Math.exp(-value));
const bucket = game => `${game.seasonType}:${game.week}`;

async function replay(year) {
  const [season, previous] = await Promise.all([
    readJson(archiveRoot, `${archiveName}/${year}.json`),
    readJson(archiveRoot, `data/snapshots/${year - 1}.json`),
  ]);
  assert.equal(season.year, year);
  assert.equal(previous.season, year - 1);
  assert.deepEqual(previous.config, config);
  const fcs = new Set(season.teams.filter(team => team.division === 'fcs').map(team => team.id));
  const isTarget = game => fcs.has(game.home) && fcs.has(game.away);
  const groups = Map.groupBy(season.games, bucket);
  const weeks = [...groups.values()].map(games => {
    const targets = games.filter(isTarget);
    return { games, targets, cutoff: Math.min(...(targets.length ? targets : games).map(game => Date.parse(game.startDate))) };
  }).sort((a, b) => a.cutoff - b.cutoff);
  const seen = [];
  const rows = [];
  let tiedFinals = 0;
  for (const { games, targets, cutoff } of weeks) {
    const decided = targets.filter(game => game.completed && game.homePoints !== game.awayPoints);
    tiedFinals += targets.filter(game => game.completed && game.homePoints === game.awayPoints).length;
    if (decided.length) {
      const eligible = new Set(seen.filter(game => Date.parse(game.startDate) + cutoffBuffer <= cutoff).map(game => game.id));
      assert.ok(games.every(game => !eligible.has(game.id)));
      assert.ok(eligible.size === 0 || seen.every(game => !eligible.has(game.id) || Date.parse(game.startDate) < cutoff));
      const snapshot = rankSeason(season, { config, previous, gameIds: eligible });
      const teams = new Map(snapshot.ratings.map(row => [row.id, row]));
      for (const game of decided) {
        assert.ok(cutoff <= Date.parse(game.startDate));
        const h = teams.get(game.home), a = teams.get(game.away);
        const venue = game.neutral ? 0 : config.homeAdvantage;
        rows.push({
          year, neutral: game.neutral, outcome: Number(game.homePoints > game.awayPoints),
          edge: h.strength - a.strength + venue,
          preseason: h.preseasonStrength - a.preseasonStrength + venue,
          established: Math.min(h.games, a.games) >= 4,
        });
      }
    }
    seen.push(...games.filter(game => game.completed));
  }
  const finals = season.games.filter(game => game.completed && isTarget(game)).length;
  assert.equal(rows.length + tiedFinals, finals);
  return { rows, coverage: { teams: fcs.size, finals, tiedFinals } };
}

function fitScale(rows, field) {
  const derivative = slope => rows.reduce((sum, row) =>
    sum + row[field] * (logistic(slope * row[field]) - row.outcome), 0);
  let low = 0, high = 1;
  assert.ok(derivative(low) < 0 && derivative(high) > 0, 'calibration requires a finite positive slope');
  for (let i = 0; i < 64; i++) {
    const middle = (low + high) / 2;
    if (derivative(middle) > 0) high = middle;
    else low = middle;
  }
  return 2 / (low + high);
}

function score(rows, predict) {
  let picked = 0, correct = 0, brier = 0, logLoss = 0;
  const nearSeventy = { games: 0, probability: 0, wins: 0 };
  for (const row of rows) {
    const p = predict(row);
    const favoriteWon = (p > 0.5) === Boolean(row.outcome);
    if (p !== 0.5) {
      picked++;
      correct += Number(favoriteWon);
    }
    brier += (p - row.outcome) ** 2;
    logLoss -= Math.log(Math.max(1e-12, row.outcome ? p : 1 - p));
    const chance = Math.max(p, 1 - p);
    if (chance >= 0.65 && chance < 0.75) {
      nearSeventy.games++;
      nearSeventy.probability += chance;
      nearSeventy.wins += Number(favoriteWon);
    }
  }
  const { games, probability, wins } = nearSeventy;
  return { games: rows.length, picked, correct, accuracy: picked ? correct / picked : null,
    accuracyWithHalfCreditForEven: (correct + (rows.length - picked) / 2) / rows.length,
    brier: brier / rows.length, logLoss: logLoss / rows.length,
    nearSeventy: { games, meanForecast: games ? probability / games : null, actualWinRate: games ? wins / games : null } };
}

const years = [...fitYears, ...evaluationYears];
const results = new Map(await Promise.all(years.map(async year => [year, await replay(year)])));
const forYears = selected => selected.flatMap(year => results.get(year).rows);
const training = forYears(fitYears);
const evaluation = forYears(evaluationYears);
const nonNeutral = training.filter(row => !row.neutral);
const homeRate = nonNeutral.reduce((sum, row) => sum + row.outcome, 0) / nonNeutral.length;
const scale = fitScale(training, 'edge');
const preseasonScale = fitScale(training, 'preseason');
const models = {
  calibrated: row => logistic(row.edge / scale),
  uncalibrated: row => logistic(row.edge / config.probabilityScale),
  fbsTransfer: row => logistic(row.edge / fbsScale),
  venueOnly: row => row.neutral ? 0.5 : homeRate,
  preseasonOnly: row => logistic(row.preseason / preseasonScale),
};
const compare = rows => Object.fromEntries(Object.entries(models).map(([key, predict]) => [key, score(rows, predict)]));
const pooled = compare(evaluation);
const byYear = Object.fromEntries(evaluationYears.map(year => [year, compare(results.get(year).rows)]));
const latestThree = compare(forYears([2023, 2024, 2025]));
const improved = sample => ['uncalibrated', 'venueOnly', 'preseasonOnly'].every(key =>
  sample.calibrated.brier < sample[key].brier && sample.calibrated.logLoss < sample[key].logLoss);
const reliability = pooled.calibrated.nearSeventy;
const gates = {
  beatsBaselines: improved(pooled) && improved(latestThree),
  beatsNaiveWinner: pooled.calibrated.accuracyWithHalfCreditForEven > pooled.venueOnly.accuracyWithHalfCreditForEven &&
    pooled.calibrated.accuracyWithHalfCreditForEven > pooled.preseasonOnly.accuracyWithHalfCreditForEven,
  noMaterialSeasonRegression: Object.values(byYear).every(year => year.calibrated.brier <= year.uncalibrated.brier + 0.002),
  reliabilityNearSeventy: reliability.games >= 150 && Math.abs(reliability.meanForecast - reliability.actualWinRate) <= 0.05,
};
const report = {
  schemaVersion: 1, population: 'fcs-fcs', modelVersion: VERSION, strengthConfig: config, scale,
  source: 'fcs-coverage-v1 outcome archive and the original earlier-season Strength snapshots',
  method: 'One positive logistic slope fitted to preweek Strength margins with home advantage',
  fit: { seasons: fitYears, games: training.length, venueHomeWinRate: homeRate, preseasonScale },
  evaluation: { seasons: evaluationYears, pooled, latestThree, byYear,
    established: compare(evaluation.filter(row => row.established)),
    early: compare(evaluation.filter(row => !row.established)),
    neutral: compare(evaluation.filter(row => row.neutral)) },
  coverage: Object.fromEntries([...results].map(([year, result]) => [year, result.coverage])),
  gates, approvedForWeeklyPicks: Object.values(gates).every(Boolean),
  limitations: ['Corrected archive with a 24-hour results buffer. Historical as-of availability is reconstructed.',
    'The general Strength model and source seasons have prior project use.',
    'Sparse 2020 FCS results were excluded as targets; archived 2020 priors remain for 2021.',
    'Provider coverage and venue labels can vary. Neutral-site evidence is limited.'],
  sourceHashes,
};

function releaseConfig() {
  assert.ok(report.approvedForWeeklyPicks, 'FCS replay did not pass');
  const { evaluation: detail, coverage, gates, sourceHashes, limitations, approvedForWeeklyPicks, ...identity } = report;
  const metrics = ({ games, picked, correct, accuracy, brier, logLoss, nearSeventy }) =>
    ({ games, picked, correct, accuracy, brier, logLoss, nearSeventy });
  return { ...identity,
    evaluation: { firstSeason: detail.seasons[0], lastSeason: detail.seasons.at(-1), ...metrics(detail.pooled.calibrated) },
    baseline: Object.fromEntries(Object.entries(detail.pooled).filter(([id]) => id !== 'calibrated').map(([id, row]) => [id, metrics(row)])),
    bySeason: Object.fromEntries(Object.entries(detail.byYear).map(([year, stats]) => [year, metrics(stats.calibrated)])),
    byCoverage: { earlySeason: metrics(detail.early.calibrated), established: metrics(detail.established.calibrated), neutralSite: metrics(detail.neutral.calibrated) },
    coverage, gates, sourceHashes, limitations, approvedForWeeklyPicks };
}
console.log(JSON.stringify(args.includes('--release') ? releaseConfig() : report, null, 2));
