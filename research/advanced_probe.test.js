import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runAdvancedProbe } from '../scripts/probe-cfbd-advanced.js';

const key = 'test-only-not-a-real-api-key';
const snapshotBytes = Buffer.from(JSON.stringify({ season: 2026, asOf: '2026-11-06T03:39:55.757Z', snapshotHash: 'fixture',
  ratings: [
    { id: '1', name: 'Alpha', division: 'fbs', contributions: [{ gameId: '10', opponentId: '2' }] },
    { id: '2', name: 'Beta', division: 'fbs', contributions: [{ gameId: '10', opponentId: '1' }] }
  ] }));
const request = { id: 'advanced-2026-test', year: 2026, maxRequests: 1,
  seasonType: 'both', excludeGarbageTime: false,
  snapshotFileSha256: createHash('sha256').update(snapshotBytes).digest('hex') };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'fbs-advanced-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { request, snapshotBytes, apiKey: key,
    outputDir: join(directory, 'derived'), privateDir: join(directory, 'private'),
    now: () => '2026-11-06T21:00:00.000Z' };
}

test('advanced probe makes one fixed authenticated request and publishes only allowlisted metadata and derived audit', async t => {
  const options = await fixture(t); let calls = 0;
  const report = await runAdvancedProbe({ ...options, fetchImpl: async (url, init) => {
    calls++; assert.equal(url, 'https://api.collegefootballdata.com/stats/game/advanced?year=2026&seasonType=both&excludeGarbageTime=false');
    assert.equal(init.headers.Authorization, `Bearer ${key}`); assert.equal(init.redirect, 'error');
    return new Response('[]', { status: 200, headers: { 'X-CallLimit-Remaining': '987',
      Date: 'Fri, 06 Nov 2026 21:00:00 GMT', 'Set-Cookie': key, 'X-Untrusted-Header': key } });
  } });
  assert.equal(calls, 1); assert.equal(report.status, 'audited'); assert.equal(report.source.remainingCalls, 987);
  const publicText = await readFile(join(options.outputDir, 'audit.json'), 'utf8');
  assert.equal(publicText.includes(key), false); assert.equal(publicText.includes('Authorization'), false);
  assert.equal(await readFile(join(options.privateDir, 'response.json'), 'utf8'), '[]');
  await assert.rejects(runAdvancedProbe({ ...options, fetchImpl: async () => { calls++; throw new Error('Must not run'); } }), /EEXIST/);
  assert.equal(calls, 1);
});

test('advanced HTTP failure saves status without reading or exposing provider error text and never retries', async t => {
  const options = await fixture(t); let calls = 0;
  await assert.rejects(runAdvancedProbe({ ...options, fetchImpl: async () => {
    calls++; return new Response(key, { status: 401, headers: { 'X-CallLimit-Remaining': 'invalid' } });
  } }), /HTTP 401/);
  const text = await readFile(join(options.outputDir, 'audit.json'), 'utf8'); const report = JSON.parse(text);
  assert.equal(calls, 1); assert.equal(report.status, 'http-failed'); assert.equal(report.source.remainingCalls, null);
  assert.equal(report.source.responseBytes, null); assert.equal(text.includes(key), false);
});

test('advanced network errors are redacted and consume only one attempt', async t => {
  const options = await fixture(t); let calls = 0;
  await assert.rejects(runAdvancedProbe({ ...options, fetchImpl: async () => { calls++; throw new Error(key); } }), /no retry/);
  const text = await readFile(join(options.outputDir, 'audit.json'), 'utf8');
  assert.equal(calls, 1); assert.equal(text.includes(key), false); assert.equal(JSON.parse(text).status, 'request-failed');
});

test('advanced baseline and fixed-scope checks fail before making any request', async t => {
  const options = await fixture(t); let calls = 0; const fetchImpl = async () => { calls++; throw new Error('Must not run'); };
  await assert.rejects(runAdvancedProbe({ ...options, request: { ...request, snapshotFileSha256: 'changed' }, fetchImpl }), /checksum/);
  await assert.rejects(runAdvancedProbe({ ...options, request: { ...request, maxRequests: 2 }, fetchImpl }), /fixed probe/);
  assert.equal(calls, 0);
});

test('advanced malformed JSON is retained only privately and never retried', async t => {
  const options = await fixture(t); let calls = 0;
  await assert.rejects(runAdvancedProbe({ ...options, fetchImpl: async () => { calls++; return new Response('not-json-' + key); } }), /valid JSON/);
  const text = await readFile(join(options.outputDir, 'audit.json'), 'utf8');
  assert.equal(calls, 1); assert.equal(JSON.parse(text).status, 'invalid-json'); assert.equal(text.includes(key), false);
});

test('advanced unexpected response roots produce a derived failure without publishing raw content', async t => {
  const options = await fixture(t);
  await assert.rejects(runAdvancedProbe({ ...options, fetchImpl: async () => new Response(JSON.stringify({ error: key })) }), /could not be audited/);
  const text = await readFile(join(options.outputDir, 'audit.json'), 'utf8');
  assert.equal(JSON.parse(text).status, 'audit-failed'); assert.equal(text.includes(key), false);
});
