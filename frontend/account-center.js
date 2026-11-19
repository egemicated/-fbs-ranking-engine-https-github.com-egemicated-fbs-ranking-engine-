import { loadAccountConfig, loadBracketClient, hasPasswordRecoverySession, finishPasswordRecovery, getAccountCallbackNotice } from './bracket-auth.js?v=clean-routes';
import { accountCapabilities, authMessage, updateAccountPassword, secondFactorRequired, openAccountDialog, PasswordValidationError } from './account-auth.js';
import { notifySupportIfReady, supportRequestMarkup, updateSupportCategory, supportSubmission, restoreSupportDraft, supportResultNotice } from './account-support.js';
export { supportRequestMarkup, SUPPORT_CATEGORIES } from './account-support.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Denver'}).format(new Date(value)) : 'Not reported';
const statusLabel = value => ({pending:'Pending',in_review:'In review',resolved:'Resolved',closed:'Closed',active:'Active',suspended:'Suspended',deletion_pending:'Deletion requested'}[value] ?? 'Not reported');
export function authenticatorLabel(factor={}) {
  const friendly=String(factor.friendly_name??'');
  const generated=/^(?:FBS Intelligence|The Games Decide) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:Z)?$/.exec(friendly);
  const created=factor.created_at??(generated?generated[1]+'Z':null);
  return `${generated||!friendly?'The Games Decide authenticator':friendly}${created&&Number.isFinite(Date.parse(created))?' · Added '+date(created):''}`;
}

