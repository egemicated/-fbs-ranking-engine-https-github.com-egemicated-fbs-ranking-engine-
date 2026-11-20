const championshipWeek = 'regular:14';
const hasChampionshipWeek = (season, division) => season === 2026 && division === 'fbs';

export const championshipWeekLabel = 'Week 14 — Conference Championship Week';
export const championshipWeekMessage = 'Conference championship matchups have not yet been confirmed in our published game data. Participating teams, verified kickoff times, saved predictions, and results will appear here as they become available.';

export function isChampionshipWeek(week, season, division) {
  return week === championshipWeek && hasChampionshipWeek(season, division);
}

export function withChampionshipWeek(weeks, season, division) {
  const keys = [...weeks];
  if (!hasChampionshipWeek(season, division) || keys.includes(championshipWeek)) return keys;
  // This adds a selector entry only. Scores and forecasts come from published games.
  const next = keys.findIndex(key => key.startsWith('postseason:') || Number(key.split(':')[1]) > 14);
  keys.splice(next === -1 ? keys.length : next, 0, championshipWeek);
  return keys;
}
