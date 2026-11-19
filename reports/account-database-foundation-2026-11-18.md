# Account administration database foundation

This additive implementation was first tested in disposable PostgreSQL databases. Root subsequently applied the tested migration to production after the approved encrypted backup and restore verification. Administrator provisioning and production account deletion remain unperformed.

## Existing data and architecture

The existing managed Supabase Auth identity remains the account key. Passwords, password hashes, OAuth credentials and recovery tokens never enter application tables or administrator responses. The existing `weekly_private.players` profile remains the canonical public nickname and contest-sharing preference. Existing My Teams preferences and all saved contest selections retain their tables, keys and timestamps.

The migration was generated with the existing Supabase CLI 3.0.0 using `migration new account_administration_foundation`, originally at timestamp `20261119011207`. The hosted migration tool subsequently recorded the applied version as `20261119014527`. The local file was renamed to `20261119014527_account_administration_foundation.sql` to match that actual hosted history; its SQL body stayed byte-identical. The preceding twelve migration mappings were left unchanged. Current Auth MFA/session and API-grant documentation and the changelog were reviewed before implementation. No dependency upgrade was required.

## Account and administrator permissions

`account_private.memberships` stores the live application role and account status. Existing and future users default to ordinary active users. Registration metadata cannot assign a role. Browser roles have no direct privileges on membership, entitlement, audit, request, notification or contest tables in private schemas.

Administrator RPCs require all of the following on every call:

- A real existing Auth user and active private administrator membership.
- A signed JWT's top-level `aal2` claim.
- The JWT's live `auth.sessions` record, matching the user and `aal2`, with an unexpired `not_after` where present.
- At least one currently verified TOTP factor. Removing a factor or ending a session invalidates administrator access even if an earlier access token remains unexpired.

An operator can provision a designated administrator only through `account_private.provision_administrator(email, reason)`, executable by the protected service role or database owner. It requires an existing confirmed email and verified TOTP factor. There is no public wrapper and no browser API for assigning administrator roles. No email address or initial password is hardcoded.

Optional regular-user TOTP also has backend enforcement. Once a verified factor exists, private account/profile operations, public owner-entry RPCs, preference RLS and contest writes require a live AAL2 session. Existing users without factors keep the simple existing sign-in behavior. Public game information and consented post-kickoff selections remain public regardless of login.

Suspension blocks new profile/preference/contest writes immediately through private database state and triggers covering existing contest paths. It preserves existing selections. Suspended users can still inspect their own saved data and request support after satisfying any enrolled MFA requirement.

Administrator functions provide paginated user metadata, support review, status management, nickname moderation and action history. They expose no password data or another participant's protected selections. They cannot edit contest picks, game results, model parameters or rankings. Self-suspension and modifying administrator status through the browser API are rejected; administrator changes use the protected operator process.

## Profiles, support and notifications

Account settings can update the existing nickname, public leaderboard preference and post-kickoff sharing consent. The canonical nickname and visibility also apply to CFP standings without changing locked bracket selections. Moderation changes the profile and blocks restoration of the moderated old nickname; it does not rewrite saved choices or forecast timestamps.

The existing private account-request table now supports access, teams, contest, profile, data, deletion and general categories, with pending, in-review, resolved and closed states. Existing identifiers and original fields remain intact. Users receive only their own status metadata; private messages and internal review notes are available only to MFA-authorized administrators.

Every new request queues one durable private notification. Service-only RPCs claim notification batches with `SKIP LOCKED`, ten-minute leases and unpredictable lease tokens, and mark delivery outcomes. Payloads contain identifiers, category and creation time, without request text or email addresses. Failures back off and stop after five attempts. A worker crash on its fifth attempt becomes an explicit `failed` state after lease expiry instead of remaining stuck in processing.

The optional service-only guest-support RPC validates bounded email/message/category inputs and a hashed client identifier, limits submission frequency and cannot request account deletion. It must be called through the protected, abuse-controlled support Edge Function. Anonymous clients cannot invoke it directly. Email delivery configuration and actual notification testing remain separate release requirements owned by the main implementation.

A subsequent small follow-up, originally generated at timestamp `20261119022347` and aligned without SQL-body changes to the actual hosted filename `20261119022909_support_notification_requeue.sql`, adds `admin_requeue_support_notification(request_id, reason)`. It uses the same live administrator/MFA/session authorization and locks the notification row. Only an explicitly failed notification without an accepted provider receipt, a sent timestamp or a live lease can be requeued. Pending, processing and sent rows are rejected, as are repeated clicks after a successful requeue. Resetting the attempt budget requires a bounded reason and appends the actor, target, request and prior-attempt/error metadata to the audit log. No picks or request messages are included. An external provider might have accepted an email during an ambiguous worker failure without its receipt reaching the database; deliberate retry therefore still needs the interface's duplicate-delivery warning and provider idempotency handling rather than an exactly-once guarantee.

