import { routeHref } from './clean-routes.js';
import { defaultGameFilters, filterGames, gameFilterControls, readGameFilterChange } from './game-filters.js?v=1';
import { loadMyTeams, subscribeMyTeams, getMyTeamIds } from './my-teams-store.js?v=1';
import { teamAccentAttr, teamNameMarkup } from './team-identity.js';

const feedUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const pollInterval = 15_000;
const orderStorageKey = 'fbs-scoreboard-order-v1';
const dragHold = 350;
const dragSlop = 8;
const gameDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric',
});
const gameDateOnly = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
});
const gameTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const checkTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', month:'short', day:'numeric', year:'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
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
  if (/STATUS_(?:CANCELED|CANCELLED|POSTPONED|DELAYED|SUSPENDED)/.test(type.name ?? '')) return 'changed';
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
  let state = gameState(type);
  const validFinal = [away.score, home.score].every(value => value !== undefined && value !== null && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)));
  if (state === 'final' && !validFinal) state = 'changed';
  return {
    id, state, start: competition.dateValid === false ? NaN : Date.parse(competition.date || event.date), timeTbd: competition.timeValid !== true,
    detail: gameState(type) === 'final' && !validFinal ? 'Final score not reported' : type.shortDetail || type.description || '',
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

export function readScoreboardSlate(data) {
  if (!Array.isArray(data.events)) throw new Error('Missing scoreboard events');
  const key = { year: String(data.season?.year), type: String(data.season?.type), week: String(data.week?.number) };
  const calendar = seasonSlates(data, key.year);
  const current = calendar.find(slate => sameSlate(slate, key)) ?? key;
  const parsed = data.events.map(readGame).filter(Boolean);
  const games = [...new Map(parsed.map(game => [game.id, game])).values()];
  if (data.events.length && !games.length) throw new Error('Missing scoreboard game details');
  const needsPlay = games.some(game => game.state === 'upcoming' || game.state === 'live');
  return { ...current, games, calendar, needsPlay, invalidEvents:data.events.length-parsed.length, duplicateEvents:parsed.length-games.length };
}

async function fetchSlate(signal, selection, {fetcher=fetch, now=Date.now}={}) {
  const query = new URLSearchParams({ groups: '80', limit: '200' });
  if (selection) {
    query.set('dates', selection.year);
    query.set('seasontype', selection.type);
    query.set('week', selection.week);
  }
  const response = await fetcher(`${feedUrl}?${query}`, { signal, cache:'no-store' });
  if (!response.ok) throw new Error(`ESPN scoreboard returned ${response.status}`);
  const slate = readScoreboardSlate(await response.json());
  slate.receivedAt = new Date(now()).toISOString();
  if (selection && !sameSlate(slate, selection)) throw new Error('ESPN returned a different slate');
  return slate;
}

export function reconcileScoreboardSlate(slate, previous) {
  if (!sameSlate(slate,previous)) return slate;
  const prior = new Map(previous.games.map(game=>[game.id,game]));
  let retainedFinals=0;
  const games=slate.games.map(game=>{
    const old=prior.get(game.id);
    if(old?.state!=='final'||!['upcoming','live'].includes(game.state)||old.start!==game.start||
      old.teams.some((team,index)=>team.id!==game.teams[index].id))return game;
    retainedFinals++;
    return {...old,retainedFinal:true};
  });
  return {...slate,games,retainedFinals,needsPlay:games.some(game=>['upcoming','live'].includes(game.state))};
}

export function scoreboardSignature(slate) {
  return JSON.stringify(slate.games.map(game=>[game.id,game.state,game.detail,game.start,game.timeTbd,...game.teams.map(team=>team.score)])
    .sort((a,b)=>a[0].localeCompare(b[0])));
}

export function scoreboardDelayedGames(slate, now=Date.now()) {
  return slate?.games.filter(game=>game.state==='upcoming'&&!game.timeTbd&&Number.isFinite(game.start)&&now-game.start>15*60_000)??[];
}

export function scoreboardTimestamp(value) {
  const time=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(time)?checkTime.format(time):'Not reported';
}

export async function loadScoreboard(signal, previous, options) {
  const canSelect = previous && /^\d{4}$/.test(previous.year) && /^[23]$/.test(previous.type) && /^\d+$/.test(previous.week);
  // Keep following the displayed slate if ESPN changes its default week before the last game ends.
  if (canSelect && (previous.needsPlay || nextAfter(previous))) {
    const current = reconcileScoreboardSlate(await fetchSlate(signal, previous, options),previous);
    if (!current.games.length && previous.games.length) throw new Error('The current slate is temporarily empty');
    // Show the last game in Final before advancing on the next refresh.
    if (current.needsPlay || previous.needsPlay) return current;
    return advanceSlate(signal, current, options);
  }
  const current=reconcileScoreboardSlate(await fetchSlate(signal,undefined,options),previous);
  if(sameSlate(current,previous)&&!current.games.length&&previous.games.length)throw Error('The current slate is temporarily empty');
  return advanceSlate(signal,current,options);
}

function nextAfter(current) {
  const position = current.calendar.findIndex(slate => sameSlate(slate, current));
  return position < 0 ? undefined : current.calendar[position + 1];
}

async function advanceSlate(signal, current, options) {
  if (current.needsPlay) return current;
  const next = nextAfter(current);
  if (!next) return current;
  // A new slate replaces the finished one only after ESPN supplies its games.
  try {
    const upcoming = await fetchSlate(signal, next, options);
    return upcoming.games.length ? upcoming : current;
  } catch {
    return { ...current, nextUnavailable: true };
  }
}

function kickoff(game) {
  if (!Number.isFinite(game.start)) return 'Kickoff TBD';
  return game.timeTbd ? `${gameDateOnly.format(game.start)} · Time TBD` : `${gameDate.format(game.start)} · ${gameTime.format(game.start)}`;
}

function teamLine(team, game, leader) {
  const possession = game.situation?.possession != null && String(game.situation.possession) === team.id;
  return `<div class="scoreboard-team team-accent-row${leader ? ' scoreboard-winner' : ''}" ${teamAccentAttr(team.id)}>
    <span class="scoreboard-team-rank" data-scoreboard-rank="${escapeHtml(team.id)}"></span>
    <div class="scoreboard-team-name">${teamNameMarkup(team.id, team.schoolName ?? team.name)}${possession ? '<span class="scoreboard-possession" role="img" aria-label="Has possession" title="Has possession">●</span>' : ''}${team.record ? `<small>${escapeHtml(team.record)}</small>` : ''}</div>
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
    <div class="scoreboard-game-bottom"><span>${escapeHtml(note)}</span><a href="https://www.espn.com/college-football/game/_/gameId/${game.id}" target="_blank" rel="noopener">Gamecast<span class="sr-only"> for ${escapeHtml(gameName(game))}</span></a></div>
    <div class="scoreboard-game-links">${game.teams.filter(team => team.published).map(team => `<a href="${routeHref(`team/${team.id}`)}">${escapeHtml(team.name)}</a>`).join('')}${game.teams.every(team => team.published) ? `<a href="${routeHref(`compare/matchup/${game.teams[1].id}/${game.teams[0].id}/home`)}">Matchup Lab</a><a href="${game.predictionHref ?? '/weekly-picks'}">${game.hasSavedPrediction?'Saved prediction':'Weekly picks'}</a>` : ''}<a href="/beat-the-model/">Make picks</a></div>`;
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
  card.innerHTML = '<div class="scoreboard-game-details"></div>';
  return card;
}

function updateCard(card, game, count) {
  const name = gameName(game);
  card.dataset.state = game.state;
  card.toggleAttribute('data-close-game', game.close);
  if (card.getAttribute('aria-label') !== name) card.setAttribute('aria-label', name);
  card.toggleAttribute('data-movable', count > 1);
  if (count > 1) {
    card.tabIndex = 0;
    card.setAttribute('aria-describedby', 'scoreboard-keyboard-help');
    card.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
  } else {
    card.removeAttribute('tabindex');
    card.removeAttribute('aria-describedby');
    card.removeAttribute('aria-keyshortcuts');
  }
  const details = card.querySelector('.scoreboard-game-details');
  const markup = gameDetails(game);
  if (details.scoreboardMarkup !== markup) {
    details.innerHTML = markup;
    details.scoreboardMarkup = markup;
  }
}

function drawSlate(root, slate, order, cards, filtered = false) {
  const focused = document.activeElement;
  const focusedCard = focused?.closest('[data-game-id]');
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
    placeholder.textContent = filtered ? 'No games match these filters.' : empty;
    games.forEach((game, index) => {
      let card = cards.get(game.id);
      if (!card) {
        card = newCard(game.id);
        cards.set(game.id, card);
      }
      updateCard(card, game, games.length);
      if (content.children[index] !== card) content.insertBefore(card, content.children[index] ?? null);
    });
  }
  if (focusedCard && root.contains(focusedCard) && document.activeElement !== focused) {
    const control = focused === focusedCard ? focusedCard : focusedCard.querySelector('a');
    if (control && !control.closest('[hidden]')) control.focus({ preventScroll: true });
  }
}

