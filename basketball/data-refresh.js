import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from '../src/ingest.js';
import {
  basketballSeasonBounds, basketballTipoff, CBBD_RECORD_CAP, dataHash,
  normalizeBasketballSeason, parseBasketballExport,
} from './data.js';

const DAY = 24 * 60 * 60_000;
const CORRECTION_DAYS = 14;
const SCHEDULE_LOOKAHEAD_DAYS = 14;
const BOX_GAME_BATCH = 900; // Two perspective rows per game plus room for source duplicates.
const PLAYER_ROW_CAP = 1000;
const PLAYER_GAME_BATCH = 450; // Provider has returned a capped 1,000 team-side rows in a window.
const PLAYER_WINDOW_VERSION = 1;
const apiProvider = 'CollegeBasketballData';
const exporterUrl = 'https://www.collegebasketballdata.com/exporter';
const iso = epoch => new Date(epoch).toISOString();

export async function readOptionalJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function scheduleWindows(season, { since } = {}) {
  const [first, last] = basketballSeasonBounds(season);
  const minimum = since ? Math.max(Date.parse(first), Date.parse(since)) : Date.parse(first);
  if (!Number.isFinite(minimum) || minimum >= Date.parse(last)) return [];
  const breaks = [
    first, `${season - 1}-12-01T00:00:00.000Z`, `${season}-02-01T00:00:00.000Z`,
    `${season}-04-01T00:00:00.000Z`, last,
  ].map(Date.parse).filter(date => date > minimum);
  return [minimum, ...breaks].slice(0, -1).map((start, index) => [iso(start), iso(breaks[index])]);
}

export function boxWindows(games, start, end, gameBatch = BOX_GAME_BATCH) {
  const finalsByDay = new Map();
  for (const game of games) {
    const date = basketballTipoff(game.startDate);
    if (game.status !== 'final' || !date || date < start || date >= end) continue;
    const day = date.slice(0, 10) + 'T00:00:00.000Z';
    finalsByDay.set(day, (finalsByDay.get(day) ?? 0) + 1);
  }
  const boundaries = [];
  let count = 0;
  for (const day of [...finalsByDay.keys()].sort()) {
    const gamesThatDay = finalsByDay.get(day);
    if (!boundaries.length || count + gamesThatDay > gameBatch) {
      boundaries.push(day < start ? start : day);
      count = 0;
    }
    count += gamesThatDay;
  }
  return boundaries.map((boundary, index) => [boundary, boundaries[index + 1] ?? end]);
}

export async function fetchBasketballDateWindows(client, endpoint, season, windows, purpose, { cap = CBBD_RECORD_CAP } = {}) {
  async function fetchWindow([start, end]) {
    const rows = await client.request(endpoint, { season, startDateRange: start, endDateRange: end }, purpose);
    if (!Array.isArray(rows)) throw new Error(`CBBD ${endpoint} response must be an array`);
    if (rows.length >= cap) {
      const from = Date.parse(start), through = Date.parse(end);
      const midpoint = from + Math.floor((through - from) / 2);
      if (midpoint <= from || midpoint >= through) throw new Error(`CBBD ${endpoint} record cap cannot be split further`);
      const left = await fetchWindow([start, iso(midpoint)]);
      const right = await fetchWindow([iso(midpoint), end]);
      return [...left, ...right];
    }
    return rows.filter(row => {
      const date = basketballTipoff(row.startDate);
      if (!date || date < start || date > end || Number(row.season) !== season) {
        throw new Error(`CBBD ${endpoint} returned a record outside the requested season or range`);
      }
      // The provider upper bound is inclusive. We keep half-open windows to avoid counting the edge twice.
      return date < end;
    });
  }
  const rows = [];
  for (const window of windows) rows.push(...await fetchWindow(window));
  return rows;
}

