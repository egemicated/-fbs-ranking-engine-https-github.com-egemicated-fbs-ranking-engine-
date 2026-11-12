import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { UPDATE_SCHEDULE } from '../src/weekly.js';

const dayMs = 24 * 60 * 60 * 1000;
const midweekLookback = 7 * dayMs;
const minimumElapsed = 3 * 60 * 60 * 1000;
const mountainDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: UPDATE_SCHEDULE.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
});

function mountainDay(time) {
  const parts = Object.fromEntries(mountainDate.formatToParts(time).map(({ type, value }) => [type, value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

export function weeklyRefreshNeeded(snapshot, picks, now = new Date(), catchUp = false) {
  const currentTime = new Date(now).getTime();
  const today = mountainDay(currentTime);
  const sunday = today - new Date(today).getUTCDay() * dayMs;
  const fetchedAt = Date.parse(snapshot?.source?.fetchedAt);
  if (snapshot?.source?.provider !== 'cfbd' || !Number.isFinite(fetchedAt) ||
      fetchedAt > currentTime || mountainDay(fetchedAt) < sunday) return true;
  if (!catchUp) return false;

  if (!matchesSnapshot(picks, snapshot)) return true;

  const saturday = sunday - dayMs;
  return hasUnresolvedKickoff(snapshot, picks, kickoff => mountainDay(kickoff) === saturday);
}

function matchesSnapshot(picks, snapshot) {
  return picks?.source?.provider === 'cfbd' && picks.season === snapshot.season &&
    picks.source.scheduleAsOf === snapshot.source.fetchedAt && picks.source.rankingAsOf === snapshot.asOf &&
    picks.source.snapshotHash === snapshot.snapshotHash && Array.isArray(picks.games) && Array.isArray(picks.teams);
}

function hasUnresolvedKickoff(snapshot, picks, inWindow) {
  const fbs = new Set(picks.teams.filter(team => team.division === 'fbs').map(team => team.id));
  const canceled = new Set((snapshot.source.audit?.confirmedCanceledRecords ?? []).map(game => game.id));
  return picks.games.some(game => {
    const kickoff = Date.parse(game.startDate);
    return ['pending', 'scheduled', 'incomplete'].includes(game.status) &&
      (fbs.has(game.home) || fbs.has(game.away)) && !canceled.has(game.id) &&
      game.startTimeTbd !== true && Number.isFinite(kickoff) && inWindow(kickoff);
  });
}

export function midweekRefreshNeeded(snapshot, picks, now = new Date()) {
  const currentTime = new Date(now).getTime();
  const fetchedAt = Date.parse(snapshot?.source?.fetchedAt);
  if (snapshot?.source?.provider !== 'cfbd' || !Number.isFinite(fetchedAt) || fetchedAt > currentTime) return true;
  if (!matchesSnapshot(picks, snapshot)) return true;
  if (mountainDay(fetchedAt) === mountainDay(currentTime)) return false;

  // Include recent games still unconfirmed at an earlier refresh.
  return hasUnresolvedKickoff(snapshot, picks, kickoff =>
    kickoff >= currentTime - midweekLookback && kickoff < currentTime - minimumElapsed);
}

async function readPublication(name) {
  try { return JSON.parse(await readFile(new URL(`../published/${name}.json`, import.meta.url), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const catchUp = process.argv.includes('--catch-up');
  const midweek = process.argv.includes('--midweek');
  const snapshot = await readPublication('latest');
  const picks = catchUp || midweek ? await readPublication('weekly-picks') : null;
  console.log(midweek ? midweekRefreshNeeded(snapshot, picks) : weeklyRefreshNeeded(snapshot, picks, new Date(), catchUp));
}
