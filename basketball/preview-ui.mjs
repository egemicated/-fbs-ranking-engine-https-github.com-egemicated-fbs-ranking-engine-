import { basketballPollRoutes, destination, groups, primarySection, sportHref } from './preview-navigation-routes.mjs';
import { pageHero, platformEmpty } from '../frontend/platform-presentation.js';
export { pageHero } from '../frontend/platform-presentation.js';

export const competition = Object.freeze({
  id: 'ncaam-d1', name: 'College Basketball', label: 'NCAA Division I · Men’s Basketball', entry: '/basketball/',
});
export const sports = Object.freeze([
  { id: 'football', name: 'Football', entry: '/football/' },
  { id: 'basketball', name: 'Basketball', entry: competition.entry },
]);
export const nav = [
  ['Home', ''], ['Rankings','rankings'], ['Teams','teams'], ['Scores','scoreboard'], ['Matchup Lab','matchup-lab'],
  ['Conferences','conferences'], ['Daily Picks','picks'], ['Model Report','model-reports'], ['Ranking History','ranking-history'],
  ['March Madness','march-madness'], ['Methodology','methodology'], ['Beat the Model','contest'],
];
export const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
export const seasonLabel = year => `${year - 1}–${String(year).slice(-2)}`;
export const mtDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric',
});
const mtTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
export const stamp = value => value && Number.isFinite(Date.parse(value))
  ? `${mtDate.format(new Date(value))} · ${mtTime.format(new Date(value))}` : 'Unavailable';
const mtDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', dateStyle: 'short' });
export const dayKey = value => mtDay.format(new Date(value));
export const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
export const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
export const ordinal = value => Number.isFinite(value) ? `#${value}` : '—';
export const teamRecord = team => team ? `${team.wins ?? 0}–${team.losses ?? 0}` : '—';
export function gameBoxScore(game) {
  const evidence = game.boxEvidence;
  const box = game.box;
  if (!evidence?.home || !evidence?.away) {
    if (!game.completed || !box?.home || !box?.away) return '';
    const stats = [['possessions','Possessions'],['fieldGoalsMade','Field goals made'],['fieldGoalsAttempted','Field goals attempted'],
      ['threePointsMade','3-pointers made'],['freeThrowsMade','Free throws made'],['offensiveRebounds','Off. rebounds'],
      ['defensiveRebounds','Def. rebounds'],['assists','Assists'],['turnovers','Turnovers'],['steals','Steals'],['blocks','Blocks'],['fouls','Fouls']];
    return `<details class="fc-box"><summary>Team box score</summary><dl>${stats.map(([key,label]) =>
      `<dt>${label}</dt><dd>${fmt(box.away[key],0)} / ${fmt(box.home[key],0)}</dd>`).join('')}</dl><small>Away / home</small></details>`;
  }
  const stats = [['shooting','Effective field goal %'],['reboundShare','Offensive rebound %'],['turnoverRate','Turnover rate']];
  return `<details class="fc-box"><summary>Team box-score evidence</summary><dl>${stats.map(([key,label]) =>
    `<dt>${label}</dt><dd>${pct(evidence.away[key])} / ${pct(evidence.home[key])}</dd>`).join('')}</dl><small>Away / home</small></details>`;
}
export const has = (row, value) => `${row?.name ?? ''} ${row?.mascot ?? ''} ${row?.conference ?? ''}`.toLocaleLowerCase()
  .includes(value.toLocaleLowerCase());
