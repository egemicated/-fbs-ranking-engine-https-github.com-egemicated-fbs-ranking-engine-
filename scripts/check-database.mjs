import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// This harness deliberately cannot accept a hosted database URL. It creates and
// drops only its own random database on an explicitly loopback Postgres server.
const host = process.env.PGHOST ?? '127.0.0.1';
if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
  throw new Error('Database integration tests require PGHOST to be loopback');
}
const port = process.env.PGPORT ?? '5432';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid PGPORT');
const user = process.env.PGUSER ?? 'postgres';
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(user)) throw new Error('Invalid PGUSER');
const root = resolve(import.meta.dirname, '..');
const database = `forge_sql_test_${randomBytes(8).toString('hex')}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD;
env.PGCONNECT_TIMEOUT = '10';
env.PGAPPNAME = 'forge-isolated-sql-tests';
const args = ['-X', '-q', '-w', '-h', host, '-p', port, '-U', user, '-v', 'ON_ERROR_STOP=1'];
function psql(db, extra, input) {
  const result = spawnSync(process.env.PSQL_BIN ?? 'psql', [...args, '-d', db, ...extra], {
    cwd: root, env, input, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `psql exited ${result.status}`);
  return result.stdout.trim();
}
let created = false;
try {
  // Cluster roles are created only if absent. Existing roles must have the same
  // security boundary as hosted client roles; never weaken an existing role.
  psql('postgres', ['-c', `do $$ begin
    if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    if exists(select from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls))
      then raise exception 'Client roles must not bypass row security'; end if;
  end $$;`]);
  psql('postgres', ['-c', `create database ${database}`]);
  created = true;
  psql(database, [], `
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable set search_path='' as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
  `);
  const migrations = readdirSync(resolve(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations) psql(database, ['-f', resolve(root, 'supabase/migrations', name)]);
  console.log(`Applied ${migrations.length} migrations to a fresh disposable database`);
  const tests = readdirSync(resolve(root, 'supabase/tests')).filter(name => name.endsWith('.sql')).sort();
  if (!tests.length) throw new Error('No SQL tests found');
  let failed = 0;
  for (const name of tests) {
    try {
      psql(database, ['-f', resolve(root, 'supabase/tests', name)]);
      const count = psql(database, ['-At', '-c', `select
        (select count(*) from auth.users)+(select count(*) from cfp_private.contests)+
        (select count(*) from cfp_private.entries)+(select count(*) from weekly_private.publications)+
        (select count(*) from weekly_private.games)+(select count(*) from weekly_private.players)+
        (select count(*) from weekly_private.picks)+(select count(*) from public.my_team_preferences)+
        (select count(*) from support_private.account_requests)`]);
      if (count !== '0') throw new Error('SQL fixture did not roll back');
      console.log(`PASS ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
  console.log(`SQL suites: ${tests.length - failed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
} finally {
  if (created) {
    psql('postgres', ['-c', `drop database ${database} with (force)`]);
    console.log('Removed disposable integration database');
  }
}
