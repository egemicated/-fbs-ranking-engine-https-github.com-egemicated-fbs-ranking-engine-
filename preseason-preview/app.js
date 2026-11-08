const outlet = document.querySelector('#content');
const nav = document.querySelector('.views');
const filters = { team: '', game: '', week: '', limit: 40 };
let preview;
let teamById;

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function decimal(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function percent(value) {
  return Number.isFinite(value) ? `${decimal(value * 100)}%` : '—';
}

function teamName(id) {
  return teamById.get(id)?.name ?? id;
}

function teamLink(id) {
  return `<a class="team-link" href="#team/${encodeURIComponent(id)}">${escape(teamName(id))}</a>`;
}

function stat(value, label) {
  return `<div class="stat"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`;
}

function table(headers, rows, label) {
  return `<div class="table-scroll"><table aria-label="${escape(label)}"><thead><tr>${headers.map(name => `<th scope="col">${escape(name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function teamRows() {
  const query = filters.team.trim().toLowerCase();
  const teams = preview.teams.filter(team => `${team.name} ${team.conference}`.toLowerCase().includes(query));
  if (!teams.length) return '<p class="empty">No teams match your search.</p>';
  return table(['Rank', 'Team', 'Rating', 'Est. wins', 'Actual wins'], teams.map(team => `<tr>
    <td>${team.rank}</td><td>${teamLink(team.id)}<small>${escape(team.conference)}</small></td>
    <td class="num">${decimal(team.strength)}</td><td class="num">${decimal(team.expectedWins)}</td>
    <td class="num">${team.actualWins}</td></tr>`).join(''), 'Preseason team rankings');
}

function renderTeams() {
  const model = preview.validation.models.find(row => row.id === preview.modelId);
  outlet.innerHTML = `<div class="summary">${stat(preview.teams.length, 'FBS teams')}${stat(preview.window, 'Rating input seasons')}${stat(percent(model.accuracy), 'Historical winner accuracy')}</div>
    <section class="panel"><h2>${preview.season} preseason rankings</h2>
    <p>Strength ranks the teams on a neutral field. Estimated and actual wins use the same ${escape(preview.scheduleLabel)}.</p>
    <div class="controls"><label>Search teams<input id="team-filter" type="search" placeholder="School or conference" value="${escape(filters.team)}"></label></div>
    <div id="team-results">${teamRows()}</div></section>`;
}

function gameRows(games, includeWeek = true) {
  const headers = [...(includeWeek ? ['Week'] : []), 'Matchup', 'Favored', 'Final'];
  return table(headers, games.map(game => {
    const favored = game.homeProbability >= .5 ? game.home : game.away;
    const chance = Math.max(game.homeProbability, 1 - game.homeProbability);
    const pick = game.homeProbability === .5 ? 'Even' : `${escape(teamName(favored))} ${percent(chance)}`;
    const score = Number.isFinite(game.awayPoints) && Number.isFinite(game.homePoints) ? `${game.awayPoints}–${game.homePoints}` : '—';
    return `<tr>${includeWeek ? `<td>${game.week}</td>` : ''}<td>${teamLink(game.away)} ${game.neutral ? 'vs' : 'at'} ${teamLink(game.home)}</td>
      <td>${pick}<small>${decimal(Math.abs(game.edge))} pt edge</small></td><td class="num">${score}</td></tr>`;
  }).join(''), 'Preseason game estimates');
}

function filteredGames() {
  const query = filters.game.trim().toLowerCase();
  const matching = preview.games.filter(game => (!filters.week || String(game.week) === filters.week) &&
    `${teamName(game.home)} ${teamName(game.away)}`.toLowerCase().includes(query));
  if (!matching.length) return '<p class="empty">No games match your filters.</p>';
  return `<p class="note">Showing ${Math.min(filters.limit, matching.length)} of ${matching.length} games</p>
    ${gameRows(matching.slice(0, filters.limit))}${matching.length > filters.limit ? '<button class="more" id="more-games">Show more games</button>' : ''}`;
}

function renderGames() {
  const weeks = [...new Set(preview.games.map(game => game.week))].sort((a, b) => a - b);
  outlet.innerHTML = `<section class="panel"><h2>${preview.season} game replay</h2>
    <p>One preseason estimate per game. The final score appears in away–home order for comparison.</p>
    <div class="controls"><label>Search games<input id="game-filter" type="search" placeholder="Team name" value="${escape(filters.game)}"></label>
    <label>Week<select id="week-filter"><option value="">All weeks</option>${weeks.map(week => `<option value="${week}" ${String(week) === filters.week ? 'selected' : ''}>Week ${week}</option>`).join('')}</select></label></div>
    <div id="game-results">${filteredGames()}</div></section>`;
}

function renderTeam(id) {
  const team = teamById.get(id);
  if (!team) return renderTeams();
  const games = preview.games.filter(game => game.home === id || game.away === id);
  const quarterback = preview.quarterbacks.examples.find(row => row.teamId === id);
  const history = table(['Season', 'Record', 'SOR', 'SOS rank'], team.history.map(row => `<tr>
    <td>${row.year}</td><td>${row.wins}–${row.losses}</td><td>${decimal(row.sor, 3)}</td>
    <td>${Number.isInteger(row.sos) ? `#${row.sos}` : '—'}</td></tr>`).join(''), 'Historical season evidence');
  outlet.innerHTML = `<section class="panel"><a href="#rankings">← All teams</a><h2>${escape(team.name)}</h2>
    <p>${escape(team.conference)} · Preseason rank #${team.rank} · ${decimal(team.strength)} strength points</p>
    <p>${decimal(team.expectedWins)} estimated wins and ${team.actualWins} actual wins across ${games.length} scored games in this replay.</p>
    ${quarterback ? `<p><a href="#quarterbacks">Review ${escape(quarterback.player)}’s preseason evidence</a></p>` : ''}</section>
    <section class="panel"><h2>Previous seasons</h2><p>Records use the replay archive. SOR and SOS are calculated for each season.</p>
    ${team.history.length ? history : '<p>No prior FBS seasons were recorded in this window.</p>'}</section>
    <section class="panel"><h2>Game estimates</h2>${games.length ? gameRows(games) : '<p>No games in this test cohort.</p>'}</section>`;
}

function renderQuarterbacks() {
  const { validation, examples } = preview.quarterbacks;
  const benchmark = validation ? `<div class="summary">${stat(validation.players, 'Held-out player-seasons')}${stat(decimal(validation.baselineError, 3), 'FBS average error')}${stat(decimal(validation.ratingError, 3), 'Four-year QB error')}</div>` : '';
  outlet.innerHTML = `<section class="panel"><h2>Quarterback evidence</h2>
    <p>${escape(preview.quarterbacks.description)}</p>
    ${validation ? `<p>${escape(validation.scope)} Errors are in yards per attempt. A one-season QB model scored ${decimal(validation.oneYearError, 3)}.</p>` : ''}</section>
    <section class="panel">${benchmark}${examples.map(row => `<article class="panel"><div class="tag">${escape(row.cohort)}</div>
      <h3>${escape(row.player)} · ${teamLink(row.teamId)}</h3><p>${escape(row.fact)}</p>
      ${Number.isFinite(row.rating) ? `<p><strong>${decimal(row.rating, 2)} projected yards per attempt</strong> from ${row.attempts.toLocaleString()} prior pass attempts.</p>` : '<p>College passing evidence is unavailable at the cutoff.</p>'}
      <p><a href="${escape(row.source)}">School announcement · ${escape(row.knownOn)}</a></p></article>`).join('')}</section>`;
}

function pairedScores(baseline, challenger, feature) {
  if (!baseline || !challenger) return '<p>The dated sample is too small to fit and score this feature.</p>';
  const row = (label, scores) => `<tr><td>${escape(label)}</td><td>${decimal(scores.brier, 5)}</td><td>${decimal(scores.logLoss, 5)}</td></tr>`;
  return table(['Model', 'Brier', 'Log loss'], row('Four-year Strength', baseline) + row(feature, challenger), `${feature} comparison`);
}

function datedTestPanels(tests) {
  const qb = tests.quarterback;
  const coach = tests.coaching;
  const fullBrier = qb.challengerWithFallback && qb.baselineWithFallback
    ? ` On the full schedule with those fallbacks, Brier was ${decimal(qb.baselineWithFallback.brier, 5)} for Strength and ${decimal(qb.challengerWithFallback.brier, 5)} for the challenger.` : '';
  return `<section class="panel"><h2>Dated quarterback test</h2>
    <p>The 2024–2025 test had verified media-day quarterback evidence for both teams in ${qb.coveredGames.toLocaleString()} of ${qb.totalGames.toLocaleString()} games. Each selected team named exactly one quarterback with earlier college passing data. An announcement shows affiliation at the time. Starting jobs and full QB rooms require separate evidence.</p>
    <p>We fitted the added feature using ${qb.fitGames.toLocaleString()} earlier games and compared both models on the same covered fixtures.</p>
    ${pairedScores(qb.baseline, qb.challenger, 'Strength + named QB')}
    <p>For the other fixtures, the challenger uses the team baseline.${fullBrier} Confirmed starter coverage supported ${qb.starterGames} paired games and complete QB-room coverage supported ${qb.roomGames}.</p>
    <p><a href="https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/blob/codex/preseason-lab-preview/research/PRESEASON-LAB.md">Data and test protocol</a></p>
    </section><section class="panel"><h2>Head-coach continuity test</h2>
    <p>On ${coach.games.toLocaleString()} SEC games in 2024–2025, we tested the effect of having the same publicly announced head coach as the previous preseason. Only ${coach.contrastGames} games had different continuity between the two teams. The archive cohort includes conference title games tagged as regular season.</p>
    ${pairedScores(coach.baseline, coach.challenger, 'Strength + coach continuity')}
    <p>The gain came from seven Mississippi State games. The adjustment worsened both scores for Alabama and Texas A&amp;M. The 2025 forecasts were identical because every team had the same announced head coach as the prior preseason.</p>
    </section>`;
}

function preseasonScores(rows, label) {
  return table(['Model', 'Brier', 'Log loss', 'Winners'], rows.map(row => `<tr>
    <td>${escape(row.label)}</td><td>${decimal(row.brier, 5)}</td><td>${decimal(row.logLoss, 5)}</td>
    <td class="num">${percent(row.accuracy)}</td></tr>`).join(''), label);
}

function historyTestPanel(tests) {
  const groups = [
    ['History windows', tests.windows, 'One, two, four, six, eight, ten, and all earlier seasons with the original carryover and margin scale.'],
    ['Carryover between seasons', tests.carryover, 'Each prior year still learns from its own games. The final transition into the forecast season uses the same 75% preseason carryover in every test.'],
    ['Score-margin scale', tests.margins, 'The curve compresses blowouts gradually. A wider scale preserves more information from larger wins.'],
    ['Home-field adjustment', tests.venues, 'The current fixed adjustment beat two models that learned separate venue terms.'],
    ['Archive repair', tests.archive, 'Repairing historical coverage changed a small number of picks. The original and repaired histories were scored on the same fixtures.'],
    ['Combined model on the repaired archive', tests.repairedComparison, 'The combined rule kept the same history, carryover, and margin settings. Only its odds scale was refitted on the earlier fixtures.'],
  ];
  return `<section class="panel"><h2>History and weighting tests</h2>
    <p>We fitted the odds on 2014–2019, chose settings on 2021–2022, and tested on the same ${tests.games.toLocaleString()} games from 2023–2025.</p>
    <p>The combined challenger uses stronger carryover between historical seasons and a 42-point margin scale. It is a candidate for a preseason trial. The archived forecasts in the Lab still use the original baseline.</p>
    ${preseasonScores(tests.combined, 'Combined preseason models')}
    ${groups.map(([label, rows, note]) => `<details class="test-detail"><summary>${escape(label)}</summary><p>${escape(note)}</p>${preseasonScores(rows, label)}</details>`).join('')}
  </section>`;
}

function renderTesting() {
  const { validation } = preview;
  const metrics = table(['Model', 'Wins picked', 'Brier', 'Log loss', 'Win total error'], validation.models.map(row => `<tr>
    <td>${escape(row.label)}</td><td>${percent(row.accuracy)}</td><td>${decimal(row.brier, 3)}</td>
    <td>${decimal(row.logLoss, 3)}</td><td>${decimal(row.winError, 2)}</td></tr>`).join(''), 'Historical model comparison');
  outlet.innerHTML = `<section class="panel"><h2>How the replay was scored</h2>
    <p>${escape(validation.scope)}</p><p>${escape(validation.calibration)}</p>${metrics}
    <p>Brier and log loss score the odds against what happened. Lower is better. Win total error is in games per team.</p></section>
    ${validation.historyTests ? historyTestPanel(validation.historyTests) : ''}
    ${validation.datedTests ? datedTestPanels(validation.datedTests) : ''}
    <section class="panel"><h2>What this preview covers</h2><p>${escape(preview.limits)}</p>
    <p>${escape(preview.featureStatus)}</p></section>
    <section class="panel"><h2>Offense and defense test</h2>
    <p>Adding the available opponent-adjusted yards-per-play features moved Brier from ${decimal(validation.units.baselineBrier, 5)} to ${decimal(validation.units.challengerBrier, 5)} on ${validation.units.games.toLocaleString()} games. Both teams had usable unit history in ${validation.units.covered.toLocaleString()} of those matchups.</p>
    <p>Using each school’s prior leading passer as a team feature moved Brier from ${decimal(validation.passer.baselineBrier, 5)} to ${decimal(validation.passer.challengerBrier, 5)} on ${validation.passer.games.toLocaleString()} games. That test only used past passing production. It made no assumption about the upcoming starter.</p></section>`;
}

function render() {
  if (!preview) return;
  const [view, id] = location.hash.slice(1).split('/');
  const active = view === 'team' || !['games', 'quarterbacks', 'testing'].includes(view) ? 'rankings' : view;
  for (const link of nav.querySelectorAll('a')) {
    if (link.hash === `#${active}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (view === 'team' && id) renderTeam(decodeURIComponent(id));
  else if (active === 'games') renderGames();
  else if (active === 'quarterbacks') renderQuarterbacks();
  else if (active === 'testing') renderTesting();
  else renderTeams();
}

outlet.addEventListener('input', event => {
  if (event.target.id === 'team-filter') {
    filters.team = event.target.value;
    document.querySelector('#team-results').innerHTML = teamRows();
  }
  if (event.target.id === 'game-filter') {
    filters.game = event.target.value;
    filters.limit = 40;
    document.querySelector('#game-results').innerHTML = filteredGames();
  }
});
outlet.addEventListener('change', event => {
  if (event.target.id !== 'week-filter') return;
  filters.week = event.target.value;
  filters.limit = 40;
  document.querySelector('#game-results').innerHTML = filteredGames();
});
outlet.addEventListener('click', event => {
  if (event.target.id !== 'more-games') return;
  filters.limit += 40;
  document.querySelector('#game-results').innerHTML = filteredGames();
  document.querySelector('#more-games')?.focus();
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

try {
  const response = await fetch('data/replay.json');
  if (!response.ok) throw new Error(`Preview data returned ${response.status}`);
  preview = await response.json();
  if (!preview.teams?.length || !preview.games?.length) throw new Error('Preview data is incomplete');
  teamById = new Map(preview.teams.map(team => [team.id, team]));
  render();
} catch (error) {
  outlet.innerHTML = '<section class="panel"><h2>The replay could not load.</h2><p>Refresh this page to try again.</p></section>';
  console.error(error);
}