export function accountCenterMarkup(context, { config = {}, requests = [], mfa, recovering = false, callbackNotice = '' } = {}) {
  const caps = accountCapabilities(config), admin = context.role === 'admin';
  const verified = mfa?.factors?.filter(factor=>factor.status === 'verified') ?? [];
  return `<div class="account-center"><section class="panel account-overview"><div class="panel-body"><span class="eyebrow">Your account at The Games Decide</span><h1>Account settings</h1><p>${escapeHtml(context.email)}</p><div class="account-summary"><span class="account-status">${statusLabel(context.status)}</span><span>${admin ? 'Administrator' : 'Free account'}</span><a href="/my-teams">Manage My Teams →</a>${admin ? '<a href="/admin">Administration →</a>' : ''}</div>${context.status === 'suspended' ? '<p class="account-notice">Contest participation is suspended. You can still review your account and contact support.</p>' : ''}${callbackNotice?`<p class="account-notice" role="status">${escapeHtml(callbackNotice)}</p>`:''}${recovering ? '<p class="account-notice" role="status">Your recovery link was verified. Set a new password below.</p>' : ''}</div></section>
    <div class="account-grid"><section class="panel"><div class="panel-body account-section"><h2>Public profile</h2><p class="compact-note">Your email stays private. Choose the nickname visitors see on contest leaderboards.</p><form class="account-form" data-account-profile>
      <label for="account-nickname">Public nickname</label><input id="account-nickname" name="nickname" autocomplete="nickname" value="${escapeHtml(context.nickname ?? '')}" minlength="2" maxlength="30" required>
      <label class="account-check"><input type="checkbox" name="public"${context.publicLeaderboard ? ' checked' : ''}> Show my nickname and results on public leaderboards</label>
      <label class="account-check"><input type="checkbox" name="share"${context.sharePicks ? ' checked' : ''}${context.publicLeaderboard ? '' : ' disabled'}> Share my picks after each game’s confirmed kickoff</label>
      <p class="compact-note">Other people—including administrators—cannot view protected future picks. Sharing applies only when your public profile is enabled.</p><button class="button" type="submit">Save profile</button><p role="status" data-form-status></p></form></div></section>
    <section class="panel"><div class="panel-body account-section"><h2>${recovering ? 'Choose a new password' : 'Password and sign-in'}</h2>${caps.emailLogin ? `<p class="compact-note">Already use Google? Adding a password here keeps this same account, saved teams and picks. Continue using Google until you have tested your password sign-in.</p><form class="account-form" data-account-password>
      ${recovering ? '' : '<label for="account-current-password">Current password, if already set</label><input id="account-current-password" name="currentPassword" type="password" autocomplete="current-password"><p class="compact-note">Leave this blank when adding a password to your Google account.</p>'}
      <label for="account-new-password">New password</label><input id="account-new-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="64" required>
      <label for="account-confirm-password">Confirm new password</label><input id="account-confirm-password" name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="64" required><p class="compact-note">Use 12–64 characters. A unique passphrase is a good choice.</p><button class="button" type="submit">${recovering ? 'Set new password' : 'Save password'}</button><p role="status" data-form-status></p></form>` : '<p class="compact-note">Google sign-in remains available. Password access will appear once the email authentication setup has been verified.</p>'}
      <button class="button light small" type="button" data-account-signout-all>Sign out all devices</button><p class="compact-note" data-session-status role="status"></p></div></section>
    <section class="panel"><div class="panel-body account-section"><h2>Authenticator security</h2><p class="compact-note">An authenticator app adds a second check when you sign in. ${admin ? 'It is required for all administrator operations.' : 'It is optional for a regular account.'}</p>${mfa?.unavailable ? '<p class="compact-note">Authenticator settings could not load. Reload to try again.</p>' : `<p class="compact-note">${verified.length ? `${verified.length} verified authenticator${verified.length===1?'':'s'}.` : 'No verified authenticator yet.'} ${mfa?.currentLevel === 'aal2' ? 'This session has passed the second check.' : ''}</p>
      ${mfa?.enrollment ? `<div class="account-enrollment"><img src="${escapeHtml(qrDataUrl(mfa.enrollment.totp?.qr_code) ?? '')}" alt="Scan this QR code with your authenticator app"><details><summary>Enter setup key manually</summary><code>${escapeHtml(mfa.enrollment.totp?.secret ?? '')}</code></details><p class="compact-note">Keep this key private. We will not show it again.</p></div>` : '<button class="button light small" type="button" data-mfa-enroll>Add authenticator</button>'}
      ${mfa?.enrollment || verified.length && mfa.currentLevel !== 'aal2' ? `<form class="account-form" data-mfa-verify><label for="account-mfa-code">Authenticator code</label><input id="account-mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="button" type="submit">Verify code</button><p role="status" data-form-status></p></form>` : ''}
      ${mfa?.factors?.length ? `<ul class="account-factor-list">${mfa.factors.map(factor=>`<li><span>${escapeHtml(authenticatorLabel(factor))} · ${factor.status==='verified'?'Verified':'Setup incomplete'}</span>${admin && factor.status==='verified' && verified.length<2 ? '<small>Add another authenticator before removing this one.</small>' : `<button type="button" class="text-button" data-mfa-remove="${escapeHtml(factor.id)}">Remove</button>`}</li>`).join('')}</ul>` : ''}`}<p role="status" data-mfa-status></p></div></section>
    <section class="panel"><div class="panel-body">${supportRequestMarkup(requests)}</div></section></div></div>`;
}

