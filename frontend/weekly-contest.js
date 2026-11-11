import { googleSignInEnabled, loadBracketClient } from './bracket-auth.js';
import { renderWeeklyTeamStats } from './weekly-team-stats.js';
import {
  contestGames, contestGameLocked, contestGameWinner, contestPickChanges,
  contestWeekKey, contestWeekLabel, defaultContestWeek, scoreContestPicks,
} from './weekly-contest-score.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mountainTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const date = value => Number.isFinite(Date.parse(value)) ? `${mountainTime.format(new Date(value))} MT` : '';
const percent = value => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
let stopCurrent;

export function unmountWeeklyContest() {
  stopCurrent?.();
  stopCurrent = undefined;
}

export function renderContestScores(games, picks, week) {
  return `<div class="contest-score-grid">${[[contestWeekLabel(week), week], ['Season', null]].map(([label, key]) => {
    const score = scoreContestPicks(games, picks, key);
    return `<section class="contest-score"><h3>${escape(label)} head to head</h3><div class="contest-versus">
      <div><span>Your points</span><strong>${score.graded ? score.points : '—'}</strong><small>${score.graded ? `${score.correct} right · ${score.wrong} wrong · ${percent(score.accuracy)}` : 'No decided saved picks yet'}</small></div>
      <div><span>Model on your games</span><strong>${score.graded ? score.modelCorrect : '—'}</strong><small>${score.graded ? `${score.modelCorrect} of ${score.graded} right · ${percent(score.modelAccuracy)}` : 'Compared on the same games'}</small></div>
      </div><p>${score.pending} saved ${score.pending === 1 ? 'pick awaiting' : 'picks awaiting'} a result${score.voided ? ` · ${score.voided} excluded` : ''}. One point per correct pick.</p></section>`;
  }).join('')}</div>`;
}

function teamName(game, side, teams) {
  return game[`${side}Name`] || teams?.get(game[side])?.name || game[side];
}

export function renderContestGames(games, { saved = {}, draft = {}, teams, signedIn = false, busy = false, now = Date.now() } = {}) {
  if (!games.length) return '<p class="contest-empty">No eligible saved model forecasts are available for this week yet.</p>';
  return `<ul class="contest-games" aria-label="Weekly contest games">${games.map(game => {
    const locked = contestGameLocked(game, now);
    const winner = contestGameWinner(game);
    const selected = locked ? saved[game.id] : draft[game.id];
    const changed = selected && selected !== saved[game.id] && !locked;
    const modelSide = game.modelTeam === game.home ? 'home' : 'away';
    const modelProbability = modelSide === 'home' ? game.homeWinProbability : 1 - game.homeWinProbability;
    const userGrade = winner && saved[game.id] ? saved[game.id] === winner ? 'correct' : 'wrong' : '';
    const status = game.voidReason ? 'Excluded from scoring' : winner ? 'Final' : locked ? 'Locked' : 'Open';
    const note = game.voidReason ? game.voidReason
      : winner ? `${saved[game.id] ? `Your pick: ${userGrade === 'correct' ? 'correct · +1 point' : 'incorrect · 0 points'}. ` : 'No saved pick. ' }Model: ${game.modelTeam === winner ? 'correct' : 'incorrect'}.`
        : changed ? 'Unsaved selection' : saved[game.id] ? 'Pick saved' : locked ? 'No saved pick before kickoff' : signedIn ? 'Select your winner, then save picks.' : 'Sign in to make your pick.';
    return `<li class="contest-game"><div class="contest-game-meta"><time datetime="${escape(game.startDate)}">${escape(date(game.startDate))}</time>
      <span class="contest-lock${!locked ? ' contest-open' : ''}">${status}</span></div>
      <h3>${escape(teamName(game, 'away', teams))} at ${escape(teamName(game, 'home', teams))}</h3>
      <p class="contest-model-pick">Model: <strong>${escape(teamName(game, modelSide, teams))}</strong> · ${percent(modelProbability)}
        <span class="sr-only">win probability, saved ${escape(date(game.modelCapturedAt))}</span></p>
      ${['away', 'home'].map(side => `<button type="button" class="contest-team${winner === game[side] ? ' is-winner' : ''}" data-contest-game="${escape(game.id)}" data-contest-team="${escape(game[side])}"
        aria-pressed="${selected === game[side]}"${!signedIn || locked || busy ? ' disabled' : ''}>
        <span>${escape(teamName(game, side, teams))}</span><small>${winner ? escape(game[`${side}Points`]) : selected === game[side] ? changed ? 'Unsaved' : 'Your pick' : 'Pick'}</small></button>`).join('')}
      <p class="contest-pick-status${userGrade ? ` is-${userGrade}` : ''}">${escape(note)}</p>
      <div data-contest-team-stats="${escape(game.id)}"></div></li>`;
  }).join('')}</ul>`;
}

