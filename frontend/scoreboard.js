const feedUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const sourceUrl = 'https://www.espn.com/college-football/scoreboard/_/group/80';
const pollInterval = 15_000;
const orderStorageKey = 'fbs-scoreboard-order-v1';
const gameDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric',
});
const gameTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const checkTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
});
const sections = [
  ['live', 'Live', 'No games in progress.'],
  ['upcoming', 'Upcoming', 'No upcoming games on this slate.'],
  ['changed', 'Schedule changes', ''],
  ['final', 'Final', 'No final scores yet.'],
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function gameState(type) {
  if (type.state === 'in') return 'live';
  if (type.state === 'pre') return 'upcoming';
  if (type.state === 'post' && (type.completed || type.name?.startsWith('STATUS_FINAL'))) return 'final';
  return 'changed';
}

function readGame(event) {
  const id = String(event?.id);
  if (!/^\d+$/.test(id)) return null;
  const competition = event.competitions?.[0];
  const type = competition?.status?.type ?? event.status?.type;
  const away = competition?.competitors?.find(entry => entry?.homeAway === 'away');
  const home = competition?.competitors?.find(entry => entry?.homeAway === 'home');
  if (!type || !away?.team || !home?.team) return null;
  const state = gameState(type);
  return {
    id, state, start: competition.dateValid === false ? NaN : Date.parse(competition.date || event.date), timeTbd: competition.timeValid === false,
    detail: type.shortDetail || type.description || '',
    situation: state === 'live' ? competition.situation : null,
    networks: [...new Set(competition.broadcasts?.flatMap(broadcast => broadcast.names ?? []) ?? [])].join(' · '),
    teams: [away, home].map(entry => ({
      id: String(entry.team.id ?? entry.id ?? ''),
      name: entry.team.shortDisplayName || entry.team.displayName || entry.team.abbreviation || 'Team',
      record: entry.records?.find(record => record.type === 'total')?.summary,
      abbr: entry.team.abbreviation || '',
      score: entry.score,
    })),
  };
}

function sameSlate(a, b) {
  return a && b && a.year === b.year && a.type === b.type && a.week === b.week;
}

function seasonSlates(data, year) {
  return (data.leagues?.[0]?.calendar ?? [])
    .filter(phase => ['2', '3'].includes(String(phase.value)))
    .flatMap(phase => (phase.entries ?? []).filter(entry => String(entry.value) !== '999').map(entry => ({
      year, type: String(phase.value), week: String(entry.value), label: entry.label, dates: entry.detail,
    })));
}

function readSlate(data) {
  if (!Array.isArray(data.events)) throw new Error('Missing scoreboard events');
  const key = { year: String(data.season?.year), type: String(data.season?.type), week: String(data.week?.number) };
  const calendar = seasonSlates(data, key.year);
  const current = calendar.find(slate => sameSlate(slate, key)) ?? key;
  const games = [...new Map(data.events.map(readGame).filter(Boolean).map(game => [game.id, game])).values()];
  if (data.events.length && !games.length) throw new Error('Missing scoreboard game details');
  const needsPlay = games.some(game => game.state === 'upcoming' || game.state === 'live');
  return { ...current, games, calendar, needsPlay };
}

async function fetchSlate(signal, selection) {
  const query = new URLSearchParams({ groups: '80', limit: '200' });
  if (selection) {
    query.set('dates', selection.year);
    query.set('seasontype', selection.type);
    query.set('week', selection.week);
  }
  const response = await fetch(`${feedUrl}?${query}`, { signal });
  if (!response.ok) throw new Error(`ESPN scoreboard returned ${response.status}`);
  const slate = readSlate(await response.json());
  if (selection && !sameSlate(slate, selection)) throw new Error('ESPN returned a different slate');
  return slate;
}

export async function loadScoreboard(signal, previous) {
  const canSelect = previous && /^\d{4}$/.test(previous.year) && /^[23]$/.test(previous.type) && /^\d+$/.test(previous.week);
  // Keep following the displayed slate if ESPN changes its default week before the last game ends.
  if (canSelect && (previous.needsPlay || nextAfter(previous))) {
    const current = await fetchSlate(signal, previous);
    if (!current.games.length && previous.games.length) throw new Error('The current slate is temporarily empty');
    // Show the last game in Final before advancing on the next refresh.
    if (current.needsPlay || previous.needsPlay) return current;
    return advanceSlate(signal, current);
  }
  return advanceSlate(signal, await fetchSlate(signal));
}

function nextAfter(current) {
  const position = current.calendar.findIndex(slate => sameSlate(slate, current));
  return position < 0 ? undefined : current.calendar[position + 1];
}

async function advanceSlate(signal, current) {
  if (current.needsPlay) return current;
  const next = nextAfter(current);
  if (!next) return current;
  // A new slate replaces the finished one only after ESPN supplies its games.
  try {
    const upcoming = await fetchSlate(signal, next);
    return upcoming.games.length ? upcoming : current;
  } catch {
    return { ...current, nextUnavailable: true };
  }
}

function kickoff(game) {
  if (!Number.isFinite(game.start)) return 'Kickoff TBD';
  const date = gameDate.format(game.start);
  return game.timeTbd ? `${date} · Time TBD` : `${date} · ${gameTime.format(game.start)}`;
}

function teamLine(team, game, leader) {
  const possession = game.situation?.possession != null && String(game.situation.possession) === team.id;
  const hasLogo = /^\d+$/.test(team.id);
  const logo = hasLogo ? `<img src="https://a.espncdn.com/i/teamlogos/ncaa/500/${team.id}.png" alt="" loading="lazy" decoding="async">` : '';
  return `<div class="scoreboard-team${leader ? ' scoreboard-winner' : ''}">
    <span class="logo${hasLogo ? '' : ' failed'}" aria-hidden="true">${logo}<span>${escapeHtml(team.abbr)}</span></span>
    <div class="scoreboard-team-name"><strong>${escapeHtml(team.name)}</strong>${possession ? '<span class="scoreboard-possession" role="img" aria-label="Has possession" title="Has possession">●</span>' : ''}${game.state === 'upcoming' && team.record ? `<small>${escapeHtml(team.record)}</small>` : ''}</div>
    ${game.state === 'live' || game.state === 'final' ? `<strong class="scoreboard-score">${escapeHtml(team.score ?? '—')}</strong>` : ''}
  </div>`;
}

function gameName(game) {
  return game.teams.map(team => team.name).join(' vs. ');
}

function gameDetails(game) {
  const detail = game.state === 'upcoming' ? kickoff(game) : game.detail || sections.find(([id]) => id === game.state)[1];
  const note = game.state === 'live' ? game.situation?.downDistanceText || '' : game.state === 'final' ? kickoff(game) : '';
  return `<div class="scoreboard-game-top"><strong>${escapeHtml(detail)}</strong><small>${escapeHtml(game.networks)}</small></div>
    <div class="scoreboard-teams">${game.teams.map((team, index) => teamLine(team, game, game.state === 'final' && team.score != null && game.teams[1 - index].score != null && Number(team.score) > Number(game.teams[1 - index].score))).join('')}</div>
    <div class="scoreboard-game-bottom"><span>${escapeHtml(note)}</span><a href="https://www.espn.com/college-football/game/_/gameId/${game.id}" target="_blank" rel="noopener">Gamecast<span class="sr-only"> for ${escapeHtml(gameName(game))}</span></a></div>`;
}

function readOrder() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(orderStorageKey));
    if (typeof saved?.slate !== 'string') return null;
    const groups = Object.fromEntries(sections.flatMap(([key]) => {
      const ids = saved.groups?.[key];
      return Array.isArray(ids) ? [[key, ids.filter(id => typeof id === 'string' && /^\d+$/.test(id))]] : [];
    }));
    return { slate: saved.slate, groups };
  } catch {
    return null;
  }
}

