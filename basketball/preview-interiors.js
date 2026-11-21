const directory = document.querySelector('[data-team-browser]');

if (directory) {
  const form = directory.querySelector('[data-team-filters]');
  const announcement = directory.querySelector('[data-team-announcement]');
  const error = directory.querySelector('[data-team-error]');
  let results = directory.querySelector('[data-team-results]');
  let pending = null;
  let debounce;

  function filterUrl() {
    const url = new URL(form.action);
    url.search = '';
    for (const [key,value] of new FormData(form)) {
      if (value !== '') url.searchParams.set(key,value);
    }
    return url;
  }

  async function update(url, {letter = null, more = false} = {}) {
    clearTimeout(debounce);
    pending?.abort();
    const request = new AbortController();
    pending = request;
    results.setAttribute('aria-busy','true');
    error.hidden = true;
    const previousCount = more ? results.querySelectorAll('[data-team-card]').length : 0;
    try {
      const response = await fetch(url,{signal:request.signal});
      if (!response.ok) throw new Error('Directory request failed');
      const page = new DOMParser().parseFromString(await response.text(),'text/html');
      const replacement = page.querySelector('[data-team-results]');
      if (!replacement) throw new Error('Directory results missing');
      if (request.signal.aborted) return;
      results.replaceWith(replacement);
      results = replacement;
      history.replaceState(history.state,'',url);
      announcement.textContent = replacement.querySelector('[data-team-count]').textContent;
      if (more) replacement.querySelectorAll('[data-team-card]')[previousCount]?.focus();
      if (letter !== null) {
        replacement.querySelector(`[data-team-letter="${CSS.escape(letter)}"]`)?.focus({preventScroll:true});
      }
    } catch {
      if (!request.signal.aborted) error.hidden = false;
    } finally {
      if (pending === request) {
        pending = null;
        results.removeAttribute('aria-busy');
      }
    }
  }

  form.addEventListener('submit',event=>{
    event.preventDefault();
    void update(filterUrl());
  });
  form.addEventListener('input',event=>{
    if (event.target.name !== 'q') return;
    pending?.abort();
    clearTimeout(debounce);
    debounce = setTimeout(()=>void update(filterUrl()),140);
  });
  form.addEventListener('change',event=>{
    if (!(event.target instanceof HTMLSelectElement)) return;
    if (event.target.name === 'season') {
      const url = filterUrl();
      url.searchParams.delete('conf');
      location.assign(url);
      return;
    }
    void update(filterUrl());
  });
  directory.addEventListener('click',event=>{
    const link = event.target.closest('[data-team-letter],[data-team-more]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void update(new URL(link.href),{letter:link.dataset.teamLetter ?? null,more:link.hasAttribute('data-team-more')});
  });
}
