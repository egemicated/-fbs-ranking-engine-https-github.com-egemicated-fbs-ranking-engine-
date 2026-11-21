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
const mapWidth = 3280;
const mapCardWidth = 220;
const mapCardHeight = 102;
const nationalLabelLift = 79;
const nationalRoundSpacing = mapCardHeight + 30;

function bracketLayout(bracket) {
  const positions = new Map();
  const regions = new Map();
  let top = 42;
  for (const pair of bracket.field.semifinalPairs) {
    const maxOpeners = Math.max(...pair.map(region => bracket.games.filter(game => game.region === region && game.round === 0).length));
    const track = Math.max(7 * 119, (maxOpeners - 1) * 112);
    pair.forEach((region, side) => {
    const xAt = round => {
      const x = 65 + round * 259;
      return side === 0 ? x : mapWidth - mapCardWidth - x;
    };
      const games = bracket.games.filter(game => game.region === region);
      regions.set(region, {top, side, xAt, games});
      const opening = [];
      games.filter(game => game.round === 1).forEach((game, index) => {
        const y = top + 130 + index * track / 7;
        positions.set(game.id, {x: xAt(1), y, side});
        game.sides.forEach((slot, slotIndex) => {
          if (slot.from) opening.push({id: slot.from, y: y + (slotIndex === 0 ? -24 : 24)});
        });
      });
      const start = top + 130;
      let end = start + track;
      for (let index = opening.length - 1; index >= 0; index--) {
        const slot = opening[index];
        const y = Math.max(start + index * 112, Math.min(end, slot.y));
        positions.set(slot.id, {x: xAt(0), y, side});
        end = y - 112;
      }
      for (const game of games.filter(game => game.round >= 2)) {
        const [first, second] = game.sides.map(slot => positions.get(slot.from));
        positions.set(game.id, {x: xAt(game.round), y: (first.y + second.y) / 2, side});
      }
    });
    top += track + 207;
  }
  for (const game of bracket.games.filter(game => game.round >= 5)) {
    const [first, second] = game.sides.map(slot => positions.get(slot.from));
    positions.set(game.id, {x: (mapWidth - mapCardWidth) / 2, y: (first.y + second.y) / 2});
  }
  const center = positions.get('championship').y;
  positions.get('semifinal-1').y = center - nationalRoundSpacing;
  positions.get('semifinal-2').y = center + nationalRoundSpacing;
  return {positions, regions, height: top};
}

