/** Score the frozen 2027 preseason trial against local normalized outcomes. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertNoLogicalDuplicates } from '../src/data-quality.js';
import { validateSeason } from '../src/engine.js';
import { isPostseasonOrTitle } from './preseason-trial-capture.mjs';

const configPath = fileURLToPath(new URL('../preseason-preview/data/trial-2027.json', import.meta.url));
const enginePath = fileURLToPath(new URL('../src/engine.js', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const day = 86_400_000;
const epsilon = 1e-12;
const modelNames = ['baseline', 'challenger'];
const scoreNames = ['brier', 'logLoss', 'accuracy', 'winTotalMae'];

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function instant(value, label) {
  const valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value);
  const time = valid ? Date.parse(value) : NaN;
  const date = valid ? Date.parse(`${value.slice(0, 10)}T00:00:00Z`) : NaN;
  requireValid(Number.isFinite(time) && Number.isFinite(date) &&
    new Date(date).toISOString().slice(0, 10) === value.slice(0, 10), `Invalid ${label} timestamp`);
  return time;
}

function indexIds(items, label) {
  requireValid(Array.isArray(items) && items.length > 0, `Missing ${label}`);
  const byId = new Map();
  for (const item of items) {
    requireValid(typeof item?.id === 'string' && item.id && !byId.has(item.id), `Invalid or duplicate ${label} ID`);
    byId.set(item.id, item);
  }
  return byId;
}

function verifyForecast(forecast, config, scoredAt, inputHashes) {
  const { integritySha256, ...payload } = forecast;
  requireValid(sha(JSON.stringify(payload)) === integritySha256, 'Frozen forecast integrity mismatch');
  requireValid(forecast.schemaVersion === 1 && config.schemaVersion === 1 &&
    forecast.trialId === config.trialId && forecast.season === config.season,
  'Forecast does not belong to the configured trial');
  const hashes = forecast.sourceHashes;
  requireValid(forecast.source && hashes && ['protocol', 'engine', 'capture', 'schedule'].every(key => isDigest(hashes[key])) &&
    hashes.history && Object.values(hashes.history).length && Object.values(hashes.history).every(isDigest),
  'Missing or invalid frozen source provenance');
  requireValid(hashes.engine === config.engineSha256, 'Forecast engine does not match the trial pin');
  for (const key of ['protocol', 'engine']) {
    requireValid(inputHashes[key] === undefined || inputHashes[key] === hashes[key],
      `Local ${key} does not match the frozen forecast`);
  }
  const captured = instant(forecast.capturedAt, 'capture');
  const opening = instant(forecast.openingKickoff, 'declared opening kickoff');
  requireValid(captured < opening && captured <= scoredAt, 'Forecast was not captured before kickoff or scoring');

  const teams = indexIds(forecast.teams, 'frozen team');
  const games = indexIds(forecast.games, 'frozen fixture');
  for (const game of games.values()) {
    requireValid(teams.get(game.home)?.division === 'fbs' && teams.get(game.away)?.division === 'fbs' &&
      game.home !== game.away && typeof game.neutral === 'boolean' &&
      (game.startTimeTbd === undefined || typeof game.startTimeTbd === 'boolean'), `Invalid frozen matchup ${game.id}`);
    const kickoff = instant(game.startDate, `frozen fixture ${game.id}`);
    if (game.startTimeTbd !== false) {
      const scheduledDay = Math.floor(kickoff / day) * day;
      requireValid(scheduledDay >= Math.floor(opening / day) * day, `Frozen fixture ${game.id} precedes the declared opener`);
      requireValid(captured < scheduledDay, `Uncertain pre-kickoff capture for ${game.id}`);
    } else {
      requireValid(opening <= kickoff, `Frozen fixture ${game.id} precedes the declared opener`);
    }
    for (const model of modelNames) {
      const p = game[`${model}Probability`];
      requireValid(Number.isFinite(p) && p > 0 && p < 1, `Invalid ${model} probability for ${game.id}`);
    }
  }
  assertNoLogicalDuplicates(forecast.games.map(game => ({ ...game, completed: true })));
  return { captured, teams, games };
}

function weekStart(startDate) {
  const kickoff = new Date(startDate);
  const midnight = Date.parse(`${kickoff.toISOString().slice(0, 10)}T00:00:00Z`);
  return new Date(midnight - ((kickoff.getUTCDay() + 6) % 7) * day).toISOString().slice(0, 10);
}

function pairedScores(rows, teamFilter = () => true) {
  const scores = {};
  for (const model of modelNames) {
    let brier = 0, logLoss = 0, accuracy = 0;
    const teams = new Map();
    for (const { game, outcome } of rows) {
      const p = game[`${model}Probability`];
      brier += (p - outcome) ** 2;
      logLoss -= Math.log(Math.max(epsilon, outcome ? p : 1 - p));
      accuracy += p === .5 ? .5 : Number((p > .5) === Boolean(outcome));
      for (const [team, expected, actual] of [[game.home, p, outcome], [game.away, 1 - p, 1 - outcome]]) {
        if (teamFilter(team)) teams.set(team, (teams.get(team) ?? 0) + expected - actual);
      }
    }
    scores[model] = {
      brier: rows.length ? brier / rows.length : null,
      logLoss: rows.length ? logLoss / rows.length : null,
      accuracy: rows.length ? accuracy / rows.length : null,
      winTotalMae: teams.size ? [...teams.values()].reduce((sum, error) => sum + Math.abs(error), 0) / teams.size : null,
      teamCount: teams.size,
    };
  }
  return scores;
}

function deltas(scores) {
  return Object.fromEntries(scoreNames.map(metric => [metric, scores.baseline[metric] === null ? null :
    scores.challenger[metric] - scores.baseline[metric]]));
}

function groupScores(frozen, rows, includes, teamFilter) {
  const relevant = rows.filter(row => includes(row.game));
  const outside = rows.filter(row => !includes(row.game));
  const metrics = pairedScores(relevant, teamFilter);
  return { frozenGames: frozen.filter(includes).length, games: relevant.length, metrics, deltas: deltas(metrics),
    without: { games: outside.length, deltas: deltas(pairedScores(outside)) } };
}

export function scoreTrial(forecast, results, config, { scoredAt = new Date().toISOString(), inputHashes = {} } = {}) {
  const scoreTime = instant(scoredAt, 'scoring');
  const { captured, teams, games } = verifyForecast(forecast, config, scoreTime, inputHashes);
  validateSeason(results);
  requireValid(results.year === config.season, 'Outcome season does not match the trial');
  requireValid(results.games.every(game => typeof game.id === 'string'), 'Outcome IDs must be normalized strings');
  assertNoLogicalDuplicates(results.games);
  const outcomes = new Map(results.games.map(game => [game.id, game]));
  const fbs = new Set(results.teams.filter(team => team.division === 'fbs').map(team => team.id));
  requireValid(fbs.size, 'Outcome season has no FBS teams');
  const frozenFbs = [...teams.values()].filter(team => team.division === 'fbs');
  const openingTeams = new Set([...fbs, ...frozenFbs.map(team => team.id)]);
  const regular = game => !isPostseasonOrTitle(game);
  let firstCompletedKickoff = Infinity;
  for (const game of results.games) {
    if (!game.completed || !regular(game) || (!openingTeams.has(game.home) && !openingTeams.has(game.away))) continue;
    const kickoff = instant(game.startDate, `outcome fixture ${game.id}`);
    requireValid(kickoff < scoreTime, `Completed fixture ${game.id} has not kicked off at scoring time`);
    firstCompletedKickoff = Math.min(firstCompletedKickoff, kickoff);
  }
  requireValid(captured < firstCompletedKickoff, 'Forecast capture follows an actual FBS opening kickoff');

  const scored = [], changed = [], unresolved = [], kickoffChanges = [];
  for (const game of games.values()) {
    const final = outcomes.get(game.id);
    if (!final) {
      unresolved.push({ id: game.id, reason: 'missing-outcome-id' });
      continue;
    }
    const reasons = [];
    if (final.home !== game.home || final.away !== game.away) reasons.push('changed-participant-orientation');
    if (final.neutral !== game.neutral) reasons.push('changed-neutral-designation');
    if (!regular(final)) reasons.push('changed-season-scope');
    if (!fbs.has(final.home) || !fbs.has(final.away)) reasons.push('changed-fbs-scope');
    const kickoff = instant(final.startDate, `outcome fixture ${game.id}`);
    const frozenKickoff = instant(game.startDate, `frozen fixture ${game.id}`);
    const tied = final.homePoints === final.awayPoints;
    const willScore = !reasons.length && final.completed && !tied;
    if (kickoff !== frozenKickoff) kickoffChanges.push({ id: game.id, frozenStartDate: game.startDate,
      outcomeStartDate: final.startDate, frozenTimeTbd: game.startTimeTbd ?? null, scored: willScore });
    if (reasons.length) {
      changed.push({ id: game.id, reasons, outcomeHome: final.home, outcomeAway: final.away,
        outcomeNeutral: final.neutral, outcomeSeasonType: final.seasonType });
    } else if (!willScore) {
      unresolved.push({ id: game.id, reason: final.completed ? 'tied-final' : 'not-completed' });
    } else {
      scored.push({ game, outcome: Number(final.homePoints > final.awayPoints) });
    }
  }
  const added = results.games.filter(game => !games.has(game.id) && regular(game) && fbs.has(game.home) && fbs.has(game.away));
  const coverage = { frozen: games.size, scored: scored.length, unresolved: unresolved.length,
    changed: changed.length, added: added.length, kickoffChanges: kickoffChanges.length,
    scoredWithKickoffChanges: kickoffChanges.filter(game => game.scored).length,
    frozenTimeKnown: forecast.games.filter(game => game.startTimeTbd === false).length,
    frozenTimeTbd: forecast.games.filter(game => game.startTimeTbd === true).length,
    frozenTimeStatusUnknown: forecast.games.filter(game => game.startTimeTbd === undefined).length };
  requireValid(coverage.scored + coverage.unresolved + coverage.changed === coverage.frozen,
    'Frozen coverage does not reconcile');
  const conference = id => teams.get(id).conference || 'Independent / unassigned';
  const conferences = [...new Set(frozenFbs.map(team => conference(team.id)))].sort();
  const byConference = conferences.map(name => ({ conference: name,
    ...groupScores(forecast.games, scored, game => conference(game.home) === name || conference(game.away) === name,
      id => conference(id) === name) }));
  const weeks = [...new Set(forecast.games.map(game => weekStart(game.startDate)))].sort();
  const byWeek = weeks.map(week => ({ weekStart: week,
    ...groupScores(forecast.games, scored, game => weekStart(game.startDate) === week) }));
  const byTeam = frozenFbs.sort((a, b) => a.id.localeCompare(b.id)).map(team => {
    const includes = game => game.home === team.id || game.away === team.id;
    const rows = scored.filter(row => includes(row.game));
    const metrics = pairedScores(rows, id => id === team.id);
    return { id: team.id, name: team.name ?? team.team ?? team.id, conference: conference(team.id),
      frozenGames: forecast.games.filter(includes).length, games: rows.length, metrics, deltas: deltas(metrics) };
  });
  const metrics = pairedScores(scored);
  return { schemaVersion: 1, trialId: forecast.trialId, season: forecast.season, scoredAt,
    forecastIntegritySha256: forecast.integritySha256,
    firstCompletedFbsKickoff: Number.isFinite(firstCompletedKickoff) ? new Date(firstCompletedKickoff).toISOString() : null,
    coverage, metrics, deltas: deltas(metrics), byConference, byWeek, byTeam,
    excluded: { unresolved, changed, added: added.map(game => ({ id: game.id, home: game.home, away: game.away,
      completed: game.completed, startDate: game.startDate })) }, kickoffChanges,
    scope: 'Scores use only resolved frozen FBS–FBS games with the same ID, teams and home/away designation, and neutral designation. Kickoff moves do not change eligibility. Added IDs may include conference title games if the outcome source labels them regular without a separate flag.',
    interpretation: 'Win-total MAE compares sums of probabilities and wins on this common resolved slate only. Conference slices include any game involving a member, with cross-conference games appearing in both slices. Leave-one-conference-out removes all games involving a member. Weeks start Monday UTC using frozen dates. Zero-game metrics are null. The forecast digest verifies content consistency and must be checked against the pre-season published digest to establish provenance.',
    logLossProbabilityFloor: epsilon,
  };
}

async function writeReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    forecast: { type: 'string' }, results: { type: 'string' }, output: { type: 'string' },
  } });
  requireValid(values.forecast && values.results && values.output,
    'Usage: node research/preseason-trial-score.mjs --forecast path --results path --output path');
  const inputPaths = await Promise.all([values.forecast, values.results, configPath, enginePath].map(path => realpath(path)));
  const output = resolve(values.output);
  const canonicalOutput = await realpath(output).catch(error => {
    if (error.code === 'ENOENT') return output;
    throw error;
  });
  const comparable = path => process.platform === 'win32' ? path.toLowerCase() : path;
  requireValid(!inputPaths.some(path => comparable(path) === comparable(canonicalOutput)),
    'Output must be separate from the frozen forecast, outcomes, trial config and engine');
  const [forecastBytes, resultsBytes, configBytes, engineBytes] = await Promise.all(inputPaths.map(path => readFile(path)));
  const inputHashes = { protocol: sha(configBytes), engine: sha(engineBytes) };
  const report = scoreTrial(JSON.parse(forecastBytes), JSON.parse(resultsBytes), JSON.parse(configBytes), { inputHashes });
  report.provenance = { forecastFileSha256: sha(forecastBytes), outcomeFileSha256: sha(resultsBytes),
    trialConfigSha256: inputHashes.protocol, engineSha256: inputHashes.engine };
  await writeReport(output, report);
  console.log(JSON.stringify({ output, coverage: report.coverage, metrics: report.metrics }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
