import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { atomicJson } from '../src/ingest.js';
import { createBasketballClient, readBasketballLedger } from '../basketball/data-client.js';
import { acquireBasketballSeason, loadBasketballPrevious, planBasketballSeason, readOptionalJson } from '../basketball/data-refresh.js';
import { CAPTURE_HOURS } from '../basketball/model-ledger.js';
import { localRefreshDay, localRefreshSlot } from '../basketball/refresh-orchestration.js';
import {
  activeBasketballYear, assembleBasketballState, basketballRefreshPaths, basketballScheduleEvent, checkBasketballDeployment,
  decideManagedBasketballRefresh, openBasketballState, readBasketballSeed, reconcileSharedBasketballQuota,
  restoreBasketballState, saveSealedBasketballState, unresolvedBasketballGames,
} from '../basketball/managed-refresh.mjs';
import { RELEASE_REPOSITORY } from './require-release-checks.mjs';

const runProcess = promisify(execFile);
const HOUR = 3_600_000;
const MAX_RUN_CALLS = 12;
const root = resolve('.');
const paths = basketballRefreshPaths(root);
const published = join(root, 'published', 'basketball-site');

async function getFootballQuota(token) {
  const response = await fetch('https://api.collegefootballdata.com/info', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response?.ok) throw new Error('The production football credential could not verify its shared allowance.');
  return response.json().catch(() => null);
}

async function getManagedQuota(client, footballKey) {
  // Retry only the unmetered checks once to accommodate an overlapping football debit.
  let lastError;
  for (let pass = 0; pass < 2; pass++) {
    const [football, basketball] = await Promise.all([getFootballQuota(footballKey), client.checkQuota()]);
    try { return reconcileSharedBasketballQuota(football, basketball); }
    catch (error) { lastError = error; }
  }
  throw lastError;
}

function newOps(state) {
  const dataset = state?.seasons[state.season]?.dataset;
  return { checks: [], latestRegistryAt: dataset?.source?.registryAsOf ?? dataset?.source?.asOf,
    latestSourceAt: state?.checkpoint?.checkedAt, quota: null };
}

function outputDate(date) {
  return Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : 'Unavailable';
}

function nextPrimary(now) {
  for (let days = 0; days <= 214; days++) {
    const date = new Date(Date.parse(localRefreshDay(now)) + days * 24 * HOUR).toISOString().slice(0, 10);
    if ([5, 6, 7, 8, 9, 10].includes(Number(date.slice(5, 7)))) continue;
    const at = localRefreshSlot(date, '04:15');
    if (at > now) return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }).format(at) + ' Mountain';
  }
  return 'Unavailable';
}

async function monitor(ops, detail = {}, now = new Date()) {
  const football = await readOptionalJson(join(root, 'published', 'latest.json'));
  const deployment = await checkBasketballDeployment(detail.committed?.version);
  const basketballAge = Number.isFinite(Date.parse(ops.latestSourceAt)) ? (now - Date.parse(ops.latestSourceAt)) / HOUR : null;
  const footballAge = Number.isFinite(Date.parse(football?.asOf)) ? (now - Date.parse(football.asOf)) / HOUR : null;
  const dashboard = [
    '### Basketball refresh',
    '',
    `- ${detail.note ?? 'Retained source and publication check.'}`,
    `- Football publication: ${outputDate(football?.asOf)}${footballAge === null ? '' : ` (${Math.round(footballAge)} hours old)`}`,
    `- Last successful basketball source check: ${outputDate(ops.latestSourceAt)}${basketballAge === null ? '' : ` (${Math.round(basketballAge)} hours old)`}`,
    `- Last successful basketball model/build: ${outputDate(ops.candidate?.generatedAt)}`,
    `- Committed basketball publication: ${outputDate(detail.committed?.generatedAt)}`,
    `- Production verification: ${deployment}`,
    `- Games reconciled in this run: ${detail.reconciled ?? 0}. Cached elapsed games awaiting results: ${detail.pending ?? 'unknown'}.`,
    `- Shared quota: ${detail.quotaVerified ? 'verified before acquisition' : 'no metered acquisition started or quota could not be verified'}. Basketball attempts this run: ${detail.metered ?? 0}.`,
    `- Next primary check: ${nextPrimary(now)}`,
    ...(basketballAge > 34 && [1, 2, 3, 4, 11, 12].includes(Number(localRefreshDay(now).slice(5, 7)))
      ? ['- Basketball source check is late. Review the overnight and recovery runs.'] : []),
    '',
  ].join('\n');
  console.log(dashboard);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, dashboard + '\n');
}

function assertManagedRunner() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY ||
      process.env.GITHUB_REF !== 'refs/heads/main' || !['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) {
    throw new Error('Managed basketball refresh is limited to the authorized production workflow.');
  }
}

