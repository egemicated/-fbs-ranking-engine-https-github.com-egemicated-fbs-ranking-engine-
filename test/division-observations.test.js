import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankSeason } from '../src/engine.js';
import { atomicJson } from '../src/ingest.js';
import { makeDivisionObservation, persistDivisionObservation, recordDivisionObservation, IMPLEMENTATION_PATHS } from '../scripts/record-division-comparison.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function repack(input) {
  input.normalizedBytes = Buffer.from(JSON.stringify(input.season)); input.snapshotBytes = Buffer.from(JSON.stringify(input.snapshot));
  input.sourceEvidence.files = [{ name: 'normalized-season.json', sha256: hash(input.normalizedBytes) },
    { name: 'snapshot.json', sha256: hash(input.snapshotBytes) }, { name: 'provider-responses.json', sha256: hash('raw') }];
  return input;
}
function fixture() {
  const source = { provider: 'cfbd', sha256: hash('fixture-source'), fetchedAt: '2026-09-06T12:00:00Z' };
  const game = (id, home, away, startDate, completed = false) => ({ id, home, away, startDate, completed,
    homePoints: completed ? 21 : null, awayPoints: completed ? 7 : null, neutral: false, week: 1, seasonType: 'regular' });
  const season = { year: 2026, source, teams: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id,
    division: id === 'c' ? 'fcs' : id === 'd' ? 'unknown' : 'fbs', conference: 'X' })), games: [
    game('completed', 'a', 'b', '2026-09-05T12:00:00Z', true), game('completed-cross', 'a', 'c', '2026-09-04T12:00:00Z', true),
    game('future', 'a', 'c', '2026-09-08T12:00:00Z'), game('started', 'a', 'b', '2026-09-06T11:00:00Z'),
    game('after-snapshot-before-recording', 'a', 'b', '2026-09-06T12:00:01.500Z'),
    game('unknown', 'b', 'd', '2026-09-08T12:00:00Z'), game('far', 'a', 'b', '2026-09-25T12:00:00Z') ] };
  const snapshot = { ...rankSeason(season), asOf: '2026-09-06T12:00:01Z' };
  const implementationHashes = Object.fromEntries(IMPLEMENTATION_PATHS.map(p => [p, hash('fixed-code')]));
  const protocol = { id: 'fixture-division-v1', frozenAt: '2026-08-01T00:00:00Z', forecastHorizonDays: 7,
    implementationSha256: { ...implementationHashes }, parameters: { slope: 5.1, homeLogOdds: .38, divisionLogOdds: 2.4 },
    controlParameters: { slope: 5.4, homeLogOdds: .5, divisionLogOdds: 0 },
    pregameParameters: { slope: 4.3, homeLogOdds: .38, divisionLogOdds: 2.3 },
    pregameControlParameters: { slope: 4.8, homeLogOdds: .5, divisionLogOdds: 0 } };
  const sourceEvidence = { status: 'validated', snapshotHash: snapshot.snapshotHash, files: [] };
  return repack({ season, snapshot, protocol, implementationHashes, sourceEvidence, recordedAt: '2026-09-06T12:00:02Z' });
}

test('division shadow matches publication and saves only known, future, unplayed next-week games', () => {
  const input = fixture(), saved = JSON.stringify(input), result = makeDivisionObservation(input);
  assert.equal(result.phase, 'post-freeze-publication'); assert.equal(result.rows.length, 2);
  assert.equal(result.controlRows.length, result.rows.length);
  for (const row of result.rows) {
    const control = result.controlRows.find(t => t.id === row.id);
    for (const key of ['wins', 'losses', 'games', 'colley', 'colleyRank']) assert.equal(row[key], control[key]);
  }
  assert.notEqual(result.rows.find(r => r.id === 'a').sor, result.controlRows.find(r => r.id === 'a').sor);
  assert.equal(result.forecastCapturedAt, input.recordedAt);
  assert.deepEqual(result.forecasts.map(f => f.gameId), ['future']);
  const prediction = result.forecasts[0];
  assert.equal(prediction.phase, 'post-freeze-saved-before-kickoff');
  assert.equal(prediction.sourceHash, input.season.source.sha256);
  assert.equal(prediction.asOf, result.asOf); assert.ok(Date.parse(prediction.kickoff) > Date.parse(result.recordedAt));
  assert.ok(prediction.homeWinProbability > prediction.controlHomeWinProbability);
  assert.equal(result.forecastSelection.excludedOtherOrUnknownSubdivisions, 1);
  assert.equal(JSON.stringify(input), saved); assert.match(result.interpretation, /not pregame forecasts/);
});

