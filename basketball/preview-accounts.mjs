import {createHash, randomBytes, randomUUID, scrypt, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';

const deriveKey = promisify(scrypt);
const maxBodyBytes = 8192;
const sessionHours = 12;
const sessionMs = sessionHours * 60 * 60 * 1000;
const sessionCookie = 'gd-basketball-local';
const competition = 'ncaam-d1';
const legalHandle = /^[a-z0-9_-]{3,32}$/;
const normalizeHandle = value => String(value ?? '').trim().toLowerCase();
const validPassphrase = phrase => typeof phrase === 'string' && phrase.length >= 10 && phrase.length <= 128;
const hashToken = token => createHash('sha256').update(token).digest('hex');
const profileSummary = ({id, handle, name}) => ({id, handle, name});

function localOrigin(request) {
  const host = request.headers.host;
  if (typeof host !== 'string' || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host)) return null;
  return (request.socket?.encrypted ? 'https://' : 'http://') + host;
}

function localPost(request) {
  const origin = localOrigin(request);
  return origin && request.headers.origin === origin;
}

function cookieToken(request) {
  if (typeof request.headers.cookie !== 'string') return null;
  const token = request.headers.cookie.split(/;\s*/).find(pair => pair.startsWith(sessionCookie + '='))?.slice(sessionCookie.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function setCookie(response, request, token, maxAge) {
  response.setHeader('Set-Cookie', sessionCookie + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge +
    (request.socket?.encrypted ? '; Secure' : ''));
}

function safeReturnTarget(value) {
  const origin = 'http://127.0.0.1';
  const fallback = '/basketball/contest/';
  if (typeof value !== 'string' || !value.startsWith('/basketball/') || /[\\\x00-\x1f\x7f]/.test(value)) return fallback;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && url.pathname.startsWith('/basketball/') ? url.pathname + url.search : fallback;
  } catch {
    return fallback;
  }
}

function redirect(response, target, notice) {
  const url = new URL(target, 'http://127.0.0.1');
  url.searchParams.set('notice', notice);
  response.setHeader('Cache-Control', 'no-store');
  response.writeHead(303, {Location: url.pathname + url.search}).end();
}

function reject(response, status, message) {
  response.setHeader('Cache-Control', 'no-store');
  response.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'}).end(message);
}

async function formData(request) {
  const contentType = String(request.headers['content-type']).split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') return null;
  if (Number(request.headers['content-length']) > maxBodyBytes) return null;
  let size = 0;
  const chunks = [];
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > maxBodyBytes) continue;
    chunks.push(chunk);
  }
  return size <= maxBodyBytes ? new URLSearchParams(Buffer.concat(chunks).toString('utf8')) : null;
}

export function basketballPickOpen(game, now = Date.now()) {
  const tipoff = Date.parse(game?.startDate);
  return game?.divisionOne === true && game.status === 'scheduled' && game.completed === false &&
    game.startTimeTbd === false && Number.isFinite(tipoff) && Number.isFinite(now) && now < tipoff;
}

export function gradeBasketballPick(game, winnerId) {
  if (!game || (game.home !== winnerId && game.away !== winnerId)) return 'void';
  if (['cancelled','canceled','forfeit','no_contest'].includes(game.status)) return 'void';
  if (!game.completed || game.status !== 'final') return 'pending';
  const {homePoints, awayPoints} = game;
  if (![homePoints,awayPoints].every(value => Number.isInteger(value) && value >= 0) || homePoints === awayPoints) return 'void';
  const winner = homePoints > awayPoints ? game.home : game.away;
  return winner === winnerId ? 'correct' : 'incorrect';
}

