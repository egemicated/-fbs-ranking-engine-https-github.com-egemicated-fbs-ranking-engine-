import { googleSignInEnabled, loadBracketClient } from './bracket-auth.js';

const season = 2026;
const rounds = ['First round', 'Quarterfinals', 'Semifinals', 'Championship'];
const pointsByRound = [1, 2, 4, 8];
const mountainTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => Number.isFinite(Date.parse(value)) ? `${mountainTime.format(new Date(value))} MT` : '';

function teamsFor(slot, picks) {
  return [slot.home ?? picks[slot.homeFrom], slot.away ?? picks[slot.awayFrom]];
}

export function chooseBracketWinner(slots, picks, gameId, winner) {
  const next = Object.create(null);
  for (const slot of slots) {
    const team = slot.id === gameId ? winner : picks[slot.id];
    if (team && teamsFor(slot, next).includes(team)) next[slot.id] = team;
  }
  return { ...next };
}

export function scoreBracket(slots, picks, results) {
  let points = 0;
  let correct = 0;
  let graded = 0;
  for (const slot of slots) {
    const winner = results[slot.id]?.winner;
    if (!winner || !picks[slot.id]) continue;
    graded++;
    if (picks[slot.id] === winner) {
      correct++;
      points += pointsByRound[slot.round - 1];
    }
  }
  return { points, correct, graded };
}

function sampleBracket(slots) {
  const picks = Object.create(null);
  slots.forEach((slot, index) => { picks[slot.id] = teamsFor(slot, picks)[index % 2]; });
  return picks;
}

function orderedSlots(contest) {
  if (!Array.isArray(contest.slots) || contest.slots.length !== 11 || !date(contest.lockAt)) throw new Error('Invalid bracket');
  const slots = [...contest.slots].sort((left, right) => left.round - right.round);
  const seen = new Map();
  for (const slot of slots) {
    const validSide = (team, feeder) => team ? !feeder : seen.get(feeder) === slot.round - 1;
    if (!slot.id || seen.has(slot.id) || !validSide(slot.home, slot.homeFrom) || !validSide(slot.away, slot.awayFrom)) {
      throw new Error('Invalid bracket game');
    }
    seen.set(slot.id, slot.round);
  }
  if (![4, 4, 2, 1].every((count, index) => slots.filter(slot => slot.round === index + 1).length === count)) {
    throw new Error('Invalid bracket rounds');
  }
  return slots;
}

function bracketView() {
  const tab = location.hash.split('/')[1];
  return ['leaderboard', 'demo'].includes(tab) ? tab : 'entry';
}

function panel(title, text, extra = '') {
  return `<section class="panel"><div class="panel-body"><h2>${title}</h2><p>${text}</p>${extra}</div></section>`;
}

async function getJson(path) {
  const response = await fetch(path, { cache: 'no-cache', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Bracket data unavailable');
  return response.json();
}

async function rpc(client, method, args = {}) {
  const { data, error } = await client.rpc(method, { p_season: season, ...args });
  if (error) throw error;
  return data;
}

function accountButton(session, signInEnabled, busy = false) {
  const disabled = busy ? ' disabled' : '';
  if (session) return `<button type="button" class="button light" data-bracket-action="logout"${disabled}>Sign out</button>`;
  return signInEnabled ? `<button type="button" class="button" data-bracket-action="login"${disabled}>Continue with Google</button>` : '';
}

async function changeAccount(client, action) {
  const { error } = action === 'login'
    ? await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: new URL('/?cfp=1', location.origin).href } })
    : await client.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

function accountError(action) {
  return action === 'login' ? 'Could not start Google sign-in. Please try again.' : 'Could not sign out. Please try again.';
}

