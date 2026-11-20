import { navigateApp } from './clean-navigation.js';
import { routeHref } from './clean-routes.js';
import { validWeeklyPick, weeklyPicksScore } from './weekly-picks-score.js';
import { formatNumber, formatProbability } from './format.js?v=1';
import { teamNameMarkup } from './team-identity.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const cache = new Map();
const dates = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
const weekKey = game => `${game.seasonType}:${game.week}`;
const weekName = key => key.startsWith('postseason:') ? 'Postseason week ' + key.split(':')[1] : 'Week ' + key.split(':')[1];

function decisiveFinal(game, cutoff) {
  const kickoff = Date.parse(game.startDate);
  return game.status === 'final' && Number.isFinite(kickoff) && kickoff <= cutoff &&
    [game.homePoints,game.awayPoints].every(points => Number.isSafeInteger(points) && points >= 0) &&
    game.homePoints !== game.awayPoints;
}

function eligibleScheduleGame(game, teams, division) {
  const home = teams.get(game.home)?.division, away = teams.get(game.away)?.division;
  return division === 'fcs' ? home === 'fcs' && away === 'fcs'
    : (home === 'fbs' || away === 'fbs') && [home, away].every(side => side === 'fbs' || side === 'fcs');
}

function pregameRanks(history, game) {
  if (!history?.editions) return null;
  const day = calendar.format(new Date(game.startDate));
  const edition = history.editions.filter(item => item.kind === 'saved' && item.released < day &&
    Date.parse(item.asOf) < Date.parse(game.startDate)).sort((a,b) => Date.parse(a.asOf) - Date.parse(b.asOf)).at(-1);
  if (!edition) return null;
  const rows = new Map(edition.rows.map(row => [row.id, row.rank]));
  const home = rows.get(game.home), away = rows.get(game.away);
  return [home,away].every(value => Number.isInteger(value) && value > 0) ? { home, away, asOf: edition.asOf } : null;
}

