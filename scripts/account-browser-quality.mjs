// Disposable browser-only Auth/RPC doubles. No real credentials, mail, users,
// application records, or production authentication settings are mutated.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root=resolve('static-dist');
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=createServer(async(request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  let file=resolve(root,'.'+pathname);
  if(pathname.endsWith('/'))file=resolve(file,'index.html');
  if(!file.startsWith(root+sep))return response.writeHead(404).end();
  try{const body=await readFile(file);response.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream'}).end(body);}catch{response.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true,...(process.env.QUALITY_BROWSER?{executablePath:process.env.QUALITY_BROWSER}:{}),args:['--no-sandbox']});
const results=[];
const callbackCases=[
  {name:'recovery-pkce',query:'?account=recovery&code=synthetic',hash:'#account',remembered:'#home',mode:'recovery',expected:'#account'},
  {name:'verification-pkce',query:'?account=verification&code=synthetic',hash:'#account',remembered:'#teams/fcs',mode:'verification',expected:'#account'},
  {name:'recovery-fragment-cleanup',query:'?account=recovery',hash:'#access_token=synthetic&refresh_token=synthetic&type=recovery',remembered:'#home',mode:'recovery',expected:'#account'},
  {name:'recovery-fragment-without-marker',query:'',hash:'#access_token=synthetic&refresh_token=synthetic&type=recovery',remembered:'#home',mode:'recovery',expected:'#account'},
  {name:'google-pkce-remembered-route',query:'?code=synthetic',hash:'#home',remembered:'#teams/fcs',mode:'signin',expected:'#teams/fcs'},
  {name:'expired-recovery-link',query:'?account=recovery',hash:'#error=access_denied&error_code=otp_expired&error_description=synthetic',remembered:'#home',mode:'expired',expected:'#account',notice:'This email link has expired or is no longer available.'},
  {name:'missing-pkce-verifier',query:'?account=recovery&code=synthetic',hash:'#account',remembered:'#home',mode:'missing-verifier',expected:'#account',notice:'This link could not be matched to this browser.'},
];

async function checkCallbackRouting(fixture){
  const page=await browser.newPage({viewport:{width:390,height:1050}});
  await page.route('https://egxyfyorggwnrnmirrax.supabase.co/**',route=>route.abort());
  await page.route('**/auth/v1/settings',route=>route.fulfill({json:{external:{google:true}}}));
  await page.route('**/app.js*',async route=>route.fulfill({contentType:'text/javascript',body:await readFile('frontend/app.js','utf8')}));
  await page.route('**/account-auth.js*',async route=>route.fulfill({contentType:'text/javascript',body:await readFile('frontend/account-auth.js','utf8')}));
  await page.route('**/account-center.js*',async route=>route.fulfill({contentType:'text/javascript',body:await readFile('frontend/account-center.js','utf8')}));
  await page.route('**/bracket-auth.js*',async route=>{
    const source=await readFile('frontend/bracket-auth.js','utf8');
    // Replace only the managed SDK boundary in this disposable context. The
    // production callback/routing/observation logic remains byte-identical.
    const boundary='export function loadBracketClient({ url, publishableKey }) {';
    assert.equal(source.split(boundary).length,2);
    await route.fulfill({contentType:'text/javascript',body:source.replace(boundary,boundary+'\nreturn Promise.resolve(window.callbackClientFixture);')});
  });
  await page.addInitScript(({mode,remembered})=>{
    sessionStorage.setItem('fbs-account-return',remembered);
    const user={id:'callback-fixture',email:'routing@example.test'},session={user},listeners=new Set();
    let complete;
    const initialized=new Promise(resolve=>{complete=resolve;});
    const error=mode==='expired'?{code:'otp_expired',message:'synthetic provider diagnostic'}:mode==='missing-verifier'?{name:'AuthPKCECodeVerifierMissingError',message:'synthetic provider diagnostic'}:null;
    window.callbackClientFixture={auth:{getSession:async()=>{await initialized;return error?{data:{session:null},error}:{data:{session}};},getUser:async()=>{await initialized;return{data:{user:mode==='expired'?null:user}};},
      onAuthStateChange:callback=>{listeners.add(callback);return{data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};},
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
  await page.goto(base+fixture.query+fixture.hash,{waitUntil:'domcontentloaded'});
  await page.locator(fixture.expected==='#account'?'[data-connected-feature]':'.team-grid').waitFor();
  assert.equal(await page.locator('.home-hero').count(),0,fixture.name+' before managed Auth finishes');
  await page.evaluate(()=>window.completeCallbackFixture());
  if(fixture.notice)await page.locator('main').getByText(fixture.notice,{exact:false}).waitFor();
  else await page.locator(fixture.expected==='#account'?'.account-center':'.team-grid').waitFor();
  const outcome=await page.evaluate(async()=>({hash:location.hash,query:location.search,home:!!document.querySelector('.home-hero'),
    recovering:(await import('/bracket-auth.js?v=header-account')).hasPasswordRecoverySession(),remembered:sessionStorage.getItem('fbs-account-return')}));
  assert.equal(outcome.hash,fixture.expected,fixture.name+' after credential cleanup');assert.equal(outcome.home,false);
  assert.equal(outcome.query,'');assert.equal(outcome.remembered,null);assert.equal(outcome.recovering,fixture.mode==='recovery');
  assert.doesNotMatch(await page.locator('body').innerText(),/synthetic provider diagnostic/);
  if(fixture.mode==='recovery'){assert.equal(await page.locator('#account-new-password').count(),1);assert.equal(await page.locator('#account-current-password').count(),0);}
  await page.close();return{name:fixture.name,passed:true};
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
  for(const width of [320,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:1050},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.abort());
    await page.goto(base+'#account');
    await page.locator('.account-section').first().waitFor();
    await page.evaluate(async()=>{
      const container=document.querySelector('main');
      container.innerHTML='<div class="wrap page-content" id="account-test"></div>';
      const profile={userId:'test-account',email:'fan@example.test',role:'user',status:'active',nickname:'Test fan',publicLeaderboard:false,sharePicks:false};
      const user={id:'test-account',email:profile.email};
      const requests=[];let factor=null,level='aal1';window.accountCalls=[];
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
        rpc:async(name,args)=>{window.accountCalls.push({name,args});if(name==='account_context')return{data:{...profile}};if(name==='my_account_requests')return{data:[...requests]};
          if(name==='save_account_profile'){Object.assign(profile,{nickname:args.p_nickname,publicLeaderboard:args.p_public,sharePicks:args.p_share_picks});return{data:{...profile}};}
          if(name==='submit_support_request'){const request={id:'test-request-id',category:args.p_category,status:'pending',createdAt:'2026-11-18T12:00:00Z'};requests.unshift(request);return{data:request};}
          throw Error('Unexpected RPC '+name);}};
      const {mountAccountCenter}=await import('/account-center.js');
      window.closeAccountTest=mountAccountCenter(document.querySelector('#account-test'),{previewClient:window.accountClient,previewConfig:{emailAuthEnabled:true}});
    });
    await page.locator('#account-nickname').waitFor();
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
    await page.locator('#account-details').fill('Please review this disposable test request.');
    await page.locator('[data-account-support] input[name="deletionConfirmed"]').check();
    await page.locator('[data-account-support] [type="submit"]').click();
    await page.getByText(/Request test-request-id is saved for review/).waitFor();
    await page.locator('[data-mfa-enroll]').click();
    await page.locator('.account-enrollment img').waitFor();
    assert.match(await page.locator('.account-enrollment img').getAttribute('src'),/^data:image\/svg\+xml/);
    await page.locator('#account-mfa-code').fill('123456');
    await page.locator('[data-mfa-verify] [type="submit"]').click();
    await page.getByText(/This session has passed the second check/).waitFor();
    await page.locator('[data-mfa-remove]').click();
    await page.getByText(/No verified authenticator yet/).waitFor();
    assert.equal(await page.evaluate(()=>window.accountCalls.filter(call=>call.name==='auth.refreshSession').length),1);
    await page.evaluate(async()=>{
      const {mountHeaderAccount}=await import('/bracket-auth.js?v=header-account');
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
        signUp:async args=>{window.authCalls.push({name:'signup',email:args.email});return{data:{}};},resend:async args=>{window.authCalls.push({name:'resend',email:args.email});return{data:{}};},resetPasswordForEmail:async email=>{window.authCalls.push({name:'recovery',email});return{data:{}};}}};
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
    await page.evaluate(async()=>{
      const {mountAdministration}=await import('/account-administration.js');
      const requests=[{id:'test-request',email:'fan@example.test',category:'general',message:'A private test support request.',status:'pending',notificationStatus:'pending'},
        {id:'test-failed-alert',email:'fan@example.test',category:'general',message:'A saved request with exhausted delivery attempts.',status:'pending',notificationStatus:'failed'},
        {id:'test-failed-alert-sent',email:'fan@example.test',category:'general',message:'A saved request whose retry will be accepted by the provider.',status:'pending',notificationStatus:'failed'}];
      const users=Array.from({length:23},(_,index)=>({userId:index===0?'test-user':`test-user-${index+1}`,
        email:index===0?'fan@example.test':`fan${String(index+1).padStart(2,'0')}@example.test`,
        nickname:index===0?'Fan':`Fan ${index+1}`,role:'user',status:'active',emailConfirmed:true})),actions=[];let lastRequeue;
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
          if(name==='admin_support_requests')return{data:{requests,total:requests.length}};
          if(name==='admin_action_history')return{data:{actions,total:actions.length}};
          if(name==='admin_update_request'){const row=requests.find(row=>row.id===args.p_request_id);row.status=args.p_status;row.adminNote=args.p_note;return{data:row};}
          if(name==='admin_set_account_status'){users.find(row=>row.userId===args.p_user_id).status=args.p_status;return{data:{}};}
          if(name==='admin_requeue_support_notification'){const row=requests.find(row=>row.id===args.p_request_id);if(row.notificationStatus!=='failed')throw Error('Only failed notifications can be requeued');row.notificationStatus='pending';lastRequeue=row.id;actions.unshift({action:'support_notification_requeue',details:{reason:args.p_reason}});return{data:{requestId:row.id,notificationStatus:'pending'}};}
          throw Error('Unexpected admin RPC '+name);
        }};
      mountAdministration(document.querySelector('#account-test'),{previewClient:client,previewConfig:{supportNotificationsEnabled:true}});
    });
    await page.locator('.admin-user').first().waitFor();
    const userPages=page.locator('nav[aria-label="Registered user pages"]');
    const checkUserPage=async(number,count,range)=>{
      await userPages.locator(`[data-admin-users-page="${number}"][aria-current="page"]`).waitFor();
      await page.locator('[data-admin-users-range]').filter({hasText:range}).waitFor();
      assert.equal(await page.locator('[data-admin-users-range]').innerText(),`${range} · 10 per page`);
      assert.equal(await page.locator('.admin-user').count(),count);
      const call=await page.evaluate(()=>window.adminCalls.filter(call=>call.name==='admin_users').at(-1));
      assert.equal(call.args.p_limit,10);assert.equal(call.args.p_offset,(number-1)*10);
      await assertPageFits(page,`Admin page ${number} overflow at ${width}`);
    };
    await checkUserPage(1,10,'Showing 1–10 of 23 accounts');
    assert.equal(await page.locator('.admin-user details[open]').count(),0);
    assert.equal(await userPages.getByRole('button',{name:'Previous',exact:true}).isDisabled(),true);
    await userPages.locator('[data-admin-users-page="2"]').first().click();
    await checkUserPage(2,10,'Showing 11–20 of 23 accounts');
    assert.match(await page.locator('.admin-user').first().innerText(),/fan11@example\.test/);
    await userPages.locator('[data-admin-users-page="3"]').first().click();
    await checkUserPage(3,3,'Showing 21–23 of 23 accounts');
    assert.equal(await userPages.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
    assert.match(await page.locator('.admin-user').first().innerText(),/fan21@example\.test/);
    await userPages.locator('[data-admin-users-page="2"]').first().click();
    await checkUserPage(2,10,'Showing 11–20 of 23 accounts');
    await page.locator('[data-admin-search] input').fill('fan@example.test');
    await page.locator('[data-admin-search] [type="submit"]').click();
    await page.locator('[data-admin-users-range]').filter({hasText:'Showing 1–1 of 1 matching account ·'}).waitFor();
    assert.equal(await page.locator('.admin-user').count(),1);
    assert.deepEqual(await page.evaluate(()=>window.adminCalls.filter(call=>call.name==='admin_users').at(-1).args),{p_search:'fan@example.test',p_limit:10,p_offset:0});
    await assertPageFits(page,`Admin filtered users overflow at ${width}`);
    await page.locator('[data-admin-search] input').fill('');
    await page.locator('[data-admin-search] [type="submit"]').click();
    await checkUserPage(1,10,'Showing 1–10 of 23 accounts');
    await page.locator('.admin-request > summary').first().click();
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
    assert.deepEqual(errors,[]);results.push({width,account:true,registrationMock:true,recoveryMock:true,googleMigrationMock:true,mfaMock:true,adminMock:true,adminPaginationMock:true,failedNotificationRequeueMock:true,overflow:false,labels:true});await page.close();
  }
  const callbacks=[];for(const fixture of callbackCases)callbacks.push(await checkCallbackRouting(fixture));
  console.log(JSON.stringify({status:'passed',providerFlows:'Browser-only SDK/RPC doubles; no real email or OAuth delivery claimed',checks:results,callbacks},null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