function mountCardDrag(list, move) {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const toolbar = list.closest('[data-scoreboard]').querySelector('.scoreboard-toolbar');
  let gesture;
  let holdTimer;
  let frame;

  function cancel() {
    clearTimeout(holdTimer);
    cancelAnimationFrame(frame);
    if (!gesture) return;
    const { card, target, ghost, id, touch } = gesture;
    gesture = undefined;
    if (!touch && card.hasPointerCapture(id)) card.releasePointerCapture(id);
    card.classList.remove('scoreboard-dragging');
    target?.classList.remove('scoreboard-drop-target');
    ghost?.remove();
  }

  function updateTarget() {
    const candidate = document.elementFromPoint(gesture.x, gesture.y)?.closest('[data-game-id]');
    const target = candidate && list.contains(candidate) && candidate !== gesture.card &&
      candidate.dataset.state === gesture.card.dataset.state ? candidate : undefined;
    if (target === gesture.target) return;
    gesture.target?.classList.remove('scoreboard-drop-target');
    gesture.target = target;
    target?.classList.add('scoreboard-drop-target');
  }

  function autoScroll() {
    const edge = 70;
    const top = Math.max(0, toolbar.getBoundingClientRect().bottom);
    const bottom = window.innerHeight;
    const speed = gesture.y < top + edge ? -Math.min(15, (top + edge - gesture.y) / 4)
      : gesture.y > bottom - edge ? Math.min(15, (gesture.y - bottom + edge) / 4) : 0;
    if (speed) {
      window.scrollBy({ top: speed, behavior: 'instant' });
      updateTarget();
    }
    frame = requestAnimationFrame(autoScroll);
  }

  function start() {
    const { card, touch, id } = gesture;
    if (!touch) card.setPointerCapture(id);
    const ghost = card.cloneNode(true);
    ghost.removeAttribute('data-game-id');
    ghost.removeAttribute('data-movable');
    ghost.classList.add('scoreboard-drag-preview');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.style.width = `${card.getBoundingClientRect().width}px`;
    document.body.append(ghost);
    gesture.ghost = ghost;
    card.classList.add('scoreboard-dragging');
    positionPreview();
    frame = requestAnimationFrame(autoScroll);
  }

  function positionPreview() {
    const { ghost, x, y, offsetX, offsetY } = gesture;
    ghost.style.transform = `translate3d(${x - offsetX}px, ${y - offsetY}px, 0)`;
    updateTarget();
  }

  function begin(target, point, id, touch) {
    if (gesture || target.closest('a, button, select, input, textarea')) return;
    const card = target.closest('[data-movable]');
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    const { clientX: x, clientY: y } = point;
    gesture = { card, id, touch, x, y, startX: x, startY: y, offsetX: x - bounds.left, offsetY: y - bounds.top };
    if (touch) holdTimer = setTimeout(start, dragHold);
  }

  function track(point, event) {
    gesture.x = point.clientX;
    gesture.y = point.clientY;
    if (!gesture.ghost && Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) >= dragSlop) {
      if (gesture.touch) { cancel(); return; }
      start();
    }
    if (gesture.ghost) {
      event.preventDefault();
      positionPreview();
    }
  }

  function finish(point, event) {
    if (gesture.ghost) {
      gesture.x = point.clientX;
      gesture.y = point.clientY;
      updateTarget();
    }
    const { card, target, ghost } = gesture;
    if (ghost) event.preventDefault();
    cancel();
    if (target && list.contains(target) && card.dataset.state === target.dataset.state) move(card, target);
  }

  list.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.isPrimary && event.button === 0) begin(event.target, event, event.pointerId, false);
  }, options);
  window.addEventListener('pointermove', event => {
    if (gesture && !gesture.touch && event.pointerId === gesture.id) track(event, event);
  }, options);
  window.addEventListener('pointerup', event => {
    if (gesture && !gesture.touch && event.pointerId === gesture.id) finish(event, event);
  }, options);
  window.addEventListener('pointercancel', event => {
    if (gesture && !gesture.touch && event.pointerId === gesture.id) cancel();
  }, options);
  list.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { cancel(); return; }
    const touch = event.changedTouches[0];
    begin(event.target, touch, touch.identifier, true);
  }, { ...options, passive: true });
  list.addEventListener('touchmove', event => {
    if (!gesture?.touch) return;
    const touch = Array.from(event.changedTouches).find(point => point.identifier === gesture.id);
    if (touch) track(touch, event);
  }, { ...options, passive: false });
  list.addEventListener('touchend', event => {
    if (!gesture?.touch) return;
    const touch = Array.from(event.changedTouches).find(point => point.identifier === gesture.id);
    if (touch) finish(touch, event);
  }, { ...options, passive: false });
  list.addEventListener('touchcancel', cancel, options);
  list.addEventListener('dragstart', event => { if (gesture) event.preventDefault(); }, options);
  list.addEventListener('contextmenu', event => { if (gesture?.touch) event.preventDefault(); }, options);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); }, options);
  window.addEventListener('blur', cancel, options);
  return {
    get source() { return gesture?.card; },
    cancel,
    unmount() { cancel(); listeners.abort(); },
  };
}

