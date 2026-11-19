# Daily result-refresh reliability

## Finding and evidence boundary

The parent coordinator found no November 19 run of the active daily results workflow by the morning audit check, while independent availability runs had executed. There was no queued or failed daily run to retry in that observation. GitHub documents that scheduled runs can be delayed and dropped; this does not prove which internal scheduling condition caused this particular absence. The existing timezone-aware 03:45 Mountain cron is preserved, as is the Sunday 20:11 backup. [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

The two November 18 final results were present on the official university sites and ESPN, while the public CFBD publication retained its earlier cutoff. Live-score receipt and model publication are separate facts; neither is relabeled as the other.

## Guarded recovery

The existing scheduled availability job now runs `scripts/daily-refresh-watchdog.mjs`. It makes no CFBD request and adds no scheduled job, secret, role or service. It checks the aligned committed source only after 06:45 Mountain, a three-hour grace period following the regular daily time. An unnecessary, recently refreshed, malformed or unaligned publication cannot trigger recovery.

When a daily refresh is actually needed, the watchdog reads the existing weekly workflow's main-branch run evidence. Any queued/active run, any run already attempted that Mountain day, or unavailable/incomplete/unrecognized evidence produces a diagnostic rather than another provider request. Only a genuinely absent run can receive one guarded recovery dispatch. API failure or ambiguous dispatch acceptance is never automatically retried within the check. Current documented GitHub REST dispatch receipts include a run ID; absence of that receipt is reported honestly. [Workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)

The optional `recover_missing_daily` input preserves normal explicit manual-refresh behavior. A recovery first uses the existing `dailyRefreshNeeded` source/date rules, then rechecks run evidence inside the serialized weekly workflow, excluding only its own verified active main-branch dispatch identity. A late original run that queued, finished or failed between planning and execution therefore prevents another automatic batch. A late scheduled run after a successful recovery sees today's publication and skips a duplicate pull. The normal weekly concurrency remains unchanged.

This is a bounded recovery mechanism, not an exactly-once distributed dispatch guarantee. API visibility failures fail closed; a failed data update or ambiguous evidence still requires review instead of endless retries. The job summary records source/model cutoffs, the diagnostic reason and a public related-run link. A requested recovery is never labeled a successful publication. Diagnostics use the existing Actions logs/summary rather than extra public-data commits and Render deployments.

The existing Sunday player workflow accepts successful main-branch manual/recovery completions as well as schedules. Its existing Sunday, same-day source, already-published-page and encrypted-cache guards are unchanged, so this restores the planned Sunday follow-on rather than adding another scheduled batch. Those existing source guards are asserted in regression coverage; an actual production player batch was not triggered for this work.

## Budget and tests

The last retained quota observation was **934 calls remaining at November 18, 22:42:04Z**, from the historical-poll manifest. It is a dated observation, not a live quota claim. A normal results publication uses the existing two CFBD season/team requests plus its optional single Performance request. Recovery replaces a missed intended daily publication; it does not introduce a new recurring CFBD cadence. No provider quota probe or production dispatch was made by this implementation agent.

Eleven new Node tests passed, together with the nine existing refresh-needed tests. They cover Mountain standard/daylight clock changes, the 06:45 grace boundary, same-day freshness, invalid alignment, pending/failed/successful run states, incomplete API evidence, guarded dispatch receipts, ambiguous failure/no-retry behavior, serialized late-run authorization, invalid self-run exclusion, diagnostic privacy, and preservation of schedule/concurrency/Sunday cache guards. Tests use explicit GitHub response doubles and are not represented as live production recovery execution. Production rollout and any deliberately triggered recovery remain the parent coordinator's responsibility.
