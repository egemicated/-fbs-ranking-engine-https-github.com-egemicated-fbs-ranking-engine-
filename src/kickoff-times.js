const espnScoreboard = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const day = 86_400_000;
const seasonType = type => type === 'regular' ? 2 : 3;
const period = (type, week) => `${type}:${week}`;
const matchup = (a, b) => a && a.id === b.id && a.home === b.home && a.away === b.away &&
  a.neutral === b.neutral && a.seasonType === b.seasonType && a.week === b.week;
const upcoming = game => !game.completed && !['final', 'canceled'].includes(game.status) &&
  !Number.isInteger(game.homePoints) && !Number.isInteger(game.awayPoints);

function eligibleGames(games, teams, excludeIds) {
  const fbs = new Set(teams.filter(team => team.division === 'fbs').map(team => team.id));
  return games.filter(game => !excludeIds.has(game.id) && (fbs.has(game.home) || fbs.has(game.away)));
}

function confirmedTimes(boards, season, observedAt) {
  const confirmed = new Map();
  const seen = new Set();
  for (const board of boards) {
    const { year, type } = board?.season ?? {};
    if (year !== season || ![2, 3].includes(type) || !Number.isInteger(board.week?.number) || !Array.isArray(board.events)) continue;
    for (const event of board.events) {
      const id = event?.id;
      if (typeof id !== 'string') continue;
      if (seen.has(id)) {
        confirmed.delete(id);
        continue;
      }
      seen.add(id);
      const competition = Array.isArray(event.competitions) && event.competitions.length === 1 ? event.competitions[0] : null;
      if (competition?.id !== id || competition.dateValid !== true || competition.timeValid !== true ||
          competition.status?.type?.state !== 'pre' || typeof competition.neutralSite !== 'boolean' ||
          !Array.isArray(competition.competitors) || competition.competitors.length !== 2 ||
          typeof competition.date !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(competition.date)) continue;
      const kickoff = Date.parse(competition.date);
      if (!(kickoff > observedAt)) continue;
      const home = competition.competitors.find(team => team?.homeAway === 'home')?.id;
      const away = competition.competitors.find(team => team?.homeAway === 'away')?.id;
      if (typeof home !== 'string' || typeof away !== 'string' || home === away) continue;
      confirmed.set(id, { id, home, away, neutral: competition.neutralSite, startDate: new Date(kickoff).toISOString(),
        week: board.week.number, seasonType: type === 2 ? 'regular' : 'postseason' });
    }
  }
  return confirmed;
}

export function reconcileKickoffTimes(games, teams, { season, boards = [], previousGames = [], excludeIds = new Set(), observedAt } = {}) {
  const time = new Date(observedAt).getTime();
  if (!Number.isInteger(season) || !Number.isFinite(time)) throw new Error('Kickoff confirmation requires a dated season');
  const verified = new Date(time).toISOString();
  const confirmed = confirmedTimes(boards, season, time);
  const previous = new Map(previousGames.map(game => [game.id, game]));
  const candidates = new Set(eligibleGames(games, teams, excludeIds).map(game => game.id));
  const corrected = [], unresolved = [];
  const revisions = games.map(game => {
    if (game.startTimeTbd !== true || !candidates.has(game.id)) return game;
    const current = upcoming(game) && confirmed.get(game.id);
    const old = previous.get(game.id);
    const stored = matchup(old, game) && old.kickoffSource === 'espn' && old.startTimeTbd === false &&
      Date.parse(old.kickoffOriginalDate) === Date.parse(game.startDate) &&
      Date.parse(old.kickoffVerifiedAt) <= time && Date.parse(old.kickoffVerifiedAt) < Date.parse(old.startDate) ? old : null;
    const chosen = matchup(current, game) ? current : stored;
    if (!chosen) {
      if (upcoming(game)) unresolved.push(game.id);
      return game;
    }
    corrected.push(game.id);
    return { ...game, startDate: chosen.startDate, startTimeTbd: false, kickoffSource: 'espn',
      kickoffVerifiedAt: chosen === current ? verified : chosen.kickoffVerifiedAt,
      kickoffOriginalDate: chosen === current ? new Date(game.startDate).toISOString() : chosen.kickoffOriginalDate,
      ...(game.status === 'pending' && Date.parse(chosen.startDate) > time ? { status: 'scheduled' } : {}) };
  });
  return { games: revisions, corrected, unresolved };
}

