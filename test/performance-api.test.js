import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../src/server.js';
import { performanceForSnapshot } from '../src/performance-publication.js';

const snapshot = { season: 2026, asOf: '2026-11-06T03:39:55.757Z', snapshotHash: 'paired-fixture',
  rankings: [{ id: '1', games: 1 }, { id: '2', games: 1 }], ratings: ['private-baseline'] };
const fixture = () => ({ season: 2026, asOf: snapshot.asOf, baseSnapshotHash: snapshot.snapshotHash,
  status: 'experimental', method: { id: 'net-success-example', name: 'Scrimmage consistency' },
  limitations: ['Historical forecasting check remains under review.'],
  coverage: { sourceFbsTeams: 2, measuredFbsTeams: 2, measuredFbsGames: 1, eligibleFbsGames: 1 },
  rankings: [1, 2].map((id, i) => ({ id: String(id), rank: id, score: i ? -2 : 2,
    measuredGames: 1, expectedGames: 1, offensiveSuccessRate: .5, defensiveSuccessRateAllowed: .4,
    explanation: { observedNetContribution: .1 } })) });

test('optional Performance must match exact primary cutoff, team identities and valid derived scores', () => {
  const performance = fixture(); const before = JSON.stringify(performance);
  assert.ok(performanceForSnapshot(performance, snapshot)); assert.equal(JSON.stringify(performance), before);
  for (const change of [{ baseSnapshotHash: 'different' }, { asOf: 'later' }, { season: 2025 },
    { status: 'approved' }, { rankings: [performance.rankings[0], performance.rankings[0]] },
    { rankings: performance.rankings.map(row => ({ ...row, expectedGames: 2 })) },
    { rankings: performance.rankings.map(row => ({ ...row, measuredGames: 0, rank: null, score: null })) },
    { coverage: { ...performance.coverage, measuredFbsGames: 0 } },
    { rankings: performance.rankings.map(row => ({ ...row, score: null })) }])
    assert.equal(performanceForSnapshot({ ...performance, ...change }, snapshot), null);
});

test('Performance endpoint serves a saved experiment without source access and excludes unknown top-level fields', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'performance-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'latest.json'), JSON.stringify(snapshot));
  await writeFile(join(directory, 'performance-latest.json'), JSON.stringify({ ...fixture(), rawProviderResponses: ['must-not-be-served'] }));
  const server = createApi(directory); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const primary = await (await fetch(base+'/rankings')).json(); assert.equal(primary.performanceEndpoint, '/performance');
  assert.equal(primary.ratings, undefined);
  const response = await fetch(base+'/performance'); assert.equal(response.status, 200);
  const experiment = await response.json(); assert.equal(experiment.rankings.length, 2);
  assert.equal(experiment.rawProviderResponses, undefined); assert.equal(experiment.status, 'experimental');
  assert.equal((await fetch(base+'/performance', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base+'/research/cache/advanced-training-v1/2026.json')).status, 404);
});

test('missing, corrupted or stale experiments do not block SOR and are not advertised', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'performance-fallback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'latest.json'), JSON.stringify(snapshot));
  const server = createApi(directory); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const value of [null, '{invalid-json', JSON.stringify({ ...fixture(), baseSnapshotHash: 'stale' })]) {
    if (value !== null) await writeFile(join(directory, 'performance-latest.json'), value);
    const r = await fetch(base+'/rankings'); assert.equal(r.status, 200); assert.equal((await r.json()).performanceEndpoint, undefined);
    assert.equal((await fetch(base+'/performance')).status, 503);
  }
});
