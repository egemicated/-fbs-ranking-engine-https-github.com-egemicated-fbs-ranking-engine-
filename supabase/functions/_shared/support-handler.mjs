// Managed Edge runtime only. No service credential or email provider key reaches the browser.
export const SUPPORT_CATEGORY_LABELS = { general: 'General support', access: 'Account access', teams: 'Saved teams',
  contest: 'Contest issue', profile: 'Nickname or visibility', data: 'Data discrepancy', deletion: 'Account deletion' };
const categories = new Set(Object.keys(SUPPORT_CATEGORY_LABELS));
const guestCategories = new Set([...categories].filter(category => category !== 'deletion'));
const siteName = 'The Games Decide';
const customOrigin = 'https://www.thegamesdecide.com';
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function boundedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
const equalSecret = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || b.length < 32 || a.length > 512) return false;
  let delta = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) delta |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return delta === 0;
};
export function notificationMessage(row) {
  if (!safeId(row.id) || !safeId(row.requestId) || !categories.has(row.category) || !Number.isFinite(Date.parse(row.createdAt))) throw Error('invalid_notification');
  const url = new URL('/admin', customOrigin).href;
  const category = SUPPORT_CATEGORY_LABELS[row.category];
  const summary = `Request ${row.requestId}\nCategory: ${category}\nReceived: ${new Date(row.createdAt).toISOString()}\nReview: ${url}`;
  return { subject: `${siteName}: new support request`, text: summary,
    html: `<p>A support request is ready for review.</p><p>${escape(row.requestId)}<br>${escape(category)}<br>${escape(new Date(row.createdAt).toISOString())}</p><p><a href="${escape(url)}">Open secure administration</a></p>` };
}