export async function fetchKickoffBoards(games, teams, { season, excludeIds = new Set(), observedAt, fetcher = fetch } = {}) {
  const time = new Date(observedAt).getTime();
  const eligible = eligibleGames(games, teams, excludeIds);
  const periods = new Map();
  for (const game of eligible) {
    const kickoff = Date.parse(game.startDate);
    if (game.startTimeTbd !== true || !upcoming(game) || !(kickoff >= time - day && kickoff <= time + 7 * day)) continue;
    const type = seasonType(game.seasonType);
    periods.set(period(type, game.week), { type, week: game.week });
  }
  const boards = [];
  for (const { type, week } of periods.values()) {
    const query = new URLSearchParams({ groups: '80', limit: '200', dates: String(season), seasontype: String(type), week: String(week) });
    try {
      const response = await fetcher(`${espnScoreboard}?${query}`, { signal: AbortSignal.timeout(12_000), redirect: 'error' });
      if (!response.ok) continue;
      const board = await response.json();
      if (board?.season?.year === season && board.season.type === type && board.week?.number === week) boards.push(board);
    } catch {
      // Leave this slate unconfirmed and keep earlier verified times.
    }
  }
  return boards;
}

function excludedGames(snapshot) {
  const audit = snapshot.source?.audit;
  return new Set([...(audit?.confirmedCanceledRecords ?? []).map(game => game.id), ...(audit?.incompleteFinals ?? [])]);
}

export function reconcilePublishedKickoffs(snapshot, weekly, { boards = [], observedAt } = {}) {
  const time = new Date(observedAt).getTime();
  if (snapshot?.source?.provider !== 'cfbd' || weekly?.source?.provider !== 'cfbd' ||
      weekly.season !== snapshot.season || !snapshot.snapshotHash || weekly.source.snapshotHash !== snapshot.snapshotHash ||
      weekly.source.scheduleAsOf !== snapshot.source.fetchedAt || weekly.source.rankingAsOf !== snapshot.asOf ||
      !(time > Date.parse(weekly.asOf))) throw new Error('Kickoff-only updates require matching dated weekly publications');
  const result = reconcileKickoffTimes(weekly.games, weekly.teams, {
    season: snapshot.season, boards, observedAt, excludeIds: excludedGames(snapshot),
  });
  // The first updated contest slate must mark existing placeholder deadlines even if none has a confirmed time yet.
  const unresolved = new Set(result.unresolved);
  const needsTbdSync = !weekly.kickoffVerificationAsOf && weekly.games.some(game =>
    unresolved.has(game.id) && game.pick && Date.parse(game.startDate) > time);
  if (!result.corrected.length && !needsTbdSync) return { snapshot, weekly, corrected: result.corrected, unresolved: result.unresolved };
  const asOf = new Date(time).toISOString();
  let futureFixtures = snapshot.futureFixtures;
  if (Array.isArray(futureFixtures)) {
    const byId = new Map(futureFixtures.map(game => [game.id, game]));
    const corrected = new Set(result.corrected);
    for (const game of result.games) if (corrected.has(game.id) && game.status === 'scheduled') {
      const { id, home, away, startDate, neutral, startTimeTbd } = game;
      byId.set(id, { id, home, away, startDate, neutral, startTimeTbd });
    }
    futureFixtures = [...byId.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  }
  return {
    snapshot: { ...snapshot, kickoffVerificationAsOf: asOf, ...(futureFixtures ? { futureFixtures } : {}) },
    weekly: { ...weekly, asOf, kickoffVerificationAsOf: asOf,
      games: result.games.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)) },
    corrected: result.corrected, unresolved: result.unresolved,
  };
}

export async function verifySeasonKickoffs(season, previous, observedAt = new Date().toISOString()) {
  const excludeIds = excludedGames(season);
  const { year, teams, games } = season;
  const options = { season: year, observedAt, excludeIds };
  const boards = await fetchKickoffBoards(games, teams, options);
  const result = reconcileKickoffTimes(games, teams, { ...options, boards,
    previousGames: previous?.season === year && Array.isArray(previous.games) ? previous.games : [] });
  return result.corrected.length ? { ...season, games: result.games } : season;
}