export function renderContestLeaderboard(board, label) {
  if (!board || !Array.isArray(board.rows)) return '<p class="contest-empty">The leaderboard is unavailable. Refresh to try again.</p>';
  const rows = [...board.rows];
  if (board.me && !rows.some(row => row.isYou)) rows.push({ ...board.me, isYou: true });
  const model = board.model;
  return `<div class="contest-heading"><h3>${escape(label)} leaderboard</h3></div>
    <p class="compact-note">Ranked by points. Tied scores share a place. The model column grades the same games each player picked.</p>
    ${rows.length ? `<table class="contest-leaderboard"><caption class="sr-only">${escape(label)} Beat the Model standings</caption>
      <thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Points</th><th scope="col">Decided</th><th scope="col">Model</th></tr></thead><tbody>
      ${rows.map(row => `<tr${row.isYou ? ' class="is-you"' : ''}><td>${escape(row.rank ?? '—')}</td><th scope="row">${escape(row.nickname)}${row.isYou ? ' <small>You</small>' : ''}</th>
        <td><strong>${escape(row.points)}</strong></td><td>${escape(row.correct)} / ${escape(row.graded)}<small>${escape(row.picked)} picked</small></td>
        <td>${escape(row.modelCorrect)} / ${escape(row.compared)}<small>${row.compared ? row.points > row.modelCorrect ? 'Ahead of model' : row.points === row.modelCorrect ? 'Tied with model' : 'Behind model' : 'Awaiting results'}</small></td></tr>`).join('')}
      </tbody></table>` : '<p class="contest-empty">No players have joined this public leaderboard yet.</p>'}
    ${model && Number.isInteger(model.graded) && Number.isInteger(model.correct) ? `<p class="compact-note">Model overall: ${model.correct} of ${model.graded} decided eligible games correct.</p>` : ''}`;
}

