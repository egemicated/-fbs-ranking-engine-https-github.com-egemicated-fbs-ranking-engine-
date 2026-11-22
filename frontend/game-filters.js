const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const mountainDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
});
const dayLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
});

export const defaultGameFilters = Object.freeze({
  scope: 'all', conference: '', day: '', status: 'all', close: false, ranked: false,
});

const teamMap = teams => teams instanceof Map ? teams : new Map(Object.entries(teams ?? {}));
const favoriteIds = ids => new Set((ids ?? []).map(String));

export function gameDay(game) {
  const value = Date.parse(game.startDate);
  if (!Number.isFinite(value)) return '';
  // A provider's date-only TBD kickoff has no trustworthy clock time.
  return game.startTimeTbd === true ? game.startDate.slice(0, 10) : mountainDay.format(value);
}

const footballDivisions = ['fbs', 'fcs'];
const isRanked = (team, divisions) => {
  const rank = team?.displayRank ?? team?.sorRank;
  return divisions.includes(team?.division) && Number.isInteger(rank) && rank > 0 && rank <= 25;
};

export function filterGames(games, selection = {}, { teams, myTeamIds, rankedDivisions = footballDivisions } = {}) {
  const filters = { ...defaultGameFilters, ...selection };
  const byId = teamMap(teams);
  const favorites = favoriteIds(myTeamIds);
  return games.filter(game => {
    const sides = [String(game.home), String(game.away)];
    if (filters.scope === 'mine' && !sides.some(id => favorites.has(id))) return false;
    if (filters.conference && !sides.some(id => byId.get(id)?.conference === filters.conference)) return false;
    if (filters.day && gameDay(game) !== filters.day) return false;
    const status = game.status === 'final' ? 'final' : game.status === 'live' ? 'live'
      : ['scheduled', 'pending'].includes(game.status) ? 'upcoming' : game.status;
    if (filters.status !== 'all' && filters.status !== status) return false;
    if (filters.ranked && !sides.some(id => isRanked(byId.get(id), rankedDivisions))) return false;
    if (filters.close) {
      if (status === 'live' || status === 'final') {
        if (![game.homePoints, game.awayPoints].every(Number.isFinite) || Math.abs(game.homePoints - game.awayPoints) > 7) return false;
      } else {
        const probability = game.pick?.homeWinProbability ?? game.estimate?.homeWinProbability;
        if (!Number.isFinite(probability) || probability < 0.35 || probability > 0.65) return false;
      }
    }
    return true;
  });
}

export function gameFilterControls({ filters = {}, teams, games = [], myTeamIds = [], rankLabel = 'SOR', idPrefix = 'games',
  includeLive = true, liveLabel = 'Live', includeMyTeams = true, includeDay = true, includeChanges = false,
  rankedDivisions = footballDivisions, contextControls = '' } = {}) {
  const chosen = { ...defaultGameFilters, ...filters };
  const byId = teamMap(teams);
  const conferences = [...new Set([...byId.values()].map(team => team.conference).filter(Boolean))].sort();
  const days = [...new Set(games.map(gameDay).filter(Boolean))].sort();
  const options = (rows, value) => rows.map(([key, label]) => `<option value="${escapeHtml(key)}"${String(value) === String(key) ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const select = (key, label, rows) => {
    const id = `${escapeHtml(idPrefix)}-${key}`;
    return `<label><span id="${id}-label">${label}</span><select id="${id}" aria-labelledby="${id}-label" data-game-filter="${key}">${options(rows, chosen[key])}</select></label>`;
  };
  const check = (key, label) => `<label class="game-filter-check"><input id="${escapeHtml(idPrefix)}-${key}" type="checkbox" data-game-filter="${key}"${chosen[key] ? ' checked' : ''}><span>${label}</span></label>`;
  const coverage = [...byId.values()].some(team => isRanked(team, rankedDivisions));
  const statuses = [['all', 'All games'], ['upcoming', 'Upcoming'], ...(includeLive ? [['live', liveLabel]] : []),
    ['final', 'Final'], ...(includeChanges ? [['changed', 'Schedule changes']] : [])];
  return `<div class="game-filters" aria-label="Game filters">
    ${contextControls}
    ${includeMyTeams ? select('scope', 'Teams', [['all', 'All teams'], ['mine', 'My Teams']]) : ''}
    ${select('conference', 'Conference', [['', 'All conferences'], ...conferences.map(name => [name, name])])}
    ${includeDay ? select('day', 'Game day', [['', 'All days'], ...days.map(day => [day, dayLabel.format(new Date(day + 'T12:00:00Z'))])]) : ''}
    ${select('status', 'Status', statuses)}
    <div class="game-filter-checks">${check('close', 'Close matchups')}${coverage ? check('ranked', `${rankLabel} Top 25 teams`) : ''}</div>
    ${includeMyTeams && chosen.scope === 'mine' && !myTeamIds.length ? '<p class="compact-note game-filter-note">Sign in and choose teams in <a href="/my-teams">My Teams</a> to use this filter.</p>' : ''}
    ${chosen.close ? `<p class="compact-note game-filter-note">Upcoming games use a 35–65% model win chance. ${includeLive ? escapeHtml(liveLabel) + ' and final' : 'Final'} games use a margin of seven points or fewer. Games without the required evidence are excluded.</p>` : ''}
  </div>`;
}

export function readGameFilterChange(filters, event) {
  const key = event.target?.dataset?.gameFilter;
  if (!Object.hasOwn(defaultGameFilters, key ?? '')) return null;
  const value = ['close', 'ranked'].includes(key) ? event.target.checked : event.target.value;
  return { ...defaultGameFilters, ...filters, [key]: value };
}
