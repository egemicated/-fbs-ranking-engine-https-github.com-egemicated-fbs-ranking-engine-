// Score immutable forecasts captured before kickoff. No requests or refitting.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicJson } from '../src/ingest.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const tolerance = 1e-10;
export const BLEND_MODELS = ['sor', 'strength', 'performance', 'triple', 'sor+strength', 'sor+performance', 'strength+performance'];

export function blendObservationHash(observation) {
  const { resultSha256, recordedAt, runtime, ...data } = observation;
  return sha(JSON.stringify(data));
}

function checkProtocol(protocol, implementationHashes) {
  if (typeof protocol?.id !== 'string' || !Number.isFinite(time(protocol.frozenAt)) || protocol.forecastHorizonDays !== 7) {
    throw Error('A frozen seven-day blend protocol is required');
  }
  const paths = Object.entries(protocol.implementationSha256 ?? {});
  if (!paths.length) throw Error('Frozen blend implementation pins are missing');
  for (const [path, expected] of paths) {
    if (!validHash(expected) || implementationHashes?.[path] !== expected) throw Error(`Frozen blend implementation changed: ${path}`);
  }
  for (const family of BLEND_MODELS) {
    const coefficients = protocol.calibration?.models?.[family]?.coefficients;
    if (!Array.isArray(coefficients) || coefficients.length !== 2 || !coefficients.every(finite)) {
      throw Error(`Frozen older-only calibration is missing: ${family}`);
    }
  }
}

function validateObservation(observation, protocol, implementationHashes) {
  if (observation.resultSha256 !== blendObservationHash(observation)) throw Error('Blend observation checksum mismatch');
  if (observation.protocolId !== protocol.id || observation.protocolSha256 !== sha(JSON.stringify(protocol)) ||
      observation.frozenAt !== protocol.frozenAt || observation.schemaVersion !== 1) throw Error('Blend observation uses a different frozen protocol');
  for (const [path, expected] of Object.entries(protocol.implementationSha256)) {
    if (observation.implementationSha256?.[path] !== expected || implementationHashes[path] !== expected) {
      throw Error('Blend observation implementation does not match frozen pins');
    }
  }
  const captured = time(observation.forecastCapturedAt);
  const sourceTimes = [observation.asOf, observation.sourceFetchedAt, observation.performanceGeneratedAt, observation.performanceSourceFetchedAt].map(time);
  if (!Number.isFinite(captured) || captured < time(protocol.frozenAt) ||
      sourceTimes.some(value => !Number.isFinite(value) || value > captured)) throw Error('Blend capture/source timing is invalid');
  if (!Number.isInteger(observation.season) || !Array.isArray(observation.rows) || !Array.isArray(observation.forecasts)) {
    throw Error('Blend observation identities or forecasts are missing');
  }
  for (const field of ['sourceHash', 'snapshotHash', 'performancePublicationHash', 'normalizedInputSha256', 'snapshotInputSha256', 'performanceInputSha256']) {
    if (!validHash(observation[field])) throw Error(`Blend observation provenance is invalid: ${field}`);
  }
  const rows = new Map();
  for (const row of observation.rows) {
    if (typeof row.id !== 'string' || !row.id || rows.has(row.id) ||
        !Number.isInteger(row.games) || row.games < 1 || !Number.isInteger(row.measuredGames) || row.measuredGames < 1) {
      throw Error('Blend observation has an invalid common FBS population');
    }
    for (const family of BLEND_MODELS) {
      if (!finite(row.indices?.[family]) || row.indices[family] < -tolerance || row.indices[family] > 100 + tolerance) {
        throw Error('Blend observation index is invalid');
      }
    }
    const expectedBlends = { triple: (row.indices.sor + row.indices.strength + row.indices.performance) / 3,
      'sor+strength': (row.indices.sor + row.indices.strength) / 2,
      'sor+performance': (row.indices.sor + row.indices.performance) / 2,
      'strength+performance': (row.indices.strength + row.indices.performance) / 2 };
    if (Object.entries(expectedBlends).some(([family, expected]) => Math.abs(row.indices[family] - expected) > tolerance)) {
      throw Error('Saved blend indices do not preserve the frozen equal weights');
    }
    rows.set(row.id, row);
  }
  for (const row of rows.values()) {
    for (const family of ['sor', 'strength', 'performance']) {
      const rank = row.componentRanks?.[family];
      const greater = observation.rows.filter(other => other.indices[family] > row.indices[family] + tolerance).length;
      const equal = observation.rows.filter(other => Math.abs(other.indices[family] - row.indices[family]) <= tolerance).length;
      const expectedRank = greater + (equal + 1) / 2;
      const expectedPercentile = rows.size > 1 ? 100 * (rows.size - expectedRank) / (rows.size - 1) : 50;
      if (!finite(rank) || Math.abs(rank - expectedRank) > tolerance || Math.abs(row.indices[family] - expectedPercentile) > tolerance) {
        throw Error('Saved component indices do not match their common-population midranks');
      }
    }
  }
  const forecastIds = new Set();
  for (const forecast of observation.forecasts) {
    const home = rows.get(forecast.home), away = rows.get(forecast.away);
    const kickoff = time(forecast.kickoff);
    if (typeof forecast.gameId !== 'string' || !forecast.gameId || forecastIds.has(forecast.gameId) ||
        !home || !away || forecast.home === forecast.away || forecast.season !== observation.season ||
        typeof forecast.neutral !== 'boolean' || forecast.asOf !== observation.asOf || forecast.forecastCapturedAt !== observation.forecastCapturedAt) {
      throw Error('Blend forecast identity does not match its observation');
    }
    forecastIds.add(forecast.gameId);
    if (!Number.isFinite(kickoff) || kickoff <= captured || kickoff > captured + 7 * 86400000 ||
        sourceTimes.some(value => value >= kickoff)) throw Error('Blend forecast was not captured in its pre-kickoff window');
    if (forecast.homeGames !== home.games || forecast.awayGames !== away.games ||
        forecast.homeMeasuredGames !== home.measuredGames || forecast.awayMeasuredGames !== away.measuredGames ||
        forecast.primaryEligible !== (Math.min(home.games, away.games, home.measuredGames, away.measuredGames) >= 4)) {
      throw Error('Blend forecast eligibility does not match saved evidence counts');
    }
    for (const family of BLEND_MODELS) {
      const model = forecast.models?.[family];
      const expectedDifference = home.indices[family] - away.indices[family];
      if (!model || !finite(model.indexDifference) || Math.abs(model.indexDifference - expectedDifference) > tolerance) {
        throw Error('Blend forecast difference does not match saved team indices');
      }
      const pick = Math.abs(expectedDifference) <= tolerance ? 'tie' : expectedDifference > 0 ? 'home' : 'away';
      if (model.pick !== pick) throw Error('Blend forecast pick does not match its frozen index');
      const [betaIndex, betaVenue] = protocol.calibration.models[family].coefficients;
      const expectedProbability = 1 / (1 + Math.exp(-(betaIndex * expectedDifference / 100 + betaVenue * Number(!forecast.neutral))));
      if (!finite(model.homeWinProbability) || model.homeWinProbability < 0 || model.homeWinProbability > 1 ||
          Math.abs(model.homeWinProbability - expectedProbability) > 1e-12) throw Error('Blend probability differs from frozen older-only calibration');
    }
  }
}

