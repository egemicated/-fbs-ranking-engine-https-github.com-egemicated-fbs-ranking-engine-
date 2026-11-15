import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../src/server.js';

const snapshot = { season: 2026, asOf: '2026-11-15T14:39:14.774Z', snapshotHash: 'a'.repeat(64),
  source: { provider: 'cfbd', fetchedAt: '2026-11-15T14:39:13.405Z' }, rankings: [{ id: 'fbs' }] };
const fcsPicks = { season: snapshot.season, schemaVersion: 1, asOf: '2026-11-15T14:39:16.239Z',
  source: { provider: 'cfbd', matchupScope: 'fcs-fcs', calibrated: true, scheduleAsOf: snapshot.source.fetchedAt,
    rankingAsOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash },
  teams: ['1', '2'].map(id => ({ id, name: `Team ${id}`, division: 'fcs' })),
  games: [{ id: '3', home: '1', away: '2', week: 12, seasonType: 'regular', status: 'scheduled',
    startDate: '2026-11-21T17:00:00.000Z', neutral: false }] };

test('optional FCS picks match the current snapshot and cannot replace the original slate', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'weekly-fcs-picks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'latest.json'), JSON.stringify(snapshot));
  const original = { season: snapshot.season, games: [{ home: 'fbs' }] };
  await writeFile(join(directory, 'weekly-picks.json'), JSON.stringify(original));
  const server = createApi(directory, undefined, directory);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = path => fetch(base+path);

  assert.equal((await get('/weekly-fcs-picks')).status, 404);
  assert.equal((await (await get('/rankings')).json()).weeklyFcsPicksEndpoint, undefined);
  await writeFile(join(directory, 'weekly-fcs-picks.json'), JSON.stringify(fcsPicks));
  const ready = await get('/weekly-fcs-picks');
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get('cache-control'), 'no-cache');
  assert.deepEqual(await ready.json(), fcsPicks);
  assert.equal((await (await get('/rankings')).json()).weeklyFcsPicksEndpoint, '/weekly-fcs-picks');

  for (const source of [{ snapshotHash: 'b'.repeat(64) }, { rankingAsOf: fcsPicks.asOf },
    { scheduleAsOf: fcsPicks.asOf }, { matchupScope: 'fbs-fcs' }, { calibrated: false }]) {
    const invalid = { ...fcsPicks, source: { ...fcsPicks.source, ...source } };
    await writeFile(join(directory, 'weekly-fcs-picks.json'), JSON.stringify(invalid));
    assert.equal((await get('/weekly-fcs-picks')).status, 404);
    assert.equal((await (await get('/rankings')).json()).weeklyFcsPicksEndpoint, undefined);
  }
  assert.deepEqual(await (await get('/weekly-picks')).json(), original);
});
