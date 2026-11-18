import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { UPDATE_SCHEDULE } from '../src/refresh-schedule.js';

const dayMs = 24 * 60 * 60 * 1000;
const resultsLookback = 7 * dayMs;
const minimumElapsed = 3 * 60 * 60 * 1000;
const mountainClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: UPDATE_SCHEDULE.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function mountainCalendarTime(time) {
  const { year, month, day, hour, minute } = Object.fromEntries(
    mountainClock.formatToParts(time).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(year, month - 1, day, hour, minute);
}

function mountainDay(time) {
  return Math.floor(mountainCalendarTime(time) / dayMs) * dayMs;
}

function mountainSunday(time) {
  const today = mountainDay(time);
  return today - new Date(today).getUTCDay() * dayMs;
}

function matchesSnapshot(picks, snapshot) {
  return picks?.source?.provider === 'cfbd' && picks.season === snapshot.season &&
    picks.source.scheduleAsOf === snapshot.source.fetchedAt && picks.source.rankingAsOf === snapshot.asOf &&
    picks.source.snapshotHash === snapshot.snapshotHash && Array.isArray(picks.games) && Array.isArray(picks.teams);
}

function hasUnresolvedKickoff(snapshot, picks, inWindow) {
  const pendingFcs = snapshot.pendingFcsKickoffs;
  if (Array.isArray(pendingFcs) && pendingFcs.some(startDate => {
    const kickoff = Date.parse(startDate);
    return Number.isFinite(kickoff) && inWindow(kickoff);
  })) return true;
  if (!matchesSnapshot(picks, snapshot)) return false;

  const fbs = new Set(picks.teams.filter(team => team.division === 'fbs').map(team => team.id));
  const canceled = new Set((snapshot.source.audit?.confirmedCanceledRecords ?? []).map(game => game.id));
  return picks.games.some(game => {
    const kickoff = Date.parse(game.startDate);
    return ['pending', 'scheduled', 'incomplete'].includes(game.status) &&
      (fbs.has(game.home) || fbs.has(game.away)) && !canceled.has(game.id) &&
      game.startTimeTbd !== true && Number.isFinite(kickoff) && inWindow(kickoff);
  });
}

export function dailyRefreshNeeded(snapshot, picks, now = new Date()) {
  const currentTime = new Date(now).getTime();
  const fetchedAt = Date.parse(snapshot?.source?.fetchedAt);
  if (snapshot?.source?.provider !== 'cfbd' || !Number.isFinite(fetchedAt) || fetchedAt > currentTime) return true;
  if (!matchesSnapshot(picks, snapshot)) return true;
  const fetchedDay = mountainDay(fetchedAt);
  // Refresh the upcoming weekly slate on Sunday, or on the next daily check if Sunday was missed.
  if (fetchedDay < mountainSunday(currentTime)) return true;
  if (fetchedDay === mountainDay(currentTime)) return false;

  // Include recent games still unconfirmed at an earlier refresh.
  return hasUnresolvedKickoff(snapshot, picks, kickoff =>
    kickoff >= currentTime - resultsLookback && kickoff < currentTime - minimumElapsed);
}

export function sundayNightRefreshNeeded(snapshot, picks, now = new Date()) {
  const currentTime = new Date(now).getTime();
  const fetchedAt = Date.parse(snapshot?.source?.fetchedAt);
  if (snapshot?.source?.provider !== 'cfbd' || !Number.isFinite(fetchedAt) ||
      fetchedAt > currentTime) return false;

  const sunday = mountainSunday(currentTime);
  const { hour, minute } = UPDATE_SCHEDULE.sundayNight;
  const slot = sunday + (hour * 60 + minute) * 60_000;
  if (mountainCalendarTime(fetchedAt) >= slot) return false;

  return hasUnresolvedKickoff(snapshot, picks, kickoff =>
    kickoff <= currentTime - minimumElapsed && mountainDay(kickoff) === sunday);
}

async function readPublication(name) {
  try { return JSON.parse(await readFile(new URL(`../published/${name}.json`, import.meta.url), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const sundayNight = process.argv.includes('--sunday-night');
  const [snapshot, picks] = await Promise.all([readPublication('latest'), readPublication('weekly-picks')]);
  const needsRefresh = sundayNight ? sundayNightRefreshNeeded : dailyRefreshNeeded;
  console.log(needsRefresh(snapshot, picks));
}