function score(rows) {
  if (!rows.length) return { games: 0, models: {} };
  const models = {};
  for (const family of BLEND_MODELS) {
    let correct = 0, probabilityCorrect = 0, brier = 0, logLoss = 0, ties = 0, meanProbabilityError = 0;
    for (const row of rows) {
      const saved = row.models[family];
      const tied = saved.pick === 'tie';
      correct += tied ? .5 : Number((saved.pick === 'home') === Boolean(row.outcome));
      ties += Number(tied);
      const probability = saved.homeWinProbability;
      const clipped = Math.max(1e-12, Math.min(1 - 1e-12, probability));
      probabilityCorrect += Math.abs(probability - .5) <= tolerance ? .5 : Number((probability > .5) === Boolean(row.outcome));
      brier += (probability - row.outcome) ** 2;
      logLoss -= row.outcome * Math.log(clipped) + (1 - row.outcome) * Math.log(1 - clipped);
      meanProbabilityError += probability - row.outcome;
    }
    models[family] = { accuracy: correct / rows.length, rankingTies: ties, probabilityAccuracy: probabilityCorrect / rows.length,
      brier: brier / rows.length, logLoss: logLoss / rows.length, probabilityError: meanProbabilityError / rows.length };
  }
  return { games: rows.length, models };
}

