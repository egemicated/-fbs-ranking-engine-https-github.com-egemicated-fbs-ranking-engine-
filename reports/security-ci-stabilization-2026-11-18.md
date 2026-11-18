# Security and SQL integration verification — November 18, 2026

## Scope and production baseline

Read-only checks examined the existing Supabase project, PostgreSQL 17.11 in
UTC, after the earlier platform privacy migration. The previous 134-pick count
is still **134**. Its aggregate row digest is
`5dfea904ed227a2eba0070bce9fbea73` (MD5 of sorted `to_jsonb(row)::text`, joined
with newline). This digest detects accidental changes; it is not a cryptographic
backup format. No real selections, account IDs, messages or email addresses are
included in this report.

There was one player, one preference row and zero account requests at baseline.
The player digest remained unchanged. The preference digest changed during the
audit as live preference/seen-state activity continued; the audit made no
production data writes and must not overwrite that newer activity.

All eight application tables have RLS enabled. The seven private tables have
no client table grants and no permissive RLS policies. The public preference
table grants only authenticated CRUD and has both `USING` and `WITH CHECK`
ownership predicates. No application views were present. Public RPC wrappers
are security invokers; privileged implementations are in private schemas, pin
an empty search path, and explicitly scope execution to intended roles.
User-specific reads and writes use the authenticated subject rather than a
caller-supplied owner ID. Publisher RPCs are limited to `service_role`.

The live migration history has the same eleven pre-audit migration names as
the repository, but several timestamps differ. Do not bulk-push those older
local migrations to production. The latest platform migration's remote version
is `20261118193518`; its local filename is `20261118192613`.

## Confirmed defects and corrections

1. **Pregame aggregate disclosure.** The community RPC exposed exact tallies
   once three picks existed, including private profiles without sharing consent.
   A unanimous 3–0 tally disclosed all choices. A synthetic four-account SQL
   regression reproduces this against the baseline. The new function waits for
   confirmed kickoff and counts only public profiles that consented to sharing
   and saved before kickoff. The existing minimum-three split suppression is
   retained. A caller must also have its own valid pregame pick for that game.
2. **Postponed games with elapsed timestamps.** Public player picks excluded TBD
   times but could release a `pending` game's choices when its retained scheduled
   time elapsed. A separate baseline regression reproduces this. Both public
   player selections and community tallies now exclude `pending` games.
3. **Stale SQL expectations.** Three of the ten baseline SQL suites failed after
   the already-completed privacy/multi-team changes. Immediate-sharing and
   kickoff-correction tests expected future choices to be public; an old team
   validation test expected the superseded SQLSTATE. Tests now assert the current
   intended contract, including owner access to future edits and public denial.
4. **SQL missing from CI.** Engine checks previously ran the Node suite indirectly
   through static preparation, but no SQL integration suite. CI now has a named
   full `npm test` step and a fresh PostgreSQL 17 integration service applying all
   migrations and executing every SQL file. SQL failure stops the job before the
   static build/browser checks. `workflow_dispatch` supports automated publisher
   commits, whose `GITHUB_TOKEN` pushes do not themselves start push workflows.

The CLI-created migration is
`20261118223500_weekly_community_kickoff_privacy.sql`. It replaces two function
bodies, preserves their grants and signatures, and performs no inserts, updates,
deletions or table changes. The release owner applied it after review. Independent
post-migration catalog/API checks confirmed both kickoff/pending guards and the
original scoped grants. All 134 picks and the player row retained the exact
baseline digests. This audit agent made no production writes. Retain the privacy function when rolling back
a frontend release; restoring its predecessor would restore the known leak.

## Verification results

| Check | Result |
| --- | --- |
| Baseline SQL files after all 11 prior migrations | 7 passed, 3 stale-expectation failures |
| Added aggregate privacy regression against baseline | Failed at unanimous private pregame tally, as intended |
| Added postponed privacy regression against baseline | Failed at pending-game public release, as intended |
| Fresh local PostgreSQL 18, all 12 migrations | Applied successfully |
| Complete SQL suites after correction | **11 passed, 0 failed** |
| Full Node suite after integration changes | **344 passed, 0 failed, 0 skipped** |
| Fixtures after every suite | All application/auth fixture counts zero |
| Runner hosted-host guard | Rejected Supabase hostname before invoking psql |
| Anonymous direct preferences REST | HTTP 401 |
| Private picks/support schema REST requests | HTTP 406; schemas not exposed |
| Anonymous owner/account-request RPCs | HTTP 401 |
| Unknown random public pick ID | HTTP 200, null result |
| Invalid bearer token | HTTP 401 |
| Google provider settings endpoint | HTTP 200, Google enabled |
| Public frontend credential scan | 52 source files, zero secret-key/service-role JWT matches |

The SQL suites cover anonymous, owner, other-account and subjectless sessions;
direct table/API privileges; shared RPCs and legacy clients; future and elapsed
kickoffs; corrected and postponed schedules; TBD times; edited and voided picks;
consent/revocation; saved-pick scoring; preserved forecasts; private support,
data/deletion requests; duplicate request handling; preference ownership,
multiple team IDs and invalid inputs. Account IDs and all fixture content are
synthetic. HTTP probes were read-only and discarded response bodies containing
anything other than the expected null/settings result.

## Recoverability

The parent release process created a verified Git bundle and an eight-table,
function/permission/policy/constraint backup outside the public repository. The
application backup is Windows DPAPI CurrentUser encrypted. It contains no Auth
passwords, tokens or provider secrets and requires the same Windows profile to
decrypt. Private recovery instructions and `restore-drill.ps1` are alongside it.

A complete private restore drill passed: recreate the eleven baseline migrations
in a fresh local database; create minimal Auth identity placeholders; restore
eight tables in foreign-key order; verify both directions with `EXCEPT ALL`;
compare aggregate counts/digests; drop the isolated database. All eight restored
tables equaled their encrypted source rows. The restored 888 games, 134 picks,
one player, one preference and one publication matched backup counts; picks and
player digests matched the live baseline. The backup preference digest exactly
matched its restored source, while later live activity was preserved. Sensitive
rows stayed in process memory and the disposable local database, with raw SQL
errors withheld from public output. No production restore was performed.

## Remaining limitations and advisories

Actual Google consent, sign-in, sign-out, restored browser sessions, expired or
revoked access tokens, refresh behavior and two real disposable OAuth accounts
remain unverified. Synthetic `auth.uid()` role tests validate database ownership
but do not validate GoTrue or Google. A malformed-token rejection is not an
expired-session test. Account deletion remains a private request for manual
owner processing; it does not automatically delete the account.

Health advisors returned no findings. Security advisors reported the expected
seven private RLS tables without policies (INFO), plus disabled leaked-password
protection (WARN). Review the existing authentication setting using the
[official password-security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
Performance advisors reported one unused CFP entry index (INFO); no index was
removed. Read-only log source/severity aggregates were inspected; this does not
establish that every account scenario has executed successfully.

Current Supabase changelog and RLS/function documentation were consulted before
implementation, including the CLI v3 local-default/hosted-confirmation change
and the current PostgreSQL minor release. No paid branch, project or service was
created. This work made zero CFBD calls, small read-only Supabase audit requests,
and adds SQL execution within the existing GitHub Actions workflow. The release
owner applied the reviewed privacy migration; repeated live permissions, guards,
REST denials and pick/player digests passed afterwards. Hosted CI and Render's
exact-commit gate must still execute on the release revision before declaring a
site deployment pass. The gate protects the Render site publication; existing
Supabase schedule/scoring sync workflows execute separately and should not be
described as waiting for completed browser/SQL CI.
