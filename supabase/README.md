# Database verification

Run the complete migration and SQL regression suite against a disposable local
PostgreSQL database:

```powershell
$env:PGHOST='127.0.0.1'
$env:PGPORT='55482' # Port of your local test server; default is 5432.
$env:PGUSER='postgres'
node scripts/check-database.mjs
```

PostgreSQL's `psql` must be on PATH (or set `PSQL_BIN` to its executable).
Set `PGPASSWORD` privately if the local server requires a password. The runner
rejects non-loopback hosts, ignores connection URLs and inherited PostgreSQL
service settings, creates a random database, applies every migration in filename
order, runs every `supabase/tests/*.sql` file with `ON_ERROR_STOP`, verifies that
fixtures rolled back, and drops that database even when a suite fails. Failures
produce a nonzero exit code. Existing databases are never reset or populated.

The local test cluster needs nonprivileged `anon` and `authenticated` roles and
a `service_role` with `BYPASSRLS`; the runner creates missing roles and rejects
client roles that bypass RLS. Use a disposable development cluster. CI creates a
fresh PostgreSQL 17 service for each Engine checks job. It requires no Supabase
credentials, hosted branch, sports-data API calls, or paid service.

The harness creates a minimal `auth.users(id)` table and an `auth.uid()` JWT
subject adapter. This verifies database ownership, permissions and RPC behavior
with independent account IDs. It does not run GoTrue, Google OAuth, token expiry,
browser session storage, refresh-token rotation or provider redirects. Verify
those separately with safe disposable accounts before calling them tested.

Every test fixture is synthetic and enclosed in a transaction that rolls back.
Never run these files against production, even when a test claims to roll back.
The security suites test direct SQL privileges as well as public RPC behavior.
`security-boundaries.sql` intentionally fails when new views or application
functions introduce an unreviewed privilege boundary.

The Engine checks workflow explicitly runs the full Node suite, isolated SQL
suite, static publication checks and browser/responsive tests. A successful
static build alone does not certify database security.

Production migration history has some older timestamp differences from local
files. Reconstructing a fresh test database is supported; blindly pushing all
local migration files to the existing hosted database is not a release step.
Review and apply only the new migration, and reconcile history deliberately.
