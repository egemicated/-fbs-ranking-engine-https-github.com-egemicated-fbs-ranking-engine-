const rounds = [
  ['First Round', 'First round'], ['CFP Quarterfinals', 'Quarters'],
  ['CFP Semifinals', 'Semis'], ['National Championship', 'Final'],
];
const mobileQuery = '(max-width: 900px)';
const mountain = { timeZone: 'America/Denver' };
const dayFormat = new Intl.DateTimeFormat('en-US', { ...mountain, month: 'short', day: 'numeric' });
const gameFormat = new Intl.DateTimeFormat('en-US', { ...mountain, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function participants(slot, advances) {
  return { away: slot.away ?? advances[slot.awayFrom], home: slot.home ?? advances[slot.homeFrom] };
}

function teamLogo(team, teams) {
  if (!team) return '<span class="bracket-team-logo bracket-logo-empty" aria-hidden="true"></span>';
  const initials = team.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
  const id = teams?.get(team);
  return id ? `<span class="logo bracket-team-logo" aria-hidden="true"><img src="https://a.espncdn.com/i/teamlogos/ncaa/500/${encodeURIComponent(id)}.png" alt="" loading="lazy" decoding="async"><span>${escape(initials)}</span></span>`
    : `<span class="bracket-team-logo bracket-logo-empty" aria-hidden="true">${escape(initials)}</span>`;
}

function fixedSeed(slot, side) {
  const seed = slot[`${side}Seed`];
  return Number.isInteger(seed) ? seed : undefined;
}

function teamName(team, seed) {
  return `${seed ? `<small class="bracket-team-seed" aria-label="Seed ${seed}">${seed}</small>` : ''}<span>${escape(team ?? (seed ? 'TBD' : 'Winner TBD'))}</span>`;
}

function teamRow(slot, index, side, team, { pick, score, winner, editable, seeds, teams }) {
  const selected = !!team && pick === team;
  const classes = `bracket-team-row${selected ? ' is-selected' : ''}${winner ? ' is-winner' : ''}`;
  const content = `${teamLogo(team, teams)}<span class="bracket-team-name">${teamName(team, fixedSeed(slot, side) ?? seeds.get(team))}</span>
    <span class="bracket-team-score">${Number.isInteger(score) ? score : ''}</span>${selected ? '<span class="bracket-team-check" aria-hidden="true">✓</span>' : ''}`;
  if (!editable || !team) return `<div class="${classes}">${content}</div>`;
  return `<button class="${classes}" type="button" id="bracket-pick-${index}-${side}" data-bracket-game="${escape(slot.id)}" data-bracket-team="${escape(team)}" aria-pressed="${selected}">${content}</button>`;
}

function gameCard(slot, index, context) {
  const { picks, results, winners, editable, seeds, teams, pointsByRound } = context;
  const result = results[slot.id];
  const pick = picks[slot.id];
  const correct = !!result?.winner && pick === result.winner;
  const actual = participants(slot, winners);
  const shown = editable ? participants(slot, picks) : actual;
  const hasScore = actual.away && actual.home && Number.isInteger(result?.awayPoints) && Number.isInteger(result?.homePoints);
  const showScores = hasScore && shown.away === actual.away && shown.home === actual.home;
  const kickoff = Date.parse(slot.kickoff);
  const titleGame = slot.round === 4;
  const grade = pick && result?.winner ? (correct ? ' is-correct' : ' is-missed') : '';
  const champion = pick || result?.winner;
  return `<article class="bracket-game${titleGame ? ' bracket-title-game' : ''}${grade}" data-bracket-slot="${escape(slot.id)}">
    ${titleGame ? `<div class="bracket-title-head"><p>${pick ? 'Championship pick' : result?.winner ? 'National champion' : 'National Championship'}</p>
      ${champion ? `<div>${teamLogo(champion, teams)}<strong>${escape(champion)}</strong></div>` : '<strong>The title game</strong>'}</div>` : ''}
    <div class="bracket-game-sheet">
      <div class="bracket-game-meta">${Number.isFinite(kickoff) ? `<time datetime="${escape(slot.kickoff)}">${gameFormat.format(kickoff)} MT</time>` : '<span>Time TBD</span>'}
        ${showScores ? '<span class="bracket-final-label">Final</span>' : ''}</div>
      ${['away', 'home'].map(side => teamRow(slot, index, side, shown[side], { pick, score: showScores ? result[`${side}Points`] : undefined,
        winner: showScores && result.winner === shown[side], editable, seeds, teams })).join('')}
      ${hasScore && !showScores ? `<div class="bracket-official-final"><strong>Official final</strong><span>${escape(actual.away)} <b>${result.awayPoints}</b></span><span>${escape(actual.home)} <b>${result.homePoints}</b></span></div>` : ''}
      ${pick ? `<div class="bracket-pick-status"><span>Your pick · <strong>${escape(pick)}</strong></span>
        <span class="bracket-grade">${result?.winner ? correct ? `Correct · +${pointsByRound[slot.round - 1]}` : 'Incorrect' : 'Awaiting final'}</span></div>` : ''}
    </div></article>`;
}

function byeSide(slot) {
  if (slot?.round !== 2 || Boolean(slot.homeFrom) === Boolean(slot.awayFrom)) return null;
  const side = slot.homeFrom ? 'away' : 'home';
  return slot[side] || fixedSeed(slot, side) ? side : null;
}

function byeCard(quarterfinal, context) {
  const side = byeSide(quarterfinal);
  if (!side) return '';
  const team = quarterfinal[side];
  const seed = fixedSeed(quarterfinal, side) ?? context.seeds.get(team);
  return `<div class="bracket-bye" data-bracket-bye="${escape(quarterfinal.id)}">${teamLogo(team, context.teams)}
    <div><strong>${teamName(team, seed)}</strong><p>First-round bye</p></div><span class="bracket-bye-label" aria-hidden="true">BYE</span></div>`;
}

function connections(slots, picks, results) {
  return slots.flatMap(slot => {
    const to = escape(slot.id);
    const feeders = [slot.awayFrom, slot.homeFrom].filter(Boolean);
    const paths = feeders.map(from => `<path data-bracket-from="${escape(from)}" data-bracket-to="${to}"${picks[from] && picks[from] === results[from]?.winner ? ' class="is-correct"' : ''}></path>`);
    if (byeSide(slot)) paths.push(`<path data-bracket-to="${to}" class="is-bye"></path>`);
    return paths;
  }).join('');
}

function visualRounds(slots) {
  const grouped = rounds.map(() => []);
  const byId = new Map(slots.map((slot, slotIndex) => [slot.id, { slot, slotIndex }]));
  const seen = new Set();
  function place(game) {
    if (seen.has(game.slot.id)) return;
    seen.add(game.slot.id);
    grouped[game.slot.round - 1].push(game);
    [game.slot.homeFrom, game.slot.awayFrom].map(id => byId.get(id)).filter(Boolean)
      .sort((left, right) => left.slotIndex - right.slotIndex).forEach(place);
  }
  const final = slots.find(slot => slot.round === 4);
  if (final) place(byId.get(final.id));
  byId.forEach(place);
  return grouped;
}

export function renderBracketBoard({ slots, picks, results, winners, editable, activeRound = 1, teams, pointsByRound, roundDates }) {
  const seeds = new Map();
  for (const slot of slots) {
    for (const side of ['away', 'home']) {
      const seed = fixedSeed(slot, side);
      if (slot[side] && seed) seeds.set(slot[side], seed);
    }
  }
  const context = { picks, results, winners, editable, seeds, teams, pointsByRound };
  const quarterfinals = slots.filter(slot => slot.round === 2);
  const grouped = visualRounds(slots);
  const labels = rounds.map(([title, short], index) => {
    const number = index + 1;
    const games = grouped[index];
    const dates = games.map(({ slot }) => Date.parse(slot.kickoff)).filter(Number.isFinite).sort((a, b) => a - b);
    const first = dates.length ? dayFormat.format(dates[0]) : '';
    const last = dates.length ? dayFormat.format(dates.at(-1)) : '';
    const date = roundDates?.[index] ?? (first === last ? first : `${first}–${last}`);
    const points = pointsByRound[index];
    return { number, title, short, games, date, points };
  });
  return `<div class="bracket-tree" data-bracket-tree>
    <div class="bracket-round-headings" aria-hidden="true">${labels.map(({ title, date, points }) => `<div><strong>${title}</strong><small>${escape(date || 'Date TBD')} · ${points} ${points === 1 ? 'pt' : 'pts'} each</small></div>`).join('')}</div>
    <div class="bracket-round-tabs" role="tablist" aria-label="Playoff rounds">${labels.map(({ number, title, short, points }) => `<button type="button" role="tab" aria-label="${title}" id="bracket-tab-${number}"
      aria-selected="${activeRound === number}" aria-controls="bracket-round-${number}" tabindex="${activeRound === number ? '0' : '-1'}" data-bracket-tab="${number}">${short}<small>${points} ${points === 1 ? 'pt' : 'pts'} each</small></button>`).join('')}</div>
    <p class="bracket-swipe-hint">Swipe or select a round to ${editable || Object.keys(picks).length ? 'follow your picks' : 'view the bracket'}.</p>
    <div class="bracket-viewport" data-bracket-viewport><div class="bracket-rounds" data-bracket-rounds>
      <svg class="bracket-connectors" aria-hidden="true" focusable="false">${connections(slots, picks, results)}</svg>
      ${labels.map(({ number, title, games, date }) => `<section class="bracket-round" id="bracket-round-${number}" data-bracket-round="${number}" aria-label="${title}">
        <p class="bracket-mobile-round-date">${escape(date || 'Date TBD')}</p>
        ${games.map(({ slot, slotIndex }, index) => {
          const span = number < 3 ? 2 : number === 3 ? 4 : 8;
          const quarterfinal = number === 1 ? quarterfinals.find(game => [game.homeFrom, game.awayFrom].includes(slot.id)) : null;
          return `<div class="bracket-lane" style="--lane-start:${index * span + 1};--lane-span:${span}">${gameCard(slot, slotIndex, context)}${byeCard(quarterfinal, context)}</div>`;
        }).join('')}</section>`).join('')}
    </div></div></div>`;
}

export function mountBracketBoard(root, activeRound, onRoundChange) {
  const board = root.querySelector('[data-bracket-tree]');
  if (!board) return () => {};
  const viewport = board.querySelector('[data-bracket-viewport]');
  const grid = board.querySelector('[data-bracket-rounds]');
  const tabs = [...board.querySelectorAll('[data-bracket-tab]')];
  const panels = [...board.querySelectorAll('[data-bracket-round]')];
  const games = new Map([...board.querySelectorAll('[data-bracket-slot]')].map(game => [game.dataset.bracketSlot, game]));
  const byes = new Map([...board.querySelectorAll('[data-bracket-bye]')].map(bye => [bye.dataset.bracketBye, bye]));
  const paths = [...board.querySelectorAll('.bracket-connectors path')];
  const mobile = matchMedia(mobileQuery);
  let round = activeRound >= 1 && activeRound <= panels.length ? activeRound : 1;
  let frame;

  function size() {
    if (mobile.matches) {
      viewport.style.height = `${Math.ceil(panels[round - 1].getBoundingClientRect().height)}px`;
      return;
    }
    viewport.style.height = '';
    const origin = grid.getBoundingClientRect();
    for (const path of paths) {
      const target = games.get(path.dataset.bracketTo)?.getBoundingClientRect();
      const from = path.dataset.bracketFrom;
      const source = (from ? games.get(from) : byes.get(path.dataset.bracketTo))?.getBoundingClientRect();
      if (!source || !target) continue;
      const startX = source.right - origin.left;
      const endX = target.left - origin.left;
      const startY = source.top + source.height / 2 - origin.top;
      const endY = target.top + target.height / 2 - origin.top;
      path.setAttribute('d', `M${startX} ${startY}H${(startX + endX) / 2}V${endY}H${endX}`);
    }
  }

  function queueSize() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(size);
  }

  function select(next, scroll = false) {
    const changed = round !== next;
    round = next;
    tabs.forEach((tab, index) => {
      const selected = index + 1 === round;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel, index) => {
      const selected = index + 1 === round;
      panel.inert = mobile.matches && !selected;
      if (mobile.matches) {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tabs[index].id);
        panel.tabIndex = selected ? 0 : -1;
      } else {
        panel.removeAttribute('role');
        panel.removeAttribute('aria-labelledby');
        panel.removeAttribute('tabindex');
      }
    });
    if (scroll && mobile.matches) viewport.scrollLeft = (round - 1) * viewport.clientWidth;
    queueSize();
    if (changed) onRoundChange?.(round);
  }

  const onResize = () => select(round, true);
  const onScroll = () => {
    if (!mobile.matches || !viewport.clientWidth) return;
    const next = Math.min(panels.length, Math.max(1, Math.round(viewport.scrollLeft / viewport.clientWidth) + 1));
    if (next !== round) select(next);
  };
  const onClick = event => {
    const tab = event.target.closest('[data-bracket-tab]');
    if (tab) select(Number(tab.dataset.bracketTab), true);
  };
  const onKeydown = event => {
    const tab = event.target.closest('[data-bracket-tab]');
    if (!tab) return;
    const next = { ArrowLeft: (round + 2) % 4 + 1, ArrowRight: round % 4 + 1, Home: 1, End: 4 }[event.key];
    if (!next) return;
    event.preventDefault();
    select(next, true);
    tabs[next - 1].focus();
  };
  const showLoadedLogo = image => {
    if (image.naturalWidth) image.closest('.bracket-team-logo')?.classList.add('is-loaded');
  };
  const onLoad = event => showLoadedLogo(event.target);
  const observer = new ResizeObserver(queueSize);
  observer.observe(grid);
  for (const game of games.values()) observer.observe(game);
  viewport.addEventListener('scroll', onScroll, { passive: true });
  board.addEventListener('click', onClick);
  board.addEventListener('keydown', onKeydown);
  board.addEventListener('load', onLoad, true);
  board.querySelectorAll('.bracket-team-logo img').forEach(showLoadedLogo);
  mobile.addEventListener('change', onResize);
  window.addEventListener('resize', onResize);
  select(round, true);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    viewport.removeEventListener('scroll', onScroll);
    board.removeEventListener('click', onClick);
    board.removeEventListener('keydown', onKeydown);
    board.removeEventListener('load', onLoad, true);
    mobile.removeEventListener('change', onResize);
    window.removeEventListener('resize', onResize);
  };
}