function saveOrder(order) {
  try {
    if (Object.keys(order.groups).length) sessionStorage.setItem(orderStorageKey, JSON.stringify(order));
    else sessionStorage.removeItem(orderStorageKey);
  } catch {
    // The current page can still keep the order in memory.
  }
}

function slateId(slate) {
  return `${slate.year}:${slate.type}:${slate.week}`;
}

function sectionGames(slate, key, order) {
  const positions = new Map((order.groups[key] ?? []).map((id, index) => [id, index]));
  return slate.games.filter(game => game.state === key).sort((a, b) => {
    const byPosition = (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity);
    if (byPosition) return byPosition;
    if (key === 'final') return (b.start || 0) - (a.start || 0);
    return (a.start || Infinity) - (b.start || Infinity);
  });
}

function newCard(id) {
  const card = document.createElement('article');
  card.className = 'panel scoreboard-game';
  card.dataset.gameId = id;
  card.innerHTML = `<div class="scoreboard-game-details"></div>
    <div class="scoreboard-game-order" hidden>
      <span class="scoreboard-drag-handle" draggable="true" aria-hidden="true" title="Drag to reorder">⠿</span>
      <label>Position <select></select></label>
    </div>`;
  return card;
}

function updateCard(card, game, index, count, reordering) {
  const name = gameName(game);
  card.dataset.state = game.state;
  if (card.getAttribute('aria-label') !== name) card.setAttribute('aria-label', name);
  const details = card.querySelector('.scoreboard-game-details');
  const markup = gameDetails(game);
  if (details.scoreboardMarkup !== markup) {
    details.innerHTML = markup;
    details.scoreboardMarkup = markup;
  }
  const controls = card.querySelector('.scoreboard-game-order');
  controls.hidden = !reordering || count < 2;
  if (controls.hidden) return;
  const select = controls.querySelector('select');
  select.setAttribute('aria-label', `Position of ${name}`);
  if (select.options.length !== count) {
    select.innerHTML = Array.from({ length: count }, (_, i) => `<option value="${i}">${i + 1}</option>`).join('');
  }
  if (select.value !== String(index)) select.value = String(index);
}

