const list = document.querySelector('[data-team-browser],[data-ranking-browser],[data-view-refresh]');

if (list) {
  const scope = list.hasAttribute('data-view-refresh') ? 'view' : 'team';
  const part = name => `[data-${scope}-${name}]`;
  let form = list.querySelector(part('filters'));
  const announcement = list.querySelector(part('announcement'));
  const error = list.querySelector(part('error'));
  let results = list.querySelector(part('results'));
  let pending;
  let debounce;

  list.dataset[`${scope}Enhanced`] = '';

  function filterUrl() {
    const url = new URL(form.action);
    url.search = '';
    url.hash = '';
    for (const [key,value] of new FormData(form)) {
      if (value !== '') url.searchParams.set(key,value);
    }
    return url;
  }

  function syncFilters(nextForm, restore) {
    if (scope === 'view') {
      if (restore) {
        const tabs = nextForm.closest('[data-view-refresh]')?.querySelector('[data-view-tabs]');
        if (tabs) list.querySelector('[data-view-tabs]')?.replaceWith(tabs);
        form.replaceWith(nextForm);
        form = nextForm;
      }
      return;
    }
    if (restore) {
      for (const control of form.elements) {
        if (!control.name || control.type === 'hidden') continue;
        const next = nextForm.elements.namedItem(control.name);
        if (next && control.type === 'checkbox') control.checked = next.checked;
        else if (next) control.value = next.value;
      }
    }
    if (!list.hasAttribute('data-ranking-browser')) return;
    for (const name of ['model','all']) {
      const previous = form.elements.namedItem(name);
      const next = nextForm.elements.namedItem(name);
      if (previous && next) previous.value = next.value;
      else if (previous) previous.remove();
      else if (next) form.append(next.cloneNode());
    }
    for (const selector of ['[data-ranking-tabs]','[data-ranking-action]','[data-ranking-heading]','[data-ranking-context]']) {
      const next = nextForm.closest('[data-ranking-browser]')?.querySelector(selector);
      const previous = list.querySelector(selector);
      if (next && previous?.innerHTML !== next.innerHTML) previous?.replaceWith(next);
    }
  }

  async function update(url, {historyMethod = 'replaceState', focusSelector, more = false, restoreFilters = false} = {}) {
    clearTimeout(debounce);
    pending?.abort();
    const request = new AbortController();
    pending = request;
    results.setAttribute('aria-busy','true');
    if (error) error.hidden = true;
    const previousCount = more ? results.querySelectorAll('[data-team-card]').length : 0;
    try {
      const page = document.querySelector('meta[name="basketball-publication"]')
        ? await import('/basketball/site-client.mjs').then(({viewDocument})=>viewDocument(url,request.signal))
        : await fetch(url,{signal:request.signal}).then(async response=>{
          if (!response.ok) throw Error('Could not refresh team results');
          return new DOMParser().parseFromString(await response.text(),'text/html');
        });
      const replacement = page.querySelector(part('results'));
      const nextForm = page.querySelector(part('filters'));
      if (!replacement || !nextForm) throw new Error('Team results were missing from the response');
      if (request.signal.aborted) return;
      syncFilters(nextForm, restoreFilters);
      results.replaceWith(replacement);
      results = replacement;
      if (historyMethod && url.href !== location.href) history[historyMethod](history.state,'',url);
      if (announcement) announcement.textContent = replacement.querySelector(part('count'))?.textContent ?? 'Results updated.';
      if (scope === 'view') list.dispatchEvent(new CustomEvent('gd:view-updated',{bubbles:true}));
      if (more) replacement.querySelectorAll('[data-team-card]')[previousCount]?.focus();
      else if (focusSelector) list.querySelector(focusSelector)?.focus({preventScroll:true});
    } catch {
      if (!request.signal.aborted && error) error.hidden = false;
    } finally {
      if (pending === request) {
        pending = null;
        results.removeAttribute('aria-busy');
      }
    }
  }

  list.addEventListener('submit',event=>{
    if (event.target !== form) return;
    event.preventDefault();
    const explicit = form.hasAttribute('data-view-explicit');
    void update(filterUrl(),{historyMethod:explicit ? 'pushState' : 'replaceState',restoreFilters:explicit,
      focusSelector:explicit ? '[data-view-filters] button' : undefined});
  });
  list.addEventListener('input',event=>{
    if (event.target.form !== form || event.target.name !== 'q') return;
    pending?.abort();
    clearTimeout(debounce);
    debounce = setTimeout(()=>void update(filterUrl()),140);
  });
  list.addEventListener('change',event=>{
    if (event.target.form !== form) return;
    if (!(event.target instanceof HTMLSelectElement) &&
        !(scope === 'view' && ['date','checkbox'].includes(event.target.type))) return;
    const url = filterUrl();
    if (event.target.name === 'season') {
      url.searchParams.delete('conf');
      location.assign(url);
    } else if (!form.hasAttribute('data-view-explicit')) {
      void update(url,{historyMethod:event.target.name === 'date' ? 'pushState' : 'replaceState'});
    }
  });
  list.addEventListener('click',event=>{
    const link = event.target.closest('[data-team-letter],[data-team-more],[data-ranking-model],[data-ranking-action] a,[data-view-link]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const destination = new URL(link.href);
    if (destination.origin !== location.origin || destination.pathname !== new URL(form.action).pathname) return;
    event.preventDefault();
    const url = filterUrl();
    if (link.hasAttribute('data-ranking-model')) {
      const model = link.dataset.rankingModel;
      url.searchParams.set('model',model);
      void update(url,{historyMethod:'pushState',focusSelector:`[data-ranking-model="${CSS.escape(model)}"]`});
    } else if (link.hasAttribute('data-view-link')) {
      const key = link.dataset.viewLink;
      const selector = key ? `[data-view-link="${CSS.escape(key)}"]` :
        `[data-view-link][href="${CSS.escape(link.getAttribute('href'))}"]`;
      void update(destination,{historyMethod:'pushState',focusSelector:selector,restoreFilters:true});
    } else if (link.closest('[data-ranking-action]')) {
      void update(destination,{historyMethod:'pushState',focusSelector:'[data-ranking-action] a',restoreFilters:true});
    } else if (link.hasAttribute('data-team-more')) {
      void update(destination,{more:true});
    } else {
      const letter = link.dataset.teamLetter;
      if (letter) url.searchParams.set('letter',letter);
      void update(url,{focusSelector:`[data-team-letter="${CSS.escape(letter)}"]`});
    }
  });
  window.addEventListener('popstate',()=>{
    const url = new URL(location.href);
    clearTimeout(debounce);
    pending?.abort();
    if (scope === 'view' && !list.dispatchEvent(new CustomEvent('gd:view-restore',{
      bubbles:true, cancelable:true, detail:{url},
    }))) return;
    void update(url,{historyMethod:null,restoreFilters:true});
  });
}
