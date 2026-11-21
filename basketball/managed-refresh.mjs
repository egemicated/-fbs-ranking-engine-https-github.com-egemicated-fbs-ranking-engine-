import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { atomicJson } from '../src/ingest.js';
import { normalizeBasketballQuota, readBasketballLedger } from './data-client.js';
import { dataHash } from './data.js';
import { readOptionalJson } from './data-refresh.js';
import { localRefreshDay, localRefreshSlot, refreshTimetable } from './refresh-orchestration.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_SEED_BYTES = 96 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const seasonPattern = /^20\d{2}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const info = Buffer.from('The Games Decide basketball refresh cache v1');
const basketball = refreshTimetable.basketball;

export const managedBasketballSlots = Object.freeze({
  '15 4 * 1-4,11-12 *': { mode: 'primary', time: basketball.primary, months: [1, 2, 3, 4, 11, 12] },
  '15 6 * 1-4,11-12 *': { mode: 'recovery', time: basketball.recovery, months: [1, 2, 3, 4, 11, 12] },
  '15 10 * 1-4,11-12 *': { mode: 'pregame', time: basketball.forecastOnly, months: [1, 2, 3, 4, 11, 12] },
  '45 22 * 3-4 *': { mode: 'postseason', time: basketball.tournamentFinals, months: [3, 4] },
});

// Prefer the nominal event slot over runner start time. GitHub can delay execution.
export function basketballScheduleEvent(cron, queuedAt, now) {
  const slot = managedBasketballSlots[cron];
  if (!slot || !Number.isFinite(queuedAt?.getTime()) || !Number.isFinite(now?.getTime()) || queuedAt > now) {
    throw new Error('Invalid scheduled basketball refresh event');
  }
  const today = localRefreshDay(queuedAt);
  const previous = new Date(Date.parse(today) - DAY).toISOString().slice(0, 10);
  for (const day of [today, previous]) {
    if (!slot.months.includes(Number(day.slice(5, 7)))) continue;
    const at = localRefreshSlot(day, slot.time);
    if (at <= queuedAt && now - at <= 12 * HOUR) return { mode: slot.mode, day, at };
  }
  return { mode: 'expired', day: today };
}

export function activeBasketballYear(now) {
  const localDay = localRefreshDay(now);
  return Number(localDay.slice(0, 4)) + Number(Number(localDay.slice(5, 7)) >= 7);
}

export function unresolvedBasketballGames(dataset, now, { postseason = false, days = 7 } = {}) {
  return dataset.games.filter(game => {
    const tipoff = Date.parse(game.startDate);
    return !game.completed && game.startTimeTbd === false && ['scheduled', 'in_progress', 'unverified'].includes(game.status) &&
      Number.isFinite(tipoff) && tipoff >= now - days * DAY && tipoff <= now - basketball.resultDelay * 60_000 &&
      (!postseason || game.seasonType === 'postseason' || Boolean(game.tournament));
  });
}

export function decideManagedBasketballRefresh({ event, state, dataset, now }) {
  const window = `${dataset.season}:${event.day}:${event.mode}`;
  const finish = (operation, reason, options = {}) => ({ operation, reason, window, ...options });
  if (event.mode === 'expired') return finish('skip', 'The GitHub trigger arrived after its reconciliation window.');
  if (event.mode === 'manual') return finish('fetch', 'Manual rolling recovery requested.', { refreshTeams: true, boxes: true, players: true });
  if (state.checks.some(item => item.window === window && item.status === 'complete')) {
    return finish('publish-cached', 'This window was already checked. Reuse its validated inputs.');
  }
  if (event.mode === 'pregame') return finish('publish-cached', 'Capture eligible pregame predictions from the saved slate.');
  const due = unresolvedBasketballGames(dataset, now, { postseason: event.mode === 'postseason', days: event.mode === 'primary' ? 7 : 2 });
  const primary = state.checks.findLast(item => item.window === `${dataset.season}:${event.day}:primary`);
  if (event.mode === 'postseason' && !due.length) {
    return finish('skip', 'No verified postseason or tournament tipoffs are due for results.');
  }
  if (event.mode === 'recovery' && primary?.status === 'complete' && !primary.incomplete && !due.length) {
    return finish('publish-cached', 'The primary check already reconciled eligible results.');
  }
  const active = dataset.games.some(game => {
    const tipoff = Date.parse(game.startDate);
    return tipoff >= now - 3 * DAY && tipoff <= now + 14 * DAY && !['cancelled', 'postponed'].includes(game.status);
  });
  if (!active && !due.length) return finish('skip', 'There are no games near this date in the saved slate.');
  const refreshTeams = event.mode !== 'postseason' &&
    (!Number.isFinite(Date.parse(state.latestRegistryAt)) || now - Date.parse(state.latestRegistryAt) >= 7 * DAY);
  if (event.mode === 'recovery' && primary?.status === 'complete' && !due.length) {
    return finish('publish-cached', 'The primary source check finished. Remaining older gaps are revisited in the next rolling window.');
  }
  return finish('fetch', due.length ? `Reconcile ${due.length} elapsed cached tipoffs and nearby records.`
    : 'Check the active slate for schedule, result and statistics corrections.',
  { refreshTeams, boxes: true, players: true });
}

