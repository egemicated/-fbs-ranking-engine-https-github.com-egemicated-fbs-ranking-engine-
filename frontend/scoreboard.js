import { routeHref } from './clean-routes.js';
import { defaultGameFilters, filterGames, gameFilterControls, readGameFilterChange } from './game-filters.js?v=1';
import { loadMyTeams, subscribeMyTeams, getMyTeamIds } from './my-teams-store.js?v=1';
import { teamAccentAttr, teamNameMarkup } from './team-identity.js';
import { formatRecord } from './format.js?v=sor-transparency';

const pollInterval = 5 * 60_000;
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
  ['live', 'In progress at last update', 'No games were in progress at the last update.'],
  ['upcoming', 'Upcoming', 'No upcoming games on this slate.'],
  ['changed', 'Schedule changes', ''],
  ['final', 'Final', 'No final scores yet.'],
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function sameSlate(a, b) {
  return a && b && slateId(a) === slateId(b);
}

export function readScoreboardSlate(data) {
  const cutoff = Date.parse(data?.source?.scheduleAsOf);
  if (data?.source?.provider !== 'cfbd' || !Number.isInteger(data.season) || !Number.isFinite(cutoff) ||
      !Array.isArray(data.games) || !Array.isArray(data.teams)) throw new Error('Missing published football schedule');
  const byId = new Map(data.teams.map(team => [team.id, team]));
  const slates = new Map();
  const ids = new Set();
  let invalidEvents = 0, duplicateEvents = 0;
  for (const row of data.games) {
    if (!row || typeof row !== 'object') { invalidEvents++; continue; }
    const home = byId.get(row.home), away = byId.get(row.away);
    if (home?.division !== 'fbs' && away?.division !== 'fbs') continue;
    if (!/^\d+$/.test(row.id) || !home?.name || !away?.name || row.home === row.away ||
        !['regular', 'postseason'].includes(row.seasonType) || !Number.isInteger(row.week)) {
      invalidEvents++;
      continue;
    }
    if (ids.has(row.id)) { duplicateEvents++; continue; }
    ids.add(row.id);
    const start = Date.parse(row.startDate);
    const key = `${row.seasonType}:${row.week}`;
    if (!slates.has(key)) slates.set(key, { week: row.week, type: row.seasonType, start: Infinity, games: [] });
    const slate = slates.get(key);
    if (Number.isFinite(start)) slate.start = Math.min(start, slate.start);
    const final = row.status === 'final' && [row.homePoints, row.awayPoints].every(score => Number.isSafeInteger(score) && score >= 0);
    const state = final ? 'final' : ['scheduled', 'pending'].includes(row.status) ? 'upcoming' : 'changed';
    const detail = { final: 'Final score not reported', postponed: 'Postponed', canceled: 'Canceled' }[row.status] ?? '';
    slate.games.push({ id: row.id, state, start, timeTbd: row.startTimeTbd !== false, detail: final ? '' : detail,
      row, teams: [{ ...away, score: final ? row.awayPoints : null }, { ...home, score: final ? row.homePoints : null }] });
  }
  const periods = [...slates.values()].sort((a, b) => a.start - b.start || a.week - b.week);
  const current = periods.findLast(slate => slate.start <= cutoff) ?? periods[0];
  return {
    year: String(data.season), type: current?.type, week: current?.week,
    label: current?.type === 'postseason' ? 'Postseason' : current ? `Week ${current.week}` : '',
    games: current?.games ?? [], invalidEvents, duplicateEvents, source: data.source, asOf: data.asOf,
  };
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
  return {...slate,games,retainedFinals};
}

export function scoreboardDelayedGames(slate, now=Date.now()) {
  return slate?.games.filter(game=>game.state==='upcoming'&&!game.timeTbd&&Number.isFinite(game.start)&&now-game.start>15*60_000)??[];
}

export function scoreboardTimestamp(value) {
  const time=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(time)?checkTime.format(time):'Not reported';
}

export async function loadScoreboard(signal, previous, { path, fetcher = fetch, now = Date.now } = {}) {
  const response = await fetcher(path, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`Published schedule returned ${response.status}`);
  const current = reconcileScoreboardSlate(readScoreboardSlate(await response.json()), previous);
  if ((!current.games.length && previous?.games.length) ||
      Date.parse(current.source.scheduleAsOf) < Date.parse(previous?.source?.scheduleAsOf)) throw new Error('The current slate is temporarily unavailable');
  return { ...current, receivedAt: new Date(now()).toISOString() };
}

