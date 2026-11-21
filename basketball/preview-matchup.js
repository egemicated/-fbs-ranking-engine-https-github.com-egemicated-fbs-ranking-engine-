import { enhanceTeamSelect } from '/searchable-team-select.js';

const root = document.querySelector('[data-matchup-lab]');
if (root) mountMatchup(root);

function mountMatchup(lab) {
  const status = lab.querySelector('[data-matchup-status]');
  const error = lab.querySelector('[data-matchup-error]');
  const formSelector = '[data-matchup-form]';
  const resultsSelector = '[data-matchup-results]';
  const detailsSelector = '[data-matchup-details]';
  const venueButtons = '[data-matchup-venue-choice]';
  let form = lab.querySelector(formSelector);
  let details = lab.querySelector(detailsSelector);
  let results = form.querySelector(resultsSelector);
  const control = name => form.elements.namedItem(name);
  const matchupPath = path => path.replace(/\/$/, '');
  const routePath = matchupPath(new URL(form.action).pathname);
  const address = url => matchupPath(url.pathname) + url.search;
  let shown = address(new URL(location.href));
  let pending;
  let failed;
  const recent = new Map();

  function remember(url, markup) {
    recent.delete(url);
    recent.set(url, markup);
    if (recent.size > 6) recent.delete(recent.keys().next().value);
  }

  function validateTeams() {
    const a = control('a');
    const b = control('b');
    b.setCustomValidity(a.value && a.value === b.value ? 'Choose a different opponent.' : '');
  }

  function showVenue() {
    for (const button of form.querySelectorAll(venueButtons)) {
      const selected = button.dataset.matchupVenueChoice === control('venue').value;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('active', selected);
    }
  }

  function enhanceForm() {
    form.dataset.matchupEnhanced = '';
    form.querySelector('[data-matchup-venue-fallback]').hidden = true;
    form.querySelector('[data-matchup-venue-buttons]').hidden = false;
    form.querySelector('[data-matchup-manual]').hidden = true;
    for (const select of form.querySelectorAll('[data-matchup-team]')) enhanceTeamSelect(select);
    validateTeams();
  }

  function matchupUrl() {
    const url = new URL(form.action);
    url.search = new URLSearchParams(new FormData(form));
    return url;
  }

  function apply(source, url, { submit, retryFocus }) {
    const nextForm = source.querySelector(formSelector);
    const nextResults = nextForm?.querySelector(resultsSelector);
    const nextDetails = source.querySelector(detailsSelector);
    if (!nextResults || !nextDetails) throw Error('Matchup response unavailable');
    const key = address(url);
    const scrollTop = window.scrollY;
    const focused = document.activeElement;
    const focusName = form.contains(focused) ? focused.name : null;
    const focusVenue = form.contains(focused) ? focused.dataset.matchupVenueChoice : null;
    const searchSide = focused?.matches('input[type=search]') ? focused.closest('[data-matchup-side]')?.dataset.matchupSide : null;
    const playersOpen = details.querySelector('[data-matchup-players]')?.open;
    remember(key, nextForm.outerHTML + nextDetails.outerHTML);

    form.replaceWith(nextForm);
    details.replaceWith(nextDetails);
    form = nextForm;
    results = nextResults;
    details = nextDetails;
    enhanceForm();
    if (playersOpen) {
      const players = details.querySelector('[data-matchup-players]');
      if (players) players.open = true;
    }
    if (submit && key !== address(new URL(location.href))) history.pushState(history.state, '', url);
    shown = key;
    if (focusName) control(focusName)?.focus({ preventScroll: true });
    else if (searchSide) {
      const search = form.querySelector(`[data-matchup-side="${searchSide}"] input[type=search]`);
      search.value = focused.value;
      search.dispatchEvent(new Event('input'));
      search.focus({ preventScroll: true });
    } else if (focusVenue || retryFocus) {
      form.querySelector(`[data-matchup-venue-choice="${focusVenue ?? control('venue').value}"]`)?.focus({ preventScroll: true });
    }
    if (submit) window.scrollTo({ top: scrollTop, behavior: 'instant' });
    results.setAttribute('data-matchup-refresh', '');
    status.textContent = results.dataset.matchupAnnouncement;
  }

  async function update(url, { submit, retryFocus = false }) {
    pending?.abort();
    pending = null;
    failed = null;
    results.removeAttribute('aria-busy');
    error.hidden = true;
    status.textContent = '';
    const cached = !submit && recent.get(address(url));
    if (cached) {
      const template = document.createElement('template');
      template.innerHTML = cached;
      apply(template.content, url, { submit, retryFocus });
      return;
    }
    const request = new AbortController();
    pending = request;
    results.setAttribute('aria-busy', 'true');
    status.textContent = 'Updating matchup…';
    try {
      const page = document.querySelector('meta[name="basketball-publication"]')
        ? await import('/basketball/site-client.mjs').then(({viewDocument})=>viewDocument(url,request.signal))
        : await fetch(url,{signal:request.signal}).then(async response=>{
          if (!response.ok) throw Error('Matchup request failed');
          return new DOMParser().parseFromString(await response.text(),'text/html');
        });
      if (!request.signal.aborted) apply(page, url, { submit, retryFocus });
    } catch {
      if (request.signal.aborted) return;
      failed = { url, submit };
      status.textContent = '';
      error.hidden = false;
    } finally {
      if (pending === request) {
        pending = null;
        results.removeAttribute('aria-busy');
      }
    }
  }

  function compare() {
    validateTeams();
    if (form.reportValidity()) {
      void update(matchupUrl(), { submit: true });
    } else {
      pending?.abort();
      failed = null;
      error.hidden = true;
      status.textContent = '';
    }
  }

  remember(shown, form.outerHTML + details.outerHTML);
  enhanceForm();
  lab.addEventListener('change', event => {
    if (event.target.form !== form) return;
    if (event.target.name === 'season') {
      location.assign(matchupUrl());
    } else if (event.target.matches('[data-matchup-team]')) compare();
  });
  lab.addEventListener('click', event => {
    const venue = event.target.closest(venueButtons);
    if (venue && venue.form === form) {
      control('venue').value = venue.dataset.matchupVenueChoice;
      showVenue();
      compare();
    } else if (failed && event.target.closest('[data-matchup-retry]')) {
      void update(failed.url, { submit: failed.submit, retryFocus: true });
    }
  });
  lab.addEventListener('submit', event => {
    if (event.target !== form || control('season').value !== form.dataset.matchupForm) return;
    event.preventDefault();
    compare();
  });
  window.addEventListener('popstate', () => {
    const url = new URL(location.href);
    if (matchupPath(url.pathname) !== routePath) return;
    if (address(url) !== shown || pending || failed) void update(url, { submit: false });
  });
}
