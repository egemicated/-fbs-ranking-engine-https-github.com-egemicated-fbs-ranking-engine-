import { fillScenarioFavorites, predictScenarioGame } from './cfp-scenario-model.js';
import { CFP_RULES_URL, SCENARIO_CFP_SEASON, SCENARIO_CFP_SELECTION_AT, SCENARIO_CHAMPION_CONFERENCES, selectScenarioField } from './cfp-scenario-field.js';
import { teamAccentAttr, teamDisplayName, teamNameMarkup } from './team-identity.js';
import { pageHero } from './platform-presentation.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const hasRank = row => Number.isInteger(row?.sorRank) && row.sorRank > 0;
const score = value => Number.isFinite(value) ? value.toFixed(4) : '—';
const percent = value => `${(value * 100).toFixed(0)}%`;
const mountain = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const displayDate = value => Number.isFinite(Date.parse(value)) ? `${mountain.format(new Date(value))} MT` : 'Kickoff TBD';
const publishedDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'long', timeStyle: 'short' });
const publicationTime = value => `<time datetime="${escape(value)}">${escape(publishedDate.format(new Date(value)))} Mountain Time</time>`;
const gamePageSize = 12;
const fixtureWeekKey = game => `${game.seasonType}:${game.week}`;
const fixtureWeekLabel = game => `${game.seasonType === 'postseason' ? 'Postseason · ' : ''}Week ${game.week}`;
let cleanup;

export function unmountCfpScenario() {
  cleanup?.();
  cleanup = undefined;
}

function publishedRows(snapshot) {
  return snapshot.rankings.filter(row => row.division === 'fbs').map(row => ({
    id: row.id, name: row.name, conference: row.conference, wins: row.wins, losses: row.losses,
    sor: row.sor, sorRank: row.displayRank ?? null,
  })).sort((a, b) => (a.sorRank ?? Infinity) - (b.sorRank ?? Infinity));
}

function movement(row, baseline) {
  const current = baseline.get(row.id);
  if (!hasRank(current) || !hasRank(row)) return '<span class="scenario-muted">—</span>';
  const delta = current.sorRank - row.sorRank;
  if (!delta) return '<span class="scenario-muted">Same</span>';
  const direction = delta > 0 ? 'Up' : 'Down';
  return `<span class="scenario-movement ${delta > 0 ? 'up' : 'down'}" aria-label="${direction} ${Math.abs(delta)} places">${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)}</span>`;
}

