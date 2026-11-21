const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

export function orderConferenceRows(rows, value, direction) {
  const sign = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a,b) => {
    const x = value(a), y = value(b);
    const byName = a.name.localeCompare(b.name);
    if (x == null || y == null) return Number(x == null) - Number(y == null) || byName;
    if (typeof x === 'string') return sign * x.localeCompare(y) || byName;
    if (typeof x === 'number') return sign * (x - y) || byName;
    return sign * (x.wins - y.wins || y.losses - x.losses || x.ties - y.ties) || byName;
  });
}

export const nextConferenceSort = (key, current, direction) => key === current
  ? direction === 'ascending' ? 'descending' : 'ascending'
  : key === 'conference' ? 'ascending' : 'descending';

export const conferenceSortArrow = (key, sort, direction) =>
  key !== sort ? '↕' : direction === 'ascending' ? '↑' : '↓';

export function conferenceViewTabs(label, tabs, selected, {inPlace = false} = {}) {
  return `<nav class="gd-conference-tabs" data-tab-count="${tabs.length}" aria-label="${escape(label)}"${inPlace ? ' data-view-tabs' : ''}>${tabs.map(([key,name,href]) =>
    `<a href="${escape(href)}"${inPlace ? ' data-view-link' : ''}${key === selected ? ' aria-current="page"' : ''}>${escape(name)}</a>`).join('')}</nav>`;
}

export function conferenceSortControl(columns, sort, direction) {
  const current = sort + ':' + direction;
  return `<label class="gd-conference-sort-control">Sort conferences
    <select data-gd-conference-sort>${columns.map(([key,label,,mobileLabel]) => ['ascending','descending'].map(order => {
      const value = key + ':' + order;
      const from = key === 'conference' ? (order === 'ascending' ? 'A–Z' : 'Z–A')
        : (order === 'ascending' ? 'low to high' : 'high to low');
      return `<option value="${value}"${value === current ? ' selected' : ''}>${escape(mobileLabel ?? label)} · ${from}</option>`;
    }).join('')).join('')}</select></label>`;
}

export function conferenceNameCell(heading, record) {
  return `<th scope="row" role="rowheader"><span class="gd-conference-cell-value">${heading}</span>
    ${record ? `<span class="gd-conference-card-record"><span>${escape(record.label)}</span> ${escape(record.value)}</span>` : ''}</th>`;
}

export function conferenceDataCell(label, content, {recordPart = false} = {}) {
  return `<td role="cell"${recordPart ? ' class="gd-conference-card-record-part"' : ''}>
    <span class="gd-conference-cell-label">${escape(label)}</span>
    <span class="gd-conference-cell-value">${content}</span></td>`;
}