export function planBasketballSeason({
  season, previous, now, full = false, boxes = true, players = false, rolling = false, refreshTeams = false,
}) {
  const end = basketballSeasonBounds(season)[1];
  const ended = Date.parse(end) <= now.getTime();
  if (previous && ended && !full && previous.source?.fullSchedule) {
    return { season, mode: 'cached', schedule: [], estimatedCalls: 0, boxes, players };
  }
  const since = !full && previous?.source?.fullSchedule
    ? iso(Date.parse(previous.source.checkedAt ?? previous.source.asOf) - CORRECTION_DAYS * DAY) : null;
  const bounded = rolling && since && Date.parse(since) < Date.parse(end);
  const schedule = bounded
    ? [[iso(Math.max(Date.parse(since), Date.parse(basketballSeasonBounds(season)[0]))),
      iso(Math.min(now.getTime() + SCHEDULE_LOOKAHEAD_DAYS * DAY, Date.parse(end)))]]
    : scheduleWindows(season, { since });
  const mode = bounded ? 'rolling' : since ? 'incremental' : 'full';
  const fetchTeams = mode !== 'rolling' || refreshTeams;
  const estimatedBoxCalls = !boxes ? 0 : since
    ? Math.max(1, Math.ceil(previous.games.filter(game => game.completed && game.startDate >= since).length / BOX_GAME_BATCH) + 1)
    : ended ? 9 : 3;
  const playerSince = full || !previous?.source?.playerAsOf || previous.source.playerWindowVersion !== PLAYER_WINDOW_VERSION
    ? basketballSeasonBounds(season)[0]
    : iso(Math.max(Date.parse(basketballSeasonBounds(season)[0]),
      Math.min(Date.parse(schedule[0][0]), Date.parse(previous.source.playerAsOf) - CORRECTION_DAYS * DAY)));
  const estimatedPlayerCalls = !players ? 0 : previous
    ? boxWindows(previous.games, playerSince, now.toISOString(), PLAYER_GAME_BATCH).length + 1
    : ended ? 18 : 4;
  return { season, mode, schedule, estimatedCalls: Number(fetchTeams) + schedule.length + estimatedBoxCalls + estimatedPlayerCalls,
    boxes, players, since, playerSince, fetchTeams };
}

export function mergeBasketballWindows(previousRows, acquiredRows, windows, { identity, requireFinals = false }) {
  const observed = new Set(acquiredRows.map(row => String(row[identity])));
  const within = row => {
    const date = basketballTipoff(row.startDate);
    return windows.some(([start, end]) => date && start <= date && date < end);
  };
  const retained = [];
  for (const row of previousRows) {
    if (observed.has(String(row[identity]))) continue;
    if (within(row)) {
      // Unexpected disappearance of confirmed history may be a provider outage, not a correction.
      if (requireFinals && row.status === 'final') throw new Error(`CBBD omitted previously observed final game ${row[identity]}`);
    } else {
      retained.push(row);
    }
  }
  return [...retained, ...acquiredRows];
}

export async function loadBasketballPrevious(season, artifactsDir, cacheDir) {
  const artifact = await readOptionalJson(join(artifactsDir, season + '.json'));
  const checkpoint = await readOptionalJson(join(cacheDir, season + '-checked.json'));
  const matched = artifact && checkpoint?.sha256 === artifact.source.sha256;
  const rawSha256 = (matched ? checkpoint.rawSha256 : null) ?? artifact?.source?.rawSha256;
  const raw = rawSha256 ? await readOptionalJson(join(cacheDir, rawSha256 + '.json')) : null;
  if (raw && matched) {
    Object.assign(artifact.source, checkpoint.verification, { checkedAt: checkpoint.checkedAt, rawSha256 });
  }
  return { artifact, raw };
}

async function writeBasketballArtifact({ artifact, raw, previous, artifactsDir, cacheDir }) {
  const { season, source } = artifact;
  await mkdir(cacheDir, { recursive: true });
  if (raw) {
    source.rawSha256 = dataHash(raw);
    await atomicJson(join(cacheDir, source.rawSha256 + '.json'), raw, { spacing: 0 });
  }
  const changed = artifact.source.sha256 !== previous?.source?.sha256 || source.method !== previous?.source?.method;
  if (changed) {
    if (previous) {
      await atomicJson(join(cacheDir, 'history', `${season}-${previous.source.sha256}.json`), previous, { spacing: 0 });
    }
    await atomicJson(join(artifactsDir, season + '.json'), artifact, { spacing: 0 });
  }
  await atomicJson(join(cacheDir, season + '-checked.json'), {
    sha256: artifact.source.sha256, checkedAt: source.asOf, rawSha256: source.rawSha256 ?? null,
    verification: { registryAsOf: source.registryAsOf, playerAsOf: source.playerAsOf, playerWindowVersion: source.playerWindowVersion },
    knownCoverage: artifact.coverage, observations: source.observations ?? [],
  });
  return { changed, coverage: artifact.coverage, season, sourceAsOf: changed ? source.asOf : previous.source.asOf };
}