function connector(from, to, side, round) {
  if (round === 6) {
    const middle = from.x + mapCardWidth / 2;
    const sign = Math.sign(to.y - from.y);
    return 'M ' + middle + ' ' + (from.y + sign * mapCardHeight / 2) +
      ' V ' + (to.y - sign * mapCardHeight / 2);
  }
  const start = from.x + (from.side === 0 ? mapCardWidth : 0);
  const end = to.x + (from.side === 0 ? 0 : mapCardWidth);
  const bend = (start + end) / 2;
  const targetY = round === 5 ? to.y : to.y + (side === 0 ? -18 : 18);
  return 'M ' + start + ' ' + from.y + ' H ' + bend + ' V ' + targetY + ' H ' + end;
}

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
  const document = root.ownerDocument;
  const window = document.defaultView;
  const compact = window.matchMedia('(max-width: 860px)');
  const requestedMode = new URLSearchParams(window.location.search).get('mode');
  const state = {
    mode: requestedMode === 'projection' || (requestedMode !== 'official' && !official && projection) ? 'projection' : 'official',
    field: season === 2026 ? 'archive' : 'current', practiceField: projection ? 'projection' : 'format',
    region: 'east', round: 'all', notice: '',
  };
  const camera = {x: 0, y: 0, scale: 0, fit: true, expanded: false, jump: ''};
  let boardObserver;
  let activeMap;
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
      '<p>We assume the eligible SOR leader from each of 32 conferences wins an automatic bid, then add 44 at-large teams by SOR. ' +
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
      '<span class="bb-bracket-name" title="' + esc(team.name) + '">' + esc(team.name) + ((selected || winner) ? ' <span aria-hidden="true">✓</span>' : '') + '</span>' +
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

  function card(game, bracket, picks, editing, place) {
    const ids = bracketTeams(game, picks);
    const both = ids.every(Boolean);
    const actual = bracket.results[game.id];
    const result = !editing && state.mode === 'official' ? actual : null;
    const chance = probability(bracket, ...ids);
    const selected = picks[game.id];
    const linked = both && bracket !== practice && internalHref(matchupHref?.(...ids, bracket.field.year));
    const destination = bracket.games.find(item => item.sides.some(side => side.from === game.id));
    const mapStyle = place ? ' style="--game-x:' + place.x + 'px;--game-y:' + place.y + 'px"' : '';
    const css = place && game.round >= 5 ? ' bb-map-national-game' : '';
    const region = bracket.field.regions.find(item => item.id === game.region);
    const label = (region ? region.name + ' · ' : '') + roundName(game.round, bracket) +
      (game.round === 6 ? '' : (game.round === 0 ? ' · Seed ' : ' · Game ') + game.id.split('-').at(-1));
    return '<article class="bb-bracket-game' + css + '" data-bracket-slot="' + esc(game.id) + '" data-round="' + game.round + '"' +
      (place ? ' aria-label="' + esc(label) + '"' : '') + mapStyle + '>' +
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
    if (!rounds.includes(Number(state.round)) || state.round === 'all') state.round = String(rounds[0]);
    const round = Number(state.round);
    const title = regions.find(region => region.id === state.region)?.name;
    const titleText = title ? title + ' region' : 'National rounds';
    const selectors = '<div class="bb-bracket-filters">' +
      '<label>Region<select data-bracket-select="region">' +
        regions.map(region => choice(region.id, region.name, state.region)).join('') + choice('national', 'National rounds', state.region) + '</select></label>' +
      '<label>Round<select data-bracket-select="round">' +
      rounds.map(r => choice(r, roundName(r, bracket), state.round)).join('') + '</select></label></div>';
    return selectors + '<div class="bb-bracket-region-bar"><h3>' + esc(titleText) + '</h3>' +
      '<button type="button" data-bracket-action="national">Go to Final Four</button></div>' +
      '<div class="bb-bracket-board">' +
      '<section class="bb-bracket-column" aria-label="' + esc(roundName(round, bracket)) + '">' +
        '<div class="bb-bracket-round-games">' +
        regionalGames.filter(game => game.round === round).map(game => card(game, bracket, picks, editing)).join('') +
        '</div></section></div>';
  }

  function renderMap(bracket, picks, editing, layout) {
    const {positions, regions, height} = layout;
    const path = bracket.games.flatMap(game => game.sides.flatMap((slot, index) => {
      if (!slot.from) return [];
      const incoming = picks[slot.from];
      const css = incoming && picks[game.id] === incoming ? ' is-advancing' : incoming ? ' is-picked' : '';
      return ['<path class="bb-map-line' + css + '" data-from="' + esc(slot.from) + '" data-to="' + esc(game.id) +
        '" d="' + connector(positions.get(slot.from), positions.get(game.id), index, game.round) + '"/>'];
    })).join('');
    const labels = bracket.field.regions.map(region => {
      const {top, side, xAt, games} = regions.get(region.id);
      const x = side === 0 ? xAt(0) : xAt(4);
      const rounds = [...new Set(games.map(game => game.round))];
      return '<h4 class="bb-map-region' + (side ? ' is-right' : '') + '" style="--label-x:' + x + 'px;--label-y:' + top + 'px">' +
        esc(region.name + ' region') + '</h4>' + rounds.map(round =>
        '<span class="bb-map-round" aria-hidden="true" style="--label-x:' + xAt(round) + 'px;--label-y:' +
          (top + 53) + 'px">' + esc(roundName(round, bracket)) + '</span>').join('');
    }).join('');
    const national = bracket.games.filter(game => game.round >= 5).map(game => {
      const {x,y} = positions.get(game.id);
      return '<h4 class="bb-map-round bb-map-national-label" style="--label-x:' + x + 'px;--label-y:' + (y - nationalLabelLift) + 'px">' +
        esc(game.round === 5 ? 'Final Four' : 'Championship') + '</h4>';
    }).join('');
    return '<section class="bb-map" aria-label="Tournament map">' +
      '<div class="bb-map-header"><div class="bb-map-jumps"><select aria-label="Jump to region or round" data-bracket-map-select>' +
      choice('', 'Jump to region', camera.jump) +
      bracket.field.regions.map(region => choice(region.id, region.name + ' region', camera.jump)).join('') +
      choice('national', 'Final Four', camera.jump) + choice('championship', 'Championship', camera.jump) + '</select>' +
      '<button type="button" data-bracket-action="national">Go to Final Four</button></div>' +
      '<p id="bb-map-help">Drag to pan · Scroll to zoom<span class="bb-sr-only">. Use the arrow keys to pan, plus or minus to zoom, and zero to fit.</span></p>' +
      '<div class="bb-map-tools" role="group" aria-label="Bracket view controls">' +
      '<button type="button" data-bracket-view="zoom-in" aria-label="Zoom in">+</button>' +
      '<button type="button" data-bracket-view="zoom-out" aria-label="Zoom out">−</button>' +
      '<button type="button" data-bracket-view="fit" aria-label="Fit entire bracket">Fit</button>' +
      '<button type="button" data-bracket-view="reset" aria-label="Reset view">Reset view</button>' +
      '<button type="button" data-bracket-view="expand" aria-label="Fullscreen bracket">Fullscreen</button>' +
      '<span class="bb-map-scale" aria-hidden="true"></span></div></div>' +
      '<div class="bb-map-viewport" tabindex="0" role="region" aria-label="Interactive tournament bracket" aria-describedby="bb-map-help" ' +
      'aria-keyshortcuts="+ - 0 ArrowLeft ArrowRight ArrowUp ArrowDown">' +
      '<div class="bb-map-world" style="--map-width:' + mapWidth + 'px;--map-height:' + height + 'px;--card-width:' +
      mapCardWidth + 'px;--card-height:' + mapCardHeight + 'px">' +
      '<svg class="bb-map-connectors" viewBox="0 0 ' + mapWidth + ' ' + height + '" aria-hidden="true">' + path + '</svg>' +
      labels + national + bracket.games.map(game => card(game, bracket, picks, editing, positions.get(game.id))).join('') +
      '</div></div></section>';
  }

  function fitScale() {
    const {viewport, layout} = activeMap;
    return Math.max(.01, Math.min((viewport.clientWidth - 40) / mapWidth,
      (viewport.clientHeight - 52) / layout.height));
  }

  function applyView() {
    if (!activeMap) return;
    const {viewport, world, status, jumpSelect, expandButton} = activeMap;
    world.style.transform = 'translate(' + camera.x + 'px,' + camera.y + 'px) scale(' + camera.scale + ')';
    viewport.dataset.scale = camera.scale.toFixed(4);
    status.textContent = Math.round(camera.scale * 100) + '%';
    jumpSelect.value = camera.jump || '';
    const expanded = camera.expanded || document.fullscreenElement === root;
    expandButton.textContent = expanded ? 'Exit fullscreen' : 'Fullscreen';
    expandButton.setAttribute('aria-label', expanded ? 'Exit fullscreen bracket' : 'Fullscreen bracket');
  }

  function fitView() {
    const {viewport, layout} = activeMap;
    camera.scale = fitScale();
    camera.x = (viewport.clientWidth - mapWidth * camera.scale) / 2;
    camera.y = (viewport.clientHeight - layout.height * camera.scale) / 2;
    camera.fit = true;
    camera.jump = '';
    applyView();
  }

  function panBy(x, y) {
    const {viewport, layout} = activeMap;
    const inset = 48;
    camera.x = Math.max(inset - mapWidth * camera.scale, Math.min(viewport.clientWidth - inset, camera.x + x));
    camera.y = Math.max(inset - layout.height * camera.scale, Math.min(viewport.clientHeight - inset, camera.y + y));
    camera.fit = false;
    camera.jump = '';
    applyView();
  }

  function zoomBy(factor, anchorX, anchorY) {
    const {viewport} = activeMap;
    const x = anchorX ?? viewport.clientWidth / 2;
    const y = anchorY ?? viewport.clientHeight / 2;
    const scale = Math.min(1.55, Math.max(fitScale() * .78, camera.scale * factor));
    const delta = scale / camera.scale;
    camera.x = x - (x - camera.x) * delta;
    camera.y = y - (y - camera.y) * delta;
    camera.scale = scale;
    camera.fit = false;
    camera.jump = '';
    applyView();
  }

  function centerOn(x, y, scale) {
    const {viewport} = activeMap;
    camera.scale = scale;
    camera.x = viewport.clientWidth / 2 - x * scale;
    camera.y = viewport.clientHeight / 2 - y * scale;
    camera.fit = false;
    applyView();
  }

  function jumpTo(name) {
    if (!name) return fitView();
    const {layout, viewport, readableScale} = activeMap;
    const region = layout.regions.get(name);
    camera.jump = name;
    if (region) {
      const firstRound = Math.min(...region.games.map(game => game.round));
      const left = Math.min(region.xAt(firstRound), region.xAt(4));
      const right = Math.max(region.xAt(firstRound), region.xAt(4)) + mapCardWidth;
      const bottom = Math.max(...region.games.map(game => layout.positions.get(game.id).y)) + mapCardHeight / 2;
      const inset = 16;
      const scale = Math.max(readableScale, Math.min(1.12, (viewport.clientWidth - 2 * inset) / (right - left),
        (viewport.clientHeight - 2 * inset) / (bottom - region.top)));
      const halfWidth = (viewport.clientWidth / 2 - inset) / scale;
      const halfHeight = (viewport.clientHeight / 2 - inset) / scale;
      // Start at the entry round when the readable region is larger than the viewport.
      const x = right - left <= halfWidth * 2 ? (left + right) / 2 : region.side ? right - halfWidth : left + halfWidth;
      centerOn(x, Math.min((region.top + bottom) / 2, region.top + halfHeight), scale);
    } else if (name === 'national') {
      const top = layout.positions.get('semifinal-1').y - nationalLabelLift;
      const bottom = layout.positions.get('semifinal-2').y + mapCardHeight / 2;
      const scale = Math.min(1.12, (viewport.clientHeight - 20) / (bottom - top),
        (viewport.clientWidth - 20) / mapCardWidth);
      centerOn(mapWidth / 2, (top + bottom) / 2, scale);
    } else if (name === 'championship') {
      centerOn(mapWidth / 2, layout.positions.get('championship').y - 30, 1.35);
    }
  }

  function onFullscreenChange() {
    if (!activeMap) return;
    if (camera.fit) fitView();
    else if (camera.jump) jumpTo(camera.jump);
    else applyView();
  }

  async function toggleExpanded() {
    if (document.fullscreenElement === root) {
      await document.exitFullscreen();
      return;
    }
    if (!camera.expanded && root.requestFullscreen) {
      try {
        await root.requestFullscreen();
        return;
      } catch {
        // Embedded previews may disallow browser fullscreen.
      }
    }
    camera.expanded = !camera.expanded;
    root.classList.toggle('bb-map-expanded', camera.expanded);
    onFullscreenChange();
  }

  function bindMap(layout) {
    const viewport = root.querySelector('.bb-map-viewport');
    const world = viewport.querySelector('.bb-map-world');
    const teamFont = parseFloat(window.getComputedStyle(world.querySelector('.bb-bracket-team')).fontSize);
    activeMap = {layout, viewport, world, readableScale: 12 / teamFont, status: root.querySelector('.bb-map-scale'),
      jumpSelect: root.querySelector('[data-bracket-map-select]'), expandButton: root.querySelector('[data-bracket-view=expand]')};
    let drag;
    viewport.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      zoomBy(Math.exp(-Math.max(-360, Math.min(360, event.deltaY * unit)) * .0021),
        event.clientX - rect.left, event.clientY - rect.top);
    }, {passive: false});
    viewport.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button,a')) return;
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY, moving: false};
    });
    viewport.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      const x = event.clientX - drag.x;
      const y = event.clientY - drag.y;
      if (!drag.moving && Math.hypot(x,y) < 5) return;
      if (!drag.moving) {
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add('is-dragging');
        drag.moving = true;
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
      panBy(x,y);
    });
    function stopDrag() {
      drag = null;
      viewport.classList.remove('is-dragging');
    }
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(event, stopDrag);
    viewport.addEventListener('pointerleave', () => { if (!drag?.moving) stopDrag(); });
    viewport.addEventListener('keydown', event => {
      if (event.target !== viewport) return;
      const action = ({
        '+': () => zoomBy(1.25), '=': () => zoomBy(1.25), '-': () => zoomBy(.8), '0': fitView,
        ArrowLeft: () => panBy(90,0), ArrowRight: () => panBy(-90,0),
        ArrowUp: () => panBy(0,90), ArrowDown: () => panBy(0,-90),
      })[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    });
    viewport.addEventListener('focusin', event => {
      const game = event.target.closest('[data-bracket-slot]');
      if (!game || !event.target.matches(':focus-visible')) return;
      const bounds = viewport.getBoundingClientRect();
      const item = event.target.getBoundingClientRect();
      if (item.left >= bounds.left && item.right <= bounds.right && item.top >= bounds.top &&
        item.bottom <= bounds.bottom && camera.scale >= .73) return;
      const {x,y} = layout.positions.get(game.dataset.bracketSlot);
      camera.jump = '';
      centerOn(x + mapCardWidth / 2, y, Math.max(.82,camera.scale));
    });
    boardObserver = new ResizeObserver(() => {
      if (activeMap?.viewport === viewport) onFullscreenChange();
    });
    boardObserver.observe(viewport);
    onFullscreenChange();
  }

  function heading(bracket, editing, picks) {
    if (state.mode === 'official') {
      const href = officialSource(bracket.field.sourceUrl);
      const complete = Object.keys(bracket.results).length === bracket.games.length;
      const winner = complete && bracket.teams[bracket.results.championship?.winner]?.name;
      return '<div class="bb-bracket-intro"><div class="bb-bracket-field-title"><p class="bb-bracket-kicker">' + (complete ? 'Verified historical results' : 'Official NCAA field') + '</p>' +
        '<h2>' + bracket.field.year + ' NCAA bracket</h2></div><p>' + bracket.teamCount + ' teams · ' + bracket.games.length + ' games' +
        (winner ? ' · Champion <strong>' + esc(winner) + '</strong>' : '') +
        (href ? ' · <a href="' + esc(href) + '">NCAA bracket source</a>' : '') + '</p></div>';
    }
    if (!editing) {
      const winner = bracket.teams[picks.championship]?.name;
      return '<div class="bb-bracket-intro"><div class="bb-bracket-field-title"><p class="bb-bracket-kicker">Unofficial projection</p><h2>GD projected field</h2></div>' +
        '<div><p>' + bracket.teamCount + ' teams · ' + bracket.games.filter(game => game.round === 0).length + ' Opening Round games</p>' +
        (winner ? '<p>Neutral-site model favorite: <strong>' + esc(winner) + '</strong></p>' : '') +
        '</div></div>';
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
    return '<div class="bb-bracket-intro bb-bracket-practice"><div class="bb-bracket-field-title"><p class="bb-bracket-kicker">Private practice</p>' +
      '<h2>' + title + '</h2><p>' + context + '</p></div><div><p class="bb-bracket-progress"><strong>' + completed + ' / ' + bracket.games.length + '</strong> picks' +
      (graded ? ' <span>· ' + correct + ' / ' + graded + ' correct</span>' : '') +
      (champ ? ' <span>· Champion: <strong>' + esc(champ) + '</strong></span>' : '') + '</p>' +
      '<progress aria-label="Bracket completion" max="' + bracket.games.length + '" value="' + completed + '"></progress></div>' +
      '<div class="bb-bracket-actions">' + (canFill ? '<button type="button" class="bb-bracket-primary" data-bracket-action="fill">Pick model favorites</button>' : '') +
      '<button type="button" data-bracket-action="reset"' + (completed ? '' : ' disabled') + '>Reset picks</button>' +
      (profileId && storage ? '<button type="button" data-bracket-action="save">Save practice bracket</button>' +
        '<button type="button" data-bracket-action="reopen">Reopen saved draft</button>' : '') + '</div></div>';
  }

  function render(focus) {
    boardObserver?.disconnect();
    activeMap = null;
    const bracket = chooseDisplayField();
    const editing = state.mode === 'mine';
    const layout = bracket && !compact.matches ? bracketLayout(bracket) : null;
    const picks = !bracket ? {} : editing ? load(bracket) : state.mode === 'projection'
      ? fillBasketballBracket(bracket, (a,b) => probability(bracket,a,b))
      : Object.fromEntries(Object.entries(bracket.results).map(([id, result]) => [id, result.winner]));
    const modes = [['official', 'Official', 'Official bracket'], ['projection', 'Projected', 'GD projected bracket'], ['mine', 'My bracket', 'My bracket']];
    root.innerHTML = '<section class="bb-bracket" aria-label="Men’s basketball tournament bracket">' +
      '<header class="bb-bracket-topbar"><h1>March Madness</h1><div class="bb-bracket-modes" role="group" aria-label="Bracket mode">' +
        modes.map(([mode, label, accessibleLabel]) => '<button type="button" data-bracket-mode="' + mode + '" aria-label="' + accessibleLabel +
          '" aria-pressed="' + (mode === state.mode) + '">' + label + '</button>').join('') + '</div></header>' +
      (state.mode === 'official' ? '<label class="bb-bracket-field">Tournament<select data-bracket-select="field">' +
        choice('current', '2027 official bracket', state.field) + choice('archive', '2026 NCAA archive', state.field) + '</select></label>' : '') +
      (editing ? '<label class="bb-bracket-field">Practice field<select data-bracket-select="practiceField">' +
        (official ? choice('official', '2027 official field (practice)', state.practiceField) : '') +
        (projection ? choice('projection', 'GD projected field', state.practiceField) : '') +
        choice('format', '2027 format demonstration', state.practiceField) +
        choice('archive', '2026 verified historical field', state.practiceField) + '</select></label>' : '') +
      '<p class="bb-bracket-notice" role="status" aria-live="polite">' + esc(state.notice) + '</p>' +
      (bracket ? heading(bracket, editing, picks) + (layout ? renderMap(bracket, picks, editing, layout) : buildBoard(bracket, picks, editing))
        : introductoryState()) +
      '<footer class="bb-bracket-footer">' + (bracket && state.mode === 'projection' ? methodNote() : '') +
      (editing ? '<p class="bb-bracket-note">' + (profileId && storage ? 'Saved drafts stay in this browser under the current preview profile. ' : '') +
        'Practice picks have no entry deadline or standings. An official contest would lock at the first tipoff.</p>' : '') +
      '<p class="bb-bracket-source"><a href="' + ncaaRules + '">NCAA selection and seeding rules</a></p></footer></section>';
    if (layout) bindMap(layout);
    if (focus) [...root.querySelectorAll('button,select')].find(element =>
      Object.keys(focus).every(key => element.dataset[key] === focus[key]) && !element.disabled)?.focus({preventScroll:true});
  }

  function handleClick(event) {
    const button = event.target.closest?.('button');
    if (!button || !root.contains(button)) return;
    const {bracketMode: mode, bracketAction: action, bracketGame: game, bracketTeam: team, bracketView: view} = button.dataset;
    if (view && activeMap) {
      if (view === 'zoom-in') zoomBy(1.25);
      else if (view === 'zoom-out') zoomBy(.8);
      else if (view === 'expand') void toggleExpanded();
      else fitView();
      return;
    }
    if (action === 'national' && activeMap) {
      jumpTo('national');
      return;
    }
    if (!mode && !action && !game) return;
    state.notice = '';
    if (mode) {
      state.mode = mode;
      state.round = 'all';
      camera.fit = true;
      render({bracketMode: mode});
    } else if (action === 'demo') {
      state.mode = 'mine';
      state.practiceField = 'format';
      state.region = 'east';
      state.round = 'all';
      camera.fit = true;
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
        render({bracketSelect: activeMap ? 'practiceField' : 'region'});
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
    if (activeMap && event.target === activeMap.jumpSelect) {
      jumpTo(event.target.value);
      return;
    }
    const field = event.target.dataset?.bracketSelect;
    if (!['field','practiceField','region','round'].includes(field)) return;
    state[field] = event.target.value;
    if (field === 'field' || field === 'practiceField') camera.fit = true;
    if (field !== 'round') state.round = 'all';
    state.notice = '';
    render({bracketSelect: field});
  }

  function handleViewportChange() {
    if (compact.matches && document.fullscreenElement === root) void document.exitFullscreen();
    if (compact.matches && camera.expanded) {
      camera.expanded = false;
      root.classList.remove('bb-map-expanded');
    }
    render();
  }

  function exitExpanded(event) {
    if (event.key === 'Escape' && camera.expanded) {
      camera.expanded = false;
      root.classList.remove('bb-map-expanded');
      onFullscreenChange();
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', exitExpanded);
  compact.addEventListener('change', handleViewportChange);
  render();
  return () => {
    boardObserver?.disconnect();
    root.classList.remove('bb-map-expanded');
    if (document.fullscreenElement === root) void document.exitFullscreen();
    root.removeEventListener('click', handleClick);
    root.removeEventListener('change', handleChange);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('keydown', exitExpanded);
    compact.removeEventListener('change', handleViewportChange);
  };
}
