const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const numericRank = rank => Number.isInteger(rank) && rank > 0;
const rankLabel = rank => numericRank(rank) ? `#${rank}` : 'Unranked';
const editionKey = edition => `${edition.seasonType}:${edition.week}`;
const editionLabel = edition => `${edition.seasonType === 'postseason' ? 'Postseason week' : 'After Week'} ${edition.week}`;
const score = value => Number.isFinite(value) ? value.toFixed(4) : '—';
const signed = value => `${value > 0 ? '+' : ''}${value.toFixed(4)}`;
let cleanup;

export function compareRankingHistory(data, selectedWeek) {
  if (data?.schemaVersion !== 1 || !Number.isInteger(data.season) || !Array.isArray(data.editions)) {
    throw new Error('Ranking history has an invalid format');
  }
  const editions = [...data.editions].sort((left, right) => left.gamesThrough.localeCompare(right.gamesThrough) || left.asOf.localeCompare(right.asOf));
  for (const edition of editions) {
    if (!Number.isInteger(edition.week) || !Array.isArray(edition.rows) ||
        new Set(edition.rows.map(row => row.id)).size !== edition.rows.length ||
        edition.rows.some(row => typeof row.id !== 'string' || typeof row.team !== 'string' ||
          !(row.rank === null || numericRank(row.rank)))) {
      throw new Error('Ranking history has invalid team identities or ranks');
    }
  }
  const current = editions.find(edition => editionKey(edition) === String(selectedWeek) ||
    edition.seasonType === 'regular' && String(edition.week) === String(selectedWeek)) ?? editions.at(-1);
  if (!current) return { editions, current: null, previous: null, rows: [], arrivals: [], departures: [], risers: [], fallers: [] };
  const previous = editions.slice(0, editions.indexOf(current)).filter(edition => edition.complete !== false &&
    edition.modelId === current.modelId).at(-1) ?? null;
  const oldRows = new Map(previous?.rows.map(row => [row.id, row]) ?? []);
  const rows = current.rows.map(row => {
    const old = oldRows.get(row.id);
    return { ...row, previousRank: old?.rank ?? null,
      movement: numericRank(old?.rank) && numericRank(row.rank) ? old.rank - row.rank : null,
      scoreChange: Number.isFinite(old?.sor) && Number.isFinite(row.sor) ? row.sor - old.sor : null };
  }).sort((left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity) || left.team.localeCompare(right.team));
  const currentIds = new Set(rows.filter(row => numericRank(row.rank) && row.rank <= 25).map(row => row.id));
  const previousIds = new Set((previous?.rows ?? []).filter(row => numericRank(row.rank) && row.rank <= 25).map(row => row.id));
  const relevant = rows.filter(row => currentIds.has(row.id) || previousIds.has(row.id));
  return { editions, current, previous, rows,
    arrivals: previous ? rows.filter(row => currentIds.has(row.id) && !previousIds.has(row.id)) : [],
    departures: previous ? rows.filter(row => previousIds.has(row.id) && !currentIds.has(row.id)) : [],
    risers: relevant.filter(row => row.movement > 0).sort((left, right) => right.movement - left.movement).slice(0, 5),
    fallers: relevant.filter(row => row.movement < 0).sort((left, right) => left.movement - right.movement).slice(0, 5) };
}

function movementLabel(row) {
  if (row.movement === null) return '—';
  if (row.movement === 0) return 'Same';
  return `${row.movement > 0 ? '↑' : '↓'} ${Math.abs(row.movement)}`;
}

function evidence(row) {
  const games = row.weekGames ?? [];
  if (!games.length) return 'Opponent results throughout the schedule can also change SOR.';
  return games.map(game => {
    const opponent = `${numericRank(game.opponentRank) ? `#${game.opponentRank} ` : ''}${game.opponentName ?? game.opponentId}`;
    const result = game.result === 'W' ? 'Beat' : game.result === 'L' ? 'Lost to' : 'Played';
    const margin = Number.isFinite(game.margin) ? ` by ${Math.abs(game.margin)}` : '';
    return `${result} ${opponent}${margin}.`;
  }).join(' ');
}

function teamName(row) {
  return `<a href="#team/${encodeURIComponent(row.id)}">${escapeHtml(row.team)}</a>`;
}

function movementCard(title, rows, emptyText) {
  return `<section class="panel history-card"><h2>${title}</h2>${rows.length ?
    `<ul class="history-movers">${rows.map(row => `<li><div><strong>${teamName(row)}</strong><span class="history-move ${row.movement > 0 ? 'up' : row.movement < 0 ? 'down' : ''}">${movementLabel(row)}</span></div><p class="history-positions">${rankLabel(row.previousRank)} → ${rankLabel(row.rank)}</p><p>${escapeHtml(evidence(row))}</p></li>`).join('')}</ul>` :
    `<p class="compact-note">${emptyText}</p>`}</section>`;
}

