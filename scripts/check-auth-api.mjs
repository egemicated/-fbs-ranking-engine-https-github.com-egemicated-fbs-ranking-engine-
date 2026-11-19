import assert from 'node:assert/strict';
import { createServer as createSmtp } from 'node:net';
import { createServer as createHttp } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve, join } from 'node:path';

// Only task-local processes and a random disposable loopback database are permitted.
const appRoot = resolve(import.meta.dirname, '..');
const root = resolve(process.env.AUTH_TEST_RUNTIME ?? 'tmp/isolated-auth-v2.198.0');
const authBinary = resolve(process.env.AUTH_TEST_BINARY ?? join(root, process.platform === 'win32' ? 'auth.exe' : 'auth'));
const workdir = resolve(process.env.AUTH_TEST_WORKDIR ?? root);
const reportPath = process.env.AUTH_TEST_REPORT ? resolve(process.env.AUTH_TEST_REPORT) : join(root, 'result.json');
const failurePath = join(root, 'failure.json');
const host = process.env.PGHOST ?? '127.0.0.1';
if (!['127.0.0.1','localhost','::1'].includes(host)) throw Error('Auth tests require loopback PostgreSQL');
const port = process.env.PGPORT ?? (process.platform === 'win32' ? '55482' : '5432');
assert.match(port, /^\d+$/); assert.ok(Number(port) > 0 && Number(port) <= 65535);
const pguser = process.env.PGUSER ?? 'postgres'; assert.match(pguser, /^[A-Za-z_][A-Za-z0-9_]*$/);
const database = 'forge_auth_test_' + randomBytes(6).toString('hex');
const binarySha256 = createHash('sha256').update(await readFile(authBinary)).digest('hex');
const approvedBinaries = new Map([
  ['77d5009ee8501fb380fe4ad0c42cfdeb3da8ac0e5660e59bf8d736ccb457a6c6', 'official-linux-release'],
  ['be711e33bca0d9802d8f8c46a2c34454330bbc562156c37e8965c33236dd6341', 'local-windows-listener-adaptation'],
]);
assert.ok(approvedBinaries.has(binarySha256), 'Auth executable checksum must match a reviewed pinned runtime');
await mkdir(root,{recursive:true});
assert.match(database, /^forge_auth_test_[a-f0-9]{12}$/);
const jwtSecret = randomBytes(48).toString('hex'), mailbox = [];
const psql = process.env.PSQL_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin/psql.exe' : 'psql');
const pgEnv = {...process.env,PGCONNECT_TIMEOUT:'10',PGAPPNAME:'forge-isolated-auth-tests'};
function sql(query, db = database) {
  const result = spawnSync(psql, ['-X', '-q', '-w', '-h', host, '-p', port, '-U', pguser, '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], {
    env:pgEnv, input: query, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Isolated SQL operation failed: ' + result.stderr.slice(0, 800));
  return result.stdout.trim();
}
const smtp = createSmtp(socket => {
  socket.setEncoding('utf8'); socket.write('220 localhost isolated test SMTP\r\n');
  let buffer = '', raw = '', data = false, to = '';
  socket.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const pos = buffer.indexOf('\r\n'); if (pos < 0) return;
      const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 2);
      if (data) {
        if (line === '.') { mailbox.push({ to, raw }); raw = ''; data = false; socket.write('250 2.0.0 captured locally\r\n'); }
        else raw += line.replace(/^\.\./, '.') + '\r\n';
        continue;
      }
      if (/^(EHLO|HELO)/i.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n');
      else if (/^MAIL FROM:/i.test(line)) socket.write('250 2.1.0 OK\r\n');
      else if (/^RCPT TO:/i.test(line)) { to = line.slice(8).trim(); socket.write('250 2.1.5 OK\r\n'); }
      else if (/^DATA$/i.test(line)) { data = true; socket.write('354 end with dot\r\n'); }
      else if (/^QUIT$/i.test(line)) { socket.end('221 bye\r\n'); }
      else if (/^(RSET|NOOP)/i.test(line)) socket.write('250 OK\r\n');
      else socket.write('250 OK\r\n');
    }
  });
});
const site = createHttp((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Isolated Auth test redirect'); });
await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const smtpPort = smtp.address().port, siteUrl = 'http://127.0.0.1:' + site.address().port;
// A released ephemeral port is used only on loopback; collisions fail closed.
const reserve = createHttp(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const authPort = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const base = 'http://127.0.0.1:' + authPort;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GOTRUE|DATABASE_URL|DB_NAMESPACE|API_EXTERNAL_URL|PORT|PG)/i.test(key)));
const connection = new URL('postgres://' + (host === '::1' ? '[::1]' : host) + ':' + port + '/' + database);
connection.username = pguser; if (process.env.PGPASSWORD) connection.password = process.env.PGPASSWORD;
connection.searchParams.set('sslmode','disable'); connection.searchParams.set('options','-csearch_path=auth');
Object.assign(env, {
  DATABASE_URL: connection.href, GOTRUE_DB_DATABASE_URL: connection.href,
  GOTRUE_DB_DRIVER: 'postgres', DB_NAMESPACE: 'auth', GOTRUE_DB_NAMESPACE: 'auth',
  API_EXTERNAL_URL: base, GOTRUE_API_HOST: '127.0.0.1', GOTRUE_API_PORT: String(authPort), PORT: String(authPort),
  GOTRUE_SITE_URL: siteUrl, GOTRUE_URI_ALLOW_LIST: siteUrl + '/**',
  GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated',
  GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
  GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
  GOTRUE_DISABLE_SIGNUP: 'false', GOTRUE_MAILER_AUTOCONFIRM: 'false',
  GOTRUE_SMTP_HOST: '127.0.0.1', GOTRUE_SMTP_PORT: String(smtpPort), GOTRUE_SMTP_ADMIN_EMAIL: 'accounts@fbs.test',
  GOTRUE_SMTP_SENDER_NAME: 'FBS Intelligence isolated test', GOTRUE_SMTP_MAX_FREQUENCY: '1ms',
  GOTRUE_MAILER_URLPATHS_CONFIRMATION: '/verify', GOTRUE_MAILER_URLPATHS_RECOVERY: '/verify',
  GOTRUE_MAILER_URLPATHS_INVITE: '/verify', GOTRUE_MAILER_OTP_EXP: '3600',
  GOTRUE_PASSWORD_MIN_LENGTH: '12', GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000',
  GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD: 'true',
  GOTRUE_RATE_LIMIT_VERIFY: '1000', GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '1000',
  GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
  GOTRUE_LOG_LEVEL: 'warn', GOTRUE_DISABLE_AUDIT_LOG: 'false',
});
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const payload = b64({ role: 'service_role', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 });
const unsigned = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + payload;
const adminJWT = unsigned + '.' + createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');
let auth, created = false, completed = false, logs = '';
const startedAt = new Date().toISOString();
try {
  sql(`do $$ begin
    if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    if exists(select from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls))
      then raise exception 'Client roles must not bypass row security'; end if;
  end $$;`, 'postgres');
  sql(`create database ${database}`, 'postgres'); created = true;
  sql('create schema auth');
  const migrate = spawnSync(authBinary, ['migrate'], { cwd: workdir, env, encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 });
  if (migrate.status !== 0) throw Error('Local Auth migrations failed: ' + (migrate.stderr || migrate.stdout).slice(-2200));
  sql(`create or replace function auth.uid() returns uuid language sql stable set search_path='' as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const migrationFiles = (await readdir(join(appRoot,'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort();
  for (const file of migrationFiles) sql(await readFile(join(appRoot,'supabase/migrations',file),'utf8'));
  auth = spawn(authBinary, ['serve'], { cwd: workdir, env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  auth.stdout.on('data', chunk => { logs += chunk; }); auth.stderr.on('data', chunk => { logs += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (auth.exitCode !== null) throw Error('Local Auth exited before readiness: ' + logs.slice(-1800));
    try { const r = await fetch(base + '/health'); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  if (!ready) throw Error('Local Auth readiness timed out: ' + logs.slice(-1800));
  const health = await (await fetch(base + '/health')).json();
  assert.equal(health.version, 'v2.198.0', 'Exact source release version label');
  const { runAuthFlowTests } = await import('./lib/auth-api-flows.mjs');
  const checks = await runAuthFlowTests({ base, mailbox, adminJWT, sql });
  const result = { startedAt, completedAt: new Date().toISOString(), passed: true, auth: health, checks,
    localMessagesCaptured: mailbox.length, productionRequests: 0, externalEmails: 0,
    isolatedLoopbackOnly: true, platformMigrationsApplied:migrationFiles.length, authDatabase: database, databaseRemoved: false,
    source: { tag: 'v2.198.0', sourceArchiveSha256: '44864b95510681e26406c71b2b464141f5a6e65e4db8061eb93d0b023562ef6d',
      binarySha256, runtime: approvedBinaries.get(binarySha256),
      linuxReleaseArchiveSha256:'4abe9134d7615faa9149cab514acada8e7133cd69d2ccd96fdcef0d795c05171',
      deviation: process.platform === 'win32' ? 'CLI serve listener only: omit Linux SO_REUSEPORT and its unused Unix/syscall imports. Auth API, storage, mailer, validation and migrations remain official release source.' : null },
    limitations: ['Local SMTP capture is not Brevo or real mailbox deliverability.', 'A seeded Google identity is not a genuine Google OAuth handshake.', 'API plus direct authenticated SQL is not a hosted PostgREST end-to-end test.', ...(process.platform === 'win32' ? ['Temporary Windows listener adaptation means this is not the identical hosted binary.', 'Local PostgreSQL18 differs from hosted PostgreSQL17.'] : [])] };
  await mkdir(resolve(reportPath,'..'),{recursive:true});
  await writeFile(reportPath, JSON.stringify(result,null,2)+'\n');
  completed=true;
  console.log(JSON.stringify({ passed:true, health, checks, messages:mailbox.length }));
} catch (error) {
  const message = String(error.message).slice(0,3500);
  const runtimeErrors = logs.split(/\r?\n/).map(line=>{try {const value=JSON.parse(line);return value.level==='error'?String(value.error||value.msg||'').replace(/https?:\/\/\S+/g,'[local URL]').slice(0,1200):null;}catch{return null;}}).filter(Boolean).slice(-5);
  await writeFile(failurePath, JSON.stringify({ startedAt, failedAt:new Date().toISOString(), message, runtimeErrors },null,2));
  console.error(JSON.stringify({message,runtimeErrors})); process.exitCode = 1;
} finally {
  if (auth && auth.exitCode === null) { auth.kill(); await Promise.race([once(auth,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]); }
  await new Promise(resolve => smtp.close(resolve)); await new Promise(resolve => site.close(resolve));
  if (created) sql(`drop database ${database} with (force)`, 'postgres');
  try { if (!completed) throw Error('No successful result'); const result = JSON.parse(await readFile(reportPath)); result.databaseRemoved=true; await writeFile(reportPath,JSON.stringify(result,null,2)+'\n'); } catch {}
  console.log('Stopped task-local Auth/SMTP/redirect listeners and removed disposable database.');
}
