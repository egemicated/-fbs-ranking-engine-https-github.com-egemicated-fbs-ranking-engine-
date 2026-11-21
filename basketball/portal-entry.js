import { isAccountCallbackUrl } from '/bracket-auth.js?v=clean-routes';
import { legacyRouteFromHash, routeHref } from '/clean-routes.js';

async function mountFootballCallback(entry, signal) {
  // Use the original callback URL and the original account app instance until
  // the SDK consumes the code or fragment. Recovery state lives in that app.
  const response = await fetch('/account', {
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) throw new Error('Account shell unavailable');
  const football = new DOMParser().parseFromString(await response.text(), 'text/html');
  if (signal.aborted || location.href !== entry.href) return;
  const dataRoot = football.head.querySelector('meta[name="publication-data-root"]');
  if (!football.querySelector('#header [data-header-account]') ||
      !football.querySelector('#main') || !football.querySelector('#announce') || !dataRoot) {
    throw new Error('Account shell incomplete');
  }

  const loadedStylesheets = new Set([...document.head.querySelectorAll('link[rel="stylesheet"]')].map(link => link.href));
  for (const link of football.head.querySelectorAll('link[rel="stylesheet"]')) {
    if (!loadedStylesheets.has(new URL(link.getAttribute('href'), entry).href)) document.head.append(link);
  }
  document.head.append(dataRoot);
  window.removeEventListener('hashchange', routePortal);
  document.body.classList.remove('fc-preview');
  document.body.replaceChildren(...football.body.children);
  await import('/basketball/navigation.js?football-callback');
  await import('/page-routes.js?v=navigation-metadata');
  await import('/app.js?v=football-experience');
}

async function openCallback(entry, signal) {
  const status = document.createElement('p');
  status.className = 'gd-empty';
  status.setAttribute('role', 'status');
  status.textContent = 'Opening your account link…';
  document.querySelector('#main').prepend(status);
  signal.addEventListener('abort', () => status.remove(), { once: true });
  try {
    await mountFootballCallback(entry, signal);
  } catch {
    if (signal.aborted || location.href !== entry.href) return;
    const notice = document.createElement('p');
    notice.className = 'gd-empty';
    notice.setAttribute('role', 'alert');
    notice.textContent = 'Could not open this account link. Reload this page to try it again.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'fc-action';
    retry.textContent = 'Reload';
    retry.addEventListener('click', () => location.reload());
    notice.append(' ', retry);
    document.querySelector('#main').prepend(notice);
    signal.addEventListener('abort', () => notice.remove(), { once: true });
  } finally {
    status.remove();
  }
}

function followBookmark(entry) {
  const destination = routeHref(legacyRouteFromHash(entry.hash));
  if (!destination) return false;
  const clean = new URL(destination, entry);
  for (const [name, value] of entry.searchParams) {
    if (!clean.searchParams.has(name)) clean.searchParams.append(name, value);
  }
  location.replace(clean);
  return true;
}

let pendingCallback;
async function routePortal() {
  pendingCallback?.abort();
  const entry = new URL(location.href);
  if (isAccountCallbackUrl(entry)) {
    pendingCallback = new AbortController();
    await openCallback(entry, pendingCallback.signal);
  } else if (!followBookmark(entry)) {
    pendingCallback = undefined;
    await import('/basketball/navigation.js');
  }
}
window.addEventListener('hashchange', routePortal);
await routePortal();
