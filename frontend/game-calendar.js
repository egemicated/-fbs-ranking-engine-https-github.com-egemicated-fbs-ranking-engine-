import { canonicalPath } from './page-routes.js';

const liveOrigin = 'https://fbs-intelligence.onrender.com';
const previewHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const publicPath = /^#(?:team(?:\/[\w-]+)*|scoreboard(?:\/[\w-]+)*|compare(?:\/matchup(?:\/\d+){2}\/(?:neutral|home|away)|\/weekly(?:\/fcs)?(?:\/(?:(?:regular|postseason):)?\d+)?(?:\/\d+)?)?)$/;
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
  try {
    const base = new URL('/', globalThis.location?.origin ?? liveOrigin);
    const page = new URL(href, base);
    const preview = previewHosts.has(base.hostname);
    const allowedOrigin = page.origin === base.origin || (preview && page.origin === liveOrigin);
    const matchup = /^#compare\/matchup\/(\d+)\/(\d+)\//.exec(page.hash);
    if (matchup && matchup[1] === matchup[2]) return null;
    if (allowedOrigin && /^\/team\/\d{1,24}\/$/.test(page.pathname) && !page.hash) return (preview ? liveOrigin : base.origin) + page.pathname;
    if (allowedOrigin && page.pathname === '/' && /^#team\/\d{1,24}$/.test(page.hash)) {
      return (preview ? liveOrigin : base.origin) + canonicalPath(page.hash);
    }
    return allowedOrigin && page.pathname === '/' && publicPath.test(page.hash)
      ? (preview ? liveOrigin : base.origin) + '/' + page.hash : null;
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
    'PRODID:-//FBS Intelligence//College Football Schedule//EN',
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
