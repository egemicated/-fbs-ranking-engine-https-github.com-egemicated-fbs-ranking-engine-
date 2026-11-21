import { primarySection, sportHref } from './navigation-routes.mjs';

const masthead = document.querySelector('[data-gd-masthead]');
const sport = masthead.dataset.gdSport;
const menuToggle = masthead.querySelector('.gd-menu-toggle');
const nav = masthead.querySelector('.gd-nav');
const mobile = window.matchMedia('(max-width: 760px)');
const disclosures = [...masthead.querySelectorAll('[data-gd-disclosure]')];

function closeDisclosures(except) {
  disclosures.forEach(item => { if (item !== except) item.open = false; });
}
function setMenu(open) {
  if (!nav) return;
  nav.dataset.open = String(open);
  menuToggle.setAttribute('aria-expanded', String(open));
  if (!open) closeDisclosures();
}
function active(link, type, applies) {
  if (applies) link.setAttribute('aria-current', type);
  else link.removeAttribute('aria-current');
}
function updateRoute() {
  if (!sport || !nav) return;
  const current = new URL(location.href);
  const section = primarySection(sport, current.pathname);
  nav.querySelectorAll('[data-nav-section]').forEach(link =>
    active(link, link.tagName === 'A' ? 'page' : 'location', link.dataset.navSection === section));
  nav.querySelectorAll('[data-gd-route]').forEach(link => {
    const url = new URL(link.href, location.href);
    const parameters = names => [...names].filter(([key]) => key !== 'season').sort().toString();
    active(link, 'page', url.pathname.replace(/\/$/, '') === current.pathname.replace(/\/$/, '')
      && parameters(url.searchParams) === parameters(current.searchParams));
  });
  if (sport === 'football') masthead.querySelectorAll('[data-gd-sport-link]').forEach(link => {
    link.href = sportHref(link.dataset.gdSportLink, sport, current.pathname, masthead.hasAttribute('data-gd-public'));
  });
}

disclosures.forEach(item => {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    closeDisclosures(item);
    if (item.classList.contains('gd-search')) item.querySelector('input[type="search"]').focus();
  });
});
menuToggle?.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
mobile.addEventListener('change', () => setMenu(false));
document.addEventListener('click', event => {
  const current = disclosures.find(item => item.open && item.contains(event.target));
  if (!current) closeDisclosures();
  if (!masthead.contains(event.target)) setMenu(false);
  const link = event.target.closest('.gd-nav a');
  if (!link || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  setMenu(false);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const open = disclosures.find(item => item.open);
  if (open) {
    open.open = false;
    open.querySelector('summary').focus();
  } else if (nav?.dataset.open === 'true' && mobile.matches) {
    setMenu(false);
    menuToggle.focus();
  }
});
updateRoute();
for (const event of ['app:navigate', 'popstate', 'hashchange', 'fbs-account-route']) window.addEventListener(event,updateRoute);