export function reconcileSharedBasketballQuota(football, basketballQuota) {
  const checked = normalizeBasketballQuota(football);
  if (checked.monthlyLimit !== 1000 || basketballQuota.monthlyLimit !== 1000 ||
      checked.resetAt !== basketballQuota.resetAt || checked.tierName !== basketballQuota.tierName ||
      checked.remainingCalls !== basketballQuota.remainingCalls) {
    throw new Error('Football and basketball did not confirm the same 1,000-call shared balance. No metered request started.');
  }
  return basketballQuota;
}

export async function checkBasketballDeployment(version, fetcher = fetch) {
  if (!/^[a-f0-9]{24}$/.test(version ?? '')) return 'No committed basketball version.';
  try {
    const response = await fetcher('https://www.thegamesdecide.com/basketball/', {
      redirect: 'follow', signal: AbortSignal.timeout(12_000), cache: 'no-store',
    });
    if (!response.ok) return 'The production basketball page could not be checked.';
    const html = await response.text();
    const deployed = html.match(/<meta name="basketball-publication" content="([a-f0-9]{24})">/)?.[1];
    if (!deployed) return 'The production basketball page has no validated publication marker.';
    return deployed === version ? 'Production is serving the committed publication.'
      : 'Production is still serving a different publication. Check the exact-revision release status.';
  } catch { return 'The production basketball page could not be checked.'; }
}

function cacheKey(secret, salt) {
  if (!digestPattern.test(secret ?? '')) throw new Error('The 32-byte basketball cache key is unavailable or invalid.');
  const keyMaterial = Buffer.from(secret, 'hex');
  try { return Buffer.from(hkdfSync('sha256', keyMaterial, salt, info, 32)); }
  finally { keyMaterial.fill(0); }
}

export function sealBasketballState(data, secret) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = cacheKey(secret, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(info);
    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    if (plaintext.length > MAX_UNCOMPRESSED_BYTES) throw new Error('Basketball working cache exceeds its safety limit.');
    const payload = Buffer.concat([cipher.update(gzipSync(plaintext)), cipher.final()]);
    return { version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), payload: payload.toString('base64') };
  } finally { key.fill(0); }
}

export function openBasketballState(envelope, secret) {
  if (envelope?.version !== 1 || typeof envelope.payload !== 'string' || envelope.payload.length > MAX_SEED_BYTES) {
    throw new Error('Unsupported basketball working cache.');
  }
  const salt = Buffer.from(envelope.salt ?? '', 'base64'), iv = Buffer.from(envelope.iv ?? '', 'base64');
  const tag = Buffer.from(envelope.tag ?? '', 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('Invalid basketball working cache.');
  const key = cacheKey(secret, salt);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(info);
    decipher.setAuthTag(tag);
    const bytes = Buffer.concat([decipher.update(Buffer.from(envelope.payload, 'base64')), decipher.final()]);
    return JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }));
  } catch {
    throw new Error('Basketball working cache could not authenticate. The prior publication remains available.');
  } finally { key.fill(0); }
}

export async function saveSealedBasketballState(path, data, secret) {
  const json = JSON.stringify(sealBasketballState(data, secret)) + '\n';
  if (Buffer.byteLength(json) > MAX_SEED_BYTES) throw new Error('Basketball working cache exceeds its encrypted safety limit.');
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try {
    try { await file.writeFile(json); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function readBasketballSeed(urlValue, fetcher = fetch) {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_SEED_BYTES) throw new Error();
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_SEED_BYTES) throw new Error();
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('The encrypted basketball seed could not be retrieved. The prior publication remains available.');
  }
}

