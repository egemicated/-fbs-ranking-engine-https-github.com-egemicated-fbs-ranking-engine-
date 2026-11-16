// Score paired forecasts from the validated refresh without accessing a provider.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicJson } from '../src/ingest.js';
import { recentFormObservationHash } from './capture-recent-form-shadow.mjs';

const day = 86_400_000;
const protocolPath = 'research/frozen-recent-form-shadow-v1.json';
const observationDirectory = 'research/recent-form-observations';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && value.length > 0;
const time = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;
const signedChoice = value => Math.sign(value - .5);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const average = (value, size) => size ? value / size : null;

function validatedForecasts(observation, protocol, protocolSha256) {
  if (observation?.schemaVersion !== 1 || observation.protocolId !== protocol.id ||
      observation.protocolSha256 !== protocolSha256 || observation.season !== protocol.season ||
      !Array.isArray(observation.forecasts) || !validHash(observation.sourceHash) || !validHash(observation.snapshotHash)) {
    throw new Error('Recent-form observation does not match the frozen protocol');
  }
  if (observation.resultSha256 !== recentFormObservationHash(observation)) {
    throw new Error('Recent-form observation checksum mismatch');
  }
  const [frozenAt, sourceAt, asOf, picksAt, capturedAt] =
    [protocol.frozenAt, observation.sourceFetchedAt, observation.asOf, observation.weeklyPicksAsOf, observation.forecastCapturedAt].map(time);
  if (![frozenAt, sourceAt, asOf, picksAt, capturedAt].every(Number.isFinite) ||
      sourceAt < frozenAt || asOf < sourceAt || picksAt < asOf || capturedAt < picksAt) {
    throw new Error('Recent-form observation source and capture times are out of order');
  }
  const seen = new Set();
  return observation.forecasts.map(row => {
    const kickoff = time(row?.kickoff);
    if (!id(row?.gameId) || !id(row.home) || !id(row.away) || row.home === row.away ||
        typeof row.neutral !== 'boolean' || !Number.isInteger(row.week) || row.week < 0 ||
        !['regular', 'postseason'].includes(row.seasonType) || seen.has(row.gameId) ||
        row.baselineCapturedAt !== observation.weeklyPicksAsOf) {
      throw new Error('Recent-form forecast identity or baseline checkpoint is invalid');
    }
    seen.add(row.gameId);
    if (!Number.isFinite(kickoff) || capturedAt >= kickoff || kickoff > picksAt + protocol.forecastHorizonDays * day ||
        !probability(row.baselineProbability) || !probability(row.challengerProbability)) {
      throw new Error('Recent-form forecast must contain a valid pre-kickoff probability pair');
    }
    return { ...row, forecastCapturedAt: observation.forecastCapturedAt, asOf: observation.asOf,
      sourceHash: observation.sourceHash, snapshotHash: observation.snapshotHash };
  });
}

function score(rows, field) {
  let correct = 0, missed = 0, even = 0, brier = 0, logLoss = 0;
  for (const row of rows) {
    const p = row[field];
    const y = row.outcome;
    if (p === .5) even++;
    else if (Number(p > .5) === y) correct++;
    else missed++;
    brier += (p - y) ** 2;
    const safeP = Math.max(1e-12, Math.min(1 - 1e-12, p));
    logLoss -= y === 1 ? Math.log(safeP) : Math.log1p(-safeP);
  }
  return { correct, missed, even, accuracy: average(correct + .5 * even, rows.length),
    brier: average(brier, rows.length), logLoss: average(logLoss, rows.length) };
}

function compareScores(rows) {
  const baseline = score(rows, 'baselineProbability');
  const challenger = score(rows, 'challengerProbability');
  return { games: rows.length, baseline, challenger,
    changedFavorites: rows.filter(row => signedChoice(row.baselineProbability) !== signedChoice(row.challengerProbability)).length,
    challengerMinusBaseline: {
      correct: challenger.correct - baseline.correct,
      accuracy: rows.length ? challenger.accuracy - baseline.accuracy : null,
      brier: rows.length ? challenger.brier - baseline.brier : null,
      logLoss: rows.length ? challenger.logLoss - baseline.logLoss : null,
    },
  };
}

