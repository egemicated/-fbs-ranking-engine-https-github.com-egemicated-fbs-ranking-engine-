const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Denver'}).format(new Date(value))+' MT':'Not reported';
export const SUPPORT_CATEGORIES=[['general','General support'],['access','Account access'],['teams','Saved teams'],['contest','Contest picks'],['profile','Nickname or visibility'],['data','Data discrepancy'],['deletion','Account deletion']];
export const supportCategoryLabel=value=>SUPPORT_CATEGORIES.find(([key])=>key===value)?.[1]??'Account support';
const requestStatus=value=>({pending:'Pending',in_review:'In review',resolved:'Resolved',closed:'Closed'}[value]??'Not reported');

export function supportResponseMarkup(row,{admin=false}={}){
  const responses=Array.isArray(row.responses)?row.responses:[];
  const original=!admin&&typeof row.message==='string'?`<details class="support-original"><summary>Your original details</summary><p>${escapeHtml(row.message)}</p></details>`:'';
  return original+(responses.length?`<section class="support-responses" aria-label="${admin?'User-visible responses':'Responses from FBS Intelligence'}"><h3>${admin?'Responses visible to the user':'Responses from FBS Intelligence'}</h3>${responses.map(response=>`<article class="support-response"><p class="compact-note"><time>${date(response.createdAt)}</time>${response.requiresAction?' · Action requested':''}</p><p>${escapeHtml(response.message)}</p></article>`).join('')}${row.responseTotal>responses.length?`<p class="compact-note">Showing the latest ${responses.length} responses.</p>`:''}</section>`:'');
}

export function supportRequestMarkup(requests=[],{idPrefix='account'}={}){
  const prefix=escapeHtml(idPrefix);
  return `<section class="account-section"><h2>Private support</h2><p class="compact-note">Send an account question or data correction. Keep passwords, authenticator codes and recovery links out of requests. Private responses appear in your request history below.</p><form class="account-form" data-account-support data-account-request>
    <label for="${prefix}-category">Request type</label><select id="${prefix}-category" name="category">${SUPPORT_CATEGORIES.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select>
    <label for="${prefix}-details">Details</label><textarea id="${prefix}-details" name="message" rows="3" minlength="5" maxlength="2000" required></textarea>
    <label class="account-check" data-support-deletion hidden><input type="checkbox" name="deletionConfirmed" disabled> I understand this submits a deletion review request. It does not immediately delete my FBS account, contest history or Google account.</label>
    <button class="button" type="submit">Send private request</button><p role="status" data-form-status data-account-request-status></p></form>
    <details class="support-request-history"><summary>Your requests${requests.length?` · ${requests.length}`:''}</summary>${requests.length?`<ul class="account-request-list">${requests.map(row=>`<li><div><strong>${escapeHtml(supportCategoryLabel(row.category??row.kind))}</strong><span class="account-status">${requestStatus(row.status)}</span></div><p class="compact-note">${date(row.createdAt)} · Request ${escapeHtml(row.id)}</p>${row.updatedAt&&row.updatedAt!==row.createdAt?`<p class="compact-note">Updated ${date(row.updatedAt)}</p>`:''}${supportResponseMarkup(row)}${!row.responses?.length?'<p class="compact-note">No response yet. Your request remains available for review.</p>':''}</li>`).join('')}</ul>`:'<p class="compact-note">No previous requests.</p>'}</details></section>`;
}

export function updateSupportCategory(form){
  const deletion=form.querySelector('[data-support-deletion]'),confirmation=form.querySelector('[name="deletionConfirmed"]');
  const selected=form.querySelector('[name="category"]')?.value==='deletion';
  if(deletion)deletion.hidden=!selected;
  if(confirmation){confirmation.disabled=!selected;confirmation.required=selected;if(!selected)confirmation.checked=false;}
}

export function supportSubmission(values){
  const category=String(values.get('category')??''),message=String(values.get('message')??'').trim();
  if(!SUPPORT_CATEGORIES.some(([key])=>key===category)||message.length<5||message.length>2000)throw Error('Choose a request type and enter details between 5 and 2000 characters.');
  if(category==='deletion'&&values.get('deletionConfirmed')!=='on')throw Error('Confirm the deletion-request acknowledgment before submitting.');
  return{p_category:category,p_message:message};
}

export function restoreSupportDraft(form,values){
  if(!form)return;
  const category=form.querySelector('[name="category"]'),message=form.querySelector('[name="message"]');
  if(category)category.value=String(values.get('category')??'general');
  if(message)message.value=String(values.get('message')??'');
  updateSupportCategory(form);
  const confirmation=form.querySelector('[name="deletionConfirmed"]');
  if(confirmation&&!confirmation.disabled)confirmation.checked=values.get('deletionConfirmed')==='on';
}

export function supportResultNotice(request){
  return request.alreadyOpen===true?`An open request already exists in this category (Request ${request.id}). Your new details were not sent. Your draft has been kept; review the existing request below.`:`Request ${request.id} is saved for review. Its status appears below.`;
}

// A saved request is durable even when an optional email notification fails.
export async function notifySupportIfReady(client, config = {}) {
  if (config.supportNotificationsEnabled !== true) return { enabled:false, notified:false };
  try {
    const result = await client.functions.invoke('account-support',{body:{action:'notify'}});
    return { enabled:true, notified:!result.error && result.data?.accepted === true && result.data?.delivery !== 'retry_pending' };
  } catch { return { enabled:true, notified:false }; }
}
