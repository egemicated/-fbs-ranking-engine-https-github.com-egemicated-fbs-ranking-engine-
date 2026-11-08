function picksTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

export function validWeeklyPick(game, pick, capturedAt, publicationAsOf, teams) {
  const probability = pick?.homeWinProbability;
  const capture = picksTime(capturedAt);
  return Number.isFinite(probability) && probability >= 0 && probability <= 1 &&
    pick.favored === (probability === 0.5 ? 'even' : probability > 0.5 ? 'home' : 'away') &&
    Number.isFinite(capture) && capture < picksTime(game.startDate) && capture <= picksTime(publicationAsOf) &&
    teams.get(game.home)?.division === 'fbs' && teams.get(game.away)?.division === 'fbs';
}

const newTally = () => ({ availablePicks: 0, pendingPicks: 0, completedPicks: 0, decisivePicks: 0, correctPicks: 0, squaredError: 0 });

function tally(counts, game, pick, publicationTime) {
  counts.availablePicks++;
  if (game.status === 'scheduled' || game.status === 'pending') counts.pendingPicks++;
  if (game.status !== 'final' || picksTime(game.startDate) > publicationTime || game.homePoints === game.awayPoints ||
      ![game.homePoints, game.awayPoints].every(points => Number.isInteger(points) && points >= 0)) return;
  const homeWon = game.homePoints > game.awayPoints;
  counts.completedPicks++;
  counts.squaredError += (pick.homeWinProbability - Number(homeWon)) ** 2;
  if (pick.favored === 'even') return;
  counts.decisivePicks++;
  if (pick.favored === (homeWon ? 'home' : 'away')) counts.correctPicks++;
}

function summary({ squaredError, ...counts }) {
  return { ...counts,
    accuracy: counts.decisivePicks ? counts.correctPicks / counts.decisivePicks : null,
    brier: counts.completedPicks ? squaredError / counts.completedPicks : null };
}

function compare(week, previousWeek) {
  if (!week?.completedPicks || !previousWeek?.completedPicks) return null;
  return {
    accuracyDifference: week.accuracy === null || previousWeek.accuracy === null ? null : week.accuracy - previousWeek.accuracy,
    brierDifference: week.brier - previousWeek.brier,
  };
}

export function weeklyPicksScore(artifact, selectedWeek) {
  const teams = new Map(artifact.teams.map(team => [team.id, team]));
  const publicationTime = picksTime(artifact.asOf);
  const weeks = new Map();
  const season = newTally();
  const games = [...artifact.games].sort((a, b) => picksTime(a.startDate) - picksTime(b.startDate) || a.id.localeCompare(b.id));
  for (const game of games) {
    const { seasonType, week, pick, replay } = game;
    const key = `${seasonType}:${week}`;
    if (!weeks.has(key)) weeks.set(key, { label: { key, seasonType, week }, saved: newTally(), replay: newTally() });
    const group = weeks.get(key);
    if (validWeeklyPick(game, pick, pick?.capturedAt, artifact.asOf, teams)) {
      tally(group.saved, game, pick, publicationTime);
      tally(season, game, pick, publicationTime);
    } else if (picksTime(game.startDate) <= publicationTime && validWeeklyPick(game, replay, replay?.asOf, artifact.asOf, teams)) {
      tally(group.replay, game, replay, publicationTime);
    }
  }
  const index = [...weeks.keys()].indexOf(selectedWeek);
  const selected = weeks.get(selectedWeek);
  const prior = index > 0 ? [...weeks.values()][index - 1] : null;
  const forCohort = cohort => {
    const week = selected ? { ...selected.label, ...summary(selected[cohort]) } : null;
    const previousWeek = prior ? { ...prior.label, ...summary(prior[cohort]) } : null;
    return { week, previousWeek, comparison: compare(week, previousWeek) };
  };
  return { ...forCohort('saved'), season: summary(season), replay: forCohort('replay') };
}
