/** Season-ahead, schedule-conditional team baselines from cached game results. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VERSION, rankSeason } from '../src/engine.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const day = 86_400_000;
const families = ['fourYears', 'allEarlier', 'oneYear'];
const calibrationYears = [2014, 2015, 2016, 2017, 2018, 2019];
const evaluationYears = [2021, 2022, 2023, 2024, 2025];
const originalStrengthHoldoutYears = [2023, 2024, 2025];
const scope = 'Archive regular-tagged FBS–FBS fixtures, including some conference title games.';

function previousStrength(seasons, config) {
  return seasons.reduce((previous, season) => rankSeason(season, { config, previous }), null);
}

function preseasonStrength(season, previous, config) {
  // Deliberately pass no target-season game objects to the rating engine.
  const snapshot = rankSeason({ year: season.year, teams: season.teams, games: [] }, { config, previous });
  assert.equal(snapshot.gamesUsed, 0);
  return new Map(snapshot.rankings.map(team => [team.id, team.strength]));
}

export function replayPreseason(seasons, config, years) {
  const ordered = [...seasons].sort((a, b) => a.year - b.year);
  const byYear = new Map(ordered.map(season => [season.year, season]));
  assert.equal(byYear.size, ordered.length, 'Duplicate season in archive');
  const requested = new Set(years);
  const lastRequestedYear = Math.max(...requested);
  const checkpoints = {};
  const rows = [];
  let allEarlier = null;
  let latestPriorResult = -Infinity;
  for (const season of ordered) {
    const { year } = season;
    if (requested.has(year)) {
      const fbs = season.teams.filter(team => team.division === 'fbs');
      const ids = new Set(fbs.map(team => team.id));
      const regular = season.games.filter(game => game.seasonType === 'regular');
      const opening = Math.min(...regular.filter(game => ids.has(game.home) || ids.has(game.away))
        .map(game => Date.parse(game.startDate)));
      assert.ok(Number.isFinite(opening) && latestPriorResult <= opening, `Prior results cross the opening cutoff for ${year}`);
      const windowYears = [year - 4, year - 3, year - 2, year - 1];
      const window = windowYears.map(priorYear => byYear.get(priorYear));
      assert.ok(window.every(Boolean) && allEarlier?.season === year - 1, `Incomplete prior history for ${year}`);
      const prior = { fourYears: previousStrength(window, config), allEarlier,
        oneYear: previousStrength(window.slice(-1), config) };
      const strength = Object.fromEntries(families.map(family => [family, preseasonStrength(season, prior[family], config)]));
      const fixtures = regular.filter(game => ids.has(game.home) && ids.has(game.away)).map(game => {
        const venue = game.neutral ? 0 : config.homeAdvantage;
        const edges = Object.fromEntries(families.map(family => [family,
          strength[family].get(game.home) - strength[family].get(game.away) + venue]));
        const decided = game.completed && game.homePoints !== game.awayPoints;
        return { season: year, gameId: game.id, home: game.home, away: game.away, week: game.week,
          neutral: game.neutral, startDate: game.startDate, edges,
          outcome: decided ? Number(game.homePoints > game.awayPoints) : null,
          homePoints: game.completed ? game.homePoints : null, awayPoints: game.completed ? game.awayPoints : null };
      }).sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate) || a.gameId.localeCompare(b.gameId));
      const decided = fixtures.filter(game => game.outcome !== null);
      rows.push(...decided);
      checkpoints[year] = { cutoff: new Date(opening).toISOString(), windowYears, fixtures,
        teams: fbs.map(team => ({ id: team.id, team: team.name, conference: team.conference ?? null,
          strength: strength.fourYears.get(team.id) })),
        archiveFixtures: fixtures.length, decidedFixtures: decided.length };
    }
    // This season enters the history only after its own forecasts exist.
    if (year < lastRequestedYear) {
      allEarlier = rankSeason(season, { config, previous: allEarlier });
      for (const game of season.games) if (game.completed) {
        latestPriorResult = Math.max(latestPriorResult, Date.parse(game.startDate) + day);
      }
    }
  }
  assert.equal(Object.keys(checkpoints).length, requested.size, 'Requested season missing from archive');
  return { rows, checkpoints };
}

function sigmoid(logOdds) {
  const small = Math.exp(-Math.abs(logOdds));
  return logOdds >= 0 ? 1 / (1 + small) : small / (1 + small);
}

function fitScale(rows, family, unit) {
  // Convex one-parameter logistic fit with a small fixed slope penalty.
  // Standardize by the existing link, then report native-point scale.
  const penalty = 0.01;
  const gradient = slope => rows.reduce((sum, game) => {
    const value = game.edges[family] / unit;
    return sum + value * (sigmoid(value * slope) - game.outcome);
  }, penalty * slope);
  assert.ok(rows.length > 0 && gradient(0) < 0, `Calibration requires a positive signal for ${family}`);
  let low = 0;
  let high = 1;
  while (gradient(high) < 0) high *= 2;
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    if (gradient(middle) < 0) low = middle;
    else high = middle;
  }
  const slope = (low + high) / 2;
  assert.ok(Math.abs(gradient(slope)) < 1e-8, 'Calibration did not converge');
  return { scale: unit / slope, logOddsPerPoint: slope / unit, trainingGames: rows.length,
    trainingYears: calibrationYears, standardizedSlopePenalty: penalty };
}

function winsByTeam(games, probability) {
  const wins = new Map();
  for (const game of games) {
    const p = probability(game);
    for (const [id, expected, actual] of [[game.home, p, game.outcome],
      [game.away, 1 - p, game.outcome === null ? null : 1 - game.outcome]]) {
      const key = `${game.season}:${id}`;
      const row = wins.get(key) ?? { expectedWins: 0, actualWins: 0, games: 0 };
      row.expectedWins += expected;
      row.actualWins += actual ?? 0;
      row.games++;
      wins.set(key, row);
    }
  }
  return wins;
}

function evaluate(rows, family, model) {
  assert.ok(rows.length > 0, 'Empty evaluation cohort');
  const probability = game => sigmoid(game.edges[family] / model.scale);
  const bins = Array.from({ length: 10 }, () => ({ games: 0, predictions: 0, wins: 0 }));
  let logLoss = 0;
  let brier = 0;
  let accuracy = 0;
  for (const game of rows) {
    const p = probability(game);
    const y = game.outcome;
    logLoss -= Math.log(Math.max(1e-12, y ? p : 1 - p));
    brier += (p - y) ** 2;
    accuracy += p === 0.5 ? 0.5 : Number((p > 0.5) === Boolean(y));
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.games++;
    bin.predictions += p;
    bin.wins += y;
  }
  const teams = [...winsByTeam(rows, probability).values()];
  return { games: rows.length, logLoss: logLoss / rows.length, brier: brier / rows.length,
    accuracy: accuracy / rows.length, teamSeasons: teams.length,
    expectedWinsMAE: teams.reduce((sum, row) => sum + Math.abs(row.expectedWins - row.actualWins), 0) / teams.length,
    fixedBinCalibrationError: bins.reduce((sum, bin) => sum + Math.abs(bin.predictions - bin.wins), 0) / rows.length,
    reliability: bins.flatMap((bin, index) => bin.games ? [{ range: [index / 10, (index + 1) / 10], games: bin.games,
      meanProbability: bin.predictions / bin.games, observedHomeWinRate: bin.wins / bin.games }] : []) };
}

function preview(season, checkpoint, model, completedCohort) {
  const games = checkpoint.fixtures.filter(game => !completedCohort || game.outcome !== null).map(game => {
    const edge = game.edges.fourYears;
    const homeProbability = sigmoid(edge / model.scale);
    return { ...game, edge, homeProbability, awayProbability: 1 - homeProbability,
      outcome: completedCohort ? game.outcome : null,
      homePoints: completedCohort ? game.homePoints : null, awayPoints: completedCohort ? game.awayPoints : null };
  });
  const wins = winsByTeam(games, game => game.homeProbability);
  const teams = [...checkpoint.teams].sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
  let rank = 0;
  for (const [index, team] of teams.entries()) {
    if (index === 0 || Math.abs(team.strength - teams[index - 1].strength) > 1e-9) rank = index + 1;
    const row = wins.get(`${season}:${team.id}`);
    Object.assign(team, { rank, games: row?.games ?? 0, expectedWins: row?.expectedWins ?? null,
      actualWins: completedCohort && row ? row.actualWins : null });
  }
  return { season, cutoff: checkpoint.cutoff, windowYears: checkpoint.windowYears, scope,
    scheduleConditional: true, completedCohort, teams, games,
    description: completedCohort ? 'Historical reconstruction over decided archive fixtures.' :
      'Team-only reconstruction over the available archived schedule, shown before target results are considered.' };
}

async function main() {
  const sourceHashes = {};
  async function load(path) {
    const bytes = await readFile(root + path);
    sourceHashes[path] = createHash('sha256').update(bytes).digest('hex');
    return JSON.parse(bytes);
  }
  const config = await load('data/model.json');
  const seasons = await Promise.all(Array.from({ length: 22 }, (_, index) => load(`data/seasons/${2004 + index}.json`)));
  try {
    seasons.push(await load('data/seasons/2026.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const previewYears = [2025, ...seasons.filter(season => season.year === 2026).map(season => season.year)];
  const { rows, checkpoints } = replayPreseason(seasons, config, [...calibrationYears, ...evaluationYears, ...previewYears]);
  const select = years => rows.filter(game => years.includes(game.season));
  const train = select(calibrationYears);
  const models = Object.fromEntries(families.map(family => [family, fitScale(train, family, config.probabilityScale)]));
  const compare = years => Object.fromEntries(families.map(family => [family, evaluate(select(years), family, models[family])]));
  const evaluation = { allYears: compare(evaluationYears), originalStrengthHoldout: compare(originalStrengthHoldoutYears),
    byYear: Object.fromEntries(evaluationYears.map(year => [year, compare([year])])) };
  const previews = Object.fromEntries(previewYears.map(year => [year, preview(year, checkpoints[year], models.fourYears, year === 2025)]));
  for (const path of ['src/engine.js', 'research/preseason-team-baseline.mjs']) {
    sourceHashes[path] = createHash('sha256').update(await readFile(root + path)).digest('hex');
  }
  const report = { modelVersion: VERSION, config, scope, calibrationYears, evaluationYears, originalStrengthHoldoutYears,
    protocol: { cutoff: 'Earliest archived FBS-involving regular-tagged kickoff in the target season.',
      fourYears: 'Start from neutral in t−4, use completed records in t−4 through t−1, then carry the usual decayed Strength into an empty target graph.',
      allEarlier: 'Run the same Strength chain from the start of the archive through t−1.',
      oneYear: 'Start from neutral in t−1 and carry its Strength into an empty target graph.',
      evaluation: 'Identical decided archive FBS–FBS fixtures across models. Fit each logistic scale on the older calibration years.',
      expectedWins: 'Sum win probabilities over the reported fixture cohort. Error is averaged across team-seasons in that cohort.',
      limitations: 'Corrected retrospective records and realized schedules. Older season completeness varies. The original Strength settings used 2019–2022 for selection. The 2023–2025 split holds those later years out of the preseason scale fit and original Strength selection.' },
    sourceHashes: Object.fromEntries(Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b))),
    models, evaluation, previews, cfbdCalls: 0 };
  const directory = root + 'research/cache/preseason-team-baseline';
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/result.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ path: 'research/cache/preseason-team-baseline/result.json', models,
    originalStrengthHoldout: Object.fromEntries(Object.entries(evaluation.originalStrengthHoldout)
      .map(([family, { reliability, ...metrics }]) => [family, metrics])),
    previews: previewYears.map(year => ({ year, teams: previews[year].teams.length, games: previews[year].games.length })) }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
