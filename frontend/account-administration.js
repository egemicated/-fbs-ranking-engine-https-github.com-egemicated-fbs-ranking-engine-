import { loadAccountConfig, loadBracketClient } from './bracket-auth.js?v=header-account';
import { secondFactorRequired, openAccountDialog } from './account-auth.js';
import { notifySupportIfReady } from './account-support.js';

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Denver'}).format(new Date(value))+' MT':'Not reported';
const status=value=>({pending:'Pending',in_review:'In review',resolved:'Resolved',closed:'Closed',active:'Active',suspended:'Suspended',deletion_pending:'Deletion requested'}[value]??'Not reported');
const notification=value=>({pending:'Pending',processing:'Processing',sent:'Accepted by email provider',failed:'Needs retry'}[value]??'Not reported');

export function failedNotificationRetryMarkup(row, notificationsEnabled) {
  if (notificationsEnabled !== true || row.notificationStatus !== 'failed') return '';
  const id=escapeHtml(row.id);
  return `<details class="admin-notification-retry"><summary>Requeue failed email alert</summary><p class="compact-note">A retry may send a duplicate if the email provider’s duplicate-prevention window has expired. The support request itself remains saved.</p><form class="account-form" data-admin-notification-requeue="${id}"><label for="notification-retry-reason-${id}">Reason for retry</label><input id="notification-retry-reason-${id}" name="reason" minlength="5" maxlength="500" required><button class="button light small" type="submit">Requeue this alert</button><p role="status" data-form-status></p></form></details>`;
}

export function notificationRequeueNotice(value) {
  if(value==='sent')return 'The email provider accepted this alert. Inbox receipt is not confirmed. The support request remains saved.';
  if(value==='failed')return 'The alert was requeued, but delivery needs another review. The support request remains saved.';
  if(value==='pending'||value==='processing')return 'Email alert requeued. Delivery is pending. The support request remains saved.';
  return 'Email alert requeued. Check its notification status below; delivery has not been confirmed. The support request remains saved.';
}

export async function requeueFailedNotification(client,{requestId,reason,enabled}={}) {
  const explanation=typeof reason==='string'?reason.trim():'';
  if(enabled!==true)throw Error('Notification delivery is not enabled.');
  if(typeof requestId!=='string'||!requestId||explanation.length<5||explanation.length>500)throw Error('Choose a failed alert and explain the retry.');
  const result=await client.rpc('admin_requeue_support_notification',{p_request_id:requestId,p_reason:explanation});
  if(result.error)throw result.error;
  if(result.data?.requestId!==requestId||result.data?.notificationStatus!=='pending')throw Error('The requeue could not be confirmed.');
  // Queue acceptance is durable. Optional dispatch failure never turns it into
  // an apparent unsaved request, and batch acceptance does not prove this
  // particular alert reached the provider (or the recipient's inbox).
  const dispatch=await notifySupportIfReady(client,{supportNotificationsEnabled:true});
  return {requestId,requeued:true,dispatchRequested:dispatch.enabled};
}