Important administrative writes append an audit record with actor, target, action, timestamp and bounded reason/status metadata. Request messages and passwords are not copied into audit entries. Audit records cannot be updated or deleted through application privileges, and an append-only trigger rejects direct mutations as an additional safeguard.

## Deletion and future subscriptions

Account deletion is currently a request-and-review workflow. Changing a deletion request's status cannot silently delete an Auth identity or falsely mark removal complete: the ordinary administrator status RPC rejects resolving deletion requests. Actual removal remains disabled until a tested retention/anonymization policy and protected execution process are approved.

**Existing Auth deletion cascades still remove the user's preferences, contest profile, picks, CFP entries and requests.** This behavior was demonstrated only with disposable local data. No production user was deleted and no historical retention policy is implied. A future deletion implementation must explicitly address that cascade and revoke sessions before removal. Deleting this application identity would not delete the person's Google account.

The private, unseeded entitlement table supports feature-specific activation, expiration and revocation. The backend entitlement check is scoped to the current active, properly authenticated user. No premium entitlement, billing provider, webhook, price or payment is activated. There is no frontend-only paid authorization mechanism.

## Verification actually performed

The existing loopback-only SQL harness now includes a pre-migration fixture and a post-migration equality check. Nine original table representations were compared: the Auth identity and all eight application tables. It verified original nicknames, sharing flags, favorites, records, locked selections and pregame timestamps remained exactly unchanged; only explicitly added support columns and one queued notification per original request were new. Preexisting deletion requests retain `category=deletion`. The legacy `submit_account_request('deletion', ...)` API used by the older frontend also routes to that protected category, deduplicates with the new support API, and cannot be falsely resolved by the ordinary admin status action. Read-only inspection confirmed the same forwarding function and a null category default on the hosted database; no follow-up DDL was required for this concern.

All **13 migrations** applied to a fresh disposable PostgreSQL 18 database. All **12 SQL suites passed**, including the original eleven contest, privacy and preference suites. The new suite covers ordinary/guest/administrator privileges, metadata escalation, private-table denial, AAL1, missing and expired sessions, removed factors, optional-user MFA, suspension and reactivation, nickname moderation, request isolation/statuses, false deletion completion, notification leases/retries, guest restrictions, dormant entitlements and append-only action history. Every suite rolls back, all account/request/contest/session/factor tables are checked empty, and the random test database is removed.

The following were not performed here: real Auth email registration, OAuth identity linking, actual MFA enrollment through GoTrue, production SMTP delivery, hosted schema application, administrator provisioning, production deletion or live-browser verification. Those require the separate managed Auth, UI and rollout checks. The local Auth/session/factor tables are explicit test doubles and do not claim to emulate the whole GoTrue service.

The notification-requeue follow-up was then verified with all **14 local migrations** and **13 SQL suites passing**, including guest/service/ordinary-user/AAL1/missing-session denial, pending/processing/sent/receipt/live-lease rejection, explicit failed-row recovery, audit contents and the next worker's first fresh claim. The already applied foundation SQL was not edited for this follow-up; production application remains root's separate rollout step.

After root applied both account migrations, a read-only aggregate production check confirmed 134 picks, 888 games, the one existing contest profile and saved favorite selection remained preserved. The full preference-row digest differed from the pre-account backup, so it is not described as byte-identical: a separate hashed comparison proved only `seen_updates` differed, while every other preference field matched. No user rows were exported and no preference rollback was performed. The precise counts, hashes, SQL digest methods, fourteen hosted migration versions and retry-function privileges are in `reports/account-postmigration-preservation-2026-11-18.json`.

The fresh encrypted production rollback export was initially blocked by automatic approval review. No workaround was attempted. After Bryan explicitly approved the sensitive payload and named local destination, eight application tables and Auth identity IDs were encrypted by the database before transfer, then decrypted directly in memory into a Windows DPAPI CurrentUser backup outside this repository. No Auth passwords or Google tokens were selected. Capture time was `2026-11-19T01:31:30.544285Z`.

The encryption roundtrip matched exactly. A separate disposable loopback database applied the twelve pre-account migrations and restored all eight tables; every typed source row matched, including all 134 picks, 888 games, the one profile and the one current preference. The disposable database was removed. Private values were not printed or written as a plaintext JSON export; the authorized temporary database necessarily held restored rows during the drill. Backup hashes, aggregate counts and the restore proof remain in the private rollback directory.
