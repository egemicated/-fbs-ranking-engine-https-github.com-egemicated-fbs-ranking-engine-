import {
  CONFERENCE_QUALITY, conferenceGames, conferenceRecords, conferenceSummary, conferenceFilterCoverage,
} from './conference-metrics.js?v=accuracy-20261118';
import { formatNumber, formatProbability, formatRecord } from './format.js?v=1';

const views = [
  ['records', 'Conference Records'], ['quality', 'Quality Rankings'], ['compare', 'Compare Conferences'],
];
const methods = [
  ['sor', 'Strength of Record'], ['predictive', 'Predictive Strength'],
  ['performance', 'Performance · Experimental'], ['ap', 'AP Top 25'], ['cfp', 'CFP Top 25'],
];
const targets = [['all', 'All FBS'], ['power-four', 'Power Four only']];
const rankingFilters = [['all', 'All opponents'], ['current', 'Current Top 25'], ['pregame', 'Top 25 before kickoff']];
const resultFilters = [['all', 'All games'], ['wins', 'Wins only'], ['losses', 'Losses only']];
const gameSorts = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['margin', 'Largest margin'],
  ['opponent-rank', 'Opponent rank'], ['opponent-strength', 'Opponent predictive rating']];
const qualitySorts = [['score', 'Experimental score'], ['record', 'Winning percentage'],
  ['schedule', 'Opponent predictive rating'], ['ranked', 'Current Top 25 wins']];
const shortNames = new Map([
  ['American Athletic', 'AAC'], ['American', 'AAC'], ['ACC', 'ACC'], ['Big 12', 'Big 12'], ['Big Ten', 'Big Ten'],
  ['Conference USA', 'CUSA'], ['FBS Independents', 'Ind.'], ['Independents', 'Ind.'], ['Mid-American', 'MAC'],
  ['Mountain West', 'MW'], ['Pac-12', 'Pac-12'], ['SEC', 'SEC'], ['Sun Belt', 'SBC'],
]);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const dateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium' });
const plainDateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' });
const number = (value, digits = 1) => formatNumber(value, digits);
const percent = value => formatProbability(value, 1);
const record = formatRecord;
const requests = new Map();
const preferences = new Map();
let focusOnLoad;

function date(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unavailable';
  return (value.length === 10 ? plainDateFormatter : dateFormatter).format(new Date(value));
}

function route({ view, season, a, b }) {
  return '#conference-strength/' + [view, season, ...(view === 'compare' ? [a, b] : [])]
    .filter(value => value !== undefined && value !== '').map(encodeURIComponent).join('/');
}

