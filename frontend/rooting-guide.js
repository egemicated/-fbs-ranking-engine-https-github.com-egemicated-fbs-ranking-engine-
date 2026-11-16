import { SCENARIO_CFP_SEASON, SCENARIO_CFP_SELECTION_AT } from './cfp-scenario-field.js';
import { rootingCacheVersion, rootingCandidates, rootingChampions } from './rooting-guide-model.js';

const storageKey = 'fbs-rooting-guide-v1';
const maxCacheEntries = 5;
const selectionDay = Date.parse(SCENARIO_CFP_SELECTION_AT);
const dates = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short',
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
let inputRequest;

function getInput(url, snapshot) {
  const key = JSON.stringify([url, snapshot.snapshotHash]);
  if (inputRequest?.key === key && inputRequest.expiry > Date.now()) return inputRequest.promise;
  const promise = fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
    .then(response => {
      if (!response.ok) throw new Error('Scenario data is unavailable');
      return response.json();
    }).then(input => {
      if (input.season !== snapshot.season || input.asOf !== snapshot.asOf || input.snapshotHash !== snapshot.snapshotHash ||
          !Array.isArray(input.teams) || !Array.isArray(input.games) || !Array.isArray(input.fixtures)) {
        throw new Error('Scenario data is from a different snapshot');
      }
      return input;
    }).catch(error => {
      if (inputRequest?.promise === promise) inputRequest = null;
      throw error;
    });
  inputRequest = { key, promise, expiry: Date.now() + 60_000 };
  return promise;
}

function storedEntries() {
  try {
    const entries = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(entries) ? entries.filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' &&
      Array.isArray(entry[1]) && entry[1].length <= 3 && entry[1].every(row => row?.game && Array.isArray(row.pastOpponents) &&
        [row.home, row.away].every(side => Number.isInteger(side?.rank) && Number.isFinite(side.sor)))) : [];
  } catch { return []; }
}

function writeCache(key, results) {
  try {
    const entries = storedEntries().filter(([existing]) => existing !== key);
    localStorage.setItem(storageKey, JSON.stringify([[key, results], ...entries].slice(0, maxCacheEntries)));
  } catch { /* The guide remains usable with browser storage disabled. */ }
}

function effect(helps, other) {
  if (helps.seed > 0 && other.seed === 0) return 'Moves into the modeled playoff field';
  if (helps.seed > 0 && other.seed > 0 && helps.seed !== other.seed) {
    const bye = helps.seed <= 4 && other.seed > 4 ? ' with a first-round bye' : '';
    return `Projected seed #${helps.seed} instead of #${other.seed}${bye}`;
  }
  if (helps.rank !== other.rank) return `SOR rank #${helps.rank} instead of #${other.rank}`;
  return `Higher SOR score at rank #${helps.rank}`;
}

function outcomeMarkup(winner, result) {
  const field = result.seed === null ? '' : `<span>${result.seed ? `Projected seed #${result.seed}` : 'Outside projected field'}</span>`;
  return `<div><dt>If ${escape(winner)} wins</dt><dd><span><strong>#${result.rank}</strong> SOR · ${result.sor.toFixed(4)}</span>${field}</dd></div>`;
}

function recommendationMarkup(row, team, names, gameHref) {
  const { game, winner, home, away } = row;
  const homeName = names.get(game.home), awayName = names.get(game.away);
  const favoredHome = winner === game.home;
  const matchup = `${awayName} ${game.neutral ? 'vs.' : 'at'} ${homeName}`;
  const href = gameHref?.(game);
  const detailsLink = typeof href === 'string' && href.startsWith('#') ? `<a href="${escape(href)}">See matchup</a>` : '';
  const past = row.pastOpponents.map(id => names.get(id)).filter(Boolean);
  const reason = past.length === 1 ? `${team.name} already played ${past[0]}. Their result changes the opponent network used for SOR.`
    : past.length > 1 ? `${team.name} already played both teams. Their result changes the opponent network used for SOR.`
      : 'The result changes the standings or opponent network used in this scenario.';
  return `<li><details class="rooting-result"><summary>
    <span><strong>Root for ${escape(names.get(winner))}</strong><small>${escape(matchup)} · ${escape(dates.format(new Date(game.startDate)))}</small></span>
    <span class="rooting-effect">${escape(effect(favoredHome ? home : away, favoredHome ? away : home))}</span>
  </summary><div class="rooting-sides"><p>${escape(reason)}</p><dl>${outcomeMarkup(homeName, home)}${outcomeMarkup(awayName, away)}</dl>
    ${detailsLink}</div></details></li>`;
}

