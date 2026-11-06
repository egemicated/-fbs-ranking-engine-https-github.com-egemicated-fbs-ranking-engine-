// Prospective research only. Reads the existing weekly inputs; makes no requests
// and changes none of the three published rankings.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSeason } from '../src/engine.js';
import { publishDivisionSnapshot, readPublicationPolicy } from '../src/publication.js';
import { performanceForSnapshot } from '../src/performance-publication.js';
import { atomicJson } from '../src/ingest.js';

export const IMPLEMENTATION_PATHS = [
  'scripts/record-blend-comparison.js', 'src/engine.js', 'src/publication.js',
  'src/performance-publication.js', 'research/lib/division_candidate.mjs',
  'data/model.json', 'data/publication-model.json', 'data/performance-model.json',
  'scripts/publish-performance.py', 'research/advanced_performance_ingest.py',
  'research/advanced_performance_model.py', 'research/adaptive_performance_model.py'
];
export const BLEND_FAMILIES = Object.freeze({
  sor: ['sor'], strength: ['strength'], performance: ['performance'],
  triple: ['sor', 'strength', 'performance'],
  'sor+strength': ['sor', 'strength'], 'sor+performance': ['sor', 'performance'],
  'strength+performance': ['strength', 'performance']
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const same = (left, right) => stable(left) === stable(right);
const numericIdSort = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function blendObservationHash(observation) {
  const { resultSha256, recordedAt, runtime, ...data } = observation;
  return hash(JSON.stringify(data));
}

export function blendObservationPath({ asOf, snapshotHash, protocolId }, directory) {
  if (!Number.isFinite(time(asOf)) || !/^[a-f0-9]{64}$/.test(snapshotHash) ||
      typeof protocolId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(protocolId)) throw Error('Invalid blend observation identity');
  return join(directory, `${asOf.replace(/[^0-9]/g, '')}-${snapshotHash.slice(0, 12)}-${protocolId}.json`);
}

export function blendPercentiles(values, tolerance = 1e-10) {
  if (!finite(tolerance) || tolerance < 0 || values.some(row => !finite(row.value)) || new Set(values.map(row => row.id)).size !== values.length) {
    throw Error('Invalid percentile population');
  }
  const order = [...values].sort((a, b) => b.value - a.value || numericIdSort(a.id, b.id));
  const result = new Map();
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && Math.abs(order[end].value - order[start].value) <= tolerance) end++;
    const midrank = (start + 1 + end) / 2;
    const percentile = order.length > 1 ? 100 * (order.length - midrank) / (order.length - 1) : 50;
    for (let i = start; i < end; i++) result.set(order[i].id, { percentile, midrank, rank: start + 1 });
    start = end;
  }
  return result;
}

function validateProtocol(protocol, implementationHashes) {
  if (!protocol || typeof protocol.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(protocol.id) ||
      !Number.isFinite(time(protocol.frozenAt)) || !Number.isInteger(protocol.season) ||
      protocol.forecastHorizonDays !== 7 || protocol.tieTolerance !== 1e-10 || protocol.minimumPrimaryGames !== 4) {
    throw Error('Invalid frozen blend protocol');
  }
  for (const path of IMPLEMENTATION_PATHS) {
    if (!/^[a-f0-9]{64}$/.test(protocol.implementationSha256?.[path] ?? '') ||
        protocol.implementationSha256[path] !== implementationHashes?.[path]) {
      throw Error(`Frozen blend implementation changed: ${path}; create a new protocol version`);
    }
  }
  for (const [path, expected] of Object.entries(protocol.implementationSha256)) {
    if (expected !== implementationHashes?.[path]) throw Error(`Frozen blend implementation changed: ${path}`);
  }
  for (const family of Object.keys(BLEND_FAMILIES)) {
    const coefficients = protocol.calibration?.models?.[family]?.coefficients;
    if (!Array.isArray(coefficients) || coefficients.length !== 2 || !coefficients.every(finite)) {
      throw Error(`Frozen probability calibration missing: ${family}`);
    }
  }
  if (!same(protocol.calibration.trainingYears, [2018, 2019])) throw Error('Unexpected probability calibration years');
}