export function administrationMarkup({ users=[], userTotal=0, requests=[], requestTotal=0, actions=[], filter='pending', search='', notificationsEnabled=false, notice='' }={}) {
  return `<div class="account-admin">${notice?`<p class="account-notice" role="status" tabindex="-1" data-admin-result>${escapeHtml(notice)}</p>`:''}<section class="panel"><div class="panel-body account-section"><span class="eyebrow">Protected administration</span><h1>Account administration</h1><p class="compact-note">Verified administrator session. User passwords, protected future picks, ranking positions and locked contest selections are not available here.</p><a href="#account">Your account and authenticator settings →</a></div></section>
    <section class="panel"><div class="panel-head"><h2>Support requests <small>${escapeHtml(requestTotal)}</small></h2></div><div class="panel-body account-section"><form class="account-inline-form" data-admin-filter><label for="admin-request-status">Request status</label><select id="admin-request-status" name="status">${[['pending','Pending'],['in_review','In review'],['resolved','Resolved'],['closed','Closed'],['','All statuses']].map(([value,label])=>`<option value="${value}"${value===filter?' selected':''}>${label}</option>`).join('')}</select><button class="button light small" type="submit">Apply</button></form>
    ${notificationsEnabled?'<button class="button light small" type="button" data-admin-notify>Retry queued email alerts</button><p class="compact-note" role="status" data-admin-notification-status></p>':'<p class="compact-note">Email alerts are not enabled. Requests remain saved in this review queue.</p>'}${requests.length ? `<div class="admin-request-list">${requests.map(row=>`<details class="admin-request"><summary><span><strong>${escapeHtml(row.category??row.kind)}</strong> · ${escapeHtml(row.email??'Email unavailable')}</span><span class="account-status">${status(row.status)}</span></summary><p class="compact-note">Request ${escapeHtml(row.id)} · ${date(row.createdAt)} · Notification: ${notification(row.notificationStatus)}</p><p class="admin-request-message">${escapeHtml(row.message)}</p>${failedNotificationRetryMarkup(row,notificationsEnabled)}${row.category==='deletion'||row.kind==='deletion'?'<p class="account-notice">This is a deletion review request. Changing its status does not delete the Auth identity, contest history or Google account. Permanent deletion remains a separate protected operation.</p>':''}<form class="account-form" data-admin-request="${escapeHtml(row.id)}"><label for="request-state-${escapeHtml(row.id)}">New status</label><select id="request-state-${escapeHtml(row.id)}" name="status">${(row.category==='deletion'||row.kind==='deletion'?['pending','in_review','closed']:['pending','in_review','resolved','closed']).map(value=>`<option value="${value}"${value===row.status?' selected':''}>${status(value)}</option>`).join('')}</select><label for="request-note-${escapeHtml(row.id)}">Internal review note</label><textarea id="request-note-${escapeHtml(row.id)}" name="note" rows="2" maxlength="500">${escapeHtml(row.adminNote??'')}</textarea><p class="compact-note">Internal notes are recorded in the audit history. Keep passwords, codes and unnecessary personal information out of notes.</p><button class="button small" type="submit">Update request</button><p role="status" data-form-status></p></form></details>`).join('')}</div>`:'<p class="account-empty">No requests match this status.</p>'}${requestTotal>requests.length?'<p class="compact-note">Showing the first 50 requests. Filter by status to narrow the list.</p>':''}</div></section>
    <section class="panel"><div class="panel-head"><h2>Registered users <small>${escapeHtml(userTotal)}</small></h2></div><div class="panel-body account-section"><form class="account-inline-form" data-admin-search><label for="admin-user-search">Search email or nickname</label><input id="admin-user-search" name="search" type="search" value="${escapeHtml(search)}" maxlength="120"><button class="button light small" type="submit">Search</button></form>
    ${users.length?`<div class="admin-user-list">${users.map(row=>`<article class="admin-user"><div class="admin-user-heading"><div><h3>${escapeHtml(row.nickname||'No public nickname')}</h3><p>${escapeHtml(row.email??'Email unavailable')}</p></div><span class="account-status">${status(row.status)}</span></div><p class="compact-note">${row.role==='admin'?'Administrator':'User'} · ${row.emailConfirmed?'Email verified':'Email not verified'} · Joined ${date(row.createdAt)} · Last sign-in ${date(row.lastSignInAt)}</p>${row.role!=='admin'?`<details><summary>Manage account</summary><form class="account-form" data-admin-user-status="${escapeHtml(row.userId)}"><label for="user-state-${escapeHtml(row.userId)}">Account participation</label><select id="user-state-${escapeHtml(row.userId)}" name="status"><option value="active"${row.status==='active'?' selected':''}>Active</option><option value="suspended"${row.status==='suspended'?' selected':''}>Suspended</option></select><label for="user-reason-${escapeHtml(row.userId)}">Reason for this change</label><input id="user-reason-${escapeHtml(row.userId)}" name="reason" minlength="5" maxlength="500" required><button class="button small" type="submit">Update status</button><p role="status" data-form-status></p></form><form class="account-form" data-admin-nickname="${escapeHtml(row.userId)}"><label for="user-name-${escapeHtml(row.userId)}">Moderated public nickname</label><input id="user-name-${escapeHtml(row.userId)}" name="nickname" value="${escapeHtml(row.nickname??'')}" minlength="2" maxlength="30" required><label for="name-reason-${escapeHtml(row.userId)}">Moderation reason</label><input id="name-reason-${escapeHtml(row.userId)}" name="reason" minlength="5" maxlength="500" required><button class="button light small" type="submit">Update nickname</button><p role="status" data-form-status></p></form></details>`:'<p class="compact-note">Administrator roles are provisioned through the protected owner process. This screen cannot grant roles or suspend administrators.</p>'}</article>`).join('')}</div>`:'<p class="account-empty">No accounts match this search.</p>'}${userTotal>users.length?'<p class="compact-note">Showing the first 50 matching accounts. Refine the search for a specific user.</p>':''}</div></section>
    <section class="panel"><div class="panel-head"><h2>Administrative action history</h2></div><div class="panel-body account-section">${actions.length?`<ol class="admin-audit-list">${actions.map(row=>`<li><strong>${escapeHtml(row.action)}</strong><time>${date(row.createdAt)}</time><p class="compact-note">${escapeHtml(row.details?.reason??row.details?.note??'Administrative operation recorded.')}</p></li>`).join('')}</ol>`:'<p class="account-empty">No administrative actions recorded.</p>'}<p class="compact-note">Showing up to 50 recent actions. Audit entries cannot be edited here.</p></div></section></div>`;
}