function mountWaiting(root, { client, session, signInEnabled, current, refresh }) {
  root.innerHTML = panel('Waiting for the official field', 'Entries will open when the 12-team playoff bracket is published.',
    `${session ? '<p class="compact-note">Signed in.</p>' : ''}<div class="bracket-waiting-actions">${accountButton(session, signInEnabled)}
      <a class="button light" href="#bracket/demo">Open the 2025 demo</a></div><p role="status" class="bracket-message"></p>`);
  const button = root.querySelector('[data-bracket-action]');
  button?.addEventListener('click', async () => {
    const action = button.dataset.bracketAction;
    button.disabled = true;
    try {
      await changeAccount(client, action);
      if (action === 'logout' && current()) refresh();
    } catch {
      if (current()) root.querySelector('.bracket-message').textContent = accountError(action);
      button.disabled = false;
    }
  });
}

function gameCard(slot, index, picks, results, winners, editable) {
  const teams = teamsFor(slot, editable ? picks : winners);
  const result = results[slot.id];
  const selection = picks[slot.id];
  const correct = selection && result?.winner === selection;
  const kickoff = date(slot.kickoff);
  const [actualHome, actualAway] = teamsFor(slot, winners);
  const finalScore = result && Number.isInteger(result.homePoints) && Number.isInteger(result.awayPoints) && actualHome && actualAway
    ? `<p class="bracket-final">Final · ${escape(actualAway)} ${result.awayPoints}–${result.homePoints} ${escape(actualHome)}</p>` : '';
  const matchup = `<span>${escape(teams[1] || 'Winner TBD')}</span><span class="bracket-matchup-vs">vs</span><span>${escape(teams[0] || 'Winner TBD')}</span>`;
  const pick = editable ? `<label id="bracket-label-${index}" for="bracket-pick-${index}">Your winner</label>
    <select id="bracket-pick-${index}" aria-labelledby="bracket-label-${index} bracket-matchup-${index}" data-bracket-game="${escape(slot.id)}"${teams.some(Boolean) ? '' : ' disabled'}>
      <option value="">${teams.some(Boolean) ? 'Choose a team' : 'Pick earlier games first'}</option>
      ${[...new Set(teams.filter(Boolean))].reverse().map(team => `<option value="${escape(team)}"${team === selection ? ' selected' : ''}>${escape(team)}</option>`).join('')}
    </select>` : selection ? `<p class="bracket-selection">Your pick · <strong>${escape(selection)}</strong></p>` : '';
  return `<article class="bracket-game${slot.round === 4 ? ' bracket-title-game' : ''}">
    ${kickoff ? `<time datetime="${escape(slot.kickoff)}">${escape(kickoff)}</time>` : ''}
    <div id="bracket-matchup-${index}" class="bracket-matchup">${matchup}</div>${pick}${finalScore}
    ${selection ? `<p class="bracket-grade${result ? correct ? ' bracket-correct' : ' bracket-missed' : ''}">${result ? correct ? `Correct · +${pointsByRound[slot.round - 1]}` : 'Incorrect' : 'Awaiting final'}</p>` : ''}
  </article>`;
}

function leaderboard(rows) {
  if (!rows.length) return panel('Leaderboard', 'No entries are available yet.');
  return `<section class="panel bracket-board"><div class="panel-body"><h2>Leaderboard</h2><p>Points update when playoff finals are confirmed. Tied entries share a rank.</p></div>
    <table><caption class="sr-only">Playoff bracket standings</caption><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Correct</th><th scope="col">Points</th></tr></thead><tbody>
    ${rows.map(row => `<tr${row.isYou ? ' class="selected"' : ''}><td class="num">${escape(row.rank)}</td><th scope="row">${escape(row.nickname)}${row.isYou ? ' <small>(you)</small>' : ''}</th><td class="num">${escape(row.correct)}</td><td class="num"><strong>${escape(row.points)}</strong></td></tr>`).join('')}
    </tbody></table></section>`;
}

