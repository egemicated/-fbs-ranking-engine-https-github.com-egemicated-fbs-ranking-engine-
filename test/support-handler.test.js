import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportHandler, notificationMessage, SUPPORT_CATEGORY_LABELS } from '../supabase/functions/_shared/support-handler.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const ticket = '22222222-2222-4222-8222-222222222222';
const receipt = '33333333-3333-4333-8333-333333333333';
const row = { id, requestId: ticket, category: 'contest', createdAt: '2026-11-19T00:00:00Z', leaseToken: receipt };
const env = { SITE_URL: 'https://fbs.example', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'publishable-test',
  SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', RESEND_API_KEY: 'provider-test-key', SUPPORT_FROM: 'support@fbs.example',
  SUPPORT_ADMIN_EMAIL: 'admin@fbs.example', SUPPORT_DISPATCH_SECRET: 'test-only-dispatch-secret-32-characters' };
const request = (body, headers = {}) => new Request('https://project.supabase.co/functions/v1/account-support', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: env.SITE_URL, ...headers }, body: JSON.stringify(body),
});
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function transport({ providerStatus = 200, userStatus = 200 } = {}) {
  const calls = [];
  return { calls, fetcher: async (target, options = {}) => {
    const url = String(target); calls.push({ url, ...options });
    if (url.endsWith('/auth/v1/user')) return response({ id, is_anonymous: false }, userStatus);
    if (url.endsWith('/service_claim_support_notifications')) return response([row]);
    if (url.endsWith('/service_complete_support_notification')) return response({ id, status: providerStatus === 200 ? 'sent' : 'pending' });
    if (url.endsWith('/service_submit_guest_request')) return response({ id: ticket, status: 'open', createdAt: row.createdAt });
    if (url === 'https://api.resend.com/emails') return response({ id: receipt }, providerStatus);
    if (url.includes('challenges.cloudflare.com')) return response({ success: true, hostname: 'fbs.example', action: 'support' });
    throw Error('Unexpected network destination');
  } };
}

test('support dispatch rejects unauthorized callers before accessing private queue', async () => {
  const network = transport(), handler = createSupportHandler(env, network);
  assert.equal((await handler(request({ action: 'dispatch' }))).status, 401);
  assert.equal((await handler(request({ action: 'notify' }))).status, 401);
  assert.equal(network.calls.length, 0);
});

test('notification delivery is disabled without complete configuration and consumes no lease', async () => {
  const network = transport(), handler = createSupportHandler({ ...env, RESEND_API_KEY: '' }, network);
  const result = await handler(request({ action: 'dispatch' }, { 'x-support-dispatch-secret': env.SUPPORT_DISPATCH_SECRET }));
  assert.equal(result.status, 503); assert.equal(network.calls.length, 0);
});

test('notification uses provider idempotency and contains no private message or submitting email', async () => {
  const network = transport(), handler = createSupportHandler(env, network);
  const result = await handler(request({ action: 'dispatch' }, { 'x-support-dispatch-secret': env.SUPPORT_DISPATCH_SECRET }));
  assert.equal(result.status, 202);
  const send = network.calls.find(call => call.url === 'https://api.resend.com/emails');
  assert.equal(send.headers['Idempotency-Key'], `fbs-support-${id}`);
  const mail = JSON.parse(send.body); assert.deepEqual(mail.to, [env.SUPPORT_ADMIN_EMAIL]);
  assert.equal(mail.from, `FBS Intelligence <${env.SUPPORT_FROM}>`); assert.equal(mail.reply_to, env.SUPPORT_ADMIN_EMAIL);
  assert.ok(mail.text.includes(ticket) && mail.text.includes('https://fbs.example/#admin'));
  assert.ok(!send.body.includes('lease') && !send.body.includes('server-test-key'));
  const completed = JSON.parse(network.calls.find(call => call.url.endsWith('/service_complete_support_notification')).body);
  assert.equal(completed.p_succeeded, true); assert.equal(completed.p_provider_id, receipt);
  assert.equal((await result.json()).delivery, 'processed');
});

test('provider failure records an allowlisted retry code without response details', async () => {
  const network = transport({ providerStatus: 429 }), handler = createSupportHandler(env, network);
  const result = await handler(request({ action: 'dispatch' }, { 'x-support-dispatch-secret': env.SUPPORT_DISPATCH_SECRET }));
  const completed = JSON.parse(network.calls.find(call => call.url.endsWith('/service_complete_support_notification')).body);
  assert.equal(completed.p_succeeded, false); assert.equal(completed.p_error_code, 'provider_http_429');
  assert.equal((await result.json()).delivery, 'retry_pending');
});

test('a forged or expired user token cannot process notifications', async () => {
  const network = transport({ userStatus: 401 }), handler = createSupportHandler(env, network);
  const result = await handler(request({ action: 'notify' }, { Authorization: 'Bearer stale-token' }));
  assert.equal(result.status, 401); assert.equal(network.calls.length, 1);
});

test('a verified signed-in caller can trigger delivery but receives no private queue rows', async () => {
  const network = transport(), handler = createSupportHandler(env, network);
  const result = await handler(request({ action: 'notify' }, { Authorization: 'Bearer current-token' }));
  const body = await result.json(); assert.equal(result.status, 202);
  assert.deepEqual(body, { accepted: true, delivery: 'processed' });
  assert.ok(!JSON.stringify(body).includes(ticket));
});

test('public guest intake fails closed unless abuse controls are explicitly configured', async () => {
  const network = transport(), handler = createSupportHandler(env, network);
  assert.equal((await handler(request({ action: 'request' }))).status, 503);
  assert.equal(network.calls.length, 0);
});

