import { myTeamColors } from './my-team-colors.js?v=2026';

const missing = 'Not reported';
const mountain = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const dates = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' });
const counts = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const cache = new Map();
const groups = {
  passing: ['attempts', 'completions', 'yards', 'touchdowns', 'interceptions'],
  rushing: ['attempts', 'yards', 'touchdowns'],
  receiving: ['receptions', 'yards', 'touchdowns'],
};
const leaders = [['passing', 'Leading passer'], ['rushing', 'Leading rusher'], ['receiving', 'Leading receiver']];

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeText = value => (typeof value === 'string' && value.trim() ? escape(value) : missing);
const count = value => Number.isFinite(value) ? counts.format(value) : missing;
const heading = key => key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
const playerRoute = (team, view = 'players') => `#team/${encodeURIComponent(team.id)}/${view}`;
const color = team => myTeamColors[team.id] || '#27bddf';
const isQb = player => /^(qb|quarterback)$/i.test(String(player.position).trim());
const logsOf = player => Array.isArray(player.gameLogs) ? player.gameLogs : [];
const epoch = value => typeof value === 'string' ? Date.parse(value) : NaN;
const byDate = (a, b) => (epoch(b.date) || 0) - (epoch(a.date) || 0) || (b.week ?? -1) - (a.week ?? -1);

function timestamp(value, format = mountain) {
  const time = epoch(value);
  return Number.isFinite(time) ? `<time datetime="${escape(value)}">${format.format(time)}</time>` : missing;
}