function mountContest(root, contest, { demo = false, client, session, entry, signInEnabled, current, refresh }) {
  const slots = orderedSlots(contest);
  const results = contest.results ?? {};
  const winners = Object.fromEntries(Object.entries(results).map(([id, result]) => [id, result.winner]));
  const locked = () => contest.locked || Date.now() >= Date.parse(contest.lockAt);
  const editable = () => demo || (session && !locked());
  let picks = chooseBracketWinner(slots, entry?.picks ?? {});
  let nickname = entry?.nickname ?? '';
  let message = '';
  let busy = false;
  const canSave = () => [...nickname.trim()].length >= 2 && Object.keys(picks).length === slots.length;

  function draw(focusId) {
    const { points, correct, graded } = scoreBracket(slots, picks, results);
    const selected = Object.keys(picks).length;
    const open = editable();
    const actions = demo ? '<button type="button" class="button light" data-bracket-action="sample">Fill sample picks</button>'
      : accountButton(session, signInEnabled, busy);
    root.innerHTML = `<section class="panel bracket-summary"><div class="panel-body">
      <div class="bracket-heading"><div><div class="section-label">${demo ? 'Historical demo' : `${season} contest`}</div>
      <h2>${demo ? 'Replay the 2025 playoff' : locked() ? 'Entries are locked' : 'Pick the playoff winners'}</h2></div>${actions}</div>
      <p>${demo ? 'Make practice picks and see how they would have scored against the actual results.'
        : `One bracket per account. Picks lock at <time datetime="${escape(contest.lockAt)}">${escape(date(contest.lockAt))}</time>.`}</p>
      ${!demo && !session && !signInEnabled ? '<p class="compact-note">Sign-in is currently unavailable.</p>' : ''}
      <p class="compact-note">Correct picks earn 1, 2, 4 and 8 points by round, up to 28 points.</p>
      ${selected ? `<p class="bracket-progress">${selected} of 11 picks${graded ? ` · ${correct} of ${graded} correct · ${points} points` : ''}</p>` : ''}
      <p role="status" class="bracket-message">${escape(message)}</p>
      </div></section>
      <form data-bracket-form><div class="bracket-rounds">
      ${rounds.map((round, index) => `<section class="bracket-round" aria-label="${round}"><h3>${round} <small>${pointsByRound[index]} ${index === 0 ? 'pt' : 'pts'} each</small></h3>
      ${slots.map((slot, slotIndex) => slot.round === index + 1 ? gameCard(slot, slotIndex, picks, results, winners, open) : '').join('')}</section>`).join('')}
      </div>${open && !demo ? `<div class="panel bracket-save"><div class="panel-body"><label for="bracket-nickname">Leaderboard nickname</label>
      <input id="bracket-nickname" name="nickname" required minlength="2" maxlength="30" value="${escape(nickname)}" autocomplete="nickname">
      <button type="submit" class="button" data-bracket-save${!canSave() || busy ? ' disabled' : ''}>${busy ? 'Saving…' : 'Save bracket'}</button></div></div>` : ''}</form>`;
    if (focusId) root.querySelector(`#${focusId}`)?.focus({ preventScroll: true });
  }

  root.onchange = event => {
    const control = event.target;
    if (!control.matches('[data-bracket-game]') || !editable() || busy) return;
    picks = chooseBracketWinner(slots, picks, control.dataset.bracketGame, control.value);
    message = '';
    draw(control.id);
  };
  root.oninput = event => {
    if (event.target.id !== 'bracket-nickname') return;
    nickname = event.target.value;
    root.querySelector('[data-bracket-save]').disabled = !canSave() || busy;
  };
  root.onsubmit = async event => {
    event.preventDefault();
    if (demo || !editable() || !canSave() || busy) return;
    busy = true;
    draw();
    try {
      await rpc(client, 'cfp_save_entry', { p_nickname: nickname.trim(), p_picks: picks });
      message = 'Bracket saved.';
    } catch {
      message = 'Your bracket could not be saved. Check the nickname and deadline, then try again.';
    } finally {
      busy = false;
      if (current()) draw();
    }
  };
  root.onclick = async event => {
    const action = event.target.closest('[data-bracket-action]')?.dataset.bracketAction;
    if (action === 'sample') {
      picks = sampleBracket(slots);
      draw();
    }
    if (!['login', 'logout'].includes(action) || busy) return;
    busy = true;
    draw();
    try {
      await changeAccount(client, action);
      if (action === 'logout' && current()) refresh();
    } catch {
      busy = false;
      message = accountError(action);
      if (current()) draw();
    }
  };
  draw();
}

