// Progressive enhancement: keep the native, labeled select and its existing
// form/change/validation rules. Typing filters its options; it never saves a team.
const selectors = '#my-team-select,#my-teams-team,#compare-a,#compare-b,select[data-sor-field="a"],select[data-sor-field="b"]';
let sequence = 0;
const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('en-US').trim();

export function enhanceTeamSelect(select) {
  if (select.dataset.teamSearchEnhanced || select.disabled) return;
  select.dataset.teamSearchEnhanced = 'true';
  const name = select.id === 'compare-a' || select.dataset.sorField === 'a' ? 'Team A' :
    select.id === 'compare-b' || select.dataset.sorField === 'b' ? 'Team B' : 'team';
  const entries = [...select.children].map(node => ({ node, options:node.tagName === 'OPTGROUP' ? [...node.children] : null }));
  const wrapper = document.createElement('div');
  wrapper.className = 'searchable-team-select';
  const labelContainer = select.parentElement?.tagName === 'LABEL' ? select.parentElement : select;
  labelContainer.before(wrapper);
  const input = document.createElement('input'), label = document.createElement('label'), message = document.createElement('p');
  input.id = `team-list-search-${++sequence}`;
  input.type = 'search'; input.placeholder = 'Type to filter teams…'; input.autocomplete = 'off';
  label.htmlFor = input.id; label.className = 'sr-only'; label.textContent = `Filter ${name} list`;
  message.className = 'team-select-search-status'; message.setAttribute('role','status'); message.setAttribute('aria-live','polite');
  wrapper.append(label, input, labelContainer, message);
  function filter() {
    const selected = select.value, query = normalize(input.value);
    let count = 0, retained = false;
    const keep = (option, group = '') => {
      if (!option.value) return true;
      const match = !option.disabled && normalize(`${option.textContent} ${group}`).includes(query);
      if (match) count++;
      if (option.value === selected && !match) retained = true;
      return match || option.value === selected;
    };
    const nodes = entries.filter(entry => {
      if (!entry.options) return keep(entry.node);
      entry.node.replaceChildren(...entry.options.filter(option => keep(option, entry.node.label)));
      return entry.node.children.length > 0;
    }).map(entry => entry.node);
    select.replaceChildren(...nodes);
    select.value = selected;
    message.textContent = query ? `${count ? `${count} matching ${count === 1 ? 'team' : 'teams'}.` : 'No matching teams.'}${retained ? ' Your current selection is retained.' : ''}` : '';
  }
  input.addEventListener('input', filter);
  select.addEventListener('change', () => { input.value = ''; filter(); });
  // Native Enter/Escape behavior and the native dropdown remain available.
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { input.value = ''; filter(); select.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); select.focus(); }
  });
  input.disabled = select.disabled;
  return () => {
    for (const entry of entries) if (entry.options) entry.node.replaceChildren(...entry.options);
    select.replaceChildren(...entries.map(entry => entry.node));
    delete select.dataset.teamSearchEnhanced;
    wrapper.before(labelContainer); wrapper.remove();
  };
}

export function enhanceTeamSelectors(root) {
  const scan = () => root.querySelectorAll(selectors).forEach(enhanceTeamSelect);
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(root, { subtree:true, childList:true });
  return () => observer.disconnect();
}