export function evaluateBlendForecasts({ observations, season, asOf, protocol, implementationHashes, generatedAt = new Date().toISOString() }) {
  checkProtocol(protocol, implementationHashes);
  if (!Number.isFinite(time(asOf)) || !Number.isFinite(time(generatedAt)) || time(generatedAt) < time(asOf) ||
      !Number.isInteger(season?.year) || !validHash(season?.source?.sha256) || !Array.isArray(season.games) || !Array.isArray(observations)) {
    throw Error('Blend evaluation requires a dated normalized result source');
  }
  const ids = new Map();
  for (const game of season.games) {
    if (typeof game.id !== 'string' || !game.id || ids.has(game.id)) throw Error('Duplicate or missing result game identity');
    ids.set(game.id, game);
  }
  const divisions = new Map((season.teams ?? []).map(team => [team.id, team.division]));
  const selected = new Map();
  let duplicateCheckpoints = 0, futureObservations = 0, otherSeasons = 0;
  for (const observation of observations) {
    validateObservation(observation, protocol, implementationHashes);
    if (observation.season !== season.year) { otherSeasons++; continue; }
    if (time(observation.forecastCapturedAt) > time(asOf)) { futureObservations++; continue; }
    for (const forecast of observation.forecasts) {
      const key = `${forecast.season}:${forecast.gameId}`;
      const savedRows = new Map(observation.rows.map(row => [row.id, row]));
      const componentTop25 = ['sor', 'strength', 'performance'].some(family => [forecast.home, forecast.away].some(identity => {
        const score = savedRows.get(identity).indices[family];
        return observation.rows.filter(row => row.indices[family] > score + tolerance).length < 25;
      }));
      const componentDisagreement = new Set(['sor', 'strength', 'performance'].map(family => forecast.models[family].pick)).size > 1;
      const candidate = { ...forecast, observationSha256: observation.resultSha256,
        snapshotHash: observation.snapshotHash, sourceHash: observation.sourceHash,
        performancePublicationHash: observation.performancePublicationHash, componentTop25, componentDisagreement };
      const old = selected.get(key);
      if (!old) selected.set(key, candidate);
      else {
        duplicateCheckpoints++;
        if (time(candidate.forecastCapturedAt) < time(old.forecastCapturedAt)) selected.set(key, candidate);
        else if (candidate.forecastCapturedAt === old.forecastCapturedAt &&
                 stable({ ...candidate, observationSha256: undefined }) !== stable({ ...old, observationSha256: undefined })) {
          throw Error('Conflicting blend forecasts share a capture time');
        }
      }
    }
  }
  const evaluated = [], pending = [], excluded = [];
  for (const saved of [...selected.values()].sort((a, b) => a.gameId.localeCompare(b.gameId))) {
    const game = ids.get(saved.gameId);
    if (!game) { pending.push({ gameId: saved.gameId, reason: 'absent-from-current-source' }); continue; }
    if (!Number.isFinite(time(game.startDate))) throw Error('Result kickoff is invalid');
    // Selection has already happened. A later checkpoint can never replace an
    // earliest forecast that becomes ineligible after an identity correction.
    if (game.home !== saved.home || game.away !== saved.away || game.neutral !== saved.neutral) {
      excluded.push({ gameId: game.id, reason: 'participants-or-venue-changed' }); continue;
    }
    if (divisions.get(game.home) !== 'fbs' || divisions.get(game.away) !== 'fbs') {
      excluded.push({ gameId: game.id, reason: 'result-subdivision-is-not-fbs-fbs' }); continue;
    }
    if (time(saved.forecastCapturedAt) >= time(game.startDate)) {
      excluded.push({ gameId: game.id, reason: 'corrected-kickoff-not-after-capture' }); continue;
    }
    if (time(game.startDate) > time(saved.forecastCapturedAt) + 7 * 86400000) {
      excluded.push({ gameId: game.id, reason: 'rescheduled-outside-seven-day-window' }); continue;
    }
    if (game.completed !== true || time(game.startDate) > time(asOf)) {
      pending.push({ gameId: game.id, reason: 'unfinished-or-not-yet-at-result-cutoff' }); continue;
    }
    if (!Number.isInteger(game.homePoints) || !Number.isInteger(game.awayPoints) || game.homePoints < 0 || game.awayPoints < 0 || game.homePoints === game.awayPoints) {
      throw Error('Confirmed blend result needs valid decisive final scores');
    }
    evaluated.push({ ...saved, outcome: Number(game.homePoints > game.awayPoints), resultKickoff: game.startDate,
      resultSourceHash: season.source.sha256, seasonType: game.seasonType, week: game.week });
  }
  const primary = evaluated.filter(row => row.primaryEligible);
  const completedUniverse = season.games.filter(game => game.completed === true && divisions.get(game.home) === 'fbs' &&
    divisions.get(game.away) === 'fbs' && Number.isFinite(time(game.startDate)) &&
    time(game.startDate) >= time(protocol.frozenAt) && time(game.startDate) <= time(asOf));
  const completedIds = new Set(completedUniverse.map(game => game.id));
  const noSavedForecast = completedUniverse.filter(game => !selected.has(`${season.year}:${game.id}`)).map(game => ({
    gameId: game.id, kickoff: game.startDate,
    reason: 'no-valid-saved-forecast'
  }));
  const trackingCoverage = {
    rule: 'All currently sourced confirmed-completed FBS-FBS games with corrected kickoff from protocol freeze through result asOf; no claim of complete contemporaneous schedule availability.',
    completedFbsFbsGamesSinceFreeze: completedUniverse.length,
    scored: evaluated.filter(row => completedIds.has(row.gameId)).length,
    selectedButExcluded: excluded.filter(row => completedIds.has(row.gameId)).length,
    selectedButPending: pending.filter(row => completedIds.has(row.gameId)).length,
    noSavedForecastCount: noSavedForecast.length, noSavedForecast
  };
  const result = { schemaVersion: 1, protocolId: protocol.id, protocolSha256: sha(JSON.stringify(protocol)), frozenAt: protocol.frozenAt,
    season: season.year, asOf, generatedAt, resultSourceHash: season.source.sha256,
    selectionRule: 'First valid immutable captured-before-kickoff forecast per season/game; choose before reading eventual outcomes or rescheduling exclusions.',
    observationsRead: observations.length, ignoredOtherSeasonObservations: otherSeasons, ignoredAfterResultCutoffObservations: futureObservations,
    eligibleForecasts: selected.size, duplicateCheckpoints, pending, excluded, trackingCoverage,
    scores: { primary: score(primary), allEligible: score(evaluated),
      groups: { regular: score(primary.filter(row => row.seasonType === 'regular')),
        postseason: score(primary.filter(row => row.seasonType === 'postseason')),
        neutral: score(primary.filter(row => row.neutral)), homeVenue: score(primary.filter(row => !row.neutral)),
        componentTop25: score(primary.filter(row => row.componentTop25)),
        componentsDisagree: score(primary.filter(row => row.componentDisagreement)) } },
    evaluated,
    interpretation: 'Only immutable forecasts actually captured before kickoff count. No scored games means evidence is pending. This is future-game ordering/probability evidence, not proof of the correct earned-achievement order. Local capture timestamps and public repository history are retained; this is not an external trusted timestamp service.' };
  return { ...result, reportSha256: sha(JSON.stringify(result)) };
}

