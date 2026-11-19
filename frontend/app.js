import { ACCOUNT_ROUTE_EVENT, isAccountCallbackUrl, pendingAccountRoute, safeAccountReturnPath } from './bracket-auth.js?v=clean-routes';
import { routeFromUrl, routeHref } from './clean-routes.js';
import { APP_NAVIGATION_EVENT, internalNavigationTarget, navigateApp, replaceLegacyAppUrl } from './clean-navigation.js';

const BRAND = 'The Games Decide';
const main = document.querySelector('#main');
let shareCardButton = () => '';
let kickoffCalendar = () => '';
let gameActionsModule;
function loadGameActions() {
  gameActionsModule ??= Promise.all([import('./share-card.js?v=platform-review'), import('./game-calendar.js?v=platform-review')]).then(([sharing, calendar]) => {
    sharing.mountShareCards(main);
    shareCardButton = sharing.shareCardButton;
    kickoffCalendar = calendar.kickoffCalendar;
  }).catch(() => { gameActionsModule = null; });
  return gameActionsModule;
}
// Static builds set this root. The web service keeps its existing JSON routes.
const dataRoot = document.querySelector('meta[name="publication-data-root"]')?.content;
const state = { snapshot: null, byId: new Map(), byFcsId: new Map(), performance: null, performanceById: new Map(), fcsPerformanceById: null, division: 'fbs', model: 'achievement', search: '', conference: '', all: false, teamTab: 'overview', compareA: '254', compareB: '2390', venue: 'neutral' };
let performanceLoading = false;
let performanceFailed = false;
const teamDetails = new Map();
const weeklyPickTabs = {
  fbs: { division: 'fbs', endpoint: 'weekly-picks', status: 'loading' },
  fcs: { division: 'fcs', endpoint: 'weekly-fcs-picks', status: 'loading' },
};
const rankingEditions = { data: null, cfpRanks: new Map(), request: null, failed: false };
let focusMoreDestination = false;
let bracketModule;
let closeBracket;
let scenarioModule;
let closeScenario;
let contestModule;
let closeContest;
let historyModule;
let closeHistory;
let scoreboardModule;
let teamPlayersModule;
let scoreboardPage;
let rankingsFailed = false;
let footballFormat;
let footballFormatRequest;
let gameFilterModule;
let myTeamsStore;
let favoriteSubscription;
let mountedFeature;
const featureRequests = new Map();
let renderedHeader;
let rankingsHubView;
let conferenceStrengthModule;
let favoriteModule;
let rootingGuideModule;
let closeFavorite;
let focusedGameLink;
const accountReturnKey = 'fbs-account-return';
const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(window.location?.hostname) && window.fbsReviewPreview;
const rankingsHubTabs = [
  ['fbs', '/rankings', 'FBS'], ['fcs', '/rankings/fcs/', 'FCS'],
  ['polls', '/polls/ap/', 'Compare Rankings'], ['forge-top-25', '/forge-rankings/', 'Forge’s Rankings'],
  ['conference-strength', '/conference-strength/', 'Conference Strength'],
];
const pollSources = {
  ap: { name: 'AP Top 25', short: 'AP', url: 'https://apnews.com/hub/ap-top-25-college-football-poll' },
  coaches: { name: 'Coaches Poll', short: 'Coaches', url: 'https://www.afca.com/polls/' },
  cfp: { name: 'CFP Rankings', short: 'CFP', url: 'https://collegefootballplayoff.com/rankings' }
};
const editionDates = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const picksDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' });
const picksTimestamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
const scheduleDateOnly = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const scheduleDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
const scheduleKickoff = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
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
function icon(name) { return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name] || paths.info}"/></svg>`; }
function publicationPath(name) { return dataRoot ? `${dataRoot}/${name}.json` : `/${name}`; }
const playerTabs = new Set(['players', 'availability']);
function playerPublicationPath(kind, team) { return publicationPath(`${kind}/${encodeURIComponent(team.id)}`); }
function mountPlayerFeature(target, mount) {
  if (!target?.isConnected) return;
  teamPlayersModule ??= import('./team-players.js?v=1').catch(error => { teamPlayersModule = null; throw error; });
  teamPlayersModule.then(module => {
    if (target.isConnected) return mount(module);
  }).catch(() => {
    if (target.isConnected) target.innerHTML = '<p class="compact-note">Player information could not load. Reload to try again.</p>';
  });
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function record(t) { return footballFormat ? footballFormat.formatRecord(t) : `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}`; }
function number(n, digits = 4) {
  if (footballFormat) return footballFormat.formatNumber(n, digits);
  return Number.isFinite(n) ? Number(n.toFixed(digits)).toFixed(digits) : '—';
}
function recordArticle(t) { return footballFormat?.indefiniteArticle(record(t)) ?? (/^(8|11|18)(?:\D|$)/.test(record(t)) ? 'an' : 'a'); }
function oddsDescription(probability) {
  if (!Number.isFinite(probability)) return '';
  const displayed = Number(number(probability * 100, 1));
  if (displayed > 50 && displayed <= 55) return 'Slight edge';
  if (displayed < 50 && displayed >= 45) return 'Slight underdog';
  return '';
}
function rank(r) { return r ? `#${r}` : 'Unranked'; }
function usesSor(t = state.snapshot?.rankings?.[0]) { return Boolean(t && Object.hasOwn(t, 'displayRank') && Number.isFinite(t.sor)); }
function nationalRank(t) { return Object.hasOwn(t, 'displayRank') ? t.displayRank : t.rank; }
function achievementScore(t) { return usesSor(t) ? t.sor : t.achievement; }
function achievementName(t) { return t?.division === 'fcs' || usesSor(t) ? 'Strength of Record' : 'Colley achievement'; }
function shareTeamData(team) {
  const ranked = rankedTeam(team.id);
  return ranked ? { id: ranked.id, name: ranked.name, rank: nationalRank(ranked), rankLabel: achievementName(ranked),
    record: record(ranked), division: ranked.division } : { id: team.id, name: team.name, division: team.division };
}
function shareTeamButton(team) {
  return shareCardButton({ teams: [shareTeamData(team)], asOf: state.snapshot.asOf,
    href: routeHref(`team/${encodeURIComponent(team.id)}`) });
}
function performancePublished() { return state.snapshot?.performanceEndpoint === publicationPath('performance'); }
function hasPerformance() { return Boolean(state.performance && state.performance.status === 'experimental' && state.performance.season === state.snapshot?.season && state.performance.asOf === state.snapshot.asOf && state.performance.baseSnapshotHash && state.performance.baseSnapshotHash === state.snapshot.snapshotHash); }
function performanceRow(t) {
  return hasPerformance() ? (t.division === 'fcs' ? state.fcsPerformanceById : state.performanceById)?.get(t.id) : null;
}
function performanceScore(value) { return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number(value, 2)} pp` : '—'; }
function performanceIndex(rows, teams) {
  if (!Array.isArray(rows) || rows.length !== teams.size) return null;
  const index = new Map();
  for (const row of rows) {
    if (!row || !teams.has(row.id) || index.has(row.id) ||
        !(row.rank === null || (Number.isInteger(row.rank) && row.rank > 0)) ||
        !(row.score === null || Number.isFinite(row.score))) return null;
    index.set(row.id, row);
  }
  return index;
}
function acceptPerformance(snapshot) {
  if (!snapshot || snapshot.status !== 'experimental' || snapshot.season !== state.snapshot?.season ||
      snapshot.asOf !== state.snapshot.asOf ||
      !snapshot.baseSnapshotHash || snapshot.baseSnapshotHash !== state.snapshot.snapshotHash) return false;
  const byId = performanceIndex(snapshot.rankings, state.byId);
  if (!byId) return false;
  state.performance = snapshot; state.performanceById = byId;
  state.fcsPerformanceById = performanceIndex(snapshot.fcsRankings, state.byFcsId);
  return true;
}
async function loadPerformance() {
  if (!performancePublished() || performanceLoading || hasPerformance()) return;
  const snapshot = state.snapshot;
  performanceLoading = true;
  performanceFailed = false;
  let data;
  try {
    const response = await fetch(snapshot.performanceEndpoint, { headers: { Accept: 'application/json' } });
    if (response.ok) data = await response.json();
  } catch {
    // An optional companion view can be retried from its own panel.
  }
  if (state.snapshot !== snapshot) return;
  performanceLoading = false;
  performanceFailed = !acceptPerformance(data);
  const [page, id] = route();
  if (page === 'rankings' && rankingsRoute().model === 'performance') render();
  if (page === 'team') updateTeamPerformance(id);
}
function conferenceRank(t) {
  if (Object.hasOwn(t, 'displayConferenceRank')) return t.displayConferenceRank;
  return t.conferenceRank;
}
function rankedTeam(id) { return state.byId.get(id) ?? state.byFcsId.get(id); }
function opponentRank(g) { const t = rankedTeam(g.opponentId); return t ? nationalRank(t) : null; }
function probability(n) { return footballFormat ? footballFormat.formatProbability(n) : Number.isFinite(n) ? n > 0 && n < 0.0001 ? '<0.01%' : `${number(n * 100, 2)}%` : '—'; }
function logo(t, size = '', { dark = false } = {}) {
  const initials = t.name.split(/\s+/).slice(0, 2).map(x => x[0]).join('');
  const id = encodeURIComponent(t.id);
  const directory = 'https://a.espncdn.com/i/teamlogos/ncaa';
  const fallback = dark ? ` data-logo-fallback="${directory}/500/${id}.png"` : '';
  return `<span class="logo ${size}" aria-hidden="true"><img src="${directory}/${dark ? '500-dark' : '500'}/${id}.png"${fallback} alt="" loading="lazy" decoding="async"><span>${esc(initials)}</span></span>`;
}
function snapshotDate(options = {}) {
  const value = state.snapshot.asOf || state.snapshot.source?.fetchedAt || state.snapshot.before;
  return new Intl.DateTimeFormat('en-US', { timeZone:'America/Denver', month:'short', day:'numeric', ...options }).format(new Date(value));
}
function route() {
  let remembered;
  if (isAccountCallbackUrl(location.href)) {
    try { remembered = window.sessionStorage.getItem(accountReturnKey); } catch {}
  }
  return (pendingAccountRoute(location.href, remembered) ?? routeFromUrl(location.href) ?? 'not-found').split('/');
}
function navigate(routeToken, options) { return navigateApp(routeToken, options, window); }
function isRankingsHub(page) { return ['rankings', 'polls', 'forge-top-25', 'conference-strength'].includes(page); }
function rankingsRoute() {
  const [, first, second, third] = route();
  const division = first === 'fcs' ? 'fcs' : 'fbs';
  const explicit = first === 'fbs' || first === 'fcs';
  const view = explicit ? second : first;
  const model = view === 'strength' || view === 'predictive' ? 'strength'
    : view === 'performance' ? 'performance' : 'achievement';
  return { division, model, all: view === 'all' || (explicit ? third : second) === 'all' };
}
function rankingRouteToken(model = 'achievement', all = false, division = 'fbs') {
  if (division === 'fcs') return `rankings/fcs/${{ achievement: 'sor', strength: 'predictive', performance: 'performance' }[model]}${all ? '/all' : ''}`;
  const view = model === 'achievement' ? '' : `/${model}`;
  return `rankings${view}${all ? '/all' : ''}`;
}
function rankingHref(...options) { return routeHref(rankingRouteToken(...options)); }
function divisionTeams(division) {
  return division === 'fcs' ? state.snapshot.fcsRankings ?? [] : state.snapshot.rankings;
}
function ordered(model = state.model, division = state.division) {
  const teams = divisionTeams(division);
  if (model === 'achievement') return teams;
  if (model === 'performance') {
    const index = division === 'fcs' ? state.fcsPerformanceById : state.performanceById;
    if (!hasPerformance() || !index) return [];
    return [...teams].sort((a,b) => (index.get(a.id).rank ?? Infinity) - (index.get(b.id).rank ?? Infinity) || a.id.localeCompare(b.id));
  }
  return [...teams].sort((a, b) => {
    const rankOrder = (a.strengthRank ?? Infinity) - (b.strengthRank ?? Infinity);
    return rankOrder || b.strength - a.strength || a.id.localeCompare(b.id);
  });
}
function topTwentyFive(teams, model) {
  if (model === 'strength') return teams[0]?.division === 'fcs'
    ? teams.filter(t => strengthRank(t) > 0 && strengthRank(t) <= 25) : teams.slice(0, 25);
  return teams.filter(t => {
    const position = model === 'performance' ? performanceRow(t)?.rank : nationalRank(t);
    return position > 0 && position <= 25;
  });
}
function strengthRank(t) { return Object.hasOwn(t, 'strengthRank') ? t.strengthRank : ordered('strength', t.division).findIndex(x => x.id === t.id) + 1; }
function sosRank(t) { return Object.hasOwn(t, 'sosRank') ? t.sosRank : [...divisionTeams(t.division)].sort((a,b) => (b.achievementScheduleStrength ?? -1) - (a.achievementScheduleStrength ?? -1)).findIndex(x => x.id === t.id) + 1; }
function teamLink(t) { return `<a href="${routeHref(`team/${encodeURIComponent(t.id)}`)}">${esc(t.name)}</a>`; }
function brand() { return `<a class="brand" href="/" aria-label="${BRAND} home"><img class="brand-logo" src="/assets/the-games-decide-logo.webp" width="780" height="260" alt="${BRAND}" fetchpriority="high"></a>`; }
function renderHeader() {
  const page = route()[0];
  if (renderedHeader?.snapshot === state.snapshot && renderedHeader.page === page) return;
  renderedHeader = { snapshot: state.snapshot, page };
  const navs = [['home','home','Home'],['rankings','trophy','Rankings'],['scoreboard','clock','Scoreboard'],['ranking-history','chart','Weekly movement'],['teams','teams','Teams'],['my-teams','teams','My Teams'],['compare','compare','Matchup lab'],['sor-compare','network','Compare SOR'],['model-report','chart','Model Report Card'],['beat-the-model','trophy','Beat the Model'],['bracket','network','Playoff bracket'],['cfp-scenarios','network','CFP scenarios'],['methodology','layers','Methodology']];
  const primaryPages = ['home', 'rankings', 'beat-the-model'];
  const desktopPages = ['scoreboard', 'teams', 'compare'];
  const activePage = page === 'team' ? 'teams' : isRankingsHub(page) ? 'rankings' : page;
  const link = ([id, glyph, label], placement = '') => `<a href="${routeHref(`${id}`)}" class="${placement}${activePage === id ? ' active' : ''}" ${page === id || (isRankingsHub(page) && id === 'rankings') ? 'aria-current="page"' : ''}>${icon(glyph)}${label}</a>`;
  const mainLinks = navs.filter(([id]) => primaryPages.includes(id) || desktopPages.includes(id));
  const moreLinks = navs.filter(([id]) => !primaryPages.includes(id));
  const moreActive = moreLinks.some(([id]) => id === activePage) ? (desktopPages.includes(activePage) ? ' active-on-mobile' : ' active') : '';
  const snapshotBadges = state.snapshot ? `<div class="engine-badge">${icon('check')}<div><strong>Published rankings</strong><small>CFBD snapshot · ${snapshotDate()}</small></div></div><div class="season-badge">${state.snapshot.season}<small>SEASON SNAPSHOT</small></div>` : '';
  const header = document.querySelector('#header');
  const account = header.querySelector?.('[data-header-account]');
  header.innerHTML = `<div class="masthead"><div class="wrap masthead-inner">${brand()}<span class="brand-divider"></span><div class="masthead-tag">THE INDEPENDENT COLLEGE FOOTBALL RANKING ENGINE<strong>DATA &nbsp; › &nbsp; OPPONENTS &nbsp; › &nbsp; EVIDENCE</strong></div><div class="header-right">${snapshotBadges}<div class="header-account" data-header-account><button class="header-account-button" type="button" disabled>${icon('teams')}<span>Sign in</span></button></div></div></div></div>
    <nav class="nav" aria-label="Main navigation"><div class="wrap nav-inner">
      ${mainLinks.map(item => link(item, primaryPages.includes(item[0]) ? 'nav-primary' : 'nav-desktop-link')).join('')}
      <details class="nav-more${moreActive}">
        <summary>More ${icon('chevron')}</summary>
        <div class="nav-more-links">${moreLinks.map(item => link(item, desktopPages.includes(item[0]) ? 'nav-more-mobile-link' : '')).join('')}</div>
      </details>
    </div></nav>`;
  const slot = header.querySelector?.('[data-header-account]');
  if (account && slot?.isConnected) slot.replaceWith(account);
  else if (slot?.isConnected) void import('./bracket-auth.js?v=clean-routes').then(({ mountHeaderAccount }) => {
    mountHeaderAccount(slot, { icon: icon('teams'), previewClient: localPreview?.contest?.client,
      rememberPage() {
        try { window.sessionStorage.setItem(accountReturnKey, safeAccountReturnPath(location.pathname + location.search)); } catch {}
      },
    });
  }).catch(() => { slot.innerHTML = '<span class="header-account-message" role="status">Sign-in is unavailable.</span>'; });
  document.querySelector('#footer').innerHTML = `<div class="footer"><div class="wrap footer-inner"><div><div class="footer-brand">${BRAND.toUpperCase()}</div><p>Independent FBS and FCS rankings calculated from game data.</p></div><div class="footer-links"><a href="/methodology/">${icon('layers')}Model methodology</a><a href="/about/">About</a><a href="/privacy/">Privacy and accounts</a><a href="/terms/">Terms of use</a><a href="/support">Support and data discrepancies</a><a href="/account">Account settings</a><a href="${esc(publicationPath('rankings'))}" target="_blank" rel="noopener">${icon('database')}Published data</a>${state.snapshot ? `<span>Ranking engine · v${esc(state.snapshot.modelVersion)}</span>` : ''}</div></div></div>`;
}
function schedulePanel() { return `<section class="panel schedule-card"><div class="panel-head"><div class="panel-head-title">${icon('calendar')}<h2>Results updates</h2></div></div><div class="panel-body"><div class="section-label">Mountain Time</div><div class="schedule-title">DAILY</div><p>FBS and FCS results are checked at <strong>3:45 a.m.</strong> daily, with an <strong>8:11 p.m.</strong> Sunday backup for Sunday games.</p><p style="margin-top:12px">Last publication <strong>${snapshotDate({ hour:'numeric', minute:'2-digit' })} MT</strong></p></div></section>`; }
function coveragePanel() { return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('shield')}<h2>Behind the rankings</h2></div><span class="tag green">CFBD</span></div><div class="panel-body"><p>${usesSor()?'A team climbs when its record is harder to match against the same opponents at the same venues.':'The Colley model links results across the opponent network.'}</p><div class="fact-list"><div class="fact-row"><span>FBS teams in this snapshot</span><strong>${state.snapshot.fbsTeams}</strong></div><div class="fact-row"><span>Game records modeled</span><strong>${state.snapshot.gamesUsed.toLocaleString()}</strong></div><div class="fact-row"><span>Human poll inputs</span><strong>Zero</strong></div></div></div><a class="method-link" href="/methodology/">See how we calculate each rank ${icon('arrow')}</a></section>`; }
function movementWeek(type, week) {
  return type === 'postseason' ? `Postseason Week ${week}` : `Week ${week}`;
}
function movementComparison() {
  const value = state.snapshot?.rankingMovement;
  if (!value) return '';
  return `${movementWeek(value.seasonType, value.week)} vs ${movementWeek(value.previousSeasonType, value.previousWeek)}${value.complete ? '' : ' · Provisional'}`;
}
function movementIndicator(team, descriptive = false) {
  if (team.division !== 'fbs') return '';
  const entry = state.snapshot?.rankingMovement?.teams?.[team.id];
  if (!Number.isInteger(entry?.movement)) return '';
  const delta = entry.movement;
  const direction = delta === 0 ? 'even' : delta > 0 ? 'up' : 'down';
  const label = delta === 0 ? 'No change' : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)}`;
  const glyph = delta === 0 ? '↔' : delta > 0 ? '↑' : '↓';
  const title = `${label} · ${movementComparison()}`;
  const display = descriptive ? `${glyph} ${label}` : `${glyph}${delta ? Math.abs(delta) : ''}`;
  return `<span class="rank-movement ${direction}" title="${esc(title)}"><span aria-hidden="true">${display}</span><span class="sr-only">${esc(label)}</span></span>`;
}
function movementNote() {
  const comparison = movementComparison();
  return comparison ? `<p class="rank-movement-note">${esc(comparison)}</p>` : '';
}
function tableRows(teams, model = state.model, compact = false) {
  return teams.map(t => {
    const position = model === 'achievement' ? nationalRank(t) : strengthRank(t);
    const sos = sosRank(t);
    const score = position ? number(model === 'achievement' ? achievementScore(t) : t.strength, model === 'achievement' ? 4 : 1) : '—';
    return `<tr><td><span class="rank-with-movement"><span class="table-rank ${(position || Infinity) <= 3 ? 'top' : ''}">${position ?? '—'}</span>${model === 'achievement' && position ? movementIndicator(t) : ''}</span></td><td><div class="team-cell">${logo(t)}<div>${teamLink(t)}${compact?'':`<small>${esc(t.conference)}</small>`}</div></div></td><td class="num">${record(t)}</td><td class="hide-mobile">${sos ? rank(sos) : '—'}</td><td class="rating num">${score}</td><td class="hide-mobile"><a class="text-link" href="${routeHref(`team/${encodeURIComponent(t.id)}`)}" aria-label="Explore ${esc(t.name)}">${icon('arrow')}</a></td></tr>`;
  }).join('');
}
function rankingTable(teams, model = state.model, compact = false) {
  if (model === 'performance') return performanceTable(teams);
  const isSor = model === 'achievement' && achievementName(teams[0]) === 'Strength of Record';
  return `<div class="table-scroll"><table><caption class="sr-only">${model==='achievement'?achievementName(teams[0]):'Predictive strength'} rankings</caption><thead><tr><th scope="col">${isSor ? 'SOR rank' : 'Rank'}</th><th scope="col">Team</th><th scope="col">Record</th><th scope="col" class="hide-mobile" title="Rank of opponents’ average Colley ratings">SOS · Colley</th><th scope="col">${model==='achievement'?(isSor?'SOR score':'Colley rating'):'Strength · pts'}</th><th class="hide-mobile"><span class="sr-only">Details</span></th></tr></thead><tbody>${tableRows(teams, model, compact)}</tbody></table></div>`;
}
function performanceTable(teams) {
  return `<div class="table-scroll"><table class="performance-table"><caption class="sr-only">Experimental Performance · Scrimmage consistency rankings</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col" title="Opponent-adjusted net success rate relative to the measured ${state.division.toUpperCase()} average, in percentage points">Performance · pp</th><th scope="col" class="hide-mobile">Offense success</th><th scope="col" class="hide-mobile">Defense allowed</th><th scope="col">Games measured</th><th class="hide-mobile"><span class="sr-only">Details</span></th></tr></thead><tbody>${teams.map(t => {
    const p = performanceRow(t);
    return `<tr><td><span class="table-rank ${(p.rank||999)<=3?'top':''}">${p.rank??'—'}</span></td><td><div class="team-cell">${logo(t)}<div>${teamLink(t)}<small>${esc(t.conference)}</small></div></div></td><td class="rating num">${performanceScore(p.score)}</td><td class="num hide-mobile">${probability(p.offensiveSuccessRate)}</td><td class="num hide-mobile">${probability(p.defensiveSuccessRateAllowed)}</td><td class="num performance-coverage">${esc(p.measuredGames)} / ${esc(p.expectedGames)}${p.provisional?' · provisional':''}</td><td class="hide-mobile"><a class="text-link" href="${routeHref(`team/${encodeURIComponent(t.id)}`)}" aria-label="Explore ${esc(t.name)} Performance evidence">${icon('arrow')}</a></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function performanceNotice(division = 'fbs') {
  if (!hasPerformance()) return '';
  const coverage = state.performance.coverage || {};
  const d = division === 'fcs' ? 'Fcs' : 'Fbs';
  return `<div class="notice"><strong>Experimental scrimmage consistency</strong><p>This view measures how consistently teams gained the needed yards and prevented opponents from doing so, adjusted for opponents and location. Scores are in percentage points relative to the measured ${division.toUpperCase()} average.</p><p><strong>Coverage:</strong> ${esc(coverage[`measured${d}Games`]??'—')} / ${esc(coverage[`eligible${d}Games`]??'—')} games involving ${division.toUpperCase()} teams · ${esc(coverage[`measured${d}Teams`]??'—')} / ${esc(coverage[`source${d}Teams`]??'—')} teams · same completed-game cutoff as SOR.</p><p>Historical FBS–FCS forecasting checks remain under review. The model measures covered scrimmage plays.</p><p class="compact-note">Game cutoff: ${snapshotDate({hour:'numeric',minute:'2-digit'})} MT · ${esc(state.performance.method?.name || 'Scrimmage consistency')}</p><details><summary>Technical version</summary><p class="compact-note">${esc(state.performance.method?.id || 'Experimental version')}</p></details>${Array.isArray(state.performance.limitations)&&state.performance.limitations.length?`<details><summary>Model limitations</summary><ul>${state.performance.limitations.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`:''}</div>`;
}
function performanceBreakdown(p, fcs) {
  const x = p.explanation || {};
  const terms = [['Measured net play success', x.observedNetContribution], ['Game-location adjustment', x.venueContribution],
    ['FBS/FCS matchup adjustment', x.divisionAdjustmentContribution], ['Opponent network', x.opponentContribution],
    ['Population reference', x.divisionOffset], fcs ? ['FCS-average reference', x.fcsReferenceAdjustment] : ['FBS-average reference', x.fbsReferenceAdjustment]];
  if (!terms.every(([, value]) => Number.isFinite(value))) return '';
  return `<details><summary>Inspect score contributions</summary><div class="fact-list" style="margin-top:12px">${terms.map(([label, value]) => `<div class="fact-row"><span>${label}</span><strong>${performanceScore(100*value)}</strong></div>`).join('')}<div class="fact-row"><span>Performance score</span><strong>${performanceScore(p.score)}</strong></div></div><p class="compact-note">Contributions use percentage-point units and are rounded for display. Opponent and context adjustments come from the model’s results network.</p></details>`;
}
function performanceStatus() {
  if (performanceLoading) return '<p role="status">Loading Performance…</p>';
  return `${performanceFailed ? '<p role="status">Performance is temporarily unavailable.</p>' : ''}<button type="button" class="button light small" data-action="load-performance">${performanceFailed ? 'Try again' : 'Show Performance details'}</button>`;
}
function performanceTeamPanel(t) {
  if (!performancePublished()) return '';
  const fcs = t.division === 'fcs';
  const p = performanceRow(t);
  const evidence = p ? `<div class="section-label">Scrimmage consistency</div><div class="model-rank-label"><strong>${rank(p.rank)}</strong><strong>${performanceScore(p.score)}</strong></div><p class="compact-note">Opponent-adjusted net success rate relative to the measured ${fcs ? 'FCS' : 'FBS'} average.</p><div class="fact-list"><div class="fact-row"><span>Offense success rate</span><strong>${probability(p.offensiveSuccessRate)}</strong></div><div class="fact-row"><span>Opponent success allowed</span><strong>${probability(p.defensiveSuccessRateAllowed)}</strong></div><div class="fact-row"><span>Games measured</span><strong>${esc(p.measuredGames)} / ${esc(p.expectedGames)}</strong></div></div><p class="compact-note">${p.measuredGames ? `${esc(t.name)} succeeded on ${probability(p.offensiveSuccessRate)} of measured offensive plays; opponents succeeded on ${probability(p.defensiveSuccessRateAllowed)}. The score also accounts for the opponents faced and game location.` : 'There are no measured games for this team.'}${p.provisional && p.measuredGames ? fcs ? ' Coverage is provisional.' : ' Fewer than four measured games: provisional.' : ''}</p>${performanceBreakdown(p, fcs)}<p class="compact-note">Historical FBS–FCS forecasting checks remain under review.</p>`
    : fcs && hasPerformance() ? '<p>FCS Performance is unavailable for this snapshot.</p>' : performanceStatus();
  return `<section class="panel" id="team-performance"><div class="panel-head"><div class="panel-head-title">${icon('chart')}<h2>Performance</h2></div><span class="tag">EXPERIMENTAL</span></div><div class="panel-body">${evidence}</div><a class="method-link" href="${rankingHref('performance', false, t.division)}">Explore Performance rankings ${icon('arrow')}</a></section>`;
}
function updateTeamPerformance(id) {
  const panel = main.querySelector('#team-performance');
  const team = rankedTeam(id);
  if (panel && team) panel.outerHTML = performanceTeamPanel(team);
}
function performanceMethodology() {
  if (!performancePublished()) return '';
  return `<section class="panel method-block"><div class="section-label">03 · Experimental Performance</div><h2>HOW CONSISTENTLY DID THE TEAM PLAY?</h2><p>This separate view measures scrimmage consistency on CollegeFootballData’s covered plays. A play succeeds when it gains at least 50% of needed yards on first down, 70% on second down, and 100% on third or fourth down, following the source’s scoring-play rules.</p><div class="formula-display">Game net success rate = own offense success rate − opponent offense success rate</div><p>Each measured game receives one weight. Individual opponents, venue and FBS/FCS context inform an opponent-adjusted model. Scores are measured in percentage points relative to the measured average for each subdivision. Raw offense and defense rates are diagnostics rather than separate adjusted unit grades.</p><p>Human polls, betting lines, recruiting, conference reputation and previous team-season ratings do not enter this Performance calculation. It is separate from earned SOR and the matchup lab.</p><p>These source-covered plays do not represent every box-score play. This is not a complete special-teams, turnover, field-position or overtime-adjusted grade. Historical FBS–FCS forecasting checks remain under review; experimental display does not convert a failed check into a pass.</p></section>`;
}
function pipeline() { return `<section class="pipeline" aria-label="How the engine works"><div class="pipeline-title"><h2>HOW IT<br>COMES TOGETHER.</h2><p>TRANSPARENT BY DESIGN</p></div>${[['Acquire the data','Completed games and season-specific FBS membership.'],['Validate the results','Incomplete scores stay out. Every source is recorded.'],['Solve the network','Every opponent’s results connect to the bigger picture.'],['Explain the rank','A reproducible score, with evidence you can inspect.']].map(([title,desc],i)=>`<div class="pipeline-step"><span class="step-num">0${i+1}</span><div><h3>${title}</h3><p>${desc}</p></div></div>`).join('')}</section>`; }
function companionPanel() {
  const views = [[rankingHref('strength'), 'Predictive Strength', 'Estimates team strength from score margins, opponents, venue, and our own historical ratings.']];
  if (performancePublished()) views.push([rankingHref('performance'), 'Performance · Experimental', 'Measures how consistently teams succeeded on covered scrimmage plays, adjusted for opponents and venue.']);
  views.push(['/ranking-history/', 'What changed this week?', 'See SOR movers, Top 25 arrivals and departures, and saved weekly editions.'],
    ['/beat-the-model/', 'Beat the Model', 'Save your game picks before kickoff and compare your results with our predictions.'],
    ['/polls/ap/', 'Compare Rankings', 'Compare our rankings with dated AP, Coaches, and CFP editions.'],
    ['/forge-rankings/', 'Forge’s Top 25', 'An AI-authored editorial ballot grounded in game results.']);
  return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('layers')}<h2>Companion views</h2></div></div><div class="panel-body companion-views">${views.map(([url,label,description])=>`<div><a class="text-link" href="${url}">${label} ${icon('arrow')}</a><p>${description}</p></div>`).join('')}<p class="compact-note">These views run separately from the national ranking.</p></div></section>`;
}
function favoriteNext(team) {
  const detail = teamDetails.get(team.id);
  if (!state.snapshot.teamDetailsPath || detail?.failed) return '<p>Next matchup unavailable.</p>';
  if (!detail?.team) return '<p>Loading the next matchup…</p>';
  if (!Array.isArray(detail.team.upcomingGames)) return '<p>Next matchup unavailable.</p>';
  const next = upcomingTeamGames(detail.team.upcomingGames)[0];
  if (!next) return '<p>No upcoming matchup listed.</p>';
  const where = next.venue === 'away' ? 'at' : 'vs.';
  const opponent = rankedTeam(next.opponentId);
  const odds = next.winProbability;
  const forecast = Number.isFinite(odds) && odds >= 0 && odds <= 1 ? `<div class="my-team-forecast">
    <strong>${number(odds * 100, 1)}%</strong><span>${next.probabilitySource === 'saved' ? 'Saved win chance' : 'Win chance estimate'}</span>
    ${next.calibrated === false ? '<span>Experimental</span>' : ''}</div>` : '';
  const href = teamFixtureHref(team, next);
  return `<a class="my-team-next-link" href="${href}">
    <div class="my-team-matchup">${opponent ? `<div class="my-team-opponent-emblem">${logo(opponent, 'small')}</div>` : ''}
    <div><strong>${where} ${esc(next.opponentName)}</strong>
    <p>${teamKickoff(next, true)}${next.venue === 'neutral' ? ' · Neutral site' : ''}</p></div></div>${forecast}
    <span class="my-team-next-arrow" aria-hidden="true">${icon('chevron')}</span><span class="sr-only">See matchup details</span></a>
    ${next.startTimeTbd === false ? `<div class="my-team-next-calendar">${teamFixtureCalendar(next, href)}</div>` : ''}`;
}
function favoriteCard(team) {
  if (!teamDetails.has(team.id) && state.snapshot.teamDetailsPath) void loadTeamDetails(team);
  const movement = movementIndicator(team, true);
  const position = nationalRank(team);
  return `<div class="my-team-summary">
    <div class="my-team-watermark">${logo(team, 'large')}</div>
    <div class="my-team-identity"><div class="my-team-emblem">${logo(team, '', { dark: team.id !== '252' })}</div><div>
    <strong class="my-team-name">${teamLink(team)}</strong><p>${esc(team.conference)}</p></div></div>
    <dl class="my-team-stats">
    <div><dt>Record</dt><dd>${record(team)}</dd></div>
    <div><dt>${usesSor(team) ? 'SOR rank' : 'Colley rank'}</dt><dd class="${position ? '' : 'my-team-unranked'}">${rank(position)}</dd>
    ${movement ? `<dd class="my-team-rank-change">${movement}</dd>` : ''}</div>
    </dl>
    ${movement ? `<p class="my-team-movement">${esc(movementComparison())}</p>` : ''}
    <div class="my-team-next"><h3>Next game</h3><div class="my-team-next-content" data-my-team-schedule="${esc(team.id)}">${favoriteNext(team)}</div></div>
  </div><div class="my-team-player-links" aria-label="My Team shortcuts"><a href="${routeHref(`team/${encodeURIComponent(team.id)}/players`)}">Players</a>
  <a href="${routeHref(`team/${encodeURIComponent(team.id)}/availability`)}">Availability</a>${shareTeamButton(team)}</div><div data-rooting-guide></div>`;
}
async function loadFavoriteUpdateFacts(team) {
  const snapshot = state.snapshot;
  const detail = teamDetails.get(team.id)?.request ?? (snapshot.teamDetailsPath ? loadTeamDetails(team) : null);
  teamPlayersModule ??= import('./team-players.js?v=1').catch(error => { teamPlayersModule = null; throw error; });
  const availability = teamPlayersModule.then(({ fetchPlayerData }) => fetchPlayerData('team-availability', team,
    snapshot.season, playerPublicationPath('team-availability', team))).catch(() => null);
  const [, report] = await Promise.all([detail, availability]);
  return { rank: nationalRank(team) ?? null, method: usesSor(team) ? 'SOR rank' : 'Colley rank', asOf: snapshot.asOf,
    contributions: teamDetails.get(team.id)?.team?.contributions, availability: report };
}
function mountFavoriteGuide(root, team) {
  const target = root.querySelector('[data-rooting-guide]');
  if (!target) return;
  let cleanup;
  rootingGuideModule ??= import('./rooting-guide.js?v=1').catch(error => { rootingGuideModule = null; throw error; });
  rootingGuideModule.then(({ mountRootingGuide }) => {
    if (!target.isConnected) return;
    cleanup = mountRootingGuide(target, { team, snapshot: state.snapshot, inputUrl: publicationPath('cfp-scenarios'),
      gameHref: weeklyGameHref, now: localPreview?.now });
  }).catch(() => {
    if (target.isConnected) target.textContent = 'The rooting guide is temporarily unavailable.';
  });
  return () => cleanup?.();
}
function mountHomeFavorite() {
  const target = main.querySelector('[data-my-team]');
  if (!target?.isConnected) return;
  favoriteModule ??= import('./my-team.js?v=platform-review');
  favoriteModule.then(({ mountMyTeam }) => {
    if (!target.isConnected || route()[0] !== 'home') return;
    closeFavorite = mountMyTeam(target, {
      teams: new Map([...state.byId, ...state.byFcsId]),
      adapter: localPreview?.myTeam,
      renderTeam: favoriteCard,
      season: state.snapshot.season,
      loadUpdateFacts: loadFavoriteUpdateFacts,
      mountExtras: mountFavoriteGuide,
    });
  }).catch(() => {
    favoriteModule = null;
    if (target.isConnected) target.textContent = 'My Team is temporarily unavailable.';
  });
}
function thisWeekPanel() {
  const movement = state.snapshot.rankingMovement;
  const mover = movement?.risers?.[0] ?? movement?.fallers?.[0];
  const { closeGame, predictionRecord } = state.snapshot.weekHighlights ?? {};
  const links = [];
  if (mover) links.push([routeHref(`ranking-history/${movement.week}`), 'Ranking movement',
    `${mover.team} ${mover.movement > 0 ? 'rose' : 'fell'} ${Math.abs(mover.movement)} to #${mover.rank}`,
    movementComparison()]);
  if (closeGame && Date.parse(closeGame.startDate) > (localPreview?.now ?? Date.now())) {
    const p = closeGame.homeWinProbability;
    const favorite = p > .5 ? closeGame.home : closeGame.away;
    links.push([routeHref(`compare/weekly/${closeGame.seasonType}:${closeGame.week}`), 'Close matchup',
      `${closeGame.away} at ${closeGame.home}`, p === .5 ? '50.0% each' : `${favorite} ${number(Math.max(p, 1 - p) * 100, 1)}%`]);
  }
  if (predictionRecord) links.push([routeHref(`compare/weekly/${predictionRecord.seasonType}:${predictionRecord.week}`), 'Model picks',
    `${predictionRecord.correct} of ${predictionRecord.graded} right`, `${movementWeek(predictionRecord.seasonType, predictionRecord.week)} · Saved picks`]);
  return links.length ? `<section class="panel home-week"><div class="panel-head"><h2>This Week</h2></div>
    <div class="home-week-links">${links.map(([url, label, result, note]) => `<a href="${esc(url)}"><span>${label}</span>
    <strong>${esc(result)}</strong><small>${esc(note)}</small></a>`).join('')}</div></section>` : '';
}
function renderHome() {
  closeFavorite?.();
  closeFavorite = null;
  const top = topTwentyFive(state.snapshot.rankings, 'achievement');
  const title = usesSor() ? 'The Games Decide Top 25' : 'HISTORICAL TOP 25';
  const summary = usesSor() ? 'Our Strength of Record rankings weigh each team’s wins against the opponents it faced and where it played.' : 'This historical snapshot ranks teams by their results and the opponents they faced.';
  main.innerHTML = `<div class="wrap home-favorite" data-my-team></div><section class="hero home-hero"><div class="wrap hero-layout"><div><div class="eyebrow">${state.snapshot.season} FBS season · ${achievementName()}</div><h1>The Games Decide <em>Top 25</em></h1><p class="hero-copy">${summary} Select a team to see how it earned its rank.</p><div class="hero-actions"><a class="button" href="${rankingHref('achievement', true)}">${icon('chart')}View all ${state.snapshot.fbsTeams} teams ${icon('chevron')}</a><a class="button outline" href="/methodology/">${icon('layers')}Inside the engine</a></div></div><aside class="top-five"><div class="top-five-title">${icon('trophy')}<h2>${usesSor() ? "SOR TOP FIVE" : "TOP FIVE"}</h2><small>${snapshotDate()} SNAPSHOT</small></div>${top.slice(0,5).map(t=>`<a class="top-five-row" href="${routeHref(`team/${t.id}`)}"><span class="rank-chip">${nationalRank(t)}</span>${logo(t)}<strong>${esc(t.name)}</strong><span>${record(t)}</span></a>`).join('')}<a class="top-five-footer" href="/rankings">Explore the Top 25 ${icon('chevron')}</a></aside></div></section><div class="wrap home-body">${thisWeekPanel()}<div class="two-column"><section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('trophy')}<div><h2>${title}</h2><p>${achievementName()} rankings · ${state.snapshot.season} season · ${snapshotDate()} publication</p>${movementNote()}</div></div></div>${top.length?rankingTable(top,'achievement',true):'<div class="empty">No ranked teams in this snapshot.</div>'}</section><aside class="stack">${coveragePanel()}${companionPanel()}${schedulePanel()}</aside></div>${pipeline()}</div>`;
  mountHomeFavorite();
}
function banner(kicker, title, description) { return `<section class="hero page-banner"><div class="wrap"><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div></section>`; }
function filterControls(showModel = false, division = 'fbs') {
  const teams = divisionTeams(division);
  const conferences = [...new Set(teams.map(t=>t.conference))].sort();
  return `<div class="toolbar"><div class="toolbar-group"><label class="search-box">${icon('search')}<span class="sr-only">Search all ${division.toUpperCase()} teams</span><input id="team-search" type="search" placeholder="Search all teams…" value="${esc(state.search)}" autocomplete="off"></label><label><span class="sr-only">Conference</span><select id="conference-filter" aria-label="Conference"><option value="">All conferences</option>${conferences.map(c=>`<option ${state.conference===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div>${showModel?`<button class="button light small" data-action="toggle-all">${state.all?'Show Top 25':`Show all ${teams.length} teams`}</button>`:''}</div>`;
}
function rankingViews() {
  const views = [['achievement', state.division === 'fcs' || usesSor() ? 'Strength of Record (SOR)' : achievementName()],
    ['strength', 'Predictive Strength'], ['performance', 'Performance · Experimental']];
  return `<div class="segmented ranking-views" role="group" aria-label="Ranking views">${views.map(([model,label])=>`<button data-action="model" data-value="${model}" class="${state.model===model?'active':''}" aria-pressed="${state.model===model}">${label}</button>`).join('')}</div>`;
}
function filtered(teams) { return teams.filter(t => (!state.conference || t.conference===state.conference) && (!state.search || t.name.toLowerCase().includes(state.search.toLowerCase()))); }
function rankingsContent() {
  const list = ordered();
  const isFiltered = Boolean(state.search || state.conference);
  const pool = state.all || isFiltered ? list : topTwentyFive(list, state.model);
  const teams = filtered(pool);
  const tier = state.division.toUpperCase();
  const title = isFiltered ? 'Matching teams' : state.all ? `All ${tier} teams` : 'Top 25';
  const note = state.model === 'performance' ? `Identical Performance scores share a rank. pp means percentage points relative to the measured ${tier} average.`
    : `SOS ranks opponents’ average Colley ratings. ${state.model === 'strength' ? 'Strength estimates point margins on a neutral field.' : usesSor() ? 'Identical SOR scores share a rank.' : 'Identical Colley scores share a rank.'}`;
  return `<div class="panel-head"><div class="panel-head-title"><h3>${title}</h3></div><span class="tag">${teams.length} shown</span></div>${state.model === 'achievement' && state.division === 'fbs' && movementComparison() ? `<div class="results-movement-context">${movementNote()}</div>` : ''}${teams.length?rankingTable(teams):`<div class="empty">${isFiltered?'No teams match these filters.':'No ranked teams in this snapshot.'}</div>`}<div class="panel-body" style="padding-block:12px"><p class="compact-note">${note}</p></div>`;
}
function rankingsHubNav(active) {
  return `<nav class="rankings-hub-nav" aria-label="Rankings pages">${rankingsHubTabs
    .map(([id, href, label]) => `<a href="${href}" data-ranking-section="${id}"${active === id ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}
function renderRankingsHub(active, key, markup, mount) {
  const panel = main.querySelector('#rankings-hub-content');
  const previous = rankingsHubView;
  if (!panel?.animate || previous?.panel !== panel) {
    previous?.animation?.cancel();
    previous?.unmount?.();
    const heading = banner(`${state.snapshot.season} season`, 'RANKINGS', 'Explore FBS and FCS rankings, compare polls, and see how conferences match up.');
    main.innerHTML = `${heading}<div class="wrap page-content rankings-hub">${rankingsHubNav(active)}<div id="rankings-hub-content">${markup}</div></div>`;
    const nextPanel = main.querySelector('#rankings-hub-content');
    rankingsHubView = { panel: nextPanel, key, markup, unmount: mount?.(nextPanel) };
    return;
  }
  if (previous.key === key && previous.markup === markup) return;
  const changed = previous.key !== key;
  const pending = { panel, key, markup, animation: previous.animation, unmount: previous.unmount };
  rankingsHubView = pending;
  const apply = () => {
    if (rankingsHubView !== pending || !panel.isConnected) return;
    const focused = document.activeElement;
    const keepModelFocus = panel.contains(focused) && focused?.dataset?.action === 'model';
    const keepEditionFocus = panel.contains(focused) && focused?.id === 'edition-week';
    const keepAllFocus = panel.contains(focused) && focused?.dataset?.action === 'toggle-all';
    for (const link of main.querySelectorAll('[data-ranking-section]')) {
      if (link.dataset.rankingSection === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    pending.unmount?.();
    panel.innerHTML = markup;
    pending.unmount = mount?.(panel);
    if (keepModelFocus) panel.querySelector('[data-action="model"][aria-pressed="true"]')?.focus({ preventScroll: true });
    if (keepEditionFocus) panel.querySelector('#edition-week')?.focus({ preventScroll: true });
    if (keepAllFocus) panel.querySelector('[data-action="toggle-all"]')?.focus({ preventScroll: true });
  };
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    previous.animation?.cancel();
    pending.animation = null;
    apply();
  } else if (changed || previous.phase === 'out') {
    const opacity = Number(window.getComputedStyle(panel).opacity);
    previous.animation?.cancel();
    pending.phase = 'out';
    const exit = panel.animate([{ opacity }, { opacity: 0 }], { duration: 100, easing: 'ease-in', fill: 'forwards' });
    pending.animation = exit;
    exit.finished.then(() => {
      if (rankingsHubView !== pending || !panel.isConnected) return;
      apply();
      exit.cancel();
      pending.phase = 'in';
      pending.animation = panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, easing: 'ease-out' });
    }).catch(() => {});
  } else {
    apply();
  }
}
function conferenceHash({ view, season, a, b }) {
  const parts = ['conference-strength', view];
  if (season) parts.push(season);
  if (view === 'compare' && season && a && b) parts.push(a, b);
  return `#${parts.map(encodeURIComponent).join('/')}`;
}
function conferenceId(segment) {
  try { return decodeURIComponent(segment || ''); }
  catch { return ''; }
}
function renderConferenceStrengthPage() {
  const [, section, year, conferenceA, conferenceB] = route();
  const view = ['quality', 'compare'].includes(section) ? section : 'records';
  const season = /^\d{4}$/.test(year) ? Number(year) : undefined;
  const a = conferenceId(conferenceA);
  const b = conferenceId(conferenceB);
  const key = conferenceHash({ view, season, a, b });
  const placeholder = '<section id="conference-strength-panel" aria-busy="true"><p class="compact-note" role="status">Loading conference results…</p></section>';
  renderRankingsHub('conference-strength', key, placeholder, panel => {
    const target = panel.querySelector('#conference-strength-panel');
    if (!target?.isConnected) return;
    let unmount;
    let cancelled = false;
    conferenceStrengthModule ??= import('./conference-strength.js?v=accuracy-20261118').catch(error => {
      conferenceStrengthModule = undefined;
      throw error;
    });
    conferenceStrengthModule.then(module => {
      if (cancelled || !target.isConnected) return;
      unmount = module.mountConferenceStrength(target, {
        view, season, a, b, dataRoot,
        onNavigate(destination) { navigate(conferenceHash(destination)); },
      });
    }).catch(() => {
      if (cancelled || !target.isConnected) return;
      target.removeAttribute('aria-busy');
      target.innerHTML = '<p class="compact-note" role="status">Conference results could not load. Reload to try again.</p>';
    });
    return () => { cancelled = true; unmount?.(); };
  });
}
function renderRankings() {
  const { division, model } = state;
  const fcs = division === 'fcs';
  const sor = fcs || usesSor();
  const views = {
    achievement: [sor ? 'Strength of Record' : 'Colley Achievement', sor ? 'How hard would it be for an average team in this division to win as many games against the same schedule?' : 'This snapshot ranks teams by their results and the opponents they faced.'],
    strength: ['Predictive Strength', 'Estimates point margins using score margins, location, opponents, and the engine’s historical strength ratings.'],
    performance: ['Performance', 'How consistently did teams gain the yards they needed and stop opponents from doing the same?']
  };
  const [title, description] = views[model];
  const tier = division.toUpperCase();
  const heading = `${rankingViews()}<div class="rankings-view-heading"><h2>${tier} ${title}</h2>${fcs && model !== 'performance' ? '<span class="tag">Experimental</span>' : ''}<p>${description}</p></div>`;
  const empty = content => `<section class="panel"><div class="panel-body">${content}</div></section>`;
  let body;
  if (fcs && !divisionTeams(division).length) {
    body = empty('<p role="status">FCS rankings are unavailable for this snapshot.</p>');
  } else if (model === 'performance' && (!hasPerformance() || (fcs && !state.fcsPerformanceById))) {
    if (!performanceFailed) void loadPerformance();
    body = empty(!performancePublished() || (fcs && hasPerformance())
      ? `<p role="status">${tier} Performance is unavailable for this snapshot.</p>`
      : performanceStatus());
  } else {
    const context = model === 'performance' ? performanceNotice(division)
      : fcs ? `<div class="notice"><strong>FCS coverage</strong><p>${divisionTeams(division).length} FCS teams identified by CollegeFootballData in this snapshot. ${model === 'achievement' ? 'The displayed record includes all covered games. SOR scores decisive results against FCS and FBS opponents. Other results still inform the opponent network and SOS.' : 'These teams have been ranked by their ratings in the same opponent network as FBS. FCS matchup forecasts are still experimental.'}</p></div>`
      : model === 'achievement' ? coveragePanel() : `<section class="panel"><div class="panel-body"><h3>Matchup lab</h3><p>Predictive Strength powers the matchup lab. ${state.snapshot.matchupValidation ? 'Win probabilities are calibrated on historical results.' : 'Its game probabilities are uncalibrated estimates.'}</p></div><a class="method-link" href="/matchup-lab">Open matchup lab ${icon('arrow')}</a></section>`;
    body = `<div class="two-column"><div>${filterControls(true, division)}<section class="panel" id="ranking-results">${rankingsContent()}</section></div><aside class="stack">${context}${schedulePanel()}</aside></div>`;
  }
  const comparison = model === 'achievement' ? `<p class="rankings-comparison-link"><a class="text-link" href="${routeHref(`sor-compare/${division}`)}">Why does one team rank above another? ${icon('arrow')}</a></p>` : '';
  renderRankingsHub(division, `${division}/${model}`, heading + comparison + body);
}
function teamsContent() {
  const pool = divisionTeams(state.division);
  const teams = filtered(pool);
  const favorites = new Set(myTeamsStore?.getMyTeamIds() ?? []);
  return `${teams.length ? `<div class="team-grid">${teams.map(t => `<a class="panel team-card" href="${routeHref(`team/${encodeURIComponent(t.id)}`)}"><span class="team-card-rank">${rank(nationalRank(t))}</span>${logo(t)}<div><h3>${esc(t.name)}${favorites.has(t.id) ? ' <span class="team-saved-indicator" aria-label="Saved in My Teams">★</span>' : ''}</h3><p>${esc(t.conference)}</p><small>${record(t)} · ${number(achievementScore(t))} ${usesSor(t) ? 'SOR' : 'Colley'}</small></div></a>`).join('')}</div>` : '<div class="panel empty">No teams match these filters.</div>'}<p class="results-count">${teams.length} of ${pool.length} ${state.division.toUpperCase()} teams</p>`;
}
function directoryDivisionNav() {
  return `<nav class="matchup-views" aria-label="Team directory division">${[['fbs','/teams/fbs/'],['fcs','/teams/fcs/']].map(([division,href]) =>
    `<a href="${href}"${state.division === division ? ' aria-current="page"' : ''}>${division.toUpperCase()}</a>`).join('')}<a href="/my-teams">My Teams</a></nav>`;
}
function renderTeams() {
  main.innerHTML = `${banner('The team directory','EVERY TEAM HAS A STORY.','Choose a team to inspect its results, opponent strength, and the exact calculation behind its rank.')}<div class="wrap page-content">${directoryDivisionNav()}${filterControls(false,state.division)}<div id="team-results">${teamsContent()}</div></div>`;
}
function explanation(t) {
  const wins = t.contributions.filter(g=>g.result==='W').sort((a,b)=>b.opponentAchievement-a.opponentAchievement);
  const losses = t.contributions.filter(g=>g.result==='L');
  const opponent = g => {
    const row = rankedTeam(g.opponentId);
    const position = opponentRank(g);
    const tier = row?.division === t.division ? '' : ` ${row?.division?.toUpperCase() || 'FBS'}`;
    return `${position ? `${rank(position)}${tier} ` : ''}${esc(g.opponentName)}`;
  };
  const winText = wins.filter(g=>rankedTeam(g.opponentId)).slice(0,2).map(g=>`<strong>${opponent(g)}</strong>`).join(' and ');
  const evidence = `<strong>${esc(t.name)}</strong> holds ${recordArticle(t)} <strong>${record(t)}</strong> record and the <strong>${rank(sosRank(t))}</strong> schedule by opponents’ average Colley ratings.${winText?` Its wins include ${winText}.`:''} ${losses.length?`The ${losses.length===1?'loss came':'losses came'} against ${losses.map(opponent).join(', ')}.`:'It has no losses in the completed results.'}`;
  if (t.division === 'fcs' && !t.sorGames) return `${evidence} An FCS SOR rank requires a decisive result against an FBS or FCS opponent.`;
  if (!usesSor(t)) return `${evidence} The Colley network produces an achievement score of <strong>${number(t.achievement)}</strong>.`;
  const fcs = t.division === 'fcs';
  return `${evidence} Its <strong>Strength of Record score is ${number(t.sor)}</strong>. The model gives an average-strength ${fcs ? 'FCS' : 'FBS'} reference team a <strong>${probability(t.sorTailProbability)}</strong> chance of matching at least ${t.sorWins ?? t.wins} wins ${fcs ? `in its ${t.sorGames} SOR-eligible games` : 'against this schedule'}. Game location and a subdivision adjustment learned from historical FBS/FCS results affect those chances. Each game is removed from the network before its difficulty is measured.`;
}
function sorCalculationNote(t, wins) {
  const p = t.sorTailProbability;
  const chance = p > 0 && p < 0.0001 ? 'less than 0.01%' : probability(p);
  const expected = number(t.sorExpectedWins, 2);
  if (!t.games) return `With zero completed games, the model shows <strong>${expected} expected wins</strong> and a <strong>${chance}</strong> chance of reaching zero wins. The team gets a rank after it plays.`;
  if (!Number.isFinite(p) || !Number.isFinite(t.sorExpectedWins)) return `This snapshot has limited schedule estimates. The reference-team chance is <strong>${chance}</strong> and the expected wins are <strong>${expected}</strong>.`;

  const count = Math.round(p * 1000);
  const frequency = p > 0 && p < 0.01 ? ` That’s ${count ? `about ${count} ${count === 1 ? 'time' : 'times'}` : 'less than once'} out of 1,000 tries.` : '';
  const outcome = (t.sorWins ?? t.wins)
    ? `It has a <strong>${chance}</strong> chance of finishing with at least <strong>${wins}</strong>.${frequency}`
    : `Any team can reach zero wins, so the chance is <strong>${chance}</strong> and the SOR score is zero.`;
  return `Imagine a team with the average ${t.division === 'fcs' ? 'FCS' : 'FBS'} Colley rating playing the same ${t.division === 'fcs' ? 'SOR-eligible ' : ''}opponents in the same places. The model expects it to win <strong>${expected} games</strong> on average. ${outcome}`;
}
function breakdown(t, explain = false) {
  const x = t.explanation;
  const official = usesSor(t);
  const winCount = t.sorWins ?? t.wins;
  const wins = `${winCount} ${winCount === 1 ? 'win' : 'wins'}`;
  const sor = official ? `<h3>STRENGTH OF RECORD</h3>
    ${explain ? `<p class="team-narrative calculation-copy">${sorCalculationNote(t, wins)}</p>` : ''}
    <div class="equation">SOR = −log10[P(at least ${wins})] = <b>${number(t.sor)}</b></div>
    ${explain ? '<p class="team-narrative calculation-copy">The formula gives a higher score when the record is harder to match. A 10% chance gives a score of 1. A 1% chance gives a score of 2.</p>'
      : `<p class="compact-note">Reference-team chance: ${probability(t.sorTailProbability)}. Expected wins against this schedule: ${number(t.sorExpectedWins,2)}. A higher SOR score means a harder record to match; it is not this team’s next-game win probability.</p>`}` : '';
  const block = `score-breakdown${explain ? ' calculation-breakdown' : ''}`;
  if (!x) return `<div class="${block}">${sor}<p class="compact-note">The Colley baseline breakdown is unavailable for this publication.</p></div>`;
  const terms = [
    ['Baseline', x.baseline, 'gray', 'The small starting amount built into the formula.'],
    ['Record', x.record, x.record < 0 ? 'negative' : '', `This comes from the team’s ${record(t)} record. Wins raise it and losses lower it.`],
    ['Opponents', x.opponents, 'dark', 'This comes from the ratings of the teams it played. Their own results and schedules shape those ratings.'],
  ];
  const colleyRank = t.colleyRank ?? t.rank;
  const colleyNote = explain
    ? `These three pieces add up to the team’s Colley rating${colleyRank ? `, ranked <strong>${rank(colleyRank)}</strong> nationally by Colley` : ''}. Averaging the opponents’ Colley ratings gives the schedule strength shown on the team page.${official ? ' The Games Decide’s national and conference rankings use Strength of Record.' : ' This season’s national and conference rankings use Colley.'}`
    : official ? `These terms reconcile to the Colley baseline (${rank(colleyRank)}), not the SOR score. Colley supplies the opponent network and displayed SOS; national and conference ranks use SOR.`
      : 'These terms reconcile to the Colley score. Opponent effects are part of the jointly solved network.';
  return `<div class="${block}">${sor}<h3>${official ? 'COLLEY BASELINE, EXPLAINED' : 'THE SCORE, EXPLAINED'}</h3>
    ${terms.map(([label, value, cls, meaning]) => `<div class="term-row"><span>${label}</span><div class="term-track ${cls}"><span style="width:${Math.max(1,Math.min(100,Math.abs(value)*100))}%"></span></div><b>${number(value)}</b></div>
      ${explain ? `<p class="team-narrative calculation-term-note">${meaning}</p>` : ''}`).join('')}
    <div class="equation">${number(x.baseline)} + ${number(x.record)} + ${number(x.opponents)} = <b>${number(t.achievement)}</b><br><code>${esc(x.formula)}</code></div>
    <p class="${explain ? 'team-narrative calculation-copy' : 'compact-note'}">${colleyNote}</p></div>`;
}
function teamCalculation(t) {
  const ranking = achievementName(t);
  return `<section class="panel"><div class="panel-body">
    <div class="explanation-head">${icon('layers')}<h2>THE CALCULATION</h2></div>
    ${breakdown(t, true)}
    <div class="fact-list calculation-facts"><div class="fact-row"><div><span>Conference ${ranking} rank</span><p class="compact-note">Where the team stands among teams in its own conference.</p></div><strong>${rank(conferenceRank(t))}</strong></div></div>
    <div class="score-breakdown"><h3>PREDICTIVE STRENGTH</h3>
      <p class="team-narrative calculation-copy">Compare two teams’ ratings to see the model’s point margin on a neutral field. A team rated 24 would have a 4-point edge over a team rated 20.</p>
      <div class="fact-list calculation-facts">
        <div class="fact-row"><div><span>Current predictive strength</span><p class="compact-note">The rating updates with how much teams win or lose by, who they played, and where. The model limits how much a blowout counts.</p></div><strong>${number(t.strength, 2)} pts</strong></div>
        <div class="fact-row"><div><span>Preseason strength prior</span><p class="compact-note">The model’s starting rating. It carries over part of last season’s rating when one is available.</p></div><strong>${number(t.preseasonStrength, 2)} pts</strong></div>
      </div>
    </div></div><a class="method-link" href="/methodology/">Read the full methodology ${icon('arrow')}</a></section>`;
}
function resultsTable(t) { return `<div class="table-scroll"><table class="evidence-table"><caption class="sr-only">${esc(t.name)} completed results</caption><thead><tr><th>Result</th><th>Opponent</th><th>Record</th><th>Margin</th></tr></thead><tbody>${t.contributions.map(g=>{
  const team = rankedTeam(g.opponentId);
  const o = team ?? { id: g.opponentId, name: g.opponentName || g.opponentId };
  const position = team && nationalRank(team);
  const target = /^\d+$/.test(g.gameId ?? '') ? ` id="team-game-${g.gameId}" tabindex="-1"` : '';
  return `<tr${target}><td><span class="outcome ${g.result==='L'?'loss':''}">${g.result}</span></td><td><div class="team-cell">${logo(o)}<div>${team ? teamLink(o) : esc(o.name)}<small>${position ? `${rank(position)} ${team.division?.toUpperCase() || 'FBS'} ${achievementName(team)}` : 'Unranked opponent'}</small></div></div></td><td class="num">${esc(g.opponentRecord||'—')}</td><td class="num ${g.finalMargin>=0?'margin-positive':'margin-negative'}">${g.finalMargin>0?'+':''}${g.finalMargin}</td></tr>`;
  }).join('')}</tbody></table></div><div class="panel-body"><p class="compact-note">Only completed games appear. Opponent records and ranks reflect this publication, not the date of the matchup. Margins inform predictive strength, not achievement rank.</p></div>`; }
function upcomingTeamGames(fixtures) {
  const now = localPreview?.now ?? Date.now();
  const today = scheduleDay.format(now);
  return (Array.isArray(fixtures) ? fixtures : [])
    .map(game => ({ ...game, kickoff: Date.parse(game.startDate) }))
    .filter(game => Number.isFinite(game.kickoff) && (game.startTimeTbd === true
      ? game.startDate.slice(0, 10) >= today : game.kickoff >= now))
    .sort((a, b) => a.kickoff - b.kickoff);
}
function teamKickoff(game, upcoming = false) {
  const kickoff = Date.parse(game.startDate);
  return game.startTimeTbd === true || upcoming && game.startTimeTbd !== false
    ? `<time datetime="${esc(game.startDate.slice(0, 10))}">${scheduleDateOnly.format(kickoff)}</time> · Time pending`
    : `<time datetime="${esc(game.startDate)}">${picksDate.format(kickoff)} · ${scheduleKickoff.format(kickoff)}</time>`;
}
function teamFixtureHref(team, game) {
  const divisions = [game.homeId, game.awayId].map(id => rankedTeam(id)?.division);
  if (Number.isInteger(game.week) && divisions.every(division => ['fbs', 'fcs'].includes(division))) {
    return weeklyGameHref({ ...game, id: game.gameId }, divisions.every(division => division === 'fcs') ? 'fcs' : 'fbs');
  }
  const gameSuffix = /^\d+$/.test(game.gameId ?? '') ? `/${game.gameId}` : '';
  return routeHref(`team/${encodeURIComponent(team.id)}/results${gameSuffix}`);
}
function teamFixtureCalendar(game, href) {
  return kickoffCalendar({ id: game.gameId, startDate: game.startDate, startTimeTbd: game.startTimeTbd, href,
    awayName: game.awayName, homeName: game.homeName, neutral: game.venue === 'neutral',
    asOf: state.snapshot.kickoffVerificationAsOf ?? state.snapshot.asOf, status: 'scheduled' });
}
function upcomingGamesPanel(team) {
  const venues = { home: 'Home', away: 'Away', neutral: 'Neutral site' };
  const available = Array.isArray(team.upcomingGames);
  const games = upcomingTeamGames(team.upcomingGames);
  const rows = games.map(game => {
    const ranked = rankedTeam(game.opponentId);
    const opponent = ranked ?? { id: game.opponentId, name: game.opponentName };
    const description = oddsDescription(game.winProbability);
    const odds = Number.isFinite(game.winProbability) && game.winProbability >= 0 && game.winProbability <= 1
      ? `<strong>${number(game.winProbability * 100, 1)}%</strong><small>${description ? esc(description) + ' · ' : ''}${game.probabilitySource === 'saved' ? 'Saved win chance' : 'Win chance estimate'}${game.calibrated === false ? ' · Experimental' : ''}</small>`
      : '<small>Odds unavailable</small>';
    return `<li class="team-upcoming-game" id="team-game-${esc(game.gameId)}" tabindex="-1">
      <div class="team-upcoming-opponent">${logo(opponent)}<div><strong>${ranked ? teamLink(opponent) : esc(opponent.name)}</strong>
      <div class="compact-note">${teamKickoff(game, true)} · ${venues[game.venue] ?? 'Venue TBD'}</div>
      ${game.startTimeTbd === false ? teamFixtureCalendar(game, teamFixtureHref(team, game)) : ''}</div></div>
      <div class="team-upcoming-odds">${odds}</div></li>`;
  }).join('');
  const content = rows ? `<ul class="team-upcoming-list">${rows}</ul>`
    : `<div class="panel-body"><p class="compact-note">${available ? 'No upcoming games are listed.' : 'The upcoming schedule is unavailable for this snapshot.'}</p></div>`;
  return `<section class="panel team-upcoming"><div class="panel-head"><div class="panel-head-title">${icon('calendar')}<h2>Upcoming games</h2></div></div>${content}</section>`;
}
function modelRanks(t) {
  const total = divisionTeams(t.division).length;
  return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('layers')}<h2>Rank and strength</h2></div></div><div class="panel-body">${[[achievementName(t),nationalRank(t),'What this team has earned from completed results.'],['Predictive strength',strengthRank(t),'A historical, opponent-adjusted estimate of team strength.']].map(([label,r,desc])=>`<div class="model-rank"><div class="model-rank-label"><div>${label}<br><small>${label===achievementName(t)?`${t.division?.toUpperCase() || 'FBS'} RANKING`:'EXPERIMENTAL MODEL'}</small></div><strong>${rank(r)}</strong></div><div class="model-track"><span style="width:${r ? Math.max(2,(total-r+1)/total*100) : 0}%"></span></div><p>${desc}</p></div>`).join('')}</div></section>`;
}
function qualityPanel(division = 'fbs') { const audit=state.snapshot.source?.audit||{};const incomplete=audit.incompleteFinals?.length||0;return `<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('shield')}<h2>Data & coverage</h2></div></div><div class="panel-body"><div class="data-status-row"><span>${icon('check')}${division.toUpperCase()} membership</span><b>${divisionTeams(division).length} teams</b></div><div class="data-status-row"><span>${icon('check')}Game records modeled</span><b>${state.snapshot.gamesUsed.toLocaleString()}</b></div><div class="data-status-row"><span>${icon('check')}Data provider</span><b>CFBD</b></div><div class="data-status-row"><span>${icon('check')}Publication</span><b>${snapshotDate()}</b></div>${incomplete?`<details class="quality-note"><summary>${incomplete} incomplete finals excluded</summary><p>CFBD marked these entries complete without valid final scores. They do not count toward the rankings: ${audit.incompleteFinals.map(esc).join(', ')}.</p></details>`:''}<p class="compact-note" style="font-size:10px;margin-top:12px">The site checks for new results daily.</p></div></section>`; }
function teamCenterContent(t) {
  if(state.teamTab==='results') return `<div class="stack">${upcomingGamesPanel(t)}<section class="panel"><div class="panel-head"><div class="panel-head-title">${icon('calendar')}<h2>THE COMPLETED RESULTS</h2></div><span class="tag">${t.games} GAMES</span></div>${resultsTable(t)}</section></div>`;
  if(state.teamTab==='model') return teamCalculation(t);
  const position = nationalRank(t);
  const heading = position ? `WHY WE RANK ${esc(t.name.toUpperCase())} ${rank(position)}` : `${esc(t.name.toUpperCase())}’S RECORD`;
  const overview = [[achievementName(t),rank(position),`${t.division?.toUpperCase() || 'FBS'} rank`],
    ['Schedule',rank(sosRank(t)),'Colley opponent average'],['Conference',rank(conferenceRank(t)),t.conference]];
  const recordButton = `<button type="button" class="metric team-record-button" data-action="team-tab" data-value="results">
    <span>Record</span><strong>${record(t)}</strong><small>View schedule and results</small></button>`;
  return `<div class="metric-grid">${overview.map(([label,value,note])=>`<div class="metric"><span>${label}</span><strong>${value}</strong><small>${esc(note)}</small></div>`).join('')}${recordButton}</div><section class="panel"><div class="panel-body"><div class="explanation-head">${icon('network')}<h2>${heading}</h2></div><p class="team-narrative">${explanation(t)}</p><div class="evidence-chips"><span class="evidence-chip">Opponent Colley average <b>${number(t.achievementScheduleStrength)}</b></span><span class="evidence-chip">${t.evidence?.connectedTeams??'—'} connected teams</span><span class="evidence-chip">${t.evidence?.provisional?'Small sample · provisional':'Current-season evidence'}</span></div>${breakdown(t)}</div></section><section class="panel" style="margin-top:17px"><div class="panel-head"><div class="panel-head-title">${icon('trophy')}<h2>RESULTS THAT SHAPE THE RESUME</h2></div><button class="text-link" style="border:0;background:none" data-action="team-tab" data-value="results">All results ${icon('arrow')}</button></div>${resultsTable({...t,contributions:[...t.contributions].sort((a,b)=>b.opponentAchievement-a.opponentAchievement).slice(0,3)})}</section>`;
}
function loadTeamDetails(summary) {
  const { id } = summary;
  const existing = teamDetails.get(id);
  if (existing && !existing.failed) return existing.request;
  const snapshot = state.snapshot;
  const detail = { team: null, failed: false };
  teamDetails.set(id, detail);
  detail.request = populateTeamDetails(summary, detail, snapshot);
  return detail.request;
}
async function populateTeamDetails(summary, detail, snapshot) {
  const { id } = summary;
  try {
    const version = snapshot.teamDetailsVersion ?? snapshot.publicationHash;
    const url = `${snapshot.teamDetailsPath}/${encodeURIComponent(id)}.json?v=${encodeURIComponent(version)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw Error('Team details are unavailable');
    const payload = await response.json();
    if (payload?.id !== id || payload.publicationHash !== snapshot.publicationHash ||
        (snapshot.teamDetailsVersion && payload.teamDetailsVersion !== snapshot.teamDetailsVersion) ||
        !Array.isArray(payload.contributions)) {
      throw Error('Team details do not match the current rankings');
    }
    detail.team = { ...summary, ...payload };
  } catch {
    detail.failed = true;
  }
  const [page, currentId] = route();
  if (state.snapshot !== snapshot) return;
  if (page === 'team' && currentId === id && !playerTabs.has(state.teamTab)) renderTeam(id);
  if (page === 'home') {
    const target = main.querySelector('[data-my-team-schedule]');
    if (target?.dataset?.myTeamSchedule === id) target.innerHTML = favoriteNext(summary);
  }
}
function renderTeam(id) {
  const summary = rankedTeam(id);
  if(!summary){main.innerHTML=`<div class="wrap page-content"><section class="panel empty"><h2>Team not found</h2><a class="button" style="margin-top:15px" href="/rankings">Explore rankings</a></section></div>`;return;}
  const detail = state.snapshot.teamDetailsPath ? teamDetails.get(id) : null;
  const t = detail?.team ?? summary;
  const playerTab = playerTabs.has(state.teamTab) ? state.teamTab : null;
  const needsDetails = !playerTab && state.snapshot.teamDetailsPath && !detail?.team;
  const content = playerTab ? `<section class="panel empty"><p role="status">Loading ${playerTab}…</p></section>`
    : needsDetails ? `<section class="panel empty"><p role="status">${detail?.failed ? 'The team details could not load.' : 'Loading team details…'}</p>
    ${detail?.failed ? '<button type="button" class="button light small" data-action="retry-team-details">Try again</button>' : ''}</section>` : teamCenterContent(t);
  const tier = t.division?.toUpperCase() || 'FBS';
  const matchup = `<section class="panel"><div class="panel-body"><h3>Matchup lab</h3><p class="compact-note">Use the strength model to explore a matchup on a neutral field.</p><button class="button small full-width" style="margin-top:15px" data-action="compare-team" data-value="${esc(t.id)}">${icon('compare')}Open matchup lab</button></div></section>`;
  main.innerHTML=`<section class="hero team-banner"><div class="wrap"><a class="breadcrumb" href="${rankingHref('achievement', false, t.division)}">${icon('back')}Back to ${tier} rankings</a><div class="team-banner-content">${logo(t,'large')}<div><div class="eyebrow">${tier} · ${esc(t.conference)} · ${state.snapshot.season} season</div><h1>${esc(t.name.toUpperCase())}</h1><div class="team-meta"><span><b>${rank(nationalRank(t))}</b> ${achievementName(t)}</span><span>${record(t)} overall</span><span>${rank(conferenceRank(t))} in conference</span></div><div class="team-banner-actions"><button type="button" class="button outline small team-favorite-action" data-action="choose-my-team" data-value="${esc(t.id)}">Add to My Teams</button>${shareTeamButton(t)}<a class="button outline small" href="${routeHref(`sor-compare/${t.division}/${encodeURIComponent(t.id)}`)}">Compare earned SOR</a><a class="button outline small" href="/my-teams">My Teams</a></div></div><div class="team-banner-score"><strong>${number(t.division === 'fcs' ? t.sor : achievementScore(t))}</strong><span>${achievementName(t)==='Strength of Record'?'SOR score':'Colley rating'}</span></div></div></div></section><div class="wrap page-content"><div class="team-layout"><aside class="panel rank-rail"><div class="panel-head"><div class="panel-head-title">${icon('trophy')}<h2>${tier} TOP 25</h2></div></div><div class="rail-list">${topTwentyFive(divisionTeams(t.division), 'achievement').map(o=>`<a href="${routeHref(`team/${encodeURIComponent(o.id)}`)}" class="rail-row ${o.id===t.id?'selected':''}" ${o.id===t.id?'aria-current="page"':''}><span>${nationalRank(o)}</span>${logo(o)}<b>${esc(o.name)}</b><small>${record(o)}</small></a>`).join('')}</div><a class="method-link" href="${rankingHref('achievement', true, t.division)}">All ${tier} rankings ${icon('arrow')}</a></aside><div class="team-center"><div class="tabs team-section-tabs" aria-label="Team sections">${[['overview','Overview'],['results','Results'],['players','Players'],['availability','Availability'],['model','Model details']].map(([value,label])=>`<button data-action="team-tab" data-value="${value}" class="${state.teamTab===value?'active':''}" aria-pressed="${state.teamTab===value}">${label}</button>`).join('')}</div><div id="team-center-content">${content}</div></div><aside class="stack team-right">${modelRanks(t)}${performanceTeamPanel(t)}${qualityPanel(t.division)}${matchup}</aside></div></div>`;
  if (needsDetails && !detail) void loadTeamDetails(summary);
  if (!needsDetails && state.teamTab === 'results') focusLinkedGame('team-game-', route()[3]);
  if (playerTab) {
    const target = main.querySelector('#team-center-content');
    let selectedPlayer;
    if (playerTab === 'players') try { selectedPlayer = decodeURIComponent(route()[3] ?? ''); } catch {}
    mountPlayerFeature(target, ({ mountTeamPlayerView }) => mountTeamPlayerView(target, {
      team: summary, season: state.snapshot.season, urlFor: playerPublicationPath, view: playerTab, selectedPlayer,
    }));
  }
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
    <details><summary>Current model data and calibration</summary><p><a class="text-link" href="https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/blob/main/reports/platform-model-lineage-2026-11-18.md">Read the November 18 data-lineage and calibration review</a></p></details>
  </section>`;
}
function renderMethodology() {
  main.innerHTML=`${banner('Open the black box','THE EVIDENCE IS THE POINT.',(performancePublished()?'Three views.':'Two models.')+' See how we calculate the rankings and what we have validated.')}<div class="wrap page-content"><div class="method-grid"><div class="stack"><section class="panel method-block"><div class="section-label">01 · National ranking</div><h2>WHAT HAS A TEAM EARNED?</h2>${usesSor()?`<p>Our primary national and conference ranking uses <strong>division-aware Strength of Record (SOR)</strong>. It asks how likely an average-strength FBS reference team would be to earn at least this many wins against the same opponents, at the same locations. A harder record to match earns a higher score.</p><div class="formula-display">SOR = −log10[P(reference team wins at least this many games)]</div><p>We remove each game before measuring its difficulty, then combine the per-game probabilities under an independence assumption. Venue and the FBS/FCS gap use fixed coefficients learned from older seasons. Individual opponent results still matter; there is no fixed percentage discount for every FCS win.</p><p>The Colley network remains the opponent-rating baseline and the source of displayed SOS. Its original scores and ranks are retained separately:</p>`:`<p>This historical snapshot uses the Colley matrix method. Current-season wins and losses connect each team to its opponents and the rest of the results network. It has not been relabeled as historical SOR.</p>`}${state.snapshot.fcsRankingMethod ? '<p>FCS Strength of Record uses an average-strength FCS reference team. It scores decisive games against FBS and FCS opponents. Other covered results still go into the team record and opponent network.</p>' : ''}<div class="formula-display">Colley = [1 + (wins − losses) ÷ 2 + Σ opponent ratings] ÷ (games + 2)</div><p>Score margins, human polls and conference prestige do not affect earned rank. Past team success gives no current-season achievement credit. Head-to-head results enter the network without automatic ranking overrides. ${usesSor()?'Historical calibration supports this probability mapping; future saved forecasts remain under evaluation.':'Venue and subdivision labels do not change the Colley baseline formula.'}</p></section><section class="panel method-block"><div class="section-label">02 · Predictive strength</div><h2>WHAT DOES THE EVIDENCE SUGGEST NEXT?</h2><p>A separate experimental model fits opponent-adjusted score margins, with a location adjustment and a limit on blowout influence. Its preseason starting point is our own previous-season strength, regressed toward the mean.</p><ul><li>Score margins are bounded using a smooth cap.</li><li>Home advantage is ${state.snapshot.config.homeAdvantage} points; neutral games receive no home adjustment.</li><li>Historical retention is ${Math.round(state.snapshot.config.retention*100)}% per season gap.</li><li>${state.snapshot.matchupValidation ? 'Win probabilities are calibrated on historical results and tested on later seasons.' : 'Matchup probabilities are uncalibrated estimates.'}</li></ul><p>This model is not blended into the achievement ranking. The matchup lab uses strength only.</p></section>${performanceMethodology()}</div><aside class="stack"><section class="panel method-block"><h2>FROM DATA TO EXPLANATION</h2><div class="method-steps">${[['Acquire','Fetch the season’s results and FBS membership from CollegeFootballData.'],['Validate','Require valid team identities, completed games, and final scores.'],['Connect','Model opponents individually across the connected game network.'],['Calculate',usesSor()?'Calculate Strength of Record from the Colley opponent network; keep predictive strength separate.':'Solve the Colley achievement and predictive strength models separately.'],['Publish','Save a reproducible snapshot and the evidence behind each score.']].map(([title,desc])=>`<div class="method-step"><div><h3>${title}</h3><p>${desc}</p></div></div>`).join('')}</div></section>${qualityPanel()}${schedulePanel()}</aside></div>${validationSummary()}</div>`;
}
function compareOptions(id, opponentId) {
  return `<option value=""${id ? '' : ' selected'}>Choose a team</option>` + ['fbs','fcs'].map(division => {
    const teams = [...divisionTeams(division)].sort((a,b) => a.name.localeCompare(b.name));
    return teams.length ? `<optgroup label="${division.toUpperCase()}">${teams
      .map(t => `<option value="${t.id}"${id === t.id ? ' selected' : ''}${opponentId === t.id ? ' disabled' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}
function compareResult() {
  const a=rankedTeam(state.compareA),b=rankedTeam(state.compareB);
  if (!a || !b || a.id === b.id || !['neutral','home','away'].includes(state.venue)) return null;
  const edge=a.strength-b.strength+(state.venue==='home'?state.snapshot.config.homeAdvantage:state.venue==='away'?-state.snapshot.config.homeAdvantage:0);
  const fbs = a.division === 'fbs' && b.division === 'fbs';
  const fcs = a.division === 'fcs' && b.division === 'fcs';
  const validation = fbs ? state.snapshot.matchupValidation : fcs ? state.snapshot.fcsMatchupValidation : null;
  const scale = (fbs ? validation?.winProbability.scale : fcs ? validation?.scale : null) ?? state.snapshot.config.probabilityScale;
  const probability = 1 / (1 + Math.exp(-edge / scale));
  return {a,b,edge,probability,validation,fbs,fcs};
}
function matchupMarginRange(a, b, edge) {
  if (a.division !== 'fbs' || b.division !== 'fbs') return '';
  const band = state.snapshot.matchupValidation?.marginBand;
  if (!band || a.games < band.minTeamGames || b.games < band.minTeamGames) return '';
  const low = Math.ceil(edge - band.halfWidth);
  const high = Math.floor(edge + band.halfWidth);
  const signed = points => points < 0 ? `−${Math.abs(points)}` : points > 0 ? `+${points}` : '0';
  return `<p style="margin-top:12px">Historical final-margin range for ${esc(a.name)}<br><strong>${signed(low)} to ${signed(high)} pts</strong></p>`;
}
function matchupNav(active) {
  return `<nav class="matchup-views" aria-label="Matchup Lab views">
    <a href="/matchup-lab"${active === 'compare' ? ' aria-current="page"' : ''}>Compare teams</a>
    <a href="/weekly-picks"${active === 'weekly' ? ' aria-current="page"' : ''}>Weekly picks</a>
    <a href="/beat-the-model/">Beat the Model</a>
    <a href="/model-reports/fbs/">Model Report Card</a>
    <a href="/sor-compare/">Compare earned SOR</a>
    <a href="/my-teams">My Teams</a>
  </nav>`;
}
function picksTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}
function weekKey(game) { return `${game.seasonType}:${game.week}`; }
function weeklyGameHref(game, division = 'fbs') {
  const base = `compare/weekly${division === 'fcs' ? '/fcs' : ''}`;
  const linked = ['regular', 'postseason'].includes(game?.seasonType) && Number.isInteger(game.week) && /^\d+$/.test(game.id ?? '');
  return routeHref(linked ? `${base}/${weekKey(game)}/${game.id}` : base);
}
function focusLinkedGame(prefix, id) {
  if (!/^\d+$/.test(id ?? '') || location.href === focusedGameLink) return;
  const result = document.getElementById(prefix + id);
  if (!result) return;
  const currentUrl = location.href;
  requestAnimationFrame(() => {
    if (!result.isConnected || location.href !== currentUrl) return;
    focusedGameLink = currentUrl;
    result.scrollIntoView({ block: 'start' });
    result.focus({ preventScroll: true });
  });
}
function weekLabel(game) { return game.seasonType === 'postseason' ? `Postseason · Week ${game.week}` : `Week ${game.week}`; }
function activeWeeklyPicks() {
  const [page, view, division] = route();
  return page === 'compare' && view === 'weekly' ? weeklyPickTabs[division === 'fcs' ? 'fcs' : 'fbs'] : null;
}
function validFcsPicksSource(source) {
  const evidence = source?.validation;
  const nearSeventy = evidence?.nearSeventy;
  const proportion = value => Number.isFinite(value) && value >= 0 && value <= 1;
  return source?.provider === 'cfbd' && source.matchupScope === 'fcs-fcs' && source.calibrated === true &&
    Number.isFinite(source.probabilityScale) && source.probabilityScale > 0 &&
    source.rankingAsOf === state.snapshot.asOf && source.snapshotHash === state.snapshot.snapshotHash &&
    Number.isFinite(picksTime(source.scheduleAsOf)) &&
    (!state.snapshot.source?.fetchedAt || source.scheduleAsOf === state.snapshot.source.fetchedAt) &&
    Number.isInteger(evidence?.firstSeason) && Number.isInteger(evidence?.lastSeason) &&
    evidence.firstSeason <= evidence.lastSeason && evidence.lastSeason < state.snapshot.season &&
    Number.isInteger(evidence.games) && Number.isInteger(evidence.picked) && Number.isInteger(evidence.correct) &&
    evidence.games >= evidence.picked && evidence.picked > 0 && evidence.correct >= 0 && evidence.correct <= evidence.picked &&
    proportion(evidence.accuracy) && proportion(evidence.brier) &&
    Number.isInteger(nearSeventy?.games) && nearSeventy.games > 0 && nearSeventy.games <= evidence.picked &&
    proportion(nearSeventy.meanForecast) && proportion(nearSeventy.actualWinRate);
}
function picksPublication(data, division) {
  if (data?.schemaVersion !== 1 || data.season !== state.snapshot.season || !Number.isFinite(picksTime(data.asOf)) ||
    !Array.isArray(data.teams) || !Array.isArray(data.games)) throw new Error('Invalid weekly picks publication');
  const fcs = division === 'fcs';
  if (fcs && (!validFcsPicksSource(data.source) || picksTime(data.asOf) < picksTime(data.source.rankingAsOf) ||
    picksTime(data.asOf) < picksTime(data.source.scheduleAsOf))) throw new Error('FCS weekly picks do not match the current rankings or validation');
  const teams = new Map();
  for (const team of data.teams) {
    if (typeof team?.id !== 'string' || !team.id || typeof team.name !== 'string' || !team.name.trim() ||
      teams.has(team.id) || (fcs && team.division !== 'fcs'))
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
async function loadWeeklyPicks(picks) {
  try {
    const response = await fetch(publicationPath(picks.endpoint), { headers: { Accept: 'application/json' } });
    if (response.status === 404 || response.status === 410) picks.status = 'missing';
    else if (!response.ok) throw new Error(`Weekly picks returned ${response.status}`);
    else if (response.headers?.get('content-type')?.includes('text/html')) {
      const html = await response.text();
      if (!html.includes('name="publication-data-root"') || !html.includes('src="/app.js'))
        throw new Error('Weekly picks returned unexpected HTML');
      picks.status = 'missing';
    } else {
      Object.assign(picks, picksPublication(await response.json(), picks.division), { status: 'ready' });
      if (picks.weeks.size) void loadPredictability(picks);
      if (picks.weeks.size && picks.division === 'fbs') {
        try {
          const { buildWeeklyTeamStats, renderWeeklyTeamStats } = await import('./weekly-team-stats.js?v=1');
          picks.teamStats = buildWeeklyTeamStats(picks.data);
          picks.renderTeamStats = renderWeeklyTeamStats;
        } catch (error) { console.warn('Weekly team stats are unavailable', error); }
      }
    }
  } catch (error) {
    picks.status = 'error';
    console.error(error);
  }
  if (activeWeeklyPicks() === picks) {
    renderWeeklyPicks(picks);
    document.querySelector('#announce').textContent = `${picks.division.toUpperCase()} weekly picks ${picks.status === 'ready' ? 'loaded' : 'unavailable'}`;
  }
}
async function loadPredictability(picks) {
  try {
    const { weeklyPicksScore } = await import('./weekly-picks-score.js?v=fcs-weekly-picks');
    if (typeof weeklyPicksScore !== 'function') throw new Error('Missing Weekly Picks scoring function');
    picks.scoring = weeklyPicksScore;
  } catch (error) {
    picks.scoringError = true;
    console.error(error);
  }
  if (activeWeeklyPicks() === picks) {
    const score = document.querySelector('#predictability-content');
    if (score) score.innerHTML = predictabilityContent(picks);
  }
}
function validWeeklyPick(picks, game, pick, capturedAt) {
  const p = pick?.homeWinProbability;
  const capture = picksTime(capturedAt);
  const divisions = [game.home, game.away].map(id => picks.teams.get(id)?.division);
  const inScope = picks.division === 'fcs' ? divisions.every(division => division === 'fcs')
    : divisions.includes('fbs') && divisions.every(division => division === 'fbs' || division === 'fcs');
  return Number.isFinite(p) && p >= 0 && p <= 1 && pick.favored === (p === .5 ? 'even' : p > .5 ? 'home' : 'away') &&
    Number.isFinite(capture) && capture < picksTime(game.startDate) && capture <= picksTime(picks.data.asOf) && inScope;
}
function weeklyPreviewEstimate(picks, game, scheduled = game.status === 'scheduled' && picksTime(game.startDate) >= picksTime(picks.data.asOf)) {
  return scheduled && validWeeklyPick(picks, game, game.estimate, game.estimate?.asOf);
}
function weeklyPicksGame(picks, game) {
  const away = picks.teams.get(game.away);
  const home = picks.teams.get(game.home);
  const kickoff = picksTime(game.startDate);
  const cutoff = picksTime(picks.data.asOf);
  const scheduled = game.status === 'scheduled' && kickoff >= cutoff;
  const live = validWeeklyPick(picks, game, game.pick, game.pick?.capturedAt);
  const replay = !live && !scheduled && kickoff <= cutoff && validWeeklyPick(picks, game, game.replay, game.replay?.asOf);
  const estimate = !live && weeklyPreviewEstimate(picks, game, scheduled);
  const pick = live ? game.pick : replay ? game.replay : estimate ? game.estimate : null;
  const capture = live ? pick.capturedAt : pick?.asOf;
  const pickLabel = live ? 'Saved pregame pick' : replay ? 'Historical replay' : estimate ? 'Preview odds · From saved ratings' : 'Model pick';
  const favored = pick?.favored === 'home' ? home : away;
  const favoriteProbability = pick && Math.max(pick.homeWinProbability, 1 - pick.homeWinProbability);
  const edgeLabel = oddsDescription(favoriteProbability);
  const pickText = pick ? (pick.favored === 'even' ? 'Even · 50.0% each' :
    `${esc(favored.name)} · ${number(favoriteProbability * 100, 1)}%${edgeLabel ? ` · ${edgeLabel}` : ''}`) :
    (scheduled ? 'No pick saved yet' : 'No saved pregame pick');
  const winner = game.status === 'final' && game.homePoints !== game.awayPoints ?
    (game.homePoints > game.awayPoints ? 'home' : 'away') : null;
  const grade = live && winner && kickoff <= cutoff && pick.favored !== 'even' ? (winner === pick.favored ? 'Correct' : 'Missed') : '';
  const result = game.status === 'final' ?
    (winner ? `${esc(winner === 'home' ? home.name : away.name)} won ${Math.max(game.homePoints, game.awayPoints)}–${Math.min(game.homePoints, game.awayPoints)}` :
      `Tied ${game.awayPoints}–${game.homePoints}`) :
    (scheduled ? 'Scheduled' : 'Final score pending');
  const team = entry => rankedTeam(entry.id) ? teamLink(entry) : esc(entry.name);
  const crossDivision = home.division === 'fbs' && away.division === 'fcs' || home.division === 'fcs' && away.division === 'fbs';
  const href = weeklyGameHref(game, picks.division);
  const share = shareCardButton({ teams: [[away, pick && 1 - pick.homeWinProbability], [home, pick?.homeWinProbability]]
    .map(([entry, probability]) => pick ? { id: entry.id, name: entry.name, division: entry.division, probability } : shareTeamData(entry)),
    asOf: capture ?? picks.data.source?.scheduleAsOf ?? picks.data.asOf, href,
    venue: game.neutral ? 'Neutral site' : `At ${home.name}`, forecastLabel: pick ? pickLabel : undefined });
  const calendar = game.status === 'scheduled' && game.startTimeTbd === false && kickoff > (localPreview?.now ?? Date.now())
    ? kickoffCalendar({ ...game, awayName: away.name, homeName: home.name, href, asOf: game.kickoffVerifiedAt ?? picks.data.asOf }) : '';
  return { grade, html: `<li class="weekly-game" id="weekly-game-${esc(game.id)}" tabindex="-1">
    <div><h3>${team(away)} ${game.neutral ? 'vs' : 'at'} ${team(home)}</h3>
    <p class="compact-note">${teamKickoff(game, game.status === 'scheduled')}${game.neutral ? ' · Neutral site' : ''}${crossDivision ? ' · FBS–FCS' : ''}</p>
    <div class="matchup-actions">${share}${calendar}
      ${rankedTeam(home.id) && rankedTeam(away.id) ? `<a class="text-link" href="${matchupLabHref(home.id,away.id,game.neutral ? 'neutral' : 'home')}">Matchup Lab</a>` : ''}
      ${picks.division === 'fbs' ? `<a class="text-link" href="${routeHref(`beat-the-model/${encodeURIComponent(weekKey(game))}/${game.id}`)}">${scheduled ? 'Make your pick' : 'Contest results'}</a>` : ''}</div></div>
    <dl class="weekly-game-details">
      <div><dt>${pickLabel}</dt><dd>${pickText}${capture ? `<small><time datetime="${esc(capture)}">${picksTimestamp.format(picksTime(capture))} MT</time></small>` : ''}</dd></div>
      <div><dt>${game.status === 'final' ? 'Final' : 'Status'}</dt><dd>${result}${grade ? ` <span class="weekly-grade ${grade.toLowerCase()}">${grade}</span>` : ''}</dd></div>
    </dl>${picks.renderTeamStats?.(picks.teamStats, game, { awayName: away.name, homeName: home.name }) ?? ''}</li>` };
}
function scoreAccuracy(value) {
  return Number.isFinite(value) ? `${number(value * 100, 1)}%` : '—';
}
function scoreChange(value) {
  const points = number(Math.abs(value) * 100, 1);
  const sign = points === '0.0' ? '' : value > 0 ? '+' : '−';
  return `${sign}${points} pp`;
}
function predictabilityMetric(label, value, detail) {
  return `<div><dt>${esc(label)}</dt><dd><strong>${esc(value)}</strong><small>${esc(detail)}</small></dd></div>`;
}
function predictabilitySample(score) {
  return score.decisivePicks ? `${score.correctPicks} of ${score.decisivePicks} right` : 'No decided picks with a favorite';
}
function predictabilityCoverage(score, label) {
  if (score.availablePicks && score.pendingPicks === score.availablePicks) {
    return `${score.pendingPicks} ${label} awaiting final scores.`;
  }
  const pending = score.pendingPicks ? ` ${score.pendingPicks} awaiting final scores.` : '';
  return `${score.completedPicks} of ${score.availablePicks} ${label} have a final winner.${pending}`;
}
function completeReplayChange({ week, previousWeek, comparison }) {
  return week?.availablePicks && previousWeek?.availablePicks && week.completedPicks === week.availablePicks &&
    previousWeek.completedPicks === previousWeek.availablePicks ? comparison?.accuracyDifference : null;
}
function replayPredictability({ week, previousWeek, comparison }) {
  if (!week?.availablePicks) return '';
  const delta = completeReplayChange({ week, previousWeek, comparison });
  return `<div class="predictability-replay"><h4>Historical replay</h4>
    <p><strong>${scoreAccuracy(week.accuracy)}</strong> · ${predictabilitySample(week)}${Number.isFinite(week.brier) ? ` · Brier ${number(week.brier, 3)}` : ''}</p>
    <p class="compact-note">${predictabilityCoverage(week, 'replay forecasts')} Replay scores are separate from the saved-pick record.</p>
    ${Number.isFinite(delta) ? `<p class="compact-note">${scoreChange(delta)} vs ${esc(weekLabel(previousWeek))} replay · ${predictabilitySample(previousWeek)} that week.</p>` :
      (previousWeek?.availablePicks && (week.pendingPicks || previousWeek.pendingPicks) ? '<p class="compact-note">Replay week comparison is waiting for final scores.</p>' : '')}
  </div>`;
}
function savedSeasonRecord(season) {
  return season.decisivePicks ? `${season.correctPicks}–${season.decisivePicks - season.correctPicks}` : '—';
}
function historicalPredictability(replay, season) {
  const { week, previousWeek } = replay;
  const delta = completeReplayChange(replay);
  const prior = previousWeek?.availablePicks ? `vs ${weekLabel(previousWeek)} replay` : '';
  const changeDetail = Number.isFinite(delta) ? `${prior} · ${predictabilitySample(previousWeek)}` :
    prior ? `${prior} · needs complete results and a winner pick in both weeks` : 'No replay forecasts for the previous week';
  return `<p class="predictability-mode">Historical replay</p>
    <dl class="predictability-grid">
      ${predictabilityMetric(`${weekLabel(week)} replay accuracy`, scoreAccuracy(week.accuracy), predictabilitySample(week))}
      ${predictabilityMetric('Change from previous replay week', Number.isFinite(delta) ? scoreChange(delta) : '—', changeDetail)}
      ${predictabilityMetric('Replay Brier score', number(week.brier, 3), 'Lower is better. Confident misses cost more.')}
    </dl>
    <p class="compact-note">${predictabilityCoverage(week, 'replay forecasts')} Replay forecasts are reconstructed using results available before each week.</p>
    <p class="compact-note"><strong>Saved-pick season record</strong> · ${season.decisivePicks ? savedSeasonRecord(season) : 'Awaiting decided saved picks'}</p>`;
}
function predictabilityContent(picks) {
  if (!picks.scoring) {
    return `<p class="compact-note" role="status">${picks.scoringError ? 'The scorecard could not load. Game results are available below.' : 'Loading the saved-pick scores…'}</p>`;
  }
  const { week, previousWeek, season, comparison, replay } = picks.scoring(picks.data, picks.selectedWeek, picks.division);
  if (!week) return '<p class="compact-note">Scores are unavailable for this week.</p>';
  if (!week.availablePicks && replay?.week?.availablePicks) return historicalPredictability(replay, season);
  const previews = week.availablePicks ? 0 : picks.weeks.get(picks.selectedWeek).filter(game => weeklyPreviewEstimate(picks, game)).length;
  const weekDetail = week.availablePicks ? (week.pendingPicks === week.availablePicks ? 'Awaiting final scores' : predictabilitySample(week)) :
    previews ? `${previews} preview forecasts available` : 'No saved picks this week';
  const delta = comparison?.accuracyDifference;
  const changeDetail = Number.isFinite(delta) ? `vs ${weekLabel(previousWeek)} · ${predictabilitySample(previousWeek)} that week${week.pendingPicks || previousWeek.pendingPicks ? ' · provisional' : ''}` :
    previousWeek ? `vs ${weekLabel(previousWeek)} · needs a decided pick in both weeks` : 'No previous week on the schedule';
  const seasonDetail = season.decisivePicks ? `${predictabilitySample(season)} · ${scoreAccuracy(season.accuracy)} accuracy` : 'No decided saved picks this season';
  return `<p class="predictability-mode">Saved pregame picks</p><dl class="predictability-grid">
    ${predictabilityMetric(`${weekLabel(week)} accuracy`, scoreAccuracy(week.accuracy), weekDetail)}
    ${predictabilityMetric('Change from previous week', Number.isFinite(delta) ? scoreChange(delta) : '—', changeDetail)}
    ${predictabilityMetric('Season record', savedSeasonRecord(season), seasonDetail)}
  </dl>
  ${week.availablePicks ? `<p class="compact-note">${predictabilityCoverage(week, 'saved picks')}</p>` : ''}
  <p class="compact-note">Accuracy counts saved pregame picks that named a favorite and have a final winner.</p>
  ${Number.isFinite(season.brier) ? `<p class="compact-note"><strong>Brier score</strong>${Number.isFinite(week.brier) ? ` · Week ${number(week.brier, 3)}` : ''} · Season ${number(season.brier, 3)}</p>` : ''}
  ${replay ? replayPredictability(replay) : ''}
  ${Number.isFinite(season.brier) || Number.isFinite(replay?.week?.brier) ? '<p class="compact-note">Lower Brier scores are better. Confident misses cost more.</p>' : ''}`;
}
function weeklyResults(picks) {
  const games = picks.weeks.get(picks.selectedWeek);
  const allRows = games.map(game => weeklyPicksGame(picks, game));
  const favoriteIds = myTeamsStore?.getMyTeamIds() ?? [];
  const filterTeams = new Map([...picks.teams].map(([id,team]) => [id,{ ...team,...rankedTeam(id) }]));
  const filteredGames = gameFilterModule ? gameFilterModule.filterGames(games,picks.filters,{ teams: filterTeams, myTeamIds: favoriteIds }) : games;
  const rows = filteredGames.map(game => weeklyPicksGame(picks, game));
  const correct = allRows.filter(row => row.grade === 'Correct').length;
  const missed = allRows.filter(row => row.grade === 'Missed').length;
  const record = correct + missed ? `${correct} correct · ${missed} missed` : 'No saved picks graded this week';
  return `<section class="predictability" aria-labelledby="predictability-title">
    <h3 id="predictability-title">Predictability score</h3><div id="predictability-content">${predictabilityContent(picks)}</div>
    </section><p><a class="text-link" href="${routeHref(`model-report/${picks.division}/${encodeURIComponent(picks.selectedWeek)}`)}">Open the full Model Report Card ${icon('arrow')}</a></p>
    ${gameFilterModule?.gameFilterControls({ filters: picks.filters, games, teams:filterTeams,myTeamIds:favoriteIds,rankLabel:`${picks.division.toUpperCase()} SOR`,idPrefix:'weekly' }) ?? ''}
    <p class="weekly-record">${rows.length} of ${games.length} ${games.length === 1 ? 'game' : 'games'} shown · ${record}</p>
    ${rows.length ? `<ul class="weekly-list" aria-label="Games for ${esc(weekLabel(games[0]))}">${rows.map(row => row.html).join('')}</ul>` : '<p class="empty" role="status">No games match these filters.</p>'}`;
}
function fcsForecastValidation({ firstSeason, lastSeason, games, picked, correct, accuracy, brier, nearSeventy }) {
  const seasons = firstSeason === lastSeason ? firstSeason : `${firstSeason}–${lastSeason}`;
  return `<details class="weekly-validation"><summary>FCS forecast validation</summary>
    <p class="compact-note">Historical replay covered ${games.toLocaleString()} games in ${seasons}. The model picked ${correct.toLocaleString()} of ${picked.toLocaleString()} winners correctly (${scoreAccuracy(accuracy)}), with a Brier score of ${number(brier, 3)}.</p>
    <p class="compact-note">In ${nearSeventy.games.toLocaleString()} games with favorites near 70%, the average forecast was ${scoreAccuracy(nearSeventy.meanForecast)} and those favorites won ${scoreAccuracy(nearSeventy.actualWinRate)} of the time.</p></details>`;
}
function renderWeeklyPicks(picks) {
  const requestedWeek = route()[picks.division === 'fcs' ? 3 : 2];
  if (picks.weeks?.has(requestedWeek)) picks.selectedWeek = requestedWeek;
  const { status, data, weeks, selectedWeek, division } = picks;
  const fcs = division === 'fcs';
  const label = division.toUpperCase();
  const group = `<nav class="matchup-views weekly-division-nav" aria-label="Weekly Picks divisions">
    <a href="/weekly-picks"${fcs ? '' : ' aria-current="page"'}>FBS</a>
    <a href="/weekly-picks/fcs/"${fcs ? ' aria-current="page"' : ''}>FCS</a></nav>`;
  let body;
  if (status === 'ready') {
    const cutoff = Number.isFinite(picksTime(data.source?.scheduleAsOf)) ? data.source.scheduleAsOf : data.asOf;
    const provider = data.source?.provider === 'cfbd' ? 'CollegeFootballData' : data.source?.provider === 'sportsdataverse' ? 'sportsdataverse' : '';
    body = `<p class="compact-note">Published schedule and results${provider ? ` from ${provider}` : ''} as of <time datetime="${esc(cutoff)}">${picksTimestamp.format(picksTime(cutoff))} MT</time>.${data.source?.extraScoreProvider === 'ESPN' ? ' Some final scores are from ESPN.' : ''} <a href="/scoreboard">Live Scoreboard</a> may be newer; this page grades saved picks after published results refresh.</p>
      <p class="compact-note">${fcs
        ? 'Predictive Strength picks cover games between two FCS teams. The record grades picks saved before kickoff. Historical replays appear separately.'
        : 'Predictive Strength picks cover FBS–FBS and FBS–FCS games. FBS–FCS win chances are uncalibrated estimates. Each refresh can save picks up to seven days ahead. The record grades picks saved before kickoff. Historical replays and preview odds are separate.'}</p>
      ${fcs ? fcsForecastValidation(data.source.validation) : ''}
      ${weeks.size ? `<div class="weekly-controls"><label for="weekly-week">Select week</label><select id="weekly-week">${[...weeks].map(([key, games]) =>
        `<option value="${esc(key)}"${key === selectedWeek ? ' selected' : ''}>${esc(weekLabel(games[0]))}</option>`).join('')}</select></div>
        <div id="weekly-results">${weeklyResults(picks)}</div>` : '<p class="compact-note">No games in the saved schedule.</p>'}`;
  } else {
    body = `<p class="compact-note" role="status">${status === 'loading' ? `Loading ${label} weekly picks…` :
      status === 'missing' ? (fcs ? 'FCS forecasts passed historical testing. The first saved schedule and picks for games between FCS teams will appear after a normal results refresh.'
        : 'Weekly picks will appear when the first schedule is published.') :
        `The saved ${label} weekly picks could not load. Refresh to try again.`}</p>`;
  }
  main.innerHTML = `${banner('Matchup lab · Predictive Strength', 'WEEKLY PICKS', 'See the model’s win chances for scheduled games and how its saved picks did once the scores were final.')}
    <div class="wrap page-content">${matchupNav('weekly')}<section class="panel weekly-picks" aria-labelledby="weekly-picks-title">
    <div class="panel-body"><h2 id="weekly-picks-title">${state.snapshot.season} ${label} schedule and picks</h2>${group}${body}</div></section></div>`;
  if (status === 'loading') picks.request ??= loadWeeklyPicks(picks);
  if (status === 'ready') focusLinkedGame('weekly-game-', route()[fcs ? 4 : 3]);
}
function matchupToken(a, b, venue) { return `compare/matchup/${a}/${b}/${venue}`; }
function matchupLabHref(a, b, venue) { return routeHref(matchupToken(a, b, venue)); }
function chooseMatchup() {
  navigate(matchupToken(state.compareA, state.compareB, state.venue), { replace: true, render: false });
  renderCompare();
}
function selectMatchupTeam(side, id) {
  if (!rankedTeam(id)) return;
  const selected = side === 'a' ? 'compareA' : 'compareB';
  const other = side === 'a' ? 'compareB' : 'compareA';
  state[selected] = id;
  if (state[other] === id) state[other] = '';
  chooseMatchup();
  main.querySelector(`#compare-${side === 'a' ? 'b' : 'a'}`)?.focus?.({ preventScroll: true });
}
function invalidMatchup() {
  const same = state.compareA && state.compareA === state.compareB;
  const message = same ? 'Choose a different opponent. A team cannot play itself.' : 'Choose two different teams to calculate a matchup.';
  main.innerHTML = `${banner('Matchup lab','CHOOSE YOUR MATCHUP.','Compare two different teams using the published Predictive Strength ratings.')}<div class="wrap page-content">${matchupNav('compare')}
    <p class="notice" role="status">${message}</p><div class="compare-layout">${['a','b'].map((side,index) =>
      `<section class="panel compare-picker"><label for="compare-${side}">Team ${index ? 'B' : 'A'}</label><select id="compare-${side}">${compareOptions(state[index ? 'compareB' : 'compareA'],state[index ? 'compareA' : 'compareB'])}</select></section>`).join('')}</div></div>`;
}
function renderCompare() {
  const picks = activeWeeklyPicks();
  if (picks) return renderWeeklyPicks(picks);
  const playerDetailsOpen = main.querySelector('[data-matchup-players]')?.open === true;
  const result = compareResult();
  if (!result) return invalidMatchup();
  const {a,b,edge,probability,validation,fbs,fcs}=result;
  const oddsLabel = oddsDescription(Math.max(probability, 1 - probability));
  const matchup = validation;
  const explanation = matchup
    ? fcs ? 'FCS win probabilities use the calibration already approved for FCS Weekly Picks and tested on later FCS seasons. Negative margins favor Team B.'
      : 'Win probabilities were calibrated on past results. The historical margin range describes how far final scores varied from this estimate in a later test. Negative margins favor Team B.'
    : `${fbs || fcs ? '' : 'This FBS–FCS matchup uses the experimental cross-division estimate. '}These probabilities have not been calibrated${fbs || fcs ? '' : ' for FBS–FCS games'}. The margin is fitted from bounded historical score differences and should not be treated as a betting spread.`;
  const playersPanel = `<details class="panel player-fold matchup-players" data-matchup-players${playerDetailsOpen ? ' open' : ''}>
    <summary>Players to know</summary><div class="panel-body" data-matchup-player-content><p role="status">Loading player information…</p></div></details>`;
  const share = a.id !== b.id ? shareCardButton({
    teams: [[a, probability], [b, 1 - probability]].map(([team, probability]) => ({ ...shareTeamData(team), probability })),
    asOf: state.snapshot.asOf, href: matchupLabHref(a.id, b.id, state.venue),
    venue: state.venue === 'neutral' ? 'Neutral field' : `At ${state.venue === 'home' ? a.name : b.name}`,
    forecastLabel: 'Matchup Lab estimate',
  }) : '';
  main.innerHTML=`${banner('Matchup lab · Experimental strength model','CHANGE THE MATCHUP. FOLLOW THE NUMBERS.','Compare two teams using our own historical and opponent-adjusted strength ratings.')}<div class="wrap page-content">${matchupNav('compare')}<div class="segmented compare-venue" aria-label="Game location">${[['neutral','Neutral field'],['home','Team A at home'],['away','Team B at home']].map(([v,label])=>`<button data-action="venue" data-value="${v}" class="${state.venue===v?'active':''}" aria-pressed="${state.venue===v}">${label}</button>`).join('')}</div><div class="compare-layout">${[a,b].map((t,i)=>`<section class="panel compare-picker"><div class="section-label">TEAM ${i?'B':'A'}</div>${logo(t,'large')}<h2>${esc(t.name)}</h2><p>${record(t)} · ${rank(nationalRank(t))} ${achievementName()}</p><label><span class="sr-only">Team ${i?'B':'A'}</span><select id="compare-${i?'b':'a'}">${compareOptions(t.id,i ? a.id : b.id)}</select></label><p style="margin-top:14px">Strength <strong>${number(t.strength,2)} pts</strong> · ${rank(strengthRank(t))}</p></section>`).join('')}<section class="panel prediction-card"><div class="eyebrow">${matchup ? 'Historically calibrated odds' : 'Experimental model estimate'}</div><h2>${esc(edge>=0?a.name:b.name)} edge</h2><div class="prediction-number">${number(Math.abs(edge),1)}<span style="font-size:27px"> pts</span></div><p>Bounded-model margin estimate</p><div class="probability-track"><span style="width:${probability*100}%"></span></div><p>${esc(a.name)} ${number(probability*100,1)}% &nbsp; · &nbsp; ${esc(b.name)} ${number((1-probability)*100,1)}%${oddsLabel ? ` · <span class="prediction-odds-description">${oddsLabel}</span>` : ''}</p>${matchupMarginRange(a,b,edge)}${share ? `<div class="matchup-actions">${share}</div>` : ''}</section></div><div class="notice"><strong>Reading the matchup.</strong> ${explanation} <a class="text-link" href="/methodology/">See what we checked</a></div>${playersPanel}</div>`;
  const disclosure = main.querySelector('[data-matchup-players]');
  if (!disclosure?.isConnected) return;
  const target = disclosure.querySelector('[data-matchup-player-content]');
  const openPlayers = () => {
    if (!disclosure.open) return;
    disclosure.removeEventListener('toggle', openPlayers);
    const season = state.snapshot.season;
    mountPlayerFeature(target, ({ mountMatchupPlayerView }) => mountMatchupPlayerView(target, {
      teams: [a, b], season, urlFor: playerPublicationPath,
    }));
  };
  disclosure.addEventListener('toggle', openPlayers);
  openPlayers();
}
function editionDate(date) {
  return editionDates.format(new Date(date));
}
function editionLabel(week) {
  return week === -1 ? 'Preseason' : `After Week ${week}`;
}
function editionPicker(weeks, activeWeek) {
  return `<label class="edition-picker">Game week <select id="edition-week">${weeks.map(week =>
    `<option value="${week}"${week === activeWeek ? ' selected' : ''}>${editionLabel(week)}</option>`).join('')}</select></label>`;
}
function editionRankMap(edition) {
  return new Map(edition?.rows.map((row, index) => [row.team, { rank: index + 1, ...row }]));
}
function editionTeamLink(name, teams) {
  const team = teams.get(name);
  return team ? teamLink(team) : esc(name);
}
function forgeBallotHref(week, through) {
  return routeHref(`forge-top-25/${week}${through ? `/${through}` : ''}`);
}
function pollRankCell(column, position, teams) {
  const ranked = column.filter(row => row.rank === position);
  return `<td>${ranked.map(row =>
    `<div class="poll-ranked-team">${editionTeamLink(row.team, teams)}<small>${esc(row.record)}</small></div>`
  ).join('') || '—'}</td>`;
}
function renderPollComparison(data, sourceKey, requestedWeek) {
  const key = Object.hasOwn(pollSources, sourceKey) ? sourceKey : 'ap';
  const source = pollSources[key];
  const sourceEditions = data.polls[key];
  const replays = data.sorReplays ?? [];
  const checkpoints = data.sorCheckpoints ?? [];
  const weeks = [...new Set([
    ...data.sor.map(edition => edition.week),
    ...checkpoints.map(edition => edition.week),
    ...replays.map(edition => edition.week),
    ...Object.values(data.polls).flatMap(editions => editions.map(edition => edition.week))
  ])].sort((a, b) => b - a);
  const parsedWeek = Number(requestedWeek);
  const latestSource = sourceEditions.at(-1);
  const week = weeks.includes(parsedWeek) ? parsedWeek : latestSource?.week ?? weeks[0];
  const poll = sourceEditions.find(edition => edition.week === week);
  const weekSor = data.sor.find(edition => edition.week === week);
  const weekReplay = replays.find(edition => edition.week === week);
  const weekCheckpoints = checkpoints.filter(edition => edition.week === week);
  const latestSor = data.sor.at(-1);
  const weekForge = data.forge.find(edition => edition.week === week);
  const candidateCutoff = (poll ?? weekSor ?? weekReplay ?? weekCheckpoints.at(-1) ?? weekForge)?.gamesThrough;
  const gamesThrough = typeof candidateCutoff === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidateCutoff) ? candidateCutoff : null;
  const checkpoint = gamesThrough ? weekCheckpoints.find(edition => edition.gamesThrough === gamesThrough) : undefined;
  const official = gamesThrough && weekSor?.gamesThrough === gamesThrough ? weekSor : checkpoint;
  const replay = gamesThrough && !official && weekReplay?.gamesThrough === gamesThrough ? weekReplay : undefined;
  const sor = official ?? replay;
  const savedCheckpoint = Boolean(official && official === checkpoint);
  const sorLabel = replay ? 'SOR replay' : savedCheckpoint ? 'SOR checkpoint' : 'SOR';
  const matchingForgeCheckpoint = key === 'coaches' && poll && gamesThrough
    ? data.forgeCheckpoints?.find(edition => edition.week === week && edition.gamesThrough === gamesThrough) : undefined;
  const forge = gamesThrough && weekForge?.gamesThrough === gamesThrough ? weekForge : matchingForgeCheckpoint;
  const usesForgeCheckpoint = Boolean(forge && forge === matchingForgeCheckpoint);
  const separateForgeBallot = weekForge && !forge && typeof weekForge.gamesThrough === 'string';
  const teams = new Map(state.snapshot.rankings.map(team => [team.name, team]));
  const columns = [sor, forge, poll].map(edition => [...editionRankMap(edition).values()]
    .filter(row => Number.isInteger(row.rank) && row.rank >= 1 && row.rank <= 25));
  const shared = (left, right) => left.filter(row => right.some(other => other.team === row.team)).length;
  const editionLink = poll
    ? `<a class="text-link" href="${esc(poll.url)}">Read the ${source.name} edition ${icon('external')}</a>`
    : `<a class="text-link" href="${source.url}">Open ${source.name} ${icon('external')}</a>`;
  const tabs = `<nav class="matchup-views edition-tabs" aria-label="Poll source">${Object.entries(pollSources)
    .map(([id, item]) => `<a href="${routeHref(`polls/${id}/${week}`)}"${id === key ? ' aria-current="page"' : ''}>${item.name}</a>`).join('')}</nav>`;
  const summary = [
    poll && sor ? `${shared(columns[0], columns[2])} of 25 shared by ${sorLabel} and ${source.short}` : '',
    poll && forge ? `${shared(columns[1], columns[2])} of 25 shared by Forge and ${source.short}` : '',
    sor && forge && !poll ? `${shared(columns[0], columns[1])} of 25 shared by SOR and Forge` : '',
    !sor ? poll && !gamesThrough ? 'SOR comparison unavailable: this poll’s exact game cutoff is unverified' : 'No matching published SOR snapshot' : '',
    !poll ? `${source.name} edition unavailable for this week` : ''
  ].filter(Boolean);
  const rows = Array.from({ length: 25 }, (_, index) => {
    const position = index + 1;
    return `<tr><th scope="row">${position}</th>${columns.map(column => pollRankCell(column, position, teams)).join('')}</tr>`;
  }).join('');
  return `<section class="panel edition-panel"><div class="panel-body">
    ${tabs}<div class="edition-controls">${editionPicker(weeks, week)}${editionLink}</div>
    <h2>${editionLabel(week)}</h2><p>${gamesThrough ? `Games through ${editionDate(gamesThrough)}.` : 'The poll’s exact game cutoff has not been verified.'}${poll ? ` ${source.name} released ${editionDate(poll.released)}.` : ''}${official ? ` SOR published ${editionDate(official.released)}.` : ''}${forge ? ` Forge ballot reconstructed ${editionDate(forge.released)}.` : ''}</p>
    ${separateForgeBallot ? `<p class="compact-note edition-context">Forge’s ballot covers games through ${editionDate(weekForge.gamesThrough)}. ${poll && gamesThrough ? `The ${source.name} covers games through ${editionDate(gamesThrough)}. ` : ''}The table only compares editions with matching cutoffs. <a class="text-link" href="${forgeBallotHref(week)}">View Forge’s ballot for this week ${icon('arrow')}</a></p>` : ''}
    ${savedCheckpoint ? '<p class="compact-note edition-context">This saved SOR checkpoint covers games through the same date as the poll. The full week includes later games.</p>' : ''}
    ${usesForgeCheckpoint ? '<p class="compact-note edition-context">Forge’s cutoff ballot was reconstructed using only games through the Coaches Poll cutoff shown above.</p>' : ''}
    ${replay ? `<p class="compact-note edition-context">SOR replay calculated ${editionDate(replay.released)} using the published SOR formula and ${replay.networkGames.toLocaleString()} confirmed games through this cutoff. That includes ${replay.fbsGames.toLocaleString()} games involving FBS teams.</p>` : ''}
    ${summary.length ? `<p class="edition-notice">${summary.join(' · ')}.</p>` : ''}
    ${!poll && latestSource ? `<a class="text-link" href="${routeHref(`polls/${key}/${latestSource.week}`)}">View the ${editionDate(latestSource.released)} edition ${icon('arrow')}</a>` : ''}
    ${!sor && latestSor && latestSor.week !== week ? `<a class="text-link" href="${routeHref(`polls/${key}/${latestSor.week}`)}">Compare SOR and Forge after Week ${latestSor.week} ${icon('arrow')}</a>` : ''}
    </div><div class="table-scroll"><table class="edition-table poll-rank-table">
    <caption class="sr-only">Ranking comparison for ${editionLabel(week)}</caption>
    <thead><tr><th scope="col">Rank</th><th scope="col">${sorLabel}</th><th scope="col">Forge</th><th scope="col">${source.short}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="panel-body"><p class="compact-note">Tied teams share a cell. A dash marks a skipped rank or an unavailable edition.</p>${forge ? `<a class="text-link edition-ballot-link" href="${forgeBallotHref(week, usesForgeCheckpoint ? forge.gamesThrough : undefined)}">${usesForgeCheckpoint ? 'View Forge’s cutoff ballot' : 'Forge’s full ballot for this week'} ${icon('arrow')}</a>` : ''}</div>
    </section>`;
}
function renderForgeBallot(data, requestedWeek, through) {
  const week = Number(requestedWeek);
  const weekBallot = data.forge.find(item => item.week === week);
  const savedCutoff = through && data.forgeCheckpoints?.find(item => item.week === week && item.gamesThrough === through);
  const edition = through ? (weekBallot?.gamesThrough === through ? weekBallot : savedCutoff) : weekBallot ?? data.forge.at(-1);
  const weeks = data.forge.map(item => item.week).reverse();
  if (!edition) return `<section class="panel edition-panel"><div class="panel-body">
    <div class="edition-controls">${editionPicker(weeks, week)}</div>
    <p role="status">No Forge ballot is available for this game cutoff.</p>
    ${weekBallot ? `<a class="text-link" href="${forgeBallotHref(week)}">View the full weekly ballot ${icon('arrow')}</a>` : ''}</div></section>`;
  const cutoffBallot = Boolean(savedCutoff && edition === savedCutoff);
  const alternateBallots = (data.forgeCheckpoints ?? []).filter(item => item.week === edition.week && item.gamesThrough !== edition.gamesThrough);
  const editionTitle = cutoffBallot ? `Week ${edition.week} cutoff ballot` : editionLabel(edition.week);
  const editionLinks = [
    cutoffBallot && weekBallot ? `<a class="text-link" href="${forgeBallotHref(edition.week)}">View the full weekly ballot ${icon('arrow')}</a>` : '',
    ...alternateBallots.map(item => `<a class="text-link" href="${forgeBallotHref(item.week, item.gamesThrough)}">View ballot through ${editionDate(item.gamesThrough)} ${icon('arrow')}</a>`),
  ].join('');
  const previous = editionRankMap(data.forge.find(item => item.week === edition.week - 1));
  const teams = new Map(state.snapshot.rankings.map(team => [team.name, team]));
  const rows = edition.rows.map((row, index) => {
    const position = index + 1;
    const prior = previous.get(row.team);
    const change = prior ? prior.rank - position : 0;
    const movement = !prior ? 'In' : change > 0 ? `↑${change}` : change < 0 ? `↓${-change}` : '—';
    const detail = !prior ? 'Entered the Top 25' : change ? `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}` : 'Same rank';
    return `<tr><td class="num">${position}</td><td>${editionTeamLink(row.team, teams)}${row.game ? `<small>${esc(row.game)}</small>` : ''}</td><td class="num">${esc(row.record)}</td>${edition.week >= 0 ? `<td class="num" aria-label="${detail}">${movement}</td>` : ''}</tr>`;
  }).join('');
  return `<section class="panel edition-panel"><div class="panel-body">
    <div class="edition-controls">${editionPicker(weeks, edition.week)}${editionLinks}</div>
    <h2>${editionTitle}</h2><p>${edition.week < 0 ? 'Preseason context as of' : 'Games through'} ${editionDate(edition.gamesThrough)}. Retrospective ballot reconstructed ${editionDate(edition.released)}.</p>
    ${cutoffBallot ? '<p class="compact-note edition-context">This ballot uses only games through the date shown. Rank movement is measured from the previous week’s full ballot.</p>' : ''}
    ${edition.week === -1 ? '<p class="compact-note edition-context">Forge used 2025 results, roster and coaching context, and preseason AP and Coaches polls as background.</p>' : ''}
    ${edition.notes?.length ? `<ul class="edition-notice">${edition.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}
    </div><div class="table-scroll"><table class="edition-table">
    <caption class="sr-only">Forge’s Top 25 for ${editionTitle}</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col">${edition.week === -1 ? '2025 record' : 'Record'}</th>${edition.week >= 0 ? '<th scope="col">Move</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody></table></div></section>`;
}
async function loadRankingEditions() {
  try {
    const response = await fetch('/ranking-editions.json');
    if (!response.ok) throw Error(`Ranking archive returned ${response.status}`);
    const data = await response.json();
    rankingEditions.cfpRanks = editionRankMap(data.polls?.cfp?.at(-1));
    rankingEditions.data = data;
  } catch (error) {
    rankingEditions.failed = true;
    console.error(error);
  } finally {
    rankingEditions.request = null;
    if (['polls', 'forge-top-25'].includes(route()[0])) render();
    if (route()[0] === 'scoreboard') scoreboardPage?.updateRankings();
  }
}
function renderRankingEditions(page, id, scope) {
  const comparing = page === 'polls';
  const [title, description] = comparing
    ? ['Compare Rankings', 'Compare FBS Strength of Record and Forge’s AI-authored ballot with AP, Coaches, and CFP editions covering the same games.']
    : ['Forge’s Top 25', 'An AI-authored FBS ballot based on game results, opponent quality, scoring margins, and venue.'];
  const heading = `<div class="rankings-view-heading"><h2>${title}</h2><p>${description}</p></div>`;
  const { data, failed } = rankingEditions;
  const content = data ? (comparing ? renderPollComparison(data, id, scope) : renderForgeBallot(data, id, scope))
    : `<section class="panel"><div class="panel-body"><p role="status">${failed ? 'The ranking archive is unavailable.' : 'Loading ranking editions…'}</p>${failed ? '<button class="button light small" data-action="retry-editions">Try again</button>' : ''}</div></section>`;
  renderRankingsHub(page, [page, id, scope].join('/'), heading + content);
  if (!data && !failed) rankingEditions.request ??= loadRankingEditions();
}
function renderBracketPage() {
  if (!bracketModule) {
    main.innerHTML = '<div class="wrap page-content"><p role="status">Loading the playoff bracket…</p></div>';
    bracketModule = import('./bracket.js?v=header-account');
  }
  bracketModule.then(({ renderBracket, unmountBracket }) => {
    if (route()[0] !== 'bracket') return;
    closeBracket = unmountBracket;
    const teams = new Map(state.snapshot.rankings.map(team => [team.name, team.id]));
    return renderBracket(main, teams);
  }).catch(error => {
    if (route()[0] === 'bracket') main.innerHTML = '<div class="wrap page-content"><p role="status">The playoff bracket could not load. Refresh to try again.</p></div>';
    console.error(error);
  });
}
function renderScenarioPage() {
  main.innerHTML = '<div class="wrap page-content"><p role="status">Loading the CFP Scenario Builder…</p></div>';
  scenarioModule ??= import('./cfp-scenario.js?v=2');
  scenarioModule.then(({ renderCfpScenario, unmountCfpScenario }) => {
    if (route()[0] !== 'cfp-scenarios') return;
    closeScenario = unmountCfpScenario;
    return renderCfpScenario(main, {
      snapshot: state.snapshot,
      inputUrl: publicationPath('cfp-scenarios'),
      workerUrl: '/cfp-scenario-worker.js?v=1',
    });
  }).catch(error => {
    if (route()[0] === 'cfp-scenarios') main.innerHTML = '<div class="wrap page-content"><p role="status">The CFP Scenario Builder could not load. Refresh to try again.</p></div>';
    console.error(error);
  });
}
function renderContestPage() {
  closeContest?.();
  closeContest = undefined;
  main.innerHTML = '<div class="wrap page-content"><p role="status">Loading Beat the Model…</p></div>';
  contestModule ??= import('./weekly-contest.js?v=accuracy-20261118');
  contestModule.then(({ renderWeeklyContest, unmountWeeklyContest }) => {
    if (route()[0] !== 'beat-the-model') return;
    closeContest = unmountWeeklyContest;
    return renderWeeklyContest(main, {
      teams: state.byId, statsUrl: publicationPath('weekly-team-stats'), season: state.snapshot.season,
      preview: localPreview?.contest, describeOdds: oddsDescription,
      requestedWeek: conferenceId(route()[1]), gameId: route()[2],
    });
  }).catch(error => {
    if (route()[0] === 'beat-the-model') main.innerHTML = '<div class="wrap page-content"><p role="status">Beat the Model could not load. Please reload this page to try again.</p></div>';
    console.error(error);
  });
}
function renderHistoryPage(week) {
  main.innerHTML = '<div class="wrap page-content"><p role="status">Loading weekly SOR history…</p></div>';
  historyModule ??= import('./ranking-history.js?v=1');
  historyModule.then(({ renderRankingHistory, unmountRankingHistory }) => {
    if (route()[0] !== 'ranking-history') return;
    closeHistory = unmountRankingHistory;
    return renderRankingHistory(main, { week });
  }).catch(error => {
    if (route()[0] === 'ranking-history') main.innerHTML = '<div class="wrap page-content"><p role="status">Weekly SOR history could not load. Please reload this page to try again.</p></div>';
    console.error(error);
  });
}
function renderConnectedFeature(page, id, scope) {
  const features = {
    'my-teams': ['My Teams', 'Follow your teams, their next games, results, and ranking evidence.', 'my-teams.js', 'mountMyTeams'],
    'sor-compare': ['Compare earned rankings', 'Why does one team rank above another? Compare their records and schedules.', 'sor-compare.js', 'mountSorComparison'],
    'model-report': ['Model Report Card', 'See how the model’s saved predictions performed after the games were played.', 'model-report.js', 'mountModelReport'],
    about: ['About The Games Decide', 'Independent college football intelligence with calculations you can inspect.', 'platform-info.js', 'mountPlatformInfo'],
    privacy: ['Privacy and accounts', 'Understand what your account saves and what visitors can see.', 'platform-info.js', 'mountPlatformInfo'],
    terms: ['Terms of use', 'How public data and contests work on The Games Decide.', 'platform-info.js', 'mountPlatformInfo'],
    support: ['Support and data discrepancies', 'Find help or report a result that needs checking.', 'platform-info.js', 'mountPlatformInfo'],
    account: ['Account settings', 'Manage your sign-in, public profile, saved teams and private requests.', 'account-center.js', 'mountAccountCenter'],
    admin: ['Administration', 'Secure account and support management.', 'account-administration.js', 'mountAdministration'],
  };
  const [title,description,file,mountName] = features[page];
  main.innerHTML = `${['account','admin','about','privacy','terms','support'].includes(page)?'':banner('The Games Decide',title,description)}<div class="wrap page-content" data-connected-feature><p role="status">Loading ${esc(title)}…</p></div>`;
  const target = main.querySelector('[data-connected-feature]');
  if (!target?.isConnected) return;
  const lifecycle = { target, close: null };
  mountedFeature = lifecycle;
  if (!featureRequests.has(file)) featureRequests.set(file, import(`./${file}?v=1`).catch(error => { featureRequests.delete(file); throw error; }));
  featureRequests.get(file).then(module => {
    if (mountedFeature !== lifecycle || !target.isConnected) return;
    const division = id === 'fcs' ? 'fcs' : 'fbs';
    let options;
    if (page === 'my-teams') {
      options = { teams: new Map([...state.byId,...state.byFcsId]), chosenTeamId: rankedTeam(id)?.id,
        movement: state.snapshot.rankingMovement,
        async loadTeamDetails(teamId) {
          const team = rankedTeam(teamId);
          if (!team) return null;
          if (state.snapshot.teamDetailsPath) await loadTeamDetails(team);
          return teamDetails.get(teamId)?.team ?? team;
        },
        async loadAvailability(teamId) {
          const team = rankedTeam(teamId);
          if (!team) return null;
          teamPlayersModule ??= import('./team-players.js?v=1');
          return (await teamPlayersModule).fetchPlayerData('team-availability',team,state.snapshot.season,playerPublicationPath('team-availability',team));
        },
      };
    } else if (page === 'sor-compare') {
      const [, ,a,b] = route();
      options = { snapshot:state.snapshot, dataRoot, division, a, b,
        onNavigate(next) { navigate(`sor-compare/${next.division || division}/${next.a ?? ''}/${next.b ?? ''}`); } };
    } else if (page === 'model-report') options = { dataRoot, division, week: conferenceId(scope) };
    else options = { page };
    lifecycle.close = module[mountName](target,options);
  }).catch(() => {
    if (mountedFeature === lifecycle && target.isConnected) target.innerHTML = '<p class="empty" role="status">This page could not load. Reload to try again.</p>';
  });
}
function renderScoreboardPage() {
  if (!rankingEditions.data && !rankingEditions.failed) rankingEditions.request ??= loadRankingEditions();
  if (main.querySelector('[data-scoreboard]')) {
    scoreboardPage?.updateRankings();
    return;
  }
  main.innerHTML = banner('FBS game day', 'Live Scoreboard', 'Kickoff times, live scores and final results. Refreshes every 15 seconds.') +
    '<div class="wrap page-content" data-scoreboard><p role="status">Loading the scoreboard…</p></div>';
  const target = main.querySelector('[data-scoreboard]');
  scoreboardModule ??= import('./scoreboard.js?v=platform-review');
  scoreboardModule.then(({ mountScoreboard }) => {
    if (route()[0] !== 'scoreboard' || !target.isConnected) return;
    scoreboardPage = mountScoreboard(target, (teamId, season) => {
      if (String(rankingEditions.data?.season) !== season || String(state.snapshot?.season) !== season) return;
      const team = state.byId.get(teamId);
      return rankingEditions.cfpRanks.get(team?.name)?.rank;
    }, { getTeams: () => new Map([...state.byId,...state.byFcsId]), getPublication: () => state.snapshot });
  }).catch(error => {
    if (target.isConnected) target.innerHTML = '<p role="status">The scoreboard could not load. Please reload this page to try again.</p>';
    console.error(error);
  });
}
function renderRankingsStatus() {
  main.innerHTML = rankingsFailed
    ? `<section class="loading"><h1>The rankings are taking a moment.</h1><p>${dataRoot?'The published data could not load. Please try again shortly.':'The free service may be waking up. Please try again shortly.'}</p><button id="retry" class="button">Try again</button></section>`
    : '<div class="loading"><span class="loader"></span><h1>Building the picture.</h1><p>Loading our latest published rankings…</p></div>';
  document.querySelector('#retry')?.addEventListener('click', load);
}
function render() {
  const [page,id,scope]=route();
  if (mountedFeature) {
    mountedFeature.close?.();
    mountedFeature = undefined;
  }
  if (page !== 'home' && closeFavorite) {
    closeFavorite();
    closeFavorite = null;
  }
  if (!isRankingsHub(page) && rankingsHubView) {
    rankingsHubView.animation?.cancel();
    rankingsHubView.unmount?.();
    rankingsHubView = undefined;
  }
  if (page !== 'scoreboard' && scoreboardPage) {
    scoreboardPage.unmount();
    scoreboardPage = undefined;
  }
  if (page === 'scoreboard') {
    renderHeader();
    renderScoreboardPage();
    document.querySelector('#announce').textContent = document.title;
  }
  if (page !== 'bracket' && closeBracket) {
    closeBracket();
    closeBracket = undefined;
  }
  if (page !== 'cfp-scenarios' && closeScenario) {
    closeScenario();
    closeScenario = undefined;
  }
  if (page !== 'beat-the-model' && closeContest) {
    closeContest();
    closeContest = undefined;
  }
  if (page !== 'ranking-history' && closeHistory) {
    closeHistory();
    closeHistory = undefined;
  }
  if (page === 'scoreboard') return;
  if (page === 'not-found') {
    renderHeader();
    main.innerHTML = '<section class="wrap page-content"><h1>Page not found</h1><p>Check the address, or <a href="/">return to the homepage</a>.</p></section>';
    return;
  }
  if (!state.snapshot) { renderRankingsStatus(); return; }
  renderHeader();
  if (page === 'rankings') {
    const next = rankingsRoute();
    if (state.division !== next.division) {
      state.search = '';
      state.conference = '';
    }
    Object.assign(state, next);
  } else if (page === 'teams') {
    const division = id === 'fcs' ? 'fcs' : 'fbs';
    if (division !== state.division) {
      state.search = '';
      state.conference = '';
    }
    state.division = division;
  }
  if (page === 'team' && (scope === 'results' || scope === 'model' || playerTabs.has(scope))) state.teamTab = scope;
  if (page === 'compare' && id === 'matchup') {
    const [, , a, b, venue] = route();
    Object.assign(state, {
      compareA: rankedTeam(a) ? a : '',
      compareB: rankedTeam(b) ? b : '',
      venue: ['neutral', 'home', 'away'].includes(venue) ? venue : 'neutral',
    });
  }
  if(page==='home')renderHome();else if(page==='rankings')renderRankings();else if(page==='teams')renderTeams();else if(page==='team')renderTeam(id);else if(page==='methodology')renderMethodology();else if(page==='compare')renderCompare();else if (page === 'polls' || page === 'forge-top-25') renderRankingEditions(page,id,scope);else if (page === 'conference-strength') renderConferenceStrengthPage();else if (['my-teams','sor-compare','model-report','about','privacy','terms','support','account','admin'].includes(page)) renderConnectedFeature(page,id,scope);else if (page === 'bracket') renderBracketPage();else if (page === 'cfp-scenarios') renderScenarioPage();else if (page === 'beat-the-model') renderContestPage();else if (page === 'ranking-history') renderHistoryPage(id);else renderHome();
  document.querySelector('#announce').textContent=document.title;
}
document.addEventListener('error', event => {
  const image = event.target;
  const emblem = image instanceof HTMLImageElement && image.closest('.logo');
  if (!emblem) return;
  if (image.dataset.logoFallback) {
    const fallback = image.dataset.logoFallback;
    delete image.dataset.logoFallback;
    image.src = fallback;
  } else emblem.classList.add('failed');
}, true);
document.addEventListener('input',e=>{
  if(e.target.id==='team-search'){
    state.search=e.target.value;
    const rankings=document.querySelector('#ranking-results');if(rankings)rankings.innerHTML=rankingsContent();
    const teams=document.querySelector('#team-results');if(teams)teams.innerHTML=teamsContent();
  }
});
document.addEventListener('change',e=>{
  const activePicks = activeWeeklyPicks();
  const nextGameFilters = activePicks && gameFilterModule?.readGameFilterChange(activePicks.filters,e);
  if (nextGameFilters && activePicks.status === 'ready') {
    activePicks.filters = nextGameFilters;
    const focusId = e.target.id;
    document.querySelector('#weekly-results').innerHTML = weeklyResults(activePicks);
    if (focusId) document.querySelector(`#${focusId}`)?.focus?.({ preventScroll:true });
    return;
  }
  if (e.target.id === 'edition-week') {
    const [page, id] = route();
    const key = Object.hasOwn(pollSources, id) ? id : 'ap';
    navigate(page === 'polls' ? `polls/${key}/${e.target.value}` : `forge-top-25/${e.target.value}`);
  }
  if(e.target.id==='conference-filter'){state.conference=e.target.value;route()[0]==='teams'?renderTeams():renderRankings();}
  if(e.target.id==='compare-a') selectMatchupTeam('a', e.target.value);
  if(e.target.id==='compare-b') selectMatchupTeam('b', e.target.value);
  if (e.target.id === 'weekly-week') {
    const picks = activeWeeklyPicks();
    if (!picks?.weeks?.has(e.target.value)) return;
    picks.selectedWeek = e.target.value;
    const scope = picks.division === 'fcs' ? 'fcs/' : '';
    navigate(`compare/weekly/${scope}${e.target.value}`, { replace: true, render: false });
    document.querySelector('#weekly-results').innerHTML = weeklyResults(picks);
    document.querySelector('#announce').textContent = `${picks.division.toUpperCase()} ${weekLabel(picks.weeks.get(picks.selectedWeek)[0])} games shown`;
  }
});
document.addEventListener('click',e=>{
  const more = document.querySelector('.nav-more');
  if (more?.open) {
    const moreLink = e.target.closest('.nav-more-links a');
    if (moreLink || !more.contains(e.target)) more.open = false;
    if (moreLink?.href === location.href) more.querySelector('summary').focus();
    else if (moreLink && e.detail === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) focusMoreDestination = true;
  }
  if(e.target.closest('.skip-link')){e.preventDefault();main.focus();main.scrollIntoView();return;}
  const destination = internalNavigationTarget(e, location.href);
  if (destination) { e.preventDefault(); navigate(destination); return; }
  const button=e.target.closest('[data-action]');if(!button)return;
  const {action,value}=button.dataset;
  if (action === 'choose-my-team' && rankedTeam(value)) {
    navigate(`my-teams/${encodeURIComponent(value)}`);
  }
  if (action === 'retry-editions') {
    rankingEditions.failed = false;
    render();
  }
  if (action === 'model' && ['achievement', 'strength', 'performance'].includes(value)) {
    navigate(rankingRouteToken(value, state.all, state.division));
  }
  if (action === 'load-performance') {
    const [page, id] = route();
    performanceFailed = false;
    if (page === 'team') {
      void loadPerformance();
      updateTeamPerformance(id);
    } else if (page === 'rankings' && rankingsRoute().model === 'performance') renderRankings();
  }
  if (action === 'toggle-all') {
    state.search = '';
    state.conference = '';
    navigate(rankingRouteToken(state.model, !state.all, state.division));
  }
  if (action === 'team-tab') {
    state.teamTab = value;
    const [, id] = route();
    const view = value === 'overview' ? '' : `/${value}`;
    navigate(`team/${encodeURIComponent(id)}${view}`, { replace: true, render: false });
    renderTeam(id);
    if (button.classList?.contains('team-record-button')) main.querySelector('.tabs [data-value="results"]')?.focus();
  }
  if(action==='retry-team-details'){void load();}
  if(action==='venue' && ['neutral','home','away'].includes(value)){state.venue=value;chooseMatchup();}
  if(action==='compare-team' && rankedTeam(value)) {
    const team = rankedTeam(value);
    state.compareA = value;
    if (state.compareB === value || rankedTeam(state.compareB)?.division !== team.division) {
      state.compareB = divisionTeams(team.division).find(t => t.id !== value)?.id ?? '';
    }
    navigate(matchupToken(state.compareA, state.compareB, 'neutral'));
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const more = document.querySelector('.nav-more');
  if (!more?.open) return;
  more.open = false;
  more.querySelector('summary').focus();
});
if (!isAccountCallbackUrl(location.href)) replaceLegacyAppUrl(window);
let lastRoutedUrl = location.href;
function reroute({ previousUrl = lastRoutedUrl, render: renderPage = true, force = false } = {}) {
  if (!isAccountCallbackUrl(location.href)) replaceLegacyAppUrl(window);
  if (!force && location.href === lastRoutedUrl) return;
  lastRoutedUrl = location.href;
  if (!renderPage) return;
  focusedGameLink = null;
  state.teamTab = 'overview';
  render();
  if (focusMoreDestination) {
    focusMoreDestination = false;
    main.focus({ preventScroll: true });
  }
  const from = routeFromUrl(previousUrl)?.split('/')[0];
  if (!isRankingsHub(from) || !isRankingsHub(route()[0])) window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener(APP_NAVIGATION_EVENT, event => reroute(event.detail));
window.addEventListener('popstate', () => reroute());
window.addEventListener('hashchange', event => reroute({ previousUrl: event.oldURL }));
window.addEventListener(ACCOUNT_ROUTE_EVENT, () => reroute({ force: true }));
function loadFootballHelpers() {
  footballFormatRequest ??= Promise.all([
    import('./format.js?v=1').then(module => { footballFormat = module; }),
    import('./game-filters.js?v=1').then(module => { gameFilterModule = module; }),
    import('./my-teams-store.js?v=1').then(module => {
      myTeamsStore = module;
      favoriteSubscription ??= module.subscribeMyTeams(() => {
        const picks = activeWeeklyPicks();
        const result = document.querySelector('#weekly-results');
        if (picks?.status === 'ready' && result) result.innerHTML = weeklyResults(picks);
        if (route()[0] === 'teams') {
          const directory = document.querySelector('#team-results');
          if (directory) directory.innerHTML = teamsContent();
        }
      });
      void module.loadMyTeams().catch(() => {});
    }),
  ].map(request => request.catch(() => {})));
  return footballFormatRequest;
}
async function load(){
  rankingsFailed = false;
  try{
    const [response]=await Promise.all([
      fetch(publicationPath('rankings'),{headers:{Accept:'application/json'}}), loadGameActions(), loadFootballHelpers(),
    ]);
    if(!response.ok)throw Error(`Rankings returned ${response.status}`);
    const snapshot=await response.json();
    if(!snapshot.rankings?.length)throw Error('No published rankings');
    state.snapshot=snapshot;state.byId=new Map(snapshot.rankings.map(t=>[t.id,t]));
    state.byFcsId=new Map(divisionTeams('fcs').map(t=>[t.id,t]));
    teamDetails.clear();
    state.performance=null;state.performanceById=new Map();state.fcsPerformanceById=null;
    performanceLoading=false;performanceFailed=false;
    state.compareA=snapshot.rankings[0].id;state.compareB=snapshot.rankings[1].id;
    render();
  }catch(error){
    rankingsFailed = true;
    if (route()[0] !== 'scoreboard') renderRankingsStatus();
    console.error(error);
  }
}
if (route()[0] === 'scoreboard') render();
else renderHeader();
load();
void import('./searchable-team-select.js?v=1').then(({enhanceTeamSelectors})=>enhanceTeamSelectors(main)).catch(()=>{});
