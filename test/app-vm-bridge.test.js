import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appVmSource, installAppVmContext } from '../test-support/app-vm.mjs';
import { isAccountCallbackUrl, pendingAccountRoute } from '../frontend/bracket-auth.js?v=clean-routes';
import { navigateApp, replaceLegacyAppUrl } from '../frontend/clean-navigation.js';

test('app VM bridge permits only the known static imports and preserves dynamic imports',async()=>{
  const source=await readFile('frontend/app.js','utf8'),script=appVmSource(source);
  assert.match(script,/import\('\.\/share-card\.js/);
  assert.throws(()=>appVmSource(source+'\nimport extra from "./unexpected.js";'),/Unexpected static/);
  assert.throws(()=>appVmSource(source.replace('safeAccountReturnPath }','safeAccountReturnPath, unexpected }')),/known application import/);
});

test('VM browser fixtures receive actual route helpers and keep path, state and events in sync',()=>{
  const context={location:{hash:'#rankings'},window:{}};
  installAppVmContext(context);
  assert.equal(context.isAccountCallbackUrl,isAccountCallbackUrl);
  assert.equal(context.pendingAccountRoute,pendingAccountRoute);
  assert.equal(context.location.href,'https://example.test/#rankings');
  assert.equal(replaceLegacyAppUrl(context.window), true);
  assert.equal(context.location.href,'https://example.test/rankings');
  assert.equal(context.history.length, 1);
  const events = [];
  context.window.addEventListener('app:navigate', event => events.push(event.detail.route));
  context.window.addEventListener('popstate', () => events.push(context.location.pathname));
  assert.equal(navigateApp('teams/fcs', {}, context.window), true);
  assert.equal(context.location.href, 'https://example.test/teams/fcs/');
  context.history.back();
  assert.equal(context.location.pathname, '/rankings');
  context.history.forward();
  assert.deepEqual(events, ['teams/fcs', '/rankings', '/teams/fcs/']);
});