export function rankingHistoryMarkup(comparison, search = '') {
  const { editions, current, previous, rows, arrivals, departures, risers, fallers } = comparison;
  if (!current) return '<div class="wrap page-content"><section class="panel history-card"><h2>Weekly SOR history</h2><p>The first saved weekly edition will appear after publication.</p></section></div>';
  const date = value => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(value));
  const replay = current.kind === 'replay';
  const previousLabel = previous ? `${editionLabel(previous)}${previous.kind === 'replay' ? ' replay' : ''}` : '';
  const filtered = rows.filter(row => row.team.toLowerCase().includes(search.toLowerCase()));
  const membership = (title, members, text) => `<section class="panel history-card"><h2>${title}</h2>${members.length ? `<ul class="history-members">${members.map(row => `<li>${teamName(row)}<span>${rankLabel(row.previousRank)} → ${rankLabel(row.rank)}</span></li>`).join('')}</ul>` : `<p class="compact-note">${text}</p>`}</section>`;
  return `<section class="hero page-banner"><div class="wrap"><div class="eyebrow">${String(current.gamesThrough).slice(0, 4)} · Weekly SOR</div><h1>WHAT CHANGED?</h1><p>Follow the rankings, the teams entering the Top 25, and the game results behind each week.</p></div></section>
    <div class="wrap page-content history-page">
      <section class="panel history-card history-toolbar"><label for="history-week">View edition</label><select id="history-week">${[...editions].reverse().map(edition => `<option value="${editionKey(edition)}" ${editionKey(edition) === editionKey(current) ? 'selected' : ''}>${editionLabel(edition)}${edition.kind === 'replay' ? ' · replay' : ''}${edition.complete === false ? ' · partial' : ''}</option>`).join('')}</select><a class="text-link" href="#rankings">Current rankings →</a></section>
      <div class="history-context"><h2>${editionLabel(current)}</h2><p>Games through ${date(current.gamesThrough)}. ${replay ? 'Historical replay calculated' : 'Snapshot saved'} ${date(current.released ?? current.asOf)}.</p>
        ${previous ? `<p>Movement compared with ${escapeHtml(previousLabel)}. ${previous.kind === 'replay' ? 'The comparison week was reconstructed from its historical game cutoff. SOR score changes become available between saved editions.' : ''}</p>` : '<p>This is the first available edition for this calculation method.</p>'}
        ${current.complete === false ? '<p class="history-alert">This week is still awaiting final results. Movement is provisional.</p>' : ''}
      </div>
      ${previous ? `<div class="history-grid">${movementCard('Moving up', risers, 'No Top 25 teams moved up in this comparison.')}${movementCard('Moving down', fallers, 'No Top 25 teams moved down in this comparison.')}${membership('Entering the Top 25', arrivals, 'The Top 25 has no new arrivals.')}${membership('Leaving the Top 25', departures, 'Every team from the previous Top 25 remains in it.')}</div>` : ''}
      <section class="panel"><div class="panel-head"><div class="panel-head-title"><h2>All ${rows.length} FBS teams</h2></div></div><div class="panel-body history-search"><label for="history-search">Find a team</label><input id="history-search" type="search" placeholder="Search teams" value="${escapeHtml(search)}"></div>
        <div class="table-scroll"><table class="history-table"><caption class="sr-only">${editionLabel(current)} Strength of Record history</caption><thead><tr><th>Rank</th><th>Team</th><th>Record</th><th>Move</th><th>SOR</th><th class="history-score-change">SOR change</th></tr></thead><tbody>${filtered.map(row => `<tr><td class="table-rank">${row.rank ?? '—'}</td><td>${teamName(row)}</td><td>${escapeHtml(row.record ?? `${row.wins}–${row.losses}`)}</td><td><span class="history-move ${row.movement > 0 ? 'up' : row.movement < 0 ? 'down' : ''}">${movementLabel(row)}</span></td><td>${score(row.sor)}</td><td class="history-score-change">${Number.isFinite(row.scoreChange) ? signed(row.scoreChange) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <div class="panel-body"><p class="compact-note">Game results and changes across the opponent network both affect SOR. Scores use the formula published in our <a href="#methodology">methodology</a>.</p></div>
      </section>
    </div>`;
}

export function unmountRankingHistory() {
  cleanup?.();
  cleanup = undefined;
}

export async function renderRankingHistory(container, { url = '/ranking-history.json', week } = {}) {
  unmountRankingHistory();
  let active = true;
  let selectedWeek = week;
  let search = '';
  cleanup = () => { active = false; };
  container.innerHTML = '<div class="wrap page-content"><p role="status">Loading weekly SOR history…</p></div>';
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Ranking history returned ${response.status}`);
    const data = await response.json();
    const draw = () => {
      if (!active) return;
      container.innerHTML = rankingHistoryMarkup(compareRankingHistory(data, selectedWeek), search);
      container.querySelector('#history-week')?.addEventListener('change', event => {
        selectedWeek = event.target.value;
        search = '';
        draw();
      });
      container.querySelector('#history-search')?.addEventListener('input', event => {
        search = event.target.value;
        const position = event.target.selectionStart;
        draw();
        const input = container.querySelector('#history-search');
        input?.focus();
        if (typeof input?.setSelectionRange === 'function') input.setSelectionRange(position, position);
      });
    };
    draw();
  } catch (error) {
    if (active) container.innerHTML = '<div class="wrap page-content"><section class="panel history-card"><h2>Weekly history is unavailable</h2><p>Please reload this page to try again.</p><a class="text-link" href="#rankings">View current rankings →</a></section></div>';
    console.error(error);
  }
}