async function main() {
  const protocol = JSON.parse(await readFile('research/frozen-blend-prospective-v1.json', 'utf8'));
  const implementationHashes = Object.fromEntries(await Promise.all(Object.keys(protocol.implementationSha256 ?? {}).map(async path => [path, sha(await readFile(path))])));
  const evaluationPins = Object.entries(protocol.evaluationImplementationSha256 ?? {});
  if (!evaluationPins.length) throw Error('Frozen blend evaluator pins are missing');
  for (const [path, expected] of evaluationPins) if (sha(await readFile(path)) !== expected) throw Error(`Frozen blend evaluator changed: ${path}`);
  const year = Number(process.env.RANKING_SEASON || 2026);
  const directory = 'research/blend-observations';
  let names = [];
  try { names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const observations = await Promise.all(names.map(name => readFile(join(directory, name), 'utf8').then(JSON.parse)));
  const normalizedBytes = await readFile(`data/seasons/${year}.json`), snapshotBytes = await readFile('published/latest.json');
  const season = JSON.parse(normalizedBytes), snapshot = JSON.parse(snapshotBytes);
  const evidence = JSON.parse(await readFile('evidence/weekly/manifest.json', 'utf8'));
  if (evidence.status !== 'validated' || evidence.snapshotHash !== snapshot.snapshotHash ||
      evidence.files.find(file => file.name === 'normalized-season.json')?.sha256 !== sha(normalizedBytes) ||
      evidence.files.find(file => file.name === 'snapshot.json')?.sha256 !== sha(snapshotBytes)) throw Error('Blend results do not match retained validated evidence');
  if (snapshot.source?.sha256 !== season.source?.sha256 || snapshot.season !== year || season.year !== year) throw Error('Blend results do not match the published source');
  const report = evaluateBlendForecasts({ observations, season, asOf: snapshot.asOf, protocol, implementationHashes });
  await atomicJson('research/blend-evaluations/latest.json', report);
  console.log(`Scored ${report.evaluated.length} saved-before-kickoff blend forecasts; ${report.pending.length} pending; ${report.excluded.length} excluded`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
