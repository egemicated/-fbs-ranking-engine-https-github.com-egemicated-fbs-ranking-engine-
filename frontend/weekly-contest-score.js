const isoTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const teamId = value => typeof value === 'string' && value.length > 0;

export function contestWeekKey(game) {
  return `${game.seasonType}:${game.week}`;
}

export function contestWeekLabel(key) {
  const [type, week] = String(key).split(':');
  return type === 'postseason' ? `Postseason · Week ${week}` : `Week ${week}`;
}

// A preview estimate or a retrospectively replayed pick never opens a contest.
export function contestGames(contest) {
  if (!contest || !Array.isArray(contest.games) || !Number.isInteger(contest.season) || !Number.isFinite(isoTime(contest.serverNow))) {
    throw new Error('Invalid weekly contest');
  }
  const seen = new Set();
  return contest.games.filter(game => {
    if (!teamId(game.id) || seen.has(game.id)) throw new Error('Invalid weekly contest game');
    seen.add(game.id);
    return (game.eligible === true || Boolean(game.voidReason)) && teamId(game.home) && teamId(game.away) && game.home !== game.away &&
      [game.home, game.away].includes(game.modelTeam) && Number.isInteger(game.week) && game.week >= 0 &&
      ['regular', 'postseason'].includes(game.seasonType) && Number.isFinite(isoTime(game.startDate)) &&
      Number.isFinite(isoTime(game.modelCapturedAt)) && isoTime(game.modelCapturedAt) < isoTime(game.startDate) &&
      Number.isFinite(game.homeWinProbability) && game.homeWinProbability >= 0 && game.homeWinProbability <= 1 &&
      game.homeWinProbability !== .5 && game.modelTeam === (game.homeWinProbability > .5 ? game.home : game.away);
  }).sort((a, b) => isoTime(a.startDate) - isoTime(b.startDate) || a.id.localeCompare(b.id));
}

export function contestGameLocked(game, now = Date.now()) {
  const kickoff = isoTime(game.startDate);
  const lock = isoTime(game.lockAt);
  const deadline = Number.isFinite(lock) ? Math.min(lock, kickoff) : kickoff;
  return game.locked === true || Boolean(game.voidReason) || game.status === 'final' || now >= deadline;
}

export function contestGameWinner(game) {
  if (game.voidReason || game.status !== 'final' || ![game.homePoints, game.awayPoints].every(value => Number.isInteger(value) && value >= 0) ||
      game.homePoints === game.awayPoints) return null;
  const winner = game.homePoints > game.awayPoints ? game.home : game.away;
  return game.winner === winner ? winner : null;
}

export function scoreContestPicks(games, picks, week = null) {
  let picked = 0, correct = 0, wrong = 0, pending = 0, voided = 0, modelCorrect = 0;
  for (const game of games) {
    if (week !== null && contestWeekKey(game) !== week) continue;
    if (![game.home, game.away].includes(picks?.[game.id])) continue;
    if (game.voidReason) { voided++; continue; }
    picked++;
    const winner = contestGameWinner(game);
    if (!winner) { pending++; continue; }
    if (picks[game.id] === winner) correct++;
    else wrong++;
    if (game.modelTeam === winner) modelCorrect++;
  }
  const graded = correct + wrong;
  return { picked, correct, wrong, pending, voided, graded, points: correct, modelCorrect,
    accuracy: graded ? correct / graded : null, modelAccuracy: graded ? modelCorrect / graded : null };
}

export function contestPickChanges(games, saved, draft, now = Date.now()) {
  return Object.fromEntries(games.filter(game => !contestGameLocked(game, now) &&
    [game.home, game.away].includes(draft?.[game.id]) && draft[game.id] !== saved?.[game.id])
    .map(game => [game.id, draft[game.id]]));
}

export function defaultContestWeek(games, now = Date.now()) {
  const next = games.find(game => !contestGameLocked(game, now));
  const last = games.at(-1);
  return next ? contestWeekKey(next) : last ? contestWeekKey(last) : '';
}
