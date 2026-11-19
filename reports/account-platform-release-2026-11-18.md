# FBS Intelligence account-platform release

Prepared November 18, 2026, Mountain Time. This report covers the account, administration, support, security and subscription-foundation assignment. It distinguishes implemented code, deployed backend changes, local verification and features deliberately awaiting configuration. It is not a claim that every requested production journey is complete.

**Release status:** the account-settings foundation is live on Render at commit `16c0be0787f54aa86e895fed43f6726dc0ca7b7d`, after the complete required GitHub checks passed. Both additive database migrations and support Edge Function version 2 are installed. Google remains available. Public email registration, recovery and support-email notifications remain gated until private configuration and real delivery tests pass. Administrator provisioning and permanent deletion are incomplete and disabled. No payments are enabled. This is a controlled foundation release, not completion of the entire account rollout.

## A. User accounts

### Implemented

- A shared, branded sign-in dialog in the existing header, Account settings and Sign out controls. The existing Supabase client, pinned SDK, PKCE flow, Google callback and saved-team state are reused.
- Managed email/password login and password setup/change. Registration, verification/resend and recovery forms are implemented behind separate readiness flags; they call Supabase Auth rather than application credential tables.
- Account settings for public nickname, leaderboard visibility and consent to share picks only after each game's confirmed kickoff. My Teams links to the existing shared preferences instead of introducing another account-specific favorite store.
- Optional TOTP enrollment, challenge and removal for regular users, with backend enforcement once a verified factor exists. Administrative operations require verified MFA.
- Global sign-out, callback-token cleanup, generic provider errors and guards against stale private responses rendering after sign-out or an identity change.
- Password entry uses 12–64 characters and respects the managed bcrypt byte bound. The live provider's minimum-password configuration still needs verification; a frontend rule is not a provider policy.

Passwords, password hashes, recovery tokens and Google credentials are not stored in application profile tables or returned to administrators. Existing Google users add password access through authenticated managed `updateUser`, retaining the same UID; migration never calls registration or unlinks Google.

### What is verified and what remains gated

The real local Supabase Auth v2.198.0 server passed 13 grouped checks, including actual generated confirmation/recovery links, one-use tokens, password changes, TOTP/AAL2 sessions, real refresh-token revocation and PKCE exchange. The strengthened password-change check verifies the live session and continued protected administrator authorization, rather than merely re-reading an old JWT string. A seeded Google-only identity added password access with unchanged UID, actual saved-team rows and contest profile.

This is not a genuine Google OAuth handshake or a production migration. The synthetic saved-pick marker in that Auth fixture is not proof of real locked-pick migration; separate SQL/preservation tests cover application rows. No production Google identity was converted, unlinked or deleted.

The actual Brevo sender `fbsintel@yahoo.com` is verified, and private SMTP/API credentials have been created in the provider. They are not configured in Supabase at this checkpoint. No real verification/recovery email has been sent or received as a release test. Registration/recovery UI flags are false. **The underlying Auth baseline already allowed provider signup; no backend signup disablement has been claimed.** Owner-facing readiness flags do not replace backend Auth configuration.

Evidence: [interface verification](account-interface-validation-2026-11-18.md), [real Auth report](isolated-auth-api-validation-2026-11-18.md), [machine-readable Auth run](account-real-auth-validation-2026-11-18.json), [email readiness](account-email-readiness-2026-11-18.json).

## B. Administration

### Implemented and deployed in the backend

Private database-owned memberships hold ordinary/admin roles and account status. Registration metadata cannot grant authority. Each admin RPC checks an active administrator membership, JWT AAL2, a live matching AAL2 session and a currently verified TOTP factor. Removed factors, expired/revoked sessions and editable role metadata do not authorize access.

The compact administration interface supports:

- Paginated user search by email/nickname and account status review.
- Suspension/reactivation without deleting picks or preferences.
- Nickname moderation with a recorded reason.
- Support-request search/status/review notes.
- Notification status and deliberate recovery of eligible exhausted notifications.
- Append-only administrative action history.

Role provisioning is a protected operator process requiring an existing confirmed identity and verified TOTP. No public registration field, frontend action, hardcoded password or editable metadata can provision an administrator. `fbsintel@yahoo.com` is the designated administrative address, but **no production administrator has been provisioned yet**.

