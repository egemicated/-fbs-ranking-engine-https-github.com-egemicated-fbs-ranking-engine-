// Browser paths remain finite so the static host can serve real pages and 404s.
// Query parameters carry only the selected view, subject or published edition.
const routeBase = 'https://www.thegamesdecide.com';
const id = /^\d{1,24}$/;
const weekNumber = /^(?:-1|\d{1,3})$/;
const season = /^\d{4}$/;
const weekKey = /^(?:regular|postseason):\d{1,3}$/;
const historyWeek = /^(?:-1|(?:(?:regular|postseason):)?\d{1,3})$/;
const cutoffDate = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const conference = /^[\p{L}\p{N}][\p{L}\p{N} .&'’_-]{0,79}$/u;
const tab = /^(?:overview|results|players|availability|model)$/;
const venue = /^(?:home|away|neutral)$/;
const bracketView = /^(?:entry|demo|leaderboard)$/;
const conferenceView = /^(?:records|quality|compare)$/;
const division = /^(?:fbs|fcs)$/;

const fields = (...pairs) => pairs.map(([key, pattern]) => ({ key, pattern }));
const weeksAndGame = fields(['week', weekKey], ['game', id]);

// Longer tokens precede their prefixes. The internal route names remain the
// application's existing vocabulary, even where the public path differs.
const routes = [
  { route: 'compare/weekly/fcs', path: '/weekly-picks/fcs/', fields: weeksAndGame },
  { route: 'compare/weekly', path: '/weekly-picks', fields: weeksAndGame },
  { route: 'compare/matchup', path: '/matchup-lab', fields: fields(['a', id], ['b', id], ['venue', venue]) },
  { route: 'model-report/fcs', path: '/model-reports/fcs/', fields: fields(['week', weekKey]) },
  { route: 'model-report/fbs', path: '/model-reports/fbs/', fields: fields(['week', weekKey]) },
  { route: 'teams/fbs', path: '/teams/fbs/' },
  { route: 'teams/fcs', path: '/teams/fcs/' },
  { route: 'polls/ap', path: '/polls/ap/', fields: fields(['week', weekNumber]) },
  { route: 'polls/coaches', path: '/polls/coaches/', fields: fields(['week', weekNumber]) },
  { route: 'polls/cfp', path: '/polls/cfp/', fields: fields(['week', weekNumber]) },
  { route: 'forge-top-25', path: '/forge-rankings/', fields: fields(['week', weekNumber], ['through', cutoffDate]) },
  { route: 'ranking-history', path: '/ranking-history/', fields: fields(['week', historyWeek]) },
  { route: 'beat-the-model', path: '/beat-the-model/', fields: weeksAndGame },
  { route: 'conference-strength', path: '/conference-strength/', fields: fields(['view', conferenceView], ['season', season], ['a', conference], ['b', conference]) },
  { route: 'bracket', path: '/playoff-bracket/', fields: fields(['view', bracketView]) },
  { route: 'sor-compare', path: '/sor-compare/', fields: fields(['division', division], ['a', id], ['b', id]) },
  { route: 'my-teams', path: '/my-teams', fields: fields(['team', id]) },
  { route: 'cfp-scenarios', path: '/cfp-scenarios/' },
  { route: 'methodology', path: '/methodology/' },
  { route: 'scoreboard', path: '/scoreboard' },
  { route: 'privacy', path: '/privacy/' },
  { route: 'terms', path: '/terms/' },
  { route: 'support', path: '/support' },
  { route: 'about', path: '/about/' },
  { route: 'account', path: '/account' },
  { route: 'admin', path: '/admin' },
  { route: 'home', path: '/' },
].map(definition => ({ fields: [], ...definition, prefix: definition.route.split('/') }));

const teamFields = fields(['view', tab], ['game', id], ['player', id]);
const rankingFields = fields(['model', /^(?:achievement|sor|strength|predictive|performance)$/], ['all', /^1$/]);
const routeAliases = new Map([
  ['compare', 'compare/matchup'], ['teams', 'teams/fbs'], ['polls', 'polls/ap'], ['model-report', 'model-report/fbs'],
]);
const prefixAliases = [
  [/^weekly-picks\/fcs(?=\/|$)/, 'compare/weekly/fcs'],
  [/^(?:weekly-picks(?:\/fbs)?|compare\/weekly\/fbs)(?=\/|$)/, 'compare/weekly'],
  [/^matchup-lab(?=\/|$)/, 'compare/matchup'],
  [/^playoff-bracket(?=\/|$)/, 'bracket'],
  [/^forge-rankings(?=\/|$)/, 'forge-top-25'],
];
const slashless = path => path === '/' || path.endsWith('//') ? path : path.replace(/\/$/, '');
const paths = new Map(routes.map(definition => [slashless(definition.path), definition]));
for (const [alias, path] of [['/teams', '/teams/fbs'], ['/polls', '/polls/ap'], ['/model-reports', '/model-reports/fbs'],
  ['/weekly-picks/fbs', '/weekly-picks'], ['/football', '/']]) {
  paths.set(alias, paths.get(path));
}

function validate(values, definitions) {
  return values.length <= definitions.length && definitions.every(({ pattern }, index) => !values[index] || pattern.test(values[index]));
}

function paramsFor(values, definitions) {
  const params = new URLSearchParams();
  for (const [index, { key }] of definitions.entries()) {
    if (values[index]) params.set(key, values[index]);
  }
  return params;
}

function valuesFrom(params, definitions) {
  if (definitions.some(({ key }) => params.getAll(key).length > 1)) return null;
  return definitions.map(({ key }) => params.get(key) || '');
}

function tokenWithValues(base, values, encode = encodeURIComponent) {
  let length = values.length;
  while (length && !values[length - 1]) length--;
  return [base, ...values.slice(0, length).map(encode)].join('/');
}

function rankingDescriptor(group, model = '', all = '') {
  const fcs = group === 'fcs';
  if (!validate([model, all], rankingFields)) return null;
  const selected = model === 'predictive' ? 'strength' : ['achievement', 'sor'].includes(model) ? '' : model;
  const active = fcs ? selected === 'strength' ? 'predictive' : selected || 'sor' : selected;
  const base = fcs ? `rankings/fcs/${active}` : selected ? `rankings/${selected}` : 'rankings';
  return {
    path: fcs ? '/rankings/fcs/' : '/rankings',
    token: all ? `${base}/all` : base,
    params: paramsFor([selected, all], rankingFields),
  };
}

function teamDescriptor(team, view = '', game = '', player = '') {
  if (!id.test(team) || !validate([view, game, player], teamFields)) return null;
  if ((game && view !== 'results') || (player && view !== 'players')) return null;
  const active = view === 'overview' ? '' : view;
  return { path: `/team/${team}/`, token: tokenWithValues(`team/${team}`, [active, game || player]), params: paramsFor([active, game, player], teamFields) };
}

function describe(definition, values) {
  if (!definition || !validate(values, definition.fields)) return null;
  const { route, path, fields: definedFields } = definition;
  if (route === 'compare/matchup') {
    const [a = '', b = '', place = ''] = values;
    const token = a || b || place ? `compare/matchup/${a}/${b}/${place || 'neutral'}` : 'compare';
    const venueParam = place === 'neutral' && (a || b) ? '' : place;
    return { path, token, params: paramsFor([a, b, venueParam], definedFields) };
  }
  if ((route.startsWith('compare/weekly') || route === 'beat-the-model') && values[1] && !values[0]) return null;
  if (route === 'conference-strength' && (values[2] || values[3]) && (!values[1] || values[0] !== 'compare' || !values[2] || !values[3])) return null;
  if (route === 'forge-top-25' && values[1]) {
    const utc = new Date(`${values[1]}T00:00:00Z`);
    if (!values[0] || utc.toISOString().slice(0, 10) !== values[1]) return null;
  }
  const active = [...values];
  if (route === 'sor-compare' && !active[0] && (active[1] || active[2])) active[0] = 'fbs';
  if (route === 'bracket' && active[0] === 'entry') active[0] = '';
  if (route === 'conference-strength' && active[0] === 'records' && !active[1]) active[0] = '';
  // Weekly Picks and Ranking History compare raw season-type keys. Other
  // modules already decode their query/legacy token segments when consuming them.
  const rawWeek = route.startsWith('compare/weekly') || route === 'ranking-history';
  const token = tokenWithValues(route, active, rawWeek ? value => value : encodeURIComponent);
  return { path, token, params: paramsFor(active, definedFields) };
}

function describeToken(value) {
  if (typeof value !== 'string' || value.length > 1200 || value.trim() !== value) return null;
  const raw = value.startsWith('#') ? value.slice(1) : value;
  if (!raw || raw.startsWith('/') || /[#?=&\\]/.test(raw)) return null;
  const decoded = raw.split('/').map(part => decodeURIComponent(part));
  if (decoded.some(part => /[#?=\\/\u0000-\u001F\u007F]/.test(part))) return null;
  while (decoded.length > 1 && decoded.at(-1) === '') decoded.pop();
  if (decoded[0] === 'rankings') {
    const modifiers = decoded.slice(1);
    const group = ['fbs', 'fcs'].includes(modifiers[0]) ? modifiers.shift() : 'fbs';
    if (modifiers[0] === 'all' && modifiers.length === 1) return rankingDescriptor(group, '', '1');
    if (modifiers.length > 2 || (modifiers.length === 2 && modifiers[1] !== 'all')) return null;
    return rankingDescriptor(group, modifiers[0], modifiers[1] ? '1' : '');
  }
  if (decoded[0] === 'team') {
    const [, team, view, focus] = decoded;
    if (decoded.length > 4 || (focus && view !== 'results' && view !== 'players')) return null;
    return teamDescriptor(team || '', view, view === 'results' ? focus : '', view === 'players' ? focus : '');
  }
  const token = decoded.join('/');
  const alias = routeAliases.get(token);
  const prefixAlias = prefixAliases.find(([pattern]) => pattern.test(token));
  const parts = (alias || (prefixAlias ? token.replace(...prefixAlias) : token)).split('/');
  const selected = routes.find(({ prefix }) => prefix.every((part, index) => part === parts[index]));
  if (!selected) return null;
  const values = parts.slice(selected.prefix.length);
  if (selected.route.startsWith('compare/weekly') && /^\d{1,3}$/.test(values[0] ?? '')) values[0] = `regular:${values[0]}`;
  return describe(selected, values);
}

export function routeHref(route) {
  try {
    const descriptor = describeToken(route);
    if (!descriptor) return null;
    const search = descriptor.params.toString();
    return descriptor.path + (search ? `?${search}` : '');
  } catch {
    return null;
  }
}

export function legacyRouteFromHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#')) return null;
  try { return describeToken(hash)?.token ?? null; }
  catch { return null; }
}

export function routeFromUrl(value) {
  if (typeof value !== 'string' && !(value instanceof URL)) return null;
  try {
    const url = new URL(value, routeBase);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const path = slashless(url.pathname);
    const params = url.searchParams;
    if (path === '/rankings' || path === '/rankings/fbs' || path === '/rankings/fcs') {
      const values = valuesFrom(params, rankingFields);
      return values ? rankingDescriptor(path.endsWith('/fcs') ? 'fcs' : 'fbs', ...values)?.token ?? null : null;
    }
    const team = /^\/team\/(\d{1,24})$/.exec(path);
    if (team) {
      const values = valuesFrom(params, teamFields);
      return values ? teamDescriptor(team[1], ...values)?.token ?? null : null;
    }
    const definition = paths.get(path);
    if (!definition) return null;
    const values = valuesFrom(params, definition.fields);
    return values ? describe(definition, values)?.token ?? null : null;
  } catch {
    return null;
  }
}
