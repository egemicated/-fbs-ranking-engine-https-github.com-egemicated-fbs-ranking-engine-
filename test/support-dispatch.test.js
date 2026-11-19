import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchSupportNotifications } from '../scripts/dispatch-support-notifications.mjs';

test('unconfigured retry performs no network request', async () => {
  const result = await dispatchSupportNotifications({ env: {}, fetcher: () => { throw Error('Unexpected request'); } });
  assert.equal(result.configured, false);
});
test('retry secret can only be sent to the fixed existing project endpoint', async () => {
  await assert.rejects(dispatchSupportNotifications({ env: { SUPPORT_DISPATCH_SECRET: 'x'.repeat(32), ACCOUNT_SUPPORT_URL: 'https://evil.example/collect' }, fetcher: () => { throw Error('Unexpected request'); } }), /destination/);
});
test('retry preserves service acknowledgement and never returns credentials', async () => {
  const secret = 'x'.repeat(32);
  const result = await dispatchSupportNotifications({ env: { SUPPORT_DISPATCH_SECRET: secret }, fetcher: async (url, init) => {
    assert.equal(url.hostname, 'egxyfyorggwnrnmirrax.supabase.co');
    assert.equal(init.headers['x-support-dispatch-secret'], secret);
    return new Response(JSON.stringify({ accepted: true, delivery: 'retry_pending' }));
  } });
  assert.deepEqual(result, { configured: true, delivery: 'retry_pending' });
  assert.ok(!JSON.stringify(result).includes(secret));
});