function projectionMarkup(rows, champions, baseline) {
  const { field, champions: selectedChampions, matchups } = selectScenarioField(rows, champions);
  const savedField = rows === baseline && !Object.keys(champions).length ? field : selectScenarioField(baseline).field;
  const savedSeeds = new Map(savedField.map(row => [row.id, row.seed]));
  const fieldIds = new Set(field.map(row => row.id));
  const dropped = savedField.filter(row => !fieldIds.has(row.id));
  const names = new Map(rows.map(row => [row.id, row.name]));
  const usedChampions = new Map(selectedChampions.map(row => [row.teamId, row]));
  const bid = row => {
    if (row.bid === 'conference champion') {
      const { assumed } = usedChampions.get(row.id);
      return `${row.conference} champion · ${assumed ? 'Assumed by SOR' : 'Your choice'}`;
    }
    if (row.bid === 'highest-ranked eligible conference') return `${row.conference} qualifier`;
    if (row.bid === 'Notre Dame') return 'Notre Dame top-12 berth';
    return 'At-large';
  };
  return `<ol class="scenario-field" aria-label="Projected seeds">${field.map(row => {
    const previous = savedSeeds.get(row.id);
    const change = previous === undefined ? 'New to field' : previous !== row.seed ? `Was seed ${previous}` : '';
    return `<li class="team-accent-row" ${teamAccentAttr(row.id)}>
      <span class="scenario-seed" aria-label="Seed ${row.seed}">${row.seed}</span>
      <div><strong class="scenario-field-team">${teamNameMarkup(row.id, row.name)}</strong>
      <small class="scenario-bid">${row.bid !== 'at-large' ? '<span class="scenario-qualifier">Automatic</span> ' : ''}${escape(bid(row))}</small></div>
      <div class="scenario-field-record"><strong>#${row.sorRank} SOR</strong><small>${row.wins}–${row.losses}</small></div>
      ${row.seed <= 4 || change ? `<div class="scenario-seed-note">${row.seed <= 4 ? '<span>First-round bye</span>' : ''}
      ${change ? `<span>${escape(change)}</span>` : ''}</div>` : ''}
    </li>`;
  }).join('')}</ol>
    ${dropped.length ? `<p class="scenario-field-changes"><strong>Out of the field:</strong> ${dropped.map(row => escape(teamDisplayName(row.id, row.name))).join(', ')}.</p>` : ''}
    <div class="scenario-first-round"><h3>First-round games</h3><ul>${matchups.map(({ home, away, byeOpponent }) => `<li>
      <div class="scenario-matchup-line"><span class="scenario-matchup-seed">#${away.seed}</span> <strong>${teamNameMarkup(away.id, away.name)}</strong></div>
      <div class="scenario-matchup-line"><span class="scenario-matchup-seed">#${home.seed}</span> <strong>${teamNameMarkup(home.id, home.name)}</strong><small>Host</small></div>
      <p>Winner faces #${byeOpponent.seed} ${teamNameMarkup(byeOpponent.id, byeOpponent.name)}</p></li>`).join('')}</ul></div>
    <details class="scenario-assumed"><summary>Conference champions used</summary><ul>${selectedChampions.map(({ conference, teamId, assumed }) => `<li>
      <span>${escape(conference)}</span><strong>${teamNameMarkup(teamId, names.get(teamId))}</strong><small>${assumed ? 'Assumed by SOR' : 'Your choice'}</small></li>`).join('')}</ul></details>`;
}

function rankingsMarkup(rows, baseline, all) {
  const ranked = all ? rows : rows.filter(hasRank).slice(0, 25);
  return `<table class="scenario-rankings"><caption class="sr-only">Projected ${all ? 'FBS' : 'Top 25'} Strength of Record compared with current ranks</caption>
    <thead><tr><th scope="col">Proj.</th><th scope="col">Team</th><th scope="col">Current</th><th scope="col">Move</th><th scope="col">SOR</th></tr></thead>
    <tbody>${ranked.map(row => `<tr><td><strong>${row.sorRank ?? '—'}</strong></td><th scope="row">${teamNameMarkup(row.id, row.name)}</th>
    <td>${baseline.get(row.id)?.sorRank ?? '—'}</td><td>${movement(row, baseline)}</td><td>${score(row.sor)}</td></tr>`).join('')}</tbody></table>`;
}

function teamOptions(teams) {
  return teams.map(team => `<option value="${escape(team.id)}">${escape(teamDisplayName(team.id, team.name))}</option>`).join('');
}

function choicesMarkup(game, names, winner, { custom = false } = {}) {
  const away = names.get(game.away);
  const home = names.get(game.home);
  const probability = game.homeWinProbability;
  const group = custom ? 'data-scenario-custom-choice' : 'data-scenario-choice';
  return `<div class="scenario-choices" role="group" aria-label="Choose the winner of ${escape(teamDisplayName(game.away, away))} versus ${escape(teamDisplayName(game.home, home))}">
    ${[[game.away, away, 1 - probability], [game.home, home, probability]].map(([id, name, chance]) => `<button type="button" class="scenario-choice team-accent-row" ${teamAccentAttr(id)}
    ${group}="${escape(game.id)}" data-scenario-team="${escape(id)}" aria-pressed="${winner === id}">
    <span>${teamNameMarkup(id, name)}</span>${Number.isFinite(probability) ? `<small aria-label="Model win chance ${percent(chance)}">${percent(chance)}</small>` : ''}</button>`).join('')}</div>`;
}

function matchupMarkup(game, names, winner) {
  return `<li class="scenario-game"><div class="scenario-game-meta"><span>${escape(fixtureWeekLabel(game))} · ${escape(displayDate(game.startDate))}${game.neutral ? ' · Neutral site' : ''}</span>
    ${winner ? `<button type="button" class="scenario-text-button" data-scenario-clear="${escape(game.id)}">Clear pick</button>` : ''}</div>
    ${choicesMarkup(game, names, winner)}</li>`;
}

function baseMarkup(input, teams, baseline, publishedAt) {
  const weeks = new Map(input.fixtures.map(game => [fixtureWeekKey(game), fixtureWeekLabel(game)]));
  const options = teamOptions(teams);
  return `<section class="panel scenario-summary"><div class="panel-body">
    <h2>Set your outcomes</h2><p>Choose hypothetical winners for games without a published final result. Games without a pick stay out of the scenario.</p>
    <div class="scenario-actions"><button class="button" type="button" data-scenario-action="fill">Fill remaining games with model favorites</button>
    <button class="button light" type="button" data-scenario-action="reset">Reset scenario</button>
    <button class="button light" type="button" data-scenario-action="projection">View projection</button></div>
    <p class="compact-note scenario-fill-note">Predictive Strength picks hypothetical winners for games you leave open. Those outcomes then recalculate SOR for the projected field.</p>
    <p class="scenario-status" data-scenario-status role="status"></p></div></section>
    <div class="scenario-layout"><div class="scenario-editor">
    <section class="panel" aria-labelledby="scenario-games-title"><div class="panel-body">
      <h2 id="scenario-games-title" tabindex="-1">Remaining games</h2>
      <p class="compact-note">These games had no final result at the saved data cutoff, ${publicationTime(input.asOf)}. For newer results, check the <a href="/scoreboard">Live Scoreboard</a>. Win chances use the saved model.</p>
      <div class="scenario-filter"><label for="scenario-week">Week<select id="scenario-week">
        ${[...weeks].map(([key, label]) => `<option value="${escape(key)}">${escape(label)}</option>`).join('')}<option value="all">All weeks</option></select></label>
      <label for="scenario-team">Filter by team<select id="scenario-team"><option value="">All teams</option>${options}</select></label></div>
      <div data-scenario-fixtures></div>
    </div></section>
    <details class="panel scenario-details"><summary>Add a hypothetical game</summary><div class="panel-body">
      <p class="compact-note">Use this for an unscheduled matchup, such as a conference title game.</p>
      <form class="scenario-form" data-scenario-custom-form>
        <label for="scenario-away">Away team<select id="scenario-away" required><option value="">Choose a team</option>${options}</select></label>
        <label for="scenario-home">Home team<select id="scenario-home" required><option value="">Choose a team</option>${options}</select></label>
        <label for="scenario-venue">Venue<select id="scenario-venue"><option value="home">Home team’s field</option><option value="neutral">Neutral site</option></select></label>
        <label for="scenario-winner">Winner<select id="scenario-winner" required><option value="">Choose a winner</option></select></label>
        <p class="compact-note" data-scenario-custom-odds></p>
        <button class="button light" type="submit">Add game</button><p class="scenario-form-message" data-scenario-custom-message role="status"></p>
      </form><div data-scenario-custom-list></div>
    </div></details>
    <details class="panel scenario-details"><summary>Choose conference champions</summary><div class="panel-body">
      <p class="compact-note">By default, the highest scenario SOR team in each conference below gets its automatic bid.</p>
      <div class="scenario-champion-inputs">${SCENARIO_CHAMPION_CONFERENCES.map(conference => `<label>${escape(conference)}
        <select data-scenario-champion="${escape(conference)}"><option value="">Assume highest SOR</option>${teamOptions(teams.filter(team => team.conference === conference && hasRank(baseline.get(team.id))))}</select></label>`).join('')}</div>
    </div></details>
    </div><div class="scenario-output" data-scenario-output>
      <section class="panel scenario-projection" aria-labelledby="scenario-projection-title"><div class="panel-body">
        <div class="scenario-projection-heading"><h2 id="scenario-projection-title" tabindex="-1">SOR-Based Playoff Projection</h2><button type="button" class="scenario-text-button" data-scenario-action="picks">Back to picks</button></div>
        <p class="scenario-projection-intro">An unofficial ${input.season} 12-team field selected and seeded by The Games Decide’s Strength of Record (SOR). Conference champions are assumed unless you choose them. The CFP committee makes the official selections using its own rankings.</p>
        <p class="scenario-publication">Based on rankings published ${publicationTime(publishedAt)}.</p>
        <details class="scenario-method"><summary>How this projection works</summary>
          <dl>
            <div><dt>Current SOR rankings</dt><dd>What teams earned through the saved results cutoff at ${publicationTime(input.asOf)}.</dd></div>
            <div><dt>SOR-based field</dt><dd>The highest-SOR team in each of the ACC, Big Ten, Big 12 and SEC gets the assumed champion bid unless you pick another. The top SOR team across the American, Conference USA, MAC, Mountain West, Pac-12 and Sun Belt earns the fifth automatic bid. Notre Dame earns a berth when it is among the first 12 teams in SOR order. The highest remaining teams fill the at-large spots. Seeds follow SOR order and seeds 1–4 get byes.</dd></div>
            <div><dt>CFP committee rankings</dt><dd>The committee uses its own rankings and actual champions. The CFP also assigns bowl sites under the <a href="${escape(CFP_RULES_URL)}" target="_blank" rel="noopener noreferrer">official 2026 selection framework</a>.</dd></div>
            <div><dt>Hypothetical scenarios</dt><dd>Your chosen outcomes recalculate SOR from the saved publication and can change the field and seeds.</dd></div>
          </dl>
        </details>
        <p class="scenario-projection-status" data-scenario-projection-status></p><div data-scenario-field></div>
      </div></section>
      <details class="panel scenario-details"><summary>Projected SOR rankings</summary>
        <label class="scenario-all-rankings"><input type="checkbox" id="scenario-all-rankings"> Show all FBS teams</label><div data-scenario-rankings></div></details>
    </div></div>`;
}

function validInput(input, snapshot) {
  return input?.season === SCENARIO_CFP_SEASON && input.season === snapshot.season &&
    input.asOf === snapshot.asOf && input.snapshotHash === snapshot.snapshotHash &&
    Array.isArray(input.teams) && Array.isArray(input.games) && Array.isArray(input.fixtures);
}

export async function renderCfpScenario(main, { snapshot, inputUrl, workerUrl } = {}) {
  if (main.querySelector('[data-scenario-page]')) return;
  unmountCfpScenario();
  const abort = new AbortController();
  let worker, debounce, timeout, active = true;
  main.innerHTML = `${pageHero({sport:'football',category:'postseason',variant:'tool',title:'CFP Scenario Builder',
    eyebrow:'College Football Playoff',description:'Choose hypothetical game winners to see how our unofficial SOR playoff field changes.'})}
    <div class="wrap page-content scenario-page" data-scenario-page><p role="status">Loading the scenario schedule…</p></div>`;
  const root = main.querySelector('[data-scenario-page]');
  const current = () => active && root.isConnected;
  cleanup = () => {
    active = false;
    abort.abort();
    clearTimeout(debounce);
    clearTimeout(timeout);
    worker?.terminate();
    root.onclick = root.onchange = root.onsubmit = null;
  };

  try {
    if (snapshot?.season !== SCENARIO_CFP_SEASON || Date.parse(snapshot.asOf) >= Date.parse(SCENARIO_CFP_SELECTION_AT)) {
      root.innerHTML = `<section class="panel"><div class="panel-body"><h2>Pre-Selection Day scenarios</h2>
        <p>This builder covers the 2026 playoff field before Selection Day.</p><div class="scenario-actions"><a class="button light" href="/playoff-bracket/">View playoff bracket</a></div></div></section>`;
      return;
    }
    if (!inputUrl || !workerUrl || !Array.isArray(snapshot.rankings)) {
      throw new Error('The 2026 snapshot is unavailable.');
    }
    const response = await fetch(inputUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]) });
    if (!response.ok) throw new Error('The scenario schedule is unavailable.');
    const input = await response.json();
    if (!current()) return;
    if (!validInput(input, snapshot)) throw new Error('The schedule and rankings are from different updates.');
    const teams = input.teams.filter(team => team.division === 'fbs').sort((a, b) => a.name.localeCompare(b.name));
    const names = new Map(input.teams.map(team => [team.id, team.name]));
    const fixtures = new Map(input.fixtures.map(game => [game.id, game]));
    const original = publishedRows(snapshot);
    const baseline = new Map(original.map(row => [row.id, row]));
    let rows = original, picks = Object.create(null), customGames = [], champions = Object.create(null);
    let week, team = '', page = 0, customId = 0, showAllRankings = false;
    let revision = 0, inFlight, resultCount = 0, calculating = false, failed = false;
    const publishedAt = Number.isFinite(Date.parse(snapshot.modelPublishedAt)) ? snapshot.modelPublishedAt : input.asOf;
    root.innerHTML = baseMarkup(input, teams, baseline, publishedAt);
    const get = selector => root.querySelector(selector);
    week = get('#scenario-week').value;
    const outcomeCount = () => Object.keys(picks).length + customGames.length;

    function drawFixtures(focusId, focusTeam) {
      const visible = input.fixtures.filter(game => (week === 'all' || fixtureWeekKey(game) === week) &&
        (!team || game.home === team || game.away === team));
      const lastPage = Math.max(0, Math.ceil(visible.length / gamePageSize) - 1);
      page = Math.min(page, lastPage);
      const offset = page * gamePageSize;
      const batch = visible.slice(offset, offset + gamePageSize);
      const region = get('[data-scenario-fixtures]');
      region.innerHTML = batch.length ? `<p class="scenario-game-count compact-note">Showing ${offset + 1}–${offset + batch.length} of ${visible.length} games</p>
        <ul class="scenario-games">${batch.map(game => matchupMarkup(game, names, picks[game.id])).join('')}</ul>
        ${lastPage ? `<div class="scenario-actions scenario-pagination"><button type="button" class="button light small" data-scenario-action="previous"${page === 0 ? ' disabled' : ''}>Previous games</button>
          <button type="button" class="button light small" data-scenario-action="next"${page === lastPage ? ' disabled' : ''}>Next games</button></div>` : ''}`
        : '<p class="compact-note scenario-game-count">No remaining games match these filters.</p>';
      if (focusId) region.querySelector(`[data-scenario-choice="${CSS.escape(focusId)}"][data-scenario-team="${CSS.escape(focusTeam)}"]`)?.focus({ preventScroll: true });
    }

    function drawCustomGames(focusId, focusTeam) {
      const region = get('[data-scenario-custom-list]');
      region.innerHTML = customGames.length ? `<ul class="scenario-games">${customGames.map(game => `<li class="scenario-game"><div class="scenario-game-meta">
        <span>${game.neutral ? 'Neutral site' : `At ${teamNameMarkup(game.home, names.get(game.home))}`}</span><button type="button" class="scenario-text-button" data-scenario-remove="${escape(game.id)}">Remove game</button></div>
        ${choicesMarkup({ ...game, homeWinProbability: predictScenarioGame(input, game.home, game.away, game.neutral) }, names, game.winner, { custom: true })}</li>`).join('')}</ul>` : '';
      if (focusId) region.querySelector(`[data-scenario-custom-choice="${CSS.escape(focusId)}"][data-scenario-team="${CSS.escape(focusTeam)}"]`)?.focus({ preventScroll: true });
    }

    function updateStatus() {
      const count = outcomeCount();
      get('[data-scenario-action="fill"]').disabled = !input.fixtures.some(game => !picks[game.id] && Number.isFinite(game.homeWinProbability) && game.homeWinProbability !== .5);
      get('[data-scenario-action="reset"]').disabled = !count && !Object.keys(champions).length;
      get('[data-scenario-status]').textContent = calculating ? `Recalculating SOR with ${count} chosen ${count === 1 ? 'outcome' : 'outcomes'}…` :
        failed ? 'This calculation could not finish. Change a pick or retry the projection.' : `${count} chosen ${count === 1 ? 'outcome' : 'outcomes'}`;
      get('[data-scenario-output]').setAttribute('aria-busy', String(calculating));
      const status = get('[data-scenario-projection-status]');
      if (failed) status.innerHTML = 'Showing the last completed projection. <button type="button" class="scenario-text-button" data-scenario-action="recalculate">Retry projection</button>';
      else status.textContent = calculating ? 'Updating the projection…' : resultCount ? `Based on ${resultCount} hypothetical ${resultCount === 1 ? 'outcome' : 'outcomes'}.` :
        Object.keys(champions).length ? 'Published SOR with your champion choices' : 'Published SOR baseline';
    }

    function drawResults() {
      try {
        get('[data-scenario-field]').innerHTML = projectionMarkup(rows, champions, original);
      } catch {
        get('[data-scenario-field]').innerHTML = '<p class="compact-note">The playoff field is unavailable for these champion choices.</p>';
      }
      drawRankings();
      updateStatus();
    }

    function drawRankings() {
      get('[data-scenario-rankings]').innerHTML = rankingsMarkup(rows, baseline, showAllRankings);
    }

    function workerFailed() {
      clearTimeout(timeout);
      worker?.terminate();
      worker = undefined;
      inFlight = undefined;
      if (!current() || !outcomeCount()) return;
      calculating = false;
      failed = true;
      updateStatus();
    }

    function calculate() {
      if (!current() || inFlight !== undefined || !outcomeCount()) return;
      try {
        if (!worker) {
          worker = new Worker(workerUrl, { type: 'module' });
          worker.onerror = worker.onmessageerror = workerFailed;
          worker.onmessage = ({ data }) => {
            if (!current() || data?.id !== inFlight) return;
            clearTimeout(timeout);
            inFlight = undefined;
            if (data.id !== revision) {
              clearTimeout(debounce);
              calculate();
              return;
            }
            if (data.error || !Array.isArray(data.rows) || !data.rows.length) {
              workerFailed();
              return;
            }
            rows = data.rows;
            resultCount = outcomeCount();
            calculating = false;
            drawResults();
          };
        }
        inFlight = revision;
        worker.postMessage({ id: inFlight, input, picks, customGames });
        timeout = setTimeout(workerFailed, 30_000);
      } catch {
        workerFailed();
      }
    }

    function queueProjection() {
      revision++;
      clearTimeout(debounce);
      failed = false;
      calculating = outcomeCount() > 0;
      if (!calculating) {
        clearTimeout(timeout);
        worker?.terminate();
        worker = inFlight = undefined;
        rows = original;
        resultCount = 0;
        drawResults();
        return;
      }
      updateStatus();
      debounce = setTimeout(calculate, 160);
    }

    function customMatchup() {
      return { home: get('#scenario-home').value, away: get('#scenario-away').value, neutral: get('#scenario-venue').value === 'neutral' };
    }

    function updateCustomForm() {
      const game = customMatchup();
      const winner = get('#scenario-winner');
      const previous = winner.value;
      const participants = teams.filter(team => [game.home, game.away].includes(team.id));
      const odds = predictScenarioGame(input, game.home, game.away, game.neutral);
      const favoriteAvailable = Number.isFinite(odds) && odds !== .5;
      winner.innerHTML = `<option value="">Choose a winner</option>${teamOptions(participants)}<option value="model"${favoriteAvailable ? '' : ' disabled'}>Use model favorite</option>`;
      if (participants.some(team => team.id === previous) || previous === 'model' && favoriteAvailable) winner.value = previous;
      get('[data-scenario-custom-odds]').textContent = Number.isFinite(odds) && game.home !== game.away ?
        `${teamDisplayName(game.away, names.get(game.away))} ${percent(1 - odds)} · ${teamDisplayName(game.home, names.get(game.home))} ${percent(odds)}` : '';
      get('[data-scenario-custom-message]').textContent = '';
    }

    root.onchange = event => {
      const target = event.target;
      if (target.id === 'scenario-week' || target.id === 'scenario-team') {
        if (target.id === 'scenario-week') week = target.value;
        else {
          team = target.value;
          if (team) get('#scenario-week').value = week = 'all';
        }
        page = 0;
        drawFixtures();
      } else if (target.dataset.scenarioChampion) {
        if (target.value) champions[target.dataset.scenarioChampion] = target.value;
        else delete champions[target.dataset.scenarioChampion];
        drawResults();
      } else if (target.id === 'scenario-all-rankings') {
        showAllRankings = target.checked;
        drawRankings();
      } else if (['scenario-home', 'scenario-away', 'scenario-venue'].includes(target.id)) updateCustomForm();
    };

    root.onsubmit = event => {
      if (!event.target.matches('[data-scenario-custom-form]')) return;
      event.preventDefault();
      const game = customMatchup();
      const message = get('[data-scenario-custom-message]');
      if (!game.home || !game.away || game.home === game.away) { message.textContent = 'Choose two different FBS teams.'; return; }
      if (customGames.some(existing => [existing.home, existing.away].includes(game.home) && [existing.home, existing.away].includes(game.away))) {
        message.textContent = 'This matchup is already in your hypothetical games.';
        return;
      }
      let winner = get('#scenario-winner').value;
      if (winner === 'model') {
        const odds = predictScenarioGame(input, game.home, game.away, game.neutral);
        if (!Number.isFinite(odds) || odds === .5) { message.textContent = 'Choose a winner for this matchup.'; return; }
        winner = odds > .5 ? game.home : game.away;
      }
      if (![game.home, game.away].includes(winner)) { message.textContent = 'Choose a winner for this matchup.'; return; }
      customGames.push({ ...game, id: `custom-${++customId}`, winner });
      event.target.reset();
      updateCustomForm();
      message.textContent = 'Hypothetical game added.';
      drawCustomGames();
      queueProjection();
    };

    root.onclick = event => {
      const button = event.target.closest('button');
      if (!button) return;
      const { scenarioAction, scenarioChoice, scenarioCustomChoice, scenarioTeam, scenarioClear, scenarioRemove } = button.dataset;
      if (scenarioChoice) {
        const game = fixtures.get(scenarioChoice);
        if (!game || ![game.home, game.away].includes(scenarioTeam)) return;
        picks[game.id] = scenarioTeam;
        drawFixtures(game.id, scenarioTeam);
        queueProjection();
      } else if (scenarioClear) {
        delete picks[scenarioClear];
        drawFixtures(scenarioClear, fixtures.get(scenarioClear).away);
        queueProjection();
      } else if (scenarioCustomChoice) {
        const game = customGames.find(game => game.id === scenarioCustomChoice);
        if (!game || ![game.home, game.away].includes(scenarioTeam)) return;
        game.winner = scenarioTeam;
        drawCustomGames(game.id, scenarioTeam);
        queueProjection();
      } else if (scenarioRemove) {
        customGames = customGames.filter(game => game.id !== scenarioRemove);
        drawCustomGames();
        get('#scenario-away').focus({ preventScroll: true });
        queueProjection();
      } else if (scenarioAction === 'fill') {
        picks = fillScenarioFavorites(input.fixtures, picks);
        drawFixtures();
        queueProjection();
      } else if (scenarioAction === 'reset') {
        picks = Object.create(null);
        customGames = [];
        champions = Object.create(null);
        root.querySelectorAll('[data-scenario-champion]').forEach(select => { select.value = ''; });
        get('[data-scenario-custom-form]').reset();
        updateCustomForm();
        drawFixtures();
        drawCustomGames();
        queueProjection();
      } else if (scenarioAction === 'next' || scenarioAction === 'previous') {
        page += scenarioAction === 'next' ? 1 : -1;
        drawFixtures();
        get('#scenario-games-title').focus();
      } else if (scenarioAction === 'projection' || scenarioAction === 'picks') {
        get(scenarioAction === 'projection' ? '#scenario-projection-title' : '#scenario-games-title').focus();
      } else if (scenarioAction === 'recalculate') queueProjection();
    };

    drawFixtures();
    drawResults();
  } catch {
    if (!current()) return;
    root.innerHTML = `<section class="panel"><div class="panel-body"><h2>Scenario Builder is unavailable</h2>
      <p>Try again when the schedule and rankings have both loaded.</p><div class="scenario-actions"><button type="button" class="button light">Try again</button>
      <a class="button light" href="/rankings">Current rankings</a></div></div></section>`;
    root.querySelector('button').onclick = () => {
      root.remove();
      void renderCfpScenario(main, { snapshot, inputUrl, workerUrl });
    };
  }
}