export function mountRootingGuide(root, { team, snapshot, inputUrl, gameHref, now } = {}) {
  let active = true, calculating = false, worker, timeout;
  const at = () => Number.isFinite(now) ? now : Date.now();
  root.innerHTML = `<details class="rooting-guide"><summary>Your rooting guide</summary>
    <div class="rooting-guide-body"></div></details>`;
  const details = root.firstElementChild;
  const body = details.querySelector('.rooting-guide-body');
  const isCurrent = () => active && details.isConnected;
  const status = value => {
    body.replaceChildren(Object.assign(document.createElement('p'), { role: 'status', textContent: value }));
  };
  function finish() {
    clearTimeout(timeout);
    worker?.terminate();
    worker = null;
    calculating = false;
  }
  function unavailable() {
    finish();
    if (!isCurrent()) return;
    body.innerHTML = '<p role="status">The rooting guide could not load for this snapshot.</p><button class="rooting-retry" type="button">Try again</button>';
    body.querySelector('button').addEventListener('click', load, { once: true });
  }
  function show(input, results) {
    const upcoming = results.filter(row => Date.parse(row.game.startDate) > at());
    if (!upcoming.length) {
      status('No meaningful SOR or field change in the upcoming games checked.');
      return;
    }
    const names = new Map(input.teams.map(row => [row.id, row.name]));
    const hasField = upcoming.some(row => row.home.seed !== null && row.away.seed !== null);
    body.innerHTML = `<p class="rooting-guide-note">Model scenarios · Confirmed games over the next seven days. Each comparison adds just that game to the published results.</p>
      <ul class="rooting-list">${upcoming.map(row => recommendationMarkup(row, team, names, gameHref)).join('')}</ul>
      <p class="rooting-guide-note">${hasField ? 'The same four current conference SOR leaders are assumed champions in both outcomes. Other bids follow the scenario rankings. ' : ''}
      <a href="#cfp-scenarios">CFP Scenario Builder</a></p>`;
  }
  async function load() {
    if (!isCurrent() || calculating) return;
    if (team.division !== 'fbs') return status('The current scenario engine covers FBS teams.');
    if (snapshot?.season !== SCENARIO_CFP_SEASON || at() >= selectionDay) {
      return status('The rooting guide covers the weeks before 2026 CFP Selection Day.');
    }
    calculating = true;
    status('Loading upcoming games…');
    try {
      const input = await getInput(inputUrl, snapshot);
      if (!isCurrent()) return finish();
      const candidates = rootingCandidates(input, team.id, at());
      if (!candidates.length) {
        finish();
        return status('No other confirmed games are listed in the next seven days.');
      }
      const key = rootingCacheVersion(input, team.id, candidates);
      const cached = storedEntries().find(([existing]) => existing === key)?.[1];
      if (cached) {
        finish();
        return show(input, cached);
      }
      status('Comparing both outcomes…');
      worker = new Worker(new URL('./rooting-guide-worker.js?v=1', import.meta.url), { type: 'module' });
      worker.addEventListener('error', unavailable);
      worker.addEventListener('message', ({ data }) => {
        if (!isCurrent()) return finish();
        if (data.error) return unavailable();
        if (!data.complete) return status(`Comparing both outcomes… ${data.checked} of ${candidates.length} games checked.`);
        finish();
        writeCache(key, data.results);
        show(input, data.results);
      });
      worker.postMessage({ input, teamId: team.id, candidates, champions: rootingChampions(snapshot.rankings ?? []) });
      timeout = setTimeout(unavailable, 90_000);
    } catch { unavailable(); }
  }
  function toggle() {
    if (details.open) void load();
  }
  details.addEventListener('toggle', toggle);
  return () => {
    active = false;
    details.removeEventListener('toggle', toggle);
    finish();
  };
}