async function acquire(season, dataset, now, plan, memo) {
  const footballKey = process.env.CFBD_API_KEY;
  const separateKey = process.env.CBBD_API_KEY;
  if (!footballKey || (separateKey && separateKey !== footballKey && process.env.BASKETBALL_SHARED_ACCOUNT_VERIFIED !== 'true')) {
    throw new Error('Confirm basketball access belongs to the production football quota before enabling acquisition.');
  }
  const ledger = await readBasketballLedger(paths.ledgerPath);
  const client = createBasketballClient({
    token: separateKey || footballKey, ledger, maxCalls: MAX_RUN_CALLS, now: () => new Date(),
    saveLedger: value => atomicJson(paths.ledgerPath, value, { spacing: 0 }),
  });
  const args = { season, ...paths, now, rolling: Boolean(dataset), players: plan.players, boxes: plan.boxes, refreshTeams: plan.refreshTeams };
  const before = planBasketballSeason({ ...args, previous: dataset });
  if (before.estimatedCalls > MAX_RUN_CALLS) {
    throw new Error('The rolling recovery is larger than the scheduled cap. Run a reviewed, bounded reconciliation outside the scheduler.');
  }
  memo.quota = await getManagedQuota(client, footballKey);
  memo.quotaVerified = true;
  try {
    if (before.estimatedCalls > memo.quota.basketballAllowedForRun) {
      throw new Error('The protected shared balance cannot cover the planned basketball requests.');
    }
    await acquireBasketballSeason({ ...args, client });
    return { checkedAt: now.toISOString(), fetchedTeams: before.fetchTeams };
  } finally {
    memo.metered = client.runAttempts;
    if (client.runAttempts) {
      // Never increase the permitted balance if this second observation fails.
      try { memo.quota = await getManagedQuota(client, footballKey); }
      catch { memo.quota = { ...memo.quota, estimatedRemainingUpperBound: memo.quota.remainingCalls - client.runAttempts }; }
    }
  }
}

async function shouldRender(season, dataset, ops, committed, now) {
  if (!committed || ops.candidate?.version !== committed.version || ops.candidate?.sourceHash !== dataset.source.sha256) return true;
  const forecasts = await readOptionalJson(join(paths.stateDir, season + '-forecasts.json'));
  const alreadySaved = new Set(forecasts?.map(game => game.gameId));
  return dataset.games.some(game => {
    const untilTipoff = Date.parse(game.startDate) - now;
    return !alreadySaved.has(game.id) && game.divisionOne && game.status === 'scheduled' &&
      !game.completed && game.startTimeTbd === false && untilTipoff > 0 && untilTipoff <= CAPTURE_HOURS * HOUR;
  });
}

async function render(season, dataset, now, ops) {
  const env = { ...process.env };
  for (const name of ['CFBD_API_KEY', 'CBBD_API_KEY', 'BASKETBALL_REFRESH_SEED_URL', 'BASKETBALL_REFRESH_CACHE_KEY']) delete env[name];
  await runProcess(process.execPath, ['scripts/publish-basketball-site.mjs', '--season', String(season), '--state-dir', paths.stateDir], { cwd: root, env });
  const manifest = await readOptionalJson(join(published, 'manifest.json'));
  if (!manifest || !/^[a-f0-9]{24}$/.test(manifest.version) || manifest.currentSeason !== season ||
      !Number.isFinite(Date.parse(manifest.generatedAt)) || Date.parse(manifest.generatedAt) < now.getTime()) {
    throw new Error('Basketball model output and the candidate site publication do not match.');
  }
  ops.candidate = { version: manifest.version, sourceHash: dataset.source.sha256, generatedAt: manifest.generatedAt };
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'candidate=true\n');
}

