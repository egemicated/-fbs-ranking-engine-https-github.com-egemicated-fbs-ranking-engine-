import { conferenceSortArrow, nextConferenceSort, orderConferenceRows } from '/conference-display.js';

function bindConferenceSort(view) {
  const headers = [...view.querySelectorAll('[data-gd-conference-column]')];
  const select = view.querySelector('[data-gd-conference-sort]');
  const announcement = view.querySelector('[data-gd-conference-announcement]');
  const rows = [...view.querySelectorAll('[data-gd-conference-values]')].map(element => {
    const values = JSON.parse(element.dataset.gdConferenceValues);
    return {element,values,name:values.conference};
  });
  const body = view.querySelector('tbody');

  function selectOrder(url, announce = true) {
    const requested = url.searchParams.get('sort');
    const key = headers.some(header=>header.dataset.gdConferenceColumn===requested) ? requested : 'rate';
    const direction = url.searchParams.has('direction')
      ? (url.searchParams.get('direction') === 'asc' ? 'ascending' : 'descending')
      : (key === 'conference' ? 'ascending' : 'descending');
    const ordered = orderConferenceRows(rows,row=>row.values[key],direction);
    body.append(...ordered.map(row=>row.element));
    select.value = key + ':' + direction;

    for (const header of headers) {
      const column = header.dataset.gdConferenceColumn;
      const target = new URL(header.href);
      target.searchParams.set('direction',nextConferenceSort(column,key,direction) === 'ascending' ? 'asc' : 'desc');
      header.href = target;
      header.querySelector('span').textContent = conferenceSortArrow(column,key,direction);
      if (column === key) {
        header.parentElement.setAttribute('aria-sort',direction);
        if (announce) announcement.textContent = `Conferences sorted by ${header.firstChild.textContent.trim()}, ${direction}.`;
      } else header.parentElement.removeAttribute('aria-sort');
    }
  }

  function changeSort(key, direction) {
    const url = new URL(location.href);
    url.searchParams.set('season',view.dataset.gdBasketballConferences);
    url.searchParams.set('sort',key);
    url.searchParams.set('direction',direction);
    if (url.href !== location.href) history.pushState(history.state,'',url);
    selectOrder(url);
  }

  select.addEventListener('change',()=>{
    const [key,direction] = select.value.split(':');
    changeSort(key,direction==='ascending'?'asc':'desc');
  });
  view.addEventListener('click',event=>{
    const header = event.target.closest('[data-gd-conference-column]');
    if (!header || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    changeSort(header.dataset.gdConferenceColumn,new URL(header.href).searchParams.get('direction'));
  });
  return url => {
    const params = url.searchParams;
    const requestedView = params.get('view') || (params.get('b') ? 'head' : params.get('a') ? 'strength' : 'overview');
    if (requestedView !== 'overview' || (params.get('season') && params.get('season') !== view.dataset.gdBasketballConferences)) return false;
    selectOrder(url);
    return true;
  };
}

const conferencePage = document.querySelector('#basketball-conference-results');
let restoreSort;
function mountSort() {
  const records = conferencePage.querySelector('[data-gd-basketball-conferences]');
  restoreSort = records ? bindConferenceSort(records) : null;
}

if (conferencePage) {
  mountSort();
  conferencePage.addEventListener('gd:view-updated',mountSort);
  conferencePage.addEventListener('change',event=>{
    if (event.target.name !== 'a') return;
    const opponent = event.target.form?.elements.namedItem('b');
    if (!opponent) return;
    const sameConference = option => Boolean(option.value && option.value === event.target.value);
    if (opponent.value === event.target.value) opponent.value = '';
    for (const option of opponent.options) option.disabled = sameConference(option);
  });
  conferencePage.addEventListener('gd:view-restore',event=>{
    if (restoreSort?.(event.detail.url)) event.preventDefault();
  });
}
