import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appVmSource, installAppVmContext } from '../test-support/app-vm.mjs';
import { accountCallbackMode, initialAccountReturnUrl } from '../frontend/bracket-auth.js?v=header-account';

test('legacy app VM bridge permits only the known static import and preserves dynamic imports',async()=>{
  const source=await readFile('frontend/app.js','utf8'),script=appVmSource(source);
  assert.match(script,/import\('\.\/share-card\.js/);
  assert.throws(()=>appVmSource(source+'\nimport extra from "./unexpected.js";'),/Unexpected static/);
  assert.throws(()=>appVmSource(source.replace('safeAccountReturnHash }','safeAccountReturnHash, unexpected }')),/known account-routing import/);
});

test('VM browser fixtures receive actual callback helpers and a URL that follows their hash',()=>{
  const context={location:{hash:'#rankings'},window:{}};
  installAppVmContext(context);
  assert.equal(context.accountCallbackMode,accountCallbackMode);assert.equal(context.initialAccountReturnUrl,initialAccountReturnUrl);
  assert.equal(context.location.href,'https://example.test/#rankings');
  context.location.hash='#teams/fcs';assert.equal(context.location.href,'https://example.test/#teams/fcs');
});