export function mountAdministration(container,{previewClient,previewConfig}={}) {
  let active=true,client,config,context,busy=false,generation=0,search='',filter='pending',subscription,timer,reloadAfterBusy=false,requeuedRequestId=null;
  async function rpc(name,args){const result=await client.rpc(name,args);if(result.error)throw result.error;return result.data;}
  async function load(){
    const version=++generation,current=()=>active&&version===generation;
    container.innerHTML='<section class="panel"><div class="panel-body"><p role="status">Verifying administrator access…</p></div></section>';
    try{
      config=previewConfig??await loadAccountConfig();client=previewClient??await loadBracketClient(config);
      if(!subscription&&client.auth.onAuthStateChange)subscription=client.auth.onAuthStateChange(event=>{
        if(!['SIGNED_IN','SIGNED_OUT','MFA_CHALLENGE_VERIFIED','TOKEN_REFRESHED'].includes(event))return;
        if(['SIGNED_IN','SIGNED_OUT'].includes(event))requeuedRequestId=null;
        ++generation;container.innerHTML='<p role="status">Rechecking access…</p>';clearTimeout(timer);
        if(busy){reloadAfterBusy=true;return;}
        timer=setTimeout(()=>{if(active)void load();},0);
      }).data.subscription;
      const user=await client.auth.getUser();if(!current())return;
      if(user.error||!user.data?.user) {container.innerHTML='<section class="panel"><div class="panel-body account-section"><h1>Administration</h1><p>Sign in from the header with your provisioned administrator account.</p></div></section>';return;}
      const requiredFactor=await secondFactorRequired(client);if(!current())return;
      if(requiredFactor){container.innerHTML='<section class="panel"><div class="panel-body account-section"><h1>Verify your account</h1><p>Verify your authenticator before checking private administrator access.</p><button class="button" type="button" data-admin-verify>Verify authenticator</button><p role="status" data-admin-status></p></div></section>';return;}
      context=await rpc('account_context');if(!current())return;
      if(context?.role!=='admin'){container.innerHTML='<section class="panel"><div class="panel-body account-section"><h1>Administration</h1><p>This page requires a provisioned administrator account.</p><a href="#account">Return to your account</a></div></section>';return;}
      const assurance=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(assurance.error)throw assurance.error;if(!current())return;
      if(assurance.data?.currentLevel!=='aal2'){
        const factor=await secondFactorRequired(client);if(!current())return;
        container.innerHTML=`<section class="panel"><div class="panel-body account-section"><h1>Verify administrator access</h1><p>Every administrator operation requires a verified authenticator session.</p>${factor?'<button class="button" type="button" data-admin-verify>Verify authenticator</button>':'<a class="button" href="#account">Set up your authenticator</a>'}<p role="status" data-admin-status></p></div></section>`;return;
      }
      const [users,requests,audit]=await Promise.all([rpc('admin_users',{p_search:search,p_limit:50,p_offset:0}),rpc('admin_support_requests',{p_status:filter||null,p_limit:50,p_offset:0}),rpc('admin_action_history',{p_limit:50,p_offset:0})]);
      if(current()){
        const rows=requests?.requests??[];
        const notice=requeuedRequestId?notificationRequeueNotice(rows.find(row=>row.id===requeuedRequestId)?.notificationStatus):'';
        container.innerHTML=administrationMarkup({users:users?.users??[],userTotal:users?.total??0,requests:rows,requestTotal:requests?.total??0,actions:audit?.actions??[],search,filter,notificationsEnabled:config.supportNotificationsEnabled===true,notice});
        if(notice)container.querySelector?.('[data-admin-result]')?.focus();
      }
    }catch{if(current())container.innerHTML=`<section class="panel"><div class="panel-body account-section"><h1>Administration unavailable</h1><p role="status">${requeuedRequestId?'The email alert was requeued, but the review queue could not refresh. Delivery is not confirmed. The support request remains saved.':'Access could not be verified. Reload before making another change.'} Verify your authenticator or sign in again.</p><a href="#account">Account security</a><button class="button light small" type="button" data-admin-retry>Try again</button></div></section>`;}
  }
  const onSubmit=async event=>{
    const form=event.target.closest('form');if(!form||!container.contains(form))return;event.preventDefault();if(busy||!client)return;
    const values=new FormData(form);
    if(form.matches('[data-admin-search]')){requeuedRequestId=null;search=String(values.get('search')??'').trim();return void load();}
    if(form.matches('[data-admin-filter]')){requeuedRequestId=null;filter=String(values.get('status')??'');return void load();}
    const requeue=form.matches('[data-admin-notification-requeue]');
    busy=true;const button=form.querySelector('[type="submit"]'),message=form.querySelector('[data-form-status]');button.disabled=true;
    try{
      requeuedRequestId=null;
      if(requeue){const requestId=form.dataset.adminNotificationRequeue;await requeueFailedNotification(client,{requestId,reason:String(values.get('reason')??''),enabled:config.supportNotificationsEnabled===true});requeuedRequestId=requestId;}
      else if(form.matches('[data-admin-request]'))await rpc('admin_update_request',{p_request_id:form.dataset.adminRequest,p_status:String(values.get('status')),p_note:String(values.get('note')??'')});
      else if(form.matches('[data-admin-user-status]'))await rpc('admin_set_account_status',{p_user_id:form.dataset.adminUserStatus,p_status:String(values.get('status')),p_reason:String(values.get('reason')??'').trim()});
      else if(form.matches('[data-admin-nickname]'))await rpc('admin_moderate_nickname',{p_user_id:form.dataset.adminNickname,p_nickname:String(values.get('nickname')??'').trim(),p_reason:String(values.get('reason')??'').trim()});
      await load();
    }catch{if(active&&message?.isConnected)message.textContent=requeue?'The alert requeue could not be confirmed. Check its notification status before retrying. The support request remains saved.':'This operation was not completed. Verify your administrator session and try again. Protected contest selections cannot be changed here.';}
    finally{busy=false;if(active&&button.isConnected)button.disabled=false;if(active&&reloadAfterBusy){reloadAfterBusy=false;void load();}}
  };
  const onClick=async event=>{
    if(event.target.closest('[data-admin-retry]'))return void load();
    if(event.target.closest('[data-admin-notify]')&&!busy&&config.supportNotificationsEnabled===true){
      busy=true;
      const status=container.querySelector('[data-admin-notification-status]');
      const result=await notifySupportIfReady(client,config);
      if(active&&status)status.textContent=result.notified?'Queued alerts were processed by the email provider. This does not confirm inbox receipt.':'Email alerts remain queued for retry. Support requests are still saved.';
      busy=false;if(active&&reloadAfterBusy){reloadAfterBusy=false;void load();}return;
    }
    if(!event.target.closest('[data-admin-verify]')||busy)return;
    try{const factor=await secondFactorRequired(client);if(factor&&active)openAccountDialog({client,config,mode:'mfa',mfaFactorId:factor,onSignedIn:()=>void load()});else await load();}
    catch{const status=container.querySelector('[data-admin-status]');if(status)status.textContent='Authenticator verification could not start. Sign in again.';}
  };
  container.addEventListener('submit',onSubmit);container.addEventListener('click',onClick);void load();
  return()=>{active=false;++generation;clearTimeout(timer);subscription?.unsubscribe();container.removeEventListener('submit',onSubmit);container.removeEventListener('click',onClick);};
}
