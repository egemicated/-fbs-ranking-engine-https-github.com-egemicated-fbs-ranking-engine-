const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const MIN_PASSWORD_LENGTH = 12;
export class PasswordValidationError extends Error {}

export function accountCapabilities(config = {}) {
  return {
    emailLogin: config.emailAuthEnabled === true,
    registration: config.emailAuthEnabled === true && config.emailRegistrationEnabled === true,
    recovery: config.emailAuthEnabled === true && config.passwordRecoveryEnabled === true,
    google: config.googleEnabled !== false,
  };
}

export function validateNewPassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > 64 || new TextEncoder().encode(password).length > 72) {
    throw new PasswordValidationError('Use a password with 12–64 characters. A longer passphrase works well; keep it within 72 bytes.');
  }
  if (password !== confirmation) throw new PasswordValidationError('The passwords do not match.');
  return password;
}

export function accountCallbackUrl(origin, mode = 'signin') {
  const url = new URL('/', origin);
  if (!['signin', 'recovery', 'verification'].includes(mode)) throw Error('Invalid account callback');
  url.searchParams.set('account', mode);
  url.hash = 'account';
  return url.href;
}

export function cleanAccountCallbackUrl(value) {
  const url = new URL(value);
  for (const key of ['code', 'access_token', 'refresh_token', 'token_hash', 'error', 'error_code', 'error_description', 'account']) url.searchParams.delete(key);
  // Implicit credentials should never be retained in navigation/history, even
  // if a legacy link reaches this PKCE client. Managed Auth processes them first.
  if (/(?:^#|[&#])(?:access_token|refresh_token|token_hash|error)=/.test(url.hash)) url.hash = 'account';
  return url.href;
}

export async function updateAccountPassword(client, { password, confirmation, currentPassword } = {}) {
  validateNewPassword(password, confirmation);
  const before = await client.auth.getUser();
  if (before.error || !before.data?.user?.id) throw Error('Sign in again before changing your password.');
  const user = before.data.user;
  // This updates the authenticated identity. It never calls signUp, creates an
  // application account, or replaces the user ID that owns saved contest data.
  // Supabase validates current_password without creating a new aal1 session.
  // Re-signing in here would silently downgrade an already verified MFA session.
  const updated = await client.auth.updateUser({ password, ...(currentPassword ? { current_password:currentPassword } : {}) });
  if (updated.error) throw updated.error;
  if (updated.data?.user?.id !== user.id) throw Error('The account identity could not be verified. Sign in again.');
  return updated.data.user;
}

export function authMessage(error, action = 'signin') {
  if (error?.code === 'client_email_cooldown') return 'Wait one minute before requesting another verification email.';
  if (error?.code === 'over_request_rate_limit' || error?.status === 429) return 'Too many attempts. Wait a little and try again.';
  if (error?.code === 'email_not_confirmed') return 'Verify your email before signing in. Check the message sent when you registered.';
  if (error?.code === 'reauthentication_needed' || error?.code === 'reauthentication_not_valid') return 'Please sign in again before changing your password.';
  if (action === 'signin') return 'That sign-in could not be completed. Check your details or use your existing Google sign-in.';
  if (action === 'password') return 'The password could not be changed. Sign in again and try once more.';
  return 'The request could not be completed. Please try again later.';
}

export async function secondFactorRequired(client) {
  if (!client.auth.mfa) return null;
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw assurance.error;
  if (assurance.data?.currentLevel === 'aal2' || assurance.data?.nextLevel !== 'aal2') return null;
  const factors = await client.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  const factor = factors.data?.totp?.find(item => item.status === 'verified');
  if (!factor?.id) throw Error('A supported authenticator is required to finish sign-in.');
  return factor.id;
}

export function authFormMarkup(mode, { config = {}, googleEnabled = false, notice = '' } = {}) {
  const enabled = accountCapabilities(config);
  if (mode === 'mfa') return `<div class="account-auth-brand"><img src="/assets/the-games-decide-icon.png" alt=""><span>The Games Decide</span></div><h2 id="fbs-auth-title">Verify your authenticator</h2><p class="compact-note">Enter the current six-digit code from your authenticator app to finish signing in.</p><form data-auth-form="mfa" class="account-form"><label for="fbs-auth-mfa">Authenticator code</label><input id="fbs-auth-mfa" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="button" type="submit">Verify and continue</button><p role="status" data-auth-status></p></form><p class="compact-note"><a href="#support" data-auth-close>Need account help?</a></p>`;
  const titles = { signin:'Welcome back', register:'Create your account', recovery:'Reset your password', verification:'Verify your email' };
  const current = ['register','verification'].includes(mode) && !enabled.registration || mode === 'recovery' && !enabled.recovery ? 'signin' : mode;
  const email = `<label for="fbs-auth-email">Email</label><input id="fbs-auth-email" name="email" type="email" autocomplete="email" maxlength="254" required>`;
  const password = `<label for="fbs-auth-password">Password</label><input id="fbs-auth-password" name="password" type="password" autocomplete="${current === 'register' ? 'new-password' : 'current-password'}"${current === 'register' ? ' minlength="12" maxlength="64"' : ''} required>`;
  const confirmation = `<label for="fbs-auth-confirm">Confirm password</label><input id="fbs-auth-confirm" name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="64" required>`;
  return `<div class="account-auth-brand"><img src="/assets/the-games-decide-icon.png" alt=""><span>The Games Decide</span></div><h2 id="fbs-auth-title">${titles[current] ?? titles.signin}</h2><p class="compact-note">Your teams. Your picks. One account.</p>
    ${notice ? `<p class="account-notice" role="status">${escapeHtml(notice)}</p>` : ''}
    ${enabled.emailLogin ? `<form data-auth-form="${current}" class="account-form">${email}${['recovery','verification'].includes(current) ? '' : password}${current === 'register' ? confirmation + '<p class="compact-note">Use at least 12 characters. Your email must be verified before you sign in.</p>' : ''}<button class="button" type="submit">${current === 'register' ? 'Create account' : current === 'recovery' ? 'Send recovery email' : current === 'verification' ? 'Resend verification' : 'Sign in'}</button><p role="status" data-auth-status></p></form>` : '<p class="compact-note">Email sign-in is being prepared. Continue with your existing Google account.</p>'}
    ${current === 'signin' && googleEnabled ? `<button class="button light account-google" type="button" data-auth-google>Continue with Google</button><p class="compact-note">Already use Google here? Continue with that same account to keep your saved teams and picks.</p>` : ''}
    <div class="account-auth-links">${current !== 'signin' ? '<button type="button" class="text-button" data-auth-mode="signin">Back to sign in</button>' : `${enabled.registration ? '<button type="button" class="text-button" data-auth-mode="register">Create account</button><button type="button" class="text-button" data-auth-mode="verification">Resend verification</button>' : ''}${enabled.recovery ? '<button type="button" class="text-button" data-auth-mode="recovery">Forgot password?</button>' : ''}`}</div>
    <p class="compact-note account-auth-policy"><a href="#privacy" data-auth-close>Privacy and accounts</a> · <a href="#support" data-auth-close>Need help?</a></p>`;
}

export function openAccountDialog({ client, config = {}, googleEnabled = false, rememberPage, onSignedIn, mode = 'signin', notice = '', mfaFactorId }) {
  const existing = document.querySelector('[data-account-dialog]');
  existing?.close(); existing?.remove();
  const returnFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'account-dialog'; dialog.dataset.accountDialog = '';
  dialog.setAttribute('aria-labelledby', 'fbs-auth-title');
  let busy = false, active = true, lastVerificationResend = 0;
  const draw = () => {
    dialog.innerHTML = `<button class="account-dialog-close" type="button" aria-label="Close account sign-in" data-auth-close>×</button><div data-auth-content>${authFormMarkup(mode, { config, googleEnabled, notice })}</div>`;
  };
  const close = () => { if (!active) return; active = false; dialog.close(); dialog.remove(); returnFocus?.isConnected && returnFocus.focus(); };
  dialog.addEventListener('close', close);
  dialog.addEventListener('cancel', close);
  dialog.addEventListener('click', async event => {
    if (event.target.closest('[data-auth-close]')) return close();
    const next = event.target.closest('[data-auth-mode]')?.dataset.authMode;
    if (next && !busy) { mode = next; notice = ''; draw(); dialog.querySelector('input')?.focus(); return; }
    if (!event.target.closest('[data-auth-google]') || busy || !googleEnabled) return;
    busy = true;
    try {
      rememberPage?.();
      // Keep the already configured production Google callback during the
      // transition; new email callback URLs remain gated until delivery testing.
      const result = await client.auth.signInWithOAuth({ provider:'google', options:{ redirectTo:new URL('/?myteam=1',location.origin).href } });
      if (result.error) throw result.error;
    } catch { notice = 'Google sign-in could not start. Please try again.'; draw(); }
    finally { busy = false; }
  });
  dialog.addEventListener('submit', async event => {
    const form = event.target.closest('[data-auth-form]');
    if (!form) return;
    event.preventDefault();
    if (busy) return;
    const action = form.dataset.authForm, values = new FormData(form), caps = accountCapabilities(config);
    if (action !== 'mfa' && (!caps.emailLogin || ['register','verification'].includes(action) && !caps.registration || action === 'recovery' && !caps.recovery)) return;
    busy = true;
    const button = form.querySelector('[type="submit"]'), status = form.querySelector('[data-auth-status]');
    button.disabled = true;
    try {
      const email = String(values.get('email') ?? '').trim(), password = String(values.get('password') ?? '');
      let result;
      if (action === 'mfa') {
        if (!mfaFactorId) throw Error('Sign in again to verify your authenticator.');
        result = await client.auth.mfa.challengeAndVerify({ factorId:mfaFactorId, code:String(values.get('code') ?? '').trim() });
      } else if (action === 'verification') {
        if (Date.now() - lastVerificationResend < 60_000) {const error=Error('Verification email cooldown');error.code='client_email_cooldown';throw error;}
        result = await client.auth.resend({type:'signup',email,options:{emailRedirectTo:accountCallbackUrl(location.origin,'verification')}});
        if (!result.error) lastVerificationResend=Date.now();
      } else if (action === 'register') {
        validateNewPassword(password, String(values.get('confirmation') ?? ''));
        result = await client.auth.signUp({ email, password, options:{ emailRedirectTo:accountCallbackUrl(location.origin,'verification') } });
      } else if (action === 'recovery') result = await client.auth.resetPasswordForEmail(email, { redirectTo:accountCallbackUrl(location.origin,'recovery') });
      else result = await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      form.reset();
      if (action === 'signin') {
        mfaFactorId = await secondFactorRequired(client);
        if (mfaFactorId) { mode='mfa';draw();dialog.querySelector('input')?.focus(); }
        else { close(); onSignedIn?.(result.data?.user); }
      } else if(action==='mfa') {close();onSignedIn?.(result.data?.user);}
      else {
        notice = action === 'register' ? 'If this address is eligible, a verification email is on its way. Already use Google? Sign in with Google and add a password in Account settings.' : action === 'verification' ? 'If this address needs verification, another email is on its way. Check your inbox and spam folder.' : 'If this address has an account, a recovery email is on its way. Check your inbox and spam folder.';
        mode = 'signin'; draw();
      }
    } catch (error) {
      if (active) status.textContent = error instanceof PasswordValidationError ? error.message : authMessage(error, action);
    } finally { busy = false; if (active && button.isConnected) button.disabled = false; }
  });
  draw(); document.body.append(dialog); dialog.showModal();
  return close;
}
