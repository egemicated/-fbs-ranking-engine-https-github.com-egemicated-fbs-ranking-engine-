import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cfpSyncCredentials } from '../src/cfp-bracket-feed.js';

const timestamp = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const validScore = value => Number.isInteger(value) && value >= 0 && value < 10_000;

export function buildWeeklyContestSync(artifact, now = new Date()) {
  const observedAt = timestamp(artifact?.asOf);
  const fetchedAt = timestamp(artifact?.source?.scheduleAsOf);
  if (artifact?.schemaVersion !== 1 || artifact.source?.provider !== 'cfbd' ||
      !Number.isInteger(artifact.season) || artifact.season < 2024 || artifact.season > 2100 ||
      !Number.isFinite(observedAt) || !Number.isFinite(fetchedAt) || fetchedAt > observedAt ||
      observedAt > new Date(now).getTime() || !Array.isArray(artifact.teams) || !Array.isArray(artifact.games)) {
    throw new Error('Weekly contest sync requires a dated CFBD Weekly Picks publication');
  }
  const teams = new Map();
  for (const team of artifact.teams) {
    if (typeof team.id !== 'string' || !team.id || typeof team.name !== 'string' || !team.name || teams.has(team.id)) {
      throw new Error('Invalid Weekly Picks team identity');
    }
    teams.set(team.id, team);
  }
  const ids = new Set();
  const games = [];
  for (const game of artifact.games) {
    if (typeof game.id !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(game.id) || ids.has(game.id)) {
      throw new Error('Invalid or duplicate Weekly Picks game');
    }
    ids.add(game.id);
    const home = teams.get(game.home);
    const away = teams.get(game.away);
    if (!home || !away || home === away) throw new Error('Unknown Weekly Picks participant');
    if (home.division !== 'fbs' || away.division !== 'fbs') continue;
    const kickoff = timestamp(game.startDate);
    if (!Number.isFinite(kickoff) || !Number.isInteger(game.week) || game.week < 0 || game.week > 30 ||
        !['regular', 'postseason'].includes(game.seasonType) || typeof game.neutral !== 'boolean' ||
        !['scheduled', 'pending', 'final'].includes(game.status)) throw new Error(`Invalid contest game ${game.id}`);
    if (game.status === 'final' && (!validScore(game.homePoints) || !validScore(game.awayPoints) || kickoff > fetchedAt)) {
      throw new Error(`Unconfirmed final for contest game ${game.id}`);
    }
    let modelTeam = null;
    let modelCapturedAt = null;
    let homeWinProbability = null;
    if (game.pick) {
      const capture = timestamp(game.pick.capturedAt);
      const probability = game.pick.homeWinProbability;
      const favored = probability > .5 ? 'home' : probability < .5 ? 'away' : 'even';
      if (!Number.isFinite(capture) || capture >= kickoff || capture > observedAt || !Number.isFinite(probability) ||
          probability < 0 || probability > 1 || game.pick.favored !== favored) {
        throw new Error(`Invalid saved pregame model pick for ${game.id}`);
      }
      if (favored !== 'even') {
        modelTeam = game[favored];
        modelCapturedAt = game.pick.capturedAt;
        homeWinProbability = probability;
      }
    }
    games.push({ id: game.id, week: game.week, seasonType: game.seasonType, home: home.id, away: away.id,
      homeName: home.name, awayName: away.name, startDate: game.startDate, neutral: game.neutral, status: game.status,
      homePoints: game.status === 'final' ? game.homePoints : null,
      awayPoints: game.status === 'final' ? game.awayPoints : null,
      modelTeam, modelCapturedAt, homeWinProbability });
  }
  if (!games.length) throw new Error('No FBS matchups in the Weekly Picks publication');
  return { p_season: artifact.season, p_observed_at: artifact.asOf, p_games: games };
}

export async function publishWeeklyContest(credentials, payload, fetcher = fetch) {
  const endpoint = new URL('/rest/v1/rpc/weekly_sync', credentials.endpoint);
  let response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST', headers: { apikey: credentials.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
  } catch { throw new Error('Supabase weekly contest sync could not connect'); }
  if (!response.ok) throw new Error(`Supabase weekly contest sync failed (HTTP ${response.status})`);
  return response.json();
}

async function run() {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/sync-weekly-contest.js');
  const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
  const publication = await json('published/weekly-picks.json');
  const url = process.env.CFP_SUPABASE_URL || (await json('frontend/bracket-config.json')).url;
  const credentials = cfpSyncCredentials(url, process.env.CFP_SUPABASE_SECRET_KEY);
  const payload = buildWeeklyContestSync(publication);
  const result = await publishWeeklyContest(credentials, payload);
  console.log(`Weekly contest sync ${result.stale ? 'already current' : 'published'}: ${payload.p_games.length} FBS matchups. No CFBD calls.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await run();
