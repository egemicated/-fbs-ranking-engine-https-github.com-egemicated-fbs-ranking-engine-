import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scheduledUpdateNeeded } from '../scripts/scheduled-update-needed.mjs';

const now = new Date('2026-11-20T09:45:00Z');
const resultRun = {
  id: 1, event: 'schedule', head_branch: 'main', path: '.github/workflows/weekly.yml',
  display_title: 'Scheduled update (45 2 * * *)', created_at: '2026-11-20T07:46:00Z',
  status: 'completed', conclusion: 'success',
};
const availabilityRun = {
  ...resultRun, path: '.github/workflows/player-availability.yml',
  display_title: 'Scheduled update (45 2 * 8-12,1 *)',
};
const history = runs => async () => ({
  ok: true, json: async () => ({ workflow_runs: runs, total_count: runs.length }),
});
const check = (kind, runs, clock = now) => scheduledUpdateNeeded(kind, {
  now: clock, runId: 2, token: 'test-only', fetcher: history(runs),
});

test('either workflow skips the 4:45 pull after its own successful 2:45 check', async () => {
  assert.equal(await check('results', [resultRun]), false);
  assert.equal(await check('availability', [availabilityRun]), false);
  assert.equal(await check('results', [availabilityRun]), true);
  assert.equal(await check('availability', [resultRun]), true);
});

test('the backup can recover a missing or unsuccessful check, and a late primary cannot duplicate its success', async () => {
  assert.equal(await check('results', []), true);
  assert.equal(await check('availability', [{ ...availabilityRun, conclusion: 'failure' }]), true);
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped']) {
    assert.equal(await check('results', [{ ...resultRun, conclusion }]), true);
  }
  assert.equal(await check('results', [{ ...resultRun, status: 'queued', conclusion: null }]), true);
  assert.equal(await check('results', [{
    ...resultRun, display_title: 'Scheduled update (45 4 * * *)', created_at: '2026-11-20T09:47:00Z',
  }], new Date('2026-11-20T10:00:00Z')), false);
});

test('another day, a manual run, or a run with an old schedule does not suppress a pull', async () => {
  const ignored = [
    { ...resultRun, created_at: '2026-11-20T04:59:59Z' },
    { ...resultRun, id: 3, event: 'workflow_dispatch' },
    { ...resultRun, id: 4, display_title: 'Weekly CFBD rankings' },
    { ...resultRun, id: 2 },
  ];
  assert.equal(await check('results', ignored), true);
  assert.equal(await check('results', [{ ...resultRun, created_at: '2026-07-01T06:45:00Z' }],
    new Date('2026-07-01T08:45:00Z')), false);
  assert.equal(await check('results', [{ ...resultRun, created_at: '2026-03-08T07:01:00Z' }],
    new Date('2026-03-08T08:45:00Z')), false);
});

test('the guard queries the correct GitHub page and stops provider pulls if history cannot be verified', async () => {
  const checkWith = fetcher => scheduledUpdateNeeded('results', { now, runId: 2, token: 'test-only', fetcher });
  assert.equal(await checkWith(async (url, options) => {
    assert.equal(url.hostname, 'api.github.com');
    assert.match(url.pathname, /\/actions\/workflows\/weekly\.yml\/runs$/);
    assert.equal(url.searchParams.get('branch'), 'main');
    assert.equal(url.searchParams.get('event'), 'schedule');
    assert.match(url.searchParams.get('created'), /^>=2026-11-18/);
    assert.equal(options.redirect, 'error');
    return history([])();
  }), true);
  await assert.rejects(checkWith(async () => ({ ok: false })), /could not confirm/);
  await assert.rejects(checkWith(async () => ({
    ok: true, json: async () => ({ workflow_runs: [], total_count: 1 }),
  })), /incomplete/);
});

test('the work after a skipped backup cannot pull a provider or trigger a Sunday stats refresh', async () => {
  const [weekly, availability, stats] = await Promise.all(['weekly', 'player-availability', 'player-stats'].map(name =>
    readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')));
  const crons = workflow => [...workflow.matchAll(/cron: '([^']+)'\s+timezone: '([^']+)'/g)]
    .map(([, cron, zone]) => [cron, zone]);
  assert.deepEqual(crons(availability), [
    ['45 2 * 8-12,1 *', 'America/New_York'], ['45 4 * 8-12,1 *', 'America/New_York'],
  ]);
  for (const workflow of [weekly, availability]) {
    assert.match(workflow, /format\('Scheduled update \(\{0\}\)', github.event.schedule\)/);
    assert.match(workflow, /concurrency:\s+group: [\w-]+\s+cancel-in-progress: false/);
    assert.match(workflow, /if: github.event_name != 'schedule' \|\| steps.schedule.outputs.needed == 'true'/);
  }
  assert.match(weekly, /needed=\$\(node scripts\/weekly-refresh-needed\.js\)/);
  assert.match(weekly, /name: Retry configured support-request notifications\s+if:[^\n]+steps.schedule.outputs.needed == 'true'/);
  assert.match(stats, /Fetch CFBD and calculate rankings" and .conclusion == "success"/);
});
