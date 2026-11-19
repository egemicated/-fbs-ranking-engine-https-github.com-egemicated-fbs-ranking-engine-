const knownPages = new Map([
  ['home', '/'], ['rankings', '/rankings/fbs/'], ['rankings/fcs/sor', '/rankings/fcs/'],
  ['teams', '/teams/fbs/'], ['teams/fbs', '/teams/fbs/'], ['teams/fcs', '/teams/fcs/'],
  ['conference-strength/records', '/conference-strength/'], ['conference-strength', '/conference-strength/'],
  ['compare', '/matchup-lab/'], ['model-report/fbs', '/model-reports/fbs/'],
  ['model-report/fcs', '/model-reports/fcs/'], ['sor-compare', '/sor-compare/'],
  ['methodology', '/methodology/'], ['about', '/about/'], ['privacy', '/privacy/'],
  ['terms', '/terms/'], ['support', '/support/'],
  ['scoreboard', '/scoreboard/'], ['beat-the-model', '/beat-the-model/'],
  ['compare/weekly', '/weekly-picks/fbs/'], ['compare/weekly/fcs', '/weekly-picks/fcs/'],
  ['ranking-history', '/ranking-history/'], ['bracket', '/playoff-bracket/'],
  ['cfp-scenarios', '/cfp-scenarios/'], ['forge-top-25', '/forge-rankings/'],
  ['polls', '/polls/ap/'], ['polls/ap', '/polls/ap/'], ['polls/coaches', '/polls/coaches/'], ['polls/cfp', '/polls/cfp/'],
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
  if (route.startsWith('compare/weekly/fcs')) return '/weekly-picks/fcs/';
  if (route.startsWith('compare/weekly')) return '/weekly-picks/fbs/';
  if (route.startsWith('ranking-history/')) return '/ranking-history/';
  if (route.startsWith('bracket/')) return '/playoff-bracket/';
  if (route.startsWith('forge-top-25/')) return '/forge-rankings/';
  for (const poll of ['ap','coaches','cfp']) if (route.startsWith(`polls/${poll}/`)) return `/polls/${poll}/`;
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

const origin = 'https://fbs-intelligence.onrender.com';
const titles = {home:'The Games Decide Top 25',rankings:'FBS and FCS rankings',teams:'Team directory',team:'Team profile',
  methodology:'Ranking methodology',scoreboard:'Live Scoreboard','beat-the-model':'Beat the Model',compare:'Matchup Lab',
  'model-report':'Weekly model report','sor-compare':'Compare earned SOR','conference-strength':'Conference Strength',
  'ranking-history':'Ranking History','forge-top-25':'Forge’s rankings',polls:'Compare rankings',bracket:'Playoff bracket',
  'cfp-scenarios':'CFP scenarios',about:'About The Games Decide',privacy:'Privacy and accounts',terms:'Using The Games Decide',
  support:'Support and data discrepancies',account:'Account settings',admin:'Administration','my-teams':'My Teams'};

export function pageMetadata(hash, registry = {}) {
  const route = String(hash ?? '').replace(/^#/, '') || 'home', path = canonicalPath(hash);
  const key = Object.hasOwn(titles, route.split('/')[0]) ? route.split('/')[0] : 'home';
  const saved = path && registry[path];
  return {canonical:path ? origin + path : null, title:saved?.title ?? `${titles[key]}${key === 'home' ? '' : ' · The Games Decide'}`,
    description:saved?.description ?? `${titles[key]} on The Games Decide. Inspect independent rankings, game evidence and clearly labeled model estimates.`,
    image:origin + (typeof saved?.image === 'string' && /^\/social\/[\w.-]+\.png$/.test(saved.image) ? saved.image : '/social/platform.png'),
    noindex:['account','admin','my-teams'].includes(key)};
}

let metadataRequest, metadataVersion = 0;
function applyMetadata(value) {
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!value.canonical) canonical?.remove();
  else {
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
    canonical.href = value.canonical;
  }
  const set = (attribute,key,content) => {
    let tag = document.head.querySelector(`meta[${attribute}="${key}"]`);
    if (!tag) {tag=document.createElement('meta');tag.setAttribute(attribute,key);document.head.append(tag);}
    tag.content=content;
  };
  set('name','description',value.description);
  for (const [key,content] of Object.entries({title:value.title,description:value.description,url:value.canonical ?? origin+'/',image:value.image})) set('property','og:'+key,content);
  for (const [key,content] of Object.entries({card:'summary_large_image',title:value.title,description:value.description,image:value.image})) set('name','twitter:'+key,content);
  let robots=document.querySelector('meta[data-account-robots]');
  if(value.noindex){if(!robots){robots=document.createElement('meta');robots.name='robots';robots.dataset.accountRobots='true';document.head.append(robots);}robots.content='noindex, nofollow';}
  else robots?.remove();
}

function updateCanonical() {
  const version=++metadataVersion, hash=location.hash;
  applyMetadata(pageMetadata(hash));
  metadataRequest ??= fetch('/data/page-metadata.json',{cache:'no-cache'}).then(response=>response.ok?response.json():{}).catch(()=>({}));
  void metadataRequest.then(registry=>{if(version===metadataVersion&&location.hash===hash)applyMetadata(pageMetadata(hash,registry));});
}

if (typeof document !== 'undefined') {
  activatePageRoute();
  updateCanonical();
  window.addEventListener('hashchange', updateCanonical);
}