function header({ view, season, a, b }) {
  return `<nav class="conference-view-nav" aria-label="Conference Strength views">${views.map(([key, label]) =>
    `<a href="${route({ view: key, season, a, b })}"${view === key ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

function select(id, label, options, value) {
  return `<label class="conference-control"><span>${label}</span><select id="conference-${id}" data-conference-field="${id}">${options.map(
    ([key, text, disabled]) => `<option value="${escapeHtml(key)}"${String(value) === String(key) ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(text)}</option>`
  ).join('')}</select></label>`;
}

function conferenceName(data, id) {
  return data.conferences.find(item => item.id === id)?.name ?? id;
}

function qualityContext(data, state) {
  const selected = data.rankings?.[state.method];
  if (!selected?.available) return '<p class="compact-note">This ranking method is unavailable for the selected season.</p>';
  const label = methods.find(([id]) => id === state.method)?.[1];
  const timing = data.archived ? `season-end snapshot. Results through ${date(data.resultsThrough)}` : `snapshot · ${date(selected.asOf)}`;
  const coverage = filterCoverage(data, state);
  const coverageNotes = [
    coverage.noPollYet ? `${coverage.noPollYet} games preceded the first poll release` : '',
    coverage.publicationTimeUncertain ? `${coverage.publicationTimeUncertain} have an unverified release time` : '',
    coverage.missing ? `${coverage.missing} have missing ranking evidence` : '',
    coverage.notApplicable ? `${coverage.notApplicable} have opponents outside this poll’s subdivision` : '',
  ].filter(Boolean).join(' · ');
  return `<p class="compact-note">${escapeHtml(label)} ${timing}. This reference determines opponent ranks and Top 25 counts. The Experimental quality score uses Predictive Strength independently.</p>
    <p class="compact-note">Pregame ranking coverage · ${coverage.pregame} of ${coverage.games} eligible games. ${coverageNotes ? coverageNotes + '. ' : ''}${coverage.pregame ? 'Only covered games enter the pregame rank filter.' : 'Pregame rank filtering is unavailable for this selection.'} Team records use the selected season’s snapshot.</p>`;
}

function filterCoverage(data, state) {
  return conferenceFilterCoverage(data, {
    method: state.method, opponents: state.opponents, result: state.result,
    ...(state.view === 'compare' ? { conferenceA: state.a, conferenceB: state.b === 'FCS' ? undefined : state.b,
      opponents: state.b === 'FCS' ? 'fcs' : state.opponents } : {}),
  });
}

function emptyGames(data, state) {
  const coverage = filterCoverage(data, state);
  if (state.rankScope === 'pregame' && !coverage.pregame && coverage.games) {
    if (coverage.noPollYet === coverage.games) return 'These games preceded the first poll release. A pregame ranking did not yet exist; this is not missing historical data.';
    return 'Pregame opponent rankings are unavailable for these games. Choose All opponents or another ranking reference.';
  }
  if (state.rankScope === 'current' && !coverage.current && coverage.games) {
    return 'Opponent rankings are unavailable for these games and this reference.';
  }
  const uncovered = state.rankScope === 'pregame' ? (coverage.missing ?? coverage.games - coverage.pregame) + (coverage.publicationTimeUncertain ?? 0) :
    state.rankScope === 'current' ? coverage.games - coverage.current : 0;
  return 'No completed games match these filters.' + (uncovered ? ` ${uncovered} games lack the selected ranking evidence and are excluded.` : '');
}

function controls(data, state) {
  const { view, seasons, season, a, b, method, opponents, rankScope, result, sort, qualitySort } = state;
  const options = data.conferences.map(({ id, name }) => [id, name]);
  const basic = select('season', 'Season', seasons.map(year => [year, year]), season);
  const pair = view === 'compare' ?
    `${select('a', 'Conference A', options.map(([id, name]) => [id, name, id === b]), a)}
      ${select('b', 'Conference B', [...options.map(([id, name]) => [id, name, id === a]), ['FCS', 'FCS opponents']], b)}
      <button type="button" class="button light small conference-swap" data-conference-swap ${b === 'FCS' ? 'disabled' : ''}>Swap conferences</button>` : '';
  const methodOptions = methods.map(([id, label]) => data.rankings?.[id]?.available ?
    [id, label] : [id, label + ' · unavailable', true]);
  const coverage = filterCoverage(data, state);
  const rankOptions = rankingFilters.map(([id, name]) => [
    id, data.archived && id === 'current' ? 'Season-end Top 25' : name,
    id === 'pregame' ? !coverage.pregame : id === 'current' ? !coverage.current : false,
  ]);
  const sortOptions = data.archived ? qualitySorts.map(([id, name]) => [id, id === 'ranked' ? 'Season-end Top 25 wins' : name]) : qualitySorts;
  const opponentFilters = view === 'compare' && b === 'FCS' ? ''
    : select('opponents', 'Opponent group', targets, opponents) + select('rankScope', 'Opponent rank', rankOptions, rankScope);
  return `<section class="conference-filters panel panel-body" aria-label="Conference filters"><div class="conference-controls">
    ${basic}${pair}${select('method', 'Opponent ranking reference', methodOptions, method)}
    ${opponentFilters}
    ${view === 'compare' ? select('result', 'Game result', resultFilters, result) + select('sort', 'Sort games', gameSorts, sort)
      : select('qualitySort', 'Sort conferences', sortOptions, qualitySort)}
    </div>${qualityContext(data, state)}</section>`;
}

function recordLink(state, a, b, value, label) {
  return `<a href="${route({view:'compare',season:state.season,a,b})}" data-conference-pair-link aria-label="${escapeHtml(label)}">${escapeHtml(value)}</a>`;
}

function recordsView(data, state) {
  const { summaries, matrix, groups, fcs } = conferenceRecords(data);
  const independents = data.conferences.find(item => item.group === 'independent');
  const six = data.conferences.some(item => item.group === 'group-of-six');
  const columns = data.conferences.map(item => `<th scope="col" title="${escapeHtml(item.name)}">${escapeHtml(shortNames.get(item.name) ?? item.name)}</th>`).join('');
  return `
    <section class="panel"><div class="panel-head conference-records-heading">
      <div><h3>Interconference records</h3><p class="compact-note">${data.season} · Results through ${date(data.resultsThrough)}</p></div>
      ${select('season', 'Season', state.seasons.map(year => [year,year]), state.season)}</div>
      <div class="panel-body conference-league-context">
        <p><span>Power Four vs. Power Four</span><strong>${groups.powerFourVsPowerFour?.games ?? groups.powerFourVsPowerFour}</strong> games</p>
        <p><span>Group of ${six ? 'Six' : 'Five'} vs. Power Four</span><strong>${record(six ? groups.groupSixVsPowerFour : groups.groupFiveVsPowerFour)}</strong></p>
        ${independents ? `<p><span>Conferences vs. Independents</span><strong>${record(groups.vsIndependents)}</strong></p>` : ''}
      </div>
      <div class="conference-scroll" role="region" aria-label="Interconference records table" tabindex="0"><table class="conference-table conference-records"><caption class="sr-only">Records against other FBS conferences. FCS records are separate.</caption>
        <thead><tr><th scope="col">Conference</th><th scope="col">FBS W–L</th><th scope="col">Win %</th>
        <th scope="col">Avg. win margin</th><th scope="col">Avg. loss margin</th><th scope="col">vs. Power Four</th><th scope="col">vs. FCS</th></tr></thead>
        <tbody>${data.conferences.map(({ id, name }) => {
          const row = summaries[id];
          const lower = fcs[id];
          return `<tr><th scope="row">${escapeHtml(name)}</th><td><b>${record(row)}</b></td>
            <td>${percent(row?.winningPercentage)}</td><td>${number(row?.averageVictoryMargin)}</td><td>${number(row?.averageDefeatMargin)}</td>
            <td>${record(row?.powerFourGames)}</td>
            <td>${lower?.games ? recordLink(state,id,'FCS',record(lower),name+' vs. FCS '+record(lower)) : record(lower)}</td></tr>`;
        }).join('')}</tbody></table></div>
      <div class="panel-body"><p class="compact-note">Each FBS matchup contributes to both conferences’ records. FCS games appear in their own column. Margins are shown in points.</p>
      ${data.coverage?.excludedFbsGames ? `<p class="compact-note">${data.coverage.excludedFbsGames} other covered FBS games were against unclassified or lower-division opponents.</p>` : ''}</div>
    </section>
    <section class="panel"><div class="panel-head"><h3>Conference matchup matrix</h3></div>
      <div class="panel-body"><p class="compact-note">Read each record from the row conference’s perspective. Select a record to open the games.</p></div>
      <div class="conference-scroll" role="region" aria-label="Conference matchup matrix, horizontally scrollable" tabindex="0"><table class="conference-table conference-matrix"><caption class="sr-only">Wins and losses for each row conference against each column conference</caption>
        <thead><tr><th scope="col">Conference</th>${columns}</tr></thead><tbody>${data.conferences.map(({ id, name }) =>
    `<tr><th scope="row">${escapeHtml(name)}</th>${data.conferences.map(other => {
      const row = matrix[id]?.[other.id];
      const pair = record(row);
      return `<td>${row?.games ? recordLink(state,id,other.id,pair,name+' vs. '+other.name+' '+pair) : '<span aria-label="No games">—</span>'}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>
    </section>`;
}

function stat(label, value) {
  return `<div><dt>${label}</dt><dd>${value ?? '—'}</dd></div>`;
}

function rankedCount(count, coverage) {
  return coverage ? count : '—';
}

function qualityDetails(row, archived) {
  const opponentRecord = record({ wins: row.opponentWins, losses: row.opponentLosses, ties: row.opponentTies });
  return `<dl class="conference-stats conference-quality-details">
    ${stat('Opponents’ combined record', row.games ? opponentRecord + ' · ' + percent(row.opponentWinningPercentage) : '—')}
    ${stat('Avg. full-field opponent rank', number(row.averageOpponentRank))}
    ${stat('Wins vs. winning records', row.winningRecordWins)}
    ${stat('Wins vs. losing records', row.losingRecordWins)}
    ${stat('Wins vs. .500 records', row.evenRecordWins)}
    ${stat('Wins with unavailable opponent record', row.missingRecordWins)}
    ${stat((archived ? 'Season-end' : 'Current')+' Top 10 / 25 wins', row.currentRankCoverage ? row.currentTop10Wins+' / '+row.currentTop25Wins : '—')}
    ${stat('Pregame Top 10 / 25 wins', row.pregameRankCoverage ? row.pregameTop10Wins+' / '+row.pregameTop25Wins : '—')}
    ${stat('Predictive Top 25 / 50 wins', row.predictiveTop25Wins == null ? '—' : row.predictiveTop25Wins+' / '+row.predictiveTop50Wins)}
    ${stat('Average win quality', number(row.averageWinQuality,3))}
    ${stat('Average loss quality', number(row.averageLossQuality,3))}
    ${stat('Ranking coverage', row.currentRankCoverage + ' snapshot · ' + row.pregameRankCoverage + ' pregame')}
    ${row.pregameNoPollYet ? stat('Games before the first poll release', row.pregameNoPollYet) : ''}
    ${row.pregamePublicationTimeUncertain ? stat('Unverified pregame release time', row.pregamePublicationTimeUncertain) : ''}
    ${row.pregameMissing ? stat('Missing pregame ranking evidence', row.pregameMissing) : ''}
    ${stat('Opponent records measured', row.opponentRecordCoverage + ' of ' + row.games)}
  </dl>`;
}

function qualityMethod() {
  return `<details class="conference-method"><summary>How the Experimental score works</summary>
    <div><p>${escapeHtml(CONFERENCE_QUALITY.formula)}</p>
    <p>${escapeHtml(CONFERENCE_QUALITY.interpretation)} Higher loss quality means the team competed better against its opponent. Historical validation of this experimental score is pending.</p>
    <p>Opponents are counted once per matchup. The snapshot and pregame Top 25 counts use the selected ranking method. The average opponent rank requires a full-field method.</p></div>
    </details>`;
}

function qualityView(data, state) {
  const sortKeys = { score: 'experimentalScore', record: 'winningPercentage', schedule: 'averageOpponentPredictiveRating', ranked: 'currentTop25Wins' };
  const selected = sortKeys[state.qualitySort];
  const conferences = data.conferences.map(conference => {
    const games = conferenceGames(data, { ...state, conferenceA: conference.id });
    return { conference, row: conferenceSummary(data, conference.id, games) };
  }).sort((a,b) => (b.row[selected] ?? -Infinity) - (a.row[selected] ?? -Infinity) ||
    (b.row.experimentalScore ?? -Infinity) - (a.row.experimentalScore ?? -Infinity) || a.conference.name.localeCompare(b.conference.name));
  return `<section class="panel"><div class="panel-head"><h3>Opponent-adjusted conference results</h3><span class="tag">Experimental</span></div>
    <div class="panel-body"><p class="compact-note">Compare the quality-adjusted score with the raw record for the same games. Expand a conference for ranked wins, opponent records, and the quality of its wins and losses.</p></div>
    ${conferences.some(entry => entry.row.games) ? `<div class="conference-quality-list">${conferences.map(({ conference, row }, index) =>
      `<details data-conference-expansion="${escapeHtml(conference.id)}"><summary class="conference-quality-row">
        <span class="conference-quality-name">${Number.isFinite(row[selected]) ? '<span class="conference-quality-position">'+(index+1)+'</span> ' : ''}${escapeHtml(conference.name)}<small>${row.ratedGames} of ${row.games} games rated${row.smallSample ? ' · Small sample' : ''}</small></span>
        <span><small>Exp. score</small><b>${number(row.experimentalScore)}</b></span>
        <span><small>FBS record</small><b>${record(row)}</b></span>
        <span><small>Opp. strength</small><b>${number(row.averageOpponentPredictiveRating)}</b></span>
        <span><small>Top 25 wins</small><b>${rankedCount(row.currentTop25Wins, row.currentRankCoverage)}</b></span>
      </summary>${qualityDetails(row,data.archived)}</details>`).join('')}</div>` :
      `<p class="conference-empty" role="status">${emptyGames(data,state)}</p>`}
    ${qualityMethod()}</section>`;
}

function rankLabel(value, available, method, status) {
  if (Number.isInteger(value) && value > 0) return '#' + value;
  if (available && ['ap', 'cfp'].includes(method)) return 'Unranked';
  return ({ 'no-poll-yet': 'Not yet released', 'publication-time-uncertain': 'Release time unverified',
    'not-applicable': 'Not applicable', missing: 'Not reported' })[status] ?? '—';
}

function gameTeam(team, rank, points, venue, status, state) {
  const link = team.id && ['fbs','fcs'].includes(team.division) && !state.archived && state.season === state.seasons[0] ?
    `<a href="#team/${encodeURIComponent(team.id)}">${escapeHtml(team.name)}</a>` : escapeHtml(team.name);
  return `<div class="conference-game-team"><h4>${link} <span>${points}</span></h4>
    <p>${escapeHtml(team.conference || team.division?.toUpperCase() || 'Conference unavailable')} · ${venue} · ${status}</p>
    <dl class="conference-stats">
      ${stat('Overall record', record(team))}
      ${team.conferenceRecord ? stat('Vs. own conference',record(team.conferenceRecord)) : ''}
      ${stat('Snapshot rank', rankLabel(rank.current, rank.currentAvailable, state.method))}
      ${stat('Pregame rank', rankLabel(rank.pregame, rank.pregameAvailable, state.method, rank.pregameStatus))}
      ${stat('Pred. strength', Number.isFinite(team.strength) ? number(team.strength, 2) + ' pts' : '—')}
      ${stat('SOR rank', rankLabel(team.ranks?.sor, false, 'sor'))}
      ${stat('SOS rank', rankLabel(team.sosRank, false, 'sor'))}
      ${stat('SOS rating', number(team.sos,3))}
    </dl></div>`;
}

function gameDetails(row, state) {
  const { team, opponent, result, startDate, venue, teamPoints, opponentPoints } = row;
  const otherVenue = venue === 'neutral' ? 'neutral' : venue === 'home' ? 'away' : 'home';
  const winner = result === 'win' ? team : opponent;
  const loser = result === 'win' ? opponent : team;
  const margin = result === 'tie' ? 'Tie' : Math.abs(row.margin) + '-point margin';
  const rankDate = row.rank.pregameAsOf ?? row.opponentRank.pregameAsOf;
  return `<details class="conference-game" data-conference-expansion="${escapeHtml(row.id)}"><summary>
      <span class="conference-result is-${result}" title="${escapeHtml(team.name)} ${result}">${result === 'win' ? 'W' : result === 'loss' ? 'L' : 'T'}</span>
      <span class="conference-game-names"><strong>${result === 'tie' ? escapeHtml(team.name)+' tied '+escapeHtml(opponent.name) :
        escapeHtml(winner.name)+' defeated '+escapeHtml(loser.name)}</strong>
      <small>${date(startDate)} · ${venue === 'neutral' ? 'Neutral site' : escapeHtml(team.name)+' '+venue} · ${margin}</small></span>
      <b class="conference-game-score">${result === 'loss' ? opponentPoints+'–'+teamPoints : teamPoints+'–'+opponentPoints}</b>
    </summary><div class="conference-game-content">
      <div class="conference-game-teams">
        ${gameTeam(team,row.rank,teamPoints,venue,result === 'tie' ? 'Tie' : result === 'win' ? 'Winner' : 'Loser',state)}
        ${gameTeam(opponent,row.opponentRank,opponentPoints,otherVenue,result === 'tie' ? 'Tie' : result === 'win' ? 'Loser' : 'Winner',state)}
      </div>
      ${rankDate ? `<p class="compact-note">Pregame edition · ${date(rankDate)}</p>` :
        `<p class="compact-note">${row.rank.pregameStatus === 'no-poll-yet' ? 'This game preceded the first poll release; no pregame poll existed.' : row.rank.pregameStatus === 'publication-time-uncertain' ? 'The release time cannot be verified as preceding this kickoff.' : 'A dated pregame ranking is unavailable for this method and game.'}</p>`}
      ${team.division === 'fbs' && opponent.division === 'fbs' && state.season === state.seasons[0] ? `<p class="compact-note"><a href="#sor-compare/fbs/${encodeURIComponent(team.id)}/${encodeURIComponent(opponent.id)}">Compare these teams’ earned SOR rankings</a></p>` : ''}
      ${Number.isFinite(row.qualityScore) ? `<p class="compact-note">${escapeHtml(team.name)} game quality · ${number(row.qualityScore,3)}</p>` : ''}
    </div></details>`;
}

function compareView(data, state) {
  const { a, b } = state;
  const options = { ...state, conferenceA: a, conferenceB: b === 'FCS' ? undefined : b,
    opponents: b === 'FCS' ? 'fcs' : state.opponents, rankScope: b === 'FCS' ? 'all' : state.rankScope };
  const unfiltered = { ...options, opponents: b === 'FCS' ? 'fcs' : 'all', rankScope: 'all', result: 'all' };
  const games = conferenceGames(data, options);
  const pair = conferenceSummary(data,a,conferenceGames(data,unfiltered));
  const labelA = escapeHtml(conferenceName(data,a));
  const labelB = escapeHtml(conferenceName(data,b));
  const pairScope = b === 'FCS' ? 'FBS vs. FCS' : 'FBS interconference';
  const pregame = state.rankScope === 'pregame';
  const rankedWins = pregame ? pair.pregameTop25Wins : pair.currentTop25Wins;
  const rankTiming = pregame ? 'pregame' : data.archived ? 'season-end' : 'current';
  return `<section class="panel conference-pair">
    <div class="panel-head"><div><h3>${labelA} vs. ${labelB}</h3><p class="compact-note">${data.season} · ${pairScope} · ${pair.games} completed ${pair.games === 1 ? 'game' : 'games'}</p></div></div>
    <dl class="conference-pair-score">
      ${stat(labelA+' wins',pair.wins)}${stat(labelB+' wins',pair.losses)}${pair.ties ? stat('Ties',pair.ties) : ''}
      ${stat(labelA+' avg. win margin',number(pair.averageVictoryMargin))}${stat(labelB+' avg. win margin',number(pair.averageDefeatMargin))}
      ${Number.isInteger(rankedWins) ? stat(labelA+' wins vs. '+rankTiming+' Top 25',rankedWins) : ''}
    </dl>
    </section>
    <section class="panel"><div class="panel-head"><h3>Game results</h3><span class="tag">${games.length} shown</span></div>
      ${games.length ? `<div class="panel-body"><p class="compact-note">Win and loss markers are from ${labelA}’s perspective.</p></div>` : ''}
      ${games.length ? `<div class="conference-games">${games.map(row => gameDetails(row,{ ...state, archived:data.archived })).join('')}</div>` :
      `<p class="conference-empty" role="status">${emptyGames(data,state)}</p>`}</section>`;
}

function display(container, state, content) {
  container.innerHTML = `<div class="conference-strength">${header(state)}${content}</div>`;
}

export function conferenceStrengthMarkup(data, state) {
  const body = state.view === 'compare' ? compareView(data,state) :
    state.view === 'quality' ? qualityView(data,state) : recordsView(data,state);
  return `<div class="conference-strength">${header(state)}${state.view === 'records' ? '' : controls(data,state)}${body}</div>`;
}

function read(url) {
  if (!requests.has(url)) {
    requests.set(url, fetch(url).then(response => {
      if (!response.ok) throw new Error('Conference data returned ' + response.status);
      return response.json();
    }).catch(error => { requests.delete(url); throw error; }));
  }
  return requests.get(url);
}

export function mountConferenceStrength(container, { view = 'records', season, a, b, dataRoot = '/data', onNavigate } = {}) {
  const state = { view: views.some(([key]) => key === view) ? view : 'records', season };
  let active = true;
  let data;
  const navigate = next => onNavigate ? onNavigate(next) : window.location.assign(route(next));
  function render(focusedId) {
    if (!active || !container.isConnected) return;
    const expanded = new Set([...container.querySelectorAll('[data-conference-expansion][open]')]
      .map(detail => detail.dataset.conferenceExpansion));
    container.innerHTML = conferenceStrengthMarkup(data,state);
    for (const detail of container.querySelectorAll('[data-conference-expansion]')) {
      if (expanded.has(detail.dataset.conferenceExpansion)) detail.open = true;
    }
    if (focusedId) container.querySelector('#' + focusedId)?.focus({ preventScroll: true });
  }
  async function load() {
    container.setAttribute('aria-busy','true');
    display(container,state,'<section class="panel panel-body"><p role="status">Loading conference comparisons…</p></section>');
    try {
      const root = dataRoot.replace(/\/$/, '') + '/conferences';
      const manifest = await read(root + '/index.json');
      if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.seasons) || !manifest.seasons.every(Number.isInteger)) {
        throw new Error('Conference season index is invalid');
      }
      const seasons = [...manifest.seasons].sort((x,y) => y - x);
      if (!seasons.length) throw new Error('No seasons are available');
      const wanted = Number(season);
      state.season = seasons.includes(wanted) ? wanted : seasons[0];
      state.seasons = seasons;
      data = await read(root + '/' + state.season + '.json');
      if (data.schemaVersion !== 1 || data.season !== state.season || !Array.isArray(data.games) ||
          !data.teams || !Array.isArray(data.conferences) || data.conferences.length < 2) {
        throw new Error('Conference dataset is invalid');
      }
      if (!active || !container.isConnected) return;
      const ids = data.conferences.map(item => item.id);
      const preferred = preferences.get(state.season) ?? {};
      const wantedA = a || preferred.a;
      const wantedB = b || preferred.b;
      state.a = ids.includes(wantedA) ? wantedA : ids.includes('SEC') ? 'SEC' : ids[0];
      state.b = wantedB === 'FCS' || ids.includes(wantedB) && wantedB !== state.a ? wantedB :
        ids.includes('Big Ten') && state.a !== 'Big Ten' ? 'Big Ten' : ids.find(id => id !== state.a);
      preferences.set(state.season, { ...preferred, a:state.a, b:state.b });
      const firstAvailable = methods.find(([id]) => data.rankings?.[id]?.available)?.[0] ?? 'sor';
      Object.assign(state, { opponents:'all',rankScope:'all',result:'all',sort:'newest',qualitySort:'score' },
        Object.fromEntries(Object.entries(preferred).filter(([key]) => !['a','b'].includes(key))));
      state.method = data.rankings?.[preferred.method]?.available ? preferred.method : firstAvailable;
      render(focusOnLoad);
      focusOnLoad = undefined;
    } catch (error) {
      if (!active || !container.isConnected) return;
      console.error(error);
      display(container,state,'<section class="panel panel-body"><p role="status">Conference data is unavailable.</p><button type="button" class="button light small" data-conference-retry>Try again</button></section>');
    } finally {
      if (active && container.isConnected) container.removeAttribute('aria-busy');
    }
  }
  function change(event) {
    const field = event.target.dataset.conferenceField;
    if (!field) return;
    const value = event.target.value;
    if (['season','a','b'].includes(field)) {
      focusOnLoad = event.target.id;
      if (field !== 'season') preferences.set(state.season, { ...preferences.get(state.season), [field]:value });
      navigate({ view:state.view,season:state.season,a:state.a,b:state.b,[field]:value });
      return;
    }
    state[field] = value;
    preferences.set(state.season,{ ...preferences.get(state.season),[field]:value });
    render(event.target.id);
  }
  function click(event) {
    if (event.target.closest('[data-conference-swap]')) navigate({ view:'compare',season:state.season,a:state.b,b:state.a });
    if (event.target.closest('[data-conference-retry]')) void load();
    if (event.target.closest('[data-conference-pair-link]')) {
      preferences.set(state.season,{ ...preferences.get(state.season),opponents:'all',rankScope:'all',result:'all' });
    }
  }
  container.addEventListener('change',change);
  container.addEventListener('click',click);
  void load();
  return () => {
    active = false;
    container.removeEventListener('change',change);
    container.removeEventListener('click',click);
  };
}
