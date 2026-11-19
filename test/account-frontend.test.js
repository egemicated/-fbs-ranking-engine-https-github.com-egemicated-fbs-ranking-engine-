import test from 'node:test';
import assert from 'node:assert/strict';
import { accountCapabilities, validateNewPassword, accountCallbackUrl, cleanAccountCallbackUrl, updateAccountPassword, secondFactorRequired, authFormMarkup, authMessage } from '../frontend/account-auth.js';
import { accountCenterMarkup, qrDataUrl, supportRequestMarkup, mountAccountCenter } from '../frontend/account-center.js';
import { administrationMarkup, mountAdministration, failedNotificationRetryMarkup, notificationRequeueNotice, requeueFailedNotification } from '../frontend/account-administration.js';
import { notifySupportIfReady } from '../frontend/account-support.js';
import { accountCallbackMode, initialAccountReturnUrl, safeAccountReturnHash, accountCallbackErrorNotice } from '../frontend/bracket-auth.js?v=header-account';

const strong='A long test passphrase 42';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('email registration and recovery fail closed until delivery readiness is explicitly enabled',()=>{
  assert.deepEqual(accountCapabilities(),{emailLogin:false,registration:false,recovery:false,google:true});
  for(const config of [{},{emailAuthEnabled:true},{emailAuthEnabled:true,emailRegistrationEnabled:'true',passwordRecoveryEnabled:'true'}]){
    const markup=authFormMarkup('signin',{config,googleEnabled:true});
    assert.doesNotMatch(markup,/data-auth-mode="register"|data-auth-mode="recovery"|data-auth-mode="verification"/);
    assert.match(markup,/Continue with Google/);
  }
  const ready=authFormMarkup('signin',{config:{emailAuthEnabled:true,emailRegistrationEnabled:true,passwordRecoveryEnabled:true}});
  assert.match(ready,/data-auth-mode="register"/);assert.match(ready,/data-auth-mode="recovery"/);
  assert.match(ready,/data-auth-mode="verification"/);
  assert.doesNotMatch(authFormMarkup('verification',{config:{emailAuthEnabled:true,emailRegistrationEnabled:true}}),/type="password"/);
});

test('password entry handles passphrases, confirmation, length and UTF-8 bcrypt byte limits',()=>{
  assert.equal(validateNewPassword(strong,strong),strong);
  for(const [value,confirmation] of [['short','short'],[strong,'different'],['a'.repeat(65),'a'.repeat(65)],['😀'.repeat(20),'😀'.repeat(20)]])assert.throws(()=>validateNewPassword(value,confirmation));
  assert.equal(validateNewPassword('é'.repeat(30),'é'.repeat(30)),'é'.repeat(30));
});

test('callbacks preserve origin and remove authorization credentials and provider errors from history',()=>{
  assert.equal(accountCallbackUrl('https://fbs-intelligence.onrender.com','recovery'),'https://fbs-intelligence.onrender.com/?account=recovery#account');
  assert.throws(()=>accountCallbackUrl('https://example.com','evil'));
  const cleaned=cleanAccountCallbackUrl('https://example.com/?code=private&account=recovery&error_description=private&season=2026#account');
  assert.equal(cleaned,'https://example.com/?season=2026#account');
  assert.equal(cleanAccountCallbackUrl('https://example.com/#access_token=secret&refresh_token=secret'),'https://example.com/#account');
});

test('adding a password updates the current Google identity and never signs up or edits saved application data',async()=>{
  const calls=[];const user={id:'original-id',email:'owner@example.test',app_metadata:{providers:['google']}};
  const client={auth:{getUser:async()=>({data:{user}}),updateUser:async values=>{calls.push(values);return{data:{user}};},signUp:()=>assert.fail('Migration must not sign up')}};
  assert.equal((await updateAccountPassword(client,{password:strong,confirmation:strong})).id,user.id);
  assert.deepEqual(calls,[{password:strong}]);
});

