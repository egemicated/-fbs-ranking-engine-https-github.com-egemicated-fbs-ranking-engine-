import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contentSecurityPolicy, applySecurityMetadata, securityResponseHeaders, SUPABASE_BROWSER_SCRIPT } from '../src/security-policy.js';

const options = { authUrl: 'https://egxyfyorggwnrnmirrax.supabase.co' };
test('static policy allows only the pinned SDK and required existing network hosts', async () => {
  const policy = contentSecurityPolicy(options);
  const script = policy.split('; ').find(row => row.startsWith('script-src '));
  assert.equal(script, `script-src 'self' ${SUPABASE_BROWSER_SCRIPT}`);
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(script));
  assert.match(policy, /connect-src 'self' https:\/\/egxyfyorggwnrnmirrax\.supabase\.co wss:\/\/egxyfyorggwnrnmirrax\.supabase\.co https:\/\/site\.api\.espn\.com/);
  assert.match(policy, /worker-src 'self'/);
  assert.match(policy, /img-src 'self' data: blob:/);
  assert.match(policy, /font-src 'self'/);
  const loader = await readFile(new URL('../frontend/bracket-auth.js', import.meta.url), 'utf8');
  assert.ok(loader.includes(SUPABASE_BROWSER_SCRIPT), 'SDK URL changes require a reviewed matching policy');
});

test('policy rejects injected, arbitrary, insecure or credential-bearing Auth origins', () => {
  for (const authUrl of ['http://egxyfyorggwnrnmirrax.supabase.co', 'https://example.com',
    'https://user:password@egxyfyorggwnrnmirrax.supabase.co',
    'https://egxyfyorggwnrnmirrax.supabase.co/path', 'https://egxyfyorggwnrnmirrax.supabase.co?x=y',
    'https://egxyfyorggwnrnmirrax.supabase.co/#x', 'https://egxyfyorggwnrnmirrax.supabase.co;script-src *']) {
    assert.throws(() => contentSecurityPolicy({ authUrl }));
  }
  assert.throws(() => contentSecurityPolicy({ authUrl: 'http://127.0.0.1:54321' }));
  assert.match(contentSecurityPolicy({ authUrl: 'http://127.0.0.1:54321', allowLocalAuth: true }), /http:\/\/127\.0\.0\.1:54321/);
});

test('security metadata precedes scripts, preserves content and is safely idempotent', () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Team</title><script type="module" src="/app.js"></script></head><body><main>Existing content</main></body></html>';
  const first = applySecurityMetadata(html, options), second = applySecurityMetadata(first, options);
  assert.equal(second, first);
  assert.equal((second.match(/http-equiv="Content-Security-Policy"/g) ?? []).length, 1);
  assert.equal((second.match(/name="referrer"/g) ?? []).length, 1);
  assert.ok(second.indexOf('Content-Security-Policy') < second.indexOf('<script'));
  assert.match(second, /<main>Existing content<\/main>/);
  assert.ok(!second.includes('frame-ancestors'), 'Meta delivery cannot claim anti-framing enforcement');
  assert.match(second, /content="no-referrer"/);
  assert.throws(() => applySecurityMetadata('<head></head>', options));
  assert.throws(() => applySecurityMetadata(html.replace('<title>', '<meta name="referrer" content="origin"><title>'), options), /Review existing/);
});

test('real response-header policy adds anti-framing and device-permission restrictions', () => {
  const headers = securityResponseHeaders(options);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
});
