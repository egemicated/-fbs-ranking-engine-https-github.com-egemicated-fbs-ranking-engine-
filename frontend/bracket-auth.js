import { ACCOUNT_CALLBACK_MODES, accountCallbackFragment, hasAccountCallbackParameters, cleanAccountCallbackUrl } from './account-auth.js';
import { legacyRouteFromHash, routeFromUrl, routeHref } from './clean-routes.js';

const libraryUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
const libraryIntegrity = 'sha384-uteMfOloLDGt042uDz+xHGF3ym63/WQ6rFq7murQRG8Ih7QrXGEGNtWd8688sb4O';
let clientRequest;
let configRequest;
let recoverySession = false;
let callbackNotice = '';
const observedClients = new WeakSet();
export const ACCOUNT_ROUTE_EVENT = 'fbs-account-route';
const accountReturnKey = 'fbs-account-return';
const legacyContestReturns = [['weekly', 'beat-the-model'], ['cfp', 'bracket']];
const legacyReturnMarkers = [...legacyContestReturns.map(([marker]) => marker), 'myteam'];
export const hasPasswordRecoverySession = () => recoverySession;
export const finishPasswordRecovery = () => { recoverySession = false; };
export const getAccountCallbackNotice = () => callbackNotice;

const credentialFragment = hash => hasAccountCallbackParameters(accountCallbackFragment(hash));

export function accountCallbackMode(value) {
  const url = new URL(value);
  const explicit = url.searchParams.get('account');
  if (ACCOUNT_CALLBACK_MODES.includes(explicit)) return explicit;
  if (url.searchParams.has('error') || url.searchParams.has('error_code')) return 'signin';
  if (!credentialFragment(url.hash)) return null;
  return accountCallbackFragment(url.hash).get('type') === 'recovery' ? 'recovery' : 'signin';
}

export function isAccountCallbackUrl(value) {
  const url = new URL(value);
  return Boolean(accountCallbackMode(url)) || hasAccountCallbackParameters(url.searchParams) ||
    legacyReturnMarkers.some(marker => url.pathname === '/' && url.searchParams.get(marker) === '1');
}

export function accountCallbackErrorNotice(error) {
  if(!error)return '';
  if(error.code==='bad_code_verifier'||error.name==='AuthPKCECodeVerifierMissingError')return 'This link could not be matched to this browser. Open the latest link in the browser where you requested it, or request a fresh link here.';
  if(['otp_expired','flow_state_expired'].includes(error.code))return 'This email link has expired or is no longer available. Request a fresh link and open it in the same browser where you requested it.';
  if(error.code==='flow_state_not_found')return 'This sign-in link is no longer available. Request a fresh link and use it once in the browser where you started.';
  return 'This account link could not be checked. Reload, or request a fresh link in the browser where you started. Support is available if the problem continues.';
}

function callbackErrorFromUrl(value) {
  const url=new URL(value),fragment=accountCallbackFragment(url.hash);
  if(!url.searchParams.has('error')&&!url.searchParams.has('error_code')&&!fragment.has('error')&&!fragment.has('error_code'))return null;
  return {code:url.searchParams.get('error_code')??fragment.get('error_code')??'callback_error'};
}

export function safeAccountReturnPath(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  if (value.startsWith('#')) {
    if (credentialFragment(value)) return '/account';
    return routeHref(legacyRouteFromHash(value)) ?? '/';
  }
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  const url = new URL(value, 'https://return.example');
  if (url.origin !== 'https://return.example') return '/';
  if (hasAccountCallbackParameters(url.searchParams) || credentialFragment(url.hash)) return '/account';
  return routeHref(routeFromUrl(url)) ?? '/';
}

// Select the visible page while managed Auth processes the original callback.
// This reads the URL without moving, cleaning or copying its credentials.
export function pendingAccountRoute(value, remembered) {
  if (!isAccountCallbackUrl(value)) return null;
  if (accountCallbackMode(value)) return 'account';
  const url = new URL(value);
  if (routeFromUrl(url) === 'account') return 'account';
  for (const [marker, route] of legacyContestReturns) {
    if (url.pathname === '/' && url.searchParams.get(marker) === '1') return route;
  }
  return routeFromUrl(new URL(safeAccountReturnPath(remembered), url.origin)) ?? 'home';
}

function finishAccountCallbackRouting(route, initialUrl = location.href) {
  const current = new URL(location.href);
  const initial = new URL(initialUrl);
  const destination = new URL(routeHref(route) ?? '/account', current.origin);
  // If the visitor left the callback page while Auth was initializing, don't
  // send them back. The SDK may already have removed the code or fragment.
  if (current.pathname === initial.pathname && current.href !== destination.href) {
    const cleaned = new URL(cleanAccountCallbackUrl(current));
    cleaned.pathname = destination.pathname;
    cleaned.search = destination.search;
    cleaned.hash = '';
    history.replaceState(history.state, '', cleaned);
  }
  try { window.sessionStorage.removeItem(accountReturnKey); } catch {}
  // replaceState does not emit an event. A completed recovery also needs to
  // notify the account view if its path was already /account.
  window.dispatchEvent(new Event(ACCOUNT_ROUTE_EVENT));
}

function observeAccountCallbacks(client) {
  if(observedClients.has(client))return;
  observedClients.add(client);
  const initialUrl = location.href;
  client.auth.onAuthStateChange(event=>{
    if(event==='PASSWORD_RECOVERY'){callbackNotice='';recoverySession=true;finishAccountCallbackRouting('account', initialUrl);}
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
    root.innerHTML = `${session ? '<a class="header-account-button header-account-settings" href="/account" aria-label="Your account at The Games Decide">Account</a>' : ''}<button class="header-account-button" type="button" data-account-action="${action}"${checking || busy || unavailable ? ' disabled' : ''}>
      ${icon}<span>${unavailable ? 'Sign-in unavailable' : label}</span></button><span class="header-account-message" role="status">${message}</span>`;
    if (focus) root.querySelector('[data-account-action]')?.focus();
  }

  async function connect() {
    const initialUrl = location.href;
    let remembered;
    try { remembered = window.sessionStorage.getItem(accountReturnKey); } catch {}
    const callbackRoute = pendingAccountRoute(initialUrl, remembered);
    const callbackPending = callbackRoute !== null;
    let callbackProcessed = false;
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
      callbackProcessed = true;
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
    if (callbackPending && callbackProcessed) finishAccountCallbackRouting(callbackRoute, initialUrl);
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