Administrator access does not provide passwords, another user's protected future picks, a locked-pick editor, ranking overrides, game-result editing or silent historical evidence changes. Suspension guards existing profile/preference/contest write paths while preserving owned reads and support access, subject to any enrolled MFA.

The UI is implemented and locally checked; its production availability awaits frontend deployment. No real production administrator session or hosted administrator browser journey has been exercised.

Evidence: [database permissions and migration review](account-database-foundation-2026-11-18.md), [public API denials](account-public-api-verification-2026-11-18.json).

## C. Support and account deletion

### Durable requests and review

The existing private request system now supports account access, teams, contest, nickname/visibility, data discrepancies, deletion and general support. Requests retain unique IDs/timestamps and owner-visible status. Internal notes and private message bodies remain restricted to MFA-authorized administration. Signed-in requests use the existing account identity; a public Yahoo support contact serves people unable to sign in.

Each request queues a private notification. A server-only worker claims bounded batches using row locks, unpredictable lease tokens and ten-minute leases. Failures back off and stop after five attempts; an expired final lease becomes an explicit failed state. A separate audited admin operation can requeue only a failed notification without a persisted accepted receipt, sent timestamp or live delivery lease. A bounded reason is required. Pending/processing/sent rows and repeat clicks are rejected.

Notification mail contains request ID/category/time and a secure review link, not private request text, submitting-user details or contest choices. Provider acceptance is labeled honestly and does not claim inbox receipt. Provider idempotency is time-limited; ambiguous delivery failures can still produce a duplicate after that window. This is not an exactly-once delivery guarantee.

Edge Function **version 2 is active**, and anonymous notification/dispatch attempts and foreign origins were rejected in hosted checks. Guest form intake fails closed until abuse controls are configured. The function's public gateway setting does not authorize callers: the handler independently validates managed sessions, a private dispatcher secret or a configured verified CAPTCHA. Real notification delivery remains disabled until private configuration and mailbox tests succeed.

### Deletion is deliberately incomplete

Account deletion currently means **submit and review a deletion request**, not automatic identity removal. The ordinary status API cannot mark deletion resolved as though removal happened. Existing Auth foreign keys cascade into preferences, profiles, picks, CFP entries and requests. That behavior was demonstrated with disposable data, so an unreviewed production delete would risk destroying contest history.

A retention/anonymization policy, protected execution process and tested session revocation must be approved before permanent removal is enabled. No real user was deleted. Deleting this application's Supabase identity would not delete a person's Google account. Historical contest retention is an owner policy decision, not an invented legal promise.

Evidence: [Edge verification](account-edge-verification-2026-11-18.json), [support/permissions design](account-database-foundation-2026-11-18.md).

## D. Subscription readiness

The implemented foundation is a private, unseeded entitlement table with feature keys, activation/expiry, revocation and source. Backend checks scope access to the current authorized active account. Premium entitlement and administrator authority are independent. No premium row, subscription, checkout, webhook, price or payment was activated.

For future billing, recommend hosted Stripe Checkout/customer portal with server-verified subscription state. Required later work includes raw-body webhook signature verification, idempotent processing, cancellation/expiration/failed-payment/refund handling, test-mode journeys and deletion-with-active-subscription policy. A successful browser redirect must never grant access.

