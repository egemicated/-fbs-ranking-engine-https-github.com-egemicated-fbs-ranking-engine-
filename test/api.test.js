import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../src/server.js';

test('API serves ratings without login, rejects writes, and keeps paths constrained', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fbs-api-'));
  await writeFile(join(dir, 'latest.json'), JSON.stringify({ season: 2025, rankings: [{ id: 'a' }], ratings: [] }));
  const server = createApi(dir); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(base + '/rankings'); assert.equal(r.status, 200); assert.equal((await r.json()).season, 2025);
    assert.equal((await fetch(base + '/rankings', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/rankings/2024')).status, 503);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true }); }
});
