const libraryUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
const libraryIntegrity = 'sha384-uteMfOloLDGt042uDz+xHGF3ym63/WQ6rFq7murQRG8Ih7QrXGEGNtWd8688sb4O';
let clientRequest;
let configRequest;

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
        resolve(window.supabase.createClient(url, publishableKey, {
          auth: { flowType: 'pkce', detectSessionInUrl: true }
        }));
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
  let client, session, providerEnabled = false, ready = false, checking = true, busy = false, message = '';

  function draw(focus = false) {
    const action = !ready && !checking ? 'retry' : session ? 'signout' : 'signin';
    const label = action === 'retry' ? 'Retry sign-in' : session ? 'Sign out' : 'Sign in';
    const unavailable = action === 'signin' && !checking && !providerEnabled;
    root.innerHTML = `<button class="header-account-button" type="button" data-account-action="${action}"${
      action === 'signin' && !unavailable ? ' aria-label="Sign in with Google"' : ''}${checking || busy || unavailable ? ' disabled' : ''}>
      ${icon}<span>${unavailable ? 'Sign-in unavailable' : label}</span></button><span class="header-account-message" role="status">${message}</span>`;
    if (focus) root.querySelector('[data-account-action]')?.focus();
  }

  async function connect() {
    checking = true;
    message = '';
    draw();
    try {
      const config = previewClient ? null : await loadAccountConfig();
      client = previewClient ?? await loadBracketClient(config);
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      session = data.session;
      // Register once the client is ready. The listener never calls an auth method.
      client.auth.onAuthStateChange((event, nextSession) => {
        if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) return;
        session = nextSession;
        draw();
      });
      providerEnabled = previewClient ? true : await googleSignInEnabled(config);
      ready = true;
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
    if (!ready || (action === 'signin' && !providerEnabled)) return;
    busy = true;
    message = '';
    draw();
    try {
      if (action === 'signout') {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
        session = null;
      } else {
        rememberPage?.();
        const { error } = await client.auth.signInWithOAuth({ provider: 'google',
          options: { redirectTo: new URL('/?myteam=1', location.origin).href } });
        if (error) throw error;
      }
    } catch {
      message = action === 'signout' ? 'Could not sign out. Try again.' : 'Could not start Google sign-in. Try again.';
    }
    busy = false;
    draw(true);
  };
  void connect();
}