export function evaluateRecentFormShadow({ observations, season, asOf, protocol, generatedAt = new Date().toISOString() }) {
  const freeze = time(protocol?.frozenAt);
  const resultCutoff = time(asOf);
  const now = time(generatedAt);
  if (protocol?.id !== 'recent-form-shadow-v1' || !Number.isInteger(protocol.season) || !Number.isFinite(freeze) ||
      protocol.forecastHorizonDays !== 7 || season?.year !== protocol.season ||
      !Array.isArray(observations) || !Array.isArray(season.games) || !Array.isArray(season.teams) ||
      season.source?.provider !== 'cfbd' || !validHash(season.source?.sha256) ||
      ![now, resultCutoff, time(season.source.fetchedAt)].every(Number.isFinite) ||
      time(season.source.fetchedAt) > resultCutoff || resultCutoff > now) {
    throw new Error('Recent-form evaluation requires a dated normalized CFBD result snapshot and its frozen protocol');
  }
  const protocolSha256 = sha(JSON.stringify(protocol));
  const games = new Map();
  for (const game of season.games) {
    if (!id(game?.id) || games.has(game.id)) throw new Error('Duplicate or missing normalized result game identity');
    games.set(game.id, game);
  }
  const divisions = new Map(season.teams.map(team => [team.id, team.division]));
  const byCapture = new Map(), selected = new Map();
  let duplicateCheckpoints = 0;
  for (const observation of observations) {
    const forecasts = validatedForecasts(observation, protocol, protocolSha256);
    if (time(observation.forecastCapturedAt) > now) throw new Error('Recent-form forecast capture time is in the future');
    for (const pair of forecasts) {
      const captured = time(pair.forecastCapturedAt);
      const key = JSON.stringify([pair.gameId, captured]);
      const seen = byCapture.get(key);
      if (seen && stable(seen) !== stable(pair)) throw new Error('Conflicting recent-form forecasts share a capture time');
      byCapture.set(key, pair);
      const earliest = selected.get(pair.gameId);
      if (earliest) duplicateCheckpoints++;
      if (!earliest || captured < time(earliest.forecastCapturedAt)) selected.set(pair.gameId, pair);
    }
  }

  const evaluated = [], pending = [], excluded = [];
  const canceled = new Set((season.source.audit?.confirmedCanceledRecords ?? []).map(result => result.id));
  for (const [gameId, pair] of [...selected].sort(([a], [b]) => a.localeCompare(b))) {
    const game = games.get(gameId);
    if (canceled.has(gameId)) { excluded.push({ gameId, reason: 'confirmed-canceled' }); continue; }
    if (!game) { pending.push({ gameId, reason: 'missing-from-current-result-source' }); continue; }
    if (pair.home !== game.home || pair.away !== game.away || pair.neutral !== game.neutral ||
        pair.week !== game.week || pair.seasonType !== game.seasonType) {
      excluded.push({ gameId, reason: 'matchup-or-competition-week-changed' }); continue;
    }
    if (divisions.get(game.home) !== 'fbs' || divisions.get(game.away) !== 'fbs') {
      excluded.push({ gameId, reason: 'result-is-not-fbs-vs-fbs' }); continue;
    }
    const resultKickoff = time(game.startDate);
    if (game.startTimeTbd === true || !Number.isFinite(resultKickoff)) {
      pending.push({ gameId, reason: 'current-kickoff-unconfirmed' }); continue;
    }
    if (resultKickoff !== time(pair.kickoff)) {
      excluded.push({ gameId, reason: 'kickoff-changed', forecastKickoff: pair.kickoff, resultKickoff: game.startDate }); continue;
    }
    if (game.completed !== true || resultKickoff > resultCutoff || resultKickoff > time(season.source.fetchedAt)) {
      pending.push({ gameId, reason: 'awaiting-confirmed-final' }); continue;
    }
    if (![game.homePoints, game.awayPoints].every(points => Number.isSafeInteger(points) && points >= 0)) {
      throw new Error('Recent-form evaluation received invalid completed scores');
    }
    if (game.homePoints === game.awayPoints) { excluded.push({ gameId, reason: 'no-decisive-winner' }); continue; }
    evaluated.push({ ...pair, resultKickoff: game.startDate, homePoints: game.homePoints, awayPoints: game.awayPoints,
      outcome: Number(game.homePoints > game.awayPoints) });
  }
  const report = { schemaVersion: 1, protocolId: protocol.id, protocolSha256, frozenAt: protocol.frozenAt, season: season.year,
    status: evaluated.length ? 'collecting-evidence' : 'awaiting-first-scored-game', asOf, generatedAt,
    resultSourceHash: season.source.sha256, observationsRead: observations.length,
    selectedForecasts: selected.size, duplicateCheckpoints, pending, excluded, scores: compareScores(evaluated), evaluated,
    interpretation: 'Compare the same FBS vs. FBS outcomes from the first valid paired pregame forecast for each game. A 50% forecast receives half credit for accuracy. Brier score and log loss reward the probabilities themselves, with lower values better. Early summaries are descriptive.' };
  return { ...report, reportSha256: sha(JSON.stringify(report)) };
}

async function main() {
  const protocol = JSON.parse(await readFile(protocolPath));
  const pins = Object.entries(protocol.implementationSha256 ?? {});
  if (!protocol.implementationSha256?.['research/evaluate-recent-form-shadow.mjs']) {
    throw new Error('Recent-form evaluation implementation pin is missing');
  }
  await Promise.all(pins.map(async ([filename, expected]) => {
    if (sha(await readFile(filename)) !== expected) throw new Error(`Recent-form protocol implementation changed: ${filename}`);
  }));
  const year = protocol.season;
  const [seasonBytes, snapshotBytes, manifestBytes] = await Promise.all([
    readFile(`data/seasons/${year}.json`), readFile('published/latest.json'), readFile('evidence/weekly/manifest.json'),
  ]);
  const season = JSON.parse(seasonBytes), snapshot = JSON.parse(snapshotBytes), manifest = JSON.parse(manifestBytes);
  if (manifest.status !== 'validated' || manifest.season !== year || manifest.snapshotHash !== snapshot.snapshotHash ||
      manifest.files?.find(file => file.name === 'normalized-season.json')?.sha256 !== sha(seasonBytes) ||
      manifest.files?.find(file => file.name === 'snapshot.json')?.sha256 !== sha(snapshotBytes) ||
      snapshot.season !== year || snapshot.source?.sha256 !== season.source?.sha256 ||
      snapshot.source?.fetchedAt !== season.source?.fetchedAt) {
    throw new Error('Recent-form results do not match the retained validated publication');
  }
  const files = await readdir(observationDirectory).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  const observations = await Promise.all(files.filter(file => file.endsWith(`-${protocol.id}.json`)).sort()
    .map(async file => JSON.parse(await readFile(join(observationDirectory, file)))));
  const report = evaluateRecentFormShadow({ observations, season, asOf: snapshot.asOf, protocol });
  await atomicJson('research/recent-form-evaluations/latest.json', report);
  console.log(`Recent-form shadow scores ${report.scores.games} paired games, with ${report.pending.length} pending and ${report.excluded.length} excluded.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