test('seven-day horizon includes its exact boundary, and never calls a prefreeze source prospective', () => {
  const input = fixture(); const g = input.season.games.find(g => g.id === 'future');
  g.startDate = '2026-09-13T12:00:02Z'; repack(input);
  assert.equal(makeDivisionObservation(input).forecasts.length, 1);
  g.startDate = '2026-09-13T12:00:02.001Z'; repack(input);
  assert.equal(makeDivisionObservation(input).forecasts.length, 0);
  const retro = fixture(); retro.protocol.frozenAt = '2026-09-07T00:00:00Z';
  const result = makeDivisionObservation(retro);
  assert.equal(result.phase, 'retrospective-baseline'); assert.equal(result.forecasts[0].phase, 'retrospective-before-kickoff-baseline');
});

test('checksums, implementation pins, source matching and published game eligibility fail closed', () => {
  const changed = fixture(); changed.implementationHashes[IMPLEMENTATION_PATHS[0]] = hash('changed');
  assert.throws(() => makeDivisionObservation(changed), /Frozen division implementation changed/);
  const badEvidence = fixture(); badEvidence.sourceEvidence.files[0].sha256 = hash('bad');
  assert.throws(() => makeDivisionObservation(badEvidence), /checksums/);
  const parsed = fixture(); parsed.season.games[0].homePoints++;
  assert.throws(() => makeDivisionObservation(parsed), /Parsed inputs differ/);
  const mismatched = fixture(); mismatched.season.source = { ...mismatched.season.source, sha256: hash('different') }; repack(mismatched);
  assert.throws(() => makeDivisionObservation(mismatched), /CFBD source/);
  const extra = fixture(); extra.season.games[0].completed = false; repack(extra);
  assert.throws(() => makeDivisionObservation(extra), /game set differs/);
  const clock = fixture(); clock.recordedAt = '2026-09-06T11:00:00Z';
  assert.throws(() => makeDivisionObservation(clock), /cutoff/);
});

test('committed division freeze pins its actual numerical implementations', async () => {
  const protocol = JSON.parse(await readFile('research/frozen-division-comparison-v2.json', 'utf8'));
  for (const path of IMPLEMENTATION_PATHS) assert.equal(hash(await readFile(path)), protocol.implementationSha256[path], path);
  assert.equal(protocol.forecastHorizonDays, 7); assert.equal(protocol.pregameControlParameters.divisionLogOdds, 0);
  assert.equal(protocol.controlParameters.divisionLogOdds, 0);
});

test('division records are immutable, verify their contents and preserve v1 evidence metadata', async () => {
  const input = fixture(), result = makeDivisionObservation(input), root = await mkdtemp(join(tmpdir(), 'fbs-division-observation-'));
  const paths = { directory: join(root, 'observations'), evidenceDirectory: join(root, 'evidence'), clock: () => Date.parse(input.recordedAt) };
  const manifest = { ...input.sourceEvidence, files: [...input.sourceEvidence.files, { name: 'research-comparison.json', sha256: hash('v1') }],
    researchComparison: { protocolId: 'sor-colley-v1', resultSha256: hash('v1'), phase: 'post-freeze-publication' } };
  await atomicJson(join(paths.evidenceDirectory, 'manifest.json'), manifest);
  const first = await persistDivisionObservation(result, paths), bytes = await readFile(first.path, 'utf8');
  await persistDivisionObservation({ ...result, recordedAt: '2026-09-06T12:01:00Z' }, paths);
  assert.equal(await readFile(first.path, 'utf8'), bytes);
  const updated = JSON.parse(await readFile(join(paths.evidenceDirectory, 'manifest.json'), 'utf8'));
  assert.deepEqual(updated.researchComparison, manifest.researchComparison);
  assert.ok(updated.files.some(f => f.name === 'research-comparison.json'));
  assert.equal(updated.files.at(-1).sha256, hash(await readFile(join(paths.evidenceDirectory, 'division-comparison.json'))));
  const tampered = structuredClone(result); tampered.rows[0].sor++;
  await assert.rejects(persistDivisionObservation(tampered, paths), /checksum is invalid/);
  const timeTampered = { ...result, forecastCapturedAt: '2026-09-04T00:00:00Z' };
  await assert.rejects(persistDivisionObservation(timeTampered, paths), /checksum is invalid/);
  await writeFile(first.path, JSON.stringify(tampered));
  await assert.rejects(persistDivisionObservation(result, paths), /refusing to rewrite/);
});

