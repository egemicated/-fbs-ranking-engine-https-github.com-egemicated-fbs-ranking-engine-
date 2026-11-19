import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHmac, createHash } from 'node:crypto';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const password = () => `FbsLocal-${randomBytes(18).toString('base64url')}`;
const email = () => `fbs-${randomUUID()}@example.invalid`;
const uid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

function mailLink(raw, type) {
  let decoded = String(raw).replace(/=\r?\n/g, '').replace(/=([a-fA-F0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const urls = decoded.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  return urls.map(text => { try { return new URL(text.replaceAll('&amp;', '&')); } catch { return null; } })
    .find(url => url?.pathname.endsWith('/verify') && url.searchParams.get('type') === type && url.searchParams.get('token'));
}

function totp(secret, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const n = alphabet.indexOf(char); assert.ok(n >= 0, 'TOTP secret uses base32'); bits += n.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(), offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

export async function runAuthFlowTests({ base, mailbox, adminJWT, sql }) {
  const origin = new URL(base);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Auth tests require a loopback server');
  const results = [];
  const api = async (path, data, token, method = 'POST') => {
    const response = await fetch(new URL(path, base), { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), redirect: 'manual', signal: AbortSignal.timeout(12000) });
    const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = null; }
    return { ok: response.ok, status: response.status, body, headers: response.headers };
  };
  const step = async (name, action) => { await action(); results.push({ name, passed: true }); };
  const success = (result, name) => assert.ok(result.ok, `${name}: HTTP ${result.status}, code ${result.body?.error_code ?? result.body?.code ?? 'unavailable'}`);
  const user = body => body?.user ?? body;
  const login = (address, pass) => api('/token?grant_type=password', { email: address, password: pass });
  const jwt = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  const waitMail = async (address, type, since = 0) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const row of mailbox.slice(since)) if (String(row.raw).includes(address)) {
        const link = mailLink(row.raw, type); if (link) return link;
      }
      await pause(50);
    }
    throw Error(`No local ${type} message captured`);
  };
  const verify = link => {
    assert.equal(link.origin, origin.origin, 'Captured action link must point to local Auth');
    return api('/verify', { type: link.searchParams.get('type'), token_hash: link.searchParams.get('token') });
  };

  const accountEmail = email(), initialPassword = password(), nextPassword = password();
  let accountId, token, refresh, originalSignupLink, preMfaClaims;
  const authenticatedSql = async (claims, query) => sql(`begin; set local role authenticated;
    set local request.jwt.claims='${JSON.stringify(claims).replaceAll("'", "''")}'; ${query}; rollback;`);
  await step('real server health and email-confirmation policy', async () => {
    const health = await api('/health', undefined, undefined, 'GET'); success(health, 'Health');
    const settings = await api('/settings', undefined, undefined, 'GET'); success(settings, 'Settings');
    assert.equal(settings.body.external.email, true); assert.equal(settings.body.mailer_autoconfirm, false);
  });
  await step('server rejects a password shorter than the configured minimum', async () => {
    const weak = await api('/signup', { email: email(), password: 'short' }); assert.ok(!weak.ok, 'Weak signup must fail');
  });
  await step('signup generates actual local confirmation mail and cannot sign in unverified', async () => {
    const signed = await api('/signup', { email: accountEmail, password: initialPassword }); success(signed, 'Signup');
    accountId = user(signed.body).id; assert.ok(uid(accountId)); assert.ok(!signed.body.access_token);
    const blocked = await login(accountEmail, initialPassword); assert.ok(!blocked.ok, 'Unconfirmed password sign-in must fail');
    originalSignupLink = await waitMail(accountEmail, 'signup');
    await assert.rejects(async () => sql(`select account_private.provision_administrator('${accountEmail}','Isolated unconfirmed account test');`),
      /confirmed account/);
  });
  await step('actual confirmation token verifies once and preserves the signup identity', async () => {
    const verified = await verify(originalSignupLink); success(verified, 'Confirmation');
    assert.equal(user(verified.body).id, accountId);
    const signed = await login(accountEmail, initialPassword); success(signed, 'Confirmed sign-in');
    assert.equal(user(signed.body).id, accountId); token = signed.body.access_token; refresh = signed.body.refresh_token;
    assert.ok(token && refresh);
    assert.ok(!(await verify(originalSignupLink)).ok, 'Consumed confirmation token must fail');
  });
  await step('duplicate signup cannot create another identity', async () => {
    await api('/signup', { email: accountEmail, password: password() });
    const count = await sql(`select count(*) from auth.users where email='${accountEmail}';`);
    assert.equal(String(count).trim(), '1');
  });
  await step('password recovery consumes real generated mail and changes the same account', async () => {
    const since = mailbox.length;
    success(await api('/recover', { email: accountEmail }), 'Recover');
    const recoveryLink = await waitMail(accountEmail, 'recovery', since), recovered = await verify(recoveryLink);
    success(recovered, 'Recovery verification'); assert.equal(user(recovered.body).id, accountId);
    const changed = await api('/user', { password: nextPassword }, recovered.body.access_token, 'PUT'); success(changed, 'Recovery password update');
    assert.equal(user(changed.body).id, accountId);
    assert.ok(!(await verify(recoveryLink)).ok, 'Consumed recovery token must fail');
    assert.ok(!(await login(accountEmail, initialPassword)).ok, 'Old password must fail');
    const signed = await login(accountEmail, nextPassword); success(signed, 'Recovered password sign-in');
    assert.equal(user(signed.body).id, accountId); token = signed.body.access_token; refresh = signed.body.refresh_token;
  });
  await step('TOTP rejects wrong code then creates an actual AAL2 session', async () => {
    preMfaClaims = jwt(token);
    assert.equal(preMfaClaims.aal, 'aal1');
    await assert.rejects(async () => sql(`select account_private.provision_administrator('${accountEmail}','Isolated missing MFA provisioning test');`),
      /TOTP authenticator/);
    const enrolled = await api('/factors', { factor_type: 'totp', friendly_name: `FBS local ${randomUUID()}`, issuer: 'FBS Intelligence' }, token);
    success(enrolled, 'TOTP enrollment'); const factorId = enrolled.body.id, secret = enrolled.body.totp.secret;
    assert.ok(uid(factorId) && secret);
    const challenge = await api(`/factors/${factorId}/challenge`, {}, token); success(challenge, 'TOTP challenge');
    const correct = totp(secret), wrong = ((Number(correct) + 1) % 1000000).toString().padStart(6, '0');
    assert.ok(!(await api(`/factors/${factorId}/verify`, { challenge_id: challenge.body.id, code: wrong }, token)).ok, 'Wrong TOTP must fail');
    const fresh = await api(`/factors/${factorId}/challenge`, {}, token); success(fresh, 'Fresh TOTP challenge');
    const verified = await api(`/factors/${factorId}/verify`, { challenge_id: fresh.body.id, code: totp(secret) }, token); success(verified, 'TOTP verify');
    assert.equal(jwt(verified.body.access_token).aal, 'aal2'); assert.equal(user(verified.body).id, accountId);
    token = verified.body.access_token; refresh = verified.body.refresh_token;
    const sessionId = jwt(token).session_id;
    assert.equal(String(await sql(`select aal::text from auth.sessions where id='${sessionId}';`)).trim(), 'aal2');
  });
  await step('editable metadata cannot grant administration; protected provisioning requires verified MFA', async () => {
    const forgedMetadata = { ...jwt(token), user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } };
    await assert.rejects(async () => authenticatedSql(forgedMetadata, "select public.admin_users('',50,0)"),
      /Administrator access required/);
    const provisioned = await sql(`select account_private.provision_administrator('${accountEmail}','Isolated test operator provisioning')->>'role';`);
    assert.equal(String(provisioned).trim(), 'admin');
    await assert.rejects(async () => authenticatedSql(jwt(token),
      `select account_private.provision_administrator('${accountEmail}','Attempted browser self-provisioning')`), /permission denied/);
  });
  await step('real AAL2 session authorizes minimal admin directory; its prior AAL1 token remains denied', async () => {
    assert.equal(preMfaClaims.session_id, jwt(token).session_id);
    await assert.rejects(async () => authenticatedSql(preMfaClaims, "select public.admin_users('',50,0)"),
      /authenticator|verification/i);
    const visible = await authenticatedSql(jwt(token), `with directory as (select public.admin_users('',50,0) value)
      select jsonb_typeof(value)='object' and jsonb_typeof(value->'users')='array'
        and exists(select from jsonb_array_elements(value->'users') u where u->>'userId'='${accountId}')
        and not exists(select from jsonb_array_elements(value->'users') u, lateral jsonb_object_keys(u) k
          where lower(k) in ('password','encrypted_password','picks','savedpicks','lockedpicks','futurepicks','access_token','refresh_token'))
      from directory`);
    assert.equal(String(visible).trim(), 't');
  });
  await step('current-password validation does not downgrade verified MFA or change UID', async () => {
    const priorSessionId = jwt(token).session_id;
    assert.ok(uid(priorSessionId));
    const wrong = await api('/user', { password: password(), current_password: 'wrong-current-passphrase' }, token, 'PUT');
    assert.ok(!wrong.ok, 'Wrong current password must fail under the configured policy');
    const finalPassword = password();
    const changed = await api('/user', { password: finalPassword, current_password: nextPassword }, token, 'PUT'); success(changed, 'Current-password update');
    assert.equal(user(changed.body).id, accountId);
    const liveSession = JSON.parse(await sql(`select json_build_object('id',id,'userId',user_id,'aal',aal::text)
      from auth.sessions where id='${priorSessionId}';`));
    assert.deepEqual(liveSession, { id: priorSessionId, userId: accountId, aal: 'aal2' },
      'Password update must preserve the actual current AAL2 session');
    const current = await api('/user', undefined, token, 'GET'); success(current, 'Current session after password update');
    assert.equal(user(current.body).id, accountId);
    const refreshed = await api('/token?grant_type=refresh_token', { refresh_token: refresh });
    success(refreshed, 'Refresh current session after password update');
    const refreshedClaims = jwt(refreshed.body.access_token);
    assert.equal(refreshedClaims.aal, 'aal2', 'A newly issued token must retain verified MFA');
    assert.equal(refreshedClaims.session_id, priorSessionId, 'Refresh must retain the actual current session');
    assert.equal(refreshedClaims.sub, accountId); assert.equal(user(refreshed.body).id, accountId);
    token = refreshed.body.access_token; refresh = refreshed.body.refresh_token;
    const stillAuthorized = await authenticatedSql(refreshedClaims,
      `select exists(select from jsonb_array_elements(public.admin_users('',50,0)->'users') u
        where u->>'userId'='${accountId}')`);
    assert.equal(String(stillAuthorized).trim(), 't',
      'Protected administration must remain authorized after the password update and refresh');
  });

  await step('seeded Google-only fixture can add a password with unchanged UID and saved rows', async () => {
    const address = email(), beforePassword = password(), addedPassword = password();
    const created = await api('/admin/users', { email: address, password: beforePassword, email_confirm: true }, adminJWT); success(created, 'Fixture user create');
    const fixtureId = user(created.body).id; assert.ok(uid(fixtureId));
    const signed = await login(address, beforePassword); success(signed, 'Fixture session');
    const identity = randomUUID();
    await sql(`begin; set local request.jwt.claims='${JSON.stringify(jwt(signed.body.access_token)).replaceAll("'", "''")}';
      create table if not exists public.fbs_local_identity_evidence(user_id uuid primary key references auth.users(id), saved_team text, saved_pick text);
      insert into public.fbs_local_identity_evidence values('${fixtureId}','test-team','test-locked-pick');
      insert into public.my_team_preferences(user_id,team_id) values('${fixtureId}','252');
      insert into weekly_private.players(user_id,nickname,public_leaderboard) values('${fixtureId}','Local Google fixture',true);
      update auth.users set encrypted_password='',raw_app_meta_data='{"provider":"google","providers":["google"]}'::jsonb where id='${fixtureId}';
      delete from auth.identities where user_id='${fixtureId}';
      insert into auth.identities(id,provider_id,user_id,identity_data,provider,created_at,updated_at) values('${identity}','fixture-google-${fixtureId}','${fixtureId}',jsonb_build_object('sub','fixture-google-${fixtureId}','email','${address}','email_verified',true),'google',now(),now()); commit;`);
    const before = String(await sql(`select md5(row_to_json(t)::text) from public.fbs_local_identity_evidence t where user_id='${fixtureId}';`)).trim();
    const platformDigest = async () => String(await sql(`select md5(jsonb_build_object(
      'teams',(select to_jsonb(t) from public.my_team_preferences t where user_id='${fixtureId}'),
      'player',(select to_jsonb(p) from weekly_private.players p where user_id='${fixtureId}'))::text);`)).trim();
    const beforePlatform = await platformDigest();
    const state = await api('/user', undefined, signed.body.access_token, 'GET'); success(state, 'Google-only fixture state');
    assert.ok(user(state.body).identities.some(item => item.provider === 'google'));
    assert.ok(!user(state.body).identities.some(item => item.provider === 'email'));
    const changed = await api('/user', { password: addedPassword }, signed.body.access_token, 'PUT'); success(changed, 'Add password to fixture');
    assert.equal(user(changed.body).id, fixtureId);
    const newLogin = await login(address, addedPassword); success(newLogin, 'External fixture password sign-in');
    assert.equal(user(newLogin.body).id, fixtureId);
    assert.ok(user(newLogin.body).identities.some(item => item.provider === 'google'));
    assert.equal(String(await sql(`select md5(row_to_json(t)::text) from public.fbs_local_identity_evidence t where user_id='${fixtureId}';`)).trim(), before);
    assert.equal(await platformDigest(), beforePlatform, 'Existing saved teams and contest profile must remain unchanged');
    assert.equal(String(await sql(`select count(*) from auth.users where email='${address}';`)).trim(), '1');
  });
  await step('real email PKCE confirmation exchanges once with the original verifier and same identity', async () => {
    const address = email(), codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const since = mailbox.length;
    const signed = await api('/signup', { email: address, password: password(), code_challenge: codeChallenge, code_challenge_method: 's256' });
    success(signed, 'PKCE signup'); const expectedId = user(signed.body).id; assert.ok(uid(expectedId));
    const confirmation = await waitMail(address, 'signup', since);
    const redirected = await api(confirmation.pathname + confirmation.search, undefined, undefined, 'GET');
    assert.ok(redirected.status >= 300 && redirected.status < 400, 'PKCE email confirmation must redirect');
    const location = redirected.headers.get('location'); assert.ok(location, 'PKCE confirmation has a redirect destination');
    const authCode = new URL(location).searchParams.get('code'); assert.ok(authCode, 'PKCE confirmation issues an authorization code');
    const exchanged = await api('/token?grant_type=pkce', { auth_code: authCode, code_verifier: codeVerifier });
    success(exchanged, 'PKCE exchange'); assert.equal(user(exchanged.body).id, expectedId); assert.ok(exchanged.body.access_token);
    assert.ok(!(await api('/token?grant_type=pkce', { auth_code: authCode, code_verifier: codeVerifier })).ok, 'Consumed PKCE authorization code must fail');
  });
  await step('global sign-out revokes the real refresh session', async () => {
    const out = await api('/logout?scope=global', {}, token); success(out, 'Global logout');
    assert.ok(!(await api('/token?grant_type=refresh_token', { refresh_token: refresh })).ok, 'Refresh after global logout must fail');
    await assert.rejects(async () => authenticatedSql(jwt(token), 'select public.account_context()'), /authenticator|verification|sign in/i);
    await assert.rejects(async () => authenticatedSql(jwt(token), "select public.admin_users('',50,0)"), /authenticator|verification|sign in|no longer valid/i);
  });
  return results;
}
