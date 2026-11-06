import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { fetchAdvancedTraining } from '../scripts/fetch-advanced-training.js';

const YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2023, 2024, 2025, 2026];
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const request = { id: 'success-rate-training-v1-nov06', years: YEARS, maxRequests: 10,
  excludeGarbageTime: false, seasonType: 'both', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) };
const apiKey = 'test-only-api-key-no-real-credential';
const now = () => '2026-11-06T22:00:00.000Z';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function options(t) {
  const outputDir = await mkdtemp(join(tmpdir(), 'advanced-training-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  return { request, apiKey, outputDir, now };
}

function decrypt(envelope) {
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256' }, Buffer.from(envelope.encryptedKey, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return gunzipSync(Buffer.concat([cipher.update(Buffer.from(envelope.payload, 'base64')), cipher.final()]));
}

test('training fetch makes ten fixed requests and preserves exact raw bytes only inside encrypted envelopes', async t => {
  const base = await options(t); let calls = 0;
  const source = new Map();
  const manifest = await fetchAdvancedTraining({ ...base, fetchImpl: async (url, init) => {
    const year = YEARS[calls]; calls++;
    assert.equal(url, `https://api.collegefootballdata.com/stats/game/advanced?year=${year}&seasonType=both&excludeGarbageTime=false`);
    assert.equal(init.headers.Authorization, `Bearer ${apiKey}`); assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    const raw = ` [ { "season": ${year}, "privateField": "raw-value-${year}" } ] \n`;
    source.set(year, raw);
    return new Response(raw, { headers: { 'X-CallLimit-Remaining': String(990 - calls), 'Set-Cookie': apiKey } });
  } });
  assert.equal(calls, 10); assert.equal(manifest.status, 'complete'); assert.equal(manifest.remainingCalls, 980);
  assert.equal(manifest.requestsAttempted, 10); assert.equal(manifest.retries, 0);
  const manifestText = await readFile(join(base.outputDir, 'manifest.json'), 'utf8');
  assert.equal(manifestText.includes(apiKey), false); assert.equal(manifestText.includes('privateField'), false);
  for (const item of manifest.files) {
    const encoded = await readFile(join(base.outputDir, item.file)); const envelope = JSON.parse(encoded);
    assert.deepEqual(Object.keys(envelope), ['version', 'year', 'encryptedKey', 'iv', 'tag', 'payload']);
    assert.equal(envelope.year, item.year); assert.equal(envelope.version, 1);
    assert.equal(Buffer.from(envelope.iv, 'base64').length, 12); assert.equal(Buffer.from(envelope.tag, 'base64').length, 16);
    assert.equal(encoded.toString().includes(`raw-value-${item.year}`), false);
    assert.equal(item.encryptedSha256, sha(encoded));
    const raw = decrypt(envelope);
    assert.equal(raw.toString(), source.get(item.year)); assert.equal(item.rawSha256, sha(raw)); assert.equal(item.rawBytes, raw.length);
    const altered = { ...envelope, tag: Buffer.alloc(16).toString('base64') };
    assert.throws(() => decrypt(altered));
  }
  assert.equal((await readdir(base.outputDir)).length, 12); // ten envelopes, manifest and attempt lock
  await assert.rejects(fetchAdvancedTraining({ ...base, fetchImpl: async () => { calls++; throw new Error('Must not run'); } }), /EEXIST/);
  assert.equal(calls, 10);
});

test('training fetch stops on first HTTP error without reading error text or retrying', async t => {
  const base = await options(t); let calls = 0;
  await assert.rejects(fetchAdvancedTraining({ ...base, fetchImpl: async () => {
    calls++; return new Response(apiKey, { status: 403, headers: { 'X-CallLimit-Remaining': '990' } });
  } }), /1 request attempt/);
  const text = await readFile(join(base.outputDir, 'manifest.json'), 'utf8'); const manifest = JSON.parse(text);
  assert.equal(calls, 1); assert.equal(manifest.files[0].status, 'http-failed');
  assert.equal(manifest.files[0].rawSha256, null); assert.equal(text.includes(apiKey), false);
});

test('training network failure preserves a partial manifest without logging exception details', async t => {
  const base = await options(t); let calls = 0;
  await assert.rejects(fetchAdvancedTraining({ ...base, fetchImpl: async () => {
    calls++; if (calls === 1) return new Response('[]', { headers: { 'X-CallLimit-Remaining': '989' } });
    throw new Error(apiKey);
  } }), /2 request attempt/);
  const text = await readFile(join(base.outputDir, 'manifest.json'), 'utf8'); const manifest = JSON.parse(text);
  assert.equal(calls, 2); assert.equal(manifest.files[0].status, 'encrypted');
  assert.equal(manifest.files[1].status, 'request-failed'); assert.equal(text.includes(apiKey), false);
});

test('training invalid JSON and non-array roots stop before another provider request', async t => {
  for (const body of ['invalid-' + apiKey, JSON.stringify({ error: apiKey })]) {
    const base = await options(t); let calls = 0;
    await assert.rejects(fetchAdvancedTraining({ ...base, fetchImpl: async () => { calls++; return new Response(body); } }), /1 request attempt/);
    const text = await readFile(join(base.outputDir, 'manifest.json'), 'utf8'); const manifest = JSON.parse(text);
    assert.equal(calls, 1); assert.equal(manifest.files[0].status, 'invalid-response'); assert.equal(text.includes(apiKey), false);
    assert.equal(manifest.files[0].file, null);
  }
});

test('training quota guard stops before unfetched years can exceed the reported allowance', async t => {
  const base = await options(t); let calls = 0;
  await assert.rejects(fetchAdvancedTraining({ ...base, fetchImpl: async () => {
    calls++; return new Response('[]', { headers: { 'X-CallLimit-Remaining': '8' } });
  } }), /quota guard/);
  const manifest = JSON.parse(await readFile(join(base.outputDir, 'manifest.json'), 'utf8'));
  assert.equal(calls, 1); assert.equal(manifest.status, 'quota-stopped'); assert.equal(manifest.files[0].status, 'encrypted');
});

test('training fixed-scope and key validation fail before network requests', async t => {
  const base = await options(t); let calls = 0; const fetchImpl = async () => { calls++; throw new Error('Must not run'); };
  for (const changed of [{ ...request, years: [...YEARS, 2020] }, { ...request, years: [...YEARS].reverse() },
    { ...request, maxRequests: 11 }, { ...request, excludeGarbageTime: true }, { ...request, publicKey: 'not-a-key' },
    { ...request, id: 'success-rate-supplement-v2-nov06' },
    { ...request, id: 'success-rate-supplement-v2-nov06', years: [2021, 2022], maxRequests: 10 }])
    await assert.rejects(fetchAdvancedTraining({ ...base, request: changed, fetchImpl }));
  assert.equal(calls, 0); assert.deepEqual(await readdir(base.outputDir), []);
});

test('supplement fetch is limited to the two new fixed years and preserves encrypted exact bytes', async t => {
  const base = await options(t); let calls = 0;
  const years = [2021, 2022];
  const supplement = { ...request, id: 'success-rate-supplement-v2-nov06', years, maxRequests: 2 };
  const manifest = await fetchAdvancedTraining({ ...base, request: supplement, fetchImpl: async (url, init) => {
    const year = years[calls]; calls++;
    assert.equal(url, `https://api.collegefootballdata.com/stats/game/advanced?year=${year}&seasonType=both&excludeGarbageTime=false`);
    assert.equal(init.headers.Authorization, `Bearer ${apiKey}`); assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify([{ season: year, privateField: `supplement-${year}` }]),
      { headers: { 'X-CallLimit-Remaining': String(980 - calls) } });
  } });
  assert.equal(calls, 2); assert.equal(manifest.maxRequests, 2); assert.equal(manifest.requestsAttempted, 2);
  assert.equal(manifest.remainingCalls, 978); assert.equal(manifest.status, 'complete');
  assert.deepEqual(manifest.files.map(f => f.year), years);
  for (const file of manifest.files) {
    const encoded = await readFile(join(base.outputDir, file.file));
    const raw = decrypt(JSON.parse(encoded));
    assert.deepEqual(JSON.parse(raw), [{ season: file.year, privateField: `supplement-${file.year}` }]);
    assert.equal(file.encryptedSha256, sha(encoded)); assert.equal(file.rawSha256, sha(raw));
    assert.equal(encoded.toString().includes('supplement-'), false);
  }
  assert.equal((await readdir(base.outputDir)).length, 4);
});
