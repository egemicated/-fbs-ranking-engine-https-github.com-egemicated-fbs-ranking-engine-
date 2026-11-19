// Adapt the one known ESM binding for legacy VM DOM tests. All application
// statements still execute; imported callback helpers are the real functions.
import assert from 'node:assert/strict';
import { ACCOUNT_ROUTE_EVENT, accountCallbackMode, initialAccountReturnUrl, safeAccountReturnHash } from '../frontend/bracket-auth.js?v=header-account';

const knownImport="import { ACCOUNT_ROUTE_EVENT, accountCallbackMode, initialAccountReturnUrl, safeAccountReturnHash } from './bracket-auth.js?v=header-account';";

export function appVmSource(source) {
  assert.equal(source.split(knownImport).length,2,'Expected exactly the known account-routing import; review new application dependencies');
  const script=source.replace(knownImport,'');
  assert.doesNotMatch(script,/(?:^|\n)\s*import\b(?!\s*\()/,'Unexpected static application import; extend the VM bridge explicitly');
  return script;
}

export function installAppVmContext(context) {
  Object.assign(context,{ACCOUNT_ROUTE_EVENT,accountCallbackMode,initialAccountReturnUrl,safeAccountReturnHash,URL,URLSearchParams});
  const location=context.location;
  assert.ok(location&&typeof location.hash==='string','VM browser requires a location hash');
  location.search??='';location.origin??='https://example.test';location.hostname??='example.test';
  if(!Object.hasOwn(location,'href'))Object.defineProperty(location,'href',{configurable:true,get(){
    const hash=location.hash?location.hash.startsWith('#')?location.hash:'#'+location.hash:'';
    return location.origin+'/'+location.search+hash;
  }});
  context.window.location=location;
  return context;
}