export function buildModelReport(artifact, selectedWeek, division = 'fbs', history = null) {
  if (!Array.isArray(artifact?.teams) || !Array.isArray(artifact.games) || !Number.isFinite(Date.parse(artifact.asOf))) {
    throw new Error('Saved prediction data is unavailable');
  }
  const teams = new Map(artifact.teams.map(team => [team.id,team]));
  const ids = new Set();
  const ordered = [...artifact.games].sort((a,b) => Date.parse(a.startDate) - Date.parse(b.startDate) || a.id.localeCompare(b.id));
  const weeks = [...new Set(ordered.map(weekKey))];
  const cutoff = Date.parse(artifact.asOf);
  const saved = ordered.filter(game => validWeeklyPick(game,game.pick,game.pick?.capturedAt,artifact.asOf,teams,division));
  const firstSaved = saved.reduce((first, game) => Math.min(first, Date.parse(game.pick.capturedAt)), Infinity);
  const started = saved.filter(game => Date.parse(game.startDate) <= cutoff);
  const relevant = started.at(-1) ?? saved[0] ?? ordered.filter(game => Date.parse(game.startDate) <= cutoff).at(-1) ?? ordered[0];
  const week = weeks.includes(selectedWeek) ? selectedWeek : relevant ? weekKey(relevant) : null;
  const scores = weeklyPicksScore(artifact,week,division);
  const rows = [], ungraded = [];
  for (const game of ordered) {
    if (ids.has(game.id)) throw new Error('Duplicate saved game identity');
    ids.add(game.id);
    if (!validWeeklyPick(game,game.pick,game.pick?.capturedAt,artifact.asOf,teams,division)) continue;
    const completed = decisiveFinal(game, cutoff);
    if (!completed) { ungraded.push({ ...game, reason: ['scheduled','pending'].includes(game.status) ? 'Awaiting final' :
      game.status === 'final' && game.homePoints === game.awayPoints ? 'Tied game, ungraded' : 'Unavailable or excluded result' }); continue; }
    const homeWon = game.homePoints > game.awayPoints;
    const correct = game.pick.favored === 'even' ? null : game.pick.favored === (homeWon ? 'home' : 'away');
    const confidence = Math.max(game.pick.homeWinProbability, 1-game.pick.homeWinProbability);
    const ranks = division === 'fbs' ? pregameRanks(history,game) : null;
    const favoredRank = ranks && (game.pick.favored === 'home' ? ranks.home : ranks.away);
    const otherRank = ranks && (game.pick.favored === 'home' ? ranks.away : ranks.home);
    rows.push({ ...game, homeTeam:teams.get(game.home), awayTeam:teams.get(game.away), correct, confidence,
      error:(game.pick.homeWinProbability-Number(homeWon)) ** 2, pregameRanks:ranks,
      calledUpset:correct === true && ranks && favoredRank > otherRank ? favoredRank - otherRank : null });
  }
  const selected = rows.filter(game => weekKey(game) === week);
  // The publisher retains a pick only when the teams and neutral-site flag still match.
  const homeGames = rows.filter(game => game.neutral === false && game.correct !== null);
  const homeBenchmark = homeGames.length ? {
    games: homeGames.length,
    modelCorrect: homeGames.filter(game => game.correct).length,
    homeCorrect: homeGames.filter(game => game.homePoints > game.awayPoints).length,
  } : null;
  const eligibleFinals = ordered.filter(game => eligibleScheduleGame(game, teams, division) && decisiveFinal(game, cutoff)).length;
  const bins = [[.5,.6],[.6,.7],[.7,.8],[.8,.9],[.9,1.0000001]].map(([lower,upper]) => {
    const games = selected.filter(game => game.confidence >= lower && game.confidence < upper);
    const decided = games.filter(game => game.correct !== null);
    return { label: `${Math.round(lower*100)}–${Math.min(100,Math.round(upper*100))}%`, games:games.length,
      correct:decided.filter(game => game.correct).length, decided:decided.length,
      accuracy:decided.length ? decided.filter(game => game.correct).length/decided.length : null,
      brier:games.length ? games.reduce((sum,game) => sum+game.error,0)/games.length : null };
  });
  return { season:artifact.season, asOf:artifact.asOf, division, weeks, week, scores, selected, ungraded:ungraded.filter(game=>weekKey(game)===week), bins,
    firstSavedAt: Number.isFinite(firstSaved) ? new Date(firstSaved).toISOString() : null,
    pickHorizonDays: Number.isInteger(artifact.source?.pickHorizonDays) && artifact.source.pickHorizonDays > 0 ? artifact.source.pickHorizonDays : null,
    eligibleFinals, homeBenchmark,
    correctCalls:selected.filter(game=>game.correct).sort((a,b)=>a.confidence-b.confidence).slice(0,3),
    confidentWins:selected.filter(game=>game.correct && game.confidence>=.8).sort((a,b)=>b.confidence-a.confidence).slice(0,3),
    misses:selected.filter(game=>game.correct===false).sort((a,b)=>b.confidence-a.confidence).slice(0,3),
    closest:[...selected].sort((a,b)=>Math.abs(a.homePoints-a.awayPoints)-Math.abs(b.homePoints-b.awayPoints)).slice(0,3),
    upsets:selected.filter(game=>game.calledUpset).sort((a,b)=>b.calledUpset-a.calledUpset).slice(0,3),
    upsetCoverage:selected.filter(game=>game.pregameRanks).length };
}