A current U.S. domestic-card planning example is 2.9% + $0.30 payment processing plus 0.7% Billing usage: roughly $0.48 on a $5 monthly subscription, leaving $4.52 before tax, disputes/refunds, currency/international fees and hosting. This is an estimate for later approval, not an active offer or invoice. [Stripe pricing](https://stripe.com/pricing), [subscription events](https://docs.stripe.com/billing/subscriptions/webhooks).

**Payments remain disabled.** Provider, price, fees, premium features and policies need Bryan's approval before activation.

## E. Historical accuracy

The account assignment rechecked existing historical work instead of silently replacing source archives:

- The retained comparison archives contain 17 dated 2025 AP editions and six 2025 CFP editions; 12 available 2026 AP editions and three 2026 CFP editions at the November 18 cutoff.
- All 950 retained team/rank pairs reconcile to the dated ledger. The 747 eligible game/poll associations respect conservative publication bounds strictly before confirmed kickoff.
- Season-ending AP, pre-first-CFP, missing, uncertain publication time, confirmed unranked and FCS-not-applicable remain distinct. Retrospective calculations are not presented as genuine pregame publications.
- Conference result/membership and independent model values were preserved during the earlier comparison-only poll enrichment. This account release adds no new sports-data pull.
- The 2004–2025 research repairs recover 674 FBS postseason games and remove eight duplicate occurrences. A separate supplement adds 34 FCS results and corrects three absolute scores without changing winners. These remain research inputs; they have not replaced the production historical prior.
- Original/repaired source hashes and immutable releases reproduce. This verifies retained lineage, not universal completeness of every historical schedule.

Remaining historical gaps include spring-season-2020 championship coverage, two New Mexico State spring results, incomplete inactive-program history and unfinished independent certification of all historic memberships/subdivisions. Missing totals remain unknown where no complete reference exists. These gaps are documented, not filled with invented records.

The independent reviewer reran 46 relevant historical/poll/conference regressions successfully. Broader frozen-model before/after comparisons are retained in the linked research; their mixed small changes do not justify changing production priors without further evidence/approval.

Evidence: [poll reconciliation](historical-polls-2026-11-18.md), [historical foundation and before/after results](historical-foundation-validation-2026-11-18.md), [independent regression log](account-historical-regression-2026-11-18.log).

## F. Model research and integrity

The production SOR, Predictive Strength, Performance experimental calculations, probability mappings and historical priors are unchanged by this assignment. Human polls remain comparison metadata rather than engine inputs. Existing saved picks, original forecast timestamps and immutable published snapshots are preserved. No material model was promoted.

The frozen FBS–FCS challenger retains coefficients `[2.329814851971762, 1.869996947261027]`. In the retrospective 602-game comparison it improved probability losses, but favored FBS every time, matched the always-FBS winner baseline and missed all 34 FCS upsets. It has not demonstrated prospective upset discrimination or universally superior calibration.

The retained prospective state is **four forecasts captured before November 21 kickoff, zero graded, four pending, zero excluded**. Accuracy/Brier/log loss are unavailable while no games are graded. Original capture times and same-checkpoint comparisons remain intact. The research trial stays separate from public saved picks; it cannot automatically promote itself. FCS-specific SOR alternatives remain unpromoted, and Performance keeps its experimental label/coverage limitations.

No statistical confidence intervals or better-accuracy marketing claim are introduced here. New research needs adequate genuine prospective observations and approval before any production promotion.

Evidence: [frozen division research](division-calibration-research-2026-11-18.md), [independent integrity review](account-security-capacity-2026-11-18.md).

## G. Security, regression checks and limitations

### Results available at this checkpoint

| Check | Actual result and scope |
|---|---|
| Complete Node suite | **435/435 passed**, zero failures/skips, locally and in the successful Linux release workflow |
| Migrations and SQL suites | **14 migrations / 13 SQL suites passed** in disposable PostgreSQL 18 locally and 17 in CI; transactional fixtures and empty-table checks; databases removed |
| Real local Auth API | **13/13 grouped checks passed** using pinned Auth v2.198.0, actual locally issued sessions/TOTP/email tokens; database/listeners removed |
| Official Linux Auth API | **13/13 grouped checks passed** using the checksum-verified, unmodified v2.198.0 release and PostgreSQL 17 in CI; three loopback SMTP messages, no external mail |
| Existing browser quality | **72 responsive routes passed** locally and in the successful Linux release workflow |
| New account/admin browser flows | Passed at **320, 390, 768 and 1440** widths, with explicit disposable SDK/RPC doubles; no unlabeled controls, horizontal overflow or uncaught errors reported |
| CSP enforcement browser harness | Passed with real Chromium and intercepted external transport; inline scripts/handlers/eval/unapproved hosts blocked; approved SDK/API/worker/image paths worked |
| Public hosted database API | Private schemas rejected as unexposed; anonymous account/admin/service RPC calls denied |
| Hosted support Edge boundaries | Unauthorized notify/dispatch denied; foreign origin denied; unconfigured guest intake unavailable; no mail sent |
| Application rollback restore | Encrypted source roundtrip and isolated typed-row restore equality passed for all eight original application tables |
| Production guest browser | Account, Support, Admin denial, My Teams, Rankings and Home passed at **320 and 1440**; real public SDK/sign-in dialog, no credential/form submission |
| Production static publication | Nine live assets/public rankings matched the tested local build byte-for-byte; CSP/referrer metadata and disabled email-readiness flags confirmed |

These rows describe different layers of evidence. Browser SDK/RPC doubles do not become real Auth tests; loopback SMTP is not inbox deliverability; direct authenticated SQL is not hosted PostgREST. Production guest checks do not prove signed-in or administrator production journeys. Exact CI/deployment evidence is in section I.

### Protections implemented or retained

Private schemas remain unexposed through the Data API. Sensitive tables have RLS and no broad client grants; public wrappers are invoker-only with scoped private implementations. Current-role/session/factor guards prevent metadata escalation and stale-admin authorization. Server credentials remain out of public configuration; the publishable browser key is intentionally public and permissions enforce access.

The shared security policy permits the exact integrity-pinned Supabase SDK, first-party scripts/workers/fonts and known Supabase/ESPN hosts. Inline JavaScript/eval are blocked. Existing inline styles remain allowed for team colors/metric bars. Every generated HTML page gets CSP/referrer metadata, and the optional Node server supplies actual security response headers. The Render static site's anti-framing response headers still require host-level configuration/verification: a meta CSP cannot enforce `frame-ancestors` or `X-Frame-Options`.

Independent review corrected a final notification-lease trap, MFA-downgrading password reauthentication, missing recovery from a dismissed MFA dialog, producer/SQL receipt-length mismatch and a weak static-JWT-only MFA test. The notification handler also bounds streamed input before private work and records allowlisted errors without provider response bodies.

### Not yet verified or enabled

- Actual hosted registration, mail receipt/verification, recovery, same-UID Google browser migration and cross-device sessions.
- Production administrator provisioning and a real hosted AAL2 admin browser journey.
- Actual notification delivery/retry after private credentials are configured.
- Permanent deletion/anonymization, which remains disabled pending policy and execution design.
- Trusted-gateway client-IP behavior and CAPTCHA setup for any future public guest form; that intake remains disabled.
- Host-level anti-framing/Permissions-Policy configuration. Live response checks show HSTS and `nosniff`, with CSP/referrer enforcement supplied through HTML metadata; `X-Frame-Options` and HTTP CSP are absent. The Render dashboard requires sign-in and its connector does not expose these header settings.

The final hosted advisors reported eleven intentional private RPC-only RLS/no-policy INFO findings and the disabled leaked-password-protection warning. Performance advisors reported four unused indexes on newly empty support/audit tables; those purpose-built indexes remain pending measured use. No ERROR/CRITICAL advisor finding was returned. Leaked-password checking is a paid-plan capability and was not silently purchased. Preserve explicit privilege controls rather than adding permissive policies to silence informational notices. [Hosted advisor evidence](account-hosted-advisors-2026-11-18.json)

## H. Scalability, costs and operations

Public football pages remain static CDN content; account/contest/support state remains in Supabase. Visitor traffic does not multiply CFBD calls. No new sports-data endpoint, paid service, npm dependency or provider upgrade is introduced.

A reproducible loopback-only PostgreSQL storage probe inserted 64,000 synthetic picks for 1,000 players. Heap plus indexes measured **166.144 bytes/pick**. Assuming every user submits 64 games/week for 15 weeks:

| Active full-season participants | Pick storage at measured density | With 50% allowance |
|---|---:|---:|
| 100 | 15.95 MB | 23.92 MB |
| 1,000 | 159.50 MB | 239.25 MB |
| 10,000 | 1.595 GB | 2.392 GB |

These exclude Auth internals, new admin tables, WAL/backups/temp space and earlier seasons. Registered accounts differ from active participants. The Free 500 MB database cannot retain the 10,000-full-participation scenario, while a 1,000-person first season may fit storage but still needs hosted latency/traffic measurements. This is not a hosted concurrency or 10,000-user guarantee.

Current documented Supabase Free allowances include 50,000 monthly active users, 500 MB database, shared 500 MB RAM and 5 GB egress plus 5 GB cached egress. Sixty direct database connections do not mean a limit of sixty website visitors; browsers use HTTPS APIs. Pro starts at $25/month with larger storage and daily backups. No upgrade was made. [Supabase pricing](https://supabase.com/pricing), [compute limits](https://supabase.com/docs/guides/platform/compute-and-disk).

Render's current Hobby allowance is 5 GB/month outbound traffic; the actual workspace allowance/legacy terms must be checked. A planning example of 1,000 users × 10 fresh visits × 0.5 MB is roughly 5 GB; caching/compression materially change it. Overage can cost money with a payment method, or interrupt service without one. Do not silently enable paid overage. [Render outbound bandwidth](https://render.com/docs/outbound-bandwidth).

Brevo Free is the chosen conditional email pilot, with 300/day shared across authentication SMTP and notification API. The Yahoo sender is verified, but temporary provider-domain rewriting is not a permanent delivery guarantee. **Using the daughter's/family website domain is expressly prohibited.** The Render URL is not a sending domain whose DNS we control. No purchase is authorized. [Email setup and tests](free-email-setup-2026-11-18.md).

Before promotion, measure database growth, leaderboard query p95, egress, Auth throttling, actual email use and recovery success. Cache stable public aggregates, avoid rapid polling and per-user result-sync loops, and reassess near 70–80% of hard allowances. Existing retained synthetic load logs are local engineering evidence only, not a hosted free-tier promise. Free-plan backups require owner-managed exports and restore drills; application backups do not include complete managed-Auth recovery state.

Evidence: [capacity analysis](account-security-capacity-2026-11-18.md), [measured storage](account-capacity-storage-evidence-2026-11-18.json), [retained-load limitations](account-retained-load-evidence-2026-11-18.json).

## I. Production rollout and rollback

### Verified backend state

- Baseline: one Google identity, no password identity or verified MFA factor; 134 saved weekly picks, one contest profile, 888 games, one saved preference, zero CFP entries and zero support requests. Baseline identifying/private records are not reproduced here.
- Foundation migration applied as **20261119014527**. Its SQL was first tested locally; the local filename matches hosted history without altering its body.
- Notification-requeue follow-up applied as **20261119022909**. It is additive and does not edit game data, picks or model artifacts.
- Support Edge Function **version 2** active; hosted unauthorized-call checks passed. Private SMTP/provider environment remains unconfigured and no external email has been sent by the release process.
- The designated Yahoo sender is verified and private Brevo SMTP/API keys were created securely. Those secrets remain outside source/public configuration. Correct **Work Projects / FBS Intelligence** dashboard access is still awaiting the owner; a different organization must not receive this configuration.

The final read-only preservation check retained **134 picks** and the exact saved-pick/profile digests, plus the original favorite selection and all other preference fields except `seen_updates`. The full preference-row digest changed solely in that seen-marker projection; no actor is attributed, and no overwrite or rollback was performed. It would be incorrect to claim the entire live preference row stayed byte-identical. Counts remain one identity/profile/preference, 888 games and no support requests; the new foundation has one ordinary membership, no administrator, no suspension, no entitlement and no audit action. [Sanitized post-migration evidence](account-postmigration-preservation-2026-11-18.json)

### Verified frontend rollout

The deployed application commit is **`16c0be0787f54aa86e895fed43f6726dc0ca7b7d`**, including foundation commit `3261cb8`. [Required GitHub workflow 44446209050](https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/actions/runs/44446209050), job `135298860431`, completed successfully: Node, isolated SQL, official Linux Auth, static build, general browser, account/admin and CSP checks all passed.

The release gate correctly stopped the earlier candidate after Linux detected a one-pixel signed-in mobile-header overflow. The correction lets the mobile logo yield space while retaining readable account buttons. Strict overflow checks remain, with a wider-font regression case and diagnostic element bounds. The corrected candidate passed on Linux before publication.

Render static service `srv-dbn9jqc9v7es73c4ql2g` automatically deployed **`dep-dbv63ueq1p3s7382tjp0`**, which became **live at `2026-11-19T02:44:13.995982Z`** (November 18 Mountain Time). Public verification at `02:44:49Z` found all nine sampled assets—including account scripts, CSS, config, app and published rankings—HTTP 200 and byte-identical to the tested build. Registration, recovery and support-notification UI flags remain false. Live HTML includes the intended CSP/referrer metadata; the host-level header limitation above remains explicit. [Static/live evidence](account-production-verification-2026-11-18.json)

An actual production browser then checked Account, Support, guest Admin denial, My Teams, Rankings and Home at 320 and 1440 pixels. The live managed SDK loaded, the native sign-in dialog exposed email/password and the retained Google option, gated registration/recovery controls were absent, and all twelve route/width combinations had no horizontal overflow or uncaught page errors. No credentials, forms or mail requests were submitted. [Guest browser evidence](account-production-guest-browser-2026-11-18.json)

Production: **https://fbs-intelligence.onrender.com/**. Account settings use **https://fbs-intelligence.onrender.com/#account**; `/#admin` correctly denies a guest and remains unusable until protected provisioning. Google remains enabled; a new real Google OAuth handshake was not performed as a release test. Do not advertise administrator access or public email registration as active.

### Rollback readiness and data preservation

Before production DDL, Bryan explicitly approved an encrypted application backup outside the repository. Eight application tables and Auth identity IDs were encrypted before transfer and protected locally using Windows DPAPI CurrentUser. No Auth password or Google token was selected. Capture was `2026-11-19T01:31:30.544285Z`. A separate disposable database restored all eight typed tables and matched the source rows, including all 134 picks, 888 games, profile and preference. It was removed after verification.

This is a tested application-data recovery artifact, not a complete Auth credential/provider backup. Keep access to the original owner context and private restore instructions. Prefer reverting frontend assets or disabling readiness flags while retaining additive schemas and the existing contest-privacy protections. Do not roll production user tables backward over newer legitimate activity, drop account schemas, or reverse the earlier privacy correction as a routine rollback. Unexpected production data changes require an explicit reviewed recovery plan.

### Remaining owner/configuration work

1. Sign into the correct **Work Projects / FBS Intelligence** Supabase dashboard and securely enter the verified Brevo SMTP/private function configuration. Do not send keys in chat or touch another organization/domain.
2. Confirm managed password, verification, OTP lifetime, callback and rate-limit settings; keep Google available.
3. Complete actual mailbox verification/recovery and disposable same-UID migration tests, then deliberately activate the corresponding backend/UI flows.
4. Confirm administrator identity, enroll/verify TOTP, and run protected provisioning; test the real administrator session and support review/notification delivery.
5. Approve the contest-history retention/deletion policy before a permanent removal process is built/enabled.
6. Confirm actual hosting/email allowances and host-level anti-framing settings before broad promotion. No upgrade or live billing without separate approval.

## Technical change map

| Area | Principal files/components |
|---|---|
| Native account experience | `frontend/account-auth.js`, `account-center.js`, `account-center.css`, existing `bracket-auth.js` and `app.js` |
| Admin/support UI | `frontend/account-administration.js`, `account-support.js`, `platform-info.js`, `bracket-config.json` |
| Database/RLS/RPC foundation | `supabase/migrations/20261119014527_account_administration_foundation.sql`, `20261119022909_support_notification_requeue.sql` |
| Support backend | `supabase/functions/account-support/index.ts`, `_shared/support-handler.mjs`, `scripts/dispatch-support-notifications.mjs` |
| Browser security | `src/security-policy.js`, `scripts/prepare-static.js`, `src/server.js` |
| Regression gates | `.github/workflows/test.yml`, `scripts/check-database.mjs`, `check-auth-api.mjs`, `lib/auth-api-flows.mjs`, `account-browser-quality.mjs`, `check-security-policy-browser.mjs`, associated Node/SQL suites |
| Existing scheduled workflow | `.github/workflows/weekly.yml` adds a bounded optional support retry using existing runs; no new sports-data schedule or CFBD call |
| Capacity evidence | `research/measure-contest-storage.mjs`, reports linked above |

No npm dependency was added or upgraded. The Auth integration harness uses a checksum-pinned official release in Linux CI; the local Windows source build has a documented listener-only adaptation. It is not the identical hosted binary. The final release should preserve these distinctions and report incomplete gated work as incomplete.
