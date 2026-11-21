const matchup = (a, b) => a && a.id === b.id && a.home === b.home && a.away === b.away &&
  a.neutral === b.neutral && a.seasonType === b.seasonType && a.week === b.week;
const upcoming = game => !game.completed && !['final', 'canceled'].includes(game.status) &&
  !Number.isInteger(game.homePoints) && !Number.isInteger(game.awayPoints);

function eligibleGames(games, teams, excludeIds) {
  const fbs = new Set(teams.filter(team => team.division === 'fbs').map(team => team.id));
  return games.filter(game => !excludeIds.has(game.id) && (fbs.has(game.home) || fbs.has(game.away)));
}

export function reconcileKickoffTimes(games, teams, { season, previousGames = [], excludeIds = new Set(), observedAt } = {}) {
  const time = new Date(observedAt).getTime();
  if (!Number.isInteger(season) || !Number.isFinite(time)) throw new Error('Kickoff confirmation requires a dated season');
  const previous = new Map(previousGames.map(game => [game.id, game]));
  const candidates = new Set(eligibleGames(games, teams, excludeIds).map(game => game.id));
  const corrected = [], unresolved = [];
  const revisions = games.map(game => {
    if (game.startTimeTbd !== true || !candidates.has(game.id)) return game;
    const old = previous.get(game.id);
    // Retain only historical evidence for the same game and identical date placeholder.
    // A new TBD fixture does not receive a time or become eligible for contest picks here.
    const stored = matchup(old, game) && old.kickoffSource === 'espn' && old.startTimeTbd === false &&
      Date.parse(old.kickoffOriginalDate) === Date.parse(game.startDate) &&
      Date.parse(old.kickoffVerifiedAt) <= time && Date.parse(old.kickoffVerifiedAt) < Date.parse(old.startDate) ? old : null;
    if (!stored) {
      if (upcoming(game)) unresolved.push(game.id);
      return game;
    }
    corrected.push(game.id);
    return { ...game, startDate: stored.startDate, startTimeTbd: false, kickoffSource: stored.kickoffSource,
      kickoffVerifiedAt: stored.kickoffVerifiedAt, kickoffOriginalDate: stored.kickoffOriginalDate,
      ...(game.status === 'pending' && Date.parse(stored.startDate) > time ? { status: 'scheduled' } : {}) };
  });
  return { games: revisions, corrected, unresolved };
}

function excludedGames(snapshot) {
  const audit = snapshot.source?.audit;
  return new Set([...(audit?.confirmedCanceledRecords ?? []).map(game => game.id), ...(audit?.incompleteFinals ?? [])]);
}

export function reconcilePublishedKickoffs(snapshot, weekly, { observedAt } = {}) {
  const time = new Date(observedAt).getTime();
  if (snapshot?.source?.provider !== 'cfbd' || weekly?.source?.provider !== 'cfbd' ||
      weekly.season !== snapshot.season || !snapshot.snapshotHash || weekly.source.snapshotHash !== snapshot.snapshotHash ||
      weekly.source.scheduleAsOf !== snapshot.source.fetchedAt || weekly.source.rankingAsOf !== snapshot.asOf ||
      !(time > Date.parse(weekly.asOf))) throw new Error('Kickoff-only updates require matching dated weekly publications');
  const unresolved = eligibleGames(weekly.games, weekly.teams, excludedGames(snapshot))
    .filter(game => game.startTimeTbd === true && upcoming(game)).map(game => game.id);
  // The first updated contest slate must mark existing placeholder deadlines even if none has a confirmed time yet.
  const unresolvedIds = new Set(unresolved);
  const needsTbdSync = !weekly.kickoffVerificationAsOf && weekly.games.some(game =>
    unresolvedIds.has(game.id) && game.pick && Date.parse(game.startDate) > time);
  if (!needsTbdSync) return { snapshot, weekly, unresolved };
  const asOf = new Date(time).toISOString();
  return {
    snapshot: { ...snapshot, kickoffVerificationAsOf: asOf },
    weekly: { ...weekly, asOf, kickoffVerificationAsOf: asOf },
    unresolved,
  };
}

export function preservePublishedKickoffs(season, previous, observedAt = new Date().toISOString()) {
  const excludeIds = excludedGames(season);
  const { year, teams, games } = season;
  const options = { season: year, observedAt, excludeIds };
  const result = reconcileKickoffTimes(games, teams, { ...options,
    previousGames: previous?.season === year && Array.isArray(previous.games) ? previous.games : [] });
  return result.corrected.length ? { ...season, games: result.games } : season;
}