async function main() {
  const { values } = parseArgs({ options: {
    mode: { type: 'string' }, cron: { type: 'string' }, queued: { type: 'string' },
    input: { type: 'string' }, output: { type: 'string' },
  } });
  const now = new Date(), activeYear = activeBasketballYear(now);
  const cacheKey = process.env.BASKETBALL_REFRESH_CACHE_KEY;
  if (values.mode === 'pack') {
    const state = await assembleBasketballState(paths, activeYear, { checks: [] });
    state.ops = newOps(state);
    await saveSealedBasketballState(resolve(values.output ?? paths.sealedPath), state, cacheKey);
    console.log(`Sealed private working inputs for ${Object.keys(state.seasons).length} basketball seasons.`);
    return;
  }
  if (values.mode === 'inspect') {
    const envelope = await readOptionalJson(resolve(values.input ?? paths.sealedPath));
    const state = openBasketballState(envelope, cacheKey);
    const { latestSourceAt, latestRegistryAt, candidate, quota, checks } = state.ops;
    const latest = checks.at(-1);
    console.log(JSON.stringify({ season: state.season, latestSourceAt, latestRegistryAt, candidate,
      sharedQuota: quota, latestCheck: latest && { at: latest.at, status: latest.status, reconciled: latest.reconciled,
        unresolved: latest.unresolved?.length },
    }, null, 2));
    return;
  }
  assertManagedRunner();
  if (!['seed', 'scheduled', 'manual'].includes(values.mode)) throw new Error('Unknown basketball refresh mode.');
  const existingEnvelope = await readOptionalJson(paths.sealedPath);
  if (values.mode === 'seed' && existingEnvelope) throw new Error('A validated working cache already exists. Retain it instead of overwriting live forecast history.');
  const envelope = existingEnvelope ?? (values.mode === 'seed' && await readBasketballSeed(process.env.BASKETBALL_REFRESH_SEED_URL));
  if (!envelope) {
    await monitor({}, { note: 'The encrypted working cache is unavailable. Scheduled pulls paused to preserve forecast history.' }, now);
    throw new Error('Restore the authorized basketball recovery seed before resuming.');
  }
  const state = openBasketballState(envelope, cacheKey);
  await restoreBasketballState(paths, state);
  const ops = state.ops;
  const detail = { committed: await readOptionalJson(join(published, 'manifest.json')) };
  if (values.mode === 'seed') {
    if (state.season !== activeYear) throw new Error('The working seed does not include the active basketball season.');
    await saveSealedBasketballState(paths.sealedPath, state, cacheKey);
    await monitor(ops, { ...detail, note: 'Authenticated and retained the private working seed. No provider calls or publication.' }, now);
    return;
  }
  const event = values.mode === 'scheduled'
    ? basketballScheduleEvent(values.cron, new Date(values.queued), now)
    : { mode: 'manual', day: localRefreshDay(now), at: now };
  let active = state.season;
  let dataset = (await loadBasketballPrevious(activeYear, paths.artifactsDir, paths.cacheDir)).artifact;
  const stage = async () => {
    if (!dataset && !['primary', 'recovery', 'manual'].includes(event.mode)) {
      detail.note = 'No active season is available for this window.';
      return;
    }
    const plan = dataset ? decideManagedBasketballRefresh({ event, state: ops, dataset, now })
      : { operation: 'fetch', window: `${activeYear}:${event.day}:${event.mode}`, refreshTeams: true, boxes: true, players: true,
          reason: 'Initialize the new basketball season while preserving older live forecasts.' };
    detail.note = plan.reason;
    if (plan.operation === 'fetch') {
      const before = new Map(dataset?.games.map(game => [game.id, game]));
      let refreshed;
      try { refreshed = await acquire(activeYear, dataset, now, plan, detail); }
      catch (error) {
        ops.checks.push({ window: plan.window, at: now.toISOString(), status: 'failed', detail: error.message });
        detail.note = 'Basketball acquisition failed or was guarded. The previous coherent publication was retained.';
        throw error;
      }
      active = activeYear;
      dataset = (await loadBasketballPrevious(active, paths.artifactsDir, paths.cacheDir)).artifact;
      if (!dataset) throw new Error('Validated season data is unavailable after refresh.');
      ops.latestSourceAt = refreshed.checkedAt;
      if (refreshed.fetchedTeams) ops.latestRegistryAt = refreshed.checkedAt;
      const overdue = unresolvedBasketballGames(dataset, now);
      detail.pending = overdue.length;
      detail.reconciled = dataset.games.filter(game => {
        if (!game.completed) return false;
        const previous = before.get(game.id);
        return !previous?.completed || previous.homePoints !== game.homePoints || previous.awayPoints !== game.awayPoints;
      }).length;
      ops.checks.push({ window: plan.window, at: now.toISOString(), status: 'complete',
        incomplete: overdue.length > 0, unresolved: overdue.map(game => game.id), reconciled: detail.reconciled });
    }
    if (dataset && plan.operation !== 'skip' && await shouldRender(active, dataset, ops, detail.committed, now)) {
      await render(active, dataset, now, ops);
    }
  };
  try {
    await stage();
  } catch (error) {
    ops.latestFailure = { at: new Date().toISOString(), stage: detail.note?.startsWith('Basketball acquisition failed')
      ? 'acquisition' : 'publication', detail: error.stderr ?? error.message };
    throw error;
  } finally {
    if (detail.quota) ops.quota = detail.quota;
    ops.checks = ops.checks.slice(-110);
    await saveSealedBasketballState(paths.sealedPath, await assembleBasketballState(paths, active, ops), cacheKey);
    await monitor(ops, detail, now);
  }
}

main().catch(error => {
  if (process.argv.includes('pack') || process.argv.includes('inspect')) console.error(error.message);
  else console.error('Basketball refresh did not complete. Review the protected working cache and the job summary.');
  process.exitCode = 1;
});