export function createPreviewAccounts({directory, clock = Date.now}) {
  const file = join(directory, 'basketball-preview-accounts.json');
  const sessions = new Map();
  let queue = Promise.resolve();
  const instant = () => new Date(clock()).getTime();

  async function readStore() {
    try {
      const store = JSON.parse(await readFile(file, 'utf8'));
      if (store.version !== 1 || !Array.isArray(store.profiles) || !Array.isArray(store.picks)) throw new Error('Unsupported private preview account state');
      return store;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return {version: 1, profiles: [], picks: []};
    }
  }

  async function writeStore(store) {
    await mkdir(directory, {recursive: true, mode: 0o700});
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(store), {flag: 'wx', mode: 0o600});
      await rename(temporary, file);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  function transact(update) {
    const task = queue.then(async () => {
      const store = await readStore();
      const changed = await update(store);
      if (changed) await writeStore(store);
      return changed;
    });
    queue = task.catch(() => {});
    return task;
  }

  async function profile(request) {
    if (!localOrigin(request)) return null;
    const token = cookieToken(request);
    if (!token) return null;
    const digest = hashToken(token);
    const found = sessions.get(digest);
    if (!found || found.expires <= instant()) {
      sessions.delete(digest);
      return null;
    }
    return profileSummary(found.account);
  }

  function startSession(account, request, response) {
    const now = instant();
    for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key);
    const previous = cookieToken(request);
    if (previous) sessions.delete(hashToken(previous));
    const token = randomBytes(32).toString('base64url');
    sessions.set(hashToken(token), {expires: now + sessionMs, account: profileSummary(account)});
    setCookie(response, request, token, Math.floor(sessionMs / 1000));
  }

  async function accountPost(form, request, response) {
    const target = safeReturnTarget(form.get('returnTo'));
    const handle = normalizeHandle(form.get('handle'));
    const passphrase = form.get('passphrase');
    const action = form.get('action');
    if (action === 'logout') {
      const token = cookieToken(request);
      if (token) sessions.delete(hashToken(token));
      setCookie(response, request, '', 0);
      redirect(response, target, 'signed-out');
      return;
    }
    if (!legalHandle.test(handle) || !validPassphrase(passphrase)) {
      redirect(response, target, 'profile-unsupported');
      return;
    }
    if (action === 'register') {
      const name = String(form.get('name') ?? handle).trim() || handle;
      if (name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) {
        redirect(response, target, 'profile-unsupported');
        return;
      }
      const salt = randomBytes(16).toString('hex');
      const password = (await deriveKey(passphrase, salt, 32)).toString('hex');
      const created = await transact(store => {
        if (store.profiles.some(row => row.handle === handle)) return null;
        const account = {id: randomUUID(), handle, name, salt, password};
        store.profiles.push(account);
        return account;
      });
      if (!created) {
        redirect(response, target, 'profile-exists');
        return;
      }
      startSession(created, request, response);
      redirect(response, target, 'profile-created');
      return;
    }
    if (action !== 'login') {
      redirect(response, target, 'profile-unsupported');
      return;
    }
    const store = await readStore();
    const account = store.profiles.find(row => row.handle === handle);
    // Match the normal hash work even for unknown profiles.
    const key = await deriveKey(passphrase, account?.salt ?? '00000000000000000000000000000000', 32);
    const saved = Buffer.from(account?.password ?? '', 'hex');
    if (!account || saved.length !== key.length || !timingSafeEqual(saved, key)) {
      redirect(response, target, 'profile-invalid');
      return;
    }
    startSession(account, request, response);
    redirect(response, target, 'signed-in');
  }

  async function contest(request, dataset) {
    const summary = {picks: {}, graded: 0, correct: 0};
    const user = await profile(request);
    if (!user || dataset?.competition !== competition || !Array.isArray(dataset.games)) return summary;
    const games = new Map(dataset.games.map(game => [game.id, game]));
    for (const pick of (await readStore()).picks) {
      if (pick.profileId !== user.id || pick.season !== dataset.season) continue;
      const {gameId, winnerId, savedAt} = pick;
      const result = gradeBasketballPick(games.get(gameId), winnerId);
      summary.picks[gameId] = {winnerId, savedAt, result};
      if (result === 'correct') summary.correct++;
      if (result === 'correct' || result === 'incorrect') summary.graded++;
    }
    return summary;
  }

  async function pickPost(form, request, response, seasons) {
    const year = Number(form.get('season'));
    const gameId = form.get('gameId');
    const winnerId = form.get('winnerId');
    const target = '/basketball/contest/' + (Number.isInteger(year) && year >= 1985 && year <= 2100 ? '?season=' + year : '');
    const user = await profile(request);
    if (!user) {
      redirect(response, target, 'profile-required');
      return;
    }
    const entry = typeof seasons === 'function' ? await seasons(year) : seasons?.get(year);
    const dataset = entry?.dataset;
    const game = dataset?.competition === competition && dataset.season === year ? dataset.games.find(row => row.id === gameId) : null;
    if (!game || (winnerId !== game.home && winnerId !== game.away)) {
      redirect(response, target, 'pick-invalid');
      return;
    }
    const saved = await transact(store => {
      const now = instant();
      if (!basketballPickOpen(game, now)) return false;
      const pick = {profileId: user.id, season: year, gameId, winnerId, savedAt: new Date(now).toISOString()};
      const index = store.picks.findIndex(row => row.profileId === user.id && row.season === year && row.gameId === gameId);
      if (index < 0) store.picks.push(pick);
      else store.picks[index] = pick;
      return true;
    });
    redirect(response, target, saved ? 'pick-saved' : 'pick-locked');
  }

  async function handle(request, response, {seasons} = {}) {
    if (request.method !== 'POST') return false;
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path !== '/preview-profile/' && path !== '/basketball/contest/') return false;
    if (!localPost(request)) {
      reject(response, 403, 'Private preview requests must originate from this local site.');
      return true;
    }
    const form = await formData(request);
    if (!form) {
      reject(response, 400, 'Unsupported preview form.');
      return true;
    }
    if (path === '/preview-profile/') await accountPost(form, request, response);
    else await pickPost(form, request, response, seasons);
    return true;
  }
  return {profile, contest, handle};
}
