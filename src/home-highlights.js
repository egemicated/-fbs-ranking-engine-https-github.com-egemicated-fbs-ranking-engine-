import { validWeeklyPick, weeklyPicksScore } from '../frontend/weekly-picks-score.js';

export function buildHomeHighlights(snapshot, picks) {
  const source = picks?.source;
  if (picks?.schemaVersion !== 1 || picks.season !== snapshot.season || source?.provider !== 'cfbd' ||
      source.snapshotHash !== snapshot.snapshotHash || source.rankingAsOf !== snapshot.asOf ||
      source.scheduleAsOf !== snapshot.source?.fetchedAt || !Array.isArray(picks.games) || !Array.isArray(picks.teams)) return null;

  const teams = new Map(picks.teams.map(team => [team.id, team]));
  const valid = game => validWeeklyPick(game, game.pick, game.pick?.capturedAt, picks.asOf, teams);
  const sorted = [...picks.games].sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  const pregame = sorted.filter(game => game.status === 'scheduled' && Date.parse(game.startDate) > Date.parse(picks.asOf));
  const next = pregame[0];
  const close = next && pregame.filter(game => game.seasonType === next.seasonType && game.week === next.week &&
      game.startTimeTbd === false && teams.get(game.home)?.division === 'fbs' && teams.get(game.away)?.division === 'fbs' &&
      Math.abs(game.pick?.homeWinProbability - 0.5) <= 0.075 && valid(game))
    .sort((a, b) => Math.abs(a.pick.homeWinProbability - 0.5) - Math.abs(b.pick.homeWinProbability - 0.5))[0];
  const lastFinal = sorted.findLast(game => game.status === 'final' && Date.parse(game.startDate) <= Date.parse(picks.asOf) &&
    [game.homePoints, game.awayPoints].every(points => Number.isInteger(points) && points >= 0) &&
    game.homePoints !== game.awayPoints && game.pick?.favored !== 'even' && valid(game));
  const scored = lastFinal && weeklyPicksScore(picks, `${lastFinal.seasonType}:${lastFinal.week}`).week;
  const closeGame = close ? {
    week: close.week, seasonType: close.seasonType, startDate: close.startDate,
    home: teams.get(close.home).name, away: teams.get(close.away).name, homeWinProbability: close.pick.homeWinProbability,
  } : null;
  const predictionRecord = scored?.decisivePicks ? {
    week: scored.week, seasonType: scored.seasonType, correct: scored.correctPicks, graded: scored.decisivePicks,
  } : null;
  return closeGame || predictionRecord ? { closeGame, predictionRecord } : null;
}