function stat(label,value,detail='') {
  return `<div><dt>${label}</dt><dd>${value}</dd>${detail ? `<small>${detail}</small>` : ''}</div>`;
}
function gameLinks(game,division) {
  const favored = game.pick.favored === 'home' ? game.homeTeam : game.pick.favored === 'away' ? game.awayTeam : null;
  const result = game.correct === null ? 'even' : game.correct ? 'correct' : 'miss';
  return `<div class="intelligence-result"><strong><a href="${routeHref(`team/${encodeURIComponent(game.away)}`)}">${teamNameMarkup(game.away, game.awayTeam.name)}</a>
    ${game.awayPoints} at <a href="${routeHref(`team/${encodeURIComponent(game.home)}`)}">${teamNameMarkup(game.home, game.homeTeam.name)}</a> ${game.homePoints}</strong>
    <span><b class="model-report-result is-${result}">${result === 'even' ? 'Even forecast' : result === 'correct' ? 'Correct pick' : 'Miss'}</b> ${favored ? teamNameMarkup(favored.id, favored.name)+' '+escapeHtml(formatProbability(game.confidence,1)) : '50.0% each'}</span>
    <small>Saved ${dates.format(new Date(game.pick.capturedAt))} MT</small>
    <a class="text-link" href="${routeHref(`compare/weekly/${division === 'fcs' ? 'fcs/' : ''}${weekKey(game)}`)}">Weekly game details</a></div>`;
}
function list(title,rows,division,empty) {
  return `<details class="panel intelligence-disclosure"><summary>${title}<span>${rows.length}</span></summary><div>${rows.length ?
    rows.map(game=>gameLinks(game,division)).join('') : `<p class="compact-note">${empty}</p>`}</div></details>`;
}
export function modelReportMarkup(report) {
  const {scores,division,week,selected} = report;
  if (!week) return '<section class="panel intelligence-panel"><h2>Model report</h2><p role="status">No saved game schedule is available for this division yet.</p></section>';
  const label=weekName(week);
  const { completedPicks, availablePicks } = scores.season;
  const benchmark = report.homeBenchmark;
  return `<div class="intelligence-tools model-report">
    <div class="intelligence-toolbar"><label>Division<select data-report-field="division"><option value="fbs"${division==='fbs'?' selected':''}>FBS slate</option><option value="fcs"${division==='fcs'?' selected':''}>FCS vs. FCS</option></select></label>
    <label>Report week<select data-report-field="week">${[...report.weeks].reverse().map(value=>`<option value="${value}"${value===week?' selected':''}>${weekName(value)}</option>`).join('')}</select></label>
    <a class="text-link" href="${routeHref(`compare/weekly/${division === 'fcs' ? 'fcs/' : ''}${week}`)}">Weekly Picks →</a>
    <a class="text-link" href="/beat-the-model/">Beat the Model →</a></div>
    <section class="panel intelligence-panel"><h2>${report.season} · ${label} model report</h2>
    <p class="compact-note">${division==='fcs'?'FCS vs. FCS':'Games involving FBS teams, including FCS opponents'}. Results through ${dates.format(new Date(report.asOf))} MT.</p>
    <p><strong>${completedPicks} of ${report.eligibleFinals} eligible finals</strong> have a graded live forecast this season. ${availablePicks - completedPicks} more saved forecasts remain ungraded.</p>
    <dl class="intelligence-stat-grid">
      ${stat('Weekly saved-pick accuracy',formatProbability(scores.week?.accuracy,1),`${scores.week?.correctPicks??0} correct · ${(scores.week?.decisivePicks??0)-(scores.week?.correctPicks??0)} incorrect`)}
      ${stat('Season saved-pick accuracy',formatProbability(scores.season.accuracy,1),`${scores.season.correctPicks} of ${scores.season.decisivePicks} decided picks`)}
      ${stat('Weekly Brier score',formatNumber(scores.week?.brier,3),`${scores.week?.completedPicks??0} scored forecasts · lower is better`)}
      ${stat('Season Brier score',formatNumber(scores.season.brier,3),`${scores.season.completedPicks} scored forecasts`)}
    </dl>
    ${(scores.week?.completedPicks??0)<30 ? '<p class="intelligence-note">Small weekly sample. Use the season sample and game coverage to put this week’s results in context.</p>' : ''}
    <p class="compact-note">${scores.week?.pendingPicks??0} saved picks awaiting final results this week. ${report.ungraded.filter(game=>game.reason!=='Awaiting final').length} tied, unavailable or excluded results remain ungraded.</p>
    <details class="intelligence-evidence"><summary>Which games count?</summary>
    <p>${report.firstSavedAt ? `Automatic saving in this archive starts ${dates.format(new Date(report.firstSavedAt))} MT.` : 'This archive has no qualifying saved pregame forecasts yet.'}${report.pickHorizonDays ? ` The publisher checks upcoming games up to ${report.pickHorizonDays} days ahead.` : ''} Only forecasts timestamped before kickoff enter the live record. Games from earlier weeks may have replay scores.</p>
    <p>A confirmed final with a winner is required for grading. Postponed games wait for a confirmed final, and canceled games are excluded. A pick must still match the teams and venue and precede the updated kickoff if the schedule changes. Even forecasts with a final winner count toward Brier score; winner accuracy requires a named favorite.</p></details></section>
    <section class="panel intelligence-panel"><h3>Season benchmarks</h3>
    ${benchmark ? `<p><strong>Picking every home team:</strong> ${benchmark.homeCorrect} of ${benchmark.games} correct (${formatProbability(benchmark.homeCorrect/benchmark.games,1)}). The model got ${benchmark.modelCorrect} of the same ${benchmark.games} right (${formatProbability(benchmark.modelCorrect/benchmark.games,1)}).</p>` : '<p>No home-team comparison is available yet.</p>'}
    <p class="compact-note">This uses the home team known before kickoff. The comparison includes only games with a known home venue, a named model favorite, and a confirmed winner.</p>
    ${completedPicks ? `<p><strong>Even-odds reference:</strong> A 50% forecast every game scores 0.250 Brier on the same ${completedPicks} finals. The model scored ${formatNumber(scores.season.brier,3)}.</p>` : ''}
    <p class="compact-note">Winner accuracy counts correct favorites. Brier measures squared probability error, with lower scores better. Calibration asks whether teams given a particular chance win about that often. These results describe the covered games. Stronger claims about future performance need more saved games across more weeks.</p></section>
    <section class="panel intelligence-panel"><h3>Results by saved favorite probability</h3>
    <p class="compact-note">These ranges describe the model’s saved win probability. They are not a separate confidence rating.</p>
    <div class="intelligence-table-scroll" tabindex="0" role="region" aria-label="Saved prediction results by probability"><table><thead><tr><th>Probability</th><th>Correct / decided</th><th>Accuracy</th><th>Brier</th></tr></thead><tbody>
    ${report.bins.map(bin=>`<tr><th scope="row">${bin.label}</th><td>${bin.correct} / ${bin.decided}</td><td><span class="model-report-accuracy">${formatProbability(bin.accuracy,1)}
    ${Number.isFinite(bin.accuracy) ? `<meter aria-hidden="true" min="0" max="1" value="${bin.accuracy}"></meter>` : ''}</span></td><td>${formatNumber(bin.brier,3)}</td></tr>`).join('')}
    </tbody></table></div></section>
    <div class="intelligence-feature-grid">
    ${list('Closest correct calls',report.correctCalls,division,'No correctly predicted decided games have final results this week.')}
    ${list('Correct picks at 80% or higher',report.confidentWins,division,'No correct saved picks at 80% or higher have final results this week.')}
    ${list('Most confident misses',report.misses,division,'No incorrect saved picks have final results this week.')}
    ${list('Closest final scores',report.closest,division,'No saved-pick games have decisive finals this week.')}
    ${list('Correct calls against higher SOR teams',report.upsets,division,report.upsetCoverage ?
      'No correct picks against higher pregame SOR teams in the covered games.' : 'A saved pregame SOR edition is unavailable for these games.')}
    </div>
    <p class="compact-note">The upset comparison has saved pregame SOR coverage for ${report.upsetCoverage} of ${selected.length} graded games. It uses the latest eligible saved edition before kickoff.</p>
    <details class="panel intelligence-disclosure"><summary>All graded saved picks<span>${selected.length}</span></summary><div>${selected.length ? selected.map(game=>gameLinks(game,division)).join('') : '<p class="compact-note">Saved pregame forecasts will appear here after decisive final results arrive.</p>'}</div></details>
    <details class="panel intelligence-disclosure"><summary>Historical replay validation</summary><div><p>Replays recreate past weeks from archived data. They have their own result and do not enter the saved live record above.</p>
    <dl class="intelligence-stat-grid">${stat(label+' replay accuracy',formatProbability(scores.replay.week?.accuracy,1),`${scores.replay.week?.decisivePicks??0} decided replay picks`)}${stat('Replay Brier',formatNumber(scores.replay.week?.brier,3))}</dl>
    <p class="compact-note">Upcoming estimates change with current data. Only their separately saved pregame forecasts qualify for this live report.</p></div></details>
    </div>`;
}