export async function acquireBasketballSeason({
  client, season, now, artifactsDir, cacheDir, full = false, boxes = true,
  players = false, rolling = false, refreshTeams = false,
}) {
  const { artifact: previous, raw: previousRaw } = await loadBasketballPrevious(season, artifactsDir, cacheDir);
  const plan = planBasketballSeason({ season, previous: previousRaw ? previous : null, now, full, boxes, players, rolling, refreshTeams });
  if (plan.mode === 'cached') return { changed: false, season, coverage: previous.coverage, mode: 'cached' };
  const ended = Date.parse(basketballSeasonBounds(season)[1]) <= now.getTime();
  const purpose = full ? 'correction' : ended ? 'historical' : 'current';
  const started = client.observations.length;
  const teamRows = plan.fetchTeams ? await client.request('/teams', { season }, purpose) : previousRaw.teamRows;
  if (!Array.isArray(teamRows) || teamRows.length < 250 || (previous && teamRows.length < previous.teams.length * 0.9)) {
    throw new Error(`Basketball ${season} registry appears incomplete. Prior data preserved.`);
  }
  const acquired = await fetchBasketballDateWindows(client, '/games', season, plan.schedule, purpose);
  const gameRows = mergeBasketballWindows(previousRaw?.gameRows ?? [], acquired, plan.schedule, {
    identity: 'id', requireFinals: true,
  });
  const until = iso(now.getTime());
  const boxRanges = !boxes ? [] : boxWindows(gameRows, plan.schedule[0][0], until);
  const acquiredBoxes = await fetchBasketballDateWindows(client, '/games/teams', season, boxRanges, purpose);
  const boxRows = mergeBasketballWindows(previousRaw?.boxRows ?? [], acquiredBoxes, boxRanges, { identity: 'gameId' });
  const playerRanges = players ? boxWindows(gameRows, plan.playerSince, until, PLAYER_GAME_BATCH) : [];
  const acquiredPlayers = await fetchBasketballDateWindows(client, '/games/players', season, playerRanges, purpose, {
    cap: PLAYER_ROW_CAP,
  });
  const playerRows = players || previousRaw?.playerRows
    ? mergeBasketballWindows(previousRaw?.playerRows ?? [], acquiredPlayers, playerRanges, { identity: 'gameId' })
    : undefined;
  const raw = { teamRows, gameRows, boxRows, ...(playerRows ? { playerRows } : {}) };
  const source = {
    provider: apiProvider, method: 'partitioned-api', asOf: until,
    fullSchedule: true, scheduleWindows: plan.schedule, boxWindows: boxRanges,
    registryAsOf: plan.fetchTeams ? until : previous.source.registryAsOf ?? previous.source.asOf,
    ...(players ? { playerAsOf: until, playerWindows: playerRanges, playerWindowVersion: PLAYER_WINDOW_VERSION }
      : previous?.source.playerAsOf
        ? { playerAsOf: previous.source.playerAsOf, playerWindowVersion: previous.source.playerWindowVersion } : {}),
    observations: client.observations.slice(started),
  };
  const artifact = normalizeBasketballSeason({ season, ...raw, source, previous });
  if (!artifact.games.length || (ended && artifact.coverage.divisionOneFinals < 2500)) {
    throw new Error(`Basketball ${season} schedule appears incomplete. Prior data preserved.`);
  }
  return { ...await writeBasketballArtifact({ artifact, raw, previous, artifactsDir, cacheDir }), mode: plan.mode };
}

export async function importBasketballExport({
  season, now, teamsPath, gamesPaths, boxesPaths, artifactsDir, cacheDir,
}) {
  const load = async (path, label, capped) => {
    const text = await readFile(path, 'utf8');
    const rows = parseBasketballExport(text);
    if (capped && rows.length >= CBBD_RECORD_CAP) {
      throw new Error(`Basketball CSV ${label} reached the provider cap; use smaller exported date ranges`);
    }
    return { rows, provenance: { label, sha256: dataHash(text), records: rows.length } };
  };
  const teams = await load(teamsPath, 'teams', false);
  const games = await Promise.all(gamesPaths.map(path => load(path, 'games', true)));
  const boxes = await Promise.all(boxesPaths.map(path => load(path, 'boxes', true)));
  const { artifact: previous } = await loadBasketballPrevious(season, artifactsDir, cacheDir);
  if (previous?.source?.fullSchedule) throw new Error('A partial basketball CSV cannot replace the API schedule');
  const source = {
    provider: apiProvider, method: 'manual-csv-export', url: exporterUrl, asOf: now.toISOString(), fullSchedule: false,
    observations: [teams, ...games, ...boxes].map(item => item.provenance),
  };
  const raw = { teamRows: teams.rows, gameRows: games.flatMap(item => item.rows), boxRows: boxes.flatMap(item => item.rows) };
  const artifact = normalizeBasketballSeason({ season, ...raw, source, previous });
  if (!artifact.games.length) throw new Error('Basketball CSV contained no resolved season games');
  if (previous?.games.some(game => game.completed && !artifact.games.some(replacement => replacement.id === game.id))) {
    throw new Error('A basketball CSV cannot silently remove previously observed final games');
  }
  return writeBasketballArtifact({ artifact, raw, previous, artifactsDir, cacheDir });
}