test('verified guest intake stores a salted client hash and acknowledges storage despite pending email setup', async () => {
  const network = transport(), handler = createSupportHandler({ ...env, RESEND_API_KEY: '', SUPPORT_GUEST_ENABLED: 'true',
    TURNSTILE_SECRET_KEY: 'captcha-server-secret', SUPPORT_CLIENT_HASH_SECRET: 'private-salt-at-least-32-characters' }, network);
  const result = await handler(request({ action: 'request', email: 'guest@fbs.example', category: 'access',
    message: 'I cannot access my account.', captchaToken: 'verified-token' }, { 'x-forwarded-for': '192.0.2.10' }));
  assert.equal(result.status, 201);
  const save = network.calls.find(call => call.url.endsWith('/service_submit_guest_request'));
  assert.match(JSON.parse(save.body).p_client_hash, /^[a-f0-9]{64}$/);
  assert.ok(!save.body.includes('192.0.2.10'));
  assert.deepEqual(await result.json(), { id: ticket, status: 'open', createdAt: row.createdAt });
});

test('CORS, method and oversized payload checks run before privileged operations', async () => {
  const network = transport(), handler = createSupportHandler(env, network);
  assert.equal((await handler(request({ action: 'dispatch' }, { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await handler(new Request('https://project.supabase.co/functions/v1/account-support'))).status, 405);
  assert.equal((await handler(request({ message: 'x'.repeat(9000) }))).status, 413);
  assert.equal(network.calls.length, 0);
});

test('message construction rejects invalid trusted queue fields rather than reflecting arbitrary content', () => {
  assert.throws(() => notificationMessage({ ...row, category: '<script>' }, env.SITE_URL));
  const mail = notificationMessage({ ...row, message: 'private details', email: 'private@fbs.example' }, env.SITE_URL);
  assert.ok(!JSON.stringify(mail).includes('private'));
  for (const category of Object.keys(SUPPORT_CATEGORY_LABELS)) assert.ok(notificationMessage({ ...row, category }, env.SITE_URL).text.includes(SUPPORT_CATEGORY_LABELS[category]));
});

test('oversized streamed bodies are canceled before JSON parsing or privileged work', async () => {
  const network = transport(), handler = createSupportHandler(env, network);
  let canceled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(4096)); }, cancel() { canceled = true; } });
  const incoming = new Request('https://project.supabase.co/functions/v1/account-support', { method: 'POST',
    headers: { Origin: env.SITE_URL, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' });
  assert.equal((await handler(incoming)).status, 413);
  assert.equal(canceled, true); assert.equal(network.calls.length, 0);
});

test('Brevo uses its own API contract and opaque message ID instead of a Resend UUID', async () => {
  const network = transport(), calls = [];
  const handler = createSupportHandler({ ...env, SUPPORT_EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'brevo-server-test' }, {
    fetcher: async (url, init) => {
      if (String(url) === 'https://api.brevo.com/v3/smtp/email') {
        calls.push(init); return response({ messageId: '<receipt@smtp-relay.mailin.fr>' }, 201);
      }
      return network.fetcher(url, init);
    },
  });
  assert.equal((await handler(request({ action: 'dispatch' }, { 'x-support-dispatch-secret': env.SUPPORT_DISPATCH_SECRET }))).status, 202);
  const sent = JSON.parse(calls[0].body);
  assert.equal(calls[0].headers['api-key'], 'brevo-server-test');
  assert.equal(sent.headers.idempotencyKey, id);
  assert.equal(sent.sender.email, env.SUPPORT_FROM); assert.equal(sent.replyTo.email, env.SUPPORT_ADMIN_EMAIL);
  assert.ok(sent.textContent.includes(ticket));
  const completed = JSON.parse(network.calls.find(call => call.url.endsWith('/service_complete_support_notification')).body);
  assert.equal(completed.p_provider_id, '<receipt@smtp-relay.mailin.fr>');
});

test('Brevo explicit idempotency acknowledgement does not become a misleading delivery failure', async () => {
  const network = transport();
  const handler = createSupportHandler({ ...env, SUPPORT_EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'brevo-server-test' }, {
    fetcher: (url, init) => String(url) === 'https://api.brevo.com/v3/smtp/email' ?
      response({ code: 'duplicate_parameter', message: 'Email for this idempotency key already processed' }, 400) : network.fetcher(url, init),
  });
  const result = await handler(request({ action: 'dispatch' }, { 'x-support-dispatch-secret': env.SUPPORT_DISPATCH_SECRET }));
  assert.equal((await result.json()).delivery, 'processed');
  const completed = JSON.parse(network.calls.find(call => call.url.endsWith('/service_complete_support_notification')).body);
  assert.equal(completed.p_succeeded, true); assert.match(completed.p_provider_id, /^brevo-idempotent:/);
});

test('Brevo receipts respect the database storage bound before marking a notification accepted', async () => {
  for (const length of [120, 121]) {
    const network = transport();
    const handler = createSupportHandler({ ...env, SUPPORT_EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'brevo-server-test' }, {
      fetcher: (url, init) => String(url) === 'https://api.brevo.com/v3/smtp/email' ?
        response({ messageId: 'r'.repeat(length) }, 201) : network.fetcher(url, init),
    });
    await handler(request({ action: 'dispatch' }, { 'x-support-dispatch-secret': env.SUPPORT_DISPATCH_SECRET }));
    const completed = JSON.parse(network.calls.find(call => call.url.endsWith('/service_complete_support_notification')).body);
    assert.equal(completed.p_succeeded, length === 120);
    assert.equal(completed.p_provider_id, length === 120 ? 'r'.repeat(length) : null);
  }
});
