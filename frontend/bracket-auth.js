import { cleanAccountCallbackUrl } from './account-auth.js';

const libraryUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
const libraryIntegrity = 'sha384-uteMfOloLDGt042uDz+xHGF3ym63/WQ6rFq7murQRG8Ih7QrXGEGNtWd8688sb4O';
let clientRequest;
let configRequest;
let recoverySession = false;
let callbackNotice = '';
const observedClients = new WeakSet();
export const ACCOUNT_ROUTE_EVENT = 'fbs-account-route';
export const hasPasswordRecoverySession = () => recoverySession;
export const finishPasswordRecovery = () => { recoverySession = false; };
export const getAccountCallbackNotice = () => callbackNotice;

const credentialFragment = hash => /(?:^#|[&#])(?:access_token|refresh_token|token_hash|error)=/.test(hash);

export function accountCallbackMode(value) {
  const url=new URL(value), explicit=url.searchParams.get('account');
  if(['recovery','verification','signin'].includes(explicit))return explicit;
  if(url.searchParams.has('error')||url.searchParams.has('error_code'))return 'signin';
  if(!credentialFragment(url.hash))return null;
  const type=new URLSearchParams(url.hash.slice(1)).get('type');
  return type==='recovery'?'recovery':'signin';
}

export function accountCallbackErrorNotice(error) {
  if(!error)return '';
  if(error.code==='bad_code_verifier'||error.name==='AuthPKCECodeVerifierMissingError')return 'This link could not be matched to this browser. Open the latest link in the browser where you requested it, or request a fresh link here.';
  if(['otp_expired','flow_state_expired'].includes(error.code))return 'This email link has expired or is no longer available. Request a fresh link and open it in the same browser where you requested it.';
  if(error.code==='flow_state_not_found')return 'This sign-in link is no longer available. Request a fresh link and use it once in the browser where you started.';
  return 'This account link could not be checked. Reload, or request a fresh link in the browser where you started. Support is available if the problem continues.';
}

function callbackErrorFromUrl(value) {
  const url=new URL(value),fragment=new URLSearchParams(url.hash.slice(1));
  if(!url.searchParams.has('error')&&!url.searchParams.has('error_code')&&!fragment.has('error')&&!fragment.has('error_code'))return null;
  return {code:url.searchParams.get('error_code')??fragment.get('error_code')??'callback_error'};
}

export function safeAccountReturnHash(value) {
  if(typeof value!=='string'||!value.startsWith('#')||value.length>1000)return '#home';
  return credentialFragment(value)?'#account':value;
}

// Restore ordinary OAuth navigation, but never let an old destination override
// a new email callback. Leave token fragments untouched until managed Auth has
// consumed them; the app can render Account independently of the raw fragment.
export function initialAccountReturnUrl(value,remembered) {
  const url=new URL(value),mode=accountCallbackMode(value);
  const markers=['cfp','weekly','myteam'];
  if(mode){if(!credentialFragment(url.hash))url.hash='account';}
  else if((remembered&&url.searchParams.has('code'))||markers.some(key=>url.searchParams.get(key)==='1')){
    url.hash=url.searchParams.get('weekly')==='1'?'beat-the-model':url.searchParams.get('cfp')==='1'?'bracket':remembered?safeAccountReturnHash(remembered):'home';
  }else return url.href;
  for(const key of markers)url.searchParams.delete(key);
  return url.href;
}

function finishAccountCallbackRouting(mode) {
  const url=new URL(cleanAccountCallbackUrl(location.href));
  if(mode)url.hash='account';
  history.replaceState(history.state,'',url);
  // replaceState never fires hashchange. Notify the router even when the hash
  // was already Account, so a verified recovery session gets its password form.
  window.dispatchEvent(new Event(ACCOUNT_ROUTE_EVENT));
}

function observeAccountCallbacks(client) {
  if(observedClients.has(client))return;
  observedClients.add(client);
  client.auth.onAuthStateChange(event=>{
    if(event==='PASSWORD_RECOVERY'){callbackNotice='';recoverySession=true;finishAccountCallbackRouting('recovery');}
    if(event==='SIGNED_IN')callbackNotice='';
    if(event==='SIGNED_OUT')recoverySession=false;
  });
}

export function loadAccountConfig() {
  configRequest ??= fetch('/bracket-config.json', { cache: 'no-cache' }).then(async response => {
    if (!response.ok) throw Error('Sign-in configuration unavailable');
    const config = await response.json();
    if (!config?.url || !config.publishableKey || config.enabled === false) throw Error('Sign-in configuration unavailable');
    return config;
  }).catch(error => { configRequest = undefined; throw error; });
  return configRequest;
}

export async function googleSignInEnabled({ url, publishableKey }) {
  try {
    const response = await fetch(new URL('/auth/v1/settings', url), {
      headers: { apikey: publishableKey }, signal: AbortSignal.timeout(8_000)
    });
    return response.ok && (await response.json()).external?.google === true;
  } catch {
    return false;
  }
}

export function loadBracketClient({ url, publishableKey }) {
  clientRequest ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = libraryUrl;
    script.integrity = libraryIntegrity;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      try {
        const client = window.supabase.createClient(url, publishableKey, {
          auth: { flowType: 'pkce', detectSessionInUrl: true }
        });
        observeAccountCallbacks(client);
        resolve(client);
      } catch (error) { reject(error); }
    };
    script.onerror = () => reject(new Error('The bracket sign-in library did not load'));
    document.head.append(script);
  }).catch(error => {
    clientRequest = undefined;
    throw error;
  });
  return clientRequest;
}

