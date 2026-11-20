export const competition = Object.freeze({
  id: 'ncaam-d1', name: 'College Basketball', label: 'NCAA Division I · Men’s Basketball', entry: '/basketball/',
});
export const sports = Object.freeze([
  { id: 'football', name: 'Football', entry: '/football/' },
  { id: 'basketball', name: 'Basketball', entry: competition.entry },
]);
export const nav = [
  ['Home', ''], ['Rankings','rankings'], ['Teams','teams'], ['Scores','scoreboard'], ['Matchup Lab','matchup-lab'],
  ['Conferences','conferences'], ['Daily Picks','picks'], ['Model Report','model-reports'], ['Ranking History','ranking-history'],
  ['March Madness','march-madness'], ['Methodology','methodology'], ['Beat the Model','contest'],
];
export const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
export const seasonLabel = year => `${year - 1}–${String(year).slice(-2)}`;
export const mtDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric',
});
const mtTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
export const stamp = value => value && Number.isFinite(Date.parse(value))
  ? `${mtDate.format(new Date(value))} · ${mtTime.format(new Date(value))}` : 'Unavailable';
const mtDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', dateStyle: 'short' });
export const dayKey = value => mtDay.format(new Date(value));
export const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
export const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
export const ordinal = value => Number.isFinite(value) ? `#${value}` : '—';
export const teamRecord = team => team ? `${team.wins ?? 0}–${team.losses ?? 0}` : '—';
export const has = (row, value) => `${row?.name ?? ''} ${row?.mascot ?? ''} ${row?.conference ?? ''}`.toLocaleLowerCase()
  .includes(value.toLocaleLowerCase());
export const accent = team => /^#[0-9a-f]{6}$/i.test(team?.color) ? team.color : '#1689c1';
export function basketballHref(view = '', params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([,value]) => value !== undefined && value !== null && value !== ''));
  return `/basketball/${view ? view.replace(/\/$/, '') + '/' : ''}${query.size ? '?' + query : ''}`;
}
export const teamHref = (id, season) => basketballHref('teams/' + encodeURIComponent(id), { season });
export const matchupHref = (a, b, season, venue = 'neutral') => basketballHref('matchup-lab', { a,b,season,venue });
export const action = (href, text, secondary = false) =>
  `<a class="fc-action${secondary ? ' fc-secondary' : ''}" href="${escape(href)}">${escape(text)}</a>`;
export function teamIdentity(team) {
  const school = team?.name ?? 'Unknown team';
  return `<span class="fc-team-name"><span>${escape(school)}</span>${team?.mascot ? `<strong>${escape(team.mascot)}</strong>` : ''}</span>`;
}
export function teamLink(team, season) {
  return team?.id ? `<a class="fc-team-link" href="${teamHref(team.id, season)}">${teamIdentity(team)}</a>` : teamIdentity(team);
}
export function shell(active, current = '', season, profile = null, subnav = true) {
  const mainNav = active === 'basketball' && subnav ? `<nav class="fc-sections" aria-label="Basketball"><div class="wrap">
    ${nav.slice(0,6).map(([label, path]) => `<a href="${basketballHref(path, {season})}"${current === path ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
    <details><summary${nav.slice(6).some(([,path]) => path === current) ? ' class="fc-active"' : ''}>More <span aria-hidden="true">⌄</span></summary>
    <div>${nav.slice(6).map(([label, path]) => `<a href="${basketballHref(path,{season})}"${current === path ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div></details>
  </div></nav>` : '';
  return `<header class="fc-masthead"><div class="wrap fc-masthead-grid">
    <nav class="fc-sports" aria-label="Switch sport">${sports.map(sport =>
      `<a class="fc-sport-${sport.id}" href="${sport.entry}"${active === sport.id ? ' aria-current="page"' : ''}>
      <i aria-hidden="true"></i><span>${sport.name}</span></a>`).join('')}</nav>
    <a class="fc-logo" href="/" aria-label="The Games Decide home"><img src="/assets/the-games-decide-logo.webp" alt="The Games Decide" width="440" height="105"></a>
    <a class="fc-profile" href="/preview-profile/">${profile ? 'Preview profile' : 'Local profile'}</a>
  </div></header>${mainNav}`;
}
export function html({ title, active = 'basketball', current, season, profile, body, script = '', description }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="theme-color" content="#091833">
<meta name="description" content="${escape(description ?? title)}"><title>${escape(title)} · The Games Decide</title>
<link rel="icon" href="/assets/the-games-decide-icon.png"><link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/basketball-preview/preview.css">${script}</head><body class="fc-preview">
<a class="skip-link" href="#main">Skip to content</a>${shell(active,current,season,profile)}
<main id="main" tabindex="-1">${body}</main>
<footer class="fc-footer"><div class="wrap"><a href="/">The Games Decide</a><p>Results over reputation.</p>
<a href="${basketballHref('methodology', {season})}">Basketball methodology</a></div></footer></body></html>`;
}
export const banner = (title, summary, kicker = competition.label) => `<header class="fc-banner"><div class="wrap">
  <p class="fc-kicker">${escape(kicker)}</p><h1>${escape(title)}</h1><p>${escape(summary)}</p></div></header>`;
export const panel = (heading, contents, note = '') => `<section class="fc-panel">
  <header><h2>${escape(heading)}</h2>${note ? `<p>${escape(note)}</p>` : ''}</header><div class="fc-panel-body">${contents}</div></section>`;
export const empty = message => `<p class="fc-empty">${escape(message)}</p>`;
export const metric = (label, value, note = '') => `<div class="fc-metric"><span>${escape(label)}</span>
<strong>${escape(value)}</strong>${note ? `<small>${escape(note)}</small>` : ''}</div>`;
export const option = (value,label,selected) =>
  `<option value="${escape(value)}"${String(selected) === String(value) ? ' selected' : ''}>${escape(label)}</option>`;
export const input = (name, label, value, type = 'text') =>
  `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}"></label>`;
export const selector = (name,label,options,value) =>
  `<label>${escape(label)}<select name="${name}">${options.map(([id,text])=>option(id,text,value)).join('')}</select></label>`;