function read(url) {
  if (!cache.has(url)) cache.set(url,fetch(url).then(response=>{
    if (!response.ok) throw new Error('Saved forecasts are unavailable');
    return response.json();
  }).catch(error=>{cache.delete(url);throw error;}));
  return cache.get(url);
}
export function mountModelReport(container,{dataRoot='',division='fbs',week,onNavigate}={}) {
  let active=true, report;
  const cohort=division==='fcs'?'fcs':'fbs';
  container.innerHTML='<p role="status">Loading saved prediction results…</p>';
  container.setAttribute('aria-busy','true');
  const root=dataRoot?.replace(/\/$/,'')??'';
  const endpoint=cohort==='fcs'?'weekly-fcs-picks':'weekly-picks';
  Promise.all([read(root ? `${root}/${endpoint}.json` : `/${endpoint}`),
    cohort==='fbs'?read('/ranking-history.json').catch(()=>null):null]).then(([artifact,history])=>{
    if (!active||!container.isConnected) return;
    const key=String(week??'').includes(':')?week:`regular:${week}`;
    report=buildModelReport(artifact,key,cohort,history?.season===artifact.season?history:null);
    container.innerHTML=modelReportMarkup(report);
  }).catch(()=>{
    if (active&&container.isConnected) container.innerHTML='<p role="status">Saved prediction results are unavailable. Try again after the next successful publication.</p>';
  }).finally(()=>{if(active)container.removeAttribute('aria-busy');});
  function change(event) {
    const field=event.target.dataset.reportField;
    if(!field||!report) return;
    const next={division:cohort,week:report.week,[field]:event.target.value};
    if(onNavigate)onNavigate(next);
    else navigateApp(`model-report/${next.division}/${next.week}`);
  }
  container.addEventListener('change',change);
  return ()=>{active=false;container.removeEventListener('change',change);};
}