export async function renderBracket(main) {
  const view = bracketView();
  if (main.querySelector('[data-bracket-view]')?.dataset.bracketView === view) return;
  main.innerHTML = `<section class="hero page-banner"><div class="wrap"><div class="eyebrow">College Football Playoff · Fan contest</div>
    <h1>Playoff Bracket</h1><p>Pick the winners, follow the results, and see where your bracket stands.</p></div></section>
    <div class="wrap page-content bracket-page" data-bracket-view="${view}"><nav class="matchup-views bracket-tabs" aria-label="Playoff bracket">
    ${[['entry', '#bracket', 'My bracket'], ['leaderboard', '#bracket/leaderboard', 'Leaderboard'], ['demo', '#bracket/demo', '2025 demo']].map(([tab, path, label]) => `<a href="${path}"${tab === view ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
    </nav><div data-bracket-content><p class="compact-note" role="status">Loading the bracket…</p></div></div>`;
  const root = main.querySelector('[data-bracket-content]');
  const current = () => root.isConnected && location.hash.split('/')[0] === '#bracket' && bracketView() === view;
  const refresh = () => {
    root.closest('[data-bracket-view]').remove();
    void renderBracket(main);
  };
  try {
    if (view === 'demo') {
      const contest = await getJson('/bracket-demo.json');
      if (current()) mountContest(root, contest, { demo: true, current });
      return;
    }
    const config = await getJson('/bracket-config.json');
    if (!current()) return;
    if (!config?.url || !config.publishableKey || config.enabled === false) {
      root.innerHTML = panel('Bracket entries are coming', 'Try the 2025 demo to see how picks and scoring work.', '<a class="button light bracket-retry" href="#bracket/demo">Open the 2025 demo</a>');
      return;
    }
    const client = await loadBracketClient(config);
    const { data, error } = await client.auth.getSession();
    const callback = new URL(location.href);
    if (callback.searchParams.has('cfp')) {
      for (const key of ['cfp', 'code', 'error', 'error_code', 'error_description']) callback.searchParams.delete(key);
      history.replaceState(null, '', callback);
    }
    if (error) throw error;
    const session = data?.session;
    const contest = await rpc(client, 'cfp_contest');
    const signInEnabled = view === 'entry' && !session && await googleSignInEnabled(config);
    if (!current()) return;
    if (!contest) {
      mountWaiting(root, { client, session: view === 'entry' ? session : null, signInEnabled, current, refresh });
    } else if (view === 'leaderboard') {
      const rows = contest.locked || Date.now() >= Date.parse(contest.lockAt) ? await rpc(client, 'cfp_leaderboard') : null;
      if (current()) root.innerHTML = rows ? leaderboard(rows) : panel('Leaderboard opens at kickoff', 'Enter your bracket before the first game to appear in the standings.');
    } else {
      const entry = session ? await rpc(client, 'cfp_my_entry') : null;
      if (current()) mountContest(root, contest, { client, session, entry, signInEnabled, current, refresh });
    }
  } catch {
    if (!current()) return;
    root.innerHTML = panel('Bracket temporarily unavailable', 'Try again in a moment.', '<button type="button" class="button light bracket-retry">Try again</button>');
    root.querySelector('button').addEventListener('click', refresh);
  }
}
