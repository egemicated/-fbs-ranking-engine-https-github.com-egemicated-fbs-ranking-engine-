import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { atomicJson } from './ingest.js';

const rankingsUrl = 'https://collegefootballplayoff.com/rankings';
const nameKey = name => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = new Map([
  ['miamifl', 'Miami'],
  ['miamiohio', 'Miami (OH)'],
  ['mississippi', 'Ole Miss'],
  ['northcarolinastate', 'NC State'],
  ['southerncalifornia', 'USC']
]);

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
}

function editionSeason({ week, gamesThrough, released }) {
  if (!Number.isInteger(week) || week < 0 || !dateOnly(gamesThrough) || !dateOnly(released) ||
      gamesThrough >= released || gamesThrough.slice(0, 4) !== released.slice(0, 4)) {
    throw new Error('Invalid CFP edition dates or week');
  }
  return Number(released.slice(0, 4));
}

function rankingsData(html, season) {
  // SIDEARM server-renders the rankings and embeds a JSON array of indexed
  // values. The ranking store identifies the season and exact edition dates.
  const script = html.match(/<script\b[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  const payload = script ? JSON.parse(script[1]) : null;
  if (!Array.isArray(payload)) throw new Error('CFP rankings page is missing its structured data');
  const store = payload.find(value => value && Object.hasOwn(value, 'rankingsByYear'));
  const byYear = payload[store?.rankingsByYear];
  const editions = payload[byYear?.[season]];
  if (!Array.isArray(editions)) throw new Error(`CFP rankings page is missing the ${season} archive`);
  return { payload, editions };
}

export async function readCfpEdition({ week, gamesThrough, released }, teamNames, fetcher = fetch) {
  const schedule = { week, gamesThrough, released };
  const season = editionSeason(schedule);
  const response = await fetcher(rankingsUrl, {
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`CFP rankings request failed with HTTP ${response.status}`);

  const { payload, editions } = rankingsData(await response.text(), season);
  const matching = editions.map(index => payload[index]).filter(edition => {
    const date = payload[edition?.releaseDate];
    if (Number(payload[edition?.year]) !== season || typeof date !== 'string' || !dateOnly(date.slice(0, 10))) {
      throw new Error('CFP archive contains an invalid edition date or season');
    }
    return date.slice(0, 10) === schedule.released;
  });
  if (matching.length === 0) return null;
  if (matching.length !== 1) throw new Error(`CFP archive has multiple editions for ${schedule.released}`);

  const teamRefs = payload[matching[0].teams];
  if (!Array.isArray(teamRefs) || teamRefs.length !== 25) throw new Error('CFP edition must contain 25 teams');
  const names = new Map(teamNames.map(name => [nameKey(name), name]));
  const rows = teamRefs.map(index => {
    const row = payload[index];
    const rank = payload[row?.rank];
    const sourceName = payload[row?.team];
    const record = payload[row?.record];
    if (!Number.isInteger(rank) || typeof sourceName !== 'string' || typeof record !== 'string' ||
        !/^\d+[-–]\d+(?:[-–]\d+)?$/.test(record.trim())) {
      throw new Error('CFP edition contains an invalid rank, team, or record');
    }
    const key = nameKey(sourceName);
    const team = names.get(key) ?? names.get(nameKey(aliases.get(key) ?? ''));
    if (!team) throw new Error(`Unrecognized CFP team: ${sourceName}`);
    return { rank, team, record: record.trim().replaceAll('-', '–') };
  }).sort((a, b) => a.rank - b.rank);
  if (rows.some(({ rank }, index) => rank !== index + 1) || new Set(rows.map(({ team }) => team)).size !== 25) {
    throw new Error('CFP edition must contain unique teams ranked 1–25');
  }

  return { ...schedule, url: rankingsUrl, rows: rows.map(({ team, record }) => ({ team, record })) };
}

export async function saveCfpEdition(path, edition) {
  const season = editionSeason(edition);
  const archive = JSON.parse(await readFile(path, 'utf8'));
  if (archive.season !== season || !Array.isArray(archive.polls?.cfp)) {
    throw new Error(`Poll comparison archive does not match CFP season ${season}`);
  }
  const editions = archive.polls.cfp;
  const index = editions.findIndex(item => item.week === edition.week);
  if (index >= 0) {
    const current = editions[index];
    if (current.released !== edition.released || current.gamesThrough !== edition.gamesThrough) {
      throw new Error(`A different CFP edition is already stored for Week ${edition.week}`);
    }
    if (isDeepStrictEqual(current.rows, edition.rows)) return false;
    editions[index] = { ...current, rows: edition.rows };
  } else {
    editions.push(edition);
    editions.sort((a, b) => a.week - b.week);
  }
  await atomicJson(path, archive);
  return true;
}
