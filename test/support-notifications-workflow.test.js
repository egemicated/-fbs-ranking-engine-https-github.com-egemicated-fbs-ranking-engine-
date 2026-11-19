import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dispatchSupportNotifications } from '../scripts/dispatch-support-notifications.mjs';

const workflow = await readFile(new URL('../.github/workflows/support-notifications.yml', import.meta.url), 'utf8');

test('manual support workflow has no football publication trigger, write permission or unrelated credential', () => {
  assert.match(workflow, /^on: workflow_dispatch\s*$/m);
  assert.doesNotMatch(workflow, /^\s*(?:schedule|push|pull_request|pull_request_target|workflow_run|workflow_call|repository_dispatch):/m);
  assert.match(workflow, /^permissions:\r?\n  contents: read\s*$/m);
  assert.doesNotMatch(workflow, /:\s*write\s*$/m);
  const scriptReferences = [...workflow.matchAll(/\bscripts\/[\w./-]+/g)].map(match => match[0]);
  assert.deepEqual([...new Set(scriptReferences)], ['scripts/dispatch-support-notifications.mjs'],
    'Support dispatch must not invoke a football pull, publisher or a different script');
  assert.doesNotMatch(workflow, /\b(?:CFBD|ACCOUNT_SUPPORT_URL|SUPABASE_SERVICE_ROLE_KEY)\b/);
  assert.deepEqual([...workflow.matchAll(/\$\{\{\s*secrets\.([^\s}]+)\s*\}\}/g)].map(match => match[1]),
    ['SUPPORT_DISPATCH_SECRET']);
  assert.match(workflow, /^        env:\r?\n          SUPPORT_DISPATCH_SECRET:/m,
    'The private credential belongs only to the dispatch step');
  assert.doesNotMatch(workflow, /(?:echo|printenv|env)\s+[^\n]*\$SUPPORT_DISPATCH_SECRET/);
});

test('manual dispatch sends only an action to the fixed service and returns no provider or user payload', async () => {
  const secret = 'workflow-isolation-test-'.padEnd(40, 'x');
  const calls = [];
  const result = await dispatchSupportNotifications({ env: { SUPPORT_DISPATCH_SECRET: secret },
    fetcher: async (url, init) => {
      calls.push(String(url));
      assert.equal(String(url), 'https://egxyfyorggwnrnmirrax.supabase.co/functions/v1/account-support');
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { action: 'dispatch' });
      assert.deepEqual(init.headers, { 'Content-Type': 'application/json', 'x-support-dispatch-secret': secret });
      return new Response(JSON.stringify({ accepted: true, delivery: 'processed',
        privateRequest: 'must-not-return', picks: ['must-not-return'], credentials: secret }));
    } });
  assert.equal(calls.length, 1);
  assert.deepEqual(result, { configured: true, delivery: 'processed' });
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes('must-not-return'));
});
