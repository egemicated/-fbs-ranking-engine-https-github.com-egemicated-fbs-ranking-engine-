// Frozen division-aware shadow observations and genuinely saved future forecasts.
// No fetching, parameter fitting, paid infrastructure or public rank replacement.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSeason } from '../src/engine.js';
import { atomicJson } from '../src/ingest.js';
import { calculateDivisionSor, calculateDivisionForecasts } from '../research/lib/division_candidate.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const numericTime = value => typeof value === 'string' ? Date.parse(value) : NaN;
export const IMPLEMENTATION_PATHS = ['research/lib/division_candidate.mjs', 'src/engine.js', 'scripts/record-division-comparison.js'];

function resultHash(observation) {
  const { resultSha256, recordedAt, runtime, ...data } = observation;
  return hash(JSON.stringify(data));
}

function observationPath({ asOf, snapshotHash, protocolId }, directory) {
  if (typeof protocolId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(protocolId) || !Number.isFinite(numericTime(asOf)) ||
      !/^[a-f0-9]{64}$/.test(snapshotHash)) throw Error('Invalid division observation identity');
  return join(directory, `${asOf.replace(/[^0-9]/g, '')}-${snapshotHash.slice(0, 12)}-${protocolId}.json`);
}

export function makeDivisionObservation({ season, snapshot, protocol, sourceEvidence, implementationHashes,
  normalizedBytes, snapshotBytes, recordedAt = new Date().toISOString() }) {
  if (typeof protocol.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(protocol.id) || !Number.isFinite(numericTime(protocol.frozenAt)) || protocol.forecastHorizonDays !== 7) {
    throw Error('Invalid frozen division protocol');
  }
  if (protocol.pregameControlParameters?.divisionLogOdds !== 0 || protocol.controlParameters?.divisionLogOdds !== 0) {
    throw Error('Control division gap must be zero');
  }
  for (const path of IMPLEMENTATION_PATHS) {
    if (!protocol.implementationSha256?.[path] || protocol.implementationSha256[path] !== implementationHashes[path]) {
      throw Error(`Frozen division implementation changed: ${path}; create a new protocol version`);
    }
  }
  if (JSON.stringify(JSON.parse(normalizedBytes)) !== JSON.stringify(season) ||
      JSON.stringify(JSON.parse(snapshotBytes)) !== JSON.stringify(snapshot)) throw Error('Parsed inputs differ from retained evidence bytes');
  validateSeason(season);
  if (season.year !== snapshot.season || season.source?.provider !== 'cfbd' || snapshot.source?.provider !== 'cfbd' ||
      season.source.sha256 !== snapshot.source.sha256) throw Error('Division inputs do not share the published CFBD source');
  if (sourceEvidence.status !== 'validated' || sourceEvidence.snapshotHash !== snapshot.snapshotHash) {
    throw Error('Division observation requires matching validated source evidence');
  }
  const evidenceHash = name => sourceEvidence.files.find(f => f.name === name)?.sha256;
  if (evidenceHash('normalized-season.json') !== hash(normalizedBytes) || evidenceHash('snapshot.json') !== hash(snapshotBytes) ||
      !evidenceHash('provider-responses.json')) throw Error('Division source file checksums do not match retained evidence');
  const asOf = numericTime(snapshot.asOf), fetchedAt = numericTime(snapshot.source.fetchedAt), savedAt = numericTime(recordedAt);
  if (![asOf, fetchedAt, savedAt].every(Number.isFinite) || savedAt < asOf || savedAt < fetchedAt) throw Error('Invalid observation or source cutoff');
  const publishedIds = new Set(snapshot.ratings.flatMap(t => t.contributions.map(g => g.gameId)));
  const eligible = season.games.filter(g => g.completed && numericTime(g.startDate) <= asOf);
  if (publishedIds.size !== snapshot.gamesUsed || eligible.length !== publishedIds.size || eligible.some(g => !publishedIds.has(g.id))) {
    throw Error('Division research game set differs from published game set');
  }
  const games = eligible.map(g => ({ id: g.id, a: g.home, b: g.away,
    outcome: Math.sign(g.homePoints - g.awayPoints), venue: g.neutral ? 0 : 1 }));
  const dataset = { teams: season.teams, games };
  const result = calculateDivisionSor(dataset, protocol.parameters);
  const controlResult = calculateDivisionSor(dataset, protocol.controlParameters);
  const published = new Map(snapshot.rankings.map(t => [t.id, t]));
  if (result.rows.length !== published.size) throw Error('Division FBS population differs from publication');
  for (const row of result.rows) {
    const t = published.get(row.id);
    if (!t || t.wins !== row.wins || t.losses !== row.losses || t.rank !== row.colleyRank ||
        Math.abs(t.achievement - row.colley) > 1e-8) throw Error(`Division Colley baseline differs for ${row.id}`);
  }
  const frozen = numericTime(protocol.frozenAt), afterFreeze = asOf > frozen && fetchedAt > frozen;
  const divisions = new Map(season.teams.map(t => [t.id, t.division]));
  const scheduled = season.games.filter(g => !g.completed && numericTime(g.startDate) > asOf && numericTime(g.startDate) > savedAt &&
    numericTime(g.startDate) <= savedAt + protocol.forecastHorizonDays * 86400000);
  const future = scheduled.filter(g => [divisions.get(g.home), divisions.get(g.away)].every(d => ['fbs', 'fcs'].includes(d)) &&
    [divisions.get(g.home), divisions.get(g.away)].includes('fbs'));
  const fixtures = future.map(g => ({ id: g.id, a: g.home, b: g.away, venue: g.neutral ? 0 : 1 }));
  const futureById = new Map(future.map(g => [g.id, g]));
  const control = new Map(calculateDivisionForecasts(dataset, fixtures, protocol.pregameControlParameters).map(row => [row.id, row]));
  const forecasts = calculateDivisionForecasts(dataset, fixtures, protocol.pregameParameters).map(row => ({
    gameId: row.id, modelId: protocol.id, season: snapshot.season, asOf: snapshot.asOf,
    kickoff: futureById.get(row.id).startDate, home: row.a, away: row.b, neutral: row.venue === 0,
    homeDivision: divisions.get(row.a), awayDivision: divisions.get(row.b),
    homeWinProbability: row.aWinProbability, controlHomeWinProbability: control.get(row.id).aWinProbability,
    homeColley: row.aColley, awayColley: row.bColley,
    sourceHash: snapshot.source.sha256, snapshotHash: snapshot.snapshotHash,
    phase: afterFreeze ? 'post-freeze-saved-before-kickoff' : 'retrospective-before-kickoff-baseline'
  }));
  const data = { schemaVersion: 1, protocolId: protocol.id, protocolSha256: hash(JSON.stringify(protocol)), frozenAt: protocol.frozenAt,
    phase: afterFreeze ? 'post-freeze-publication' : 'retrospective-baseline', season: snapshot.season,
    asOf: snapshot.asOf, sourceFetchedAt: snapshot.source.fetchedAt, forecastCapturedAt: recordedAt,
    snapshotHash: snapshot.snapshotHash, sourceHash: snapshot.source.sha256,
    normalizedInputSha256: hash(normalizedBytes), sourceResponseFileSha256: evidenceHash('provider-responses.json'),
    gamesUsed: games.length, referenceFbsCount: result.referenceFbsCount, parameters: protocol.parameters,
    pregameParameters: protocol.pregameParameters, pregameControlParameters: protocol.pregameControlParameters,
    inputPolicyVersion: season.source.audit?.inputPolicyVersion ?? 'legacy',
    controlParameters: protocol.controlParameters,
    implementationSha256: implementationHashes, rows: result.rows, controlRows: controlResult.rows, forecasts,
    forecastSelection: { forecastHorizonDays: protocol.forecastHorizonDays, unfinishedFutureSourceGames: scheduled.length, eligibleKnownD1FbsGames: future.length,
      excludedOtherOrUnknownSubdivisions: scheduled.length - future.length,
      rule: 'Available source games only: unfinished, kickoff strictly after both snapshot asOf and actual recordedAt and within seven days of recordedAt, both teams known FBS/FCS, at least one FBS. No claim of complete schedule coverage. Current full graph; no target outcome or game removal.' },
    interpretation: 'SOR rows are achievement shadows, not pregame forecasts or proof of superior rankings. Only separately saved forecasts precede kickoff; they use pregame coefficients and must later be scored against confirmed results. Repeated forecasts are checkpoints, not independent games. Public rankings remain unchanged.' };
  return { ...data, resultSha256: hash(JSON.stringify(data)), recordedAt, runtime: process.version };
}

