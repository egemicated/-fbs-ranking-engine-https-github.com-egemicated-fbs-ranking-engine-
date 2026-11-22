import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { dataHash } from './data.js';

const endpoints = new Set(['/info', '/teams', '/games', '/games/teams', '/games/players', '/rankings']);
const host = 'https://api.collegebasketballdata.com';
const retryLimit = 2;

export const BASKETBALL_BUDGET = Object.freeze({
  footballReserve: 600, contingencyReserve: 150, basketballMonthly: 250, maxCallsPerRun: 90,
});

export function normalizeBasketballQuota(value) {
  const resetAt = Date.parse(value?.resetAt);
  if (value?.sharedPool !== true || !Number.isInteger(value.monthlyLimit) || value.monthlyLimit <= 0
    || !Number.isInteger(value.remainingCalls) || !Number.isInteger(value.usedCalls)
    || value.remainingCalls < 0 || value.usedCalls < 0 || value.remainingCalls + value.usedCalls !== value.monthlyLimit
    || !Number.isFinite(resetAt)) {
    throw new Error('Provider did not confirm a bounded shared basketball/football quota');
  }
  return {
    tierName: typeof value.tierName === 'string' ? value.tierName : null,
    monthlyLimit: value.monthlyLimit, remainingCalls: value.remainingCalls, usedCalls: value.usedCalls,
    resetAt: new Date(resetAt).toISOString(), sharedPool: true,
  };
}

export function basketballBudgetReport(quota, entries, maxCalls = BASKETBALL_BUDGET.maxCallsPerRun) {
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > BASKETBALL_BUDGET.maxCallsPerRun) {
    throw new Error(`Basketball per-run cap must be 0–${BASKETBALL_BUDGET.maxCallsPerRun}`);
  }
  const attempts = entries.filter(entry => entry.resetAt === quota.resetAt);
  const byPurpose = {};
  for (const { purpose } of attempts) byPurpose[purpose] = (byPurpose[purpose] ?? 0) + 1;
  const protectedCalls = BASKETBALL_BUDGET.footballReserve + BASKETBALL_BUDGET.contingencyReserve;
  const available = Math.max(0, Math.min(maxCalls, quota.remainingCalls - protectedCalls,
    BASKETBALL_BUDGET.basketballMonthly - attempts.length));
  return {
    ...quota, ...BASKETBALL_BUDGET, protectedCalls, maxCalls, basketballAttemptsThisMonth: attempts.length,
    basketballReservedByPurpose: byPurpose, basketballAllowedForRun: available,
    sharedCallsUsedOutsideThisLedgerLowerBound: Math.max(0, quota.usedCalls - attempts.length),
    balanceIfRunSpendsAllowance: quota.remainingCalls - available,
  };
}

export async function readBasketballLedger(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.version !== 1 || !Array.isArray(value.attempts) || value.attempts.some(row => !row
      || !endpoints.has(row.endpoint) || row.endpoint === '/info'
      || !['current', 'historical', 'correction'].includes(row.purpose)
      || !Number.isFinite(Date.parse(row.resetAt)))) throw new Error('Invalid basketball quota ledger');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, attempts: [] };
    throw error;
  }
}