export function basketballRefreshPaths(root) {
  const cacheDir = join(root, 'research', 'cache', 'basketball');
  return {
    artifactsDir: join(root, 'data', 'seasons', 'basketball'),
    cacheDir,
    ledgerPath: join(cacheDir, 'quota-ledger.json'),
    stateDir: join(cacheDir, 'preview'),
    sealedPath: join(cacheDir, 'managed-refresh.encrypted.json'),
  };
}

export async function assembleBasketballState(paths, season, ops) {
  const files = await readdir(paths.artifactsDir);
  const years = files.filter(name => /^20\d{2}\.json$/.test(name)).map(name => name.slice(0, 4)).sort();
  const seasons = Object.fromEntries(await Promise.all(years.map(async year => {
    const [dataset, forecasts, editions] = await Promise.all([
      readOptionalJson(join(paths.artifactsDir, year + '.json')),
      readOptionalJson(join(paths.stateDir, year + '-forecasts.json')),
      readOptionalJson(join(paths.stateDir, year + '-editions.json')),
    ]);
    if (dataset?.season !== Number(year) || dataset.competition !== 'ncaam-d1' || !dataset.source?.fullSchedule) {
      throw new Error('A complete season acquisition is required to preserve basketball working data.');
    }
    return [year, { dataset, forecasts, editions }];
  })));
  const checkpoint = await readOptionalJson(join(paths.cacheDir, season + '-checked.json'));
  const source = seasons[season]?.dataset.source;
  const rawHash = checkpoint?.rawSha256 ?? source?.rawSha256;
  if (!digestPattern.test(rawHash ?? '') || !checkpoint || checkpoint.sha256 !== source?.sha256) {
    throw new Error('The current basketball source checkpoint is unavailable.');
  }
  const raw = await readOptionalJson(join(paths.cacheDir, rawHash + '.json'));
  if (!raw || dataHash(raw) !== rawHash) throw new Error('Current basketball source checkpoint failed its integrity check.');
  return { version: 1, season, seasons, checkpoint, raw, ledger: await readBasketballLedger(paths.ledgerPath), ops };
}

export async function restoreBasketballState(paths, state) {
  if (state?.version !== 1 || !seasonPattern.test(state.season) || !state.seasons ||
      !Array.isArray(state.ops?.checks) || state.ledger?.version !== 1 || !Array.isArray(state.ledger.attempts)) {
    throw new Error('Invalid basketball working state.');
  }
  const active = state.seasons[state.season]?.dataset;
  const rawHash = state.checkpoint?.rawSha256 ?? active?.source?.rawSha256;
  if (!digestPattern.test(rawHash ?? '') || !state.raw || dataHash(state.raw) !== rawHash ||
      state.checkpoint?.sha256 !== active?.source?.sha256 || !Number.isFinite(Date.parse(state.checkpoint.checkedAt))) {
    throw new Error('Basketball working state source and checkpoint do not match.');
  }
  for (const [year, { dataset, forecasts, editions }] of Object.entries(state.seasons)) {
    if (!seasonPattern.test(year) || dataset?.season !== Number(year) || dataset.competition !== 'ncaam-d1' ||
        !dataset.source?.fullSchedule || (forecasts && !Array.isArray(forecasts)) || (editions && !Array.isArray(editions))) {
      throw new Error('Basketball working state contains an invalid season.');
    }
  }
  for (const [year, { dataset, forecasts, editions }] of Object.entries(state.seasons)) {
    await atomicJson(join(paths.artifactsDir, year + '.json'), dataset, { spacing: 0 });
    if (forecasts) await atomicJson(join(paths.stateDir, year + '-forecasts.json'), forecasts, { spacing: 0 });
    if (editions) await atomicJson(join(paths.stateDir, year + '-editions.json'), editions, { spacing: 0 });
  }
  await atomicJson(join(paths.cacheDir, rawHash + '.json'), state.raw, { spacing: 0 });
  await atomicJson(join(paths.cacheDir, state.season + '-checked.json'), state.checkpoint, { spacing: 0 });
  await atomicJson(paths.ledgerPath, state.ledger, { spacing: 0 });
}
