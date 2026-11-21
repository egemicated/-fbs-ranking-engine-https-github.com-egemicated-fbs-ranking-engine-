// The VM executes the application with its real static dependencies and a small browser fixture.
import assert from 'node:assert/strict';
import { ACCOUNT_ROUTE_EVENT, isAccountCallbackUrl, pendingAccountRoute, safeAccountReturnPath } from '../frontend/bracket-auth.js?v=clean-routes';
import { routeFromUrl, routeHref } from '../frontend/clean-routes.js';
import { APP_NAVIGATION_EVENT, internalNavigationTarget, navigateApp, replaceLegacyAppUrl } from '../frontend/clean-navigation.js';
import { formatNumber, formatProbability, formatRecord, formatSorScore, indefiniteArticle, sorEligibleRecord } from '../frontend/format.js';
import { teamDisplayName, teamNameMarkup, teamAccentAttr } from '../frontend/team-identity.js';
import { championshipWeekLabel, championshipWeekMessage, isChampionshipWeek, withChampionshipWeek } from '../frontend/football-weeks.js';
import { matchupTeamCard, pageHero } from '../frontend/platform-presentation.js';

const knownImports = [
  "import { teamDisplayName, teamNameMarkup, teamAccentAttr } from './team-identity.js';",
  "import { championshipWeekLabel, championshipWeekMessage, isChampionshipWeek, withChampionshipWeek } from './football-weeks.js';",
  "import { ACCOUNT_ROUTE_EVENT, isAccountCallbackUrl, pendingAccountRoute, safeAccountReturnPath } from './bracket-auth.js?v=clean-routes';",
  "import { routeFromUrl, routeHref } from './clean-routes.js';",
  "import { APP_NAVIGATION_EVENT, internalNavigationTarget, navigateApp, replaceLegacyAppUrl } from './clean-navigation.js';",
  "import { formatNumber, formatProbability, formatRecord, formatSorScore, indefiniteArticle, sorEligibleRecord } from './format.js?v=sor-transparency';",
  "import { matchupTeamCard, pageHero } from './platform-presentation.js';",
];

export function appVmSource(source) {
  let script = source;
  for (const statement of knownImports) {
    assert.equal(script.split(statement).length, 2, 'Expected a known application import. Review changes to app dependencies.');
    script = script.replace(statement, '');
  }
  assert.doesNotMatch(script, /(?:^|\n)\s*import\b(?!\s*\()/, 'Unexpected static application import. Extend the VM bridge explicitly.');
  return script;
}

export function installAppVmContext(context) {
  Object.assign(context, { ACCOUNT_ROUTE_EVENT, isAccountCallbackUrl, pendingAccountRoute, safeAccountReturnPath,
    routeFromUrl, routeHref, APP_NAVIGATION_EVENT, internalNavigationTarget, navigateApp, replaceLegacyAppUrl,
    formatNumber, formatProbability, formatRecord, formatSorScore, indefiniteArticle, sorEligibleRecord,
    teamDisplayName, teamNameMarkup, teamAccentAttr, championshipWeekLabel, championshipWeekMessage,
    isChampionshipWeek, withChampionshipWeek, matchupTeamCard, pageHero, URL, URLSearchParams });
  const { location, window } = context;
  assert.ok(location && window, 'VM browser requires location and window fixtures');
  const origin = location.origin ?? 'https://example.test';
  let url = new URL(location.href ?? (location.pathname ?? '/') + (location.search ?? '') + (location.hash ?? ''), origin);
  const entries = [{ url: url.href, state: null }];
  let index = 0;
  const listeners = new Map();
  const register = window.addEventListener?.bind(window);
  window.location = location;
  window.CustomEvent = CustomEvent;
  window.addEventListener = (name, listener) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(listener);
    register?.(name, listener);
  };
  window.dispatchEvent = event => {
    for (const listener of listeners.get(event.type) ?? []) listener.call(window, event);
    return !event.defaultPrevented;
  };
  for (const property of ['pathname', 'search', 'hash']) {
    Object.defineProperty(location, property, { get: () => url[property], set: value => { url[property] = value; } });
  }
  for (const property of ['origin', 'hostname']) Object.defineProperty(location, property, { get: () => url[property] });
  Object.defineProperty(location, 'href', { get: () => url.href, set: value => { url = new URL(value, url); } });

  const setEntry = (state, href, replace) => {
    const next = new URL(href ?? url.href, url);
    assert.equal(next.origin, origin, 'Browser history may only change a same-origin URL');
    url = next;
    if (!replace) entries.splice(++index);
    entries[index] = { url: url.href, state };
  };
  const history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState: (state, unused, href) => setEntry(state, href, false),
    replaceState: (state, unused, href) => setEntry(state, href, true),
    go(delta) {
      const next = index + delta;
      if (next < 0 || next >= entries.length || next === index) return;
      index = next;
      location.href = entries[index].url;
      window.dispatchEvent(new Event('popstate'));
    },
    back() { history.go(-1); },
    forward() { history.go(1); },
  };
  window.history = context.history = history;
  context.visit = href => {
    const oldURL = location.href;
    const legacy = href.startsWith('#');
    history.pushState(null, '', legacy ? '/' + href : href);
    const event = legacy ? Object.assign(new Event('hashchange'), { oldURL, newURL: location.href }) : new Event('popstate');
    window.dispatchEvent(event);
  };
  return context;
}
