import { legacyRouteFromHash, routeFromUrl, routeHref } from './clean-routes.js';
import { PUBLIC_SITE_ORIGIN } from './page-routes.js';

const legacyOrigin = 'https://fbs-intelligence.onrender.com';
const previewHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const publicOrigins = new Set([PUBLIC_SITE_ORIGIN, 'https://thegamesdecide.com', legacyOrigin]);
const footballPages = new Set(['team', 'scoreboard', 'compare']);
const scheduleNote = 'Downloaded events do not automatically follow schedule changes.';
const textEncoder = new TextEncoder();
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function utcDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z' : null;
}

function calendarText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/[;,]/g, '\\$&');
}

export function publicFootballPageUrl(href) {
  if (typeof href !== 'string' || !href) return null;
  try {
    const base = new URL('/', globalThis.location?.origin ?? PUBLIC_SITE_ORIGIN);
    const page = new URL(href, base);
    const preview = ['http:', 'https:'].includes(base.protocol) && previewHosts.has(base.hostname) && page.origin === base.origin;
    if ((!preview && !publicOrigins.has(page.origin)) || page.username || page.password) return null;
    const route = page.hash && page.pathname === '/' ? legacyRouteFromHash(page.hash) : routeFromUrl(page);
    const [section, view, a, b] = route?.split('/') ?? [];
    if (!footballPages.has(section) || (view === 'matchup' && (!a || !b || a === b))) return null;
    const path = routeHref(route);
    return path ? PUBLIC_SITE_ORIGIN + path : null;
  } catch {
    return null;
  }
}

function foldLine(value) {
  let line = '';
  let length = 0;
  for (const character of value) {
    const width = textEncoder.encode(character).length;
    if (length + width > 75) {
      line += '\r\n ';
      length = 1;
    }
    line += character;
    length += width;
  }
  return line;
}

export function kickoffEvent({ id, startDate, startTimeTbd, awayName, homeName, href, asOf, status, neutral = false } = {}) {
  if (startTimeTbd !== false || (status && status !== 'scheduled') || !/^\d{1,24}$/.test(String(id)) ||
      typeof awayName !== 'string' || !awayName.trim() || typeof homeName !== 'string' || !homeName.trim()) return null;
  const start = utcDate(startDate);
  const page = publicFootballPageUrl(href);
  if (!start || !page) return null;
  const title = awayName.trim() + (neutral ? ' vs. ' : ' at ') + homeName.trim();
  const added = utcDate(asOf) ?? utcDate(new Date().toISOString());
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Games Decide//College Football Schedule//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:college-football-' + id + '@fbs-intelligence.onrender.com',
    'DTSTAMP:' + added,
    'DTSTART:' + start,
    'SUMMARY:' + calendarText(title),
    'DESCRIPTION:' + calendarText('Matchup: ' + page + '\n' + scheduleNote),
    'URL:' + page,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].map(foldLine).join('\r\n');
}

const calendarIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';

export function kickoffCalendar(game) {
  if (!game || (game.status && game.status !== 'scheduled')) return '';
  if (game.startTimeTbd !== false || !utcDate(game.startDate)) {
    return '<span class="kickoff-calendar-pending">Time pending</span>';
  }
  const calendar = kickoffEvent(game);
  if (!calendar) return '';
  return `<details class="kickoff-calendar"><summary class="share-calendar-button">${calendarIcon}<span>Calendar</span></summary>
    <div class="kickoff-calendar-detail"><a href="data:text/calendar;charset=utf-8,${encodeURIComponent(calendar)}" download="fbs-kickoff-${escapeHtml(game.id)}.ics">Download event (.ics)</a>
    <p>${scheduleNote}</p></div></details>`;
}