export async function persistDivisionObservation(observation, { directory, evidenceDirectory }) {
  if (resultHash(observation) !== observation.resultSha256) throw Error('Division observation checksum is invalid');
  if (!Number.isFinite(numericTime(observation.forecastCapturedAt))) throw Error('Invalid hashed forecast capture time');
  await mkdir(directory, { recursive: true });
  const path = observationPath(observation, directory);
  let saved = observation;
  try { await writeFile(path, JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = JSON.parse(await readFile(path, 'utf8'));
    if (resultHash(existing) !== existing.resultSha256 || existing.resultSha256 !== observation.resultSha256) {
      throw Error('Existing division observation differs; refusing to rewrite frozen history');
    }
    saved = existing;
  }
  const evidenceName = 'division-comparison.json';
  await atomicJson(join(evidenceDirectory, evidenceName), saved);
  const manifestPath = join(evidenceDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const bytes = await readFile(join(evidenceDirectory, evidenceName));
  manifest.files = manifest.files.filter(f => f.name !== evidenceName);
  manifest.files.push({ name: evidenceName, bytes: bytes.length, sha256: hash(bytes) });
  manifest.divisionComparison = { protocolId: saved.protocolId, resultSha256: saved.resultSha256, phase: saved.phase,
    forecasts: saved.forecasts.length };
  await atomicJson(manifestPath, manifest);
  return { path, observation: saved };
}

// Idempotent reruns verify and reuse the first captured time. Recomputing with
// current retained inputs also verifies protocol/source/input/implementation
// identity; any numerical or hashed metadata difference is refused by persist.
export async function recordDivisionObservation(input, paths) {
  const path = observationPath({ asOf: input.snapshot.asOf, snapshotHash: input.snapshot.snapshotHash,
    protocolId: input.protocol.id }, paths.directory);
  let capturedAt;
  try {
    const existing = JSON.parse(await readFile(path, 'utf8'));
    if (resultHash(existing) !== existing.resultSha256 || !Number.isFinite(numericTime(existing.forecastCapturedAt))) {
      throw Error('Existing division observation checksum or captured time is invalid');
    }
    capturedAt = existing.forecastCapturedAt;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const observation = makeDivisionObservation({ ...input, ...(capturedAt ? { recordedAt: capturedAt } : {}) });
  return persistDivisionObservation(observation, paths);
}

async function main() {
  const year = Number(process.env.RANKING_SEASON || 2026);
  const normalizedBytes = await readFile(`data/seasons/${year}.json`), snapshotBytes = await readFile('published/latest.json');
  const protocol = JSON.parse(await readFile('research/frozen-division-comparison.json', 'utf8'));
  const sourceEvidence = JSON.parse(await readFile('evidence/weekly/manifest.json', 'utf8'));
  const implementationHashes = Object.fromEntries(await Promise.all(IMPLEMENTATION_PATHS.map(async path => [path, hash(await readFile(path))])));
  const result = await recordDivisionObservation({ season: JSON.parse(normalizedBytes), snapshot: JSON.parse(snapshotBytes), protocol,
    sourceEvidence, implementationHashes, normalizedBytes, snapshotBytes },
  { directory: 'research/division-observations', evidenceDirectory: 'evidence/weekly' });
  console.log(`Recorded ${result.observation.rows.length} division-shadow rows and ${result.observation.forecasts.length} before-kickoff forecasts under ${protocol.id}; public rankings unchanged`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
