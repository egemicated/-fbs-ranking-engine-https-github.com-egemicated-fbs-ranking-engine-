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
