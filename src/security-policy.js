// Browser security policy for the existing static application. Meta CSP cannot
// enforce frame-ancestors; that needs a real hosting response header.
export const SUPABASE_BROWSER_SCRIPT = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
const htmlEscape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function authOrigin(value, allowLocalAuth) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Auth policy requires a bare trusted origin');
  const hosted = url.protocol === 'https:' && /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) && !url.port;
  const local = allowLocalAuth === true && ['http:', 'https:'].includes(url.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!hosted && !local) throw Error('Auth policy requires a Supabase project origin or explicit local-test origin');
  return url.origin;
}

export function contentSecurityPolicy({ authUrl, allowLocalAuth = false } = {}) {
  const auth = authOrigin(authUrl, allowLocalAuth);
  const websocket = auth.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    `script-src 'self' ${SUPABASE_BROWSER_SCRIPT}`,
    "script-src-attr 'none'",
    // Existing team-color variables and metric bars use inline style attributes.
    // This exception never enables inline JavaScript or eval.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${auth} ${websocket} https://site.api.espn.com`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "form-action 'self'",
  ].join('; ');
}

export function applySecurityMetadata(html, options) {
  if (typeof html !== 'string' || !/<head\b/i.test(html) || !/<meta\s+charset\s*=/i.test(html)) throw Error('Security metadata requires an HTML head and charset');
  const policy = `<meta http-equiv="Content-Security-Policy" content="${htmlEscape(contentSecurityPolicy(options))}" data-fbs-security="true">`;
  const referrer = '<meta name="referrer" content="no-referrer" data-fbs-security="true">';
  // Never silently replace another owner's policy with a weaker one.
  const existing = html.match(/<meta\b[^>]*(?:http-equiv\s*=\s*["']Content-Security-Policy["']|name\s*=\s*["']referrer["'])[^>]*>/gi) ?? [];
  if (existing.some(tag => !tag.includes('data-fbs-security="true"'))) throw Error('Review existing security metadata before adding a policy');
  const clean = html.replace(/<meta\b[^>]*data-fbs-security="true"[^>]*>\s*/gi, '');
  return clean.replace(/(<meta\s+charset\s*=[^>]+>)\s*/i, `$1\n  ${policy}\n  ${referrer}\n  `);
}

export function securityResponseHeaders(options) {
  // Use only when the actual HTTP server/hosting configuration can set headers.
  return {
    'Content-Security-Policy': `${contentSecurityPolicy(options)}; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
