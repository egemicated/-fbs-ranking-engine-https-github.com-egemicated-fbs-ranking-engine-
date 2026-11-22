const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

// HTML slots accept rendered components from the calling view. Ordinary text
// props are escaped here so both sports can use the same presentation safely.
export function pageHero({
  sport, category, variant = 'interior', title, headingHtml, highlight, eyebrow, description,
  metadata = '', actions = '', aside = '', breadcrumb = '', className = '', attributes = '',
}) {
  const classes = ['gd-page-hero', 'gd-page-hero--' + variant, className].filter(Boolean).join(' ');
  return `<header class="${escapeHtml(classes)}" data-hero-sport="${escapeHtml(sport)}"${category ? ` data-hero-category="${escapeHtml(category)}"` : ''}${attributes ? ' ' + attributes : ''}>
    <div class="wrap gd-hero-layout${aside ? ' gd-hero-layout--split' : ''}">
      <div class="gd-hero-text">${breadcrumb}
        ${eyebrow ? `<p class="gd-eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
        <h1>${headingHtml ?? escapeHtml(title)}${highlight ? ` <em>${escapeHtml(highlight)}</em>` : ''}</h1>
        ${description ? `<p class="gd-hero-description">${escapeHtml(description)}</p>` : ''}
        ${metadata ? `<div class="gd-hero-meta">${metadata}</div>` : ''}
        ${actions ? `<div class="gd-hero-actions">${actions}</div>` : ''}
      </div>${aside}
    </div>
  </header>`;
}

export const platformEmpty = message => `<p class="gd-empty">${escapeHtml(message)}</p>`;

export function rankingComparisonTable({ caption, columns, renderTeam }) {
  const rows = Array.from({ length: 25 }, (_, index) => {
    const rank = index + 1;
    const cells = columns.map(({ teams }) => `<td>${teams.filter(team => team.rank === rank).map(renderTeam).join('') || '—'}</td>`);
    return `<tr><th scope="row">${rank}</th>${cells.join('')}</tr>`;
  }).join('');
  return `<div class="table-scroll"><table class="edition-table poll-rank-table">
    <caption class="sr-only">${escapeHtml(caption)}</caption>
    <thead><tr><th scope="col">Rank</th>${columns.map(({ label }) => `<th scope="col">${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function matchupTeamCard({ side, heading, context = '', picker, strength = '', attributes = '' }) {
  return `<section class="panel compare-picker team-accent-card" data-matchup-side="${side}"${attributes ? ' ' + attributes : ''}>
    <div class="section-label">Team ${side.toUpperCase()}</div><h2>${heading}</h2>
    ${context ? `<p class="compare-team-context">${context}</p>` : ''}
    ${picker}
    ${strength ? `<p class="compare-team-strength">${strength}</p>` : ''}
  </section>`;
}
