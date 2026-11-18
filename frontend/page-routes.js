const knownPages = new Map([
  ['home', '/'], ['rankings', '/rankings/fbs/'], ['rankings/fcs/sor', '/rankings/fcs/'],
  ['teams', '/teams/fbs/'], ['teams/fbs', '/teams/fbs/'], ['teams/fcs', '/teams/fcs/'],
  ['conference-strength/records', '/conference-strength/'], ['conference-strength', '/conference-strength/'],
  ['compare', '/matchup-lab/'], ['model-report/fbs', '/model-reports/fbs/'],
  ['model-report/fcs', '/model-reports/fcs/'], ['sor-compare', '/sor-compare/'],
  ['methodology', '/methodology/'], ['about', '/about/'], ['privacy', '/privacy/'],
  ['terms', '/terms/'], ['support', '/support/'],
]);

export function canonicalPath(hash) {
  const route = String(hash ?? '').replace(/^#/, '') || 'home';
  const team = /^team\/(\d{1,24})(?:\/.*)?$/.exec(route);
  if (team) return '/team/' + team[1] + '/';
  if (knownPages.has(route)) return knownPages.get(route);
  if (route.startsWith('rankings/fcs')) return '/rankings/fcs/';
  if (route.startsWith('rankings')) return '/rankings/fbs/';
  if (route.startsWith('conference-strength/')) return '/conference-strength/';
  if (route.startsWith('compare/matchup/')) return '/matchup-lab/';
  if (route.startsWith('model-report/fcs')) return '/model-reports/fcs/';
  if (route.startsWith('model-report')) return '/model-reports/fbs/';
  if (route.startsWith('sor-compare/')) return '/sor-compare/';
  return null;
}

export function activatePageRoute() {
  const initial = document.querySelector('meta[name="app-route"]')?.content;
  if (!initial || location.hash) return;
  history.replaceState(history.state, '', '/' + location.search + '#' + initial);
}

function updateCanonical() {
  const path = canonicalPath(location.hash);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical && path) canonical.href = 'https://fbs-intelligence.onrender.com' + path;
}

if (typeof document !== 'undefined') {
  activatePageRoute();
  updateCanonical();
  window.addEventListener('hashchange', updateCanonical);
}