export function makeBlendObservation({ season, snapshot, performance, protocol, implementationHashes,
  normalizedBytes, snapshotBytes, performanceBytes, recordedAt, clock = Date.now }) {
  validateProtocol(protocol, implementationHashes);
  for (const [parsed, bytes] of [[season, normalizedBytes], [snapshot, snapshotBytes], [performance, performanceBytes]]) {
    if (!bytes || !same(parsed, JSON.parse(bytes))) throw Error('Parsed blend inputs differ from retained bytes');
  }
  validateSeason(season);
  if (season.year !== protocol.season || snapshot.season !== season.year || season.source?.provider !== 'cfbd' ||
      snapshot.source?.provider !== 'cfbd' || !/^[a-f0-9]{64}$/.test(snapshot.snapshotHash ?? '') ||
      season.source.sha256 !== snapshot.source.sha256 || !/^[a-f0-9]{64}$/.test(snapshot.source.sha256 ?? '')) {
    throw Error('Blend inputs do not share the frozen season and CFBD source');
  }
  if (!same(snapshot.config, protocol.models?.strength?.config)) throw Error('Predictive Strength settings differ from the frozen blend');
  const primary = publishDivisionSnapshot(snapshot, {
    id: protocol.models?.sor?.methodId, name: 'Frozen SOR component',
    parameters: protocol.models?.sor?.parameters, publicationVersion: protocol.models?.sor?.publicationVersion ?? '1.0.0'
  }, { publishedAt: snapshot.asOf });
  if (!performanceForSnapshot(performance, primary) || performance.method.id !== protocol.models?.performance?.methodId ||
      !same(performance.method.configuration, protocol.models?.performance?.config) ||
      !/^[a-f0-9]{64}$/.test(performance.publicationHash ?? '')) throw Error('Missing, stale or changed experimental Performance snapshot');
  const sourceTimes = [time(snapshot.asOf), time(snapshot.source.fetchedAt), time(performance.generatedAt), time(performance.source?.fetchedAt)];
  if (!sourceTimes.every(Number.isFinite)) throw Error('Blend source timestamps are invalid');
  const usedIds = new Set(primary.ratings.flatMap(row => row.contributions.map(game => game.gameId)));
  const eligible = season.games.filter(game => game.completed && time(game.startDate) <= time(snapshot.asOf));
  if (eligible.length !== usedIds.size || usedIds.size !== primary.gamesUsed || eligible.some(game => !usedIds.has(game.id))) {
    throw Error('Blend normalized completed game set differs from its snapshot');
  }
  const original = new Map(primary.ratings.map(row => [row.id, row]));
  for (const game of eligible) {
    const home = original.get(game.home), away = original.get(game.away);
    const left = home?.contributions.find(row => row.gameId === game.id), right = away?.contributions.find(row => row.gameId === game.id);
    const venueTarget = primary.config.marginCap * Math.tanh((game.regulationMargin === 0 ? Math.sign(game.homePoints - game.awayPoints) : game.homePoints - game.awayPoints) / primary.config.marginCap)
      - (game.neutral ? 0 : primary.config.homeAdvantage);
    if (!left || !right || left.opponentId !== game.away || right.opponentId !== game.home ||
        left.finalMargin !== game.homePoints - game.awayPoints || Math.abs(left.adjustedMargin - venueTarget) > 1e-8) {
      throw Error('Blend normalized game participants, outcome or venue disagree with its snapshot');
    }
  }
  const sourceTeams = new Map(season.teams.map(row => [row.id, row]));
  if (primary.ratings.some(row => sourceTeams.get(row.id)?.division !== row.division) || sourceTeams.size !== primary.ratings.length) {
    throw Error('Blend source team identities or subdivisions differ');
  }
  const perf = new Map(performance.rankings.map(row => [row.id, row]));
  const common = primary.rankings.filter(row => row.games > 0 && perf.get(row.id)?.measuredGames > 0);
  const componentScores = {
    sor: blendPercentiles(common.map(row => ({ id: row.id, value: row.sor })), protocol.tieTolerance),
    strength: blendPercentiles(common.map(row => ({ id: row.id, value: row.strength })), protocol.tieTolerance),
    performance: blendPercentiles(common.map(row => ({ id: row.id, value: perf.get(row.id).score })), protocol.tieTolerance)
  };
  const rows = common.map(row => ({
    id: row.id, team: row.name, games: row.games, measuredGames: perf.get(row.id).measuredGames,
    componentRanks: Object.fromEntries(Object.entries(componentScores).map(([key, value]) => [key, value.get(row.id).midrank])),
    indices: Object.fromEntries(Object.entries(BLEND_FAMILIES).map(([family, components]) => [family,
      components.reduce((sum, key) => sum + componentScores[key].get(row.id).percentile, 0) / components.length]))
  })).sort((a, b) => numericIdSort(a.id, b.id));
  // Capture time comes after the numeric assembly. The public CLI never accepts
  // an override; explicit recordedAt/clock are useful for deterministic tests
  // and verification of an already existing immutable observation.
  const capturedAt = recordedAt ?? new Date(clock()).toISOString();
  const savedAt = time(capturedAt);
  if (!Number.isFinite(savedAt) || savedAt < time(protocol.frozenAt) || sourceTimes.some(value => value > savedAt)) {
    throw Error('Blend capture precedes its frozen protocol or source cutoff');
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  const horizonEnd = new Date(savedAt + protocol.forecastHorizonDays * 86400000).toISOString();
  const future = season.games.filter(game => !game.completed && time(game.startDate) > savedAt && time(game.startDate) <= time(horizonEnd));
  let excludedSubdivision = 0, excludedUnmeasured = 0;
  const forecasts = [];
  for (const game of future.sort((a, b) => numericIdSort(a.id, b.id))) {
    if ([game.home, game.away].some(id => sourceTeams.get(id)?.division !== 'fbs')) { excludedSubdivision++; continue; }
    const home = byId.get(game.home), away = byId.get(game.away);
    if (!home || !away) { excludedUnmeasured++; continue; }
    const models = Object.fromEntries(Object.keys(BLEND_FAMILIES).map(family => {
      const difference = home.indices[family] - away.indices[family];
      const [slope, venue] = protocol.calibration.models[family].coefficients;
      const probability = 1 / (1 + Math.exp(-(slope * difference / 100 + venue * Number(!game.neutral))));
      return [family, { indexDifference: difference, homeWinProbability: probability,
        pick: Math.abs(difference) <= protocol.tieTolerance ? 'tie' : difference > 0 ? 'home' : 'away' }];
    }));
    forecasts.push({ season: season.year, gameId: game.id, home: game.home, away: game.away,
      kickoff: game.startDate, neutral: game.neutral, asOf: snapshot.asOf, forecastCapturedAt: capturedAt,
      primaryEligible: Math.min(home.games, away.games, home.measuredGames, away.measuredGames) >= protocol.minimumPrimaryGames,
      homeGames: home.games, awayGames: away.games, homeMeasuredGames: home.measuredGames, awayMeasuredGames: away.measuredGames,
      models });
  }
  const data = {
    schemaVersion: 1, protocolId: protocol.id, protocolSha256: hash(JSON.stringify(protocol)), frozenAt: protocol.frozenAt,
    season: season.year, asOf: snapshot.asOf, sourceFetchedAt: snapshot.source.fetchedAt,
    performanceGeneratedAt: performance.generatedAt, performanceSourceFetchedAt: performance.source.fetchedAt,
    forecastCapturedAt: capturedAt, sourceHash: snapshot.source.sha256, snapshotHash: snapshot.snapshotHash,
    publicationHash: primary.publicationHash, performancePublicationHash: performance.publicationHash,
    normalizedInputSha256: hash(normalizedBytes), snapshotInputSha256: hash(snapshotBytes), performanceInputSha256: hash(performanceBytes),
    implementationSha256: { ...implementationHashes }, commonFbsTeams: rows.length,
    rows, forecasts,
    forecastSelection: { forecastHorizonDays: 7, horizonEnd, unfinishedFutureSourceGames: future.length,
      eligibleFbsFbsGames: forecasts.length, primaryEligibleGames: forecasts.filter(row => row.primaryEligible).length,
      excludedSubdivision, excludedUnmeasured,
      rule: 'Unfinished source FBS-FBS fixtures strictly after actual capture and within seven days; both teams measured in the common population. Available source schedule only; no claim of complete schedule coverage.' },
    interpretation: 'Experimental prospective comparison, with no public ranking replacement. Captured time is local write evidence, not a claim of earlier public registration. Fixed model indices are not win probabilities; separately frozen older-only mappings supply probability forecasts. Repeated captures are checkpoints, not independent games.'
  };
  return { ...data, resultSha256: hash(JSON.stringify(data)), recordedAt: capturedAt, runtime: process.version };
}

export async function persistBlendObservation(observation, { directory, evidenceDirectory, clock = Date.now }) {
  if (blendObservationHash(observation) !== observation.resultSha256) throw Error('Blend observation checksum is invalid');
  const path = blendObservationPath(observation, directory);
  const verifyExisting = existing => {
    if (blendObservationHash(existing) !== existing.resultSha256 || existing.resultSha256 !== observation.resultSha256) {
      throw Error('Existing blend observation differs; refusing to rewrite frozen history');
    }
    return existing;
  };
  let saved;
  try { saved = verifyExisting(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!saved) {
    const requireBeforeKickoff = stage => {
      const now = clock();
      if (!Number.isFinite(now) || now < time(observation.forecastCapturedAt) ||
          observation.forecasts.some(game => !Number.isFinite(time(game.kickoff)) || now >= time(game.kickoff))) {
        throw Error(`Prospective blend capture time or kickoff failed ${stage}; no new observation retained`);
      }
    };
    await mkdir(directory, { recursive: true });
    requireBeforeKickoff('before observation write');
    let created = false;
    try { await writeFile(path, JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' }); created = true; saved = observation; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      saved = verifyExisting(JSON.parse(await readFile(path, 'utf8')));
    }
    if (created) {
      try { requireBeforeKickoff('at observation write completion'); }
      catch (error) { await unlink(path); throw error; }
    }
  }
  if (evidenceDirectory) await atomicJson(join(evidenceDirectory, 'blend-comparison.json'), saved);
  return { path, observation: saved };
}

export async function recordBlendObservation(input, paths) {
  const path = blendObservationPath({ asOf: input.snapshot.asOf, snapshotHash: input.snapshot.snapshotHash,
    protocolId: input.protocol.id }, paths.directory);
  let capturedAt;
  try {
    const existing = JSON.parse(await readFile(path, 'utf8'));
    if (blendObservationHash(existing) !== existing.resultSha256 || !Number.isFinite(time(existing.forecastCapturedAt))) {
      throw Error('Existing blend observation checksum or captured time is invalid');
    }
    capturedAt = existing.forecastCapturedAt;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // A new capture never accepts caller-supplied past recordedAt. Reruns reuse
  // the first observation's actual hashed time and must reproduce every byte.
  const { recordedAt: _ignored, clock: _ignoredClock, ...fresh } = input;
  const observation = makeBlendObservation({ ...fresh, clock: paths.clock ?? Date.now,
    ...(capturedAt ? { recordedAt: capturedAt } : {}) });
  return persistBlendObservation(observation, paths);
}

async function main() {
  const year = Number(process.env.RANKING_SEASON || 2026);
  const normalizedBytes = await readFile(`data/seasons/${year}.json`);
  const snapshotBytes = await readFile('published/latest.json');
  const performanceBytes = await readFile('published/performance-latest.json');
  const protocol = JSON.parse(await readFile('research/frozen-blend-prospective-v1.json', 'utf8'));
  const policy = await readPublicationPolicy();
  if (policy.id !== protocol.models?.sor?.methodId || !same(policy.parameters, protocol.models?.sor?.parameters)) {
    throw Error('Current SOR publication policy differs from the frozen blend protocol');
  }
  const implementationHashes = Object.fromEntries(await Promise.all(Object.keys(protocol.implementationSha256).map(async path => [path, hash(await readFile(path))])));
  const result = await recordBlendObservation({ season: JSON.parse(normalizedBytes), snapshot: JSON.parse(snapshotBytes),
    performance: JSON.parse(performanceBytes), protocol, implementationHashes, normalizedBytes, snapshotBytes, performanceBytes },
  { directory: 'research/blend-observations', evidenceDirectory: 'evidence/weekly' });
  console.log(`Recorded ${result.observation.forecasts.length} prospective blend comparisons (${result.observation.forecastSelection.primaryEligibleGames} established); zero provider requests; published rankings unchanged`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
