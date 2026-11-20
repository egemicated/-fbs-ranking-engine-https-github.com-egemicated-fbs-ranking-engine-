import { legacyRouteFromHash, routeFromUrl, routeHref } from './clean-routes.js';
import { ACCOUNT_ROUTE_EVENT, pendingAccountRoute } from './bracket-auth.js?v=clean-routes';

export const PUBLIC_SITE_ORIGIN = 'https://www.thegamesdecide.com';

const routeTitles = {
  home: 'The Games Decide Top 25',
  rankings: 'FBS Strength of Record',
  'rankings/fcs': 'FCS Strength of Record',
  teams: 'Team directory',
  team: 'Team profile',
  methodology: 'Ranking methodology',
  scoreboard: 'Live Scoreboard',
  'beat-the-model': 'Beat the Model',
  compare: 'Matchup Lab',
  'compare/weekly': 'FBS weekly picks',
  'compare/weekly/fcs': 'FCS weekly picks',
  'model-report': 'Weekly model report',
  'sor-compare': 'Compare earned SOR',
  'conference-strength': 'Conference Strength',
  'ranking-history': 'Ranking History',
  'forge-top-25': 'Forge’s rankings',
  polls: 'Compare rankings',
  bracket: 'Playoff bracket',
  'cfp-scenarios': 'CFP Scenario Builder',
  about: 'About The Games Decide',
  privacy: 'Privacy and accounts',
  terms: 'Using The Games Decide',
  support: 'Support and data discrepancies',
  account: 'Account settings',
  admin: 'Administration',
  'my-teams': 'My Teams',
};

const privatePages = new Set(['account', 'admin', 'my-teams']);

export function canonicalPath(route) {
  const href = routeHref(route === '' ? 'home' : route);
  const pathname = href?.split('?')[0];
  return pathname && !privatePages.has(normalizedRouteKey(route)) ? pathname : null;
}

function normalizedRouteKey(route) {
  return (typeof route === 'string' ? route.replace(/^#/, '') : '').split('/')[0];
}

export function pageMetadata(route, registry = {}) {
  const key = normalizedRouteKey(route);
  const rawPath = routeHref(route === '' ? 'home' : route);
  const path = rawPath?.split('?')[0];
  const noindex = !path || privatePages.has(key);
  const saved = !noindex && registry[path];
  const subkey = path === '/rankings/fcs/' ? 'rankings/fcs' : path === '/weekly-picks' ? 'compare/weekly' :
    path === '/weekly-picks/fcs/' ? 'compare/weekly/fcs' : key;
  const title = path ? routeTitles[subkey] ?? routeTitles.home : 'Page not found';
  return {
    canonical: noindex ? null : PUBLIC_SITE_ORIGIN + path,
    title: saved?.title ?? (path === '/' ? routeTitles.home : `${title} · The Games Decide`),
    description: saved?.description ?? `${title} on The Games Decide.`,
    image: noindex ? null : PUBLIC_SITE_ORIGIN + (typeof saved?.image === 'string' && /^\/social\/[\w.-]+\.png$/.test(saved.image) ? saved.image : '/social/platform.png'),
    noindex,
  };
}

let metadataRequest;
let metadataVersion = 0;

function applyMetadata(value) {
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!value.canonical) canonical?.remove();
  else {
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.append(canonical);
    }
    canonical.href = value.canonical;
  }

  const set = (attribute, key, content) => {
    let tag = document.head.querySelector(`meta[${attribute}="${key}"]`);
    if (content === null) {
      tag?.remove();
      return;
    }
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute(attribute, key);
      document.head.append(tag);
    }
    tag.content = content;
  };
  document.title = value.title;
  set('name', 'description', value.description);
  const openGraph = {
    type: 'website', site_name: 'The Games Decide', title: value.title, description: value.description,
    url: value.canonical, image: value.image, 'image:width': '1200', 'image:height': '630', 'image:alt': value.title,
  };
  for (const [key, content] of Object.entries(openGraph)) set('property', `og:${key}`, value.noindex ? null : content);
  const twitter = { card: 'summary_large_image', title: value.title, description: value.description, image: value.image };
  for (const [key, content] of Object.entries(twitter)) set('name', `twitter:${key}`, value.noindex ? null : content);

  let robots = document.querySelector('meta[data-account-robots]');
  if (!value.noindex) robots?.remove();
  else {
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      robots.setAttribute('data-account-robots', 'true');
      document.head.append(robots);
    }
    robots.content = 'noindex, nofollow';
  }
}

function updateMetadata(event) {
  const version = ++metadataVersion;
  const url = new URL(location.href);
  const legacy = url.pathname === '/' ? legacyRouteFromHash(url.hash) : null;
  const route = event?.detail?.route ?? (pendingAccountRoute(url) === 'account' ? 'account' : legacy ?? routeFromUrl(url));
  const page = pageMetadata(route);
  // A direct static page already includes its exact metadata. The registry is
  // needed when navigation reuses that document for a different public page.
  if (!event && page.canonical && document.querySelector('link[rel="canonical"]')?.href === page.canonical) return;
  applyMetadata(page);
  if (page.noindex) return;
  metadataRequest ??= fetch('/data/page-metadata.json', { cache: 'no-cache' })
    .then(response => response.ok ? response.json() : {})
    .catch(() => ({}));
  void metadataRequest.then(registry => {
    if (version === metadataVersion) applyMetadata(pageMetadata(route, registry));
  });
}

if (typeof document !== 'undefined') {
  updateMetadata();
  for (const event of ['app:navigate', 'popstate', 'hashchange', ACCOUNT_ROUTE_EVENT]) window.addEventListener(event, updateMetadata);
}