export function mountHeaderAccount(root, { previewClient, rememberPage, icon = '' } = {}) {
  let client, session, config = {}, providerEnabled = false, ready = false, checking = true, busy = false, message = '';

  function draw(focus = false) {
    const action = !ready && !checking ? 'retry' : session ? 'signout' : 'signin';
    const label = action === 'retry' ? 'Retry sign-in' : session ? 'Sign out' : 'Sign in';
    const unavailable = action === 'signin' && !checking && !providerEnabled && config.emailAuthEnabled !== true;
    root.innerHTML = `${session ? '<a class="header-account-button header-account-settings" href="#account" aria-label="Your account at The Games Decide">Account</a>' : ''}<button class="header-account-button" type="button" data-account-action="${action}"${checking || busy || unavailable ? ' disabled' : ''}>
      ${icon}<span>${unavailable ? 'Sign-in unavailable' : label}</span></button><span class="header-account-message" role="status">${message}</span>`;
    if (focus) root.querySelector('[data-account-action]')?.focus();
  }

  async function connect() {
    const initialUrl=location.href,callbackMode=accountCallbackMode(initialUrl);
    const callbackPending=Boolean(callbackMode||new URL(initialUrl).searchParams.has('code'));
    const callbackError=callbackErrorFromUrl(initialUrl);
    if(callbackError){recoverySession=false;callbackNotice=accountCallbackErrorNotice(callbackError);}
    checking = true;
    message = '';
    draw();
    try {
      config = previewClient ? {} : await loadAccountConfig();
      client = previewClient ?? await loadBracketClient(config);
      observeAccountCallbacks(client);
      const { data, error } = await client.auth.getSession();
      if (error) {if(callbackPending){recoverySession=false;callbackNotice=accountCallbackErrorNotice(error);}throw error;}
      session = data.session;
      // Register once the client is ready. The listener never calls an auth method.
      client.auth.onAuthStateChange((event, nextSession) => {
        if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'MFA_CHALLENGE_VERIFIED', 'PASSWORD_RECOVERY'].includes(event)) return;
        session = nextSession;
        draw();
      });
      providerEnabled = previewClient ? true : await googleSignInEnabled(config);
      ready = true;
      if (session && client.auth.mfa) {
        const { secondFactorRequired, openAccountDialog } = await import('./account-auth.js');
        const factor = await secondFactorRequired(client);
        if (factor) openAccountDialog({ client, config, mode:'mfa', mfaFactorId:factor });
      }
    } catch(error) {
      if(callbackPending&&!callbackNotice){recoverySession=false;callbackNotice=accountCallbackErrorNotice(error);}
      message = callbackNotice || 'Account controls could not load.';
    }
    if(callbackPending)finishAccountCallbackRouting(callbackMode);
    checking = false;
    draw();
  }

  root.onclick = async event => {
    const action = event.target.closest('[data-account-action]')?.dataset.accountAction;
    if (!action || checking || busy) return;
    if (action === 'retry') return connect();
    if (!ready || (action === 'signin' && !providerEnabled && config.emailAuthEnabled !== true)) return;
    if (action === 'signin') {
      const { openAccountDialog } = await import('./account-auth.js');
      openAccountDialog({ client, config, googleEnabled: providerEnabled, rememberPage });
      return;
    }
    busy = true;
    message = '';
    draw();
    try {
      if (action === 'signout') {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
        session = null;
      }
    } catch {
      message = action === 'signout' ? 'Could not sign out. Try again.' : 'Could not start Google sign-in. Try again.';
    }
    busy = false;
    draw(true);
  };
  void connect();
}