function startLabel(game, { startTerm, timeTbdDay }) {
  if (!Number.isFinite(game.start)) return `${startTerm} TBD`;
  return game.timeTbd ? `${timeTbdDay?.(game) ?? gameDateOnly.format(game.start)} · Time TBD`
    : `${gameDate.format(game.start)} · ${gameTime.format(game.start)}`;
}

function teamLine(team, winner) {
  return `<div class="scoreboard-team team-accent-row${winner ? ' scoreboard-winner' : ''}" ${teamAccentAttr(team.id,team.color)}>
    <span class="scoreboard-team-rank" data-scoreboard-rank="${escapeHtml(team.id)}"></span>
    <div class="scoreboard-team-name">${teamNameMarkup(team.id, team.schoolName ?? team.name,team.mascot)}${team.record ? `<small>${escapeHtml(team.record)}</small>` : ''}</div>
    ${team.score == null ? '' : `<div class="scoreboard-score-line"><strong class="scoreboard-score">${escapeHtml(team.score)}</strong>${winner ? '<small>Winner</small>' : ''}</div>`}
  </div>`;
}

function gameName(game) {
  return game.teams.map(team => team.name).join(' vs. ');
}

const footballFormat = {
  title:'FBS schedule', startTerm:'Kickoff', articleOrderKey:orderStorageKey,
  sourceNote:'Published scores and kickoff times from CollegeFootballData. Times use Mountain Time. Follow Gamecast for in-game updates and TV listings.',
  diagnosticsNote:'<p><a href="/weekly-picks">Weekly Picks</a> grades saved predictions against published results. <a href="/beat-the-model/">Beat the Model</a> shows its contest update separately.</p>',
  delayNote:'Check Gamecast for the latest status.',
  formatRank:rank=>Number.isInteger(rank) && rank >= 1 && rank <= 25 ? `CFP #${rank}` : '',
  external:game=>({href:`https://www.espn.com/college-football/game/_/gameId/${game.id}`,label:'Gamecast'}),
  links(game) {
    const links=game.teams.filter(team=>team.published).map(team=>({href:routeHref(`team/${team.id}`),label:team.name}));
    if (game.teams.every(team=>team.published)) links.push(
      {href:routeHref(`compare/matchup/${game.teams[1].id}/${game.teams[0].id}/${game.row.neutral ? 'neutral' : 'home'}`),label:'Matchup Lab'},
      {href:routeHref(`compare/weekly/${game.row.seasonType}:${game.row.week}/${game.id}`),label:game.row.pick?'Saved prediction':'Weekly picks'},
    );
    return [...links,{href:'/beat-the-model/',label:'Make picks'}];
  },
};