test('password changes preserve MFA session and use server current-password validation without signing in again',async()=>{
  const user={id:'owner',email:'owner@example.test'};let updates=0;
  const auth={getUser:async()=>({data:{user}}),signInWithPassword:async()=>assert.fail('Do not downgrade aal2 by signing in again'),updateUser:async attributes=>{updates++;assert.equal(attributes.current_password,'old');return{data:{user}};}};
  assert.equal((await updateAccountPassword({auth},{password:strong,confirmation:strong,currentPassword:'old'})).id,'owner');assert.equal(updates,1);
  auth.updateUser=async()=>({error:new Error('Managed validation rejected current password')});
  await assert.rejects(updateAccountPassword({auth},{password:strong,confirmation:strong,currentPassword:'wrong'}),/Managed validation/);
  auth.updateUser=async()=>({data:{user:{id:'other'}}});
  await assert.rejects(updateAccountPassword({auth},{password:strong,confirmation:strong}),/identity/);
});

test('MFA completes only an existing verified TOTP factor and distinguishes aal1 from aal2',async()=>{
  const client={auth:{mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal1',nextLevel:'aal2'}}),listFactors:async()=>({data:{totp:[{id:'incomplete',status:'unverified'},{id:'verified',status:'verified'}]}})}}};
  assert.equal(await secondFactorRequired(client),'verified');
  client.auth.mfa.getAuthenticatorAssuranceLevel=async()=>({data:{currentLevel:'aal2',nextLevel:'aal2'}});assert.equal(await secondFactorRequired(client),null);
  client.auth.mfa.getAuthenticatorAssuranceLevel=async()=>({data:{currentLevel:'aal1',nextLevel:'aal2'}});client.auth.mfa.listFactors=async()=>({data:{totp:[]}});await assert.rejects(secondFactorRequired(client),/authenticator/);
});

test('public form output escapes arbitrary account and request text without exposing hidden operations',()=>{
  const markup=accountCenterMarkup({email:'<script>bad</script>',nickname:'<img src=x>',role:'user',status:'active'},{config:{emailAuthEnabled:true},requests:[{id:'<bad>',category:'general',status:'pending',createdAt:'2026-11-18T12:00:00Z'}],mfa:{factors:[]}});
  assert.doesNotMatch(markup,/<script>|<img src=x>|href="#admin"/);assert.match(markup,/&lt;script&gt;/);assert.match(markup,/Manage My Teams/);
  assert.doesNotMatch(supportRequestMarkup([]),/data-admin/);
  const admin=administrationMarkup({users:[{userId:'user',email:'<script>',nickname:'<img>',role:'user',status:'active'}],requests:[{id:'request',message:'<script>alert(1)</script>',category:'deletion',status:'pending'}]});
  assert.doesNotMatch(admin,/<script>|type="password"|data-admin-delete|data-admin-pick/);assert.match(admin,/does not delete/);
  assert.equal(qrDataUrl('javascript:alert(1)'),null);assert.match(qrDataUrl('<svg></svg>'),/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
});

function adminFixture({user={id:'u'},role='user',level='aal2'}={}){
  const calls=[],root={innerHTML:'',addEventListener(){},removeEventListener(){}};
  const client={auth:{getUser:async()=>({data:{user}}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:level,nextLevel:level}}),listFactors:async()=>({data:{totp:[]}})}},rpc:async name=>{calls.push(name);return{data:name==='account_context'?{role,status:'active'}:name==='admin_users'?{users:[],total:0}:name==='admin_support_requests'?{requests:[],total:0}:{actions:[],total:0}};}};
  return{root,calls,close:mountAdministration(root,{previewClient:client,previewConfig:{}})};
}

test('guest and regular-user administration views never request privileged records',async()=>{
  const guest=adminFixture({user:null});await flush();assert.deepEqual(guest.calls,[]);assert.match(guest.root.innerHTML,/Sign in from the header/);guest.close();
  const regular=adminFixture();await flush();assert.deepEqual(regular.calls,['account_context']);assert.match(regular.root.innerHTML,/provisioned administrator/);regular.close();
});

test('administrator UI requires aal2 before listing users, support or audit history',async()=>{
  const weak=adminFixture({role:'admin',level:'aal1'});await flush();assert.deepEqual(weak.calls,['account_context']);assert.match(weak.root.innerHTML,/authenticator/);weak.close();
  const verified=adminFixture({role:'admin'});await flush();assert.deepEqual(verified.calls,['account_context','admin_users','admin_support_requests','admin_action_history']);assert.match(verified.root.innerHTML,/Protected administration/);verified.close();
});

