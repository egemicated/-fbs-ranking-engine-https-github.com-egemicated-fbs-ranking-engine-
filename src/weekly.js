import { rankSeason } from './engine.js';

export const UPDATE_SCHEDULE = Object.freeze({
  day: 'Sunday', hour: 0, minute: 1, timeZone: 'America/Denver', cron: '1 0 * * 0',
  midweek: { days: ['Wednesday', 'Thursday', 'Friday', 'Saturday'], hour: 4, minute: 11, cron: '11 4 * * 3-6' },
  sundayCatchUp: { day: 'Sunday', hour: 4, minute: 11, cron: '11 4 * * 0' },
  sundayNight: { day: 'Sunday', hour: 20, minute: 11, cron: '11 20 * * 0' },
});

export function buildWeeklySnapshot(season, prior, config, now = new Date()) {
  if (prior.season !== season.year - 1) throw new Error('A previous-season strength snapshot is required');
  if (!season.teams.some(t => t.division === 'fbs') || season.source?.provider !== 'cfbd') throw new Error('Weekly updates require direct CFBD data');
  // The API confirms completion at retrieval, so Saturday finals do not need
  // the conservative 24-hour buffer used in retrospective backtests.
  const eligible = new Set(season.games.filter(g => g.completed && Date.parse(g.startDate) <= now.getTime()).map(g => g.id));
  if (!eligible.size) throw new Error('CFBD has no completed games to publish');
  const snapshot = rankSeason(season, { config, previous: prior, gameIds: eligible });
  const fcs = new Set(season.teams.filter(team => team.division === 'fcs').map(team => team.id));
  const ranked = new Set([...snapshot.rankings.map(team => team.id), ...fcs]);
  const canceled = new Set((season.source.audit?.confirmedCanceledRecords ?? []).map(game => game.id));
  const incomplete = new Set(season.source.audit?.incompleteFinals ?? []);
  // Keep only the fields needed for future game cards. The full source stays in the refresh workspace.
  const futureFixtures = season.games
    .filter(game => !game.completed && !canceled.has(game.id) && !incomplete.has(game.id) &&
      !Number.isInteger(game.homePoints) && !Number.isInteger(game.awayPoints) &&
      Date.parse(game.startDate) > now.getTime() && (ranked.has(game.home) || ranked.has(game.away)))
    .map(({ id, home, away, startDate, neutral, startTimeTbd }) => ({
      id, home, away, startDate: new Date(startDate).toISOString(), neutral,
      ...(typeof startTimeTbd === 'boolean' ? { startTimeTbd } : {}),
    })).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  // Keep unresolved FCS kickoff times for the scheduler, including fixtures awaiting a result.
  const pendingFcsKickoffs = [...new Set(season.games
    .filter(game => !game.completed && game.startTimeTbd !== true && !canceled.has(game.id) &&
      (fcs.has(game.home) || fcs.has(game.away)))
    .map(game => new Date(game.startDate).toISOString()))].sort();
  return { ...snapshot, futureFixtures, pendingFcsKickoffs, asOf: now.toISOString(), update: { schedule: UPDATE_SCHEDULE,
    lastSuccessfulUpdate: now.toISOString(), provider: 'CollegeFootballData', apiCallsThisUpdate: 2,
    policy: 'Confirmed completed games available from CFBD at retrieval time' } };
}
