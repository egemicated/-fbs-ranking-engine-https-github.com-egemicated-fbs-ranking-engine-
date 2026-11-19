import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { makeCrossShadow, saveCrossShadow, observationHash } from './capture-cross-division-shadow.mjs';

const captureTime = '2026-11-18T23:00:00.000Z';
async function cleanup(directory) {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith('fbs-cross-'));
  await rm(target, { recursive: true, force: true });
}
function fixture() {
  const config = { homeAdvantage: 2.5, probabilityScale: 14 };
  const future = { id: 'g', home: 'a', away: 'b', neutral: false, startTimeTbd: false, startDate: '2026-11-21T18:00:00.000Z' };
  const snapshot = { season: 2026, config, modelVersion: 'test', snapshotHash: 'a'.repeat(64),
    source: { provider: 'cfbd', fetchedAt: '2026-11-18T12:00:00Z', sha256: 'b'.repeat(64) },
    asOf: '2026-11-18T12:01:00Z', futureFixtures: [future],
    ratings: [{ id: 'a', name: 'A', division: 'fbs', strength: 10 }, { id: 'b', name: 'B', division: 'fcs', strength: 0 }] };
  const weekly = { schemaVersion: 1, season: 2026, asOf: '2026-11-18T12:02:00Z',
    source: { snapshotHash: snapshot.snapshotHash, scheduleAsOf: snapshot.source.fetchedAt, rankingAsOf: snapshot.asOf,
      modelVersion: snapshot.modelVersion, crossDivisionProbabilityScale: 14 },
    teams: snapshot.ratings, games: [{ ...future, status: 'scheduled', week: 12, seasonType: 'regular', pick: { homeWinProbability: 0.55 } }] };
  const frozen = { id: 'cross-division-calibration-shadow-v1', frozenAt: '2026-11-18T22:00:00Z', horizonDays: 7,
    strengthConfig: config, modelVersion: 'test', model: { family: 'temperatureDivision', coefficients: [2, 1] } };
  return { snapshot, weekly, frozen, inputSha256: { snapshot: 'c'.repeat(64), weekly: 'd'.repeat(64), frozen: 'e'.repeat(64) } };
}

test('research capture compares the same current graph and preserves an earlier public pick', () => {
  const input = fixture(), before = JSON.stringify(input);
  const observation = makeCrossShadow(input, captureTime), row = observation.forecasts[0];
  assert.equal(row.homeMargin, 12.5);
  assert.equal(row.baselineHomeProbability, 1 / (1 + Math.exp(-12.5 / 14)));
  assert.equal(row.candidateHomeProbability, 1 / (1 + Math.exp(-(2 * 12.5 / 14 + 1))));
  assert.notEqual(row.baselineHomeProbability, input.weekly.games[0].pick.homeWinProbability);
  assert.equal(observationHash(observation), observation.resultSha256);
  assert.equal(JSON.stringify(input), before);
});

test('capture rejects pre-freeze, future-source and mismatched-checkpoint inputs', () => {
  assert.throws(() => makeCrossShadow(fixture(), '2026-11-18T21:00:00Z'), /freeze/);
  const future = fixture(); future.weekly.asOf = '2026-11-19T12:00:00Z';
  assert.throws(() => makeCrossShadow(future, captureTime), /chronology/);
  const mismatch = fixture(); mismatch.weekly.source.snapshotHash = 'f'.repeat(64);
  assert.throws(() => makeCrossShadow(mismatch, captureTime));
});

test('capture excludes TBD, already started, outside horizon and unknown-subdivision games', () => {
  for (const change of [game => { game.startTimeTbd = true; }, game => { game.startDate = captureTime; },
    game => { game.startDate = '2026-12-18T23:00:00Z'; }, game => { game.status = 'final'; }]) {
    const input = fixture(); change(input.weekly.games[0]);
    assert.equal(makeCrossShadow(input, captureTime), null);
  }
  const input = fixture(); input.snapshot.ratings[1].division = 'unknown';
  assert.equal(makeCrossShadow(input, captureTime), null);
});

test('capture rejects changed fixture identity and duplicate rows', () => {
  const input = fixture(); input.weekly.games[0].neutral = true;
  assert.throws(() => makeCrossShadow(input, captureTime), /fixture/);
  const duplicate = fixture(); duplicate.weekly.games.push({ ...duplicate.weekly.games[0] });
  assert.throws(() => makeCrossShadow(duplicate, captureTime));
});

test('side reversal complements both probabilities with reversed venue effect', () => {
  const original = fixture(); original.snapshot.config.homeAdvantage = 0; original.snapshot.futureFixtures[0].neutral = true; original.weekly.games[0].neutral = true;
  const first = makeCrossShadow(original, captureTime).forecasts[0];
  const reversed = fixture(); reversed.snapshot.config.homeAdvantage = 0;
  for (const game of [reversed.snapshot.futureFixtures[0], reversed.weekly.games[0]]) { game.home = 'b'; game.away = 'a'; game.neutral = true; }
  const second = makeCrossShadow(reversed, captureTime).forecasts[0];
  assert.ok(Math.abs(first.candidateHomeProbability + second.candidateHomeProbability - 1) < 1e-14);
  assert.ok(Math.abs(first.baselineHomeProbability + second.baselineHomeProbability - 1) < 1e-14);
});

test('exclusive capture is idempotent and refuses modified inputs or checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fbs-cross-capture-'));
  try {
    const input = fixture(), first = await saveCrossShadow(input, directory, () => captureTime);
    const repeat = await saveCrossShadow(input, directory, () => '2026-11-25T23:00:00Z');
    assert.equal(first.created, true); assert.equal(repeat.created, false);
    assert.deepEqual(first.observation, repeat.observation);
    assert.equal(JSON.parse(await readFile(first.path, 'utf8')).resultSha256, first.observation.resultSha256);
    input.inputSha256.weekly = 'f'.repeat(64);
    await assert.rejects(saveCrossShadow(input, directory, () => captureTime), /inputs changed/);
  } finally { await cleanup(directory); }
});

test('a kickoff reached during exclusive write leaves no false pregame observation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fbs-cross-kickoff-'));
  try {
    const times = [captureTime, captureTime, '2026-11-21T18:00:00Z'];
    await assert.rejects(saveCrossShadow(fixture(), directory, () => times.shift()), /during capture write/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await cleanup(directory); }
});
