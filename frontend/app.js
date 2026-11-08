const BRAND = 'FBS Intelligence';
const main = document.querySelector('#main');
// Static builds set this root. The web service keeps its existing JSON routes.
const dataRoot = document.querySelector('meta[name="publication-data-root"]')?.content;
const state = { snapshot: null, byId: new Map(), performance: null, performanceById: new Map(), model: 'achievement', search: '', conference: '', all: false, teamTab: 'overview', compareA: '254', compareB: '2390', venue: 'neutral' };
const weeklyPicks = { request: null, status: 'loading', selectedWeek: '', weeks: new Map(), teams: new Map() };
const picksDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' });
const picksTimestamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
const paths = {
  home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  trophy:'M8 3h8v5a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v6m-4 3h8m-7-3h6',
  teams:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m17 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7a4 4 0 0 1 0 8',
  compare:'M4 4h5m-5 0v5m0-5 6 6m10 10h-5m5 0v-5m0 5-6-6M20 4h-5m5 0v5m0-5-6 6M4 20h5m-5 0v-5m0 5 6-6',
  layers:'m12 3 10 6-10 6L2 9l10-6Zm-9 11 9 6 9-6M3 18l9 5 9-5',
  arrow:'M4 12h15m-6-6 6 6-6 6',
  chevron:'m9 5 7 7-7 7',
  back:'m15 5-7 7 7 7',
  check:'M9 12l2 2 4-4m7 2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  chart:'M4 20V10h4v10m4 0V4h4v16m4 0V1M2 21h20',
  clock:'M12 7v5l3 2m7-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  search:'M21 21l-5-5m2-6a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  database:'M20 6c0 2-3.6 4-8 4S4 8 4 6s3.6-4 8-4 8 2 8 4Zm0 0v12c0 2-3.6 4-8 4s-8-2-8-4V6m0 6c0 2 3.6 4 8 4s8-2 8-4',
  shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6',
  network:'M9 4a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM1 19a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm16 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM12 7v5m0 0-6 5m6-5 6 5',
  calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm2 10h2m4 0h2m-8 4h2m4 0h2',
  info:'M12 11v6m0-10v.1m10 4.9a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  external:'M14 3h7v7m0-7L10 14M11 3H3v18h18v-8'
};
function icon(name, cls = '') { return `<svg aria-hidden="true" viewBox="0 0 24 24" class="${cls}"><path d="${paths[name] || paths.info}"/></svg>`; }
function publicationPath(name) { return dataRoot ? `${dataRoot}/${name}.json` : `/${name}`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function record(t) { return `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}`; }
function number(n, digits = 4) { return Number.isFinite(n) ? n.toFixed(digits) : '—'; }
function rank(r) { return r ? `#${r}` : 'Unranked'; }
function usesSor(t = state.snapshot?.rankings?.[0]) { return Boolean(t && Object.hasOwn(t, 'displayRank') && Number.isFinite(t.sor)); }
function nationalRank(t) { return Object.hasOwn(t, 'displayRank') ? t.displayRank : t.rank; }
function achievementScore(t) { return usesSor(t) ? t.sor : t.achievement; }
function achievementName() { return usesSor() ? 'Strength of Record' : 'Colley achievement'; }
function hasPerformance() { return Boolean(state.performance && state.performance.status === 'experimental' && state.performance.season === state.snapshot?.season && state.performance.asOf === state.snapshot.asOf && state.performance.baseSnapshotHash && state.performance.baseSnapshotHash === state.snapshot.snapshotHash); }
function performanceRow(t) { return hasPerformance() ? state.performanceById.get(t.id) : null; }
function performanceScore(value) { return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number(value, 2)} pp` : '—'; }
function acceptPerformance(snapshot) {
  if (!snapshot || snapshot.status !== 'experimental' || snapshot.season !== state.snapshot?.season ||
      snapshot.asOf !== state.snapshot.asOf ||
      !snapshot.baseSnapshotHash || snapshot.baseSnapshotHash !== state.snapshot.snapshotHash ||
      !Array.isArray(snapshot.rankings) || snapshot.rankings.length !== state.snapshot.rankings.length) return false;
  const byId = new Map();
  for (const row of snapshot.rankings) {
    if (!row || !state.byId.has(row.id) || byId.has(row.id) ||
        !(row.rank === null || (Number.isInteger(row.rank) && row.rank > 0)) ||
        !(row.score === null || Number.isFinite(row.score))) return false;
    byId.set(row.id, row);
  }
  state.performance = snapshot; state.performanceById = byId;
  return true;
}
function conferenceRank(t) {
  if (Object.hasOwn(t, 'displayConferenceRank')) return t.displayConferenceRank;
  return t.conferenceRank;
}
function opponentRank(g) { const t = state.byId.get(g.opponentId); return t ? nationalRank(t) : null; }
function probability(n) { return Number.isFinite(n) ? `${number(n * 100, 2)}%` : '—'; }
function logo(t, size = '') {
  const initials = t.name.split(/\s+/).slice(0, 2).map(x => x[0]).join('');
  return `<span class="logo ${size}" aria-hidden="true"><img src="https://a.espncdn.com/i/teamlogos/ncaa/500/${encodeURIComponent(t.id)}.png" alt="" loading="lazy" decoding="async"><span>${esc(initials)}</span></span>`;
}
function snapshotDate(options = {}) {
  const value = state.snapshot.asOf || state.snapshot.source?.fetchedAt || state.snapshot.before;
  return new Intl.DateTimeFormat('en-US', { timeZone:'America/Denver', month:'short', day:'numeric', ...options }).format(new Date(value));
}
function route() { return (location.hash.slice(1) || 'home').split('/'); }
function rankingHash(model = 'achievement', all = false) {
  const view = model === 'achievement' ? '' : `/${model}`;
  return `#rankings${view}${all ? '/all' : ''}`;
}
function ordered(model = state.model) {
  if (model === 'achievement') return state.snapshot.rankings;
  if (model === 'performance' && hasPerformance()) return [...state.performance.rankings]
    .sort((a,b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.id.localeCompare(b.id))
    .map(row => ({ ...state.byId.get(row.id), performance: row }));
  return [...state.snapshot.rankings].sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
}
function topTwentyFive(teams, model) {
  if (model === 'strength') return teams.slice(0, 25);
  return teams.filter(t => {
    const position = model === 'performance' ? performanceRow(t)?.rank : nationalRank(t);
    return position > 0 && position <= 25;
  });
}
function strengthRank(t) { return ordered('strength').findIndex(x => x.id === t.id) + 1; }
function sosRank(t) { return [...state.snapshot.rankings].sort((a,b) => (b.achievementScheduleStrength ?? -1) - (a.achievementScheduleStrength ?? -1)).findIndex(x => x.id === t.id) + 1; }
function teamLink(t, label = t.name) { return `<a href="#team/${encodeURIComponent(t.id)}">${esc(label)}</a>`; }
function displayRank(t, model = state.model) { return model === 'achievement' ? rank(nationalRank(t)) : model === 'performance' ? rank(performanceRow(t)?.rank) : rank(strengthRank(t)); }
function brand() { return `<a class="brand" href="#home" aria-label="${BRAND} home"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">FBS<small>INTELLIGENCE</small></span></a>`; }
function renderHeader() {
  const page = route()[0];
  const navs = [['home','home','Home'],['rankings','trophy','Rankings'],['teams','teams','Teams'],['compare','compare','Matchup lab'],['methodology','layers','Methodology']];
  document.querySelector('#header').innerHTML = `<div class="masthead"><div class="wrap masthead-inner">${brand()}<span class="brand-divider"></span><div class="masthead-tag">THE INDEPENDENT COLLEGE FOOTBALL RANKING ENGINE<strong>DATA &nbsp; › &nbsp; OPPONENTS &nbsp; › &nbsp; EVIDENCE</strong></div><div class="header-right"><div class="engine-badge">${icon('check')}<div><strong>Published rankings</strong><small>CFBD snapshot · ${snapshotDate()}</small></div></div><div class="season-badge">${state.snapshot.season}<small>SEASON SNAPSHOT</small></div></div></div></div><nav class="nav" aria-label="Main navigation"><div class="wrap nav-inner">${navs.map(([id,ic,text])=>`<a href="#${id}" class="${page===id || (page==='team' && id==='teams') ? 'active':''}" ${page===id?'aria-current="page"':''}>${icon(ic)}${text}</a>`).join('')}<span class="nav-spacer"></span><span class="nav-note">${icon('clock')}Sundays · 8 AM Mountain</span></div></nav>`;
  document.querySelector('#footer').innerHTML = `<div class="footer"><div class="wrap footer-inner"><div><div class="footer-brand">${BRAND.toUpperCase()}</div><p>Independent FBS rankings calculated from game data. No human polls or manual ranking overrides.</p></div><div class="footer-links"><a href="#methodology">${icon('layers')}Model methodology</a><a href="${esc(publicationPath('rankings'))}" target="_blank" rel="noopener">${icon('database')}Published data</a><span>Ranking engine · v${esc(state.snapshot.modelVersion)}</span></div></div></div>`;
}
function schedulePanel() { return `<section class="panel schedule-card"><div class="panel-head"><div class="panel-head-title">${icon('calendar')}<h2>The weekly picture</h2></div></div><div class="panel-body"><div class="section-label">Scheduled refresh</div><div class="schedule-title">SUNDAY. 8 AM.</div><p>Mountain Time · daylight saving aware.<br>Completed results from CollegeFootballData, published after the weekly calculation.</p><p style="margin-top:12px">Last publication: <strong>${snapshotDate({ hour:'numeric', minute:'2-digit' })} MT</strong></p></div></section>`; }
function coveragePanel() { return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('shield')}<h2>Behind the rankings</h2></div><span class="tag green">CFBD</span></div><div class="panel-body"><p>${usesSor()?'A team climbs when its record is harder to match against the same opponents at the same venues.':'The Colley model links results across the opponent network.'}</p><div class="fact-list"><div class="fact-row"><span>FBS teams in this snapshot</span><strong>${state.snapshot.fbsTeams}</strong></div><div class="fact-row"><span>Game records modeled</span><strong>${state.snapshot.gamesUsed.toLocaleString()}</strong></div><div class="fact-row"><span>Human poll inputs</span><strong>Zero</strong></div></div></div><a class="method-link" href="#methodology">See how we calculate each rank ${icon('arrow')}</a></section>`; }
function tableRows(teams, model = state.model, compact = false) {
  return teams.map(t => `<tr><td><span class="table-rank ${((model==='achievement'?nationalRank(t):strengthRank(t))||999)<=3?'top':''}">${model==='achievement'?(nationalRank(t)??'—'):strengthRank(t)}</span></td><td><div class="team-cell">${logo(t)}<div>${teamLink(t)}${compact?'':`<small>${esc(t.conference)}</small>`}</div></div></td><td class="num">${record(t)}</td><td class="hide-mobile">#${sosRank(t)}</td><td class="rating num">${model==='achievement'?number(achievementScore(t)):`${number(t.strength,1)}`}</td><td class="hide-mobile"><a class="text-link" href="#team/${t.id}" aria-label="Explore ${esc(t.name)}">${icon('arrow')}</a></td></tr>`).join('');
}
function rankingTable(teams, model = state.model, compact = false) { if (model === 'performance') return performanceTable(teams); return `<div class="table-scroll"><table><caption class="sr-only">${model==='achievement'?achievementName():'Predictive strength'} rankings</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col">Record</th><th scope="col" class="hide-mobile" title="Rank of opponents’ average Colley ratings">SOS · Colley</th><th scope="col">${model==='achievement'?(usesSor()?'SOR score':'Colley rating'):'Strength · pts'}</th><th class="hide-mobile"><span class="sr-only">Details</span></th></tr></thead><tbody>${tableRows(teams, model, compact)}</tbody></table></div>`; }
function performanceTable(teams) {
  return `<div class="table-scroll"><table class="performance-table"><caption class="sr-only">Experimental Performance · Scrimmage consistency rankings</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col" title="Opponent-adjusted net success rate relative to the measured FBS average, in percentage points">Performance · pp</th><th scope="col" class="hide-mobile">Offense success</th><th scope="col" class="hide-mobile">Defense allowed</th><th scope="col">Games measured</th><th class="hide-mobile"><span class="sr-only">Details</span></th></tr></thead><tbody>${teams.map(t => {
    const p = performanceRow(t);
    return `<tr><td><span class="table-rank ${(p.rank||999)<=3?'top':''}">${p.rank??'—'}</span></td><td><div class="team-cell">${logo(t)}<div>${teamLink(t)}<small>${esc(t.conference)}</small></div></div></td><td class="rating num">${performanceScore(p.score)}</td><td class="num hide-mobile">${probability(p.offensiveSuccessRate)}</td><td class="num hide-mobile">${probability(p.defensiveSuccessRateAllowed)}</td><td class="num performance-coverage">${esc(p.measuredGames)} / ${esc(p.expectedGames)}${p.provisional?' · provisional':''}</td><td class="hide-mobile"><a class="text-link" href="#team/${encodeURIComponent(t.id)}" aria-label="Explore ${esc(t.name)} Performance evidence">${icon('arrow')}</a></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function performanceNotice() {
  if (!hasPerformance()) return '';
  const coverage = state.performance.coverage || {};
  return `<div class="notice"><strong>Experimental scrimmage consistency</strong><p>This view measures how consistently teams gained the needed yards and prevented opponents from doing so, adjusted for opponents and location. Scores are percentage points above the measured FBS average. They are not win probabilities or a complete football-performance grade.</p><p><strong>Coverage:</strong> ${esc(coverage.measuredFbsGames??'—')} / ${esc(coverage.eligibleFbsGames??'—')} FBS games · ${esc(coverage.measuredFbsTeams??'—')} / ${esc(coverage.sourceFbsTeams??'—')} teams · same completed-game cutoff as SOR.</p><p>Historical FBS–FCS forecasting checks remain under review. All source-covered game states are included; special teams and turnover costs are not fully measured.</p><p class="compact-note">Game cutoff: ${snapshotDate({hour:'numeric',minute:'2-digit'})} MT · ${esc(state.performance.method?.name || 'Scrimmage consistency')} · ${esc(state.performance.method?.id || 'Experimental version')}</p>${Array.isArray(state.performance.limitations)&&state.performance.limitations.length?`<details><summary>Model limitations</summary><ul>${state.performance.limitations.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`:''}</div>`;
}
function performanceBreakdown(p) {
  const x = p.explanation || {};
  const terms = [['Measured net play success', x.observedNetContribution], ['Game-location adjustment', x.venueContribution],
    ['FBS/FCS matchup adjustment', x.divisionAdjustmentContribution], ['Opponent network', x.opponentContribution],
    ['Population reference', x.divisionOffset], ['FBS-average reference', x.fbsReferenceAdjustment]];
  if (!terms.every(([, value]) => Number.isFinite(value))) return '';
  return `<details><summary>Inspect score contributions</summary><div class="fact-list" style="margin-top:12px">${terms.map(([label, value]) => `<div class="fact-row"><span>${label}</span><strong>${performanceScore(100*value)}</strong></div>`).join('')}<div class="fact-row"><span>Performance score</span><strong>${performanceScore(p.score)}</strong></div></div><p class="compact-note">Contributions use percentage-point units and are rounded for display. Opponent and context adjustments come from the model’s results network.</p></details>`;
}
function performanceTeamPanel(t) {
  const p = performanceRow(t); if (!p) return '';
  return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('chart')}<h2>Performance</h2></div><span class="tag">EXPERIMENTAL</span></div><div class="panel-body"><div class="section-label">Scrimmage consistency</div><div class="model-rank-label"><strong>${rank(p.rank)}</strong><strong>${performanceScore(p.score)}</strong></div><p class="compact-note">Opponent-adjusted net success rate relative to the measured FBS average.</p><div class="fact-list"><div class="fact-row"><span>Offense success rate</span><strong>${probability(p.offensiveSuccessRate)}</strong></div><div class="fact-row"><span>Opponent success allowed</span><strong>${probability(p.defensiveSuccessRateAllowed)}</strong></div><div class="fact-row"><span>Games measured</span><strong>${esc(p.measuredGames)} / ${esc(p.expectedGames)}</strong></div></div><p class="compact-note">${esc(t.name)} succeeded on ${probability(p.offensiveSuccessRate)} of measured offensive plays; opponents succeeded on ${probability(p.defensiveSuccessRateAllowed)}. The score also accounts for the opponents faced and game location.${p.provisional?' Fewer than four measured games: provisional.':''}</p>${performanceBreakdown(p)}<p class="compact-note">This is a separate experimental view. Historical FBS–FCS forecasting checks remain under review.</p></div><a class="method-link" href="#rankings/performance">Explore Performance rankings ${icon('arrow')}</a></section>`;
}
function performanceMethodology() {
  if (!hasPerformance()) return '';
  return `<section class="panel method-block"><div class="section-label">03 · Experimental Performance</div><h2>HOW CONSISTENTLY DID THE TEAM PLAY?</h2><p>This separate view measures scrimmage consistency on CollegeFootballData’s covered plays. A play succeeds when it gains at least 50% of needed yards on first down, 70% on second down, and 100% on third or fourth down, following the source’s scoring-play rules.</p><div class="formula-display">Game net success rate = own offense success rate − opponent offense success rate</div><p>Each measured game receives one weight. Individual opponents, venue and FBS/FCS context inform an opponent-adjusted model. Displayed scores subtract the measured FBS average and use percentage-point units. Raw offense and defense rates are diagnostics rather than separate adjusted unit grades.</p><p>Human polls, betting lines, recruiting, conference reputation and previous team-season ratings do not enter this Performance calculation. It is separate from earned SOR and the matchup lab.</p><p>These source-covered plays do not represent every box-score play. This is not a complete special-teams, turnover, field-position or overtime-adjusted grade. Historical FBS–FCS forecasting checks remain under review; experimental display does not convert a failed check into a pass.</p></section>`;
}
function pipeline() { return `<section class="pipeline" aria-label="How the engine works"><div class="pipeline-title"><h2>HOW IT<br>COMES TOGETHER.</h2><p>TRANSPARENT BY DESIGN</p></div>${[['Acquire the data','Completed games and season-specific FBS membership.'],['Validate the results','Incomplete scores stay out. Every source is recorded.'],['Solve the network','Every opponent’s results connect to the bigger picture.'],['Explain the rank','A reproducible score, with evidence you can inspect.']].map(([title,desc],i)=>`<div class="pipeline-step"><span class="step-num">0${i+1}</span><div><h3>${title}</h3><p>${desc}</p></div></div>`).join('')}</section>`; }
function companionPanel() {
  const views = [['strength', 'Predictive Strength', 'Estimates team strength from score margins, opponents, venue, and our own historical ratings.']];
  if (hasPerformance()) views.push(['performance', 'Performance · Experimental', 'Measures how consistently teams succeeded on covered scrimmage plays, adjusted for opponents and venue.']);
  return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('layers')}<h2>Companion views</h2></div></div><div class="panel-body companion-views">${views.map(([model,label,description])=>`<div><a class="text-link" href="${rankingHash(model)}">${label} ${icon('arrow')}</a><p>${description}</p></div>`).join('')}<p class="compact-note">These views run separately from the national ranking.</p></div></section>`;
}
function renderHome() {
  const top = topTwentyFive(state.snapshot.rankings, 'achievement');
  const title = usesSor() ? 'OFFICIAL TOP 25' : 'HISTORICAL TOP 25';
  const summary = usesSor() ? 'The FBS Intelligence ranking weighs each team’s wins against the opponents it faced and where it played.' : 'This historical snapshot ranks teams by their results and the opponents they faced.';
  main.innerHTML = `<section class="hero home-hero"><div class="wrap hero-layout"><div><div class="eyebrow">${state.snapshot.season} FBS season · ${achievementName()}</div><h1>THE FBS<em>TOP 25.</em></h1><p class="hero-copy">${summary} Select a team to see how it earned its rank.</p><div class="hero-actions"><a class="button" href="${rankingHash('achievement', true)}">${icon('chart')}View all ${state.snapshot.fbsTeams} teams ${icon('chevron')}</a><a class="button outline" href="#methodology">${icon('layers')}Inside the engine</a></div></div><aside class="top-five"><div class="top-five-title">${icon('trophy')}<h2>THE TOP FIVE</h2><small>${snapshotDate()} SNAPSHOT</small></div>${top.slice(0,5).map(t=>`<a class="top-five-row" href="#team/${t.id}"><span class="rank-chip">${nationalRank(t)}</span>${logo(t)}<strong>${esc(t.name)}</strong><span>${record(t)}</span></a>`).join('')}<a class="top-five-footer" href="#rankings">Explore the Top 25 ${icon('chevron')}</a></aside></div></section><div class="wrap home-body"><div class="two-column"><section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('trophy')}<div><h2>${title}</h2><p>${achievementName()} rankings · ${state.snapshot.season} season · ${snapshotDate()} publication</p></div></div></div>${top.length?rankingTable(top,'achievement',true):'<div class="empty">No ranked teams in this snapshot.</div>'}<div class="table-footer"><a class="text-link" href="${rankingHash('achievement', true)}">View all ${state.snapshot.fbsTeams} FBS teams ${icon('arrow')}</a></div></section><aside class="stack">${coveragePanel()}${companionPanel()}${schedulePanel()}</aside></div>${pipeline()}</div>`;
}
function banner(kicker, title, description) { return `<section class="hero page-banner"><div class="wrap"><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div></section>`; }
function filterControls(showModel = false) {
  const conferences = [...new Set(state.snapshot.rankings.map(t=>t.conference))].sort();
  return `<div class="toolbar"><div class="toolbar-group"><label class="search-box">${icon('search')}<span class="sr-only">Search all FBS teams</span><input id="team-search" type="search" placeholder="Search all teams…" value="${esc(state.search)}" autocomplete="off"></label><label><span class="sr-only">Conference</span><select id="conference-filter" aria-label="Conference"><option value="">All conferences</option>${conferences.map(c=>`<option ${state.conference===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div>${showModel?`<button class="button light small" data-action="toggle-all">${state.all?'Show Top 25':`Show all ${state.snapshot.fbsTeams} teams`}</button>`:''}</div>`;
}
function rankingViews() {
  const views = [['achievement', usesSor() ? 'Official · Strength of Record' : achievementName()], ['strength', 'Predictive Strength']];
  if (hasPerformance()) views.push(['performance', 'Performance · Experimental']);
  return `<div class="segmented ranking-views" role="group" aria-label="Ranking views">${views.map(([model,label])=>`<button data-action="model" data-value="${model}" class="${state.model===model?'active':''}" aria-pressed="${state.model===model}">${label}</button>`).join('')}</div>`;
}
function filtered(teams) { return teams.filter(t => (!state.conference || t.conference===state.conference) && (!state.search || t.name.toLowerCase().includes(state.search.toLowerCase()))); }
function rankingsContent() {
  const list = ordered();
  const isFiltered = Boolean(state.search || state.conference);
  const pool = state.all || isFiltered ? list : topTwentyFive(list, state.model);
  const teams = filtered(pool);
  const title = isFiltered ? 'Matching teams' : state.all ? 'All FBS teams' : 'Top 25';
  return `<div class="panel-head"><div class="panel-head-title"><h2>${title}</h2></div><span class="tag">${teams.length} shown</span></div>${teams.length?rankingTable(teams):`<div class="empty">${isFiltered?'No teams match these filters.':'No ranked teams in this snapshot.'}</div>`}<div class="panel-body" style="padding-block:12px"><p class="compact-note">${state.model==='performance'?'Identical Performance scores share a rank. pp means percentage points relative to the measured FBS average.':'SOS ranks opponents’ average Colley ratings. '+(state.model==='strength'?'Strength is an experimental points-based estimate, separate from earned rank.':(usesSor()?'Identical SOR scores share a rank. SOR scores are not win probabilities.':'Identical Colley scores share a rank. Ratings are scores, not probabilities.'))}</p></div>`;
}
function renderRankings() {
  if (state.model === 'performance' && !hasPerformance()) state.model = 'achievement';
  const official = state.model === 'achievement';
  const views = {
    achievement: [usesSor() ? 'Official national ranking' : 'Historical national ranking', 'NATIONAL RANKINGS', usesSor() ? 'Strength of Record measures how hard it was to earn this many wins against the same schedule.' : 'This snapshot uses Colley achievement to rank teams from completed game results.'],
    strength: ['Companion view', 'PREDICTIVE STRENGTH', 'An opponent-adjusted estimate in points using score margins, location, and our own historical strength ratings.'],
    performance: ['Experimental companion view', 'PERFORMANCE', 'How consistently did teams gain the yards they needed and stop opponents from doing the same?']
  };
  const [kicker,title,description] = views[state.model];
  const context = official ? coveragePanel() : state.model === 'performance' ? performanceNotice() : `<section class="panel"><div class="panel-body"><div class="section-label">Predictive Strength</div><h2 style="margin:10px 0">HOW WOULD THEY MATCH UP?</h2><p>Predictive Strength powers the matchup lab. ${state.snapshot.matchupValidation ? 'Win probabilities are calibrated on historical results.' : 'Its game probabilities are uncalibrated estimates.'}</p></div><a class="method-link" href="#compare">Open matchup lab ${icon('arrow')}</a></section>`;
  main.innerHTML = `${banner(`${kicker} · ${state.snapshot.season}`,title,description)}<div class="wrap page-content">${rankingViews()}<div class="two-column"><div>${filterControls(true)}<section class="panel" id="ranking-results">${rankingsContent()}</section></div><aside class="stack">${context}${schedulePanel()}</aside></div></div>`;
}
function teamsContent() { const teams=filtered(state.snapshot.rankings); return `${teams.length?`<div class="team-grid">${teams.map(t=>`<a class="panel team-card" href="#team/${t.id}"><span class="team-card-rank">${rank(nationalRank(t))}</span>${logo(t)}<div><h3>${esc(t.name)}</h3><p>${esc(t.conference)}</p><small>${record(t)} · ${number(achievementScore(t))} ${usesSor(t)?'SOR':'Colley'}</small></div></a>`).join('')}</div>`:'<div class="panel empty">No teams match these filters.</div>'}<p class="results-count">${teams.length} of ${state.snapshot.fbsTeams} FBS teams</p>`; }
function renderTeams() { main.innerHTML = `${banner('The team directory','EVERY TEAM HAS A STORY.','Choose a team to inspect its results, opponent strength, and the exact calculation behind its rank.')}<div class="wrap page-content">${filterControls()}<div id="team-results">${teamsContent()}</div></div>`; }
function explanation(t) {
  const wins = t.contributions.filter(g=>g.result==='W').sort((a,b)=>b.opponentAchievement-a.opponentAchievement);
  const losses = t.contributions.filter(g=>g.result==='L');
  const winText = wins.filter(g=>state.byId.has(g.opponentId)).slice(0,2).map(g=>`<strong>${rank(opponentRank(g))} ${esc(g.opponentName)}</strong>`).join(' and ');
  const evidence = `<strong>${esc(t.name)}</strong> holds a <strong>${record(t)}</strong> record and the <strong>#${sosRank(t)}</strong> schedule by opponents’ average Colley ratings.${winText?` Its wins include ${winText}.`:''} ${losses.length?`The ${losses.length===1?'loss came':'losses came'} against ${losses.map(g=>`${opponentRank(g)?rank(opponentRank(g))+' ':''}${esc(g.opponentName)}`).join(', ')}.`:'It has no losses in the completed results.'}`;
  if (!usesSor(t)) return `${evidence} The Colley network produces an achievement score of <strong>${number(t.achievement)}</strong>.`;
  return `${evidence} Its <strong>Strength of Record score is ${number(t.sor)}</strong>. The model gives an average-strength FBS reference team a <strong>${probability(t.sorTailProbability)}</strong> chance of matching at least ${t.wins} wins against this schedule. Game location and a subdivision adjustment learned from historical FBS/FCS results affect those chances. Each game is removed from the network before its difficulty is measured.`;
}
function breakdown(t) {
  const x=t.explanation;
  const sor = usesSor(t) ? `<h3>STRENGTH OF RECORD</h3><div class="equation">SOR = −log10[P(at least ${t.wins} wins)] = <b>${number(t.sor)}</b></div><p class="compact-note">Reference-team chance: ${probability(t.sorTailProbability)}. Expected wins against this schedule: ${number(t.sorExpectedWins,2)}. A higher SOR score means a harder record to match; it is not this team’s next-game win probability.</p>` : '';
  if (!x) return `<div class="score-breakdown">${sor}<p class="compact-note">The Colley baseline breakdown is unavailable for this publication.</p></div>`;
  const terms = [['Baseline',x.baseline,'gray'],['Record',x.record,x.record<0?'negative':''],['Opponents',x.opponents,'dark']];
  return `<div class="score-breakdown">${sor}<h3>${usesSor(t)?'COLLEY BASELINE, EXPLAINED':'THE SCORE, EXPLAINED'}</h3>${terms.map(([label,value,cls])=>`<div class="term-row"><span>${label}</span><div class="term-track ${cls}"><span style="width:${Math.max(1,Math.min(100,Math.abs(value)*100))}%"></span></div><b>${number(value)}</b></div>`).join('')}<div class="equation">${number(x.baseline)} + ${number(x.record)} + ${number(x.opponents)} = <b>${number(t.achievement)}</b><br><code>${esc(x.formula)}</code></div><p class="compact-note" style="font-size:10px;margin-top:9px">${usesSor(t)?`These terms reconcile to the Colley baseline (${rank(t.colleyRank??t.rank)}), not the SOR score. Colley supplies the opponent network and displayed SOS; national and conference ranks use SOR.`:'These terms reconcile to the Colley score. Opponent effects are part of the jointly solved network.'}</p></div>`;
}
function resultsTable(t) { return `<div class="table-scroll"><table class="evidence-table"><caption class="sr-only">${esc(t.name)} completed results</caption><thead><tr><th>Result</th><th>Opponent</th><th>Record</th><th>Margin</th></tr></thead><tbody>${t.contributions.map(g=>{
  const o=state.byId.get(g.opponentId)||{id:g.opponentId,name:g.opponentName||g.opponentId};
  return `<tr><td><span class="outcome ${g.result==='L'?'loss':''}">${g.result}</span></td><td><div class="team-cell">${logo(o)}<div>${state.byId.has(o.id)?teamLink(o):esc(o.name)}<small>${opponentRank(g)?`${rank(opponentRank(g))} FBS ${achievementName()}`:'Opponent outside FBS rankings'}</small></div></div></td><td class="num">${esc(g.opponentRecord||'—')}</td><td class="num ${g.finalMargin>=0?'margin-positive':'margin-negative'}">${g.finalMargin>0?'+':''}${g.finalMargin}</td></tr>`;
  }).join('')}</tbody></table></div><div class="panel-body"><p class="compact-note">Only completed games appear. Opponent records and ranks reflect this publication, not the date of the matchup. Margins inform predictive strength, not achievement rank.</p></div>`; }
function modelRanks(t) { return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('layers')}<h2>Rank and strength</h2></div></div><div class="panel-body">${[[achievementName(),nationalRank(t),'What this team has earned from completed results.'],['Predictive strength',strengthRank(t),'A historical, opponent-adjusted estimate of team strength.']].map(([label,r,desc])=>`<div class="model-rank"><div class="model-rank-label"><div>${label}<br><small>${label===achievementName()?'NATIONAL RANKING':'EXPERIMENTAL MODEL'}</small></div><strong>${rank(r)}</strong></div><div class="model-track"><span style="width:${Math.max(2,(state.snapshot.fbsTeams-(r||state.snapshot.fbsTeams)+1)/state.snapshot.fbsTeams*100)}%"></span></div><p>${desc}</p></div>`).join('')}</div></section>`; }
function qualityPanel() { const audit=state.snapshot.source?.audit||{};const incomplete=audit.incompleteFinals?.length||0;return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('shield')}<h2>Data & coverage</h2></div></div><div class="panel-body"><div class="data-status-row"><span>${icon('check')}FBS membership</span><b>${state.snapshot.fbsTeams} teams</b></div><div class="data-status-row"><span>${icon('check')}Game records modeled</span><b>${state.snapshot.gamesUsed.toLocaleString()}</b></div><div class="data-status-row"><span>${icon('check')}Data provider</span><b>CFBD</b></div><div class="data-status-row"><span>${icon('check')}Publication</span><b>${snapshotDate()}</b></div>${incomplete?`<details class="quality-note"><summary>${incomplete} incomplete finals excluded</summary><p>CFBD marked these entries complete without valid final scores. They do not count toward the rankings: ${audit.incompleteFinals.map(esc).join(', ')}.</p></details>`:''}<p class="compact-note" style="font-size:10px;margin-top:12px">The next scheduled refresh is Sunday at 8 AM Mountain.</p></div></section>`; }
function teamCenterContent(t) {
  if(state.teamTab==='results') return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('calendar')}<h2>THE COMPLETED RESULTS</h2></div><span class="tag">${t.games} GAMES</span></div>${resultsTable(t)}</section>`;
  if(state.teamTab==='model') return `<section class="panel"><div class="panel-body"><div class="explanation-head">${icon('layers')}<h2>THE CALCULATION</h2></div><p class="team-narrative">${achievementName()} is built from this season’s results. Predictive strength runs separately using bounded score margins, location, and our own prior-season strength.</p>${breakdown(t)}<div class="fact-list" style="margin-top:22px"><div class="fact-row"><span>Current predictive strength</span><strong>${number(t.strength,2)} pts</strong></div><div class="fact-row"><span>Preseason strength prior</span><strong>${number(t.preseasonStrength,2)} pts</strong></div><div class="fact-row"><span>Conference ${achievementName()} rank</span><strong>${rank(conferenceRank(t))}</strong></div></div></div><a class="method-link" href="#methodology">Read the full methodology ${icon('arrow')}</a></section>`;
  return `<div class="metric-grid">${[[achievementName(),rank(nationalRank(t)),'National rank'],['Schedule',`#${sosRank(t)}`,'Colley opponent average'],['Conference',rank(conferenceRank(t)),t.conference],['Record',record(t),`${t.games} completed games`]].map(([label,value,note])=>`<div class="metric"><span>${label}</span><strong>${value}</strong><small>${esc(note)}</small></div>`).join('')}</div><section class="panel"><div class="panel-body"><div class="explanation-head">${icon('network')}<h2>WHY WE RANK ${esc(t.name.toUpperCase())} ${rank(nationalRank(t))}</h2></div><p class="team-narrative">${explanation(t)}</p><div class="evidence-chips"><span class="evidence-chip">Opponent Colley average <b>${number(t.achievementScheduleStrength)}</b></span><span class="evidence-chip">${t.evidence?.connectedTeams??'—'} connected teams</span><span class="evidence-chip">${t.evidence?.provisional?'Small sample · provisional':'Current-season evidence'}</span></div>${breakdown(t)}</div></section><section class="panel" style="margin-top:17px"><div class="panel-head"><div class="panel-head-title">${icon('trophy')}<h2>RESULTS THAT SHAPE THE RESUME</h2></div><button class="text-link" style="border:0;background:none" data-action="team-tab" data-value="results">All results ${icon('arrow')}</button></div>${resultsTable({...t,contributions:[...t.contributions].sort((a,b)=>b.opponentAchievement-a.opponentAchievement).slice(0,3)})}</section>`;
}
function renderTeam(id) {
  const t=state.byId.get(id);
  if(!t){main.innerHTML=`<div class="wrap page-content"><section class="panel empty"><h2>Team not found</h2><p>Choose a team from the FBS directory.</p><a class="button" style="margin-top:15px" href="#teams">Explore teams</a></section></div>`;return;}
  main.innerHTML=`<section class="hero team-banner"><div class="wrap"><a class="breadcrumb" href="#rankings">${icon('back')}Back to the rankings</a><div class="team-banner-content">${logo(t,'large')}<div><div class="eyebrow">${esc(t.conference)} · ${state.snapshot.season} season</div><h1>${esc(t.name.toUpperCase())}</h1><div class="team-meta"><span><b>${rank(nationalRank(t))}</b> ${achievementName()}</span><span>${record(t)} overall</span><span>${rank(conferenceRank(t))} in conference</span></div></div><div class="team-banner-score"><strong>${number(achievementScore(t))}</strong><span>${usesSor(t)?'SOR score':'Colley rating'}</span></div></div></div></section><div class="wrap page-content"><div class="team-layout"><aside class="panel rank-rail"><div class="panel-head"><div class="panel-head-title">${icon('trophy')}<h2>THE TOP 25</h2></div></div><div class="rail-list">${topTwentyFive(state.snapshot.rankings, 'achievement').map(o=>`<a href="#team/${o.id}" class="rail-row ${o.id===t.id?'selected':''}" ${o.id===t.id?'aria-current="page"':''}><span>${nationalRank(o)}</span>${logo(o)}<b>${esc(o.name)}</b><small>${record(o)}</small></a>`).join('')}</div><a class="method-link" href="#rankings/all">All rankings ${icon('arrow')}</a></aside><div class="team-center"><div class="tabs" aria-label="Team sections">${[['overview','Overview'],['results','Results'],['model','Model details']].map(([value,label])=>`<button data-action="team-tab" data-value="${value}" class="${state.teamTab===value?'active':''}" aria-pressed="${state.teamTab===value}">${label}</button>`).join('')}</div><div id="team-center-content">${teamCenterContent(t)}</div></div><aside class="stack team-right">${modelRanks(t)}${performanceTeamPanel(t)}${qualityPanel()}<section class="panel"><div class="panel-body"><div class="section-label">Ask a different question</div><h3 style="margin:9px 0 12px">HOW WOULD THEY MATCH UP?</h3><p class="compact-note">Use the strength model to explore a matchup on a neutral field.</p><button class="button small full-width" style="margin-top:15px" data-action="compare-team" data-value="${t.id}">${icon('compare')}Open matchup lab</button></div></section></aside></div></div>`;
}
function validationSummary() {
  const coverage = state.snapshot.coverageValidation;
  const matchup = state.snapshot.matchupValidation;
  const test = matchup?.winProbability.evaluation;
  const band = matchup?.marginBand;
  const current = coverage ? `<p><strong>Current game coverage.</strong>
    This snapshot includes ${coverage.fbsVsFbs.toLocaleString()} FBS–FBS games and ${coverage.fbsVsFcs.toLocaleString()} FBS–FCS games.
    Every direct FBS opponent is classified. The wider opponent network includes ${coverage.fcsVsFcs.toLocaleString()} FCS–FCS games
    and ${coverage.gamesWithUnknownDivision.toLocaleString()} records involving teams with an unknown subdivision.
    A missing subdivision for a direct FBS opponent blocks SOR publication.</p>` : '';
  const probabilities = test ? `<p><strong>Matchup odds.</strong>
    We fitted the odds to earlier results and replayed ${test.games.toLocaleString()} FBS matchups in ${test.firstSeason}–${test.lastSeason}
    using only earlier games for each forecast. Brier score fell from ${number(test.baselineBrier, 3)} to ${number(test.brier, 3)}.
    Lower is better. The favored teams stayed the same. Live forecast accuracy remains under evaluation.</p>` : '';
  const uncertainty = band ? `<p><strong>Margin uncertainty.</strong>
    The Matchup Lab shows a historical final-margin range once both teams have played ${band.minTeamGames} games.
    The range covered ${band.evaluation.inside.toLocaleString()} of ${band.evaluation.games.toLocaleString()} later test games
    (${number(100 * band.evaluation.inside / band.evaluation.games, 1)}%). Confidence intervals for team ranks remain unvalidated.</p>` :
    '<p><strong>Uncertainty.</strong> Confidence intervals for team ranks remain unvalidated.</p>';
  return `<section class="notice" aria-labelledby="validation-heading">
    <h2 id="validation-heading">WHAT WE CHECKED</h2>
    <p><strong>Historical archives.</strong> Our audit covered 2004–2025. The original archive has no FCS–FCS results in 2004–2013 and only 15 in 2020. A separate research dataset recovered 674 FBS postseason results missing from the original 2004–2022 archive. FCS coverage still varies by season. <a class="text-link" href="https://www.ncaa.com/history/football/fcs">NCAA FCS championship records</a></p>
    ${current}${probabilities}${uncertainty}
    <p><strong>Performance.</strong> Coverage counts are for provider-covered games in each saved snapshot. An earlier FBS–FCS forecasting check missed its bias target, so Performance remains an experimental description of play.</p>
    <p><a class="text-link" href="https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/blob/main/reports/methodology-audit-2026-11-07.md">Read the validation audit</a></p>
  </section>`;
}
function renderMethodology() {
  main.innerHTML=`${banner('Open the black box','THE EVIDENCE IS THE POINT.',(hasPerformance()?'Three views.':'Two models.')+' Clear purposes. Reproducible calculations. Every ranking starts with data you can trace.')}<div class="wrap page-content"><div class="method-grid"><div class="stack"><section class="panel method-block"><div class="section-label">01 · National ranking</div><h2>WHAT HAS A TEAM EARNED?</h2>${usesSor()?`<p>Our primary national and conference ranking uses <strong>division-aware Strength of Record (SOR)</strong>. It asks how likely an average-strength FBS reference team would be to earn at least this many wins against the same opponents, at the same locations. A harder record to match earns a higher score.</p><div class="formula-display">SOR = −log10[P(reference team wins at least this many games)]</div><p>We remove each game before measuring its difficulty, then combine the per-game probabilities under an independence assumption. Venue and the FBS/FCS gap use fixed coefficients learned from older seasons. Individual opponent results still matter; there is no fixed percentage discount for every FCS win.</p><p>The Colley network remains the opponent-rating baseline and the source of displayed SOS. Its original scores and ranks are retained separately:</p>`:`<p>This historical snapshot uses the Colley matrix method. Current-season wins and losses connect each team to its opponents and the rest of the results network. It has not been relabeled as historical SOR.</p>`}<div class="formula-display">Colley = [1 + (wins − losses) ÷ 2 + Σ opponent ratings] ÷ (games + 2)</div><p>Score margins, human polls and conference prestige do not affect earned rank. Past team success gives no current-season achievement credit. Head-to-head results enter the network without automatic ranking overrides. ${usesSor()?'Historical calibration supports this probability mapping; future saved forecasts remain under evaluation.':'Venue and subdivision labels do not change the Colley baseline formula.'}</p></section><section class="panel method-block"><div class="section-label">02 · Predictive strength</div><h2>WHAT DOES THE EVIDENCE SUGGEST NEXT?</h2><p>A separate experimental model fits opponent-adjusted score margins, with a location adjustment and a limit on blowout influence. Its preseason starting point is our own previous-season strength, regressed toward the mean.</p><ul><li>Score margins are bounded using a smooth cap.</li><li>Home advantage is ${state.snapshot.config.homeAdvantage} points; neutral games receive no home adjustment.</li><li>Historical retention is ${Math.round(state.snapshot.config.retention*100)}% per season gap.</li><li>${state.snapshot.matchupValidation ? 'Win probabilities are calibrated on historical results and tested on later seasons.' : 'Matchup probabilities are uncalibrated estimates.'}</li></ul><p>This model is not blended into the achievement ranking. The matchup lab uses strength only.</p></section>${performanceMethodology()}</div><aside class="stack"><section class="panel method-block"><h2>FROM DATA TO EXPLANATION</h2><div class="method-steps">${[['Acquire','Fetch the season’s results and FBS membership from CollegeFootballData.'],['Validate','Require valid team identities, completed games, and final scores.'],['Connect','Model opponents individually across the connected game network.'],['Calculate',usesSor()?'Calculate Strength of Record from the Colley opponent network; keep predictive strength separate.':'Solve the Colley achievement and predictive strength models separately.'],['Publish','Save a reproducible snapshot and the evidence behind each score.']].map(([title,desc])=>`<div class="method-step"><div><h3>${title}</h3><p>${desc}</p></div></div>`).join('')}</div></section>${qualityPanel()}${schedulePanel()}</aside></div>${validationSummary()}</div>`;
}
function compareOptions(id) { return [...state.snapshot.rankings].sort((a,b)=>a.name.localeCompare(b.name)).map(t=>`<option value="${t.id}" ${id===t.id?'selected':''}>${esc(t.name)}</option>`).join(''); }
function compareResult() {
  const a=state.byId.get(state.compareA),b=state.byId.get(state.compareB);
  const edge=a.strength-b.strength+(state.venue==='home'?state.snapshot.config.homeAdvantage:state.venue==='away'?-state.snapshot.config.homeAdvantage:0);
  const scale = state.snapshot.matchupValidation?.winProbability.scale ?? state.snapshot.config.probabilityScale;
  const probability = 1 / (1 + Math.exp(-edge / scale));
  return {a,b,edge,probability};
}
function matchupMarginRange(a, b, edge) {
  const band = state.snapshot.matchupValidation?.marginBand;
  if (!band || a.games < band.minTeamGames || b.games < band.minTeamGames) return '';
  const low = Math.ceil(edge - band.halfWidth);
  const high = Math.floor(edge + band.halfWidth);
  const signed = points => points < 0 ? `−${Math.abs(points)}` : points > 0 ? `+${points}` : '0';
  return `<p style="margin-top:12px">Historical final-margin range for ${esc(a.name)}<br><strong>${signed(low)} to ${signed(high)} pts</strong></p>`;
}
function matchupNav(active) {
  return `<nav class="matchup-views" aria-label="Matchup Lab views">
    <a href="#compare"${active === 'compare' ? ' aria-current="page"' : ''}>Compare teams</a>
    <a href="#compare/weekly"${active === 'weekly' ? ' aria-current="page"' : ''}>Weekly picks</a>
  </nav>`;
}
function picksTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}
function weekKey(game) { return `${game.seasonType}:${game.week}`; }
function weekLabel(game) { return game.seasonType === 'postseason' ? `Postseason · Week ${game.week}` : `Week ${game.week}`; }
function picksPublication(data) {
  if (data?.schemaVersion !== 1 || data.season !== state.snapshot.season || !Number.isFinite(picksTime(data.asOf)) ||
    !Array.isArray(data.teams) || !Array.isArray(data.games)) throw new Error('Invalid weekly picks publication');
  const teams = new Map();
  for (const team of data.teams) {
    if (typeof team?.id !== 'string' || !team.id || typeof team.name !== 'string' || !team.name.trim() || teams.has(team.id))
      throw new Error('Invalid weekly picks team');
    teams.set(team.id, team);
  }
  const ids = new Set();
  for (const game of data.games) {
    if (typeof game?.id !== 'string' || !game.id || ids.has(game.id) || game.home === game.away ||
      !teams.has(game.home) || !teams.has(game.away) || !Number.isFinite(picksTime(game.startDate)) ||
      !Number.isInteger(game.week) || !['regular', 'postseason'].includes(game.seasonType) ||
      !['scheduled', 'final', 'pending'].includes(game.status) || typeof game.neutral !== 'boolean' ||
      (game.status === 'final' && ![game.homePoints, game.awayPoints].every(points => Number.isInteger(points) && points >= 0)))
      throw new Error('Invalid weekly picks game');
    ids.add(game.id);
  }
  const games = [...data.games].sort((a, b) => picksTime(a.startDate) - picksTime(b.startDate) || a.id.localeCompare(b.id));
  const weeks = new Map();
  for (const game of games) {
    const key = weekKey(game);
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(game);
  }
  const next = games.find(game => game.status === 'scheduled' && picksTime(game.startDate) >= picksTime(data.asOf));
  const latest = games.findLast(game => game.status !== 'scheduled');
  return { data, teams, weeks, selectedWeek: games.length ? weekKey(next ?? latest ?? games[0]) : '' };
}
async function loadWeeklyPicks() {
  try {
    const response = await fetch(publicationPath('weekly-picks'), { headers: { Accept: 'application/json' } });
    if (response.status === 404 || response.status === 410) weeklyPicks.status = 'missing';
    else if (!response.ok) throw new Error(`Weekly picks returned ${response.status}`);
    else if (response.headers?.get('content-type')?.includes('text/html')) {
      const html = await response.text();
      if (!html.includes('<title>FBS Intelligence · FBS Top 25</title>') || !html.includes('name="publication-data-root"'))
        throw new Error('Weekly picks returned unexpected HTML');
      weeklyPicks.status = 'missing';
    } else {
      Object.assign(weeklyPicks, picksPublication(await response.json()), { status: 'ready' });
    }
  } catch (error) {
    weeklyPicks.status = 'error';
    console.error(error);
  }
  if (route()[0] === 'compare' && route()[1] === 'weekly') {
    renderWeeklyPicks();
    document.querySelector('#announce').textContent = weeklyPicks.status === 'ready' ? 'Weekly picks loaded' : 'Weekly picks unavailable';
  }
}
function validWeeklyPick(game, pick, capturedAt) {
  const p = pick?.homeWinProbability;
  const capture = picksTime(capturedAt);
  return Number.isFinite(p) && p >= 0 && p <= 1 && pick.favored === (p === .5 ? 'even' : p > .5 ? 'home' : 'away') &&
    Number.isFinite(capture) && capture < picksTime(game.startDate) && capture <= picksTime(weeklyPicks.data.asOf) &&
    [game.home, game.away].every(id => weeklyPicks.teams.get(id).division === 'fbs');
}
function weeklyPicksGame(game) {
  const away = weeklyPicks.teams.get(game.away);
  const home = weeklyPicks.teams.get(game.home);
  const scheduled = game.status === 'scheduled' && picksTime(game.startDate) >= picksTime(weeklyPicks.data.asOf);
  const live = validWeeklyPick(game, game.pick, game.pick?.capturedAt);
  const replay = !live && !scheduled && validWeeklyPick(game, game.replay, game.replay?.asOf);
  const estimate = !live && scheduled && validWeeklyPick(game, game.estimate, game.estimate?.asOf);
  const pick = live ? game.pick : replay ? game.replay : estimate ? game.estimate : null;
  const capture = live ? pick.capturedAt : pick?.asOf;
  const pickLabel = live ? 'Saved pregame pick' : replay ? 'Historical replay' : estimate ? 'Preview odds · From saved ratings' : 'Model pick';
  const favored = pick?.favored === 'home' ? home : away;
  const pickText = pick ? (pick.favored === 'even' ? 'Even · 50.0% each' :
    `${esc(favored.name)} · ${number(Math.max(pick.homeWinProbability, 1 - pick.homeWinProbability) * 100, 1)}%`) :
    (scheduled ? 'No pick saved yet' : 'No saved pregame pick');
  const winner = game.status === 'final' && game.homePoints !== game.awayPoints ?
    (game.homePoints > game.awayPoints ? 'home' : 'away') : null;
  const grade = live && winner && pick.favored !== 'even' ? (winner === pick.favored ? 'Correct' : 'Missed') : '';
  const result = game.status === 'final' ?
    (winner ? `${esc(winner === 'home' ? home.name : away.name)} won ${Math.max(game.homePoints, game.awayPoints)}–${Math.min(game.homePoints, game.awayPoints)}` :
      `Tied ${game.awayPoints}–${game.homePoints}`) :
    (scheduled ? 'Scheduled' : 'Final score pending');
  const team = entry => state.byId.has(entry.id) ? `<a href="#team/${encodeURIComponent(entry.id)}">${esc(entry.name)}</a>` : esc(entry.name);
  return { grade, html: `<li class="weekly-game">
    <div><h3>${team(away)} ${game.neutral ? 'vs' : 'at'} ${team(home)}</h3>
    <p class="compact-note"><time datetime="${esc(game.startDate)}">${picksDate.format(picksTime(game.startDate))}</time>${game.neutral ? ' · Neutral site' : ''}</p></div>
    <dl class="weekly-game-details">
      <div><dt>${pickLabel}</dt><dd>${pickText}${capture ? `<small><time datetime="${esc(capture)}">${picksTimestamp.format(picksTime(capture))} MT</time></small>` : ''}</dd></div>
      <div><dt>${game.status === 'final' ? 'Final' : 'Status'}</dt><dd>${result}${grade ? ` <span class="weekly-grade ${grade.toLowerCase()}">${grade}</span>` : ''}</dd></div>
    </dl></li>` };
}
function weeklyResults() {
  const games = weeklyPicks.weeks.get(weeklyPicks.selectedWeek);
  const rows = games.map(weeklyPicksGame);
  const correct = rows.filter(row => row.grade === 'Correct').length;
  const missed = rows.filter(row => row.grade === 'Missed').length;
  const record = correct + missed ? `${correct} correct · ${missed} missed` : 'No saved picks graded this week';
  return `<p class="weekly-record">${games.length} ${games.length === 1 ? 'game' : 'games'} · ${record}</p>
    <ul class="weekly-list" aria-label="Games for ${esc(weekLabel(games[0]))}">${rows.map(row => row.html).join('')}</ul>`;
}
function renderWeeklyPicks() {
  const { status, data, weeks, selectedWeek } = weeklyPicks;
  let body;
  if (status === 'ready') {
    const cutoff = Number.isFinite(picksTime(data.source?.scheduleAsOf)) ? data.source.scheduleAsOf : data.asOf;
    const provider = data.source?.provider === 'cfbd' ? 'CollegeFootballData' : data.source?.provider === 'sportsdataverse' ? 'sportsdataverse' : '';
    body = `<p class="compact-note">Schedule and results${provider ? ` from ${provider}` : ''} as of <time datetime="${esc(cutoff)}">${picksTimestamp.format(picksTime(cutoff))} MT</time>.${data.source?.extraScoreProvider === 'ESPN' ? ' Some final scores are from ESPN.' : ''}</p>
      <p class="compact-note">Predictive Strength picks cover FBS vs. FBS games. The weekly update saves picks up to seven days ahead. The record grades picks saved before kickoff. Historical replays and preview odds are separate.</p>
      ${weeks.size ? `<div class="weekly-controls"><label for="weekly-week">Select week</label><select id="weekly-week">${[...weeks].map(([key, games]) =>
        `<option value="${esc(key)}"${key === selectedWeek ? ' selected' : ''}>${esc(weekLabel(games[0]))}</option>`).join('')}</select></div>
        <div id="weekly-results">${weeklyResults()}</div>` : '<p class="compact-note">No games in the saved schedule.</p>'}`;
  } else {
    body = `<p class="compact-note" role="status">${status === 'loading' ? 'Loading the saved schedule and picks…' :
      status === 'missing' ? 'Weekly picks will appear when the first schedule is published.' :
        'The saved weekly picks could not load. Refresh to try again.'}</p>`;
  }
  main.innerHTML = `${banner('Matchup lab · Predictive Strength', 'WEEKLY PICKS', 'See the model’s win chances for scheduled games and how its saved picks did once the scores were final.')}
    <div class="wrap page-content">${matchupNav('weekly')}<section class="panel weekly-picks" aria-labelledby="weekly-picks-title">
    <div class="panel-body"><h2 id="weekly-picks-title">${state.snapshot.season} schedule and picks</h2>${body}</div></section></div>`;
  if (status === 'loading') weeklyPicks.request ??= loadWeeklyPicks();
}
function renderCompare() {
  if (route()[0] === 'compare' && route()[1] === 'weekly') return renderWeeklyPicks();
  const {a,b,edge,probability}=compareResult();
  const matchup = state.snapshot.matchupValidation;
  const explanation = matchup
    ? 'Win probabilities were calibrated on past results. The historical margin range describes how far final scores varied from this estimate in a later test. Negative margins favor Team B.'
    : 'These probabilities have not been calibrated. The margin is fitted from bounded historical score differences and should not be treated as a betting spread.';
  main.innerHTML=`${banner('Matchup lab · Experimental strength model','CHANGE THE MATCHUP. FOLLOW THE NUMBERS.','Compare two teams using our own historical and opponent-adjusted strength ratings.')}<div class="wrap page-content">${matchupNav('compare')}<div class="segmented compare-venue" aria-label="Game location">${[['neutral','Neutral field'],['home','Team A at home'],['away','Team B at home']].map(([v,label])=>`<button data-action="venue" data-value="${v}" class="${state.venue===v?'active':''}" aria-pressed="${state.venue===v}">${label}</button>`).join('')}</div><div class="compare-layout">${[a,b].map((t,i)=>`<section class="panel compare-picker"><div class="section-label">TEAM ${i?'B':'A'}</div>${logo(t,'large')}<h2>${esc(t.name)}</h2><p>${record(t)} · ${rank(nationalRank(t))} ${achievementName()}</p><label><span class="sr-only">Team ${i?'B':'A'}</span><select id="compare-${i?'b':'a'}">${compareOptions(t.id)}</select></label><p style="margin-top:14px">Strength <strong>${number(t.strength,2)} pts</strong> · ${rank(strengthRank(t))}</p></section>`).join('')}<section class="panel prediction-card"><div class="eyebrow">${matchup ? 'Historically calibrated odds' : 'Experimental model estimate'}</div><h2>${esc(edge>=0?a.name:b.name)} edge</h2><div class="prediction-number">${number(Math.abs(edge),1)}<span style="font-size:27px"> pts</span></div><p>Bounded-model margin estimate</p><div class="probability-track"><span style="width:${probability*100}%"></span></div><p>${esc(a.name)} ${number(probability*100,1)}% &nbsp; · &nbsp; ${esc(b.name)} ${number((1-probability)*100,1)}%</p>${matchupMarginRange(a,b,edge)}</section></div><div class="notice"><strong>Reading the matchup.</strong> ${explanation} <a class="text-link" href="#methodology">See what we checked</a></div></div>`;
}
function render() {
  if(!state.snapshot)return;
  renderHeader();
  const [page,id,scope]=route();
  if (page === 'rankings') {
    state.model = id === 'strength' || (id === 'performance' && hasPerformance()) ? id : 'achievement';
    state.all = id === 'all' || scope === 'all';
  }
  if(page==='home')renderHome();else if(page==='rankings')renderRankings();else if(page==='teams')renderTeams();else if(page==='team')renderTeam(id);else if(page==='methodology')renderMethodology();else if(page==='compare')renderCompare();else renderHome();
  const team=state.byId.get(id);document.title=`${page==='team'&&team?team.name:({home:'FBS Top 25',rankings:'National rankings',teams:'Team directory',compare:id==='weekly'?'Weekly picks':'Matchup lab',methodology:'Methodology'}[page]||'Home')} · ${BRAND}`;
  document.querySelector('#announce').textContent=document.title;
}
document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement && e.target.closest('.logo'))e.target.closest('.logo').classList.add('failed');},true);
document.addEventListener('input',e=>{
  if(e.target.id==='team-search'){
    state.search=e.target.value;
    const rankings=document.querySelector('#ranking-results');if(rankings)rankings.innerHTML=rankingsContent();
    const teams=document.querySelector('#team-results');if(teams)teams.innerHTML=teamsContent();
  }
});
document.addEventListener('change',e=>{
  if(e.target.id==='conference-filter'){state.conference=e.target.value;route()[0]==='teams'?renderTeams():renderRankings();}
  if(e.target.id==='compare-a'){state.compareA=e.target.value;renderCompare();}
  if(e.target.id==='compare-b'){state.compareB=e.target.value;renderCompare();}
  if (e.target.id === 'weekly-week' && weeklyPicks.weeks.has(e.target.value)) {
    weeklyPicks.selectedWeek = e.target.value;
    document.querySelector('#weekly-results').innerHTML = weeklyResults();
    document.querySelector('#announce').textContent = `${weekLabel(weeklyPicks.weeks.get(weeklyPicks.selectedWeek)[0])} games shown`;
  }
});
document.addEventListener('click',e=>{
  if(e.target.closest('.skip-link')){e.preventDefault();main.focus();main.scrollIntoView();return;}
  const button=e.target.closest('[data-action]');if(!button)return;
  const {action,value}=button.dataset;
  if (action === 'model' && (['achievement', 'strength'].includes(value) || (value === 'performance' && hasPerformance()))) {
    location.hash = rankingHash(value, state.all);
    render();
  }
  if (action === 'toggle-all') {
    state.search = '';
    state.conference = '';
    location.hash = rankingHash(state.model, !state.all);
    render();
  }
  if(action==='team-tab'){state.teamTab=value;renderTeam(route()[1]);}
  if(action==='venue'){state.venue=value;renderCompare();}
  if(action==='compare-team'){state.compareA=value;if(state.compareB===value)state.compareB=state.snapshot.rankings.find(t=>t.id!==value).id;location.hash='compare';}
});
window.addEventListener('hashchange',()=>{state.teamTab='overview';render();window.scrollTo({top:0,behavior:'instant'});});
async function load(){
  try{
    const response=await fetch(publicationPath('rankings'),{headers:{Accept:'application/json'}});
    if(!response.ok)throw Error(`Rankings returned ${response.status}`);
    const snapshot=await response.json();
    if(!snapshot.rankings?.length)throw Error('No published rankings');
    state.snapshot=snapshot;state.byId=new Map(snapshot.rankings.map(t=>[t.id,t]));
    state.performance=null;state.performanceById=new Map();
    state.compareA=snapshot.rankings[0].id;state.compareB=snapshot.rankings[1].id;
    render();
    // The primary publication stays usable when the optional research view is
    // absent, stale or unavailable. Visitors read stored snapshots only.
    if(snapshot.performanceEndpoint===publicationPath('performance')){
      try{
        const performanceResponse=await fetch(snapshot.performanceEndpoint,{headers:{Accept:'application/json'}});
        if(performanceResponse.ok&&state.snapshot===snapshot&&acceptPerformance(await performanceResponse.json()))render();
      }catch{}
    }
  }catch(error){main.innerHTML=`<section class="loading"><h1>The rankings are taking a moment.</h1><p>${dataRoot?'The published data could not load. Please try again shortly.':'The free service may be waking up. Please try again shortly.'}</p><button id="retry" class="button">Try again</button></section>`;document.querySelector('#retry').addEventListener('click',load);console.error(error);}
}
load();
