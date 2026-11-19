// Isolated browser verification of CSP delivery. All external requests are
// intercepted with synthetic responses; no Auth, sports API or user is touched.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { applySecurityMetadata, SUPABASE_BROWSER_SCRIPT } from '../src/security-policy.js';

const authUrl = 'https://egxyfyorggwnrnmirrax.supabase.co';
const blockedRequests = [];
const html = applySecurityMetadata(`<!doctype html><html><head><meta charset="utf-8">
<script>window.inlineSucceeded=true</script>
<script src="${SUPABASE_BROWSER_SCRIPT}"></script><script type="module" src="/probe.js"></script>
</head><body><button id="bad" onclick="window.handlerSucceeded=true">Inline handler test</button></body></html>`, { authUrl });
const moduleScript = `
const r = window.policyProbe = {};
try { new Function('window.evalSucceeded=true')(); } catch { r.evalBlocked = true; }
for (const [name,url] of [['auth','${authUrl}/auth/v1/settings'],['scoreboard','https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard'],['evil','https://unapproved.example.invalid/private']]) {
  try { r[name] = (await fetch(url)).ok; } catch { r[name] = false; }
}
const worker = new Worker('/worker.js',{type:'module'});
await new Promise((resolve,reject)=>{worker.onmessage=()=>{r.worker=true;worker.terminate();resolve();};worker.onerror=reject;});
const image = new Image();
await new Promise(resolve=>{image.onload=()=>{r.dataImage=true;resolve();};image.onerror=()=>{r.dataImage=false;resolve();};image.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';});
const script = document.createElement('script');
script.src='https://cdn.jsdelivr.net/npm/unapproved-package/evil.js';
await new Promise(resolve=>{script.onerror=()=>{r.unapprovedScriptBlocked=true;resolve();};script.onload=()=>{r.unapprovedScriptBlocked=false;resolve();};document.head.append(script);});
r.done=true;
`;
const server = createServer((request,response) => {
  const path = new URL(request.url,'http://localhost').pathname;
  if (path === '/') return response.writeHead(200,{'Content-Type':'text/html'}).end(html);
  if (path === '/probe.js') return response.writeHead(200,{'Content-Type':'text/javascript'}).end(moduleScript);
  if (path === '/worker.js') return response.writeHead(200,{'Content-Type':'text/javascript'}).end('postMessage("ready");');
  response.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({headless:true,args:['--no-sandbox'],
    ...(process.env.QUALITY_BROWSER ? {executablePath:process.env.QUALITY_BROWSER} : existsSync(chrome) ? {executablePath:chrome} : {})});
  const page = await browser.newPage();
  const referrers = [];
  await page.route('https://**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('https://unapproved.example.invalid/') || url.includes('/unapproved-package/')) blockedRequests.push(url);
    if (url === SUPABASE_BROWSER_SCRIPT) return route.fulfill({status:200,contentType:'text/javascript',body:'window.approvedSdkLoaded=true;'});
    referrers.push(route.request().headers().referer ?? null);
    return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{}'});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
  await page.waitForFunction(()=>window.policyProbe?.done,null,{timeout:15000});
  await page.locator('#bad').click();
  const result = await page.evaluate(()=>({ ...window.policyProbe,
    approvedSdkLoaded:window.approvedSdkLoaded===true,
    inlineSucceeded:window.inlineSucceeded===true,handlerSucceeded:window.handlerSucceeded===true,
    evalSucceeded:window.evalSucceeded===true,referrerPolicy:document.querySelector('meta[name="referrer"]').content }));
  assert.equal(result.approvedSdkLoaded,true);
  assert.equal(result.inlineSucceeded,false);
  assert.equal(result.handlerSucceeded,false);
  assert.equal(result.evalSucceeded,false);
  assert.equal(result.evalBlocked,true);
  assert.equal(result.auth,true); assert.equal(result.scoreboard,true);
  assert.equal(result.evil,false); assert.equal(result.unapprovedScriptBlocked,true);
  assert.equal(result.worker,true); assert.equal(result.dataImage,true);
  assert.equal(result.referrerPolicy,'no-referrer');
  assert.deepEqual(referrers,[null,null]); assert.deepEqual(blockedRequests,[]);
  console.log(JSON.stringify({passed:true,result,
    scope:'Isolated real-browser CSP checks with mocked external transport; not a managed-Auth or production-header test'}));
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
