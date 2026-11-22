import { strict as assert } from 'node:assert';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dataHash } from '../basketball/data.js';
import {
  activeBasketballYear, assembleBasketballState, basketballRefreshPaths, basketballScheduleEvent, checkBasketballDeployment,
  decideManagedBasketballRefresh, managedBasketballSlots, openBasketballState, readBasketballSeed,
  reconcileSharedBasketballQuota, restoreBasketballState, saveSealedBasketballState, sealBasketballState,
} from '../basketball/managed-refresh.mjs';

const date = value => new Date(value);
const checkId = '2027:2026-11-20:primary';
const early = date('2026-11-20T11:15:00Z');
const late = date('2026-11-20T13:15:00Z');
const scheduledGame = { id: 'ncaam-d1:99', startDate: '2026-11-20T10:30:00Z', status: 'scheduled', startTimeTbd: false };
const dataset = { season: 2027, games: [scheduledGame] };
const event = mode => ({ mode, day: '2026-11-20' });
const decision = (mode, checks, now, games = dataset.games) => decideManagedBasketballRefresh({
  event: event(mode), state: { checks, latestRegistryAt: '2026-11-18T13:00:00Z' },
  dataset: { ...dataset, games }, now,
});

test('workflow dispatch slots and operational guard agree across Denver DST and delayed starts', async () => {
  const workflow = await readFile(new URL('../.github/workflows/basketball-refresh.yml', import.meta.url), 'utf8');
  const slots = Object.entries(managedBasketballSlots).map(([cron, { mode }]) => [mode, cron]);
  const dispatchSlots = [...workflow.matchAll(/^\s+(\w+)\) cron='([^']+)' ;;/gm)]
    .map(([, mode, cron]) => [mode, cron]);
  assert.deepEqual(dispatchSlots, slots);
  assert.deepEqual(workflow.match(/options: \[([^\]]+)\]/)?.[1].split(', '),
    ['seed', 'manual', ...slots.map(([mode]) => mode)]);
  assert.doesNotMatch(workflow, /^  schedule:/m);
  assert.ok(workflow.includes('created_at=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" --jq .created_at)'));
  assert.ok(workflow.includes('node scripts/run-basketball-refresh.mjs --mode scheduled --cron "$cron" --queued "$created_at"'));
  const cron = Object.keys(managedBasketballSlots)[0];
  const daily = basketballScheduleEvent(cron, date('2027-03-11T14:30:00Z'), date('2027-03-11T14:30:00Z'));
  const dailyWithDst = basketballScheduleEvent(cron, date('2027-03-15T14:30:00Z'), date('2027-03-15T14:30:00Z'));
  assert.equal(daily.mode, 'primary');
  assert.equal(dailyWithDst.mode, 'primary');
  assert.equal(basketballScheduleEvent(cron, date('2026-03-08T10:16:00Z'), date('2026-03-08T10:25:00Z')).at.toISOString(),
    '2026-03-08T10:15:00.000Z');
  assert.equal(basketballScheduleEvent(cron, date('2026-11-01T11:18:00Z'), date('2026-11-01T11:20:00Z')).at.toISOString(),
    '2026-11-01T11:15:00.000Z');
  assert.equal(basketballScheduleEvent(cron, early, date('2026-11-21T03:00:00Z')).mode, 'expired');
  const afterMidnight = date('2027-04-01T06:30:00Z');
  const tournament = basketballScheduleEvent('45 22 * 3-4 *', afterMidnight, afterMidnight);
  assert.equal(tournament.mode, 'postseason');
  assert.equal(tournament.day, '2027-03-31');
  assert.equal(activeBasketballYear(date('2027-07-01T04:00:00Z')), 2027);
  assert.equal(activeBasketballYear(date('2027-07-01T06:00:00Z')), 2028);
});

test('backup skips a healthy primary and picks up delayed, partial, and missed finals', () => {
  const games = [{ ...scheduledGame, status: 'final', completed: true }];
  const good = { window: checkId, status: 'complete' };
  assert.equal(decision('primary', [good], early).operation, 'publish-cached');
  assert.equal(decision('recovery', [good], late, games).operation, 'publish-cached');
  assert.equal(decision('recovery', [good], late).operation, 'fetch');
  assert.equal(decision('recovery', [], late).operation, 'fetch');
  assert.equal(decision('recovery', [{ ...good, status: 'failed' }], late).operation, 'fetch');
  assert.equal(decision('recovery', [{ ...good, status: 'failed' }, good], late, games).operation, 'publish-cached');
  assert.equal(decision('pregame', [], late).operation, 'publish-cached');
  assert.equal(decision('primary', [], late).refreshTeams, false);
  assert.equal(decision('primary', [], late, []).operation, 'skip');
});

