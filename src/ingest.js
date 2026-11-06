import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { validateSeason } from './engine.js';

// RFC 4180 quoting, embedded newlines, and escaped quotes; no CSV dependency.
export function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = '';
    } else value += c;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (value || row.length) { row.push(value); rows.push(row); }
  const header = rows.shift();
  if (!header || new Set(header).size !== header.length) throw new Error('Missing or duplicate CSV headers');
  return rows.map((r, i) => {
    if (r.length !== header.length) throw new Error(`CSV column count at row ${i + 2}`);
    return Object.fromEntries(header.map((h, j) => [h, r[j]]));
  });
}

const missing = v => v === undefined || v === null || v === '' || v === 'NA';
const number = v => missing(v) ? null : Number(v);
function bool(v) { if (v === true || v === 'TRUE') return true; if (v === false || v === 'FALSE') return false; throw new Error(`Invalid boolean ${v}`); }

export function normalizeCsv(text, year, source = {}) {
  const rows = parseCsv(text), teams = new Map(), games = [], audit = { incompleteFinals: [], duplicateRows: [] }, seen = new Map();
  for (const r of rows) {
    if (Number(r.season) !== year) throw new Error('Source season mismatch');
    if (!['regular', 'postseason'].includes(r.season_type)) continue;
    for (const side of ['home', 'away']) {
      const id = r[`${side}_id`], division = r[`${side}_division`];
      if (missing(id)) throw new Error('Missing team identity');
      const team = { id, name: r[`${side}_team`], division: missing(division) ? 'unknown' : division.toLowerCase(), conference: missing(r[`${side}_conference`]) ? 'Independent / unassigned' : r[`${side}_conference`] };
      const old = teams.get(id);
      if (old && JSON.stringify(old) !== JSON.stringify(team)) throw new Error(`Conflicting team metadata ${id}`);
      teams.set(id, team);
    }
    // Deliberate whitelist: ignore all supplied Elo, probabilities, and rankings.
    const g = { id: r.game_id, week: Number(r.week), seasonType: r.season_type,
      startDate: r.start_date, completed: bool(r.completed), neutral: bool(r.neutral_site),
      home: r.home_id, away: r.away_id, homePoints: number(r.home_points), awayPoints: number(r.away_points) };
    if (g.completed && (g.homePoints === null || g.awayPoints === null)) { audit.incompleteFinals.push(g.id); g.completed = false; }
    const key = `${g.home}:${g.away}:${g.startDate}`;
    if (seen.has(key)) {
      const old = seen.get(key);
      if (old.homePoints !== g.homePoints || old.awayPoints !== g.awayPoints || old.completed !== g.completed) throw new Error(`Conflicting duplicate matchup ${g.id}`);
      audit.duplicateRows.push(g.id); continue;
    }
    seen.set(key, g); games.push(g);
  }
  audit.regularGames = games.filter(g => g.seasonType === 'regular').length;
  audit.postseasonGames = games.filter(g => g.seasonType === 'postseason').length;
  audit.unknownDivisionTeams = [...teams.values()].filter(t => t.division === 'unknown').length;
  audit.latestCompletedKickoff = games.filter(g => g.completed).map(g => g.startDate).sort().at(-1) ?? null;
  return validateSeason({ year, teams: [...teams.values()], games, source: { ...source, audit, format: 'cfbfastR schedules CSV', overtimePeriodScores: false, rosterCoverage: 'Teams appearing in the season schedule, including unplayed games' } });
}

export function normalizeCfbd(games, roster, year, source = {}) {
  const teams = new Map(roster.map(t => [String(t.id), { id: String(t.id), name: t.school, division: 'fbs', conference: t.conference ?? 'Independent / unassigned' }]));
  const normalized = games.filter(g => ['regular', 'postseason'].includes(g.seasonType)).map(g => {
    if (g.season !== year) throw new Error('Source season mismatch');
    for (const side of ['home', 'away']) {
      const id = String(g[`${side}Id`]);
      if (!teams.has(id)) teams.set(id, { id, name: g[`${side}Team`], division: g[`${side}Classification`], conference: g[`${side}Conference`] ?? 'Independent / unassigned' });
    }
    const h = g.homeLineScores, a = g.awayLineScores;
    const confirmedOT = Array.isArray(h) && Array.isArray(a) && h.length > 4 && a.length > 4 && h.slice(0, 4).every(Number.isFinite) && a.slice(0, 4).every(Number.isFinite) && h.slice(0, 4).reduce((s, v) => s + v, 0) === a.slice(0, 4).reduce((s, v) => s + v, 0);
    return { id: String(g.id), week: g.week, seasonType: g.seasonType, startDate: g.startDate,
      completed: g.completed, neutral: g.neutralSite, home: String(g.homeId), away: String(g.awayId),
      homePoints: g.homePoints, awayPoints: g.awayPoints, ...(confirmedOT ? { regulationMargin: 0 } : {}) };
  });
  return validateSeason({ year, teams: [...teams.values()], games: normalized, source: { ...source, format: 'CFBD API', rosterCoverage: 'Year-specific FBS roster plus all scheduled opponents' } });
}

export async function atomicJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', JSON.stringify(data, null, 2) + '\n');
  await rename(path + '.tmp', path);
}

export async function importSeason(year, dataDir, { refresh = false, provider = 'sportsdataverse' } = {}) {
  if (!Number.isInteger(year) || year < 2001 || year > 2100) throw new Error('Season must be 2001–2100');
  const path = join(dataDir, 'seasons', `${year}.json`);
  if (!refresh) { try { return validateSeason(JSON.parse(await readFile(path, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  const fetchedAt = new Date().toISOString();
  let season;
  if (provider === 'cfbd') {
    if (!process.env.CFBD_API_KEY) throw new Error('Set CFBD_API_KEY server-side for direct CFBD access');
    const urls = [`https://api.collegefootballdata.com/games?year=${year}&seasonType=both`, `https://api.collegefootballdata.com/teams/fbs?year=${year}`];
    const responses = [];
    for (const url of urls) { const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}` }, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`CFBD returned ${r.status}`); responses.push(await r.json()); }
    season = normalizeCfbd(responses[0], responses[1], year, { provider, urls, fetchedAt, sha256: createHash('sha256').update(JSON.stringify(responses)).digest('hex') });
    await atomicJson(join(dataDir, 'raw', `cfbd-${year}.json`), responses);
  } else if (provider === 'sportsdataverse') {
    const url = `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/csv/cfb_schedules_${year}.csv`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Schedule source returned ${response.status} for ${year}`);
    const text = await response.text();
    season = normalizeCsv(text, year, { provider, url, fetchedAt, sha256: createHash('sha256').update(text).digest('hex') });
    await mkdir(join(dataDir, 'raw'), { recursive: true }); await writeFile(join(dataDir, 'raw', `${year}.csv`), text);
  } else throw new Error('Unknown data provider');
  if (!season.teams.some(t => t.division === 'fbs')) throw new Error('Source has no FBS teams');
  await atomicJson(path, season); return season;
}
