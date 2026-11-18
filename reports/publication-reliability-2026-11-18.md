# Publication reliability and release safeguards

This release changes publication safeguards and comparison-data archival, not
ranking mathematics, game results, historical priors or saved forecasts.

## Required release checks

Engine checks explicitly runs the complete Node suite, all migrations and SQL
regressions against a disposable PostgreSQL 17 service, static publication, and
Chromium browser checks. Its job has a twelve-minute timeout. PostgreSQL test
credentials are synthetic and local to that job; production database secrets
are not required. The database harness rejects hosted addresses and creates
and drops only its own random loopback database.

Render's existing service setting starts builds on commit. The connector cannot
change that setting. Instead, the existing build command now invokes
`require-release-checks.mjs` before installation or publication. On Render only,
the guard checks the exact `RENDER_GIT_COMMIT` against the pinned repository,
main branch and Engine checks workflow path. It uses the newest matching
push/dispatch run, rejects a newer failure even when an older run succeeded,
and fails closed on missing evidence, HTTP failure, malformed responses or an
eight-minute wait timeout. An ordinary local/CI build does not recursively
wait on itself. A real previously successful GitHub revision was checked before
enabling the guard; first hosted execution is recorded in the final release
report.

All five Git-publishing workflows request Engine checks after an actual bot
push, using GitHub's existing token with scoped Actions permission. Bot-token
pushes do not themselves trigger another push workflow. Exact-revision checks
therefore also cover the new snapshot commit after a rebase. No additional
GitHub or Render secret is required. This follows the documented behavior of
[GitHub's token](https://docs.github.com/en/actions/concepts/security/github_token)
and [Render build variables](https://render.com/docs/environment-variables).

Unauthenticated GitHub API verification is subject to GitHub's rate limit and
network availability. The guard normally polls every thirty seconds. A rate
limit or excessive queue delay stops the build and retains the previous live
deployment. Retry that same deployment after its checks succeed; do not bypass
the gate or publish an unverified candidate. The build setting remains
commit-triggered; the build guard enforces the release requirement.

## Coherent snapshot publication

`assertPublicationBundle` requires FBS and FCS saved-pick sources to match the
ranking snapshot hash and season, plus exactly one matching current conference
dataset. A stale/missing companion no longer silently degrades a new static
publication. Existing experimental Performance remains optional and retains
its existing same-snapshot eligibility checks and honest unavailable state.

The weekly workflow now requires both FBS and FCS pick generation to succeed
before committing a refreshed snapshot. Every data-publishing workflow builds
and validates the candidate before pushing. A failed candidate remains in the
ephemeral job workspace; main and the live site retain the preceding verified
publication. Two fault-injection tests execute the real weekly CLI in a
temporary workspace with mocked HTTP failure or an empty result response and
verify the old publication remains byte-identical. No provider requests occur
in those tests.

Database result-sync RPCs retain their existing source validation and
idempotency. They are separate from the static deployment guard; this release
does not claim that every background database result update waits for browser
CI. The reviewed privacy migration was applied only after isolated SQL tests
and a private backup restore drill passed.

## Schedules and usage

- Existing results check remains 03:45 America/Denver daily, with the existing
  Sunday 20:11 backup and its no-unresolved-game/no-repeat guards.
- CFP remains 20:00 and 20:05 Mountain on the official configured 2026 release
  dates. The missing November 3/10 schedule entries were restored. Its one
  official response is reused to archive the edition; no extra CFBD request.
- AP archival observes the current publicly distributed edition at 15:47
  Mountain daily during August–January. This catches delayed and Tuesday final
  editions. It uses one public ESPN request, no CFBD key. Identical editions
  cause no commit/build; conflicting saved rows stop for reconciliation.
- The two-call historical recovery is request-ID scoped and reuses a retained
  artifact on a successful repeat. There is no recurring historical CFBD import.

Read-only GitHub evidence showed a successful results publication at
`2026-11-18T12:29:53Z` (push run `44304472572`) and a successful scheduled results
run at `2026-11-16T11:04:43Z` (`43854515577`). The 03:45 schedule was configured
after November 18's morning window; its first subsequent scheduled execution
is not yet observed. A CFP scheduled run (`44288672796`) and availability
scheduled run (`44398599021`) also completed successfully. Successful past runs
do not guarantee future GitHub scheduling or upstream availability. No extra
results pull was launched merely to test scheduling.

## Recovery and cost boundary

The baseline Git bundle passed verification and the private DPAPI-encrypted
eight-table application backup passed a full isolated restore drill. No new
paid infrastructure, API tier, hosted database branch or testing platform was
created. The historical poll work consumed exactly two CFBD requests; its last
quota header reported 934 remaining. AP/CFP public-source archival adds zero
CFBD calls. Additional tests and guard waits use the existing public GitHub
runners and Render build resources. This is not a verification of account
invoices or a guarantee of unlimited included hosting allowances.

For rollback, retain the privacy correction, revert the relevant frontend/data
or publication commits, run the same checks and deploy the verified revision.
Do not bulk-push older Supabase migration files whose timestamps differ from
the hosted history, restore older picks over newer user activity, or bypass
the gate to make a failed build appear healthy.
