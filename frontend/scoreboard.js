const feedUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const sourceUrl = 'https://www.espn.com/college-football/scoreboard/_/group/80';
const pollInterval = 15_000;
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

function gameCard(game) {
  const detail = game.state === 'upcoming' ? kickoff(game) : game.detail || sections.find(([id]) => id === game.state)[1];
  const note = game.state === 'live' ? game.situation?.downDistanceText || '' : game.state === 'final' ? kickoff(game) : '';
  return `<article class="panel scoreboard-game" data-state="${game.state}" aria-label="${escapeHtml(game.teams.map(team => team.name).join(' vs. '))}">
    <div class="scoreboard-game-top"><strong>${escapeHtml(detail)}</strong><small>${escapeHtml(game.networks)}</small></div>
    <div class="scoreboard-teams">${game.teams.map((team, index) => teamLine(team, game, game.state === 'final' && team.score != null && game.teams[1 - index].score != null && Number(team.score) > Number(game.teams[1 - index].score))).join('')}</div>
    <div class="scoreboard-game-bottom"><span>${escapeHtml(note)}</span><a data-game-link="${game.id}" href="https://www.espn.com/college-football/game/_/gameId/${game.id}" target="_blank" rel="noopener">Gamecast<span class="sr-only"> for ${escapeHtml(game.teams.map(team => team.name).join(' vs. '))}</span></a></div>
  </article>`;
}

function drawSlate(root, slate) {
  const focusedGame = root.contains(document.activeElement) ? document.activeElement.dataset.gameLink : null;
  const title = root.querySelector('[data-scoreboard-slate]');
  title.textContent = slate.label ? [`${slate.year} ${slate.label}`, slate.dates].filter(Boolean).join(' · ') : 'FBS schedule';
  for (const [key, label, empty] of sections) {
    const section = root.querySelector(`[data-scoreboard-section="${key}"]`);
    const games = slate.games.filter(game => game.state === key).sort((a, b) => {
      if (key === 'final') return (b.start || 0) - (a.start || 0);
      return (a.start || Infinity) - (b.start || Infinity);
    });
    section.hidden = key === 'changed' && !games.length;
    const heading = section.querySelector('h2');
    const headingText = `${label} (${games.length})`;
    if (heading.textContent !== headingText) heading.textContent = headingText;
    const content = section.querySelector('[data-scoreboard-games]');
    const markup = games.length ? games.map(gameCard).join('') : `<p class="scoreboard-empty">${empty}</p>`;
    if (content.scoreboardMarkup !== markup) {
      content.innerHTML = markup;
      content.scoreboardMarkup = markup;
    }
  }
  if (focusedGame && document.activeElement.dataset.gameLink !== focusedGame) {
    root.querySelector(`[data-game-link="${focusedGame}"]`)?.focus({ preventScroll: true });
  }
}

export function mountScoreboard(root) {
  root.innerHTML = `<div class="scoreboard-toolbar">
    <div><h2 data-scoreboard-slate>FBS schedule</h2><p data-scoreboard-checked>Checking the ESPN feed…</p></div>
    <button class="button light small" type="button">Refresh now</button>
  </div>
  <p class="scoreboard-warning" role="status" hidden></p>
  <div class="scoreboard-sections" hidden>${sections.map(([key, label]) => `<section data-scoreboard-section="${key}" aria-labelledby="scoreboard-${key}"><h2 id="scoreboard-${key}">${label}</h2><div class="scoreboard-games" data-scoreboard-games></div></section>`).join('')}</div>
  <p class="scoreboard-source">Scores from <a href="${sourceUrl}" target="_blank" rel="noopener">ESPN</a>. Kickoffs are shown in Mountain Time.</p>`;

  const refresh = root.querySelector('button');
  const checked = root.querySelector('[data-scoreboard-checked]');
  const warning = root.querySelector('.scoreboard-warning');
  const sectionList = root.querySelector('.scoreboard-sections');
  let previous;
  let controller;
  let timer;
  let closed = false;

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
      drawSlate(root, slate);
      previous = slate;
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
