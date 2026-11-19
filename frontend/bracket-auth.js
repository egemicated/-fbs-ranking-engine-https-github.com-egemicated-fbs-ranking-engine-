const libraryUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
const libraryIntegrity = 'sha384-uteMfOloLDGt042uDz+xHGF3ym63/WQ6rFq7murQRG8Ih7QrXGEGNtWd8688sb4O';
let clientRequest;
let configRequest;
let recoverySession = false;
export const hasPasswordRecoverySession = () => recoverySession;
export const finishPasswordRecovery = () => { recoverySession = false; };

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
        client.auth.onAuthStateChange(event => {
          if (event === 'PASSWORD_RECOVERY') { recoverySession = true; location.hash = 'account'; }
          if (event === 'SIGNED_OUT') recoverySession = false;
        });
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
    root.innerHTML = `${session ? '<a class="header-account-button header-account-settings" href="#account" aria-label="Your FBS Intelligence account">Account</a>' : ''}<button class="header-account-button" type="button" data-account-action="${action}"${checking || busy || unavailable ? ' disabled' : ''}>
      ${icon}<span>${unavailable ? 'Sign-in unavailable' : label}</span></button><span class="header-account-message" role="status">${message}</span>`;
    if (focus) root.querySelector('[data-account-action]')?.focus();
  }

  async function connect() {
    checking = true;
    message = '';
    draw();
    try {
      config = previewClient ? {} : await loadAccountConfig();
      client = previewClient ?? await loadBracketClient(config);
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      session = data.session;
      // Register once the client is ready. The listener never calls an auth method.
      client.auth.onAuthStateChange((event, nextSession) => {
        if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'MFA_CHALLENGE_VERIFIED', 'PASSWORD_RECOVERY'].includes(event)) return;
        session = nextSession;
        draw();
      });
      providerEnabled = previewClient ? true : await googleSignInEnabled(config);
      if (new URL(location.href).searchParams.has('account')) {
        const { cleanAccountCallbackUrl } = await import('./account-auth.js');
        history.replaceState(history.state, '', cleanAccountCallbackUrl(location.href));
      }
      ready = true;
      if (session && client.auth.mfa) {
        const { secondFactorRequired, openAccountDialog } = await import('./account-auth.js');
        const factor = await secondFactorRequired(client);
        if (factor) openAccountDialog({ client, config, mode:'mfa', mfaFactorId:factor });
      }
    } catch {
      message = 'Account controls could not load.';
    }
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