export async function withBasketballRefreshLock(lockPath, run) {
  await mkdir(dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('A basketball acquisition is already reserved in this cache');
    throw error;
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await run();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

function getUrl(endpoint, query) {
  if (!endpoints.has(endpoint)) throw new Error('Basketball endpoint is outside the approved core acquisition set');
  const url = new URL(endpoint, host);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

function delay(response, attempt) {
  const retryAfter = response?.headers.get('retry-after');
  const provided = retryAfter ? Number(retryAfter) * 1000 : null;
  const httpDate = retryAfter && !Number.isFinite(provided) ? Date.parse(retryAfter) - Date.now() : null;
  return Math.max(250 * 2 ** (attempt - 1), provided || httpDate || 0);
}

async function storeResponse(rawDir, sha256, body) {
  await mkdir(rawDir, { recursive: true });
  const path = join(rawDir, sha256 + '.json');
  try {
    await writeFile(path + '.tmp', body, { encoding: 'utf8', mode: 0o600 });
    await rename(path + '.tmp', path);
  } catch (error) {
    await unlink(path + '.tmp').catch(() => {});
    throw error;
  }
}

export function createBasketballClient({
  token, fetcher = fetch, sleep = wait, now = () => new Date(),
  ledger = { version: 1, attempts: [] }, saveLedger = async () => {}, rawDir,
  maxCalls = BASKETBALL_BUDGET.maxCallsPerRun,
}) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Supply an existing CBBD_API_KEY or CFBD_API_KEY to the local process');
  let quota, runAttempts = 0;
  const observations = [];
  const get = (url) => fetcher(url, {
    method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(25_000),
  });

  async function checkQuota() {
    const response = await get(getUrl('/info', {})).catch(() => {
      throw new Error('Unable to verify shared CBBD balance');
    });
    if (!response.ok) throw new Error(`Shared CBBD quota verification returned HTTP ${response.status}`);
    quota = normalizeBasketballQuota(await response.json().catch(() => null));
    if (Date.parse(quota.resetAt) <= now().getTime()) throw new Error('Shared CBBD quota has an expired reset timestamp');
    return basketballBudgetReport(quota, ledger.attempts, maxCalls);
  }

  async function request(endpoint, query = {}, purpose = 'current') {
    if (!quota || endpoint === '/info') throw new Error('Check shared quota before starting metered basketball requests');
    if (!['current', 'historical', 'correction'].includes(purpose)) throw new Error('Invalid basketball acquisition purpose');
    const url = getUrl(endpoint, query);
    for (let attempt = 1; attempt <= retryLimit + 1; attempt++) {
      const budget = basketballBudgetReport(quota, ledger.attempts, maxCalls - runAttempts);
      if (budget.basketballAllowedForRun < 1 || Date.parse(quota.resetAt) <= now().getTime()) {
        throw new Error('Basketball acquisition stopped at its shared quota or per-run reserve');
      }
      const entry = { endpoint, query, purpose, attemptedAt: now().toISOString(), resetAt: quota.resetAt };
      ledger.attempts.push(entry);
      await saveLedger(ledger); // An interruption after this reservation still counts conservatively.
      runAttempts++;
      quota = { ...quota, remainingCalls: quota.remainingCalls - 1, usedCalls: quota.usedCalls + 1 };
      const response = await get(url).catch(() => null);
      if (!response) {
        if (attempt > retryLimit) throw new Error(`CBBD ${endpoint} could not complete within its retry limit`);
        await sleep(delay(null, attempt));
        continue;
      }
      const remaining = response.headers.get('x-calllimit-remaining');
      if (remaining !== null && /^\d+$/.test(remaining)) {
        const conservative = Math.min(quota.remainingCalls, Number(remaining));
        quota = { ...quota, remainingCalls: conservative, usedCalls: quota.monthlyLimit - conservative };
      }
      const body = await response.text().catch(() => '');
      if (!response.ok) {
        const stopped = response.status === 429 && /monthly|quota exceeded/i.test(body);
        const transient = response.status === 408 || response.status === 429 || response.status >= 500;
        const retryDelay = delay(response, attempt);
        if (!transient || stopped || attempt > retryLimit || retryDelay > 5000) {
          throw new Error(`CBBD ${endpoint} returned HTTP ${response.status}${stopped ? ' (monthly quota exhausted)' : ''}`);
        }
        await sleep(retryDelay);
        continue;
      }
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        throw new Error(`CBBD ${endpoint} returned an unreadable response`);
      }
      const sha256 = dataHash(body);
      if (rawDir) await storeResponse(rawDir, sha256, body);
      observations.push({ ...entry, sha256, records: Array.isArray(value) ? value.length : null,
        remainingCalls: quota.remainingCalls });
      return value;
    }
  }

  return { checkQuota, request, observations, get runAttempts() { return runAttempts; } };
}
