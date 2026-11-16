import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildRankingMovement } from '../src/ranking-movement.js';
import { createApi } from '../src/server.js';

function fixture() {
  const row = (id, rank, weekGames = []) => ({ id, team: id.toUpperCase(), rank, sor: 1, weekGames });
  const previous = { week: 10, seasonType: 'regular', kind: 'saved', complete: true, modelId: 'test-sor',
    gamesThrough: '2026-11-07', asOf: '2026-11-08T13:00:00Z',
    rows: [row('a', 28), row('b', 25), row('c', 12), row('d', null)] };
  const current = { ...previous, week: 11, complete: false, gamesThrough: '2026-11-14',
    asOf: '2026-11-15T18:04:41.489Z', snapshotHash: 'a'.repeat(64), publicationHash: 'b'.repeat(64),
    rows: [row('c', 12), row('a', 20, [{ opponentId: 'b', opponentName: 'B', opponentRank: 28,
      result: 'W', margin: 14, venue: 'away' }]), row('b', 28), row('d', 132)] };
  const snapshot = { season: 2026, asOf: current.asOf, rankingMethod: { id: current.modelId },
    snapshotHash: current.snapshotHash, publicationHash: current.publicationHash,
    rankings: current.rows.map(({ id, team, rank }) => ({ id, name: team, displayRank: rank })),
    fcsRankings: [{ id: 'e', name: 'E', displayRank: 1 }] };
  return { snapshot, history: { schemaVersion: 1, season: 2026, editions: [previous, current] }, current, previous };
}

test('movement follows an exact saved FBS SOR edition and carries its provisional cutoff', () => {
  const { snapshot, history } = fixture();
  const movement = buildRankingMovement(snapshot, history);
  assert.equal(movement.week, 11);
  assert.equal(movement.previousWeek, 10);
  assert.equal(movement.previousKind, 'saved');
  assert.equal(movement.complete, false);
  assert.equal(movement.gamesThrough, '2026-11-14');
  assert.deepEqual(movement.teams, {
    a: { previousRank: 28, movement: 8, enteredTop25: true },
    b: { previousRank: 25, movement: -3, enteredTop25: false },
    c: { previousRank: 12, movement: 0, enteredTop25: false },
    d: { previousRank: null, movement: null, enteredTop25: false },
  });
  assert.deepEqual(movement.arrivals.map(row => row.id), ['a']);
  assert.deepEqual(movement.departures.map(row => row.id), ['b']);
  assert.equal(movement.risers[0].weekGames[0].venue, 'away');
  assert.equal(movement.fallers[0].movement, -3);
});

test('movement requires aligned cutoff, model identity, positions and complete comparison', () => {
  assert.equal(buildRankingMovement(fixture().snapshot, null), null);
  const changes = [
    ({ history }) => { history.season = 2025; },
    ({ current }) => { current.asOf = '2026-11-15T18:04:41.500Z'; },
    ({ current }) => { current.snapshotHash = 'other'; },
    ({ current }) => { current.publicationHash = 'other'; },
    ({ current }) => { current.modelId = 'other'; },
    ({ current }) => { current.kind = 'replay'; },
    ({ current }) => { current.rows[0].rank = 11; },
    ({ previous }) => { previous.complete = false; },
    ({ history }) => { history.editions.shift(); },
  ];
  for (const change of changes) {
    const context = fixture();
    change(context);
    assert.equal(buildRankingMovement(context.snapshot, context.history), null);
  }
  const { snapshot, history, previous } = fixture();
  previous.kind = 'replay';
  assert.equal(buildRankingMovement(snapshot, history).previousKind, 'replay');
});

test('the rankings API omits missing or invalid movement and keeps it off historical routes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ranking-movement-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { snapshot, history } = fixture();
  const historyPath = join(directory, 'ranking-history.json');
  await Promise.all(['latest.json', '2026.json'].map(name => writeFile(join(directory, name), JSON.stringify(snapshot))));
  const server = createApi(directory, directory, directory);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path = '/rankings') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    assert.equal(response.status, 200);
    return response.json();
  };

  assert.equal((await request()).rankingMovement, undefined);
  await writeFile(historyPath, 'not JSON');
  assert.equal((await request()).rankingMovement, undefined);
  await writeFile(historyPath, JSON.stringify(history));
  assert.deepEqual((await request()).rankingMovement, buildRankingMovement(snapshot, history));
  assert.equal((await request('/rankings/2026')).rankingMovement, undefined);
});
