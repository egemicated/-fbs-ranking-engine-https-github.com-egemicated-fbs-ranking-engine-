import { legacyRouteFromHash, routeFromUrl, routeHref } from './clean-routes.js';

export const APP_NAVIGATION_EVENT = 'app:navigate';

export function navigateApp(route, { replace = false, render = true, query = {} } = {}, browser = window) {
  const href = routeHref(route);
  if (!href) return false;
  const previousUrl = browser.location.href;
  const target = new URL(href, previousUrl);
  for (const [name, value] of Object.entries(query)) {
    if (value) target.searchParams.set(name, value);
  }
  if (target.href === previousUrl) return false;
  const method = replace ? 'replaceState' : 'pushState';
  browser.history[method](browser.history.state, '', target.pathname + target.search + target.hash);
  browser.dispatchEvent(new browser.CustomEvent(APP_NAVIGATION_EVENT, {
    detail: { previousUrl, route: routeFromUrl(target), render },
  }));
  return true;
}

export function replaceLegacyAppUrl(browser = window) {
  const url = new URL(browser.location.href);
  // Historic application links live at the site's root. Other fragments are
  // in-page anchors or managed-Auth callbacks and are left with the document.
  if (url.pathname !== '/') return false;
  const route = legacyRouteFromHash(url.hash);
  if (!route) return false;
  const href = routeHref(route);
  if (!href) return false;
  const clean = new URL(href, url);
  for (const [name, value] of url.searchParams) {
    if (!clean.searchParams.has(name)) clean.searchParams.append(name, value);
  }
  browser.history.replaceState(browser.history.state, '', clean.pathname + clean.search);
  return true;
}

export function internalNavigationTarget(event, currentUrl) {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const link = event.target.closest?.('a[href]');
  if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return null;
  const current = new URL(currentUrl);
  const target = new URL(link.href, current);
  if (target.origin !== current.origin || target.hash) return null;
  const route = routeFromUrl(target);
  if (!route) return null;
  // Leave links with provider callbacks or unrelated search parameters on the
  // browser's native path so SPA navigation never drops those parameters.
  const normalized = new URL(routeHref(route), current);
  if (normalized.search !== target.search) return null;
  return route;
}
