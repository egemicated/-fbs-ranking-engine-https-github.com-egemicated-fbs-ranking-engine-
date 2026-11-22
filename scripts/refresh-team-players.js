import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { collectPlayerSources } from '../research/player-data-cache.mjs';
import { atomicJson } from '../src/ingest.js';
import { loadPlayerSchedule, publishPlayerPages, readTeamPage } from '../src/player-publication.js';
import { normalizePlayerData } from '../src/player-data.js';

const dateOnly = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', dateStyle: 'short' });
const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short' });
const info = 'FBS Intelligence CFBD player-cache/v1';
const cacheKey = (secret, salt) => Buffer.from(hkdfSync('sha256', secret, salt, info, 32));

function encryptedCache(value, secret) {
  const salt = randomBytes(16), iv = randomBytes(12), key = cacheKey(secret, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(gzipSync(JSON.stringify(value))), cipher.final()]);
    return { version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
      payload: ciphertext.toString('base64') };
  } finally { key.fill(0); }
}

function openCache(value, secret) {
  if (value?.version !== 1) return null;
  const key = cacheKey(secret, Buffer.from(value.salt, 'base64'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(gunzipSync(Buffer.concat([decipher.update(Buffer.from(value.payload, 'base64')), decipher.final()]),
      { maxOutputLength: 100 * 1024 * 1024 }));
  } finally { key.fill(0); }
}

export function playerRefreshWeeks(schedule, previous, bootstrap = false) {
  const scheduleWeeks = [...schedule.games.values()].sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate));
  const settled = new Set((previous?.weeks ?? []).flatMap(week => week.rows.map(box => String(box.id))));
  const weeks = new Set();
  for (const game of scheduleWeeks) {
    if (bootstrap || !settled.has(game.id) || weeks.size === 0) weeks.add(game.week);
    if (weeks.size === (bootstrap ? 14 : 3)) break;
  }
  return [...weeks];
}

export async function dailyPlayerRefreshPlan(schedule, cache, readPage) {
  const data = normalizePlayerData(cache, schedule, { allowIncompleteCache: true });
  const uncovered = new Set();
  let hasPublishedCoverage = false;
  let publicMatches = true;
  let checkedThisSnapshot = true;
  for (const team of data.groups.values()) {
    for (const id of team.expected) if (!team.matched.has(id)) uncovered.add(id);
    if (!team.players.size && !team.expected.size) continue;
    const page = await readPage(team.id);
    if (!team.players.size && !page) continue;
    hasPublishedCoverage ||= Boolean(page);
    publicMatches &&= page?.asOf === cache.asOf && page.coverage?.boxGames === team.matched.size &&
      page.coverage?.expectedGames === team.expected.size;
    checkedThisSnapshot &&= page?.scheduleAsOf === schedule.scheduleAsOf;
  }
  if (hasPublishedCoverage && publicMatches && (!uncovered.size || checkedThisSnapshot)) {
    return { weeks: [], publishCached: false };
  }
  if (!uncovered.size) return { weeks: [], publishCached: true };
  const games = [...uncovered].map(id => schedule.games.get(id))
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate));
  return { weeks: [...new Set(games.map(game => game.week))].slice(0, 3), publishCached: false };
}

async function main() {
  const [mode] = process.argv.slice(2);
  if (mode && !['--manual', '--bootstrap', '--daily'].includes(mode)) throw new Error('Invalid player refresh mode');
  const now = new Date();
  const daily = mode === '--daily';
  if (!mode && weekday.format(now) !== 'Sun') { console.log('Player refresh is scheduled on Sunday Mountain Time.'); return; }
  const schedule = await loadPlayerSchedule('published');
  if (daily && !schedule.games.size) { console.log('No completed games in the saved player schedule.'); return; }
  if (!mode && dateOnly.format(now) !== dateOnly.format(new Date(schedule.scheduleAsOf))) {
    console.log('Waiting for today’s Sunday CFBD publication.'); return;
  }
  if (!mode) {
    const team = schedule.teams.values().next().value;
    const page = team && await readTeamPage('published', 'team-players', team.id, schedule.season);
    if (Number.isFinite(Date.parse(page?.asOf)) && dateOnly.format(now) === dateOnly.format(new Date(page.asOf))) {
      console.log('Today’s Sunday player pages are already published.'); return;
    }
  }
  const secret = process.env.CFBD_API_KEY;
  if (!secret) throw new Error('The CFBD API key is required for a player refresh');
  const cachePath = resolve('research/cache/player-inputs/season-cache.encrypted.json');
  let previous;
  try {
    const envelope = JSON.parse(await readFile(cachePath, 'utf8'));
    previous = openCache(envelope, secret);
  } catch (error) {
    if (error.code !== 'ENOENT' && mode !== '--bootstrap') throw new Error('Encrypted player cache could not open');
  }
  if (previous?.season !== schedule.season) previous = null;
  if (!mode && previous && dateOnly.format(now) === dateOnly.format(new Date(previous.asOf))) {
    console.log('This week’s player publication already refreshed.'); return;
  }
  if (!previous && mode === '--manual') {
    console.log('Use the bootstrap option to initialize a missing player cache manually.'); return;
  }
  if (daily && !previous) throw new Error('The daily update requires an authenticated player cache. Bootstrap is a separate manual operation.');
  const plan = daily ? await dailyPlayerRefreshPlan(schedule, previous,
    id => readTeamPage('published', 'team-players', id, schedule.season))
    : { weeks: playerRefreshWeeks(schedule, previous, mode === '--bootstrap' || !previous), publishCached: false };
  const { weeks } = plan;
  if (plan.publishCached) {
    await publishPlayerPages({ cache: previous, schedule, directory: 'published' });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'refreshed=true\n');
    console.log('Published matching player coverage from the authenticated cache. No CFBD requests.');
    return;
  }
  if (daily && !weeks.length) {
    console.log('Player coverage is current or this football snapshot was already checked. No CFBD requests.');
    return;
  }
  if (!weeks.length) { console.log('No completed games in the saved player schedule.'); return; }
  const { facts, evidence } = await collectPlayerSources({ season: schedule.season, weeks, apiKey: secret });
  if (previous) {
    const batches = new Map(previous.weeks.map(batch => [batch.week, batch]));
    for (const batch of facts.weeks) {
      const games = new Map((batches.get(batch.week)?.rows ?? []).map(row => [String(row.id), row]));
      for (const row of batch.rows) games.set(String(row.id), row);
      batches.set(batch.week, { ...batch, rows: [...games.values()] });
    }
    facts.weeks = [...batches.values()].sort((a, b) => a.week - b.week);
  }
  const published = await publishPlayerPages({ cache: facts, schedule, directory: 'published' });
  await atomicJson(cachePath, encryptedCache(facts, secret), { spacing: 0 });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'refreshed=true\n');
  console.log(JSON.stringify({ ...evidence, coverage: published.coverage }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Player refresh failed. The previously published data is still available.'); process.exitCode = 1; });
}
