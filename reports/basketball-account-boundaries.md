# Basketball account and contest boundaries

## Hosted posture reviewed November 20, 2026

The live Supabase project reported active and healthy on PostgreSQL 17. Its migration history contained **15 migrations** with the same names as the repository baseline at **120bb7651f4583a4ccffb73aff33e409acda009a**. Eleven earlier migrations have different timestamps. The three newest account and support migrations have matching names and timestamps. Name parity does not establish byte-for-byte SQL parity. Validate the catalog and reconcile migration history before planning a release. [Database verification runbook](../supabase/README.md)

Hosted catalog queries examined only table and RPC metadata. No account, pick, credential, or other application rows were read.

| Boundary | Observed hosted configuration |
| --- | --- |
| Private account, football bracket, support, and weekly contest tables | All 12 use row-level security. The anonymous and authenticated client roles have no direct SELECT, INSERT, UPDATE, or DELETE grants on these tables. |
| Existing team favorites | The public preferences table uses row-level security. Its policy checks both the authenticated owner and the authorized session on reads and writes. Anonymous SELECT is denied at the grant layer. |
| Administrative calls | Eight public admin-prefixed functions were present. None grants anonymous EXECUTE. Authenticated admin decisions remain subject to the server-side membership and MFA checks exercised by the database tests. |
| Basketball storage | No hosted table or view with basketball in its name or schema was present. The preview did not create any hosted objects. |

The hosted Security Advisor reported 12 informational notices for private tables with RLS enabled and no row policy, consistent with their lack of direct client grants. It also warned that compromised-password protection is disabled. That warning remains open for the owner to evaluate separately. The audit did not exercise production user sign-in, Google redirects, email delivery, session renewal, or hosted administrator access. [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Password protection guide](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## Local preview

- Local test profiles are separate from football and Supabase. Passphrases are salted and hashed. Opaque session cookies are HTTP-only and SameSite Strict, and the preview verifies the local origin on writes. Sessions expire after 12 hours or a server restart. Use a disposable passphrase.
- Basketball test picks are stored in the private preview directory, scoped to a preview profile and a basketball season. The server validates both entrants and a confirmed tipoff, rejects guest, cross-origin, invalid, and late submissions, and derives grades from trusted final scores. Unconfirmed start times remain locked.
- Practice brackets are browser drafts keyed to the active preview profile and bracket edition. They can be reopened on the same browser, with no official submission or contest standings. The official entry validator checks a full bracket against the verified field, reachable winners, edition, and server-time deadline. It is kept out of the public site.
- Football account, recovery, Google sign-in, administration, preferences, contests, and saved records keep their existing configuration. No application schema or CI security configuration changed in this branch. The preview avoids production authentication and credentials.

## Verification

The exact football baseline passed the hosted release's isolated migration, account, managed Auth, and browser regressions. A fresh loopback PostgreSQL 18 cluster on this machine independently applied all 15 migrations, ran the legacy identity and locked-picks preservation fixture, and passed all 14 SQL suites. The test database, server, and temporary cluster were removed. The private basketball account and bracket checks passed 10 of 10 tests. The historical bracket also passed independent browser checks at 390, 768, and 1440 pixels. [Baseline release checks](https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/actions/runs/44752052908)

## Future migration and rollout

1. Prepare an additive migration locally, with a fresh database and disposable users. Retain the existing Supabase Auth user UUID as the common account identity. Use sport-qualified team IDs and separate basketball preferences, matchups, bracket editions, drafts, submitted entries, game picks, and contest results. Keep football tables, saved forecasts, and contest policies outside the migration.
2. Keep basketball submission tables outside exposed schemas where practical. Establish explicit owner and active-session policies, revoke default direct access, and use a narrow validated server-side write path. The server must derive the owner from the verified session and the contest deadline from a trusted schedule or official bracket. Submission and scoring must reject pregame prediction leakage and stale bracket editions. Apply the existing administrator authorization boundary, including MFA.
3. Exercise browser sign-up, email verification and recovery, Google callback/PKCE, session expiry, multi-user pick isolation, private draft access, tipoff and tournament locks, administrative MFA, and mocked result corrections in an isolated environment. Before approval, reconcile hosted migration timestamps and verify current provider settings, grants, advisors, and the approved production identity-preservation checklist.
4. If Bryan approves public rollout, apply only the reviewed additive migration through the existing protected release process with basketball writes initially disabled. Verify that current football sign-in, favorites, standings, and contest scoring still work. Open basketball entry points only after the per-sport controls and hosted verification pass. Do not import preview users or drafts into production.

[Supabase environment guidance](https://supabase.com/docs/guides/deployment/managing-environments) · [Supabase MFA guide](https://supabase.com/docs/guides/auth/auth-mfa)

## Rollback

Disable basketball write entry points and pause basketball publication or scoring first. Redeploy the prior protected site revision if needed. Leave the basketball storage in place for a controlled recovery of any submitted entries. Review a corrective migration after a read-only dependency and ownership check. Avoid running older football migrations against the hosted project to undo a basketball release.