function drawSlate(root, slate, order, reordering, cards) {
  const focused = document.activeElement;
  const focusedCard = focused?.closest('[data-game-id]');
  const focusedControl = focused?.matches('select') ? 'select' : 'a';
  const present = new Set(slate.games.map(game => game.id));
  for (const [id, card] of cards) {
    if (present.has(id)) continue;
    card.remove();
    cards.delete(id);
  }
  const title = root.querySelector('[data-scoreboard-slate]');
  title.textContent = slate.label ? [`${slate.year} ${slate.label}`, slate.dates].filter(Boolean).join(' · ') : 'FBS schedule';
  for (const [key, label, empty] of sections) {
    const section = root.querySelector(`[data-scoreboard-section="${key}"]`);
    const games = sectionGames(slate, key, order);
    section.hidden = key === 'changed' && !games.length;
    const heading = section.querySelector('h2');
    const headingText = `${label} (${games.length})`;
    if (heading.textContent !== headingText) heading.textContent = headingText;
    const content = section.querySelector('[data-scoreboard-games]');
    const placeholder = section.querySelector('.scoreboard-empty');
    placeholder.hidden = games.length > 0;
    placeholder.textContent = empty;
    games.forEach((game, index) => {
      let card = cards.get(game.id);
      if (!card) {
        card = newCard(game.id);
        cards.set(game.id, card);
      }
      updateCard(card, game, index, games.length, reordering);
      if (content.children[index] !== card) content.insertBefore(card, content.children[index] ?? null);
    });
  }
  if (focusedCard && root.contains(focusedCard) && document.activeElement !== focused) {
    const control = focusedCard.querySelector(focusedControl);
    if (control && !control.closest('[hidden]')) control.focus({ preventScroll: true });
  }
}

