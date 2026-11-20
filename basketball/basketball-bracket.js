import {
  bracketEdition, bracketTeams, buildBracket, chooseBasketballWinner, fillBasketballBracket,
  gradeBasketballBracket, practiceBasketballField, projectBasketballField, reconcileBracketPicks, ROUND_NAMES,
} from './bracket.js';
import {historicalBasketballField} from './bracket-archive.js';

const ncaaRules = 'https://www.ncaa.org/championships/march-madness/selections-101/division-i-mens-basketball-championship/';
const ncaaSites = 'https://www.ncaa.org/news/march-basketball/wichita-to-serve-as-2027-and-2028-opening-round-host-for-march-madness/';
const stadiumDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Denver',
});
const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const percent = value => new Intl.NumberFormat('en-US', {style: 'percent', maximumFractionDigits: 1}).format(value);
const choice = (value, label, current) => '<option value="' + esc(value) + '"' +
  (String(value) === String(current) ? ' selected' : '') + '>' + esc(label) + '</option>';
const reasonableChance = value => typeof value === 'number' && value >= 0 && value <= 1;
const internalHref = value => typeof value === 'string' && /^\/basketball(?:\/|[?#]|$)/.test(value) ? value : null;

function officialSource(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && ['www.ncaa.com', 'ncaa.com', 'www.ncaa.org', 'ncaa.org'].includes(url.hostname)) return url.href;
  } catch {
    return null;
  }
  return null;
}

