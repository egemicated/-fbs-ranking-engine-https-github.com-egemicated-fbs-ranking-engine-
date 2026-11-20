import { loadAccountConfig, loadBracketClient } from './bracket-auth.js?v=clean-routes';
import { secondFactorRequired, openAccountDialog } from './account-auth.js';
import { notifySupportIfReady, supportResponseMarkup, supportCategoryLabel } from './account-support.js';

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Denver'}).format(new Date(value))+' MT':'Not reported';
const status=value=>({pending:'Pending',in_review:'In review',resolved:'Resolved',closed:'Closed',active:'Active',suspended:'Suspended',deletion_pending:'Deletion requested'}[value]??'Not reported');
const notification=value=>({pending:'Pending',processing:'Processing',sent:'Accepted by email provider',failed:'Needs retry'}[value]??'Not reported');

const ADMIN_PAGE_SIZE = 8;
export { ADMIN_PAGE_SIZE as ADMIN_USERS_PAGE_SIZE, ADMIN_PAGE_SIZE as ADMIN_AUDIT_PAGE_SIZE };

export function adminUserPageState(total, requestedPage = 1) {
  const count = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  const pages = Math.max(1, Math.ceil(count / ADMIN_PAGE_SIZE));
  const page = Math.min(pages, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(value => value >= 1 && value <= pages).sort((a, b) => a - b);
  return { total:count, page, pages, offset:(page - 1) * ADMIN_PAGE_SIZE, numbers };
}

const number = value => value.toLocaleString('en-US');

function paginationMarkup(paging, group, label) {
  if (paging.pages <= 1) return '';
  const pageButton = (page, label, disabled = false, current = false) => `<button class="button light small" type="button" data-admin-${group}-page="${page}"${disabled ? ' disabled' : ''}${current ? ' aria-current="page"' : ''}${typeof label === 'number' ? ` aria-label="Page ${label}"` : ''}>${label}</button>`;
  const numbers = paging.numbers.map((page, index) => `${index && page > paging.numbers[index - 1] + 1 ? '<span class="admin-page-gap" aria-hidden="true">…</span>' : ''}${pageButton(page, page, false, page === paging.page)}`).join('');
  return `<nav class="admin-pagination" aria-label="${label}">${pageButton(paging.page - 1, 'Previous', paging.page === 1)}${numbers}${pageButton(paging.page + 1, 'Next', paging.page === paging.pages)}</nav>`;
}

function paginationRange(paging, rows, group, label, empty) {
  const text = rows ? `Showing ${number(paging.offset + 1)}–${number(paging.offset + rows)} of ${number(paging.total)} ${label} · ${ADMIN_PAGE_SIZE} per page` : empty;
  return `<p class="compact-note admin-page-range" role="status" tabindex="-1" data-admin-${group}-range>${text}</p><p class="compact-note admin-page-feedback" role="status" tabindex="-1" data-admin-page-feedback></p><button class="button light small admin-page-retry" type="button" data-admin-page-retry hidden>Retry</button>`;
}

export function registeredUsersMarkup({ users = [], userTotal = users.length, userPage = 1, search = '' } = {}) {
  const paging = adminUserPageState(userTotal, userPage), rows = users.slice(0, ADMIN_PAGE_SIZE);
  const accountLabel = `${search ? 'matching ' : ''}${paging.total === 1 ? 'account' : 'accounts'}`;
  return `<section class="panel" data-admin-users-panel><div class="panel-head"><h2>Registered users <small>${number(paging.total)}${search ? ' matching' : ''}</small></h2></div><div class="panel-body account-section"><form class="account-inline-form" data-admin-search><label for="admin-user-search">Search email or nickname</label><input id="admin-user-search" name="search" type="search" value="${escapeHtml(search)}" maxlength="120"><button class="button light small" type="submit">Search</button></form>
    ${paginationRange(paging, rows.length, 'users', accountLabel, search ? 'No accounts match this search.' : 'No accounts have been registered.')}
    ${rows.length ? `<div class="admin-user-list">${rows.map(row => `<article class="admin-user"><details><summary class="admin-user-heading"><span class="admin-user-identity"><strong>${escapeHtml(row.nickname || 'No public nickname')}</strong><span class="admin-user-email">${escapeHtml(row.email ?? 'Email unavailable')}</span></span><span class="admin-user-indicators"><span class="account-status">${status(row.status)}</span><span class="admin-user-disclosure">Details <span aria-hidden="true">⌄</span></span></span></summary><div class="admin-user-details"><p class="compact-note">${row.role === 'admin' ? 'Administrator' : 'User'} · ${row.emailConfirmed ? 'Email verified' : 'Email not verified'} · Joined ${date(row.createdAt)} · Last sign-in ${date(row.lastSignInAt)}</p>${row.role !== 'admin' ? `<form class="account-form" data-admin-user-status="${escapeHtml(row.userId)}"><label for="user-state-${escapeHtml(row.userId)}">Account participation</label><select id="user-state-${escapeHtml(row.userId)}" name="status"><option value="active"${row.status === 'active' ? ' selected' : ''}>Active</option><option value="suspended"${row.status === 'suspended' ? ' selected' : ''}>Suspended</option></select><label for="user-reason-${escapeHtml(row.userId)}">Reason for this change</label><input id="user-reason-${escapeHtml(row.userId)}" name="reason" minlength="5" maxlength="500" required><button class="button small" type="submit">Update status</button><p role="status" data-form-status></p></form><form class="account-form" data-admin-nickname="${escapeHtml(row.userId)}"><label for="user-name-${escapeHtml(row.userId)}">Moderated public nickname</label><input id="user-name-${escapeHtml(row.userId)}" name="nickname" value="${escapeHtml(row.nickname ?? '')}" minlength="2" maxlength="30" required><label for="name-reason-${escapeHtml(row.userId)}">Moderation reason</label><input id="name-reason-${escapeHtml(row.userId)}" name="reason" minlength="5" maxlength="500" required><button class="button light small" type="submit">Update nickname</button><p role="status" data-form-status></p></form>` : '<p class="compact-note">Administrator roles are provisioned through the protected owner process. This screen cannot grant roles or suspend administrators.</p>'}</div></details></article>`).join('')}</div>` : ''}
    ${paginationMarkup(paging, 'users', 'Registered user pages')}</div></section>`;
}

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

function supportRequestCard(row,notificationsEnabled){
  const id=escapeHtml(row.id),deletion=row.category==='deletion'||row.kind==='deletion';
  return `<details class="admin-request" id="support-request-${id}"><summary><span><strong>${escapeHtml(supportCategoryLabel(row.category??row.kind))}</strong> · ${escapeHtml(row.email??'Email unavailable')}</span><span class="account-status">${status(row.status)}</span></summary><p class="compact-note">Request ${id} · ${date(row.createdAt)} · Notification: ${notification(row.notificationStatus)}</p><p class="admin-request-message">${escapeHtml(row.message)}</p>${failedNotificationRetryMarkup(row,notificationsEnabled)}${deletion?'<p class="account-notice">This is a deletion review request. Changing its status does not delete the Auth identity, contest history or Google account. Permanent deletion remains a separate protected operation.</p>':''}${supportResponseMarkup(row,{admin:true})}
    ${row.userId?`<form class="account-form admin-private-reply" data-admin-reply="${id}"><h3>Respond to this user</h3><label for="request-reply-${id}">Private response</label><textarea id="request-reply-${id}" name="reply" rows="3" minlength="1" maxlength="2000" required></textarea><label class="account-check"><input type="checkbox" name="requiresAction"> Ask the user to take further action</label><p class="compact-note">Visible in this user's private request history. Internal notes belong in the separate field below. No private message text is sent in notification email.</p><button class="button small" type="submit">Send private response</button><p role="status" data-form-status></p></form>`:'<p class="compact-note">In-app responses require a request associated with a signed-in account.</p>'}
    <form class="account-form" data-admin-request="${id}"><label for="request-state-${id}">New status</label><select id="request-state-${id}" name="status">${(deletion?['pending','in_review','closed']:['pending','in_review','resolved','closed']).map(value=>`<option value="${value}"${value===row.status?' selected':''}>${status(value)}</option>`).join('')}</select><label for="request-note-${id}">Internal review note</label><textarea id="request-note-${id}" name="note" rows="2" maxlength="500">${escapeHtml(row.adminNote??'')}</textarea><p class="compact-note">Internal notes are visible only to authorized administrators. Keep passwords, codes and unnecessary personal information out of notes.</p><button class="button small" type="submit">Update request</button><p role="status" data-form-status></p></form></details>`;
}

export function adminAuditMarkup(actions = [], {total = actions.length, page = 1} = {}) {
  const labels={support_status:'Support request status changed',account_status:'Account participation changed',nickname_moderation:'Public nickname moderated',protected_admin_provision:'Administrator provisioned',support_notification_requeue:'Failed email alert requeued',support_reply:'Private support response sent'};
  const paging = adminUserPageState(total, page), rows = actions.slice(0, ADMIN_PAGE_SIZE);
  return `<section class="panel" data-admin-audit-panel><div class="panel-head"><h2>Administrative action history</h2></div><div class="panel-body account-section">
    ${paginationRange(paging, rows.length, 'audit', paging.total === 1 ? 'action' : 'actions', 'No administrative actions recorded.')}
    ${rows.length ? `<ol class="admin-audit-list" start="${paging.offset + 1}">${rows.map(row=>{const details=row.details??{},change=details.from&&details.to?`${status(details.from)} → ${status(details.to)}`:details.requiresAction===true?'Further action requested':details.reason??details.note??'';return `<li><div><strong>${escapeHtml(labels[row.action]??'Administrative action recorded')}</strong><span class="account-status">Completed</span></div><time>${date(row.createdAt)}</time><p class="compact-note">By ${escapeHtml(row.actorLabel??'Administrator identity not reported')} · ${escapeHtml(row.targetLabel??'Affected account not reported')}</p>${change?`<p>${escapeHtml(change)}</p>`:''}${details.requestId?`<p class="compact-note">Support request ${escapeHtml(details.requestId)}</p>`:''}</li>`;}).join('')}</ol>` : ''}
    ${paginationMarkup(paging, 'audit', 'Administrative action history pages')}
    <p class="compact-note">Rejected operations are not listed here. Audit entries cannot be edited.</p></div></section>`;
}

export function administrationMarkup({users=[],userTotal=users.length,userPage=1,requests=[],requestTotal=0,requestStatusCounts,notificationCounts,actions=[],auditTotal=actions.length,auditPage=1,filter='pending',search='',notificationsEnabled=false,notice=''}={}){
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const due=count(notificationCounts?.due),failed=count(notificationCounts?.failed);
  return `<div class="account-admin">${notice?`<p class="account-notice" role="status" tabindex="-1" data-admin-result>${escapeHtml(notice)}</p>`:''}<section class="panel"><div class="panel-body account-section"><span class="eyebrow">Protected administration</span><h1>Account administration</h1><p class="compact-note">Verified administrator session. User passwords, protected future picks, ranking positions and locked contest selections are not available here.</p><a href="/account">Your account and authenticator settings →</a></div></section>
    <section class="panel"><div class="panel-head"><h2>Support requests <small>${escapeHtml(requestTotal)} ${filter?status(filter).toLowerCase():'across all statuses'}</small></h2></div><div class="panel-body account-section">${requestStatusCounts?`<dl class="admin-support-totals">${['pending','in_review','resolved','closed'].map(value=>`<div><dt>${status(value)}</dt><dd>${count(requestStatusCounts[value])??'Not reported'}</dd></div>`).join('')}</dl>`:'<p class="compact-note">Status totals are unavailable in this response.</p>'}<form class="account-inline-form" data-admin-filter><label for="admin-request-status">Request status</label><select id="admin-request-status" name="status">${[['pending','Pending'],['in_review','In review'],['resolved','Resolved'],['closed','Closed'],['','All statuses']].map(([value,label])=>`<option value="${value}"${value===filter?' selected':''}>${label}</option>`).join('')}</select><button class="button light small" type="submit">Apply</button></form>
    ${notificationsEnabled?`<button class="button light small" type="button" data-admin-notify${due===null||due===0?' disabled':''}>Process queued email alerts${due!==null?` (${due})`:''}</button><p class="compact-note">${due===null?'The queued-alert count is unavailable. Reload before processing notifications.':due===0?'No queued email alerts are due.':`${due} queued alert${due===1?' is':'s are'} due for processing.`}${failed?` ${failed} failed alert${failed===1?' needs':'s need'} individual review; use All statuses to inspect them.`:''}</p><p class="compact-note" role="status" data-admin-notification-status></p>`:'<p class="compact-note">Email alerts are not enabled. Requests remain saved in this review queue.</p>'}
    ${requests.length?`<div class="admin-request-list">${requests.map(row=>supportRequestCard(row,notificationsEnabled)).join('')}</div>`:`<p class="account-empty">${filter?`No ${status(filter).toLowerCase()} requests. Other status totals appear above.`:'No support requests have been submitted.'}</p>`}${requestTotal>requests.length?'<p class="compact-note">Showing the first 50 requests. Filter by status to narrow the list.</p>':''}</div></section>
    ${registeredUsersMarkup({users,userTotal,userPage,search})}
    ${adminAuditMarkup(actions,{total:auditTotal,page:auditPage})}</div>`;
}

export function mountAdministration(container,{previewClient,previewConfig}={}) {
  let active=true,client,config,busy=false,refreshing=false,generation=0,search='',filter='pending',subscription,timer,reloadAfterBusy=false,requeuedRequestId=null,operationNotice='',verifiedView=false,notificationDue=0;
  const pages = { users:{page:1,total:0,loading:false}, audit:{page:1,total:0,loading:false} };
  async function rpc(name,args){
    const result=await client.rpc(name,args);
    if([401,403].includes(result.status))throw Object.assign(new Error('Administrator access denied'),{status:result.status});
    if(result.error)throw result.error;
    return result.data;
  }
  function readPage(group, page, query = search) {
    const args = { p_limit:ADMIN_PAGE_SIZE, p_offset:(page - 1) * ADMIN_PAGE_SIZE };
    return group === 'users' ? rpc('admin_users', { p_search:query, ...args }) : rpc('admin_action_history', args);
  }
  async function loadPanel(group, requestedPage, query = search) {
    const state = pages[group];
    if (!verifiedView || refreshing || busy || state.loading) return;
    const panel = container.querySelector(`[data-admin-${group}-panel]`);
    if (!panel) return;
    const feedback = panel.querySelector('[data-admin-page-feedback]');
    const retry = panel.querySelector('[data-admin-page-retry]');
    const fields = [...panel.querySelectorAll('button,input,select,textarea')].filter(field => !field.disabled);
    const version = generation;
    const current = () => active && verifiedView && version === generation;
    const searching = group === 'users' && query !== search;
    state.loading = true;
    panel.setAttribute('aria-busy', 'true');
    retry.hidden = true;
    feedback.textContent = searching ? 'Searching registered users…' : `Loading page ${number(requestedPage)}…`;
    for (const field of fields) field.disabled = true;
    try {
      let data = await readPage(group, requestedPage, query);
      if (!current()) return;
      let paging = adminUserPageState(data?.total, requestedPage);
      if (paging.page !== requestedPage) {
        requestedPage = paging.page;
        data = await readPage(group, requestedPage, query);
        if (!current()) return;
        paging = adminUserPageState(data?.total, requestedPage);
      }
      const rows = group === 'users' ? data?.users : data?.actions;
      if (!Array.isArray(rows) || paging.page !== requestedPage || paging.total !== data.total) throw Error('Invalid administration page');
      const markup = group === 'users' ? registeredUsersMarkup({ users:rows, userTotal:paging.total, userPage:paging.page, search:query })
        : adminAuditMarkup(rows, paging);
      panel.outerHTML = markup;
      state.page = paging.page;
      state.total = paging.total;
      if (group === 'users') search = query;
      container.querySelector(`[data-admin-${group}-range]`)?.focus();
    } catch (error) {
      if (!current()) return;
      if ([401,403].includes(error?.status) || ['42501','PGRST301','PGRST302','PGRST303'].includes(error?.code)) {
        verifiedView = false;
        return void load({ preserveContent:false });
      }
      feedback.textContent = searching ? 'The search could not load.' : 'This page could not load.';
      retry.hidden = false;
      retry.onclick = () => void loadPanel(group, requestedPage, query);
      feedback.focus();
    } finally {
      if (current()) {
        state.loading = false;
        panel.removeAttribute('aria-busy');
        for (const field of fields) field.disabled = false;
      }
    }
  }
  async function load({preserveContent=verifiedView}={}){
    const version=++generation,current=()=>active&&version===generation;
    refreshing=true;
    pages.users.loading=pages.audit.loading=false;
    if(preserveContent&&verifiedView){container.setAttribute?.('aria-busy','true');for(const field of container.querySelectorAll?.('button,input,select,textarea')??[])field.disabled=true;}
    else container.innerHTML='<section class="panel"><div class="panel-body"><p role="status">Verifying administrator access…</p></div></section>';
    try{
      config=previewConfig??await loadAccountConfig();client=previewClient??await loadBracketClient(config);
      if(!subscription&&client.auth.onAuthStateChange)subscription=client.auth.onAuthStateChange(event=>{
        if(!['SIGNED_IN','SIGNED_OUT','MFA_CHALLENGE_VERIFIED','TOKEN_REFRESHED'].includes(event))return;
        if(['SIGNED_IN','SIGNED_OUT'].includes(event)){requeuedRequestId=null;operationNotice='';}
        verifiedView=false;
        ++generation;container.innerHTML='<p role="status">Rechecking access…</p>';clearTimeout(timer);
        if(busy){reloadAfterBusy=true;return;}
        timer=setTimeout(()=>{if(active)void load();},0);
      }).data.subscription;
      const user=await client.auth.getUser();if(!current())return;
      if(user.error||!user.data?.user) {container.innerHTML='<section class="panel"><div class="panel-body account-section"><h1>Administration</h1><p>Sign in from the header with your provisioned administrator account.</p></div></section>';return;}
      const requiredFactor=await secondFactorRequired(client);if(!current())return;
      if(requiredFactor){container.innerHTML='<section class="panel"><div class="panel-body account-section"><h1>Verify your account</h1><p>Verify your authenticator before checking private administrator access.</p><button class="button" type="button" data-admin-verify>Verify authenticator</button><p role="status" data-admin-status></p></div></section>';return;}
      const context=await rpc('account_context');if(!current())return;
      if(context?.role!=='admin'){container.innerHTML='<section class="panel"><div class="panel-body account-section"><h1>Administration</h1><p>This page requires a provisioned administrator account.</p><a href="/account">Return to your account</a></div></section>';return;}
      const assurance=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(assurance.error)throw assurance.error;if(!current())return;
      if(assurance.data?.currentLevel!=='aal2'){
        const factor=await secondFactorRequired(client);if(!current())return;
        container.innerHTML=`<section class="panel"><div class="panel-body account-section"><h1>Verify administrator access</h1><p>Every administrator operation requires a verified authenticator session.</p>${factor?'<button class="button" type="button" data-admin-verify>Verify authenticator</button>':'<a class="button" href="/account">Set up your authenticator</a>'}<p role="status" data-admin-status></p></div></section>`;return;
      }
      const [users,requests,audit]=await Promise.all([readPage('users',pages.users.page),rpc('admin_support_requests',{p_status:filter||null,p_limit:50,p_offset:0}),readPage('audit',pages.audit.page)]);
      if(current()){
        const nextUsers=adminUserPageState(users?.total,pages.users.page),nextAudit=adminUserPageState(audit?.total,pages.audit.page);
        const pageChanged=nextUsers.page!==pages.users.page||nextAudit.page!==pages.audit.page;
        Object.assign(pages.users,{page:nextUsers.page,total:nextUsers.total});
        Object.assign(pages.audit,{page:nextAudit.page,total:nextAudit.total});
        if(pageChanged)return void load();
        const rows=requests?.requests??[];
        const notice=requeuedRequestId?notificationRequeueNotice(rows.find(row=>row.id===requeuedRequestId)?.notificationStatus):operationNotice;
        notificationDue=Number.isSafeInteger(requests?.notifications?.due)&&requests.notifications.due>0?requests.notifications.due:0;
        container.innerHTML=administrationMarkup({users:users?.users??[],userTotal:nextUsers.total,userPage:nextUsers.page,requests:rows,requestTotal:requests?.total??0,requestStatusCounts:requests?.statusCounts,notificationCounts:requests?.notifications,actions:audit?.actions??[],auditTotal:nextAudit.total,auditPage:nextAudit.page,search,filter,notificationsEnabled:config.supportNotificationsEnabled===true,notice});
        verifiedView=true;
        if(notice)container.querySelector?.('[data-admin-result]')?.focus();
      }
    }catch{if(current()){verifiedView=false;container.innerHTML=`<section class="panel"><div class="panel-body account-section"><h1>Administration unavailable</h1><p role="status">${requeuedRequestId?'The email alert was requeued, but the review queue could not refresh. Delivery is not confirmed. The support request remains saved.':'Access could not be verified. Reload before making another change.'} Verify your authenticator or sign in again.</p><a href="/account">Account security</a><button class="button light small" type="button" data-admin-retry>Try again</button></div></section>`;}}
    finally{if(current()){refreshing=false;container.removeAttribute?.('aria-busy');}}
  }
  const onSubmit=async event=>{
    const form=event.target.closest('form');if(!form||!container.contains(form))return;event.preventDefault();if(busy||refreshing||!verifiedView||!client)return;
    const values=new FormData(form);
    if(form.matches('[data-admin-search]'))return void loadPanel('users',1,String(values.get('search')??'').trim());
    if(form.matches('[data-admin-filter]')){requeuedRequestId=null;operationNotice='';filter=String(values.get('status')??'');return void load();}
    const requeue=form.matches('[data-admin-notification-requeue]');
    busy=true;const button=form.querySelector('[type="submit"]'),message=form.querySelector('[data-form-status]');button.disabled=true;
    try{
      requeuedRequestId=null;
      operationNotice='';
      if(requeue){const requestId=form.dataset.adminNotificationRequeue;await requeueFailedNotification(client,{requestId,reason:String(values.get('reason')??''),enabled:config.supportNotificationsEnabled===true});requeuedRequestId=requestId;}
      else if(form.matches('[data-admin-reply]')){
        const reply=String(values.get('reply')??'').trim(),requiresAction=values.get('requiresAction')==='on';
        if(!reply||reply.length>2000)throw Error('Invalid response');
        const signature=JSON.stringify([reply,requiresAction]);
        if(form.dataset.replySignature!==signature){form.dataset.replyId=crypto.randomUUID();form.dataset.replySignature=signature;}
        const saved=await rpc('admin_reply_request',{p_request_id:form.dataset.adminReply,p_reply_id:form.dataset.replyId,p_message:reply,p_requires_action:requiresAction});
        if(saved?.id!==form.dataset.replyId)throw Error('Response could not be confirmed');
        operationNotice='Private response saved in the user’s request history. Internal notes remain private to administrators.';
      }
      else if(form.matches('[data-admin-request]')){await rpc('admin_update_request',{p_request_id:form.dataset.adminRequest,p_status:String(values.get('status')),p_note:String(values.get('note')??'')});operationNotice='Request status and internal note saved.';}
      else if(form.matches('[data-admin-user-status]'))await rpc('admin_set_account_status',{p_user_id:form.dataset.adminUserStatus,p_status:String(values.get('status')),p_reason:String(values.get('reason')??'').trim()});
      else if(form.matches('[data-admin-nickname]'))await rpc('admin_moderate_nickname',{p_user_id:form.dataset.adminNickname,p_nickname:String(values.get('nickname')??'').trim(),p_reason:String(values.get('reason')??'').trim()});
      await load();
    }catch{if(active&&message?.isConnected)message.textContent=requeue?'The alert requeue could not be confirmed. Check its notification status before retrying. The support request remains saved.':'This operation was not completed. Verify your administrator session and try again. Protected contest selections cannot be changed here.';}
    finally{busy=false;if(active&&button.isConnected)button.disabled=false;if(active&&reloadAfterBusy){reloadAfterBusy=false;void load();}}
  };
  const onClick=async event=>{
    const userPageButton=event.target.closest('[data-admin-users-page]');
    const pageButton=userPageButton??event.target.closest('[data-admin-audit-page]');
    if(pageButton){
      if(pageButton.disabled)return;
      const group=userPageButton?'users':'audit';
      const {total,page}=pages[group];
      const nextPage=Number(userPageButton?pageButton.dataset.adminUsersPage:pageButton.dataset.adminAuditPage);
      if(!Number.isSafeInteger(nextPage)||nextPage<1||nextPage>adminUserPageState(total,page).pages||nextPage===page)return;
      return void loadPanel(group,nextPage);
    }
    if(event.target.closest('[data-admin-retry]'))return void load();
    if(event.target.closest('[data-admin-notify]')&&!busy&&config.supportNotificationsEnabled===true){
      if(notificationDue<1)return;
      busy=true;
      const status=container.querySelector('[data-admin-notification-status]');
      const result=await notifySupportIfReady(client,config);
      operationNotice=result.notified?'Queued alerts were processed by the email provider. This does not confirm inbox receipt.':'Email alerts remain queued for retry. Support requests are still saved.';
      if(active&&status)status.textContent=operationNotice;
      busy=false;if(active){reloadAfterBusy=false;void load();}return;
    }
    if(!event.target.closest('[data-admin-verify]')||busy)return;
    try{const factor=await secondFactorRequired(client);if(factor&&active)openAccountDialog({client,config,mode:'mfa',mfaFactorId:factor,onSignedIn:()=>void load()});else await load();}
    catch{const status=container.querySelector('[data-admin-status]');if(status)status.textContent='Authenticator verification could not start. Sign in again.';}
  };
  container.addEventListener('submit',onSubmit);container.addEventListener('click',onClick);void load();
  return()=>{active=false;++generation;clearTimeout(timer);subscription?.unsubscribe();container.removeEventListener('submit',onSubmit);container.removeEventListener('click',onClick);};
}
