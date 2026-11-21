import { isAccountCallbackUrl } from '/bracket-auth.js?v=clean-routes';
import { legacyRouteFromHash, routeHref } from '/clean-routes.js';

async function mountFootballCallback(entry) {
  // Use the original callback URL and the original account app instance until
  // the SDK consumes the code or fragment. Recovery state lives in that app.
  const football = document.querySelector('[data-football-callback]').content.cloneNode(true);
  const loadedStylesheets = new Set([...document.head.querySelectorAll('link[rel="stylesheet"]')].map(link => link.href));
  for (const link of football.querySelectorAll('link[rel="stylesheet"]')) {
    if (loadedStylesheets.has(new URL(link.getAttribute('href'), entry).href)) link.remove();
    else document.head.append(link);
  }
  const dataRoot = document.createElement('meta');
  dataRoot.name = 'publication-data-root';
  dataRoot.content = '/data';
  document.head.append(dataRoot);
  document.body.classList.remove('fc-preview');
  document.body.replaceChildren(football);
  await import('/basketball/navigation.js?football-callback');
  await import('/page-routes.js?v=navigation-metadata');
  await import('/app.js?v=football-experience');
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

const entry = new URL(location.href);
if (isAccountCallbackUrl(entry)) await mountFootballCallback(entry);
else if (!followBookmark(entry)) {
  const onHashChange = () => {
    const url = new URL(location.href);
    if (!isAccountCallbackUrl(url)) followBookmark(url);
    else {
      window.removeEventListener('hashchange', onHashChange);
      void mountFootballCallback(url);
    }
  };
  window.addEventListener('hashchange', onHashChange);
  await import('/basketball/navigation.js');
}