export function mountScoreboard(root, rankForTeam = () => undefined, { getTeams = () => new Map(), getPublication = () => null } = {}) {
  root.innerHTML = `<p class="scoreboard-source">Live scores from ESPN. Kickoffs use Mountain Time. Published rankings, saved-pick grades and contest results update separately.</p>
  <div class="scoreboard-toolbar">
    <div><h2 data-scoreboard-slate>FBS schedule</h2><p data-scoreboard-checked>Waiting for an ESPN response…</p></div>
    <button class="button light small" type="button" data-scoreboard-refresh>Refresh now</button>
  </div>
  <details class="scoreboard-diagnostics" data-scoreboard-diagnostics><summary>Data times and coverage</summary><dl>
    <div><dt>Live feed response received</dt><dd data-scoreboard-time="received">Not reported</dd></div>
    <div><dt>Latest score/status change observed here</dt><dd data-scoreboard-time="changed">Not yet observed</dd></div>
    <div><dt>Last refresh attempt</dt><dd data-scoreboard-time="attempt">Not reported</dd></div>
    <div><dt>ESPN source-update time</dt><dd>Not reported by ESPN</dd></div>
    <div><dt>Published ranking/model snapshot</dt><dd data-scoreboard-time="model">Not reported</dd></div>
    <div><dt>Published schedule and results</dt><dd data-scoreboard-time="schedule">Not reported</dd></div>
    <div><dt>Saved prediction publication</dt><dd data-scoreboard-time="picks">Not reported</dd></div>
    <div><dt>Feed coverage</dt><dd data-scoreboard-time="coverage">Waiting for data</dd></div>
  </dl><p>Receiving a response does not prove ESPN has updated every result. <a href="/weekly-picks">Weekly Picks</a> grades the published results; <a href="/beat-the-model/">Beat the Model</a> shows its separate contest-update time. A live final does not rewrite a saved prediction.</p></details>
  <div data-scoreboard-filters></div>
  <div class="scoreboard-order-help" data-scoreboard-order-help hidden>
    <p><span class="scoreboard-touch-tip">Touch and hold a game, then drag to move it.</span><span class="scoreboard-mouse-tip">Drag a game to move it.</span></p>
    <button class="button light small" type="button" data-scoreboard-reset hidden>Reset order</button>
  </div>
  <p id="scoreboard-keyboard-help" class="sr-only">Press Alt and the Up or Down arrow to move this game within its section.</p>
  <p class="sr-only" role="status" data-scoreboard-move-status></p>
  <p class="scoreboard-warning" role="status" hidden></p>
  <div class="scoreboard-sections" hidden>${sections.map(([key, label]) => `<section data-scoreboard-section="${key}" aria-labelledby="scoreboard-${key}"><h2 id="scoreboard-${key}">${label}</h2>${key === 'final' ? '<button class="button light small scoreboard-collapse" type="button" data-scoreboard-collapse aria-expanded="true">Collapse completed games</button>' : ''}<p class="scoreboard-empty"></p><div class="scoreboard-games" data-scoreboard-games></div></section>`).join('')}</div>`;

  const refresh = root.querySelector('[data-scoreboard-refresh]');
  const reorderHelp = root.querySelector('[data-scoreboard-order-help]');
  const resetButton = root.querySelector('[data-scoreboard-reset]');
  const moveStatus = root.querySelector('[data-scoreboard-move-status]');
  const checked = root.querySelector('[data-scoreboard-checked]');
  const warning = root.querySelector('.scoreboard-warning');
  const diagnostics = root.querySelector('[data-scoreboard-diagnostics]');
  const sectionList = root.querySelector('.scoreboard-sections');
  const cards = new Map();
  let order = readOrder();
  let previous;
  let controller;
  let timer;
  let closed = false;
  let filters = { ...defaultGameFilters };
  let filtersMarkup = '';
  let savedGames = new Map();
  let savedForYear = null, savedLoading = false, savedLastAttempt = null, savedPublication = null;
  let lastAttemptAt = null, lastSuccessfulAt = null, lastChangedAt = null, feedFailed = false;
  let finalsCollapsed = false;
  const filterRoot = root.querySelector('[data-scoreboard-filters]');

  function normalizedGames() {
    return previous.games.map(game => ({
      ...savedGames.get(game.id), id: game.id,
      home: game.teams[1].id, away: game.teams[0].id,
      startDate: Number.isFinite(game.start) ? new Date(game.start).toISOString() : '',
      startTimeTbd: game.timeTbd, status: game.state === 'upcoming' ? 'scheduled' : game.state,
      homePoints: game.teams[1].score == null ? null : Number(game.teams[1].score),
      awayPoints: game.teams[0].score == null ? null : Number(game.teams[0].score),
    }));
  }

  function drawFilters(games, teams) {
    const markup = gameFilterControls({ filters, games, teams, myTeamIds: getMyTeamIds(), idPrefix: 'scoreboard' });
    if (markup === filtersMarkup) return;
    const focused = filterRoot.contains(document.activeElement) ? document.activeElement.id : null;
    filterRoot.innerHTML = markup;
    filtersMarkup = markup;
    if (focused) filterRoot.querySelector('#' + focused)?.focus({ preventScroll: true });
  }

  async function loadSavedGames({force=false}={}) {
    if(!previous||savedLoading||(!force&&savedForYear===previous.year)||(!force&&savedLastAttempt!==null&&Date.now()-savedLastAttempt<60_000))return;
    const year=previous.year;
    savedLoading=true;savedLastAttempt=Date.now();
    try {
      const dataRoot = document.querySelector('meta[name="publication-data-root"]')?.content;
      const response = await fetch(dataRoot ? dataRoot + '/weekly-picks.json' : '/weekly-picks',{cache:'no-cache'});
      if (!response.ok) return;
      const data = await response.json();
      if (closed||String(data.season)!==year||year!==previous?.year||!Array.isArray(data.games)) return;
      savedGames = new Map(data.games.map(game => [game.id, game]));
      savedForYear=year;savedPublication=data;
      if (!closed) {renderGames();updateFreshness();}
    } catch { /* Close-game filtering remains available for scored games. */ }
    finally{savedLoading=false;}
  }

  function updateFreshness() {
    if(closed)return;
    const publication=getPublication(),samePublishedSeason=String(publication?.season)===previous?.year;
    const sameSavedSeason=String(savedPublication?.season)===previous?.year;
    checked.textContent=lastSuccessfulAt?`Last successful ESPN response ${scoreboardTimestamp(lastSuccessfulAt)}`:'Waiting for game data';
    const fields={received:scoreboardTimestamp(lastSuccessfulAt),attempt:scoreboardTimestamp(lastAttemptAt),
      changed:lastChangedAt?scoreboardTimestamp(lastChangedAt):'Not observed since opening this page',
      model:scoreboardTimestamp(samePublishedSeason?publication.asOf:sameSavedSeason?savedPublication.source?.rankingAsOf:null),
      schedule:scoreboardTimestamp(sameSavedSeason?savedPublication.source?.scheduleAsOf:null),
      picks:scoreboardTimestamp(sameSavedSeason?savedPublication.asOf:null),
      coverage:previous?`${previous.games.length} games · ${previous.invalidEvents??0} incomplete events excluded · ${previous.duplicateEvents??0} duplicate IDs removed`:'Waiting for data'};
    for(const [key,text]of Object.entries(fields)){
      const node=diagnostics.querySelector(`[data-scoreboard-time="${key}"]`);
      if(node.textContent!==text)node.textContent=text;
    }
    const messages=[];
    if(feedFailed)messages.push(previous?'The ESPN refresh failed. The last successful response is still shown; scores may be stale.':'Game data is temporarily unavailable. Checking again shortly.');
    else if(lastSuccessfulAt&&Date.now()-Date.parse(lastSuccessfulAt)>pollInterval*2)messages.push('The last successful ESPN response is over 30 seconds old. Refresh to check for newer scores.');
    const delayed=scoreboardDelayedGames(previous);
    if(delayed.length)messages.push(`${delayed.length} ${delayed.length===1?'game is':'games are'} still marked Scheduled more than 15 minutes after confirmed kickoff on this ESPN slate. Its status may be delayed; check Gamecast.`);
    if(previous?.retainedFinals)messages.push(`ESPN returned an earlier status for ${previous.retainedFinals} previously final ${previous.retainedFinals===1?'game':'games'}. The last confirmed final from this visit is retained.`);
    if(previous?.invalidEvents)messages.push('Some ESPN events have incomplete team or status data and cannot be displayed.');
    if(previous?.nextUnavailable)messages.push('The next schedule is temporarily unavailable. Checking again shortly.');
    warning.textContent=messages.join(' ');warning.hidden=!messages.length;
    root.dataset.scoreboardHealth=feedFailed?'unavailable':messages.length?'attention':'ready';
  }

  function updateRankings() {
    if (!previous) return;
    for (const cell of sectionList.querySelectorAll('[data-scoreboard-rank]')) {
      const rank = rankForTeam(cell.dataset.scoreboardRank, previous.year);
      const label = Number.isInteger(rank) && rank >= 1 && rank <= 25 ? `CFP #${rank}` : '';
      if (cell.textContent !== label) cell.textContent = label;
    }
    updateFreshness();
  }

  function renderGames() {
    if (!previous || closed) return;
    const teams = getTeams();
    const normalized = normalizedGames();
    const eligible = new Set(filterGames(normalized, filters, { teams, myTeamIds: getMyTeamIds() }).map(game => game.id));
    const closeGames = new Set(filterGames(normalized, { close: true }).map(game => game.id));
    const games = previous.games.filter(game => eligible.has(game.id)).map(game => {
      const saved = savedGames.get(game.id);
      const predictionHref = saved && ['regular', 'postseason'].includes(saved.seasonType) && Number.isInteger(saved.week)
        ? routeHref(`compare/weekly/${saved.seasonType}:${saved.week}/${game.id}`) : '/weekly-picks';
      return { ...game, predictionHref, hasSavedPrediction:!!saved?.pick, close: closeGames.has(game.id),
        teams: game.teams.map(team => ({ ...team, published: teams.has(team.id), schoolName: teams.get(team.id)?.name })) };
    });
    drawSlate(root, { ...previous, games }, order, cards, Object.entries(filters).some(([key, value]) => value !== defaultGameFilters[key]));
    drawFilters(normalized, teams);
    root.querySelector('[data-scoreboard-section="final"] [data-scoreboard-games]').hidden = finalsCollapsed;
    updateRankings();
    const hasOrder = Object.keys(order.groups).length > 0;
    resetButton.hidden = !hasOrder;
    reorderHelp.hidden = !hasOrder && !sectionList.querySelector('[data-movable]');
  }

  function moveGame(card, to) {
    const group = card.dataset.state;
    const games = visibleSectionGames(group);
    const from = games.findIndex(game => game.id === card.dataset.gameId);
    if (from < 0 || to === from || !Number.isInteger(to) || to < 0 || to >= games.length) return;
    const [moved] = games.splice(from, 1);
    games.splice(to, 0, moved);
    const visibleIds = new Set(games.map(game => game.id));
    const movedIds = games.map(game => game.id);
    order.groups[group] = sectionGames(previous, group, order).map(game => visibleIds.has(game.id) ? movedIds.shift() : game.id);
    saveOrder(order);
    renderGames();
    moveStatus.textContent = `${gameName(moved)} moved to position ${to + 1} of ${games.length}.`;
  }

  function visibleSectionGames(group) {
    const included = new Set(filterGames(normalizedGames(), filters, { teams: getTeams(), myTeamIds: getMyTeamIds() }).map(game => game.id));
    return sectionGames(previous, group, order).filter(game => included.has(game.id));
  }

  const drag = mountCardDrag(sectionList, (card, target) => {
    const games = visibleSectionGames(card.dataset.state);
    moveGame(card, games.findIndex(game => game.id === target.dataset.gameId));
  });

  async function update({refreshSaved=false}={}) {
    if (controller || closed) return;
    clearTimeout(timer);
    controller = new AbortController();
    const request = controller;
    const started = Date.now();
    lastAttemptAt=new Date(started).toISOString();updateFreshness();
    const deadline = setTimeout(() => request.abort(), 10_000);
    try {
      const slate = await loadScoreboard(request.signal, previous);
      if (closed) return;
      const key = slateId(slate);
      if (order?.slate !== key) {
        drag.cancel();
        order = { slate: key, groups: {} };
        saveOrder(order);
      }
      if (drag.source && !slate.games.some(game => game.id === drag.source.dataset.gameId && game.state === drag.source.dataset.state)) drag.cancel();
      if(previous&&sameSlate(previous,slate)&&scoreboardSignature(previous)!==scoreboardSignature(slate))lastChangedAt=slate.receivedAt;
      if(!previous||!sameSlate(previous,slate))lastChangedAt=null;
      previous = slate;
      lastSuccessfulAt=slate.receivedAt;feedFailed=false;
      renderGames();
      sectionList.hidden = false;
      updateFreshness();
      void loadSavedGames({force:refreshSaved});
    } catch {
      if (closed) return;
      feedFailed=true;updateFreshness();
      if(refreshSaved)void loadSavedGames({force:true});
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
  refresh.addEventListener('click',()=>void update({refreshSaved:true}));
  const onFilters = event => {
    const next = readGameFilterChange(filters, event);
    if (!next) return;
    filters = next;
    drag.cancel();
    renderGames();
    if (filters.close) void loadSavedGames();
  };
  filterRoot.addEventListener('change', onFilters);
  const collapse = root.querySelector('[data-scoreboard-collapse]');
  collapse.addEventListener('click', () => {
    finalsCollapsed = !finalsCollapsed;
    collapse.setAttribute('aria-expanded', String(!finalsCollapsed));
    collapse.textContent = finalsCollapsed ? 'Show completed games' : 'Collapse completed games';
    renderGames();
  });
  const stopFavorites = subscribeMyTeams(() => renderGames());
  void loadMyTeams().then(() => renderGames()).catch(() => {});
  resetButton.addEventListener('click', () => {
    drag.cancel();
    order.groups = {};
    saveOrder(order);
    refresh.focus({ preventScroll: true });
    renderGames();
    moveStatus.textContent = 'Default game order restored.';
  });
  sectionList.addEventListener('keydown', event => {
    const card = event.target;
    if (!event.altKey || !card.matches('[data-movable]') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const games = visibleSectionGames(card.dataset.state);
    const index = games.findIndex(game => game.id === card.dataset.gameId);
    moveGame(card, index + (event.key === 'ArrowUp' ? -1 : 1));
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', update);
  update();
  return {
    // Published teams can finish loading after the live feed. Re-render the
    // stable cards so team/profile and saved-game links appear immediately too.
    updateRankings:renderGames,
    unmount() {
      closed = true;
      stopFavorites();
      drag.unmount();
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', update);
    },
  };
}
