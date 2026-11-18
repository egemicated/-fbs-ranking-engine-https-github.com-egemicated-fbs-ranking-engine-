const missing = '—';

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return missing;
  const rounded = Number(value.toFixed(digits));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(digits);
}

export function formatProbability(value, digits = 2) {
  if (!Number.isFinite(value) || value < 0 || value > 1) return missing;
  const percentage = value * 100;
  const minimum = 10 ** -digits;
  if (percentage > 0 && percentage < minimum) return `<${minimum.toFixed(digits)}%`;
  return `${formatNumber(percentage, digits)}%`;
}

export function formatRecord(team) {
  if (![team?.wins, team?.losses].every(Number.isInteger) || team.wins < 0 || team.losses < 0) return missing;
  return `${team.wins}–${team.losses}${Number.isInteger(team.ties) && team.ties > 0 ? `–${team.ties}` : ''}`;
}

export function formatSigned(value, digits = 1, suffix = '') {
  if (!Number.isFinite(value)) return missing;
  const rounded = Number(value.toFixed(digits));
  return `${rounded < 0 ? '−' : rounded > 0 ? '+' : ''}${formatNumber(Math.abs(rounded), digits)}${suffix}`;
}

export function plural(count, singular, pluralForm = singular + 's') {
  return count === 1 ? singular : pluralForm;
}

export function indefiniteArticle(value) {
  const text = String(value ?? '').trim();
  return /^(?:8(?:\D|$)|11(?:\D|$)|18(?:\D|$)|[aeiou])/i.test(text) ? 'an' : 'a';
}