function gameDetails(game, format) {
  const detail = game.state === 'upcoming' ? startLabel(game,format) : game.detail || sections.find(([id]) => id === game.state)[1];
  const note = ['final','live'].includes(game.state) ? startLabel(game,format) : '';
  const status = { upcoming:'Scheduled', final:'Final', changed:'Schedule update', live:'In progress at last update' }[game.state];
  const siteLink = format.external?.(game);
  const metadata = [note, format.venue?.(game)].filter(Boolean).join(' · ');
  const close = game.close && game.state !== 'changed';
  return `<div class="scoreboard-game-top"><div class="scoreboard-game-kickoff"><span class="scoreboard-game-status">${status}</span>
      ${detail && String(detail).toLowerCase() !== status.toLowerCase() ? `<strong>${escapeHtml(detail)}</strong>` : ''}</div></div>
    <div class="scoreboard-teams">${game.teams.map((team, index) => teamLine(team, game.state === 'final' && team.score != null && game.teams[1 - index].score != null && Number(team.score) > Number(game.teams[1 - index].score))).join('')}</div>
    ${metadata || close || siteLink ? `<div class="scoreboard-game-bottom">${metadata ? `<span>${escapeHtml(metadata)}</span>` : ''}${close ? `<span class="scoreboard-close-label">${game.state === 'upcoming' ? 'Close forecast' : 'Within 7 points'}</span>` : ''}${siteLink ? `<a href="${escapeHtml(siteLink.href)}" target="_blank" rel="noopener">${escapeHtml(siteLink.label)}<span class="sr-only"> for ${escapeHtml(gameName(game))}</span></a>` : ''}</div>` : ''}
    <div class="scoreboard-game-links">${format.links(game).map(({href,label})=>`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join('')}</div>
    ${format.details?.(game) ?? ''}`;
}

function readOrder(storageKey) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (typeof saved?.slate !== 'string') return null;
    const groups = Object.fromEntries(sections.flatMap(([key]) => {
      const ids = saved.groups?.[key];
      return Array.isArray(ids) ? [[key, ids.filter(id => typeof id === 'string')]] : [];
    }));
    return { slate: saved.slate, groups };
  } catch {
    return null;
  }
}

function saveOrder(order, storageKey) {
  try {
    if (Object.keys(order.groups).length) sessionStorage.setItem(storageKey, JSON.stringify(order));
    else sessionStorage.removeItem(storageKey);
  } catch {
    // The current page can still keep the order in memory.
  }
}

function slateId(slate) {
  return slate.key ?? `${slate.year}:${slate.type}:${slate.week}`;
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

function updateCard(card, game, count, format) {
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
  const markup = gameDetails(game, format);
  if (details.scoreboardMarkup !== markup) {
    const expanded = details.querySelector('details')?.open;
    details.innerHTML = markup;
    const disclosure = details.querySelector('details');
    if (expanded && disclosure) disclosure.open = true;
    details.scoreboardMarkup = markup;
  }
}

function drawSlate(root, slate, order, cards, format, filtered = false) {
  const focused = document.activeElement;
  const focusedCard = focused?.closest('[data-game-id]');
  const present = new Set(slate.games.map(game => game.id));
  for (const [id, card] of cards) {
    if (present.has(id)) continue;
    card.remove();
    cards.delete(id);
  }
  const title = root.querySelector('[data-scoreboard-slate]');
  title.textContent = slate.title ?? (slate.label ? [`${slate.year} ${slate.label}`, slate.dates].filter(Boolean).join(' · ') : format.title);
  for (const [key, label, empty] of sections) {
    const section = root.querySelector(`[data-scoreboard-section="${key}"]`);
    const games = sectionGames(slate, key, order);
    section.hidden = ['changed','live'].includes(key) && !games.length;
    const heading = section.querySelector('h2');
    const headingText = `${label} (${games.length})`;
    if (heading.textContent !== headingText) heading.textContent = headingText;
    const content = section.querySelector('[data-scoreboard-games]');
    const placeholder = section.querySelector('.scoreboard-empty');
    placeholder.hidden = games.length > 0;
    placeholder.textContent = filtered ? 'No games match these filters.' : slate.empty?.[key] ?? empty;
    games.forEach((game, index) => {
      let card = cards.get(game.id);
      if (!card) {
        card = newCard(game.id);
        cards.set(game.id, card);
      }
      updateCard(card, game, games.length, format);
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
    if (gesture || target.closest('a, button, select, input, textarea, summary')) return;
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

export function mountScoreboard(root, rankForTeam = () => undefined, {
  getTeams = () => new Map(), getPublication = () => null, format = footballFormat,
  loadSlate, initialQuery, initialFilters, onFiltersChange,
} = {}) {
  const {articleOrderKey:storageKey, favorites = true, filterOptions = {includeLive:false}} = format;
  root.innerHTML = `<p class="scoreboard-source">${escapeHtml(format.sourceNote)}</p>
  <div class="scoreboard-toolbar">
    <div><h2 data-scoreboard-slate>${escapeHtml(format.title)}</h2><p data-scoreboard-checked>Loading the published schedule…</p></div>
    <button class="button light small" type="button" data-scoreboard-refresh>Check for updates</button>
  </div>
  <details class="scoreboard-diagnostics" data-scoreboard-diagnostics><summary>Data times and coverage</summary><dl>
    <div><dt>Last successful check</dt><dd data-scoreboard-time="received">Not reported</dd></div>
    <div><dt>Last refresh attempt</dt><dd data-scoreboard-time="attempt">Not reported</dd></div>
    <div><dt>Published ranking/model snapshot</dt><dd data-scoreboard-time="model">Not reported</dd></div>
    <div><dt>Published schedule and results</dt><dd data-scoreboard-time="schedule">Not reported</dd></div>
    <div><dt>${escapeHtml(format.savedTimeLabel ?? 'Saved prediction publication')}</dt><dd data-scoreboard-time="picks">Not reported</dd></div>
    <div><dt>Schedule coverage</dt><dd data-scoreboard-time="coverage">Waiting for data</dd></div>
  </dl>${format.diagnosticsNote}</details>
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
  let order = readOrder(storageKey);
  let previous;
  let controller;
  let timer;
  let closed = false;
  let filters = { ...defaultGameFilters, ...initialFilters };
  let activeQuery = initialQuery;
  let filtersMarkup = '';
  let lastAttemptAt = null, feedFailed = false;
  let finalsCollapsed = false;
  const filterRoot = root.querySelector('[data-scoreboard-filters]');
  const dataRoot = document.querySelector('meta[name="publication-data-root"]')?.content;
  const path = dataRoot ? dataRoot + '/weekly-picks.json' : '/weekly-picks';
  const fetchSlate = loadSlate ?? ((signal,prior)=>loadScoreboard(signal,prior,{path}));
  const selectionTeams = () => previous?.teams ?? getTeams();
  const chosenTeams = () => favorites ? getMyTeamIds() : [];
  const selectionOptions = () => ({teams:selectionTeams(),myTeamIds:chosenTeams(),rankedDivisions:filterOptions.rankedDivisions});

  function normalizedGames() {
    return previous.games.map(game => ({
      ...game.row,
      startTimeTbd: game.timeTbd, status: game.state === 'upcoming' ? 'scheduled' : game.state,
      homePoints: game.teams[1].score, awayPoints: game.teams[0].score,
    }));
  }

  function drawFilters(games, teams) {
    const markup = gameFilterControls({ filters, games, teams, myTeamIds:chosenTeams(), idPrefix:'scoreboard', ...filterOptions,
      contextControls:format.filterControls?.(previous,filters) });
    if (markup === filtersMarkup) return;
    const focused = filterRoot.contains(document.activeElement) ? document.activeElement.id : null;
    filterRoot.innerHTML = markup;
    filtersMarkup = markup;
    if (focused) filterRoot.querySelector('#' + focused)?.focus({ preventScroll: true });
  }

  function updateFreshness() {
    if(closed)return;
    const publication=previous?.publication ?? getPublication(),samePublishedSeason=String(publication?.season)===previous?.year;
    checked.textContent=previous?`Schedule as of ${scoreboardTimestamp(previous.source.scheduleAsOf)}`:feedFailed?'Waiting for game data':'Loading the published schedule…';
    const fields={received:scoreboardTimestamp(previous?.receivedAt),attempt:scoreboardTimestamp(lastAttemptAt),
      model:scoreboardTimestamp(samePublishedSeason?publication.asOf:previous?.source.rankingAsOf),
      schedule:scoreboardTimestamp(previous?.source.scheduleAsOf),
      picks:scoreboardTimestamp(previous?.asOf),
      coverage:previous?previous.coverage ?? `${previous.games.length} games · ${previous.invalidEvents??0} incomplete events excluded · ${previous.duplicateEvents??0} duplicate IDs removed`:'Waiting for data'};
    for(const [key,text]of Object.entries(fields)){
      const node=diagnostics.querySelector(`[data-scoreboard-time="${key}"]`);
      if(node.textContent!==text)node.textContent=text;
    }
    const messages=[];
    if(feedFailed)messages.push(previous?'The refresh failed. The most recent available schedule is still shown.':'The published schedule is temporarily unavailable.');
    const delayed=scoreboardDelayedGames(previous);
    if(delayed.length)messages.push(`${delayed.length} ${delayed.length===1?'game is':'games are'} still marked Scheduled more than 15 minutes after confirmed ${format.startTerm.toLowerCase()}. ${format.delayNote}`);
    if(previous?.retainedFinals)messages.push(`This publication returned an earlier status for ${previous.retainedFinals} previously final ${previous.retainedFinals===1?'game':'games'}. The last confirmed final from this visit is retained.`);
    if(previous?.invalidEvents)messages.push('Some published games have incomplete details and cannot be displayed.');
    warning.textContent=messages.join(' ');warning.hidden=!messages.length;
    root.dataset.scoreboardHealth=feedFailed?'unavailable':messages.length?'attention':'ready';
  }

  function updateRankings() {
    if (!previous) return;
    for (const cell of sectionList.querySelectorAll('[data-scoreboard-rank]')) {
      const rank = rankForTeam(cell.dataset.scoreboardRank,previous.year,previous);
      const label = format.formatRank(rank);
      if (cell.textContent !== label) cell.textContent = label;
    }
    updateFreshness();
  }

  function renderGames() {
    if (!previous || closed) return;
    const teams = selectionTeams();
    const sameSeason = String((previous.publication ?? getPublication())?.season) === previous.year;
    const normalized = normalizedGames();
    const eligible = new Set(filterGames(normalized,filters,selectionOptions()).map(game=>game.id));
    const closeGames = new Set(filterGames(normalized, { close: true }).map(game => game.id));
    const games = previous.games.filter(game => eligible.has(game.id)).map(game => {
      return { ...game, close: closeGames.has(game.id),
        teams: game.teams.map(team => {
          const ranked = teams.get(team.id);
          return { ...team, published: !!ranked, schoolName: ranked?.name, mascot:ranked?.mascot,
            record: sameSeason && Number.isInteger(ranked?.wins) && Number.isInteger(ranked?.losses) ? formatRecord(ranked) : '' };
        }) };
    });
    drawSlate(root,{...previous,games},order,cards,format,
      previous.games.length > 0 && Object.entries(filters).some(([key,value])=>value!==defaultGameFilters[key]));
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
    saveOrder(order,storageKey);
    renderGames();
    moveStatus.textContent = `${gameName(moved)} moved to position ${to + 1} of ${games.length}.`;
  }

  function visibleSectionGames(group) {
    const included = new Set(filterGames(normalizedGames(),filters,selectionOptions()).map(game=>game.id));
    return sectionGames(previous, group, order).filter(game => included.has(game.id));
  }

  const drag = mountCardDrag(sectionList, (card, target) => {
    const games = visibleSectionGames(card.dataset.state);
    moveGame(card, games.findIndex(game => game.id === target.dataset.gameId));
  });

  async function update(selection) {
    if (closed || document.hidden || (controller && !selection)) return;
    clearTimeout(timer);
    if (selection) controller?.abort();
    controller = new AbortController();
    const request = controller;
    const started = Date.now();
    lastAttemptAt=new Date(started).toISOString();updateFreshness();
    const deadline = setTimeout(() => request.abort(), 10_000);
    try {
      const slate = await fetchSlate(request.signal,previous,selection?.query ?? activeQuery);
      if (closed || request !== controller || request.signal.aborted) return;
      const key = slateId(slate);
      if (order?.slate !== key) {
        drag.cancel();
        order = { slate: key, groups: {} };
        saveOrder(order,storageKey);
      }
      if (drag.source && !slate.games.some(game => game.id === drag.source.dataset.gameId && game.state === drag.source.dataset.state)) drag.cancel();
      previous = slate;
      if (selection) {
        activeQuery = selection.query;
        filters = { ...filters,...selection.filters };
      }
      feedFailed=false;
      renderGames();
      sectionList.hidden = false;
      updateFreshness();
      return true;
    } catch {
      if (closed || request !== controller) return;
      feedFailed=true;updateFreshness();
    } finally {
      clearTimeout(deadline);
      if (request === controller) {
        controller = undefined;
        if (!closed && !document.hidden) timer = setTimeout(update, Math.max(1000, pollInterval - (Date.now() - started)));
      }
    }
  }

  function onVisibility() {
    if (document.hidden) clearTimeout(timer);
    else update();
  }
  const refreshNow = () => void update();
  refresh.addEventListener('click', refreshNow);
  const onFilters = event => {
    const next = readGameFilterChange(filters, event);
    if (!next) return;
    filters = next;
    drag.cancel();
    renderGames();
    onFiltersChange?.(filters);
  };
  filterRoot.addEventListener('change', onFilters);
  const collapse = root.querySelector('[data-scoreboard-collapse]');
  collapse.addEventListener('click', () => {
    finalsCollapsed = !finalsCollapsed;
    collapse.setAttribute('aria-expanded', String(!finalsCollapsed));
    collapse.textContent = finalsCollapsed ? 'Show completed games' : 'Collapse completed games';
    renderGames();
  });
  const stopFavorites = favorites ? subscribeMyTeams(renderGames) : null;
  if (favorites) void loadMyTeams().then(renderGames).catch(() => {});
  resetButton.addEventListener('click', () => {
    drag.cancel();
    order.groups = {};
    saveOrder(order,storageKey);
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
  window.addEventListener('online', refreshNow);
  update();
  return {
    // Published teams may load after the scoreboard. Refresh links and ranks when they arrive.
    updateRankings:renderGames,
    selectSlate:(query,filters)=>update({query,filters}),
    unmount() {
      closed = true;
      stopFavorites?.();
      drag.unmount();
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', refreshNow);
    },
  };
}