export function createSupportHandler(env, { fetcher = fetch } = {}) {
  const site = new URL(env.SITE_URL || 'https://fbs-intelligence.onrender.com');
  const project = new URL(env.SUPABASE_URL || 'https://invalid.supabase.co');
  if (site.protocol !== 'https:' || project.protocol !== 'https:') throw Error('https_required');
  const allowedOrigins = new Set([site.origin, customOrigin]);
  const provider = env.SUPPORT_EMAIL_PROVIDER || (env.BREVO_API_KEY ? 'brevo' : 'resend');
  const configured = () => Boolean(['brevo', 'resend'].includes(provider) &&
    (provider === 'brevo' ? env.BREVO_API_KEY : env.RESEND_API_KEY) &&
    validEmail(env.SUPPORT_ADMIN_EMAIL) && validEmail(env.SUPPORT_FROM) && env.SUPABASE_SERVICE_ROLE_KEY);
  const rpc = async (name, payload) => {
    const response = await fetcher(new URL(`/rest/v1/rpc/${name}`, project), {
      method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error(`database_http_${response.status}`);
    return response.json();
  };
  async function notify() {
    if (!configured()) return { status: 503, body: { error: 'Notifications are awaiting email-delivery configuration. Requests remain saved.' } };
    const rows = await rpc('service_claim_support_notifications', { p_limit: 5 });
    if (!Array.isArray(rows) || rows.length > 5) throw Error('invalid_notification_batch');
    if (rows.some(row => !safeId(row.id) || !safeId(row.leaseToken))) throw Error('invalid_notification_lease');
    let delivered = 0;
    for (const row of rows) {
      let ok = false, providerId = null, failure = 'provider_unavailable';
      try {
        const message = notificationMessage(row);
        const deduplicationKey = `fbs-support-${row.id}`;
        const brevo = provider === 'brevo';
        const response = await fetcher(brevo ? 'https://api.brevo.com/v3/smtp/email' : 'https://api.resend.com/emails', { method: 'POST',
          headers: brevo ? { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' } :
            { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': deduplicationKey },
          body: JSON.stringify(brevo ? { sender: { name: siteName, email: env.SUPPORT_FROM },
            to: [{ email: env.SUPPORT_ADMIN_EMAIL }], replyTo: { email: env.SUPPORT_ADMIN_EMAIL, name: siteName },
            subject: message.subject, textContent: message.text, htmlContent: message.html,
            headers: { idempotencyKey: row.id }, tags: ['account-support'] } :
            { from: `${siteName} <${env.SUPPORT_FROM}>`, to: [env.SUPPORT_ADMIN_EMAIL], reply_to: env.SUPPORT_ADMIN_EMAIL, ...message }), signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const result = await response.json();
          const receipt = brevo ? result.messageId : result.id;
          if (brevo ? typeof receipt !== 'string' || receipt.length < 1 || receipt.length > 120 || /[\r\n]/.test(receipt) : !safeId(receipt)) throw Error('invalid_provider_receipt');
          ok = true; providerId = receipt;
        } else {
          // Brevo can explicitly acknowledge a previously accepted idempotency
          // key. Its deduplication window is finite; this is not exactly-once mail.
          const detail = brevo ? await response.json().catch(() => null) : null;
          if (brevo && response.status === 400 && detail?.code === 'duplicate_parameter' && /idempotency/i.test(detail.message || '')) {
            ok = true; providerId = `brevo-idempotent:${row.id}`;
          } else failure = `provider_http_${response.status}`;
        }
      } catch { failure = 'provider_unavailable'; }
      // Failure details are allowlisted codes, never provider bodies or request contents.
      await rpc('service_complete_support_notification', { p_notification_id: row.id, p_lease_token: row.leaseToken,
        p_succeeded: ok, p_provider_id: providerId, p_error_code: ok ? null : failure });
      if (ok) delivered++;
    }
    return { status: 202, body: { accepted: true, delivery: delivered === rows.length ? 'processed' : 'retry_pending' } };
  }
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (origin !== null && !allowedOrigins.has(origin)) return new Response(JSON.stringify({ error: 'Origin not permitted.' }), { status: 403, headers });
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-support-dispatch-secret' } });
    if (request.method !== 'POST') return respond(405, { error: 'POST required.' });
    try {
      if (!request.headers.get('content-type')?.includes('application/json') || Number(request.headers.get('content-length') || 0) > 8192) return respond(400, { error: 'Invalid request format.' });
      const raw = await boundedBody(request);
      if (raw === null) return respond(413, { error: 'Request is too large.' });
      let body; try { body = JSON.parse(raw); } catch { return respond(400, { error: 'Invalid JSON.' }); }
      if (body.action === 'dispatch') {
        if (!equalSecret(request.headers.get('x-support-dispatch-secret'), env.SUPPORT_DISPATCH_SECRET)) return respond(401, { error: 'Authorization required.' });
        const result = await notify(); return respond(result.status, result.body);
      }
      if (body.action === 'notify') {
        const authorization = request.headers.get('authorization') || '';
        if (!/^Bearer [^\s]+$/.test(authorization) || !env.SUPABASE_ANON_KEY) return respond(401, { error: 'Sign in required.' });
        const check = await fetcher(new URL('/auth/v1/user', project), { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization }, signal: AbortSignal.timeout(8000) });
        if (!check.ok) return respond(401, { error: 'Sign in required.' });
        const user = await check.json();
        if (!safeId(user.id) || user.is_anonymous === true) return respond(401, { error: 'Sign in required.' });
        const result = await notify(); return respond(result.status, result.body);
      }
      if (body.action !== 'request') return respond(400, { error: 'Unsupported action.' });
      // Public intake is deliberately unavailable until CAPTCHA and its configuration are verified.
      if (env.SUPPORT_GUEST_ENABLED !== 'true' || !env.TURNSTILE_SECRET_KEY || !env.SUPPORT_CLIENT_HASH_SECRET || env.SUPPORT_CLIENT_HASH_SECRET.length < 32) return respond(503, { error: 'Please use the published support email for sign-in problems.' });
      if (!validEmail(body.email) || !guestCategories.has(body.category) || typeof body.message !== 'string' || body.message.trim().length < 10 || body.message.length > 2000 || typeof body.captchaToken !== 'string' || body.captchaToken.length > 2048) return respond(400, { error: 'Check your email, category and request details.' });
      const verified = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST',
        body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: body.captchaToken }), signal: AbortSignal.timeout(8000) });
      const challenge = verified.ok ? await verified.json() : null;
      const expectedHostname = origin ? new URL(origin).hostname : site.hostname;
      if (challenge?.success !== true || challenge.hostname !== expectedHostname || challenge.action !== 'support') return respond(400, { error: 'Verification failed. Please try again.' });
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      if (!ip || ip.length > 128) return respond(503, { error: 'Support intake is temporarily unavailable.' });
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SUPPORT_CLIENT_HASH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
      const clientHash = [...signature].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const saved = await rpc('service_submit_guest_request', { p_email: body.email.trim().toLowerCase(), p_category: body.category,
        p_message: body.message.trim(), p_client_hash: clientHash });
      // Storage acknowledgement remains truthful even if delivery later needs a retry.
      try { await notify(); } catch { /* The durable outbox remains available for retry. */ }
      return respond(201, { id: saved.id, status: saved.status, createdAt: saved.createdAt });
    } catch { return respond(503, { error: 'The service is temporarily unavailable. Saved requests are retained for retry.' }); }
  };
}