export function mountScoreboard(root) {
  root.innerHTML = `<div class="scoreboard-toolbar">
    <div><h2 data-scoreboard-slate>FBS schedule</h2><p data-scoreboard-checked>Checking the ESPN feed…</p></div>
    <div class="scoreboard-actions">
      <button class="button light small" type="button" data-scoreboard-refresh>Refresh now</button>
      <button class="button light small" type="button" data-scoreboard-reorder aria-expanded="false" aria-controls="scoreboard-order-help" hidden>Reorder</button>
    </div>
  </div>
  <div id="scoreboard-order-help" class="scoreboard-order-help" hidden>
    <p>Choose a position for a game within its section.<span class="scoreboard-drag-tip"> You can also drag by the handle.</span> Your order is kept in this tab for the current slate.</p>
    <button class="button light small" type="button" data-scoreboard-reset>Reset order</button>
  </div>
  <p class="sr-only" role="status" data-scoreboard-move-status></p>
  <p class="scoreboard-warning" role="status" hidden></p>
  <div class="scoreboard-sections" hidden>${sections.map(([key, label]) => `<section data-scoreboard-section="${key}" aria-labelledby="scoreboard-${key}"><h2 id="scoreboard-${key}">${label}</h2><p class="scoreboard-empty"></p><div class="scoreboard-games" data-scoreboard-games></div></section>`).join('')}</div>
  <p class="scoreboard-source">Scores from <a href="${sourceUrl}" target="_blank" rel="noopener">ESPN</a>. Kickoffs are shown in Mountain Time.</p>`;

  const refresh = root.querySelector('[data-scoreboard-refresh]');
  const reorderButton = root.querySelector('[data-scoreboard-reorder]');
  const reorderHelp = root.querySelector('#scoreboard-order-help');
  const resetButton = root.querySelector('[data-scoreboard-reset]');
  const moveStatus = root.querySelector('[data-scoreboard-move-status]');
  const checked = root.querySelector('[data-scoreboard-checked]');
  const warning = root.querySelector('.scoreboard-warning');
  const sectionList = root.querySelector('.scoreboard-sections');
  const cards = new Map();
  let order = readOrder();
  let reordering = false;
  let dragCard;
  let dropTarget;
  let previous;
  let controller;
  let timer;
  let closed = false;

  function clearDrag() {
    dragCard?.classList.remove('scoreboard-dragging');
    dropTarget?.classList.remove('scoreboard-drop-target');
    dragCard = undefined;
    dropTarget = undefined;
  }

  function renderGames() {
    drawSlate(root, previous, order, reordering, cards);
    resetButton.disabled = !Object.keys(order.groups).length;
  }

  function moveGame(card, to) {
    const group = card.dataset.state;
    const games = sectionGames(previous, group, order);
    const from = games.findIndex(game => game.id === card.dataset.gameId);
    if (from < 0 || to === from || !Number.isInteger(to) || to < 0 || to >= games.length) return;
    const [moved] = games.splice(from, 1);
    games.splice(to, 0, moved);
    order.groups[group] = games.map(game => game.id);
    saveOrder(order);
    renderGames();
    moveStatus.textContent = `${gameName(moved)} moved to position ${to + 1} of ${games.length}.`;
  }

  async function update() {
    if (controller || closed) return;
    clearTimeout(timer);
    controller = new AbortController();
    const request = controller;
    const started = Date.now();
    const deadline = setTimeout(() => request.abort(), 10_000);
    try {
      const slate = await loadScoreboard(request.signal, previous);
      if (closed) return;
      const key = slateId(slate);
      if (order?.slate !== key) {
        clearDrag();
        order = { slate: key, groups: {} };
        saveOrder(order);
      }
      if (dragCard && !slate.games.some(game => game.id === dragCard.dataset.gameId && game.state === dragCard.dataset.state)) clearDrag();
      previous = slate;
      renderGames();
      reorderButton.hidden = false;
      sectionList.hidden = false;
      warning.textContent = slate.nextUnavailable ? 'The next schedule is temporarily unavailable. Checking again shortly.' : '';
      warning.hidden = !slate.nextUnavailable;
      checked.textContent = `Last checked ${checkTime.format(Date.now())}`;
    } catch {
      if (closed) return;
      warning.textContent = previous ? 'ESPN is temporarily unavailable. Scores shown may be out of date.' : 'Game data is temporarily unavailable. Checking again shortly.';
      warning.hidden = false;
      if (!previous) checked.textContent = 'Waiting for game data';
    } finally {
      clearTimeout(deadline);
      controller = undefined;
      if (!closed && !document.hidden) timer = setTimeout(update, Math.max(1000, pollInterval - (Date.now() - started)));
    }
  }

  function onVisibility() {
    if (document.hidden) clearTimeout(timer);
    else update();
  }
  refresh.addEventListener('click', update);
  reorderButton.addEventListener('click', () => {
    reordering = !reordering;
    reorderButton.textContent = reordering ? 'Done' : 'Reorder';
    reorderButton.setAttribute('aria-expanded', String(reordering));
    reorderHelp.hidden = !reordering;
    clearDrag();
    renderGames();
  });
  resetButton.addEventListener('click', () => {
    order.groups = {};
    saveOrder(order);
    reorderButton.focus();
    renderGames();
    moveStatus.textContent = 'Default game order restored.';
  });
  sectionList.addEventListener('change', event => {
    if (!reordering || !event.target.matches('.scoreboard-game-order select')) return;
    moveGame(event.target.closest('[data-game-id]'), Number(event.target.value));
  });
  sectionList.addEventListener('dragstart', event => {
    if (!reordering || !event.target.matches('.scoreboard-drag-handle')) return;
    dragCard = event.target.closest('[data-game-id]');
    event.dataTransfer.setData('text/plain', dragCard.dataset.gameId);
    event.dataTransfer.effectAllowed = 'move';
    dragCard.classList.add('scoreboard-dragging');
  });
  sectionList.addEventListener('dragover', event => {
    if (!dragCard) return;
    const card = event.target.closest('[data-game-id]');
    dropTarget?.classList.remove('scoreboard-drop-target');
    dropTarget = undefined;
    if (!card || card === dragCard || card.dataset.state !== dragCard.dataset.state) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    dropTarget = card;
    dropTarget.classList.add('scoreboard-drop-target');
  });
  sectionList.addEventListener('drop', event => {
    if (!dragCard || !dropTarget || event.target.closest('[data-game-id]') !== dropTarget) return;
    event.preventDefault();
    const card = dragCard;
    const targetId = dropTarget.dataset.gameId;
    clearDrag();
    moveGame(card, sectionGames(previous, card.dataset.state, order).findIndex(game => game.id === targetId));
  });
  sectionList.addEventListener('dragend', clearDrag);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', update);
  update();
  return () => {
    closed = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', update);
  };
}