test('reruns preserve the first hashed capture and verify identical source and protocol inputs', async () => {
  const input = fixture(), root = await mkdtemp(join(tmpdir(), 'fbs-division-rerun-'));
  let now = Date.parse(input.recordedAt);
  const paths = { directory: join(root, 'observations'), evidenceDirectory: join(root, 'evidence'), clock: () => now };
  await atomicJson(join(paths.evidenceDirectory, 'manifest.json'), input.sourceEvidence);
  const first = await recordDivisionObservation(input, paths), bytes = await readFile(first.path, 'utf8');
  const later = { ...input, recordedAt: '2026-09-09T12:00:00Z' };
  now = Date.parse(later.recordedAt);
  assert.equal(makeDivisionObservation(later).forecasts.length, 0);
  const reused = await recordDivisionObservation(later, paths);
  assert.equal(reused.observation.forecastCapturedAt, input.recordedAt);
  assert.equal(reused.observation.forecasts.length, 1); assert.equal(await readFile(first.path, 'utf8'), bytes);
  const changed = { ...input, protocol: { ...input.protocol, pregameParameters: { ...input.protocol.pregameParameters, slope: 9 } } };
  await assert.rejects(recordDivisionObservation(changed, paths), /refusing to rewrite/);
  const tampered = JSON.parse(bytes); tampered.forecastCapturedAt = '2026-09-04T00:00:00Z';
  await writeFile(first.path, JSON.stringify(tampered));
  await assert.rejects(recordDivisionObservation(input, paths), /checksum or captured time/);
});

test('new prospective write timing rejects kickoff exactly at prewrite without retaining a record', async () => {
  const input = fixture(), result = makeDivisionObservation(input), root = await mkdtemp(join(tmpdir(), 'fbs-division-prewrite-'));
  const paths = { directory: join(root, 'observations'), evidenceDirectory: join(root, 'evidence'),
    clock: () => Date.parse(result.forecasts[0].kickoff) };
  await atomicJson(join(paths.evidenceDirectory, 'manifest.json'), input.sourceEvidence);
  const originalManifest = await readFile(join(paths.evidenceDirectory, 'manifest.json'), 'utf8');
  await assert.rejects(persistDivisionObservation(result, paths), /kickoff reached before observation write/);
  assert.deepEqual(await readdir(paths.directory), []);
  assert.equal(await readFile(join(paths.evidenceDirectory, 'manifest.json'), 'utf8'), originalManifest);
  await assert.rejects(readFile(join(paths.evidenceDirectory, 'division-comparison.json')), { code: 'ENOENT' });
});

test('new prospective write timing removes only its newly created file if completion reaches kickoff', async () => {
  const input = fixture(), result = makeDivisionObservation(input), root = await mkdtemp(join(tmpdir(), 'fbs-division-postwrite-'));
  const deadline = Date.parse(result.forecasts[0].kickoff); let calls = 0;
  const paths = { directory: join(root, 'observations'), evidenceDirectory: join(root, 'evidence'),
    clock: () => (++calls === 1 ? deadline - 1 : deadline) };
  await atomicJson(join(paths.evidenceDirectory, 'manifest.json'), input.sourceEvidence);
  const originalManifest = await readFile(join(paths.evidenceDirectory, 'manifest.json'), 'utf8');
  await assert.rejects(persistDivisionObservation(result, paths), /kickoff reached at observation write completion/);
  assert.equal(calls, 2); assert.deepEqual(await readdir(paths.directory), []);
  assert.equal(await readFile(join(paths.evidenceDirectory, 'manifest.json'), 'utf8'), originalManifest);
  await assert.rejects(readFile(join(paths.evidenceDirectory, 'division-comparison.json')), { code: 'ENOENT' });
});

test('new prospective write timing accepts completion just before kickoff and preserves existing history later', async () => {
  const input = fixture(), result = makeDivisionObservation(input), root = await mkdtemp(join(tmpdir(), 'fbs-division-in-time-'));
  const deadline = Date.parse(result.forecasts[0].kickoff); let calls = 0;
  const paths = { directory: join(root, 'observations'), evidenceDirectory: join(root, 'evidence'),
    clock: () => (++calls === 1 ? deadline - 2 : deadline - 1) };
  await atomicJson(join(paths.evidenceDirectory, 'manifest.json'), input.sourceEvidence);
  const saved = await persistDivisionObservation(result, paths), bytes = await readFile(saved.path, 'utf8');
  assert.equal(calls, 2);
  const reused = await persistDivisionObservation(result, { ...paths, clock: () => { throw Error('Existing record must not use new-capture clock'); } });
  assert.equal(reused.observation.resultSha256, result.resultSha256);
  assert.equal(await readFile(saved.path, 'utf8'), bytes);
});