test('an unmounted administration view cannot render late private data',async()=>{
  const pending=adminFixture({role:'admin'});pending.close();await flush();assert.doesNotMatch(pending.root.innerHTML,/Registered users|Support requests/);
});

test('authentication errors are generic and do not echo credentials or provider diagnostic strings',()=>{
  assert.doesNotMatch(authMessage({message:'private password secret'}),/private password secret/);
  assert.match(authMessage({status:429}),/Too many/);assert.match(authMessage({code:'email_not_confirmed'}),/Verify your email/);
});

test('support email notifications remain gated and delivery failures never throw away a saved request',async()=>{
  let calls=0;const client={functions:{invoke:async()=>{calls++;throw Error('Temporary delivery failure');}}};
  assert.deepEqual(await notifySupportIfReady(client),{enabled:false,notified:false});assert.equal(calls,0);
  assert.deepEqual(await notifySupportIfReady(client,{supportNotificationsEnabled:true}),{enabled:true,notified:false});assert.equal(calls,1);
});

test('an enrolled aal1 account can reopen verification without fetching protected account data',async()=>{
  const root={innerHTML:'',addEventListener(){},removeEventListener(){}};
  const client={auth:{getUser:async()=>({data:{user:{id:'mfa-user'}}}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal1',nextLevel:'aal2'}}),listFactors:async()=>({data:{totp:[{id:'factor',status:'verified'}]}})}},rpc:async()=>assert.fail('Private RPC must wait until MFA verification')};
  const close=mountAccountCenter(root,{previewClient:client,previewConfig:{}});await flush();
  assert.match(root.innerHTML,/data-account-verify/);assert.doesNotMatch(root.innerHTML,/could not load/);close();
});

test('deletion review does not present a resolved action and notification controls follow readiness',()=>{
  const state={requests:[{id:'request',category:'deletion',status:'pending',notificationStatus:'sent',adminNote:'Reviewed'}]};
  const markup=administrationMarkup(state);
  assert.match(markup,/Accepted by email provider/);assert.match(markup,/maxlength="500">Reviewed/);
  const requestForm=markup.split('data-admin-request="request"')[1].split('</form>')[0];assert.doesNotMatch(requestForm,/value="resolved"/);
  assert.doesNotMatch(markup,/data-admin-notify/);
  assert.match(administrationMarkup({...state,notificationsEnabled:true}),/data-admin-notify/);
});

test('sign-out immediately clears rendered private account details before the next async request',async()=>{
  let listener,user={id:'original'};
  const root={innerHTML:'',addEventListener(){},removeEventListener(){}};
  const client={auth:{getUser:async()=>({data:{user}}),onAuthStateChange:callback=>{listener=callback;return{data:{subscription:{unsubscribe(){}}}};}},
    rpc:async name=>({data:name==='account_context'?{email:'private@example.test',role:'user',status:'active'}:[]})};
  const close=mountAccountCenter(root,{previewClient:client,previewConfig:{}});await flush();assert.match(root.innerHTML,/private@example.test/);
  user=null;listener('SIGNED_OUT');assert.doesNotMatch(root.innerHTML,/private@example.test/);await new Promise(done=>setTimeout(done,5));assert.match(root.innerHTML,/Sign in from the header/);close();
});

test('a failed-alert requeue form appears only with explicit notification readiness and a required explanation',()=>{
  for(const enabled of [false,undefined,'true'])assert.equal(failedNotificationRetryMarkup({id:'request',notificationStatus:'failed'},enabled),'');
  for(const notificationStatus of ['pending','processing','sent',undefined])assert.equal(failedNotificationRetryMarkup({id:'request',notificationStatus},true),'');
  const markup=failedNotificationRetryMarkup({id:'request',notificationStatus:'failed'},true);
  assert.match(markup,/data-admin-notification-requeue="request"/);assert.match(markup,/name="reason" minlength="5" maxlength="500" required/);
  assert.match(markup,/duplicate-prevention window has expired/);assert.match(markup,/support request itself remains saved/);
  assert.match(administrationMarkup({requests:[{id:'request',notificationStatus:'failed'}],notificationsEnabled:true}),/data-admin-notification-requeue/);
});

test('requeue validates readiness and reason, preserves queue acceptance when dispatch fails, and never claims delivery',async()=>{
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push({name,args});return{data:{requestId:args.p_request_id,notificationStatus:'pending'}};},functions:{invoke:async(name,args)=>{calls.push({name,args});throw Error('Temporary provider outage');}}};
  await assert.rejects(requeueFailedNotification(client,{requestId:'request',reason:'Please retry'}),/not enabled/);
  await assert.rejects(requeueFailedNotification(client,{requestId:'request',reason:'bad',enabled:true}),/explain/);assert.deepEqual(calls,[]);
  const result=await requeueFailedNotification(client,{requestId:'request',reason:'  Email setup repaired  ',enabled:true});
  assert.equal(result.requeued,true);assert.deepEqual(calls,[{name:'admin_requeue_support_notification',args:{p_request_id:'request',p_reason:'Email setup repaired'}},{name:'account-support',args:{body:{action:'notify'}}}]);
  assert.doesNotMatch(JSON.stringify(result),/delivered|sent|notified/);
  let dispatches=0;client.rpc=async()=>({error:{code:'42501'}});client.functions.invoke=async()=>{dispatches++;};
  await assert.rejects(requeueFailedNotification(client,{requestId:'request',reason:'Permission test',enabled:true}));assert.equal(dispatches,0);
});

test('requeue feedback separates queued alerts, provider acceptance and actual inbox delivery',()=>{
  assert.match(notificationRequeueNotice('pending'),/Delivery is pending/);
  assert.match(notificationRequeueNotice('sent'),/provider accepted/);assert.match(notificationRequeueNotice('sent'),/Inbox receipt is not confirmed/);
  assert.match(notificationRequeueNotice('failed'),/another review/);assert.match(notificationRequeueNotice(undefined),/has not been confirmed/);
  for(const state of ['pending','processing','sent','failed',undefined])assert.match(notificationRequeueNotice(state),/support request remains saved/);
});

test('email callbacks override stale OAuth destinations without consuming pending managed credentials',()=>{
  for(const mode of ['recovery','verification']){
    const before=`https://example.test/?account=${mode}&code=synthetic#account`;
    const planned=new URL(initialAccountReturnUrl(before,'#home'));
    assert.equal(planned.hash,'#account');assert.equal(planned.searchParams.get('code'),'synthetic');assert.equal(accountCallbackMode(planned.href),mode);
  }
  const implicit='https://example.test/?account=recovery#access_token=synthetic&refresh_token=synthetic&type=recovery';
  assert.equal(new URL(initialAccountReturnUrl(implicit,'#home')).hash,new URL(implicit).hash);
  assert.equal(accountCallbackMode(implicit),'recovery');
});

test('ordinary Google PKCE callbacks retain remembered pages and never store credential fragments as navigation',()=>{
  assert.equal(new URL(initialAccountReturnUrl('https://example.test/?code=synthetic#home','#teams/fcs')).hash,'#teams/fcs');
  assert.equal(new URL(initialAccountReturnUrl('https://example.test/?weekly=1&code=synthetic','#home')).hash,'#beat-the-model');
  assert.equal(safeAccountReturnHash('#access_token=synthetic&refresh_token=synthetic'),'#account');
});

test('callback errors use fixed guidance for expired or mismatched links without reflecting provider diagnostics',()=>{
  assert.equal(accountCallbackErrorNotice(null),'');
  assert.match(accountCallbackErrorNotice({code:'otp_expired'}),/expired or is no longer available/);
  assert.match(accountCallbackErrorNotice({code:'flow_state_not_found'}),/use it once/);
  for(const error of [{code:'bad_code_verifier'},{name:'AuthPKCECodeVerifierMissingError'}])assert.match(accountCallbackErrorNotice(error),/matched to this browser/);
  assert.doesNotMatch(accountCallbackErrorNotice({message:'private provider detail with token'}),/private provider|token/);
});
