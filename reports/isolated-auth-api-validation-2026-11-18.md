# Isolated real Auth API validation

The real Supabase Auth v2.198.0 API passed **13 grouped checks** against a disposable local PostgreSQL database with all **14 current application migrations** applied. The strengthened run completed at `2026-11-19T02:28:41.358Z` (November 18 Mountain Time). It captured three locally generated email messages, removed its database and listeners, and made no production requests or external email deliveries.

Machine-readable evidence: [account-real-auth-validation-2026-11-18.json](account-real-auth-validation-2026-11-18.json).

## What actually ran

This is a running Auth server, not a mocked API. It generated confirmation/recovery tokens, sessions, refresh tokens, password hashes and TOTP challenges itself. A loopback SMTP sink captured its messages in memory so the tests could use the actual generated links. No passwords, session tokens, confirmation links, email bodies or TOTP secrets are retained in the report.

| Group | Result |
| --- | --- |
| Server health and confirmation-required settings | Passed |
| Configured minimum password length | Passed |
| Signup generates confirmation mail; unverified password login fails | Passed |
| Actual confirmation verifies once and preserves the original UID | Passed |
| Duplicate signup does not duplicate the account | Passed |
| Actual recovery mail changes the same account; old password and replay fail | Passed |
| Incorrect TOTP fails; correct TOTP produces an actual AAL2 session | Passed |
| Editable metadata does not grant admin; protected provisioning requires verification and MFA | Passed |
| Actual AAL2 session authorizes the minimal directory; earlier AAL1 token remains denied | Passed |
| Current-password verification preserves UID and verified MFA | Passed |
| Seeded Google-only identity adds password access with unchanged UID, saved-team rows and contest profile | Passed |
| Email PKCE confirmation exchanges once with the matching verifier and original UID | Passed |
| Global logout revokes refresh access and subsequent database authorization | Passed |

The administration checks use real issued JWT claims and real Auth session/factor rows with the application's authenticated database role and protected SQL functions. They also verify that the returned directory contains no password, token or picks fields. This does not replace a hosted PostgREST/API integration test.

After a successful current-password change, the harness checks the live `auth.sessions` row still has the original session ID, user ID and `aal2`; calls the real authenticated user endpoint; refreshes the session and checks the newly issued token still identifies the same AAL2 session; and successfully calls the protected administrator directory with those fresh claims. This verifies continued authorization rather than inspecting only an unchanged preexisting token.

## Runtime provenance and safety

* Official source: [Supabase Auth v2.198.0](https://github.com/supabase/auth/tree/v2.198.0), matching the version label observed on the public production Auth health endpoint.
* Official source archive SHA-256: `44864b95510681e26406c71b2b464141f5a6e65e4db8061eb93d0b023562ef6d`.
* Portable official Go 1.27.4 Windows archive SHA-256: `178ab98950ac69ab25069307dc6ade79f3816e414cce95b4da166a115cde1e7e`.
* Tested Windows executable SHA-256: `be711e33bca0d9802d8f8c46a2c34454330bbc562156c37e8965c33236dd6341`.
* PostgreSQL 18 was already available locally. No Docker, OS service, global PATH or toolchain installation was added.

The upstream CLI uses a Linux-only `SO_REUSEPORT` listener option. The temporary Windows source build omitted that option and its unused Unix imports in `cmd/serve_cmd.go`. API handlers, storage, mailer, password validation, MFA and migrations were unchanged. This is therefore a source-equivalent Auth implementation with a documented listener adaptation, **not the identical hosted binary**.

The committed harness accepts loopback PostgreSQL only, verifies the Auth executable checksum, creates a random `forge_auth_test_<hex>` database, and refuses client roles that bypass row security. Its Auth server and SMTP sink bind only to loopback. Application migrations are read from the repository at execution time. All created identities and application rows are discarded with the isolated database. No production credentials or account exports are used.

Test-only mail rate limits are deliberately relaxed inside the isolated process. They are not production configuration recommendations.

## Reproduction

The implementation is [scripts/check-auth-api.mjs](../scripts/check-auth-api.mjs) with [scripts/lib/auth-api-flows.mjs](../scripts/lib/auth-api-flows.mjs). It uses Node built-ins and the existing PostgreSQL client; no npm dependency was added.

For Linux CI, use the unmodified official release rather than rebuilding the Windows adaptation:

```sh
mkdir -p "$RUNNER_TEMP/forge-auth"
curl --fail --location --retry 3 \
  https://github.com/supabase/auth/releases/download/v2.198.0/auth-v2.198.0-amd64.tar.xz \
  --output "$RUNNER_TEMP/forge-auth/auth.tar.xz"
echo "4abe9134d7615faa9149cab514acada8e7133cd69d2ccd96fdcef0d795c05171  $RUNNER_TEMP/forge-auth/auth.tar.xz" | sha256sum --check
tar -xJf "$RUNNER_TEMP/forge-auth/auth.tar.xz" -C "$RUNNER_TEMP/forge-auth"
AUTH_TEST_RUNTIME="$RUNNER_TEMP/forge-auth" \
AUTH_TEST_BINARY="$RUNNER_TEMP/forge-auth/auth" \
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres \
node scripts/check-auth-api.mjs
```

The workflow supplies its existing disposable PostgreSQL password through `PGPASSWORD`. Do not supply a hosted database URL. The harness also verifies the extracted Linux binary SHA-256: `77d5009ee8501fb380fe4ad0c42cfdeb3da8ac0e5660e59bf8d736ccb457a6c6`. This Linux artifact was downloaded and verified locally; execution on Linux is a separate CI check, not part of the Windows evidence above.

On Windows, set `AUTH_TEST_RUNTIME` to the temporary runtime directory, `AUTH_TEST_BINARY` to its reviewed `auth.exe`, `AUTH_TEST_WORKDIR` to the extracted source directory, and `PSQL_BIN` if PostgreSQL is elsewhere. `PGHOST`, `PGPORT` and `PGUSER` must describe an isolated loopback instance. Optional `AUTH_TEST_REPORT` selects the sanitized result path.

## Boundaries and remaining verification

* Local SMTP capture proves Auth generates and consumes its email actions. It does **not** prove Brevo authentication, inbox receipt, sender reputation or production deliverability. Public email registration must remain gated until those hosted flows pass.
* The Google migration case intentionally seeds a Google-only identity in the isolated database. It exercises real password-addition and sign-in mechanics, preserving the same UID and actual preferences/profile rows. It does **not** perform a Google OAuth handshake, test Google account linking, or alter a real Google user.
* The saved-pick marker in that fixture is synthetic. Actual locked-pick preservation belongs to the separate application migration/SQL regression tests; this Auth run must not be described as proving migration of production locked picks.
* Session-backed authorization runs directly through PostgreSQL under the authenticated role. Hosted PostgREST and production browser/email journeys remain separate verification requirements.
* This is PostgreSQL 18 locally versus PostgreSQL 17 in the existing CI service. Both must pass their respective checks.
* No ranking formula, calibration coefficient, historical input, forecast, scheduled publication or production account changed.

These checks provide a reproducible free Auth regression layer. They supplement the existing Node, SQL and browser suites and do not authorize disabling working Google sign-in or activating unverified email delivery.
