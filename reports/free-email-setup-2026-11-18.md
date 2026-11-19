# Free email pilot using Brevo without an owned domain

Reviewed November 18, 2026, Mountain Time. **Latest owner direction: do not use the daughter's babysitting domain or any other family website's domain for FBS Intelligence.** Bryan selected a separate Brevo Free account for a no-owned-domain pilot and designated `fbsintel@yahoo.com` for administration/support. This supersedes the earlier Resend-reuse proposal. No domain purchase, provider upgrade or expense is authorized. This reviewer has not configured SMTP, created credentials or sent mail.

## Recommended path and remaining evidence

Evaluate **Brevo Free**, which documents transactional SMTP/API access, 300 messages/day and no credit card requirement. Verify Yahoo as an individual sender; use display name **FBS Intelligence** and Yahoo Reply-To where configurable. The account still needs transactional-sending approval and real delivery tests. This is a conditional small pilot, not a guaranteed production email service. [Brevo transactional email](https://www.brevo.com/products/transactional-email/), [Free-plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)

Yahoo is a free mailbox domain that we cannot authenticate. Brevo documents temporarily rewriting these From addresses to a provider-controlled domain; its transactional example ends in `t-sender-sib.com`. Recipients may see that address even though the display name remains FBS Intelligence. Free-plan branding may appear. Inspect actual received mail and retain Yahoo Reply-To. Brevo describes this as a stopgap, not a permanent replacement for an authenticated owned domain. [Sender requirements and replacement addresses](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)

The 300/day allowance is shared by authentication SMTP and API support alerts within the new account. Unused daily quota does not roll over. Do not enable paid add-ons, submit a payment card, or promise that thousands of registrations can verify together. If transactional approval requires owned DNS or the fallback cannot pass delivery tests, stop and retain Google; do not buy a domain or borrow the daughter's.

The Render address `fbs-intelligence.onrender.com` is our website URL, not an owned sending domain. We cannot install Resend's ownership-verification DNS records on Render's parent domain. No production email setup should claim otherwise.

Supabase's built-in mail is organization-team-only, two messages/hour, without a delivery SLA; it remains unsuitable for public launch. [Supabase SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp)

## Private provider setup

1. Create/sign into the separate **Brevo Free** account. No card or upgrade is needed for the documented free offering.
2. In **Settings → Senders, Domains & IPs → Senders**, add **FBS Intelligence**, `fbsintel@yahoo.com`, and complete the verification code sent to Yahoo. This proves control of the mailbox, not ownership of `yahoo.com`. [Create a sender](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email)
3. Confirm **Transactional** sending is active. New accounts can require review; SMTP 450 can indicate that activation is still pending. Provide accurate information about verification, password-recovery and support mail if Brevo requests it. [SMTP activation troubleshooting](https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP)
4. In **SMTP & API → SMTP**, obtain the exact **SMTP login** and create a dedicated **SMTP key**. The technical login is not necessarily Yahoo. The SMTP key is separate from an API key; enter secrets only in private settings, never chat/source/public JSON. [SMTP configuration](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP), [SMTP keys](https://help.brevo.com/hc/en-us/articles/7959631848850-Create-and-manage-your-SMTP-keys)
5. Disable authentication-link tracking where supported and verify the actual received action link remains intact. [Auth email guidance](https://supabase.com/docs/guides/auth/auth-smtp)

## Supabase Auth configuration

Use existing project **egxyfyorggwnrnmirrax**: [Auth SMTP settings](https://supabase.com/dashboard/project/egxyfyorggwnrnmirrax/auth/smtp), under **Authentication → Email → SMTP Settings**. [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

| Setting | Value |
|---|---|
| Custom SMTP | Enabled for the controlled delivery test/approved rollout |
| Sender email | `fbsintel@yahoo.com`, after individual sender verification in Brevo |
| Sender name | `FBS Intelligence` |
| Host | `smtp-relay.brevo.com` |
| Port | `465`, encrypted SSL/TLS |
| Username | Exact SMTP login from Brevo's SMTP tab |
| Password | Dedicated Brevo SMTP key, not its API key |
| Minimum interval between messages | At least 60 seconds per address |

Do not enter the Yahoo password or a Supabase service-role key. Keep encryption and certificate validation enabled.

Supabase's basic SMTP form does not itself establish a custom Reply-To header. The support API worker explicitly supplies Yahoo Reply-To. For Auth mail, include the Yahoo support contact in the branded template and inspect the actual headers; do not claim Reply-To is configured unless a supported provider setting was saved and tested.

In **Authentication → Sign In / Providers → Email**:

- Require email confirmation: `mailer_autoconfirm: false`.
- Enforce a managed password minimum of **12 characters**, in addition to our form's validation.
- Set email OTP expiration to **3,600 seconds or less**, which also governs confirmation/recovery links.
- Keep Google available throughout migration.

These are managed Auth requirements, not merely frontend flags. [Password security](https://supabase.com/docs/guides/auth/password-security), [email-link expiry](https://supabase.com/docs/guides/auth/auth-email-passwordless)

Start Auth throttles conservatively, around **10 messages/hour** or lower. That can consume 240/day, leaving only 60 of the free 300 for support, resends and tests. This is a planning budget, not an enforced daily reservation. Monitor combined SMTP/API traffic and handle 429s; never auto-upgrade or buy quota. Do not assume the default 30/hour fits a 300/day provider allowance. [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)

Set **Site URL** to `https://fbs-intelligence.onrender.com`. Preserve Google's callback and add the exact email URLs generated by `frontend/account-auth.js`, verifying dashboard matching:

```text
https://fbs-intelligence.onrender.com/?myteam=1
https://fbs-intelligence.onrender.com/?account=signin#account
https://fbs-intelligence.onrender.com/?account=verification#account
https://fbs-intelligence.onrender.com/?account=recovery#account
```

Avoid unrestricted external redirect wildcards. Preserve managed action-link template variables and verify real emailed redirects. The client uses PKCE and cleans callback credentials after processing. [Redirects](https://supabase.com/docs/guides/auth/redirect-urls), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates)

## Support notifications

The server-side worker uses the separate Brevo API credential. Create a dedicated API key only when notification rollout is ready; this does not replace the SMTP key. Set only Edge Function private secrets:

| Private setting | Value |
|---|---|
| `SUPPORT_EMAIL_PROVIDER` | `brevo` |
| `BREVO_API_KEY` | Private Brevo API key |
| `SUPPORT_ADMIN_EMAIL` | `fbsintel@yahoo.com` |
| `SUPPORT_FROM` | Individually verified sender `fbsintel@yahoo.com` |
| `SITE_URL` | `https://fbs-intelligence.onrender.com` |
| `SUPPORT_DISPATCH_SECRET` | Independently generated private secret, at least 32 characters |

The Supabase service credential remains server-side/platform-managed. Provider acceptance is not inbox delivery. Alerts contain request ID/category/time and an admin link; private message bodies and picks stay out of email. The durable queue preserves failures for protected retries.

The worker calls `POST https://api.brevo.com/v3/smtp/email` with an `api-key` HTTP header. A provider `messageId` is an opaque string. Its JSON `headers.idempotencyKey` must be a UUID; the current 30-minute deduplication window does not prevent all duplicates after delayed retries. [Transactional API](https://developers.brevo.com/reference/send-transac-email), [idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails)

## Tests required before public activation

1. Use disposable identities in a controlled test path. Verify actual mailbox receipt, rejection of unverified password login, and verification of the intended identity.
2. Test recovery, expired/reused links, wrong-account handling, resend cooldown and throttling. Unknown-account responses must not disclose registration status.
3. Verify mobile email-app and desktop returns. PKCE may require the initiating browser; record any observed cross-browser limitation.
4. Inspect real From, Reply-To, branding and links. Check Yahoo plus another common mailbox, including spam. Provider acceptance alone is insufficient.
5. For a disposable Google account, retain UID/saved-row hashes, add a password while authenticated, sign out and use it, then verify the same UID/teams/picks. Keep Google linked; do not migrate through sign-up or duplicates. [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
6. Submit disposable support; verify durable ID, minimal notification, protected admin access and honest provider status. No private body/pick may be present in email.
7. Confirm this setup uses only the new Brevo account and verified Yahoo sender. The daughter's domain, other website's credentials/DNS and existing Resend account must remain untouched.

Only after actual delivery and identity tests pass should backend email registration and frontend registration/recovery flags activate together. Frontend hiding alone is not a backend policy. Until then keep registration/recovery gated and Google available. Provision the designated admin only through the protected backend after confirmed identity and verified TOTP, never by email alone.

## Inactive alternatives and limits

Resend is **inactive for FBS production mail**. Its test sender is limited to the Resend account owner's recipient until an authorized sending domain is verified. Using the daughter's domain is forbidden; `onrender.com` DNS is not ours to verify. An owned FBS domain could be reconsidered only with Bryan's later approval, including any purchase cost. [Resend SMTP prerequisites](https://resend.com/docs/send-with-supabase-smtp), [testing-domain restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)

No upgrade/charge is authorized. If Brevo refuses no-domain sending, its temporary fallback changes, or delivery tests fail, preserve working Google login/Yahoo contact and report the specific blocker. Do not buy a domain or change any other website. No real mail tests or provider configuration were performed by this reviewer. Public registration/recovery remain gated until actual verification/recovery delivery and identity tests pass.
