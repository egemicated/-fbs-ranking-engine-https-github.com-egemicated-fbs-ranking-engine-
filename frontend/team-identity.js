import { myTeamColors } from './my-team-colors.js?v=2026';
import { teamNames } from './team-name-data.js';

const normalize = label => label.trim().normalize('NFC').toLowerCase();
const byId = new Map();
const bySchool = new Map();
const defaultAccent = '#1689c1';
const escape = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

for (const [id, school, nickname] of teamNames) {
  const key = normalize(school);
  const row = { id, school, nickname, key, fullKey: normalize(`${school} ${nickname}`) };
  byId.set(id, row);
  bySchool.set(key, bySchool.has(key) ? null : row);
}

export function teamNameParts(id, name) {
  const school = typeof name === 'string' ? name : '';
  const key = normalize(school);
  const row = id == null ? bySchool.get(key) : byId.get(String(id));
  if (row && (row.key === key || row.fullKey === key)) return { school: row.school, nickname: row.nickname };
  return { school, nickname: '' };
}

export function teamDisplayName(id, name) {
  const { school, nickname } = teamNameParts(id, name);
  return nickname ? `${school} ${nickname}` : school;
}

export function teamNameMarkup(id, name, mascot) {
  const { school, nickname } = typeof name === 'string' && typeof mascot === 'string' && mascot
    ? { school: name, nickname: mascot } : teamNameParts(id, name);
  if (!nickname) return escape(school);
  return `<span class="team-identity-name"><span class="team-school">${escape(school)}</span> <strong class="team-nickname">${escape(nickname)}</strong></span>`;
}

export function teamAccent(id) {
  const color = myTeamColors[id];
  return /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : defaultAccent;
}

export function teamAccentAttr(id, color) {
  return `style="--team-accent:${/^#[0-9a-f]{6}$/i.test(color ?? '') ? color : teamAccent(id)}"`;
}
