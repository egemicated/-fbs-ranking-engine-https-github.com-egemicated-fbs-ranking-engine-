// Disposable browser-only Auth/RPC doubles. No real credentials, mail, users,
// application records, or production authentication settings are mutated.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root=resolve('static-dist');
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'};
const hasBasketballPublication=await readFile(resolve(root,'basketball/index.html'),'utf8')
  .then(value=>value.includes('name="basketball-publication"')).catch(error=>{if(error.code==='ENOENT')return false;throw error;});
const server=createServer(async(request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  let file=resolve(root,'.'+pathname);
  if(!extname(pathname))file=resolve(file,'index.html');
  if(!file.startsWith(root+sep))return response.writeHead(404).end();
  try{const body=await readFile(file);response.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream'}).end(body);}catch{response.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true,...(process.env.QUALITY_BROWSER?{executablePath:process.env.QUALITY_BROWSER}:{}),args:['--no-sandbox']});
const results=[];
const callbackCases=[
  {name:'clean-recovery-pkce',input:'/account?account=recovery&code=synthetic',remembered:'#home',mode:'recovery',expected:'/account'},
  {name:'clean-verification-pkce',input:'/account?account=verification&code=synthetic',remembered:'/teams/fcs/',mode:'verification',expected:'/account'},
  {name:'clean-signin-pkce',input:'/account?account=signin&code=synthetic',remembered:'/teams/fcs/',mode:'signin',expected:'/account'},
  {name:'legacy-verification-pkce',input:'/?account=verification&code=synthetic#account',remembered:'#teams/fcs',mode:'verification',expected:'/account'},
  {name:'recovery-fragment-cleanup',input:'/?account=recovery#access_token=synthetic&refresh_token=synthetic&type=recovery',remembered:'#home',mode:'recovery',expected:'/account'},
  {name:'recovery-fragment-without-marker',input:'/#access_token=synthetic&refresh_token=synthetic&type=recovery',remembered:'#home',mode:'recovery',expected:'/account'},
  {name:'google-pkce-remembered-clean-route',input:'/?myteam=1&code=synthetic',remembered:'/teams/fcs/',mode:'signin',expected:'/teams/fcs/'},
  {name:'google-pkce-remembered-legacy-route',input:'/?code=synthetic#home',remembered:'#teams/fcs',mode:'signin',expected:'/teams/fcs/'},
  {name:'google-pkce-football-home-fallback',input:'/?myteam=1&code=synthetic',remembered:null,mode:'signin',expected:'/football/',ready:'.home-hero'},
  {name:'legacy-weekly-picks-return',input:'/?weekly=1&code=synthetic',remembered:'#home',mode:'signin',expected:'/beat-the-model/',ready:'[data-weekly-contest]'},
  {name:'legacy-playoff-bracket-return',input:'/?cfp=1&code=synthetic',remembered:'#home',mode:'signin',expected:'/playoff-bracket/',ready:'.bracket-page'},
  {name:'expired-recovery-link',input:'/?account=recovery#error=access_denied&error_code=otp_expired&error_description=synthetic',remembered:'#home',mode:'expired',expected:'/account',notice:'This email link has expired or is no longer available.'},
  {name:'missing-pkce-verifier',input:'/account?account=recovery&code=synthetic',remembered:'#home',mode:'missing-verifier',expected:'/account',notice:'This link could not be matched to this browser.'},
];

async function checkCallbackRouting(fixture){
  const page=await browser.newPage({viewport:{width:390,height:1050}});
  await page.route('https://egxyfyorggwnrnmirrax.supabase.co/**',route=>route.abort());
  await page.route('**/auth/v1/settings',route=>route.fulfill({json:{external:{google:true}}}));
  await page.route('**/bracket-auth.js*',async route=>{
    const source=await readFile(resolve(root,'bracket-auth.js'),'utf8');
    // Replace only the managed SDK boundary in this disposable context. The
    // production callback/routing/observation logic remains byte-identical.
    const boundary='export function loadBracketClient({ url, publishableKey }) {';
    assert.equal(source.split(boundary).length,2);
    await route.fulfill({contentType:'text/javascript',body:source.replace(boundary,boundary+
      '\nwindow.callbackClientStartUrl ??= location.href;\nreturn Promise.resolve(window.callbackClientFixture);')});
  });
  await page.addInitScript(({mode,remembered})=>{
    if(remembered!==null)sessionStorage.setItem('fbs-account-return',remembered);
    const user={id:'callback-fixture',email:'routing@example.test'},session={user},listeners=new Set();
    let complete;
    const initialized=new Promise(resolve=>{complete=resolve;});
    const error=mode==='expired'?{code:'otp_expired',message:'synthetic provider diagnostic'}:mode==='missing-verifier'?{name:'AuthPKCECodeVerifierMissingError',message:'synthetic provider diagnostic'}:null;
    window.callbackClientFixture={auth:{getSession:async()=>{await initialized;return error?{data:{session:null},error}:{data:{session}};},getUser:async()=>{await initialized;return{data:{user:error?null:user}};},
      onAuthStateChange:callback=>{window.callbackClientObserved=true;listeners.add(callback);return{data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};},
      mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal1',nextLevel:'aal1'}}),listFactors:async()=>({data:{totp:[]}})}},
      rpc:async name=>({data:name==='account_context'?{userId:user.id,email:user.email,role:'user',status:'active',nickname:'Routing fixture',publicLeaderboard:false,sharePicks:false}:[]})};
    window.completeCallbackFixture=()=>{
      const url=new URL(location.href);url.searchParams.delete('code');
      if(/access_token=|refresh_token=/.test(url.hash))url.hash='';
      history.replaceState(history.state,'',url);
      if(!error)for(const callback of [...listeners])callback(mode==='recovery'?'PASSWORD_RECOVERY':'SIGNED_IN',session);
      complete();
    };
  },fixture);
  const callbackUrl = new URL(fixture.input,base).href;
  const readyBefore=fixture.ready??(fixture.expected==='/account'?'[data-connected-feature]':'.team-grid');
  const accountSlot=page.locator('#header [data-header-account]');
  await page.goto(callbackUrl,{waitUntil:'domcontentloaded'});
  await page.locator(readyBefore).waitFor();
  await accountSlot.locator('[data-account-action]').waitFor();
  await page.waitForFunction(()=>window.callbackClientObserved);
  if(hasBasketballPublication){
    assert.equal(await page.locator('.fc-sports-portal').count(),0,fixture.name+' enters the football app');
    assert.equal(await page.locator('[data-gd-sport="football"] [data-header-account]').count(),1,fixture.name+' mounts the shared account slot');
  }
  assert.equal(await page.locator('.home-hero').count(),Number(fixture.ready==='.home-hero'),fixture.name+' before managed Auth finishes');
  assert.equal(page.url(),callbackUrl,fixture.name+' URL must reach managed Auth intact');
  assert.equal(await page.evaluate(()=>window.callbackClientStartUrl),callbackUrl,fixture.name+' SDK starts at the original URL');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('fbs-account-return')),fixture.remembered);
  await accountSlot.evaluate(element=>{
    window.callbackHeaderSlot=element;
    window.completeCallbackFixture();
  });
  await page.waitForURL(new URL(fixture.expected,base).href);
  if(fixture.notice)await page.locator('main').getByText(fixture.notice,{exact:false}).waitFor();
  else {
    await page.locator(fixture.expected==='/account'?'.account-center':readyBefore).waitFor();
    await accountSlot.locator('.header-account-settings[href="/account"]').waitFor();
  }
  const outcome=await page.evaluate(async()=>({path:location.pathname,hash:location.hash,query:location.search,home:!!document.querySelector('.home-hero'),
    sameHeader:window.callbackHeaderSlot===document.querySelector('#header [data-header-account]'),
    recovering:(await import('/bracket-auth.js?v=clean-routes')).hasPasswordRecoverySession(),remembered:sessionStorage.getItem('fbs-account-return')}));
  assert.equal(outcome.path,fixture.expected,fixture.name+' after credential cleanup');
  assert.equal(outcome.home,fixture.ready==='.home-hero');
  assert.equal(outcome.sameHeader,true,fixture.name+' keeps the mounted account slot through cleanup');
  assert.equal(outcome.hash,'');assert.equal(outcome.query,'');assert.equal(outcome.remembered,null);assert.equal(outcome.recovering,fixture.mode==='recovery');
  assert.doesNotMatch(await page.locator('body').innerText(),/synthetic provider diagnostic/);
  if(fixture.mode==='recovery'){assert.equal(await page.locator('#account-new-password').count(),1);assert.equal(await page.locator('#account-current-password').count(),0);}
  await page.close();return{name:fixture.name,passed:true};
}

async function checkPortalEntry(){
  const page=await browser.newPage({viewport:{width:390,height:1050}});
  const footballAppRequests=[];
  const accountShellRequests=[];
  await page.route('**/app.js*',route=>{footballAppRequests.push(route.request().url());return route.abort();});
  await page.route('**/account',route=>{accountShellRequests.push(route.request().url());return route.continue();});
  try {
    await page.goto(base,{waitUntil:'load'});
    await page.locator('.fc-sports-portal').waitFor();
    await page.getByRole('navigation',{name:'Switch sport'}).waitFor();
    assert.equal(await page.locator('[data-header-account]').count(),0);
    assert.equal(await page.getByRole('link',{name:'Your account at The Games Decide'}).getAttribute('href'),'/account');
    assert.deepEqual(footballAppRequests,[],'A normal portal visit does not load the football app');
    assert.deepEqual(accountShellRequests,[],'A normal portal visit does not request the account shell');

    let started, release, finished;
    const shellStarted=new Promise(done=>{started=done;});
    const shellPaused=new Promise(done=>{release=done;});
    const shellFinished=new Promise(done=>{finished=done;});
    const slowShell=async route=>{
      started();
      await shellPaused;
      try { await route.continue(); } catch {}
      finally { finished(); }
    };
    await page.route('**/account',slowShell);
    try {
      await page.evaluate(()=>{location.hash='access_token=synthetic&refresh_token=synthetic&type=recovery';});
      await shellStarted;
      await page.getByText('Opening your account link…').waitFor();
      await page.goBack();
      await page.getByText('Opening your account link…').waitFor({state:'detached'});
      release();
      await shellFinished;
      assert.equal(page.url(),base);
      assert.equal(await page.locator('.fc-sports-portal').count(),1);
      assert.deepEqual(footballAppRequests,[],'A canceled callback leaves the sports portal mounted');
    } finally {
      release();
      await page.unroute('**/account',slowShell);
    }

    const callbackUrl=new URL('/?account=recovery&code=synthetic',base).href;
    await page.route('**/account',route=>route.fulfill({status:503,body:'Unavailable'}));
    await page.goto(callbackUrl,{waitUntil:'load'});
    await page.getByRole('alert').getByText('Could not open this account link.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Reload'}).waitFor();
    assert.equal(page.url(),callbackUrl,'A shell failure leaves the account link intact for retry');
    assert.deepEqual(footballAppRequests,[],'A shell failure does not start the authentication app');
  } finally { await page.close(); }
}
async function assertPageFits(page,label){
  const dimensions=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  let diagnostics='';
  if(dimensions.scroll!==dimensions.client){
    diagnostics=await page.evaluate(()=>JSON.stringify([...document.querySelectorAll('body *')].flatMap(element=>{
      const rect=element.getBoundingClientRect(),style=getComputedStyle(element),width=document.documentElement.clientWidth;
      return rect.width>0&&(rect.right>width+.1||rect.left<-.1)?[{tag:element.tagName,id:element.id,class:element.className,
        left:rect.left,right:rect.right,width:rect.width,minWidth:style.minWidth,font:style.font,flex:style.flex}]:[];
    }).slice(0,20)));
  }
  assert.equal(dimensions.scroll,dimensions.client,label+(diagnostics?' '+diagnostics:''));
}
try{
  if(hasBasketballPublication)await checkPortalEntry();
  for(const width of [320,375,390,768,1024,1440]){
    const page=await browser.newPage({viewport:{width,height:1050},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.abort());
    await page.goto(new URL('/account',base).href);
    await page.locator('.account-section').first().waitFor();
    await page.evaluate(async()=>{
      const container=document.querySelector('main');
      container.innerHTML='<div class="wrap page-content" id="account-test"></div>';
      const profile={userId:'test-account',email:'fan@example.test',role:'user',status:'active',nickname:'Test fan',publicLeaderboard:false,sharePicks:false};
      const user={id:'test-account',email:profile.email};
      const requests=[];let factor=null,level='aal1';window.accountCalls=[];window.accountNotifications=[];
      window.accountClient={auth:{
        getUser:async()=>({data:{user}}),getSession:async()=>({data:{session:{user}}}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
        updateUser:async values=>{window.accountCalls.push({name:'auth.updateUser',identity:user.id,containsPassword:typeof values.password==='string'});return{data:{user}};},
        signInWithPassword:async()=>({data:{user}}),
        refreshSession:async()=>{window.accountCalls.push({name:'auth.refreshSession'});return{data:{session:{user}}};},
        signOut:async()=>({error:null}),
        mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:level,nextLevel:factor?'aal2':'aal1'}}),listFactors:async()=>({data:{totp:factor?[factor]:[]}}),
          enroll:async()=>{factor={id:'test-factor',status:'unverified',friendly_name:'Test authenticator'};return{data:{...factor,totp:{qr_code:'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>',secret:'TESTONLY'}}};},
          challengeAndVerify:async args=>{window.accountCalls.push({name:'auth.mfa.challengeAndVerify',factorId:args.factorId});factor={...factor,status:'verified'};level='aal2';return{data:{}};},
          unenroll:async args=>{window.accountCalls.push({name:'auth.mfa.unenroll',factorId:args.factorId});factor=null;level='aal1';return{data:{}};}}},
        functions:{invoke:async(name,args)=>{window.accountNotifications.push({name,args});return{data:{accepted:true,delivery:'processed'}};}},
        rpc:async(name,args)=>{window.accountCalls.push({name,args});if(name==='account_context')return{data:{...profile}};if(name==='my_account_requests')return{data:[...requests]};
          if(name==='save_account_profile'){Object.assign(profile,{nickname:args.p_nickname,publicLeaderboard:args.p_public,sharePicks:args.p_share_picks});return{data:{...profile}};}
          if(name==='submit_support_request'){const existing=requests.find(row=>row.category===args.p_category&&['pending','in_review'].includes(row.status));if(existing)return{data:{...existing,alreadyOpen:true}};const request={id:'test-request-id',category:args.p_category,message:args.p_message,status:'pending',createdAt:'2026-11-18T12:00:00Z'};requests.unshift(request);return{data:{...request,alreadyOpen:false}};}
          throw Error('Unexpected RPC '+name);}};
      const {mountAccountCenter}=await import('/account-center.js');
      window.closeAccountTest=mountAccountCenter(document.querySelector('#account-test'),{previewClient:window.accountClient,previewConfig:{emailAuthEnabled:true,supportNotificationsEnabled:true}});
    });
    await page.locator('#account-nickname').waitFor();
    assert.equal(await page.locator('[data-account-support] [data-support-deletion]').isVisible(),false);
    assert.equal(await page.locator('[data-account-support] [name="deletionConfirmed"]').isDisabled(),true);
    await page.locator('#account-nickname').fill('A safer nickname');
    await page.locator('[data-account-profile] input[name="public"]').check();
    await page.locator('[data-account-profile] input[name="share"]').check();
    await page.locator('[data-account-profile] [type="submit"]').click();
    await page.getByText('Your public profile is saved. Existing picks are unchanged.').waitFor();
    assert.equal(await page.evaluate(()=>window.accountCalls.find(call=>call.name==='save_account_profile').args.p_share_picks),true);
    await page.locator('#account-new-password').fill('A unique test passphrase 42');
    await page.locator('#account-confirm-password').fill('A unique test passphrase 42');
    await page.locator('[data-account-password] [type="submit"]').click();
    await page.getByText(/Password saved for this same account/).waitFor();
    assert.equal(await page.evaluate(()=>window.accountCalls.find(call=>call.name==='auth.updateUser').identity),'test-account');
    assert.equal(await page.locator('#account-new-password').inputValue(),'');
    await page.locator('#account-category').selectOption('deletion');
    assert.equal(await page.locator('[data-account-support] [data-support-deletion]').isVisible(),true);
    await page.locator('#account-details').fill('Please review this disposable test request.');
    await page.locator('[data-account-support] input[name="deletionConfirmed"]').check();
    await page.locator('[data-account-support] [type="submit"]').click();
    await page.getByText(/Request test-request-id is saved for review/).waitFor();
    assert.equal(await page.evaluate(()=>window.accountNotifications.length),1);
    await page.locator('#account-category').selectOption('deletion');
    await page.locator('#account-details').fill('This is a new unsent draft for my existing request.');
    await page.locator('[data-account-support] input[name="deletionConfirmed"]').check();
    await page.locator('[data-account-support] [type="submit"]').click();
    await page.getByText(/An open request already exists in this category/).waitFor();
    assert.equal(await page.locator('#account-details').inputValue(),'This is a new unsent draft for my existing request.');
    assert.equal(await page.locator('[data-account-support] [name="deletionConfirmed"]').isChecked(),true);
    assert.equal(await page.evaluate(()=>window.accountNotifications.length),1);
    await page.locator('.support-original > summary').click();
    await page.locator('.support-original p').filter({hasText:'Please review this disposable test request.'}).waitFor();
    await page.locator('[data-mfa-enroll]').click();
    await page.locator('.account-enrollment img').waitFor();
    assert.match(await page.locator('.account-enrollment img').getAttribute('src'),/^data:image\/svg\+xml/);
    await page.locator('#account-mfa-code').fill('123456');
    await page.locator('[data-mfa-verify] [type="submit"]').click();
    await page.getByText(/This session has passed the second check/).waitFor();
    await page.locator('[data-mfa-remove]').click();
    await page.getByText(/No verified authenticator yet/).waitFor();
    assert.equal(await page.evaluate(()=>window.accountCalls.filter(call=>call.name==='auth.refreshSession').length),1);
    const accountCategories=await page.locator('#account-category option').allTextContents();
    await page.evaluate(async()=>{
      const root=document.createElement('div');root.id='shared-support-test';document.querySelector('main').append(root);
      const {mountPlatformInfo}=await import('/platform-info.js');
      window.sharedSupportEmails=0;
      const request={id:'private-response-request',category:'general',message:'My original private question.',status:'in_review',responses:[{message:'Your private response is ready.',requiresAction:true,createdAt:'2026-11-19T12:00:00Z'}]};
      window.closeSharedSupport=mountPlatformInfo(root,{page:'support',previewConfig:{supportEmail:'support@example.test',supportNotificationsEnabled:true},previewClient:{auth:{getUser:async()=>({data:{user:{id:'shared-support-owner'}}})},functions:{invoke:async()=>{window.sharedSupportEmails++;return{data:{accepted:true}};}},rpc:async name=>({data:name==='my_account_requests'?[request]:{...request,alreadyOpen:true}})}});
    });
    await page.locator('#shared-support-test [data-account-support]').waitFor();
    assert.deepEqual(await page.locator('#support-category option').allTextContents(),accountCategories);
    assert.equal(await page.locator('#shared-support-test [data-support-deletion]').isVisible(),false);
    await page.locator('#support-category').selectOption('deletion');
    assert.equal(await page.locator('#shared-support-test [data-support-deletion]').isVisible(),true);
    await page.locator('#shared-support-test [name="deletionConfirmed"]').check();
    await page.locator('#support-category').selectOption('general');
    assert.equal(await page.locator('#shared-support-test [data-support-deletion]').isVisible(),false);
    assert.equal(await page.locator('#shared-support-test [name="deletionConfirmed"]').isChecked(),false);
    await page.locator('#support-details').fill('A new draft that should remain unsent.');
    await page.locator('#shared-support-test [data-account-support] [type="submit"]').click();
    await page.locator('#shared-support-test [data-form-status]').filter({hasText:'Your new details were not sent.'}).waitFor();
    assert.equal(await page.locator('#support-details').inputValue(),'A new draft that should remain unsent.');
    assert.equal(await page.evaluate(()=>window.sharedSupportEmails),0);
    await page.getByText('Your private response is ready.',{exact:true}).waitFor();
    await page.locator('#shared-support-test .support-original > summary').click();
    await page.getByText('My original private question.',{exact:true}).waitFor();
    await assertPageFits(page,'Shared private support overflow at '+width);
    await page.evaluate(()=>{window.closeSharedSupport();document.querySelector('#shared-support-test').remove();});
    await page.evaluate(async()=>{
      const {mountHeaderAccount}=await import('/bracket-auth.js?v=clean-routes');
      mountHeaderAccount(document.querySelector('[data-header-account]'),{previewClient:window.accountClient});
    });
    await page.locator('[data-header-account] .header-account-settings').waitFor();
    await assertPageFits(page,'Account overflow at '+width);
    if(width===320){
      // Exercise wider fallback metrics without depending on the host OS font
      // inventory. The logo may yield space; signed-in actions stay readable.
      const widerFont=await page.addStyleTag({content:'.header-account .header-account-button{font-family:serif!important;font-size:15px!important}'});
      await assertPageFits(page,'Signed-in header with wider font metrics at '+width);
      await widerFont.evaluate(element=>element.remove());
    }
    const accountLabels=await page.locator('#account-test input,#account-test select,#account-test textarea').evaluateAll(controls=>controls.filter(control=>!control.labels?.length&&!control.getAttribute('aria-label')).map(control=>control.id));assert.deepEqual(accountLabels,[]);
    if(process.env.ACCOUNT_QA_SCREENSHOTS){await mkdir(process.env.ACCOUNT_QA_SCREENSHOTS,{recursive:true});await page.locator('#account-test').screenshot({path:resolve(process.env.ACCOUNT_QA_SCREENSHOTS,`account-${width}.png`)});}
    await page.evaluate(async()=>{
      window.closeAccountTest();
      const {openAccountDialog}=await import('/account-auth.js');window.authCalls=[];
      const client={auth:{signInWithPassword:async args=>{window.authCalls.push({name:'signin',email:args.email});return{data:{user:{id:'test-account'}}};},
        signInWithOAuth:async args=>{window.authCalls.push({name:'google',redirectTo:args.options.redirectTo});return{data:{}};},
        signUp:async args=>{window.authCalls.push({name:'signup',redirectTo:args.options.emailRedirectTo});return{data:{}};},resend:async args=>{window.authCalls.push({name:'resend',redirectTo:args.options.emailRedirectTo});return{data:{}};},resetPasswordForEmail:async (email,options)=>{window.authCalls.push({name:'recovery',redirectTo:options.redirectTo});return{data:{}};}}};
      window.closeDialog=openAccountDialog({client,config:{emailAuthEnabled:true,emailRegistrationEnabled:true,passwordRecoveryEnabled:true},googleEnabled:true});
    });
    await page.locator('[data-account-dialog]').waitFor();
    await page.locator('#fbs-auth-email').focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'fbs-auth-password');
    assert.notEqual(await page.locator('#fbs-auth-password').evaluate(element=>getComputedStyle(element).outlineStyle),'none');
    await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'fbs-auth-email');
    await page.locator('[data-auth-google]').click();
    await page.waitForFunction(()=>window.authCalls.some(call=>call.name==='google'));
    assert.equal(await page.evaluate(()=>new URL(window.authCalls.find(call=>call.name==='google').redirectTo).searchParams.get('myteam')),'1');
    await page.locator('[data-auth-mode="register"]').click();
    await page.locator('#fbs-auth-email').fill('new@example.test');await page.locator('#fbs-auth-password').fill('A unique test passphrase 42');await page.locator('#fbs-auth-confirm').fill('A unique test passphrase 42');
    await page.locator('[data-auth-form] [type="submit"]').click();
    await page.getByText(/If this address is eligible/).waitFor();
    await page.locator('[data-auth-mode="verification"]').click();await page.locator('#fbs-auth-email').fill('new@example.test');await page.locator('[data-auth-form] [type="submit"]').click();await page.getByText(/If this address needs verification/).waitFor();
    await page.locator('[data-auth-mode="verification"]').click();await page.locator('#fbs-auth-email').fill('new@example.test');await page.locator('[data-auth-form] [type="submit"]').click();await page.getByText(/Wait one minute/).waitFor();
    assert.equal(await page.evaluate(()=>window.authCalls.filter(call=>call.name==='resend').length),1);await page.locator('[data-auth-mode="signin"]').click();
    await page.locator('[data-auth-mode="recovery"]').click();await page.locator('#fbs-auth-email').fill('existing@example.test');await page.locator('[data-auth-form] [type="submit"]').click();await page.getByText(/If this address has an account/).waitFor();
    await page.locator('#fbs-auth-email').fill('existing@example.test');await page.locator('#fbs-auth-password').fill('A unique test passphrase 42');await page.locator('[data-auth-form] [type="submit"]').click();await page.locator('[data-account-dialog]').waitFor({state:'detached'});
    assert.deepEqual(await page.evaluate(()=>window.authCalls.map(call=>call.name)),['google','signup','resend','recovery','signin']);
    assert.deepEqual(await page.evaluate(()=>window.authCalls.slice(1,4).map(call=>call.redirectTo)),['verification','verification','recovery'].map(mode=>new URL(`/account?account=${mode}`,base).href));
    await page.evaluate(async()=>{
      const {mountAdministration}=await import('/account-administration.js');
      const requests=[{id:'test-request',userId:'test-user',email:'fan@example.test',category:'general',message:'A private test support request.',status:'pending',notificationStatus:'pending',responses:[]},
        {id:'test-failed-alert',email:'fan@example.test',category:'general',message:'A saved request with exhausted delivery attempts.',status:'pending',notificationStatus:'failed'},
        {id:'test-failed-alert-sent',email:'fan@example.test',category:'general',message:'A saved request whose retry will be accepted by the provider.',status:'pending',notificationStatus:'failed'}];
      const users=Array.from({length:23},(_,index)=>({userId:index===0?'test-user':`test-user-${index+1}`,
        email:index===0?'fan@example.test':`fan${String(index+1).padStart(2,'0')}@example.test`,
        nickname:index===0?'Fan':`Fan ${index+1}`,role:'user',status:'active',emailConfirmed:true}));
      const actions=Array.from({length:22},(_,index)=>({id:`action-${index+1}`,action:'nickname_moderation',actorLabel:'Administrator',
        targetLabel:`Fan ${index+1}`,details:{reason:`Audited change ${index+1}`},createdAt:'2026-11-19T12:00:00Z'}));
      let lastRequeue;
      window.adminCalls=[];
      const client={auth:{getUser:async()=>({data:{user:{id:'test-admin'}}}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2'}})}},
        functions:{invoke:async()=>{if(lastRequeue==='test-failed-alert-sent'){requests.find(row=>row.id===lastRequeue).notificationStatus='sent';return{data:{accepted:true,delivery:'processed'}};}throw Error('Disposable email delivery outage');}},
        rpc:async(name,args)=>{window.adminCalls.push({name,args});
          if(name==='account_context')return{data:{role:'admin'}};
          if(name==='admin_users'){
            const search=String(args.p_search??'').trim().toLowerCase();
            const matching=users.filter(user=>!search||user.email.toLowerCase().includes(search)||user.nickname.toLowerCase().includes(search));
            return{data:{users:matching.slice(args.p_offset,args.p_offset+args.p_limit),total:matching.length}};
          }
          if(name==='admin_support_requests'){
            const matching=requests.filter(row=>!args.p_status||row.status===args.p_status);
            return{data:{requests:matching,total:matching.length,statusCounts:Object.fromEntries(['pending','in_review','resolved','closed'].map(status=>[status,requests.filter(row=>row.status===status).length])),notifications:{due:requests.filter(row=>row.notificationStatus==='pending').length,failed:requests.filter(row=>row.notificationStatus==='failed').length}}};
          }
          if(name==='admin_action_history')return{data:{actions:actions.slice(args.p_offset,args.p_offset+args.p_limit),total:actions.length}};
          if(name==='admin_update_request'){const row=requests.find(row=>row.id===args.p_request_id);row.status=args.p_status;row.adminNote=args.p_note;return{data:row};}
          if(name==='admin_reply_request'){const row=requests.find(row=>row.id===args.p_request_id);row.responses.push({id:args.p_reply_id,message:args.p_message,requiresAction:args.p_requires_action,createdAt:'2026-11-19T12:00:00Z'});return{data:{id:args.p_reply_id,requestId:row.id}};}
          if(name==='admin_set_account_status'){users.find(row=>row.userId===args.p_user_id).status=args.p_status;return{data:{}};}
          if(name==='admin_requeue_support_notification'){const row=requests.find(row=>row.id===args.p_request_id);if(row.notificationStatus!=='failed')throw Error('Only failed notifications can be requeued');row.notificationStatus='pending';lastRequeue=row.id;actions.unshift({action:'support_notification_requeue',details:{reason:args.p_reason}});return{data:{requestId:row.id,notificationStatus:'pending'}};}
          throw Error('Unexpected admin RPC '+name);
        }};
      mountAdministration(document.querySelector('#account-test'),{previewClient:client,previewConfig:{supportNotificationsEnabled:true}});
    });
    await page.locator('.admin-user').first().waitFor();
    assert.match(await page.locator('.admin-support-totals').innerText(),/Pending\s+3/);
    const userPages=page.locator('nav[aria-label="Registered user pages"]');
    const checkUserPage=async(number,count,range)=>{
      await userPages.locator(`[data-admin-users-page="${number}"][aria-current="page"]`).waitFor();
      await page.locator('[data-admin-users-range]').filter({hasText:range}).waitFor();
      assert.equal(await page.locator('[data-admin-users-range]').innerText(),`${range} · 8 per page`);
      assert.equal(await page.locator('.admin-user').count(),count);
      const call=await page.evaluate(()=>window.adminCalls.filter(call=>call.name==='admin_users').at(-1));
      assert.equal(call.args.p_limit,8);assert.equal(call.args.p_offset,(number-1)*8);
      await assertPageFits(page,`Registered user page ${number} overflow at ${width}`);
    };
    const auditPages=page.locator('nav[aria-label="Administrative action history pages"]');
    const auditRows=page.locator('[data-admin-audit-panel] .admin-audit-list > li');
    const checkAuditPage=async(number,count,range)=>{
      await auditPages.locator(`[data-admin-audit-page="${number}"][aria-current="page"]`).waitFor();
      await page.locator('[data-admin-audit-range]').filter({hasText:range}).waitFor();
      assert.equal(await page.locator('[data-admin-audit-range]').innerText(),`${range} · 8 per page`);
      assert.equal(await auditRows.count(),count);
      const call=await page.evaluate(()=>window.adminCalls.filter(call=>call.name==='admin_action_history').at(-1));
      assert.deepEqual(call.args,{p_limit:8,p_offset:(number-1)*8});
      await assertPageFits(page,`Administrative history page ${number} overflow at ${width}`);
    };
    const callCount=()=>page.evaluate(()=>window.adminCalls.length);
    const callNamesAfter=index=>page.evaluate(start=>window.adminCalls.slice(start).map(call=>call.name),index);
    await checkUserPage(1,8,'Showing 1–8 of 23 accounts');
    await checkAuditPage(1,8,'Showing 1–8 of 22 actions');
    assert.equal(await page.locator('.admin-user details[open]').count(),0);
    assert.equal(await userPages.getByRole('button',{name:'Previous',exact:true}).isDisabled(),true);
    assert.equal(await auditPages.getByRole('button',{name:'Previous',exact:true}).isDisabled(),true);

    // Audit pagination must keep account edits in place and move keyboard
    // focus to the resulting range announcement.
    await page.locator('.admin-user summary').first().click();
    const accountDraft=page.locator('[data-admin-user-status="test-user"] input[name="reason"]');
    await accountDraft.fill('An unsent account edit');
    let priorCalls=await callCount();
    await auditPages.getByRole('button',{name:'Next',exact:true}).focus();
    await page.keyboard.press('Enter');
    await checkAuditPage(2,8,'Showing 9–16 of 22 actions');
    await page.waitForFunction(()=>document.activeElement.matches('[data-admin-audit-range]'));
    assert.deepEqual(await callNamesAfter(priorCalls),['admin_action_history']);
    assert.equal(await accountDraft.inputValue(),'An unsent account edit');
    await checkUserPage(1,8,'Showing 1–8 of 23 accounts');
    assert.match(await auditRows.first().innerText(),/Audited change 9\b/);

    const supportSummary=page.locator('#support-request-test-request > summary');
    const supportDraft=page.locator('[data-admin-reply="test-request"] textarea');
    await supportSummary.click();
    await supportDraft.fill('An unsent support reply');
    priorCalls=await callCount();
    await userPages.locator('[data-admin-users-page="2"]').first().click();
    await checkUserPage(2,8,'Showing 9–16 of 23 accounts');
    await page.waitForFunction(()=>document.activeElement.matches('[data-admin-users-range]'));
    assert.deepEqual(await callNamesAfter(priorCalls),['admin_users']);
    assert.equal(await supportDraft.inputValue(),'An unsent support reply');
    await supportSummary.click();
    assert.match(await page.locator('.admin-user').first().innerText(),/fan09@example\.test/);
    await checkAuditPage(2,8,'Showing 9–16 of 22 actions');
    await auditPages.locator('[data-admin-audit-page="3"]').first().click();
    await checkAuditPage(3,6,'Showing 17–22 of 22 actions');
    assert.equal(await auditPages.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
    assert.match(await auditRows.first().innerText(),/Audited change 17\b/);
    await checkUserPage(2,8,'Showing 9–16 of 23 accounts');
    await userPages.locator('[data-admin-users-page="3"]').first().click();
    await checkUserPage(3,7,'Showing 17–23 of 23 accounts');
    assert.equal(await userPages.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
    assert.match(await page.locator('.admin-user').first().innerText(),/fan17@example\.test/);
    await userPages.locator('[data-admin-users-page="2"]').first().click();
    await checkUserPage(2,8,'Showing 9–16 of 23 accounts');
    await page.locator('[data-admin-search] input').fill('fan@example.test');
    await page.locator('[data-admin-search] [type="submit"]').click();
    await page.locator('[data-admin-users-range]').filter({hasText:'Showing 1–1 of 1 matching account ·'}).waitFor();
    assert.equal(await page.locator('.admin-user').count(),1);
    assert.equal(await page.locator('nav[aria-label="Registered user pages"]').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.adminCalls.filter(call=>call.name==='admin_users').at(-1).args),{p_search:'fan@example.test',p_limit:8,p_offset:0});
    await checkAuditPage(3,6,'Showing 17–22 of 22 actions');
    await assertPageFits(page,`Admin filtered users overflow at ${width}`);
    await page.locator('[data-admin-search] input').fill('no-such-user@example.test');
    await page.locator('[data-admin-search] [type="submit"]').click();
    await page.locator('[data-admin-users-range]').filter({hasText:'No accounts match this search.'}).waitFor();
    assert.equal(await page.locator('.admin-user').count(),0);
    assert.equal(await page.locator('nav[aria-label="Registered user pages"]').count(),0);
    await page.locator('[data-admin-search] input').fill('');
    await page.locator('[data-admin-search] [type="submit"]').click();
    await checkUserPage(1,8,'Showing 1–8 of 23 accounts');
    await page.locator('.admin-request > summary').first().click();
    await page.locator('[data-admin-reply="test-request"] textarea').fill('Please check your saved team after reloading.');
    await page.locator('[data-admin-reply="test-request"] [name="requiresAction"]').check();
    await page.locator('[data-admin-reply="test-request"] [type="submit"]').click();
    await page.locator('[data-admin-result]').filter({hasText:'Private response saved in the user’s request history.'}).waitFor();
    await page.locator('#support-request-test-request > summary').click();
    await page.locator('#support-request-test-request .support-response').filter({hasText:'Please check your saved team'}).waitFor();
    await assertPageFits(page,'Admin response overflow at '+width);
    await page.locator('[data-admin-request="test-request"] select').selectOption('in_review');await page.locator('[data-admin-request="test-request"] textarea').fill('Disposable review note');await page.locator('[data-admin-request="test-request"] [type="submit"]').click();
    await page.waitForFunction(()=>window.adminCalls.some(call=>call.name==='admin_update_request'));
    assert.equal(await page.locator('[data-admin-notification-requeue]').count(),2);
    for(const [id,expected] of [['test-failed-alert',/Delivery is pending/],['test-failed-alert-sent',/Inbox receipt is not confirmed/]]){
      const form=page.locator(`[data-admin-notification-requeue="${id}"]`);
      const row=page.locator('.admin-request').filter({has:form});
      await row.locator(':scope > summary').click();await row.locator('.admin-notification-retry > summary').click();
      await form.locator('[name="reason"]').fill('bad');await form.locator('[type="submit"]').click();
      assert.equal(await page.evaluate(requestId=>window.adminCalls.filter(call=>call.name==='admin_requeue_support_notification'&&call.args.p_request_id===requestId).length,id),0);
      await form.locator('[name="reason"]').fill('Email delivery setup repaired; retry reviewed');await form.locator('[type="submit"]').click();
      await page.locator('[data-admin-result]').filter({hasText:expected}).waitFor();
      assert.equal(await page.evaluate(requestId=>window.adminCalls.filter(call=>call.name==='admin_requeue_support_notification'&&call.args.p_request_id===requestId).length,id),1);
      assert.equal(await page.locator(`[data-admin-notification-requeue="${id}"]`).count(),0);
      assert.match(await page.locator('[data-admin-result]').innerText(),/support request remains saved/);
    }
    const managedUser=page.locator('.admin-user').filter({has:page.locator('[data-admin-user-status="test-user"]')});
    await managedUser.locator('summary').first().click();
    assert.equal(await managedUser.locator('details[open]').count(),1);
    await assertPageFits(page,'Expanded admin user overflow at '+width);
    await managedUser.locator('[data-admin-user-status] select').selectOption('suspended');await managedUser.locator('[data-admin-user-status] input[name="reason"]').fill('Disposable moderation test');await managedUser.locator('[data-admin-user-status] [type="submit"]').click();await page.waitForFunction(()=>window.adminCalls.some(call=>call.name==='admin_set_account_status'));
    await assertPageFits(page,'Admin overflow at '+width);
    const adminLabels=await page.locator('#account-test input,#account-test select,#account-test textarea').evaluateAll(controls=>controls.filter(control=>!control.labels?.length&&!control.getAttribute('aria-label')).map(control=>control.id));assert.deepEqual(adminLabels,[]);
    assert.equal(await page.locator('#account-test input[type="password"]').count(),0);
    assert.deepEqual(errors,[]);results.push({width,account:true,registrationMock:true,recoveryMock:true,googleMigrationMock:true,mfaMock:true,adminMock:true,adminUserPaginationMock:true,adminAuditPaginationMock:true,privateSupportReplyMock:true,failedNotificationRequeueMock:true,overflow:false,labels:true});await page.close();
  }
  const callbacks=[];for(const fixture of callbackCases)callbacks.push(await checkCallbackRouting(fixture));
  console.log(JSON.stringify({status:'passed',providerFlows:'Browser-only SDK/RPC doubles; no real email or OAuth delivery claimed',checks:results,callbacks,
    ...(hasBasketballPublication?{unifiedPortal:true}:{})},null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