export function qrDataUrl(svg) {
  // supabase-js wraps the server SVG in a data URL; direct Auth responses may
  // contain the raw SVG. Both stay an image source, never injected DOM markup.
  if (typeof svg === 'string' && /^data:image\/svg\+xml;(?:charset=utf-8|utf-8|base64),/i.test(svg)) return svg;
  if (typeof svg !== 'string' || !svg.trimStart().startsWith('<svg')) return null;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function mountAccountCenter(container, { previewClient, previewConfig } = {}) {
  let client, config, context, requests = [], mfa, active = true, generation = 0, busy = false, subscription, timer, reloadAfterBusy = false;
  const showLoading = () => { container.innerHTML = '<div class="panel"><div class="panel-body"><p role="status">Loading your account…</p></div></div>'; };
  const draw = () => { if (active) container.innerHTML = accountCenterMarkup(context, { config, requests, mfa, recovering:hasPasswordRecoverySession(),callbackNotice:getAccountCallbackNotice() }); };
  async function rpc(name,args) { const result=await client.rpc(name,args); if(result.error)throw result.error; return result.data; }
  async function load() {
    const version = ++generation, current = () => active && generation === version;
    showLoading();
    try {
      config = previewConfig ?? await loadAccountConfig();
      client = previewClient ?? await loadBracketClient(config);
      if (!subscription && client.auth.onAuthStateChange) subscription = client.auth.onAuthStateChange(event => {
        if (!['SIGNED_IN','SIGNED_OUT','USER_UPDATED','MFA_CHALLENGE_VERIFIED','PASSWORD_RECOVERY'].includes(event)) return;
        const identityChanged=['SIGNED_IN','SIGNED_OUT'].includes(event);
        if(busy&&!identityChanged)return;
        ++generation;if(identityChanged&&active)showLoading();clearTimeout(timer);
        if(busy){reloadAfterBusy=true;return;}
        timer=setTimeout(()=>{if(active)void load();},0);
      }).data.subscription;
      const user = await client.auth.getUser();
      if (!current()) return;
      if (user.error || !user.data?.user) { container.innerHTML = `<section class="panel"><div class="panel-body account-section"><h1>Your account</h1>${getAccountCallbackNotice()?`<p class="account-notice" role="status">${escapeHtml(getAccountCallbackNotice())}</p>`:''}<p>Sign in from the header to manage your account, saved teams and picks on The Games Decide.</p><a class="button light" href="/support">Get account help</a></div></section>`; return; }
      const secondFactor = await secondFactorRequired(client);
      if (!current()) return;
      if (secondFactor) {
        container.innerHTML = '<section class="panel"><div class="panel-body account-section"><h1>Verify your account</h1><p>Enter your authenticator code to view private account information.</p><button class="button" type="button" data-account-verify>Verify authenticator</button><p role="status" data-session-status></p></div></section>';
        return;
      }
      const [nextContext,nextRequests] = await Promise.all([rpc('account_context'),rpc('my_account_requests')]);
      if (!current()) return;
      context=nextContext; requests=Array.isArray(nextRequests)?nextRequests:[];
      try {
        const [factors,assurance]=await Promise.all([client.auth.mfa.listFactors(),client.auth.mfa.getAuthenticatorAssuranceLevel()]);
        if(factors.error||assurance.error)throw Error('MFA unavailable');
        mfa={factors:factors.data?.totp??[],currentLevel:assurance.data?.currentLevel};
      } catch { mfa={unavailable:true}; }
      if(current())draw();
    } catch { if(current())container.innerHTML='<section class="panel"><div class="panel-body account-section"><h1>Account settings</h1><p role="status">Your account settings could not load. Your saved teams and picks have not been changed.</p><button class="button light" type="button" data-account-retry>Try again</button></div></section>'; }
  }
  const onSubmit=async event=>{
    const form=event.target.closest('form');
    if(!form||!container.contains(form))return;
    event.preventDefault();if(busy||!client)return;
    const operationGeneration=generation,current=()=>active&&generation===operationGeneration;
    busy=true;const button=form.querySelector('[type="submit"]'),status=form.querySelector('[data-form-status]'),values=new FormData(form);button.disabled=true;
    try{
      if(form.matches('[data-account-profile]')){
        const nextContext=await rpc('save_account_profile',{p_nickname:String(values.get('nickname')??'').trim(),p_public:values.get('public')==='on',p_share_picks:values.get('share')==='on'});
        if(!current())return;context=nextContext;
        const sharing=form.querySelector('[name="share"]');sharing.checked=context.sharePicks===true;sharing.disabled=context.publicLeaderboard!==true;
        if(active)status.textContent='Your public profile is saved. Existing picks are unchanged.';
      } else if(form.matches('[data-account-password]')){
        await updateAccountPassword(client,{password:String(values.get('password')??''),confirmation:String(values.get('confirmation')??''),currentPassword:String(values.get('currentPassword')??'')});
        if(!current())return;
        finishPasswordRecovery();form.reset();if(active)status.textContent='Password saved for this same account. Your saved teams and picks are unchanged. Keep Google available until you have tested password sign-in.';
      } else if(form.matches('[data-account-support]')){
        const request=await rpc('submit_support_request',supportSubmission(values));
        if(!request?.id)throw Error('Request not saved');
        if(!current())return;
        if(request.alreadyOpen!==true)await notifySupportIfReady(client,config);
        if(!current())return;
        let nextRequests;
        try{nextRequests=await rpc('my_account_requests');}catch{nextRequests=[request,...requests.filter(row=>row.id!==request.id)];}
        if(current()){requests=nextRequests;draw();const nextForm=container.querySelector('[data-account-support]');if(request.alreadyOpen===true){restoreSupportDraft(nextForm,values);const history=container.querySelector('.support-request-history');if(history)history.open=true;}nextForm.querySelector('[data-form-status]').textContent=supportResultNotice(request);}
      } else if(form.matches('[data-mfa-verify]')){
        const factorId=mfa?.enrollment?.id??mfa?.factors?.find(factor=>factor.status==='verified')?.id;
        if(!factorId)throw Error('Add an authenticator first.');
        const result=await client.auth.mfa.challengeAndVerify({factorId,code:String(values.get('code')??'').trim()});
        if(result.error)throw result.error;
        if(!current())return;
        mfa=null;form.reset();await load();
      }
    }catch(error){if(current()&&status.isConnected)status.textContent=form.matches('[data-account-password]')?(error instanceof PasswordValidationError?error.message:authMessage(error,'password')):error.message==='Confirm the deletion-request acknowledgment before submitting.'?error.message:'This change could not be completed. Check your details and try again.';}
    finally{busy=false;if(active&&button.isConnected)button.disabled=false;if(active&&reloadAfterBusy){reloadAfterBusy=false;void load();}}
  };
  const onChange=event=>{
    if(event.target.matches('[data-account-support] [name="category"]')){updateSupportCategory(event.target.form);return;}
    if(!event.target.matches('[data-account-profile] [name="public"]'))return;
    const sharing=event.target.form?.querySelector('[name="share"]');
    if(sharing){sharing.disabled=!event.target.checked;if(!event.target.checked)sharing.checked=false;}
  };
  const onClick=async event=>{
    if(event.target.closest('[data-account-retry]'))return void load();
    if(event.target.closest('[data-account-verify]')) {
      try { const factor=await secondFactorRequired(client);if(factor&&active)openAccountDialog({client,config,mode:'mfa',mfaFactorId:factor,onSignedIn:()=>void load()});else await load(); }
      catch { const status=container.querySelector('[data-session-status]');if(status)status.textContent='Authenticator verification could not start. Sign in again.'; }
      return;
    }
    const enroll=event.target.closest('[data-mfa-enroll]'),remove=event.target.closest('[data-mfa-remove]'),signout=event.target.closest('[data-account-signout-all]');
    if(!(enroll||remove||signout)||busy||!client)return;
    const operationGeneration=generation,current=()=>active&&generation===operationGeneration;
    busy=true;const button=enroll||remove||signout;button.disabled=true;
    const status=container.querySelector(signout?'[data-session-status]':'[data-mfa-status]');
    try{
      if(enroll){const result=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'The Games Decide '+new Date().toISOString().slice(0,19)});if(result.error)throw result.error;if(!current())return;mfa={...mfa,enrollment:result.data};draw();}
      if(remove){const result=await client.auth.mfa.unenroll({factorId:remove.dataset.mfaRemove});if(result.error)throw result.error;mfa=null;container.innerHTML='<p role="status">Refreshing account security…</p>';const refreshed=await client.auth.refreshSession();if(refreshed.error)throw refreshed.error;await load();}
      if(signout){const result=await client.auth.signOut({scope:'global'});if(result.error)throw result.error;await load();}
    }catch{if(active&&status?.isConnected)status.textContent=signout?'Could not sign out all devices. Try again.':'This authenticator change could not be completed. Verify your existing authenticator or sign in again.';}
    finally{busy=false;if(active&&button.isConnected)button.disabled=false;if(active&&reloadAfterBusy){reloadAfterBusy=false;void load();}}
  };
  container.addEventListener('submit',onSubmit);container.addEventListener('click',onClick);container.addEventListener('change',onChange);void load();
  return()=>{active=false;++generation;clearTimeout(timer);subscription?.unsubscribe();container.removeEventListener('submit',onSubmit);container.removeEventListener('click',onClick);container.removeEventListener('change',onChange);mfa=null;};
}