async function getConfig() {
  const response = await fetch('/bracket-config.json', { cache: 'no-cache', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Contest configuration unavailable');
  return response.json();
}

async function getTeamStats(statsUrl, season) {
  if (!statsUrl) return null;
  try {
    const response = await fetch(statsUrl, { cache: 'no-cache', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const stats = await response.json();
    return stats?.schemaVersion === 1 && stats.season === season ? stats : null;
  } catch {
    return null;
  }
}

function cleanEntry(entry, games) {
  const picks = Object.fromEntries(games.filter(game => [game.home, game.away].includes(entry?.picks?.[game.id]))
    .map(game => [game.id, entry.picks[game.id]]));
  return { nickname: typeof entry?.nickname === 'string' ? entry.nickname : '', publicLeaderboard: entry?.publicLeaderboard === true, picks };
}

export async function renderWeeklyContest(main, { teams = new Map(), season = 2026, statsUrl } = {}) {
  if (main.querySelector('[data-weekly-contest]')) return;
  unmountWeeklyContest();
  main.innerHTML = `<section class="hero page-banner"><div class="wrap"><div class="eyebrow">Weekly picks · ${escape(season)}</div>
    <h1>Beat the Model</h1><p>Make your picks before kickoff. See how you stack up, one game at a time.</p></div></section>
    <div class="wrap page-content contest-page" data-weekly-contest><div data-contest-content><p role="status">Loading the weekly contest…</p></div></div>`;
  const root = main.querySelector('[data-contest-content]');
  let active = true, timer, subscription;
  const current = () => active && root.isConnected;
  stopCurrent = () => {
    active = false;
    clearInterval(timer);
    subscription?.unsubscribe();
    root.onclick = root.onchange = root.oninput = root.onsubmit = null;
  };
  const unavailable = (heading, message) => {
    if (!current()) return;
    root.innerHTML = `<section class="panel"><div class="panel-body"><h2>${escape(heading)}</h2><p>${escape(message)}</p>
      <button type="button" class="button light contest-refresh" data-contest-retry>Try again</button></div></section>`;
    root.onclick = event => {
      if (!event.target.closest('[data-contest-retry]')) return;
      main.querySelector('[data-weekly-contest]').remove();
      void renderWeeklyContest(main, { teams, season, statsUrl });
    };
  };

  const statsRequest = getTeamStats(statsUrl, season);
  try {
    const config = await getConfig();
    if (!current()) return;
    if (!config?.url || !config.publishableKey || config.enabled === false) {
      unavailable('The weekly contest is getting ready', 'Saved pregame picks and standings will appear here when the contest opens.');
      return;
    }
    const client = await loadBracketClient(config);
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    let session = sessionResult.data?.session;
    const signInEnabled = !session && await googleSignInEnabled(config);
    if (!current()) return;
    let contest, games = [], entry = { nickname: '', publicLeaderboard: false, picks: {} }, draft = {};
    let nickname = '', publicLeaderboard = false, week = '', view = 'picks', boardScope = 'week';
    let board = null, boardError = false, boardBusy = false, boardRequest = 0;
    let busy = false, message = '', messageError = false, clockOffset = 0, boundary = '';
    let teamStats;
    const expandedTeamStats = new Set();

    function showTeamStats() {
      if (!current() || !teamStats) return;
      const gamesById = new Map(games.map(game => [game.id, game]));
      for (const slot of root.querySelectorAll('[data-contest-team-stats]')) {
        const game = gamesById.get(slot.dataset.contestTeamStats);
        if (!game || slot.hasChildNodes()) continue;
        slot.innerHTML = renderWeeklyTeamStats(teamStats, game, {
          awayName: teamName(game, 'away', teams), homeName: teamName(game, 'home', teams),
        });
        if (expandedTeamStats.has(game.id)) slot.querySelector('details')?.setAttribute('open', '');
      }
    }

    void statsRequest.then(stats => {
      teamStats = stats;
      showTeamStats();
    });

    const now = () => Date.now() + clockOffset;
    const rpc = async (method, args = {}) => {
      const { data, error } = await client.rpc(method, { p_season: season, ...args });
      if (error) throw error;
      return data;
    };
    const changes = () => contestPickChanges(games, entry.picks, draft, now());
    const dirty = () => Object.keys(changes()).length > 0 || nickname.trim() !== entry.nickname || publicLeaderboard !== entry.publicLeaderboard;
    const canSave = () => session && dirty() && [...nickname.trim()].length >= 2 && [...nickname.trim()].length <= 30 && !busy;
    const refreshBoard = async () => {
      const request = ++boardRequest;
      boardBusy = true;
      boardError = false;
      if (view === 'leaderboard') draw();
      try {
        const [p_season_type, rawWeek] = week.split(':');
        const result = await rpc('weekly_leaderboard', boardScope === 'season' ? {} : { p_season_type, p_week: Number(rawWeek) });
        if (current() && request === boardRequest) board = result;
      } catch {
        if (current() && request === boardRequest) { board = null; boardError = true; }
      } finally {
        if (current() && request === boardRequest) { boardBusy = false; if (view === 'leaderboard') draw(); }
      }
    };
    const loadData = async ({ keepDraft = false } = {}) => {
      const previousChanges = keepDraft ? changes() : {};
      const nextContest = await rpc('weekly_contest');
      const nextGames = contestGames(nextContest);
      const nextEntry = session ? cleanEntry(await rpc('weekly_entry'), nextGames) : cleanEntry(null, nextGames);
      if (!current()) return;
      contest = nextContest;
      games = nextGames;
      clockOffset = Date.parse(contest.serverNow) - Date.now();
      entry = nextEntry;
      draft = { ...entry.picks, ...contestPickChanges(games, entry.picks, previousChanges, now()) };
      if (!keepDraft) { nickname = entry.nickname; publicLeaderboard = entry.publicLeaderboard; }
      if (!games.some(game => contestWeekKey(game) === week)) week = defaultContestWeek(games, now());
      boundary = games.map(game => Number(contestGameLocked(game, now()))).join('');
    };

    function draw(focusGame) {
      if (!current()) return;
      for (const details of root.querySelectorAll('[data-contest-team-stats] details')) {
        const gameId = details.closest('[data-contest-team-stats]').dataset.contestTeamStats;
        if (details.open) expandedTeamStats.add(gameId);
        else expandedTeamStats.delete(gameId);
      }
      const selectedGames = games.filter(game => contestWeekKey(game) === week);
      const weeks = [...new Set(games.map(contestWeekKey))];
      const open = selectedGames.filter(game => !contestGameLocked(game, now())).length;
      const pending = Object.keys(changes()).length;
      root.innerHTML = `<section class="panel"><div class="panel-body"><div class="contest-heading"><div><div class="section-label">${season} season</div>
        <h2>Your picks against the model</h2></div><div class="contest-actions">${session
          ? `<span class="compact-note">Signed in</span><button class="button light" type="button" data-contest-action="logout"${busy ? ' disabled' : ''}>Sign out</button>`
          : signInEnabled ? `<button class="button" type="button" data-contest-action="login"${busy ? ' disabled' : ''}>Continue with Google</button>` : '<span class="compact-note">Sign-in is currently unavailable.</span>'}</div></div>
        <p>Pick one winner per game. Each pick locks at that game’s kickoff and earns one point if correct. Only model forecasts saved before kickoff qualify.</p>
        ${!session ? '<p class="compact-note">Use the same Google login as your playoff bracket. Save your picks to start your record.</p>' : ''}
        <div class="contest-controls"><label for="contest-week">Select week</label><select id="contest-week"${busy || !weeks.length ? ' disabled' : ''}>
        ${weeks.map(key => `<option value="${escape(key)}"${key === week ? ' selected' : ''}>${escape(contestWeekLabel(key))}</option>`).join('')}</select>
        <button type="button" class="button light" data-contest-action="refresh"${busy ? ' disabled' : ''}>Refresh results</button>
        <a class="button light" href="#compare/weekly">Model picks and results</a></div>
        <p class="compact-note">${contest.observedAt ? `Results updated ${escape(date(contest.observedAt))}. ` : ''}${open} ${open === 1 ? 'game open' : 'games open'} for this week. Times are Mountain Time.</p>
        ${week ? renderContestScores(games, entry.picks, week) : '<p class="contest-empty">The contest will open when an eligible upcoming model forecast is saved.</p>'}
        <p class="contest-message${messageError ? ' is-error' : ''}" role="status" aria-live="polite">${escape(message)}</p></div></section>
        <nav class="matchup-views contest-tabs" aria-label="Weekly contest views"><button type="button" class="button${view === 'picks' ? '' : ' light'}" data-contest-view="picks" aria-pressed="${view === 'picks'}">My picks</button>
        <button type="button" class="button${view === 'leaderboard' ? '' : ' light'}" data-contest-view="leaderboard" aria-pressed="${view === 'leaderboard'}">Leaderboards</button></nav>
        ${view === 'picks' ? `<section class="panel"><div class="panel-body"><div class="contest-heading"><h2>${week ? escape(contestWeekLabel(week)) : 'Upcoming games'}</h2><span class="compact-note">${selectedGames.length} eligible games</span></div>
          ${renderContestGames(selectedGames, { saved: entry.picks, draft, teams, signedIn: Boolean(session), busy, now: now() })}
          ${session ? `<form data-contest-save class="contest-save-row"><label for="contest-nickname">Leaderboard nickname</label>
            <input id="contest-nickname" name="nickname" value="${escape(nickname)}" minlength="2" maxlength="30" autocomplete="nickname" required${busy ? ' disabled' : ''}>
            <span class="contest-save-state" data-contest-save-state>${dirty() ? `${pending} unsaved ${pending === 1 ? 'pick' : 'picks'}${pending ? '' : ' · profile changed'}` : Object.keys(entry.picks).length ? 'All picks saved' : 'No picks saved yet'}</span>
            <button type="submit" class="button" data-contest-save-button${canSave() ? '' : ' disabled'}>${busy ? 'Saving…' : 'Save picks'}</button>
            <label class="contest-public"><input type="checkbox" id="contest-public"${publicLeaderboard ? ' checked' : ''}${busy ? ' disabled' : ''}> Show my nickname and scores on public leaderboards</label>
            <p class="compact-note">You can save a few games at a time and change each pick before its kickoff. Your scorecard uses saved picks.</p></form>` : ''}</div></section>`
          : `<section class="panel"><div class="panel-body"><div class="contest-controls"><label for="contest-board-scope">Standings</label><select id="contest-board-scope"><option value="week"${boardScope === 'week' ? ' selected' : ''}>${escape(contestWeekLabel(week))}</option><option value="season"${boardScope === 'season' ? ' selected' : ''}>Season</option></select></div>
            ${boardBusy ? '<p role="status" class="contest-empty">Loading standings…</p>' : renderContestLeaderboard(boardError ? null : board, boardScope === 'week' ? contestWeekLabel(week) : 'Season')}
            <p class="compact-note">Public standings show up to 100 players and your own entry. You control whether your nickname appears publicly.</p></div></section>`}`;
      showTeamStats();
      if (focusGame) root.querySelector(`[data-contest-game="${CSS.escape(focusGame)}"][aria-pressed="true"]`)?.focus({ preventScroll: true });
    }

    await loadData();
    if (!current()) return;
    draw();
    root.oninput = event => {
      if (event.target.id !== 'contest-nickname') return;
      nickname = event.target.value;
      root.querySelector('[data-contest-save-button]').disabled = !canSave();
      root.querySelector('[data-contest-save-state]').textContent = dirty() ? `${Object.keys(changes()).length} unsaved picks · profile changed` : 'All picks saved';
    };
    root.onchange = event => {
      if (event.target.id === 'contest-week') {
        week = event.target.value;
        draw();
        if (view === 'leaderboard' && boardScope === 'week') void refreshBoard();
      } else if (event.target.id === 'contest-public') {
        publicLeaderboard = event.target.checked;
        root.querySelector('[data-contest-save-button]').disabled = !canSave();
        root.querySelector('[data-contest-save-state]').textContent = dirty() ? `${Object.keys(changes()).length} unsaved picks · profile changed` : 'All picks saved';
      } else if (event.target.id === 'contest-board-scope') {
        boardScope = event.target.value;
        void refreshBoard();
      }
    };
    root.onsubmit = async event => {
      if (!event.target.matches('[data-contest-save]')) return;
      event.preventDefault();
      if (!canSave()) return;
      busy = true;
      messageError = false;
      message = 'Saving your picks…';
      const pending = changes();
      draw();
      try {
        const result = await rpc('weekly_save_picks', { p_nickname: nickname.trim(), p_picks: pending, p_public: publicLeaderboard });
        if (!result || !result.picks || typeof result.nickname !== 'string') throw new Error('Save was not confirmed');
        entry = cleanEntry(result, games);
        draft = { ...entry.picks };
        nickname = entry.nickname;
        publicLeaderboard = entry.publicLeaderboard;
        message = 'Picks saved. You can change each pick until its game kicks off.';
        void refreshBoard();
      } catch {
        messageError = true;
        message = 'Could not confirm your save. A game may have locked. Refresh results to check your saved picks, then try again.';
      } finally {
        busy = false;
        if (current()) draw();
      }
    };
    root.onclick = async event => {
      const choice = event.target.closest('[data-contest-game][data-contest-team]');
      if (choice) {
        const game = games.find(game => game.id === choice.dataset.contestGame);
        if (!session || busy || !game || contestGameLocked(game, now()) || ![game.home, game.away].includes(choice.dataset.contestTeam)) return;
        draft[game.id] = choice.dataset.contestTeam;
        message = 'Selection changed. Save picks to enter it.';
        messageError = false;
        draw(game.id);
        return;
      }
      const tab = event.target.closest('[data-contest-view]')?.dataset.contestView;
      if (['picks', 'leaderboard'].includes(tab)) {
        view = tab;
        draw();
        if (view === 'leaderboard') void refreshBoard();
        return;
      }
      const action = event.target.closest('[data-contest-action]')?.dataset.contestAction;
      if (busy || !['login', 'logout', 'refresh'].includes(action)) return;
      busy = true;
      draw();
      try {
        if (action === 'refresh') {
          await loadData({ keepDraft: true });
          message = 'Results refreshed. Open unsaved selections are still here.';
          messageError = false;
          if (view === 'leaderboard') void refreshBoard();
        } else if (action === 'login') {
          const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: new URL('/?weekly=1', location.origin).href } });
          if (error) throw error;
        } else {
          const { error } = await client.auth.signOut({ scope: 'local' });
          if (error) throw error;
          session = null;
          main.querySelector('[data-weekly-contest]')?.remove();
          void renderWeeklyContest(main, { teams, season, statsUrl });
          return;
        }
      } catch {
        messageError = true;
        message = action === 'refresh' ? 'Results could not refresh. Your current selections are still here.' : action === 'login' ? 'Could not start Google sign-in. Please try again.' : 'Could not sign out. Please try again.';
      } finally {
        busy = false;
        if (current()) draw();
      }
    };
    subscription = client.auth.onAuthStateChange?.((event, nextSession) => {
      if (!['SIGNED_IN', 'SIGNED_OUT'].includes(event) || nextSession?.user?.id === session?.user?.id) return;
      setTimeout(() => {
        if (!current()) return;
        main.querySelector('[data-weekly-contest]')?.remove();
        void renderWeeklyContest(main, { teams, season, statsUrl });
      }, 0);
    })?.data?.subscription;
    timer = setInterval(() => {
      if (!current() || busy) return;
      const next = games.map(game => Number(contestGameLocked(game, now()))).join('');
      if (next !== boundary) {
        boundary = next;
        message = 'A game has reached kickoff and its pick is locked.';
        messageError = false;
        draw();
      }
    }, 1_000);
  } catch {
    unavailable('The weekly contest could not load', 'Try again in a moment. Your saved picks remain on your account.');
  }
}
