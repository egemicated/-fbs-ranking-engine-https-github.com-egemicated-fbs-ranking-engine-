const DAY = 86_400_000;
const weekKey = game => `${game.seasonType}:${game.week}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

export function buildWeeklyTeamStats(publication) {
  const asOf = Date.parse(publication?.asOf);
  const sourceCutoff = Date.parse(publication?.source?.scheduleAsOf ?? publication?.asOf);
  if (publication?.schemaVersion !== 1 || !Number.isInteger(publication.season) ||
      !Number.isFinite(asOf) || !Number.isFinite(sourceCutoff) || sourceCutoff > asOf ||
      !Array.isArray(publication.teams) || !Array.isArray(publication.games)) {
    throw new Error('Weekly team stats require a dated Weekly Picks publication');
  }

  const totals = new Map(publication.teams.filter(team => team.division === 'fbs').map(team => [team.id,
    { wins: 0, losses: 0, ties: 0, games: 0, pointsFor: 0, pointsAgainst: 0 }]));
  const weeks = new Map();
  const finals = [];
  const seen = new Set();
  for (const game of publication.games) {
    const kickoff = Date.parse(game.startDate);
    if (!game.id || seen.has(game.id) || !Number.isFinite(kickoff) ||
        !Number.isInteger(game.week) || !['regular', 'postseason'].includes(game.seasonType) || game.home === game.away) {
      throw new Error('Invalid schedule for weekly team stats');
    }
    seen.add(game.id);
    const participants = [game.home, game.away].filter(id => totals.has(id));
    if (!participants.length) continue;
    const key = weekKey(game);
    if (!weeks.has(key)) weeks.set(key, { opening: kickoff, teams: new Set() });
    const week = weeks.get(key);
    week.opening = Math.min(week.opening, kickoff);
    participants.forEach(id => week.teams.add(id));
    if (game.status === 'final' && kickoff <= sourceCutoff &&
        [game.homePoints, game.awayPoints].every(points => Number.isInteger(points) && points >= 0)) {
      finals.push({ ...game, kickoff });
    }
  }
  finals.sort((a, b) => a.kickoff - b.kickoff);
  let nextFinal = 0;
  const byWeek = {};
  for (const [key, week] of [...weeks].sort((a, b) => a[1].opening - b[1].opening)) {
    // Match the historical replay buffer when exact final times are unavailable.
    const through = Math.min(sourceCutoff, week.opening - DAY - 1);
    while (nextFinal < finals.length && finals[nextFinal].kickoff <= through) {
      const game = finals[nextFinal++];
      for (const [id, scored, allowed] of [[game.home, game.homePoints, game.awayPoints], [game.away, game.awayPoints, game.homePoints]]) {
        const team = totals.get(id);
        if (!team) continue;
        team.games++;
        team.pointsFor += scored;
        team.pointsAgainst += allowed;
        team[scored === allowed ? 'ties' : scored > allowed ? 'wins' : 'losses']++;
      }
    }
    byWeek[key] = {
      through: new Date(through).toISOString(),
      teams: Object.fromEntries([...week.teams].filter(id => totals.get(id).games).map(id => [id, { ...totals.get(id) }])),
    };
  }
  return { schemaVersion: 1, season: publication.season, asOf: publication.asOf, weeks: byWeek };
}

function teamStats(week, id) {
  const team = week.teams?.[id];
  if (!team || !['wins', 'losses', 'ties', 'games', 'pointsFor', 'pointsAgainst'].every(key => Number.isInteger(team[key]) && team[key] >= 0) ||
      !team.games || team.wins + team.losses + team.ties !== team.games) return null;
  return {
    record: `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`,
    scored: (team.pointsFor / team.games).toFixed(1),
    allowed: (team.pointsAgainst / team.games).toFixed(1),
  };
}

export function renderWeeklyTeamStats(stats, game, { awayName, homeName }) {
  if (stats?.schemaVersion !== 1 || game.voidReason || !Number.isInteger(game.week)) return '';
  const week = stats.weeks?.[weekKey(game)];
  if (!week || !(Date.parse(week.through) < Date.parse(game.startDate))) return '';
  const away = teamStats(week, game.away);
  const home = teamStats(week, game.home);
  if (!away && !home) return '';
  const label = game.seasonType === 'postseason' ? `Postseason Week ${game.week}` : `Week ${game.week}`;
  return `<details class="weekly-team-stats">
    <summary>Team stats entering ${label}</summary>
    <table><caption class="sr-only">Team stats entering ${label}</caption>
      <thead><tr><th scope="col">Stat</th><th scope="col">${escapeHtml(awayName)}</th><th scope="col">${escapeHtml(homeName)}</th></tr></thead>
      <tbody>${[['Record', 'record'], ['Points scored per game', 'scored'], ['Points allowed per game', 'allowed']].map(([name, key]) =>
        `<tr><th scope="row">${name}</th><td>${away?.[key] ?? '—'}</td><td>${home?.[key] ?? '—'}</td></tr>`).join('')}</tbody>
    </table>${away && home ? '' : '<p class="compact-note">A dash marks unavailable team stats.</p>'}
  </details>`;
}