test('postseason slot uses confirmed elapsed fixtures and excludes postponements and ordinary slates', () => {
  assert.equal(decision('postseason', [], late).operation, 'skip');
  assert.equal(decision('postseason', [], late, [{ ...scheduledGame, seasonType: 'postseason' }]).operation, 'fetch');
  assert.equal(decision('postseason', [], late, [{ ...scheduledGame, seasonType: 'postseason', status: 'postponed' }]).operation, 'skip');
  assert.equal(decision('postseason', [], late, [{ ...scheduledGame, seasonType: 'postseason', startTimeTbd: true }]).operation, 'skip');
});

test('metered plan rejects differing balances, unlimited access, and an unconfirmed pool', () => {
  const quota = { sharedPool: true, monthlyLimit: 1000, usedCalls: 80, remainingCalls: 920,
    resetAt: '2026-12-01T00:00:00.000Z', tierName: 'Free' };
  assert.equal(reconcileSharedBasketballQuota(quota, { ...quota, basketballAllowedForRun: 12 }).basketballAllowedForRun, 12);
  assert.throws(() => reconcileSharedBasketballQuota(quota, { ...quota, remainingCalls: 921 }), /same 1,000-call/);
  assert.throws(() => reconcileSharedBasketballQuota({ ...quota, sharedPool: false }, quota), /bounded shared/);
  assert.throws(() => reconcileSharedBasketballQuota({ ...quota, monthlyLimit: null }, quota), /bounded shared/);
});

test('sealed recovery retains an immutable forecast and call reservation, rejects tampering, and writes once', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'gd-basketball-refresh-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const paths = basketballRefreshPaths(fixture);
  const key = '1'.repeat(64), raw = { privateSource: 'source-only data' };
  const forecast = { gameId: 'ncaam-d1:17', capturedAt: '2026-11-19T12:00:00.000Z' };
  const attempt = { endpoint: '/games', purpose: 'current', resetAt: '2026-12-01T00:00:00.000Z' };
  // A no-change run can advance the privately verified window without replacing
  // the published season. Restore the newest checked raw data in that case.
  const source = { fullSchedule: true, sha256: '3'.repeat(64), rawSha256: dataHash({ older: true }) };
  const state = { version: 1, season: 2027, raw, ledger: { version: 1, attempts: [attempt] },
    checkpoint: { checkedAt: early.toISOString(), sha256: source.sha256, rawSha256: dataHash(raw) }, ops: { checks: [] },
    seasons: { 2027: { dataset: { season: 2027, competition: 'ncaam-d1', source }, forecasts: [forecast], editions: [] } } };
  await saveSealedBasketballState(paths.sealedPath, state, key);
  const bytes = await readFile(paths.sealedPath, 'utf8');
  assert.doesNotMatch(bytes, /source-only data|capturedAt/);
  const envelope = JSON.parse(bytes);
  assert.deepEqual(openBasketballState(envelope, key), state);
  assert.throws(() => openBasketballState(envelope, '2'.repeat(64)), /authenticate/);
  const changed = Buffer.from(envelope.payload, 'base64');
  changed[10] ^= 1;
  assert.throws(() => openBasketballState({ ...envelope, payload: changed.toString('base64') }, key), /authenticate/);
  const next = openBasketballState(sealBasketballState(state, key), key);
  await assert.rejects(() => restoreBasketballState(paths, { ...next, raw: { unexpected: true } }), /checkpoint do not match/);
  await restoreBasketballState(paths, next);
  assert.deepEqual(await assembleBasketballState(paths, 2027, state.ops), state);
  await saveSealedBasketballState(paths.sealedPath, next, key);
  assert.deepEqual(openBasketballState(JSON.parse(await readFile(paths.sealedPath, 'utf8')), key), state);
});

test('failed/prior deployments and seed transfers have distinct evidence', async () => {
  const v = 'a'.repeat(24);
  const deployed = version => async () => new Response(`<meta name="basketball-publication" content="${version}">`);
  assert.match(await checkBasketballDeployment(v, deployed(v)), /serving the committed/);
  assert.match(await checkBasketballDeployment(v, deployed('b'.repeat(24))), /different publication/);
  assert.match(await checkBasketballDeployment(v, async () => new Response('', { status: 503 })), /could not be checked/);
  assert.match(await checkBasketballDeployment(undefined, async () => assert.fail('uncalled')), /No committed/);
  assert.deepEqual(await readBasketballSeed('https://example.com/seed', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return Response.json({ version: 1 });
  }), { version: 1 });
  await assert.rejects(() => readBasketballSeed('http://example.com/seed', async () => assert.fail('uncalled')), /could not be retrieved/);
});
