import assert from 'node:assert/strict';
import test from 'node:test';
import { RELEASE_REPOSITORY, waitForReleaseChecks, requireRenderReleaseChecks } from '../scripts/require-release-checks.mjs';

const commit = 'a'.repeat(40);
const run = overrides => ({ id: 10, head_sha: commit, head_branch: 'main', path: '.github/workflows/test.yml',
  event: 'push', head_repository: { full_name: RELEASE_REPOSITORY }, created_at: '2026-11-18T20:00:00Z',
  run_attempt: 1, status: 'completed', conclusion: 'success', ...overrides });
const response = rows => ({ ok: true, json: async () => ({ workflow_runs: rows }) });

test('Render release gate requires exact-revision CI evidence and does not recurse in CI', async () => {
  let calls = 0;
  assert.equal(await requireRenderReleaseChecks({}, { fetcher: () => { throw Error('Unexpected network'); } }), null);
  const result = await waitForReleaseChecks({ commit, log: () => {}, fetcher: async url => {
    calls++; assert.match(url, /workflows\/test.yml\/runs\?head_sha=a{40}&branch=main/); return response([run()]);
  } });
  assert.equal(calls, 1); assert.equal(result.runId, 10);
  await assert.rejects(waitForReleaseChecks({ commit: 'main' }), /exact Git commit/);
});

test('older success, another revision and another repository never override the newest failing run', async () => {
  await assert.rejects(waitForReleaseChecks({ commit, log: () => {}, fetcher: async () => response([
    run(), run({ id: 11, conclusion: 'failure', run_attempt: 2 }),
  ]) }), /failure/);
  for (const invalid of [run({ head_sha: 'b'.repeat(40) }), run({ event: 'pull_request' }),
    run({ head_repository: { full_name: 'other/repo' } }), run({ path: '.github/workflows/optional.yml' })]) {
    await assert.rejects(waitForReleaseChecks({ commit, timeoutMs: 0, fetcher: async () => response([invalid]) }), /Timed out/);
  }
});

test('pending CI is bounded and API errors fail closed without exposing response bodies', async () => {
  let clock = 0, calls = 0;
  const result = await waitForReleaseChecks({ commit, now: () => clock, intervalMs: 30, timeoutMs: 60,
    sleep: async ms => { clock += ms; }, log: () => {}, fetcher: async () => response([
      run({ status: ++calls === 1 ? 'in_progress' : 'completed' }),
    ]) });
  assert.equal(result.runId, 10); assert.equal(calls, 2);
  await assert.rejects(waitForReleaseChecks({ commit, fetcher: async () => ({ ok: false, status: 429 }) }), /HTTP 429/);
  await assert.rejects(waitForReleaseChecks({ commit, fetcher: async () => { throw Error('PRIVATE_BODY'); } }),
    error => !error.message.includes('PRIVATE_BODY') && /previous deployment retained/.test(error.message));
});
