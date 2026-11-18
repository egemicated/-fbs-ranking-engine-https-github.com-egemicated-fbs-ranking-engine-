import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recoverPollProvider } from '../scripts/recover-poll-provider.js';

const request = { schemaVersion: 1, id: 'poll-recovery-test', seasons: [2025, 2026] };
test('provider recovery makes exactly two allowlisted calls and saves no raw or secret fields', async () => {
  const output = await mkdtemp(join(tmpdir(), 'poll-recovery-'));
  const urls = [];
  try {
    const manifest = await recoverPollProvider({ request, key: 'private-fixture-value', output, fetcher: async (url, options) => {
      urls.push(url); assert.equal(options.headers.Authorization, 'Bearer private-fixture-value');
      return new Response(JSON.stringify([{ season: Number(new URL(url).searchParams.get('year')), seasonType: 'regular', week: 1,
        secretNoise: 'exclude-me', polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, teamId: 61, school: 'Georgia', secretNoise: 'exclude-me' }] }] }]));
    } });
    assert.deepEqual(urls, [2025, 2026].map(year => `https://api.collegefootballdata.com/rankings?year=${year}&seasonType=both`));
    assert.equal(manifest.providerCalls, 2); assert.equal(manifest.status, 'complete');
    const saved = await readFile(join(output, '2025-provider-editions.json'), 'utf8');
    assert.ok(!saved.includes('exclude-me') && !saved.includes('private-fixture-value'));
    assert.equal(JSON.parse(saved).editions[0].polls[0].ranks[0].teamId, 61);
  } finally { await rm(output, { recursive: true }); }
});

test('invalid JSON and connection failures retain attempted-call counts with redacted errors', async () => {
  for (const fetcher of [async () => new Response('PRIVATE_PROVIDER_BODY'), async () => { throw Error('PRIVATE_HEADER'); }]) {
    const output = await mkdtemp(join(tmpdir(), 'poll-failure-'));
    try {
      await assert.rejects(recoverPollProvider({ request, key: 'private-fixture-value', output, fetcher }), error => !error.message.includes('PRIVATE'));
      const saved = await readFile(join(output, 'manifest.json'), 'utf8');
      assert.ok(!saved.includes('PRIVATE')); assert.equal(JSON.parse(saved).providerCalls, 1); assert.equal(JSON.parse(saved).status, 'failed');
    } finally { await rm(output, { recursive: true }); }
  }
});