export function fetchPlayerData(kind, team, season, url) {
  const key = `${kind}:${season}:${team.id}:${url}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.request;
  const entry = { expires: Date.now() + (kind === 'team-availability' ? 60_000 : 300_000) };
  entry.request = fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-cache' }).then(async response => {
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.schemaVersion !== 1 || body.season !== season || body.teamId !== team.id) return null;
    if (kind === 'team-players') {
      if (!Array.isArray(body.players)) return null;
      const seen = new Set();
      for (const player of body.players) {
        if (typeof player?.id !== 'string' || !player.id || seen.has(player.id) || typeof player.name !== 'string' || !player.name.trim()) return null;
        seen.add(player.id);
      }
    } else if (!Array.isArray(body.reports) || body.reports.some(report => !report || !Array.isArray(report.players))) return null;
    return body;
  }).catch(() => null).then(data => {
    if (!data && cache.get(key) === entry) cache.delete(key);
    return data;
  });
  cache.set(key, entry);
  return entry.request;
}

export function teamLeaders(players) {
  return leaders.map(([category, label]) => {
    const player = players.filter(row => Number.isFinite(row.stats?.[category]?.yards))
      .sort((a, b) => b.stats[category].yards - a.stats[category].yards || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0];
    return { category, label, player, yards: player?.stats[category].yards };
  });
}

export function quarterbackUsage(players) {
  const games = new Map();
  for (const player of players) {
    for (const log of logsOf(player)) {
      const attempts = log?.stats?.passing?.attempts;
      if (!Number.isInteger(attempts) || attempts <= 0 || typeof log.gameId !== 'string' || !log.gameId) continue;
      if (!games.has(log.gameId)) games.set(log.gameId, { ...log, passers: new Map() });
      const game = games.get(log.gameId);
      if (!game.passers.has(player.id)) game.passers.set(player.id, { id: player.id, name: player.name, attempts });
    }
  }
  return [...games.values()].sort(byDate).slice(0, 5).map(game => {
    const passers = [...game.passers.values()].sort((a, b) => b.attempts - a.attempts || a.name.localeCompare(b.name));
    return { ...game, passers, total: passers.reduce((total, passer) => total + passer.attempts, 0) };
  });
}

export function applicableReports(availability, opponentId) {
  const available = (availability?.reports ?? []).filter(report => report?.players &&
    (opponentId === undefined || report.opponentId === opponentId));
  const now = Date.now();
  return available.sort((a, b) => {
    const startA = epoch(a.kickoff);
    const startB = epoch(b.kickoff);
    const upcomingA = startA >= now;
    const upcomingB = startB >= now;
    if (upcomingA !== upcomingB) return upcomingA ? -1 : 1;
    const soonest = upcomingA ? startA - startB : (startB || 0) - (startA || 0);
    return soonest || (epoch(b.reportAt ?? b.checkedAt) || 0) - (epoch(a.reportAt ?? a.checkedAt) || 0);
  });
}

function sourceMarkup(report) {
  const name = safeText(report.source);
  try {
    const url = new URL(report.sourceUrl);
    if (url.protocol === 'https:' && !url.username && !url.password) {
      return `<a class="text-link" href="${escape(url.href)}" target="_blank" rel="noopener">${name}</a>`;
    }
  } catch {}
  return name;
}

function reportTitle(report) {
  return typeof report.opponentName === 'string' && report.opponentName.trim() ? `vs. ${escape(report.opponentName)}` : 'Opponent not reported';
}

function reportTime(report) {
  if (Number.isFinite(epoch(report.reportAt))) return `Report ${timestamp(report.reportAt)}`;
  if (Number.isFinite(epoch(report.checkedAt))) return `Checked ${timestamp(report.checkedAt)} · Report time not reported`;
  return 'Report time not reported';
}

function reportMeta(report) {
  return `${reportTitle(report)} · ${timestamp(report.kickoff)} · ${reportTime(report)} · ${sourceMarkup(report)}`;
}

function availabilityStatus(status) {
  const value = safeText(status);
  const tone = typeof status === 'string' ? /^out\b/i.test(status) ? 'out' : /^available$/i.test(status) ? 'available' : 'uncertain' : 'missing';
  return `<span class="player-status player-status-${tone}">${value}</span>`;
}

function statusFor(report, player) {
  const matched = report?.players.filter(row => row?.playerId === player.id) ?? [];
  return matched.length === 1 ? matched[0].status : null;
}

function statsGroups(stats = {}) {
  return Object.entries(stats ?? {}).flatMap(([category, values]) => {
    if (!values || Array.isArray(values) || typeof values !== 'object') return [];
    const standard = Object.hasOwn(groups, category) ? groups[category] : [];
    const extras = Object.keys(values).filter(key => !standard.includes(key) && Number.isFinite(values[key]));
    const fields = [...standard, ...extras];
    return fields.some(key => Number.isFinite(values[key])) ? [{ category, values, fields }] : [];
  });
}

function statsMarkup(stats) {
  const sections = statsGroups(stats);
  if (!sections.length) return `<p class="compact-note">${missing}</p>`;
  return `<div class="players-stat-groups">${sections.map(({ category, values, fields }) => `<section><h4>${escape(heading(category))}</h4><dl class="players-stat-values">
    ${fields.map(key => `<div><dt>${escape(heading(key))}</dt><dd>${count(values[key])}</dd></div>`).join('')}
  </dl></section>`).join('')}</div>`;
}

function groupSummary(stats) {
  const parts = statsGroups(stats).map(({ category, values, fields }) => {
    const reported = fields.filter(key => Number.isFinite(values[key]));
    return `${escape(heading(category))} · ${reported.map(key => `${count(values[key])} ${escape(heading(key).toLowerCase())}`).join(', ')}`;
  });
  return parts.length ? `<ul class="player-log-stats">${parts.map(text => `<li>${text}</li>`).join('')}</ul>` : `<p class="compact-note">${missing}</p>`;
}

function gameLogs(player) {
  const games = logsOf(player).filter(Boolean).sort(byDate).slice(0, 5);
  return games.length ? `<ul class="players-game-logs">${games.map(log => `<li><strong>${reportTitle(log)}</strong>
    <small>${timestamp(log.date, dates)}${Number.isInteger(log.week) ? ` · Week ${log.week}` : ''}</small>${groupSummary(log.stats)}</li>`).join('')}</ul>` : `<p class="compact-note">${missing}</p>`;
}

function heightText(value) {
  return Number.isFinite(value) && value > 0 ? `${Math.floor(value / 12)}′ ${count(value % 12)}″` : missing;
}

function weightText(value) {
  return Number.isFinite(value) && value > 0 ? `${count(value)} lb` : missing;
}

function ratingGroup(rating, team) {
  const division = rating?.division ?? team.division;
  return division === 'fcs' ? 'FCS comparison group' : division === 'fbs' ? 'FBS comparison group' : 'Comparison group not reported';
}

function ratingMethodology(formula, model, components) {
  if (typeof formula !== 'string' || !formula) return '';
  const terms = Object.entries(model?.terms ?? {}).filter(([, description]) => typeof description === 'string');
  const inputs = [['A', 'attempts'], ['Y', 'yards'], ['TD', 'touchdowns'], ['INT', 'interceptions'], ['D', 'defenseAdjustment'], ['L', 'referenceRate']]
    .filter(([, field]) => Number.isFinite(components?.[field]));
  return `<details class="player-rating-method"><summary>View the formula</summary><p class="formula-display">${escape(formula)}</p>
    ${typeof model?.scale === 'string' ? `<p>${escape(model.scale)}</p>` : ''}
    ${typeof model?.explanation === 'string' ? `<p>${escape(model.explanation)}</p>` : ''}
    ${terms.length ? `<dl class="players-formula-terms">${terms.map(([term, description]) => `<div><dt>${escape(term)}</dt><dd>${escape(description)}</dd></div>`).join('')}</dl>` : ''}
    ${typeof model?.opponentFormula === 'string' ? `<p>${escape(model.opponentFormula)}</p>` : ''}
    ${inputs.length ? `<p><strong>Inputs</strong> ${inputs.map(([label, field]) => `${label} = ${escape(components[field])}`).join(' · ')}</p>` : ''}
    ${typeof model?.limitation === 'string' ? `<p>${escape(model.limitation)}</p>` : ''}</details>`;
}

function ratingMarkup(player, team, model) {
  const rating = player.qbRating;
  if (!isQb(player) && !rating) return '';
  const explanation = rating?.explanation ?? model?.explanation;
  const formula = rating?.formula ?? model?.formula;
  const sample = Number.isInteger(rating?.attempts) ? ` · ${count(rating.attempts)} rated pass attempts` : '';
  return `<section class="player-qb-rating"><div class="player-rating-heading"><div><h3>FBS Intelligence QB Rating</h3>
    <small>${ratingGroup(rating, team)}${sample}</small></div><span class="player-status">Experimental</span></div>
    <strong class="player-rating-number">${Number.isFinite(rating?.rating) ? rating.rating.toFixed(1) : missing}</strong>
    ${rating?.sampleStatus === 'small-sample' ? '<p class="compact-note">Small sample · provisional</p>' : ''}
    ${typeof explanation === 'string' && explanation ? `<p>${escape(explanation)}</p>` : ''}
    ${ratingMethodology(formula, model, rating?.components)}</section>`;
}

function playerDetail(player, team, report, model) {
  return `<div class="player-detail-body"><dl class="players-stat-values player-bio">
    <div><dt>Height</dt><dd>${heightText(player.height)}</dd></div><div><dt>Weight</dt><dd>${weightText(player.weight)}</dd></div>
    <div><dt>Availability</dt><dd>${availabilityStatus(statusFor(report, player))}</dd></div>
    </dl>${report ? `<p class="compact-note player-report-meta">${reportMeta(report)}</p>` : ''}
    ${ratingMarkup(player, team, model)}<section><h3>Season stats</h3>${statsMarkup(player.stats)}</section>
    <section><h3>Recent game logs</h3>${gameLogs(player)}</section></div>`;
}

function leaderCards(players) {
  return `<div class="player-leader-grid">${teamLeaders(players).map(({ category, label, player, yards }) => `<div class="player-leader">
    <span>${label}</span>${player ? `<button type="button" class="text-link" data-player-jump="${escape(player.id)}">${escape(player.name)}</button>
    <small>${count(yards)} ${category} yards</small>` : `<strong>${missing}</strong>`}</div>`).join('')}</div>`;
}

function qbWorkload(players) {
  const games = quarterbackUsage(players);
  return `<details class="player-fold panel"><summary>Recent quarterback usage</summary><div class="panel-body">
    ${games.length ? `<p class="compact-note">Last ${games.length} games with reported passing attempts.</p><ul class="player-qb-usage">${games.map(game => `<li>
      <div class="player-usage-heading"><strong>${reportTitle(game)}</strong><small>${timestamp(game.date, dates)} · ${count(game.total)} recorded attempts</small></div>
      <ul>${game.passers.map(passer => `<li><span>${escape(passer.name)}</span><progress aria-label="${escape(passer.name)}’s share of recorded attempts" max="${game.total}" value="${passer.attempts}"></progress>
      <strong>${count(passer.attempts)} att</strong></li>`).join('')}</ul></li>`).join('')}</ul>` : `<p class="compact-note">${missing}</p>`}</div></details>`;
}

function rosterMarkup(players, report) {
  return players.length ? players.map(player => `<details class="player-roster-row" data-player-id="${escape(player.id)}">
    <summary><span class="player-jersey">${Number.isInteger(player.jersey) && player.jersey >= 0 ? `#${player.jersey}` : missing}</span>
    <strong>${escape(player.name)}</strong><span class="player-position">${safeText(player.position)}</span>
    ${statusFor(report, player) ? availabilityStatus(statusFor(report, player)) : ''}</summary></details>`).join('') : '<p class="players-empty">No players match this search.</p>';
}

function reportCard(report, index) {
  return `<details class="player-fold panel"${index === 0 ? ' open' : ''}><summary>
    <strong>${reportTitle(report)}</strong><span>${report.final === true ? 'Game-day report' : 'Availability report'}</span></summary>
    <div class="panel-body"><p class="compact-note">Kickoff ${timestamp(report.kickoff)} · ${reportTime(report)} · ${sourceMarkup(report)}</p>
    ${report.players.filter(Boolean).length ? `<ul class="player-report-list">${report.players.filter(Boolean).map(player => `<li>
      <div><strong>${safeText(player.name)}</strong>${player.position ? `<small>${safeText(player.position)}</small>` : ''}</div>${availabilityStatus(player.status)}</li>`).join('')}</ul>`
      : '<p class="compact-note">No individual status entries were posted in this report.</p>'}</div></details>`;
}

export async function mountTeamPlayerView(root, { team, season, urlFor, view, selectedPlayer }) {
  const availabilityRequest = fetchPlayerData('team-availability', team, season, urlFor('team-availability', team));
  const playersRequest = view === 'players' ? fetchPlayerData('team-players', team, season, urlFor('team-players', team)) : null;
  const [availability, data] = await Promise.all([availabilityRequest, playersRequest]);
  if (!root.isConnected) return;
  root.style.setProperty('--team-player-accent', color(team));
  const reports = applicableReports(availability);
  if (view === 'availability') {
    root.innerHTML = `<div class="stack players-area"><section class="panel players-heading"><div class="panel-body"><h2>Availability</h2>
      <p class="compact-note">${reports.length ? 'Official statuses apply to the game named in each report.' : 'Not reported for this team’s games.'}</p></div></section>
      ${reports.slice(0, 8).map(reportCard).join('')}</div>`;
    return;
  }
  if (!data) {
    root.innerHTML = '<section class="panel players-heading"><div class="panel-body"><h2>Players</h2><p class="compact-note">Roster and player stats · Not reported</p></div></section>';
    return;
  }
  const players = [...data.players].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const report = reports[0];
  const { boxGames, expectedGames } = data.coverage ?? {};
  const coverage = Number.isInteger(boxGames) && Number.isInteger(expectedGames) && expectedGames > 0
    ? ` · Game logs reported for ${count(boxGames)} of ${count(expectedGames)} completed games` : '';
  const labels = [...new Set(players.map(player => player.position).filter(position => typeof position === 'string' && position.trim()))].sort();
  root.innerHTML = `<div class="stack players-area"><section class="panel players-heading"><div class="panel-body">
    <div class="players-heading-line"><h2>Players</h2><a class="text-link" href="${playerRoute(team, 'availability')}">Availability</a></div>
    <p class="compact-note">${season} season · CollegeFootballData snapshot ${timestamp(data.asOf, dates)}${coverage}</p>
    ${leaderCards(players)}</div></section>${qbWorkload(players)}
    <section class="panel players-heading"><div class="panel-head"><h2>Roster</h2><span class="tag" data-player-count>${players.length} players</span></div>
      <div class="panel-body players-roster-body">${players.length ? `<div class="players-filters"><label>Find a player<input type="search" data-player-search placeholder="Name or jersey"></label>
        <label>Position<select data-player-position><option value="">All positions</option><option value="?">Not reported</option>
        ${labels.map(position => `<option value="${escape(position)}">${escape(position)}</option>`).join('')}</select></label></div>
        ${report ? `<p class="compact-note player-roster-report">Listed statuses apply ${reportMeta(report)}.</p>` : ''}
        <div class="player-roster" data-player-list>${rosterMarkup(players, report)}</div>` : `<p class="compact-note">${missing}</p>`}</div></section></div>`;
  const list = root.querySelector('[data-player-list]');
  if (!list) return;
  const search = root.querySelector('[data-player-search]');
  const position = root.querySelector('[data-player-position]');
  const total = root.querySelector('[data-player-count]');
  const byId = new Map(players.map(player => [player.id, player]));
  function filter() {
    const query = search.value.trim().toLowerCase().replace(/^#/, '');
    const visible = players.filter(player => (!position.value || (player.position || '?') === position.value) &&
      (!query || player.name.toLowerCase().includes(query) || (player.jersey != null && String(player.jersey) === query)));
    total.textContent = `${visible.length} of ${players.length}`;
    list.innerHTML = rosterMarkup(visible, report);
  }
  function reveal(id, focus = false) {
    const row = [...list.querySelectorAll('[data-player-id]')].find(item => item.dataset.playerId === id);
    if (!row) return;
    row.open = true;
    if (focus) {
      row.scrollIntoView({ block: 'nearest' });
      row.querySelector('summary').focus({ preventScroll: true });
    }
  }
  search.addEventListener('input', filter);
  position.addEventListener('change', filter);
  list.addEventListener('toggle', event => {
    const row = event.target;
    const player = byId.get(row.dataset?.playerId);
    if (row.open && player && !row.querySelector('.player-detail-body')) row.insertAdjacentHTML('beforeend', playerDetail(player, team, report, data.ratingMethod));
  }, true);
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-player-jump]');
    if (!button || !byId.has(button.dataset.playerJump)) return;
    if (search.value || position.value) { search.value = ''; position.value = ''; filter(); }
    reveal(button.dataset.playerJump, true);
  });
  if (selectedPlayer) reveal(selectedPlayer, true);
}

function matchupTile(team, opponent, data, availability) {
  const players = data?.players ?? [];
  const report = applicableReports(availability, opponent.id).find(row => epoch(row.kickoff) >= Date.now());
  const absences = report?.players.filter(row => row?.name && typeof row.status === 'string' && /^out\b/i.test(row.status));
  // Use the workload leader among roster quarterbacks for the comparison, regardless of missing rating.
  const quarterback = players.filter(player => (isQb(player) || player.qbRating) && Number.isFinite(player.stats?.passing?.attempts))
    .sort((a, b) => b.stats.passing.attempts - a.stats.passing.attempts || a.name.localeCompare(b.name))[0];
  return `<section class="matchup-player-team" style="--team-player-accent:${escape(color(team))}">
    <h3>${escape(team.name)}</h3><ul class="matchup-player-leaders">${teamLeaders(players).map(({ category, label, player, yards }) =>
      `<li><span>${label}</span>${player ? `<a class="text-link" href="${playerRoute(team)}/${encodeURIComponent(player.id)}">${escape(player.name)}</a>
      <small>${count(yards)} ${category} yards</small>` : `<strong>${missing}</strong>`}</li>`).join('')}</ul>
    <div class="matchup-qb-rating">${quarterback ? `<p class="matchup-qb-player"><span>Most recorded QB attempts</span>
      <a class="text-link" href="${playerRoute(team)}/${encodeURIComponent(quarterback.id)}">${escape(quarterback.name)}</a></p>
      ${ratingMarkup(quarterback, team, data?.ratingMethod)}` : `<p class="compact-note">QB rating · ${missing}</p>`}</div>
    <h4>Reported absences</h4>${report ? `<p class="compact-note">${reportMeta(report)}</p>${absences?.length
      ? `<ul class="matchup-player-absences">${absences.map(row => `<li><strong>${safeText(row.name)}</strong>${availabilityStatus(row.status)}</li>`).join('')}</ul>`
      : '<p class="compact-note">No players listed Out in this report.</p>'}` : '<p class="compact-note">Not reported for this matchup.</p>'}
    <div class="player-view-links"><a class="text-link" href="${playerRoute(team)}">Team players</a><a class="text-link" href="${playerRoute(team, 'availability')}">Availability</a></div></section>`;
}

export async function mountMatchupPlayerView(root, { teams, season, urlFor }) {
  const results = await Promise.all(teams.map(team => Promise.all([
    fetchPlayerData('team-players', team, season, urlFor('team-players', team)),
    fetchPlayerData('team-availability', team, season, urlFor('team-availability', team)),
  ])));
  if (!root.isConnected) return;
  root.innerHTML = `<div class="matchup-player-grid">${teams.map((team, i) => matchupTile(team, teams[1 - i], ...results[i])).join('')}</div>`;
}
