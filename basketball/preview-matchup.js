import { enhanceTeamSelectors } from '/searchable-team-select.js';

const root = document.querySelector('[data-matchup-lab]');
if (root) mountMatchup(root);

function mountMatchup(lab) {
  const status = lab.querySelector('[data-matchup-status]');
  const error = lab.querySelector('[data-matchup-error]');
  const formSelector = '[data-matchup-form]';
  const resultsSelector = '[data-matchup-results]';
  let form = lab.querySelector(formSelector);
  let results = lab.querySelector(resultsSelector);
  const matchupPath = path => path.replace(/\/$/, '');
  const routePath = matchupPath(new URL(form.action).pathname);
  const address = url => matchupPath(url.pathname) + url.search;
  let shown = address(new URL(location.href));
  let pending;
  const recent = new Map();

  function remember(url, markup, controls) {
    recent.delete(url);
    recent.set(url, controls.outerHTML + markup.outerHTML);
    if (recent.size > 6) recent.delete(recent.keys().next().value);
  }

  function validateTeams() {
    const a = form.elements.namedItem('a');
    const b = form.elements.namedItem('b');
    b.setCustomValidity(a.value && a.value === b.value ? 'Choose a different opponent.' : '');
  }

  function apply(source, url, { submit }) {
    const nextForm = source.querySelector(formSelector);
    const nextResults = source.querySelector(resultsSelector);
    if (!nextForm || !nextResults) throw Error('Matchup response unavailable');
    const key = address(url);
    const scrollTop = window.scrollY;
    if (submit && key !== address(new URL(location.href))) history.pushState(history.state, '', url);
    remember(key, nextResults, nextForm);
    if (!submit) {
      const control = form.contains(document.activeElement) ? document.activeElement : null;
      const focusName = control?.name;
      form.replaceWith(nextForm);
      form = nextForm;
      validateTeams();
      if (focusName) form.elements.namedItem(focusName)?.focus({ preventScroll: true });
      else if (control?.type === 'submit') form.querySelector('button[type="submit"]')?.focus({ preventScroll: true });
    }
    results.replaceWith(nextResults);
    results = nextResults;
    shown = key;
    if (submit) window.scrollTo({ top: scrollTop, behavior: 'instant' });
    results.setAttribute('data-matchup-refresh', '');
    status.textContent = results.dataset.matchupAnnouncement;
  }

  async function update(url, { submit }) {
    pending?.abort();
    pending = null;
    results.removeAttribute('aria-busy');
    error.hidden = true;
    status.textContent = '';
    const cached = !submit && recent.get(address(url));
    if (cached) {
      const template = document.createElement('template');
      template.innerHTML = cached;
      apply(template.content, url, { submit });
      return;
    }
    const request = new AbortController();
    pending = request;
    results.setAttribute('aria-busy', 'true');
    status.textContent = 'Updating matchup…';
    try {
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok) throw Error('Matchup request failed');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (!request.signal.aborted) apply(page, url, { submit });
    } catch {
      if (request.signal.aborted) return;
      status.textContent = '';
      error.textContent = 'Could not update the matchup. Previous results are still shown. Try Compare teams again.';
      error.hidden = false;
    } finally {
      if (pending === request) {
        pending = null;
        results.removeAttribute('aria-busy');
      }
    }
  }

  remember(shown, results, form);
  validateTeams();
  enhanceTeamSelectors(lab);
  lab.addEventListener('change', event => {
    if (event.target.matches('[data-matchup-team]')) validateTeams();
  });
  lab.addEventListener('submit', event => {
    if (event.target !== form) return;
    const values = new FormData(form);
    // A different season is a new publication with season-aware navigation
    // and snapshot metadata. Same-season comparisons update only their results.
    if (values.get('season') !== form.dataset.matchupForm) return;
    event.preventDefault();
    validateTeams();
    if (!form.reportValidity()) return;
    const url = new URL(form.action);
    url.search = new URLSearchParams(values);
    void update(url, { submit: true });
  });
  window.addEventListener('popstate', () => {
    const url = new URL(location.href);
    if (matchupPath(url.pathname) !== routePath) return;
    if (address(url) !== shown || pending) void update(url, { submit: false });
  });
}
