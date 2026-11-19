# Account security, email and capacity review

Prepared November 18, 2026 (Mountain Time). This is the independent review for the account-system assignment. Findings distinguish observed production aggregates, local synthetic measurements, provider documentation and unverified rollout steps. No production account, identity, pick, publication or provider configuration was changed by this reviewer.

## Architecture and release boundaries

Keep the static Render site, Supabase Auth, existing contest tables, shared preferences and pinned Supabase client. Native email/password forms should call managed Auth APIs; there is no reason to implement password storage, hashing or a second identity system. Preserve Google as an alternative during transition. Public football data remains available without login.

Use a private, backend-owned membership record for administrator status and account suspension. Never derive permissions from editable user metadata. Every administrative operation must check the current membership, a current authenticated session and MFA; hiding controls in the browser is insufficient. Check that a verified second factor still exists, because a stale token can retain an `aal2` claim briefly after unenrollment. Supabase documents [MFA enforcement](https://supabase.com/docs/guides/auth/auth-mfa) and [session-ID validation](https://supabase.com/docs/guides/auth/sessions).

No admin account should be automatically assigned by email supplied during public registration. Provision the designated existing account through a protected owner-only process after its identity and TOTP enrollment are verified. Revoke or suspend access using live backend state. An administrator gets account/support operations, not broader access to private contest choices or publishing/model credentials.

The existing user journey should become: header sign-in → account settings → existing saved teams/profile → account request status. Admin operations belong in a separate compact view available only after verified authorization. Future subscriptions should be backend entitlements with an expiration/status; administrator role and premium access remain separate concepts.

## Email delivery is a real launch gate

The built-in Supabase mail service is restricted to organization-team email addresses, currently allows two messages per hour and provides no delivery SLA. It cannot support public registration or dependable password recovery. Use custom SMTP with a verified sending identity and successful mailbox tests before enabling public registration. [Supabase SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp)

| Option | Current documented allowance | Setup and tradeoff |
|---|---|---|
| Brevo Free, selected conditional pilot | 300 emails/day | Verify Yahoo as an individual sender; Brevo temporarily rewrites the From domain. Actual account approval and mailbox tests remain required. |
| Resend Free, inactive alternative | 3,000 transactional emails/month, 100/day | Requires an authorized verified sending domain; its sandbox is not unrestricted public mail. No daughter's/family domain use is authorized. |
| Supabase built-in | Team-only test recipients, two/hour | Suitable for a narrow owner test, not public registration/recovery. |

Latest owner direction explicitly forbids using the daughter's babysitting domain. Bryan is creating a separate Brevo Free account for a no-owned-domain pilot, using `fbsintel@yahoo.com` as the verified mailbox/support recipient/Reply-To. This supersedes the earlier Resend-reuse proposal. Do not touch another website's domain, DNS, keys or sending settings. The Render `onrender.com` address is not an owned sending domain we can authenticate. [Owner setup and actual-delivery gates](free-email-setup-2026-11-18.md)

Brevo documents a [free daily allowance](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan) and [temporary provider-controlled From-address replacement](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders). This is conditional pilot infrastructure, not a guarantee of permanent no-domain deliverability. Resend remains inactive/sandbox-only without an authorized owned domain; its [SMTP prerequisites](https://resend.com/docs/send-with-supabase-smtp) are not satisfied merely by having a Render URL. No provider was created or activated by this reviewer. No domain purchase, paid plan or automatic overage is authorized.

The free Brevo daily allowance is shared by authentication SMTP, recovery/resends and API support alerts; unused daily quota does not roll over. A gradual small pilot may fit after testing; a viral launch cannot be promised free. Configure Auth rates below the provider budget, allow a resend cooldown, handle 429s honestly, and do not claim delivery merely because Auth/provider accepted a request. [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)

Turn off link tracking for Auth emails and verify that provider security scanning does not consume one-use links. Test verification, recovery, expiry/reuse, wrong-email handling, mail delays and mobile return URLs. A provider API acceptance response is not proof of inbox receipt. The owner must confirm receipt and successful completion using disposable identities before the public registration gate opens.

For support notifications, persist a private outbox event with the request ID and retry state. The notification should include the ID/category and a secure admin link, not the account's private message or picks. Delivery failures must remain visible in admin operations and be retryable without duplicate requests. A public support email/contact for people unable to log in requires a real owner-designated address; do not invent one. No email notification has been sent by this reviewer.

## Identity migration, recovery and deletion

Supabase explicitly supports adding a password to an existing OAuth user through authenticated `updateUser({ password })`, preserving the same user ID. Do not call sign-up to migrate an existing Google account: an existing OAuth email can produce an obfuscated response without a new verification message. Keep Google linked until the alternative is tested. See [Identity Linking FAQ](https://supabase.com/docs/guides/auth/auth-identity-linking).

Test migration using disposable managed-Auth identities, comparing the user ID and saved-data row hashes before/after. SQL ownership fixtures and mocked SDK calls do not alone prove real email delivery, a Google browser login, refresh-token behavior or recovery. Do not report these as live tests unless actually exercised.

Require a reasonable password length in managed Auth as well as the client; a client-only rule is bypassable. Leaked-password protection is a Pro-plan feature, so its disabled advisor warning on Free is not evidence that plaintext passwords are stored. Keep the limitation explicit rather than paying to remove it silently. Managed refresh-token rotation remains enabled. Timeboxed/inactivity session controls are also paid features; sensitive admin RPCs can require a live session without introducing a second session system. [Password security](https://supabase.com/docs/guides/auth/password-security), [session controls](https://supabase.com/docs/guides/auth/sessions)

Existing Auth foreign keys cascade through preferences, contest players/picks, bracket entries and support requests. A raw Auth-user deletion can therefore erase contest history. Account deletion must be deliberate, explain the retention policy, and record an audit event. If anonymized contest history is retained, remove the account identifier/email/nickname and revoke sharing while preserving only the minimum immutable results necessary for integrity. No historical-record retention policy was approved by this reviewer, and no real user was deleted.

Deleting a Supabase identity does not delete the person's Google account. Issued JWTs can remain usable until expiry unless sensitive operations check current sessions/membership. Revoke sessions and prevent application operations before deleting the Auth user; do not assume a frontend sign-out invalidates every device. Use only the server-side managed admin API for Auth deletion, never a browser secret key or homemade credential cleanup.

## Observed baseline supplied by the release coordinator

Production had one Google identity, no password identities and no verified MFA factors. Application counts were 134 weekly picks, one contest player, 888 games, one saved preference row, zero bracket entries and zero support requests. No identifying email, user ID or private selection is reproduced here.

Database size was 12,457,651 bytes, with `max_connections = 60`. Existing relation totals include picks 81,920 bytes, players 49,152, games 352,256 and preferences 65,536. These small tables include allocation/index overhead; dividing 81,920 by 134 is not a sensible steady-state row-size estimate. Advisors reported seven INFO notices for intentionally RPC-only RLS tables without permissive client policies, plus the disabled leaked-password warning. Verify grants and RPC authorization rather than adding open policies to suppress those notices.

The coordinator reported the Render static service live on `7d096d4`, with automatic deployment and exact-main CI gating. The latest research commit was `c7301ff`. This report does not claim to have independently re-fetched provider dashboards or account identities.

## Measured storage and realistic growth assumptions

A new **loopback-only disposable PostgreSQL 18.6 database** loaded the retained baseline migrations and 1,000 synthetic players with 64 picks each. The 64,000 pick rows used 5,357,568 heap bytes plus 5,242,880 index bytes, 10,633,216 total: **166.144 bytes/pick** at that measured density. The temporary database was dropped. This is a physical row-storage probe, not a hosted concurrency test or new Auth benchmark.

The following assumes every listed user actively submits all 64 games in each of 15 weeks. It excludes managed Auth internals, new account/admin tables, WAL, backups, temporary work space and additional seasons. The allowance column adds 50% for density/growth variation; it does not guarantee a complete capacity budget.

| Fully participating users | Picks/week | Picks/season | Measured-density pick storage | With 50% allowance |
|---|---:|---:|---:|---:|
| 100 | 6,400 | 96,000 | 15.95 MB | 23.92 MB |
| 1,000 | 64,000 | 960,000 | 159.50 MB | 239.25 MB |
| 10,000 | 640,000 | 9,600,000 | 1.595 GB | 2.392 GB |

10,000 registered accounts with low contest participation are very different from 10,000 full-season participants. Registered-user count alone is not the limiting metric. The current 500 MB Free database cannot hold the latter scenario indefinitely while preserving history. Including additional FCS games increases pick-row volume. A 1,000-active-user first season may fit storage with headroom, but latency, Auth traffic, emails, egress and retained prior seasons still need measurement.

Reproduce using `PSQL_BIN` pointing to local `psql`, then `node research/measure-contest-storage.mjs`. The probe rejects non-loopback hosts, creates only its random `forge_capacity_*` database and drops that database in `finally`. It cannot accept a production database URL. [Measured evidence](account-capacity-storage-evidence-2026-11-18.json) records the baseline migration hashes and all assumptions.

Retained older synthetic mixed-load logs contain 10,000 save operations over 205.88 seconds (p95 21.724 ms including client scheduling lag) and 1,120 leaderboard reads over 219.73 seconds (p95 612.967 ms, last-quarter p95 907.583 ms). The source database was already removed. Those local logs do not retain a complete launch command, host profile or managed-Auth environment, so they are historical engineering evidence only. They are **not** a promise of 10,000 concurrent visitors on Supabase Free, nor proof of the new account code's performance. [Retained-log hashes](account-retained-load-evidence-2026-11-18.json)

The leaderboard returns at most 100 visible rows but computes eligible scores across the relevant picks before applying that limit. More participants therefore increase query work even when the response stays compact. Avoid polling it per second; the existing one-second client timer checks kickoff locks locally and does not itself make a leaderboard RPC every second. Cache public aggregates by publication/week where justified, preserve user-specific permissions, paginate admin user search, and avoid per-user result synchronization loops.

## Provider limits and cost controls

Supabase's current Free plan lists 50,000 monthly active users, 500 MB database, shared 500 MB RAM, 5 GB egress, 5 GB cached egress and 1 GB file storage. Its API-request allowance does not remove compute/egress limits. Pro begins at $25/month and includes an 8 GB database and seven-day daily backups. [Supabase pricing](https://supabase.com/pricing)

Nano Free's documented limit is 60 direct connections and 200 pooler clients, with default pool size 15. Browser users use Auth/PostgREST HTTPS rather than holding one direct PostgreSQL connection each. These numbers must not be advertised as a maximum of 60 or 200 site visitors. [Compute limits](https://supabase.com/docs/guides/platform/compute-and-disk)

Render's current Hobby workspace allowance is 5 GB monthly outbound bandwidth; static responses count. Workspace allowance/legacy plan must be verified against the actual account. Additional bandwidth can incur charges when a payment method exists, or suspend service until the next period when none exists. Keep billing alerts/cost limits and compressed cached assets; no upgrade was made. [Outbound bandwidth](https://render.com/docs/outbound-bandwidth), [static-site usage](https://render.com/docs/static-sites)

A simple traffic estimate: 1,000 users × 10 fresh visits/month × 0.5 MB transferred/visit is approximately 5 GB. At 10,000 users it becomes 50 GB under the same assumptions. Actual compression, browser caching, logos and navigation can change this substantially. This is an explicit planning model, not observed production bandwidth or a provider invoice estimate.

Public football pages should stay on the CDN. Store only account/contest/support state in Supabase, not duplicate the public rankings datasets per user. Continue existing scheduled sports pulls and source-cached forecasts; visitor count should not multiply CFBD calls. Track database size, pick count, query p95, egress, email sends and Auth 429s before promotion. Escalate before approximately 70–80% of a known hard allowance rather than waiting for lockout.

Free Supabase projects need owner-maintained exports; automatic downloadable daily backups are a paid-plan feature. Keep encrypted off-site application backups, tested restore commands and recovery access to managed Auth/provider configuration. Application-row exports alone are not a complete credential/Auth backup. Never restore an older preference export over newer legitimate user changes. [Backup documentation](https://supabase.com/docs/guides/platform/backups)

## Subscription readiness, with billing disabled

Recommend Stripe Checkout plus the hosted customer portal later, using a private customer/subscription mapping and server-verified entitlement state. Keep current premium entitlements dormant. No checkout button, payment collection, Stripe account activation, webhook endpoint or charge is required now.

For a U.S. domestic-card example, Stripe currently lists 2.9% + $0.30 for successful card payments, plus Billing pay-as-you-go at 0.7% of billing volume. A $5 monthly payment is approximately **$0.48** in those two fees, leaving **$4.52** before tax, refunds, disputes, international/currency fees or infrastructure. Actual country/account/product pricing must be approved before launch. [Stripe pricing](https://stripe.com/pricing)

Before activating billing, implement signature-verified raw-body webhooks, idempotent event processing, authoritative subscription re-fetch where necessary, cancellation/expiry/payment-failure/refund handling, and test-mode end-to-end tests. Client redirect success must never grant premium access. Account deletion with an active subscription needs an explicit cancellation/refund policy. Owner-approved manual entitlements need expiry/reason/audit history and must never grant administrator role. [Subscription events](https://docs.stripe.com/billing/subscriptions/webhooks), [webhook verification](https://docs.stripe.com/events/manage-webhook-endpoints)

## Historical and model integrity verification

The retained November 18 reconciliation contains 2025 AP 17 editions / CFP six, and 2026 AP 12 / CFP three at that source cutoff. All 950 retained team/rank pairs reconcile to the dated ledger. The 747 game/poll links use a conservative availability bound strictly before kickoff; pre-first-CFP, genuinely missing, confirmed unranked, uncertain-time and FCS-not-applicable states remain separate. Final AP is season-ending context and never retroactively assigned before its publication. [Historical poll report](historical-polls-2026-11-18.md)

The 2004–2025 repaired archives remain research-only where previously documented. They recover 674 FBS postseason games and remove eight duplicates; the separate FCS supplement adds 34 results and corrects three scores. The production historical prior was not silently replaced. Known residual gaps include spring-2020 tournaments, two New Mexico State spring results, Northeastern/Hofstra missing-program history and incomplete lower-division/season-membership certification. Distinguish checksum agreement and finite fixture checks from universal coverage proof. [Historical foundation report](historical-foundation-validation-2026-11-18.md)

The frozen cross-division probability coefficients remain `[2.329814851971762, 1.869996947261027]`. The first research observation has four forecasts saved before November 21 kickoff; the retained grading state is **zero graded, four pending, zero excluded**, with accuracy/Brier/log loss unavailable. Keep it separate from public saved picks. Retrospective winner accuracy equals always picking FBS, and all 34 historical FCS upsets were missed; no new accuracy claim or model promotion is justified. Dedicated FCS SOR candidates remain unpromoted. [Division research report](division-calibration-research-2026-11-18.md)

This reviewer independently ran 46 existing poll/history/conference/foundation regressions: all passed, zero failures/skips. They test chronology, historical classification, reference matching and missing-data behavior; they do not independently certify every historical source. [Regression log](account-historical-regression-2026-11-18.log)

## Independent implementation review

Reviewed the new private membership/entitlement/audit schema, public invoker wrappers, protected administrator provisioning, live administrator authorization and existing contest boundaries. Administrator access requires an active database-owned role, JWT `aal2`, matching nonexpired `auth.sessions` row with `aal2`, and a current verified TOTP factor. New-user membership ignores caller metadata. Admin user/support responses contain no passwords or picks, and admin mutations do not alter saved selections, ranking inputs or results. Ordinary accounts with enrolled TOTP also receive backend protection for their private account reads and writes; merely closing the challenge cannot expose them.

Three review findings were corrected before release review:

1. A notification worker crashing on its fifth lease could leave a request permanently marked processing. Expired final leases now become failed with an explicit `lease_exhausted` code; the SQL regression covers this case.
2. Re-signing in with the current password during a password change would downgrade a verified MFA session to `aal1`. The client now uses managed `updateUser({ password, current_password })` validation and preserves the existing session/user identity.
3. Closing the header MFA challenge could leave Account settings showing only a generic load failure. Account/admin views now check the second-factor requirement before private RPCs and offer a visible verification action.

This reviewer independently ran the foundation database harness: **13 migrations and 12 SQL suites passed** in a fresh disposable loopback database, with fixture rollback checks and database removal. The suites include ordinary/anonymous/admin permission denial, role-metadata forgery, expired/removed MFA context, suspension, entitlement expiry/revocation, future-pick boundaries, request ownership and notification leases. This proves those database contracts with synthetic JWT/session fixtures; it does not run the managed Auth server. [Independent foundation SQL log](account-independent-sql-check-2026-11-18.log). The later notification-requeue follow-up brings the current verified total to **14 migrations and 13 SQL suites**; the release report records that subsequent check separately.

Added `src/security-policy.js` and four passing Node tests. The static policy permits only first-party scripts and the exact existing integrity-pinned Supabase SDK URL, with no inline JavaScript or eval. It permits the known Supabase and ESPN API hosts, first-party workers/fonts, ESPN logos and data/blob images. Existing inline style attributes remain permitted for team colors and metric bars. Referrer metadata is `no-referrer`. The build/server coordinator must apply this module to actual generated pages and response headers where supported.

The isolated real-Chromium check also passed: inline script, inline event handlers, eval, an unapproved fetch host and an unapproved CDN script path were blocked; the approved SDK path, known API fetches, same-origin module worker and QR data image worked. The two mocked permitted API requests carried no Referer header. External responses were intercepted with synthetic bodies; this is a browser policy test, not a real SDK/Auth or production-network test. [CSP evidence](account-csp-browser-check-2026-11-18.json)

The reviewer also independently ran **35 focused account frontend, support-handler, dispatch and security-policy tests**, all passing with zero failures/skips. The support review verified bounded body-stream cancellation before private work, exact UUID leases and provider-specific receipt validation, private server-only credentials, verified-caller notification triggers, guest intake failing closed until CAPTCHA configuration, provider idempotency and allowlisted retry errors. Both provider contracts are tested; the selected Brevo path still awaits actual credentials/delivery verification. The guest client-IP rate-limit key still depends on trusted gateway-header behavior; verify that behavior before enabling public intake. A provider acceptance response is not proof of inbox delivery. [Focused code-test log](account-independent-code-tests-2026-11-18.log)

The coordinator confirmed live HSTS and `nosniff`, with CSP/referrer/framing headers absent at baseline. Meta CSP improves script/connect/base/object restrictions, but it cannot enforce `frame-ancestors` or `X-Frame-Options`. The module provides actual response-header values when the host can set them; do not claim production anti-framing was fixed by a meta tag. Verify hosting configuration separately. [Browser CSP framing documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)

## Remaining release evidence

Real managed-Auth registration/migration, mailbox receipt, admin provisioning, MFA browser flow against managed Auth, support notification delivery, advisor recheck and deployed permissions must be reported by their actual test outcomes. Do not reinterpret synthetic SQL, intercepted browser calls or SDK mocks as certification that those production flows passed. The coordinating release report should list gates that remain disabled and the owner information still needed. This reviewer has not sent email, created an admin, deleted an account, activated payment collection or modified a real user's preferences/picks.
