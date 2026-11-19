// Optional local storage probe. No network, production URL or hosted credentials.
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const host = process.env.PGHOST ?? '127.0.0.1';
if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw Error('Storage probe only accepts a loopback database host');
const port = process.env.PGPORT ?? '55482', user = process.env.PGUSER ?? 'postgres';
if (!/^\d+$/.test(port) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(user)) throw Error('Invalid local connection');
const database = `forge_capacity_${randomBytes(8).toString('hex')}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^PG/i.test(name)));
env.PGCONNECT_TIMEOUT = '10';
env.PGAPPNAME = 'forge-local-storage-probe';
if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD;
const args = ['-X', '-q', '-w', '-h', host, '-p', port, '-U', user, '-v', 'ON_ERROR_STOP=1'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baselineCutoff = '20261118192613_platform_preferences_and_pick_privacy.sql';
function psql(db, extra = [], input) {
  const run = spawnSync(process.env.PSQL_BIN ?? 'psql', [...args, '-d', db, ...extra], {
    cwd: root, env, input, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw Error(run.stderr.trim() || `Local psql failed: ${run.status}`);
  return run.stdout.trim();
}
let created = false;
try {
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
  const migrations = readdirSync(resolve(root, 'supabase/migrations')).filter(file => file.endsWith('.sql') && file <= baselineCutoff).sort();
  if (migrations.at(-1) !== baselineCutoff) throw Error('Expected retained baseline migration is unavailable');
  const migrationHashes = {};
  for (const file of migrations) {
    const path = resolve(root, 'supabase/migrations', file);
    migrationHashes[file] = sha(readFileSync(path));
    psql(database, ['-f', path]);
  }
  psql(database, [], `
    insert into auth.users(id) select md5('forge-capacity-'||n)::uuid from generate_series(1,1000) n;
    insert into weekly_private.players(user_id,nickname,public_leaderboard)
      select id,'Synthetic participant '||row_number() over (),false from auth.users;
    insert into weekly_private.publications(season,observed_at) values(2095,'2095-11-01T00:00:00Z');
    insert into weekly_private.games(season,id,week,season_type,home_id,away_id,home_name,away_name,
      neutral,kickoff,status,home_points,away_points,winner_id,model_team_id,model_captured_at,home_probability)
      select 2095,'900000'||n,11,'regular','101','102','Synthetic Home','Synthetic Away',false,
        '2095-11-20T18:00:00Z'::timestamptz,'scheduled',null,null,null,'101','2095-11-01T00:00:00Z',.7
      from generate_series(1,64) n;
    insert into weekly_private.picks(season,game_id,user_id,team_id,captured_at,updated_at)
      select 2095,g.id,u.id,'101','2095-11-01T00:00:00Z','2095-11-01T00:00:00Z'
      from weekly_private.games g cross join auth.users u;
    analyze weekly_private.picks;
    analyze weekly_private.players;
  `);
  const result = JSON.parse(psql(database, ['-At', '-c', `select jsonb_build_object(
    'users',(select count(*) from auth.users),'picks',(select count(*) from weekly_private.picks),
    'picksHeapBytes',pg_relation_size('weekly_private.picks'),
    'picksIndexBytes',pg_indexes_size('weekly_private.picks'),
    'picksTotalBytes',pg_total_relation_size('weekly_private.picks'),
    'playersTotalBytes',pg_total_relation_size('weekly_private.players'),
    'gamesTotalBytes',pg_total_relation_size('weekly_private.games'),
    'rawPickRowMeanBytes',(select avg(pg_column_size(p)) from weekly_private.picks p),
    'postgresVersion',version())`]));
  const bytesPerPick = result.picksTotalBytes / result.picks;
  const scenarios = [100, 1000, 10000].map(users => ({ users,
    assumptions: { picksPerUserPerWeek: 64, activeWeeks: 15, activeParticipationFraction: 1 },
    weeklyPicks: users * 64, seasonPicks: users * 64 * 15,
    seasonPickBytesAtMeasuredDensity: Math.ceil(users * 64 * 15 * bytesPerPick),
    seasonPickBytesWith50PercentGrowthAllowance: Math.ceil(users * 64 * 15 * bytesPerPick * 1.5),
  }));
  const report = { id: 'local-contest-storage-probe-v1', capturedAt: new Date().toISOString(),
    source: 'Synthetic rows in a newly created loopback-only disposable database; retained production-schema baseline',
    migrationCutoff: baselineCutoff, migrationHashes, measured: { ...result, bytesPerPick }, scenarios,
    limits: ['This is a local row-storage measurement, not a hosted throughput or concurrency benchmark.',
      'It excludes managed Auth internals, new account/admin tables, WAL, backups, temporary work space, future schema changes and bloat beyond the allowance.',
      'Every user picking every game is an explicit upper participation assumption, not predicted adoption.',
      'No production database, existing local database, user account, game or saved pick was altered.'],
    productionWrites: 0, providerCalls: 0 };
  const path = resolve(root, 'reports/account-capacity-storage-evidence-2026-11-18.json');
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ path, measured: report.measured, scenarios }, null, 2));
} finally {
  if (created) {
    if (!/^forge_capacity_[a-f0-9]{16}$/.test(database)) throw Error('Unsafe temporary database cleanup target');
    psql('postgres', ['-c', `drop database ${database} with (force)`]);
  }
}