/** Mount only from the private preview app. Hooks accept the basketball namespace. */
export function mountBasketballBracket(root, {
  season = 2027, rankings = [], modelAsOf, forecast, teamHref, matchupHref,
  previewProfile, storage, officialBracket, excludedTeamIds = [],
} = {}) {
  const officialArchive = buildBracket(historicalBasketballField(2026));
  const projected = projectBasketballField(season, rankings, {excludedTeamIds});
  const projection = projected ? buildBracket(projected) : null;
  const practice = buildBracket(practiceBasketballField(2027));
  const official = officialBracket?.mode === 'official' && officialBracket.year === season &&
    officialSource(officialBracket.sourceUrl) && Number.isFinite(Date.parse(officialBracket.announcedAt)) &&
    Date.parse(officialBracket.announcedAt) <= Date.now() ? buildBracket(officialBracket) : null;
  const profileId = typeof previewProfile?.id === 'string' && /^[\w-]{1,100}$/.test(previewProfile.id) ? previewProfile.id : null;
  const savedKey = bracket => profileId ? 'gd-private-preview:mbb:' + profileId + ':' + bracketEdition(bracket) : null;
  const memory = new Map();
  const state = {
    mode: 'official', field: 'current', practiceField: projection ? 'projection' : 'format',
    region: 'east', round: 'all', notice: '',
  };
  let boardObserver;
  const smallScreen = () => root.ownerDocument.defaultView?.matchMedia('(max-width: 860px)').matches;
  const roundName = (round, bracket) => round === 0 && bracket.field.year < 2027 ? 'First Four' : ROUND_NAMES[round];

  function readDraft(bracket) {
    let picks = {};
    const key = savedKey(bracket);
    if (key && storage) {
      try {
        const draft = JSON.parse(storage.getItem(key) ?? 'null');
        if (draft?.edition === bracketEdition(bracket) && draft.picks && typeof draft.picks === 'object') {
          picks = reconcileBracketPicks(bracket, draft.picks);
        }
      } catch {
        // The draft is optional. Missing or invalid local storage starts a fresh practice bracket.
      }
    }
    return picks;
  }

  function load(bracket) {
    if (!memory.has(bracket)) memory.set(bracket, readDraft(bracket));
    return memory.get(bracket);
  }

  function chooseDisplayField() {
    if (state.mode === 'official') return state.field === 'archive' ? officialArchive : official;
    if (state.mode === 'projection') return projection;
    if (state.practiceField === 'archive') return officialArchive;
    if (state.practiceField === 'official' && official) return official;
    return state.practiceField === 'projection' && projection ? projection : practice;
  }

  function probability(bracket, a, b) {
    if ((bracket !== projection && bracket !== official) || !a || !b || typeof forecast !== 'function') return null;
    const value = forecast(a, b);
    return reasonableChance(value) ? value : null;
  }

  function methodNote() {
    const at = Number.isFinite(Date.parse(modelAsOf)) ? ' Data cutoff ' + stadiumDate.format(new Date(modelAsOf)) + ' MT.' : '';
    return '<details class="bb-bracket-method"><summary>How we project the field</summary>' +
      '<p>We assume each conference’s eligible SOR leader wins its automatic bid, then add 44 at-large teams by SOR. ' +
      'The lowest 12 in each bid group start in the Opening Round. We place two automatic matchups on seed line 15 ' +
      'and four on line 16, then spread the remaining slots across regions by SOR.' + esc(at) + '</p>' +
      '<p>This early-season scenario uses the eligibility information available in the preview. It leaves conference tournament outcomes, ' +
      'travel rules, crowd considerations and rematch protections unresolved. Game odds use neutral-site GD forecasts.</p></details>';
  }

  function introductoryState() {
    if (state.mode === 'official') {
      return '<div class="bb-bracket-empty"><p class="bb-bracket-kicker">2027 tournament</p>' +
        '<h2>Selection Sunday is ahead</h2><p>The NCAA will reveal the official teams, seeds and matchups on Selection Sunday. ' +
        'The 12 Opening Round games are scheduled for March 16–17 in Dayton and Wichita.</p>' +
        '<div class="bb-bracket-counts"><span><strong>76</strong> teams</span><span><strong>32</strong> automatic bids</span>' +
        '<span><strong>44</strong> at-large bids</span></div><div class="bb-bracket-actions">' +
        '<button type="button" class="bb-bracket-primary" data-bracket-action="demo">Try the 76-team format</button>' +
        '<a href="' + ncaaSites + '">NCAA Opening Round details</a></div></div>';
    }
    return '<div class="bb-bracket-empty"><h2>Projection needs more coverage</h2>' +
      '<p>We’ll show a projected field once the season rankings support all 32 automatic bids and 44 at-large places.</p>' +
      '<button type="button" class="bb-bracket-primary" data-bracket-action="demo">Try the 76-team format</button></div>';
  }

  function formatTeam(team, id, game, bracket, result, picks, both, score, editing) {
    if (!team) {
      const source = bracket.games.find(item => item.id === game.sides[id].from);
      const from = source ? roundName(source.round, bracket) + (source.round === 0 ? ', seed ' + game.sides[id].from.split('-').at(-1) : '') : 'earlier game';
      return '<span class="bb-bracket-team bb-bracket-tbd">Winner from ' + esc(from) + '</span>';
    }
    const selected = picks[game.id] === team.id;
    const winner = result?.winner === team.id;
    const name = '<span class="bb-bracket-seed" aria-label="Seed ' + team.seed + '">' + team.seed + '</span>' +
      '<span class="bb-bracket-name">' + esc(team.name) + ((selected || winner) ? ' <span aria-hidden="true">✓</span>' : '') + '</span>' +
      (score == null ? '' : '<strong class="bb-bracket-score">' + score + '</strong>');
    const css = 'bb-bracket-team' + (selected ? ' is-selected' : '') + (winner ? ' is-winner' : '');
    if (editing) {
      return '<button type="button" class="' + css + '" data-bracket-game="' + esc(game.id) +
        '" data-bracket-team="' + esc(team.id) + '" aria-pressed="' + selected +
        '" aria-label="' + esc('Advance ' + team.name + ', seed ' + team.seed) + '"' + (both ? '' : ' disabled') + '>' + name + '</button>';
    }
    const href = bracket !== practice && internalHref(teamHref?.(team.id, bracket.field.year));
    return href ? '<a class="' + css + '" href="' + esc(href) + '">' + name + '</a>' : '<span class="' + css + '">' + name + '</span>';
  }

  function card(game, bracket, picks, editing) {
    const ids = bracketTeams(game, picks);
    const both = ids.every(Boolean);
    const actual = bracket.results[game.id];
    const result = !editing && state.mode === 'official' ? actual : null;
    const chance = probability(bracket, ...ids);
    const selected = picks[game.id];
    const linked = both && bracket !== practice && internalHref(matchupHref?.(...ids, bracket.field.year));
    const destination = bracket.games.find(item => item.sides.some(side => side.from === game.id));
    return '<article class="bb-bracket-game" data-bracket-slot="' + esc(game.id) + '">' +
      (game.round === 0 ? '<p class="bb-bracket-path">Winner fills seed ' + bracket.teams[ids[0]].seed + ' in the First Round</p>' : '') +
      ids.map((id, index) => formatTeam(bracket.teams[id], index, game, bracket, result, picks, both, result?.scores[index], editing)).join('') +
      (chance == null ? '' : '<div class="bb-bracket-odds"><span>GD neutral win chance</span><strong>' +
        esc(percent(chance) + ' / ' + percent(1-chance)) + '</strong>' +
        (Math.min(chance,1-chance) < .5 ? '<small>Upset chance ' + esc(percent(Math.min(chance,1-chance))) + '</small>' : '') + '</div>') +
      (linked ? '<a class="bb-bracket-analysis" href="' + esc(linked) + '">Compare matchup</a>' : '') +
      (editing && selected && actual ? '<p class="bb-bracket-result ' + (selected === actual.winner ? 'is-right' : 'is-wrong') +
        '">' + (selected === actual.winner ? 'Correct historical pick' : 'Actual winner ' + esc(bracket.teams[actual.winner].name)) + '</p>' : '') +
      (destination && destination.round >= 5 && selected ? '<p class="bb-bracket-path">Advances to ' + esc(roundName(destination.round, bracket)) + '</p>' : '') +
      '</article>';
  }

  function buildBoard(bracket, picks, editing) {
    const regions = bracket.field.regions;
    const regionalGames = bracket.games.filter(game => state.region === 'national' ? game.region === null : game.region === state.region);
    const rounds = [...new Set(regionalGames.map(game => game.round))];
    if (state.round !== 'all' && !rounds.includes(Number(state.round))) state.round = 'all';
    if (smallScreen() && state.round === 'all') state.round = String(rounds[0]);
    const visible = state.round === 'all' ? rounds : [Number(state.round)];
    const title = regions.find(region => region.id === state.region)?.name;
    const titleText = title ? title + ' region' : 'National rounds';
    const selectors = '<div class="bb-bracket-filters">' +
      '<label>Region<select data-bracket-select="region">' +
        regions.map(region => choice(region.id, region.name, state.region)).join('') + choice('national', 'Final Four and championship', state.region) + '</select></label>' +
      '<label>Round<select data-bracket-select="round">' + (smallScreen() ? '' : choice('all', 'All rounds', state.round)) +
        rounds.map(r => choice(r, roundName(r, bracket), state.round)).join('') + '</select></label>' +
      '<button type="button" data-bracket-action="national">Go to Final Four</button></div>';
    return selectors + '<h3 class="bb-bracket-region-title">' + esc(titleText) + '</h3>' +
      '<div class="bb-bracket-board" data-columns="' + visible.length + '">' +
      (visible.length > 1 ? '<canvas class="bb-bracket-connections" aria-hidden="true"></canvas>' : '') +
      visible.map(round => '<section class="bb-bracket-column" aria-label="' + esc(roundName(round, bracket)) + '">' +
        '<h4>' + esc(roundName(round, bracket)) + '</h4><div class="bb-bracket-round-games">' +
        regionalGames.filter(game => game.round === round).map(game => card(game, bracket, picks, editing)).join('') +
        '</div></section>').join('') + '</div>';
  }

  function connectVisibleGames(bracket) {
    const canvas = root.querySelector('.bb-bracket-connections');
    if (!canvas) return;
    const board = canvas.parentElement;
    const cards = new Map([...board.querySelectorAll('[data-bracket-slot]')].map(el => [el.dataset.bracketSlot, el]));
    const draw = () => {
      const frame = board.getBoundingClientRect();
      const ratio = root.ownerDocument.defaultView.devicePixelRatio || 1;
      const context = canvas.getContext('2d');
      if (!context || !frame.width || !frame.height) return;
      canvas.width = Math.ceil(frame.width * ratio);
      canvas.height = Math.ceil(frame.height * ratio);
      context.scale(ratio, ratio);
      context.strokeStyle = '#7095bb';
      context.beginPath();
      for (const game of bracket.games) {
        const target = cards.get(game.id)?.getBoundingClientRect();
        if (!target) continue;
        for (const side of game.sides) {
          const source = cards.get(side.from)?.getBoundingClientRect();
          if (!source || target.left <= source.right) continue;
          const entry = target.left - frame.left;
          const exit = source.right - frame.left;
          const bend = (entry + exit) / 2;
          const from = (source.top + source.bottom) / 2 - frame.top;
          const to = (target.top + target.bottom) / 2 - frame.top;
          context.moveTo(exit, from);
          context.lineTo(bend, from);
          context.lineTo(bend, to);
          context.lineTo(entry, to);
        }
      }
      context.stroke();
    };
    boardObserver = new ResizeObserver(draw);
    boardObserver.observe(board);
    draw();
  }

  function heading(bracket, editing, picks) {
    if (state.mode === 'official') {
      const href = officialSource(bracket.field.sourceUrl);
      const complete = Object.keys(bracket.results).length === bracket.games.length;
      const winner = complete && bracket.teams[bracket.results.championship?.winner]?.name;
      return '<div class="bb-bracket-intro"><p class="bb-bracket-kicker">' + (complete ? 'Verified historical results' : 'Official NCAA field') + '</p>' +
        '<h2>' + bracket.field.year + ' NCAA bracket</h2><p>' + bracket.teamCount + ' teams · ' + bracket.games.length + ' games' +
        (winner ? ' · Champion <strong>' + esc(winner) + '</strong>' : '') +
        (href ? ' · <a href="' + esc(href) + '">NCAA bracket source</a>' : '') + '</p></div>';
    }
    if (!editing) {
      const winner = bracket.teams[picks.championship]?.name;
      return '<div class="bb-bracket-intro"><p class="bb-bracket-kicker">Unofficial projection</p><h2>GD projected field</h2>' +
        '<p>32 projected automatic bids · 44 at-large teams · 12 Opening Round games</p>' +
        (winner ? '<p>Neutral-site model favorite to advance through this field: <strong>' + esc(winner) + '</strong></p>' : '') +
        methodNote() + '</div>';
    }
    const title = bracket === practice ? '2027 format demonstration' : bracket === officialArchive ? '2026 historical practice' :
      bracket === official ? 'Practice the official field' : 'Practice a GD projection';
    const context = bracket === practice ?
      'The numbered teams are synthetic. Pick through all 75 games to test the 76-team format.' :
      bracket === officialArchive ? 'Replay the verified 2026 field. We grade your selections against the actual results.' :
        bracket === official ? 'Try the official matchups with private practice picks.' :
        'Explore a hypothetical 2027 field with forecasts from the preview’s basketball model.';
    const completed = Object.keys(picks).length;
    const {graded, correct} = gradeBasketballBracket(bracket, picks);
    const champ = picks.championship ? bracket.teams[picks.championship]?.name : null;
    const canFill = bracket.games.some(game => reasonableChance(probability(bracket, ...bracketTeams(game, picks))));
    return '<div class="bb-bracket-intro"><p class="bb-bracket-kicker">Private practice</p><h2>' + title + '</h2><p>' + context +
      '</p><p class="bb-bracket-progress"><strong>' + completed + ' / ' + bracket.games.length + '</strong> picks' +
      (graded ? ' <span>· ' + correct + ' / ' + graded + ' correct</span>' : '') +
      (champ ? ' <span>· Champion: <strong>' + esc(champ) + '</strong></span>' : '') + '</p>' +
      '<progress aria-label="Bracket completion" max="' + bracket.games.length + '" value="' + completed + '"></progress>' +
      '<div class="bb-bracket-actions">' + (canFill ? '<button type="button" class="bb-bracket-primary" data-bracket-action="fill">Pick model favorites</button>' : '') +
      '<button type="button" data-bracket-action="reset"' + (completed ? '' : ' disabled') + '>Reset picks</button>' +
      (profileId && storage ? '<button type="button" data-bracket-action="save">Save practice bracket</button>' +
        '<button type="button" data-bracket-action="reopen">Reopen saved draft</button>' : '') + '</div>' +
      '<p class="bb-bracket-note">' + (profileId && storage ? 'Saved drafts stay in this browser under the current preview profile. ' : '') +
      'Practice picks have no entry deadline or standings. An official contest would lock at the first tipoff.</p>' + '</div>';
  }

  function render(focus) {
    boardObserver?.disconnect();
    const bracket = chooseDisplayField();
    const editing = state.mode === 'mine';
    const picks = !bracket ? {} : editing ? load(bracket) : state.mode === 'projection'
      ? fillBasketballBracket(bracket, (a,b) => probability(bracket,a,b))
      : Object.fromEntries(Object.entries(bracket.results).map(([id, result]) => [id, result.winner]));
    const modes = [['official', 'Official bracket'], ['projection', 'GD projected bracket'], ['mine', 'My bracket']];
    root.innerHTML = '<section class="bb-bracket" aria-label="Men’s basketball tournament bracket">' +
      '<div class="bb-bracket-modes" role="group" aria-label="Bracket mode">' +
        modes.map(([mode, label]) => '<button type="button" data-bracket-mode="' + mode + '" aria-pressed="' +
          (mode === state.mode) + '">' + label + '</button>').join('') + '</div>' +
      (state.mode === 'official' ? '<label class="bb-bracket-field">Tournament<select data-bracket-select="field">' +
        choice('current', '2027 official bracket', state.field) + choice('archive', '2026 NCAA archive', state.field) + '</select></label>' : '') +
      (editing ? '<label class="bb-bracket-field">Practice field<select data-bracket-select="practiceField">' +
        (official ? choice('official', '2027 official field (practice)', state.practiceField) : '') +
        (projection ? choice('projection', 'GD projected field', state.practiceField) : '') +
        choice('format', '2027 format demonstration', state.practiceField) +
        choice('archive', '2026 verified historical field', state.practiceField) + '</select></label>' : '') +
      '<p class="bb-bracket-notice" role="status" aria-live="polite">' + esc(state.notice) + '</p>' +
      (bracket ? heading(bracket, editing, picks) + buildBoard(bracket, picks, editing)
        : introductoryState()) +
      '<p class="bb-bracket-source"><a href="' + ncaaRules + '">NCAA selection and seeding rules</a></p></section>';
    if (bracket) connectVisibleGames(bracket);
    if (focus) [...root.querySelectorAll('button,select')].find(element =>
      Object.keys(focus).every(key => element.dataset[key] === focus[key]) && !element.disabled)?.focus({preventScroll:true});
  }

  function handleClick(event) {
    const button = event.target.closest?.('button');
    if (!button || !root.contains(button)) return;
    const {bracketMode: mode, bracketAction: action, bracketGame: game, bracketTeam: team} = button.dataset;
    if (!mode && !action && !game) return;
    state.notice = '';
    if (mode) {
      state.mode = mode;
      state.round = 'all';
      render({bracketMode: mode});
    } else if (action === 'demo') {
      state.mode = 'mine';
      state.practiceField = 'format';
      state.region = 'east';
      state.round = 'all';
      render({bracketSelect: 'practiceField'});
    } else if (action === 'national') {
      state.region = 'national';
      state.round = 'all';
      render({bracketSelect: 'round'});
    } else if (state.mode === 'mine') {
      const bracket = chooseDisplayField();
      const picks = load(bracket);
      if (game && team) {
        const next = chooseBasketballWinner(bracket, picks, game, team);
        memory.set(bracket, next);
        if (next[game] === team) state.notice = bracket.teams[team].name + ' advances.';
        render({bracketGame: game, bracketTeam: team});
      } else if (action === 'reset') {
        memory.set(bracket, {});
        state.notice = profileId && storage ? 'Practice picks cleared. Your saved draft remains available until you save again.' : 'Practice picks cleared.';
        render({bracketSelect: 'region'});
      } else if (action === 'fill') {
        memory.set(bracket, fillBasketballBracket(bracket, (a,b) => probability(bracket,a,b)));
        state.notice = 'Model favorites filled wherever a forecast was available.';
        render({bracketAction: action});
      } else if (action === 'save' && profileId && storage) {
        try {
          storage.setItem(savedKey(bracket), JSON.stringify({edition: bracketEdition(bracket), picks}));
          state.notice = 'Practice bracket saved in this browser.';
        } catch {
          state.notice = 'The browser could not save this draft.';
        }
        render({bracketAction: action});
      } else if (action === 'reopen' && profileId && storage) {
        const draft = readDraft(bracket);
        if (Object.keys(draft).length) {
          memory.set(bracket, draft);
          state.notice = 'Saved practice draft reopened.';
        } else state.notice = 'No saved picks are available for this field.';
        render({bracketAction: action});
      }
    }
  }

  function handleChange(event) {
    const field = event.target.dataset?.bracketSelect;
    if (!['field','practiceField','region','round'].includes(field)) return;
    state[field] = event.target.value;
    if (field !== 'round') state.round = 'all';
    state.notice = '';
    render({bracketSelect: field});
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);
  render();
  return () => {
    boardObserver?.disconnect();
    root.removeEventListener('click', handleClick);
    root.removeEventListener('change', handleChange);
  };
}