export const accent = team => /^#[0-9a-f]{6}$/i.test(team?.color) ? team.color : '#1689c1';
export function basketballHref(view = '', params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([,value]) => value !== undefined && value !== null && value !== ''));
  return `/basketball/${view ? view.replace(/\/$/, '') + '/' : ''}${query.size ? '?' + query : ''}`;
}
export function basketballRankingsNavigation(current, year) {
  const items = [
    ['rankings', 'Rankings', basketballHref('rankings', { season: year })],
    ['polls', 'Compare Rankings', basketballPollRoutes.ap],
  ];
  return `<nav class="rankings-hub-nav rankings-hub-nav--pair" aria-label="Ranking views">${items.map(([id, label, href]) =>
    `<a href="${escape(href)}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}
export const teamHref = (id, season) => basketballHref('teams/' + encodeURIComponent(id), { season });
export const matchupHref = (a, b, season, venue = 'neutral') => basketballHref('matchup-lab', { a,b,season,venue });
export const action = (href, text, secondary = false) =>
  `<a class="fc-action${secondary ? ' fc-secondary' : ''}" href="${escape(href)}">${escape(text)}</a>`;
export function teamIdentity(team) {
  const school = team?.name ?? 'Unknown team';
  return `<span class="fc-team-name"><span>${escape(school)}</span>${team?.mascot ? `<strong>${escape(team.mascot)}</strong>` : ''}</span>`;
}
export function teamLink(team, season) {
  return team?.id ? `<a class="fc-team-link" href="${teamHref(team.id, season)}">${teamIdentity(team)}</a>` : teamIdentity(team);
}
const navGlyphs = {
  football: '<path d="M4 17c1 3 7 4 11 0s5-10 3-12-8-1-12 3-5 7-2 9Zm4-3 6-6m-4 3 2 2m0-4 2 2m-6 2 2 2"/>',
  basketball: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5v17M5 7c4 2 4 8 0 10M19 7c-4 2-4 8 0 10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  account: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chevron: '<path d="m7 9 5 5 5-5"/>',
  home: '<path d="m3 11 9-7 9 7M5 10v10h5v-5h4v5h5V10"/>',
  rankings: '<path d="M8 20h8m-4-4v4M7 4h10v6a5 5 0 0 1-10 0V4Zm0 2H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4"/>',
  scoreboard: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 7v10m-5-7v4m10-4v4"/>',
  teams: '<circle cx="9" cy="8" r="3"/><path d="M3 19v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m1-14a3 3 0 0 1 0 6m2 2a4 4 0 0 1 3 4v2"/>',
  matchup: '<path d="M3 7h4l10 10h4m-4-4 4 4-4 4M3 17h4L17 7h4m-4-4 4 4-4 4"/>',
  conferences: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10m5-10v10M4 15h16"/>',
  predictions: '<path d="m3 17 5-5 4 3 8-9m-6 0h6v6"/>',
  research: '<path d="M4 20h16M6 16v-4h3v4m3 0V7h3v9m3 0V4h2v12"/>',
  postseason: '<path d="M4 5h4v6H4m0 2h4v6H4m4-11h4v8H8m4-4h6m0-3h3v6h-3z"/>',
};
const navIcon = name => `<svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${navGlyphs[name]}</svg>`;
const topSections = [
  ['home', 'Home'], ['rankings', 'Rankings'], ['scoreboard', 'Scoreboard'], ['teams', 'Teams'], ['matchup', 'Matchup Lab'],
  ['conferences', 'Conferences'], ['predictions', 'Predictions'], ['research', 'Research'], ['postseason', 'Postseason'],
];
function withSeason(href, season) {
  if (!season || !href.startsWith('/basketball/')) return href;
  return `${href}${href.includes('?') ? '&' : '?'}season=${season}`;
}
function sportNav(active, pathname, season, publicSite) {
  if (!active) return '';
  const activeGroup = primarySection(active, pathname);
  return `<nav class="gd-nav" aria-label="${active === 'football' ? 'Football' : 'Basketball'} sections"><div class="wrap gd-nav-inner">
    <button class="gd-menu-toggle" type="button" aria-expanded="false" aria-controls="gd-sections">${navIcon('menu')} <span>Explore ${active}</span>${navIcon('chevron')}</button>
    <ul id="gd-sections" class="gd-nav-list">${topSections.map(([id, label]) => {
      const sections = groups[active][id], href = destination[active][id];
      const attrs = id === activeGroup ? ' aria-current="location"' : '';
      if (!sections) return `<li><a data-nav-section="${id}" href="${escape(withSeason(href, season))}"${attrs}>${navIcon(id)}<span>${label}</span></a></li>`;
      return `<li><details class="gd-nav-group" data-gd-disclosure>
        <summary data-nav-section="${id}"${attrs}>${navIcon(id)}<span>${label}</span>${navIcon('chevron')}</summary>
        <div class="gd-mega${sections.length === 1 ? ' gd-mega-short' : ''}">${sections.map(([heading, links]) =>
          `<div class="gd-mega-column"><p>${heading}</p><ul>${links.filter(([,link])=>!publicSite || link !== '/basketball/contest/').map(([name, link]) => {
            const path = link.split('?')[0];
            return `<li><a data-gd-route href="${escape(withSeason(link, season))}"${path.replace(/\/$/, '') === pathname.replace(/\/$/, '') && !link.includes('?') ? ' aria-current="page"' : ''}>${name}</a></li>`;
          }).join('')}</ul></div>`).join('')}</div></details></li>`;
    }).join('')}</ul>
  </div></nav>`;
}
const sharedNavigationStyles = '<link rel="stylesheet" href="/basketball-preview/navigation.css">';
export const sharedNavigationAssets = sharedNavigationStyles + '<script type="module" src="/basketball-preview/navigation.js"></script>';
export function shell(active, current = '', season, profile = null, { pathname, publication, query = '', publicSite = false, footballApp = false } = {}) {
  pathname ??= active === 'basketball' ? basketballHref(current) : active === 'football' ? '/football/' : '/';
  const snapshot = publication?.asOf;
  return `<header${footballApp ? ' id="header"' : ''} class="fc-masthead gd-masthead" data-gd-masthead data-gd-sport="${active ?? ''}"${publicSite ? ' data-gd-public' : ''}>
    <div class="gd-upper"><div class="wrap gd-upper-inner">
      <nav class="gd-sports" aria-label="Switch sport">${sports.map(sport => {
        const destination = sportHref(sport.id, active, pathname, publicSite);
        const href = active === sport.id ? withSeason(destination, season) : destination;
        return `<a href="${escape(href)}" data-gd-sport-link="${sport.id}"${active === sport.id ? ' aria-current="location"' : ''}>
          ${navIcon(sport.id)}<span>${sport.name}<small>${sport.id === 'football' ? 'NCAA FBS / FCS' : 'NCAA Division I'}</small></span></a>`;
      }).join('')}</nav>
      <a class="gd-brand" href="/"><img src="/assets/the-games-decide-logo.webp" alt="The Games Decide" width="780" height="260" fetchpriority="high"></a>
      <div class="gd-utilities">
        <details class="gd-utility gd-search" data-gd-disclosure>
          <summary aria-label="Find a team">${navIcon('search')}</summary>
          <form action="/find-team/">
            <label for="gd-team-query">School or mascot</label>
            ${season && active === 'basketball' ? `<input type="hidden" name="season" value="${season}">` : ''}
            <div><input id="gd-team-query" name="q" type="search" maxlength="80" value="${escape(query)}" required>
            <button type="submit">Search</button></div>
          </form>
        </details>
        ${footballApp ? `<div class="header-account gd-shared-account" data-header-account><a class="header-account-button" href="/account">${navIcon('account')}<span>Account</span></a></div>`
          : publicSite ? `<a class="header-account-button" href="/account" aria-label="Your account at The Games Decide">${navIcon('account')}<span>Account</span></a>` : `<details class="gd-utility gd-account" data-gd-disclosure>
          <summary aria-label="${profile ? 'Practice profile' : 'Account'}">${navIcon('account')}<span>${profile ? 'My Profile' : 'Account'}</span>${navIcon('chevron')}</summary>
          <div class="gd-account-panel">
            <a href="/preview-profile/">${profile ? 'Manage practice profile' : 'Open practice profile'}</a>
            ${snapshot ? `<p><strong>${active === 'football' ? 'Published football rankings' : 'Basketball data snapshot'}</strong><time datetime="${escape(snapshot)}">${escape(stamp(snapshot))}</time></p>` : ''}
          </div>
        </details>`}
      </div>
    </div></div>${sportNav(active, pathname, season, publicSite)}
  </header>`;
}
export function previewFooter(active, season, { footballApp = false } = {}) {
  return `<footer${footballApp ? ' id="footer"' : ''} class="gd-footer"><div class="wrap"><div><a href="/">The Games Decide</a><p>Results over reputation.</p></div>
  <nav aria-label="Footer"><a data-gd-footer-methodology href="${withSeason(destination[active ?? 'football'].methodology, season)}">${active === 'basketball' ? 'Basketball' : 'Football'} methodology</a>
  ${active ? '' : '<a href="/basketball/methodology/">Basketball methodology</a>'}<a href="/about/">About</a><a href="/privacy/">Privacy</a>
  <a href="/terms/">Terms</a><a href="/support">Support</a>${footballApp ? '<a href="/account">Account settings</a><a href="/data/rankings.json" target="_blank" rel="noopener">Published data</a>' : ''}</nav></div></footer>`;
}
export function html({ title, active = 'basketball', current, season, profile, body, script = '', description, publication, pathname, query, publicVersion, bootNavigation = true, portalPage = false }) {
  const interiors = active === 'basketball' ? '<link rel="stylesheet" href="/basketball-preview/preview-interiors.css">'
    + (publicVersion ? '' : '<script type="module" src="/basketball-preview/preview-interiors.js"></script>') : '';
  const rankingTransition = active === 'basketball' && ['rankings', 'polls'].includes(current)
    ? '<style>@view-transition{navigation:auto}::view-transition-group(root){animation-duration:170ms}' +
      '@media(prefers-reduced-motion:reduce){::view-transition-group(root),::view-transition-old(root),::view-transition-new(root){animation:none}}</style>' : '';
  const metadata = publicVersion
    ? `<meta name="basketball-publication" content="${escape(publicVersion)}"><link rel="canonical" href="https://www.thegamesdecide.com${escape(pathname)}">`
    : '<meta name="robots" content="noindex,nofollow,noarchive">';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${metadata}<meta name="theme-color" content="#091833">
<meta name="description" content="${escape(description ?? title)}"><title>${escape(title)} · The Games Decide</title>
<link rel="icon" href="/assets/the-games-decide-icon.png"><link rel="stylesheet" href="/base.css">${portalPage ? '' : '<link rel="stylesheet" href="/styles.css?v=shared-base">'}
<link rel="stylesheet" href="/basketball-preview/preview.css"><link rel="stylesheet" href="/basketball-preview/reconstruction.css">${bootNavigation ? sharedNavigationAssets : sharedNavigationStyles}${interiors}
<link rel="stylesheet" href="/platform-ui.css">${portalPage ? '' : '<link rel="stylesheet" href="/team-discovery.css"><link rel="stylesheet" href="/matchup-presentation.css">'}${rankingTransition}${script}</head><body class="fc-preview gd-page-shell">
<a class="skip-link" href="#main">Skip to content</a>${shell(active, current, season, profile, {pathname, publication, query, publicSite: Boolean(publicVersion)})}
<main id="main" tabindex="-1">${body}</main>${previewFooter(active, season)}</body></html>`;
}
export const banner = (title, description, eyebrow = competition.label, variant = 'interior') =>
  pageHero({ sport:eyebrow === 'The Games Decide' ? '' : 'basketball', title, description, eyebrow, variant });
export const basketballRankingsPage = (current, view, season) =>
  banner('Rankings', 'Explore Division I men’s basketball rankings and national polls.') +
  `<div class="wrap fc-content rankings-hub">${basketballRankingsNavigation(current, season)}${view}</div>`;
export const panel = (heading, contents, note = '') => `<section class="fc-panel">
  <header><h2>${escape(heading)}</h2>${note ? `<p>${escape(note)}</p>` : ''}</header><div class="fc-panel-body">${contents}</div></section>`;
export const empty = platformEmpty;
export const metric = (label, value, note = '') => `<div class="fc-metric"><span>${escape(label)}</span>
<strong>${escape(value)}</strong>${note ? `<small>${escape(note)}</small>` : ''}</div>`;
export const option = (value,label,selected) =>
  `<option value="${escape(value)}"${String(selected) === String(value) ? ' selected' : ''}>${escape(label)}</option>`;
export const input = (name, label, value, type = 'text') =>
  `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}"></label>`;
export const selector = (name,label,options,value) =>
  `<label>${escape(label)}<select name="${name}" aria-label="${escape(label)}">${options.map(([id,text])=>option(id,text,value)).join('')}</select></label>`;
