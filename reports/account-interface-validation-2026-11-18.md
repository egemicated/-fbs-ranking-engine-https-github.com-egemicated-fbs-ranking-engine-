# Account interface implementation and verification

Prepared November 18, 2026, Mountain Time. This report covers the frontend branch of the account project. Production Auth settings, database rollout, real email delivery and administrator provisioning are reported separately by the parent release.

## Implemented

- The shared header now opens a branded FBS Intelligence sign-in dialog and provides Account and Sign out controls when authenticated. The existing shared managed Supabase client, SDK version 2.119.0, integrity hash and PKCE flow are retained.
- Email/password sign-in is available only when `emailAuthEnabled` is explicitly true. Registration and recovery have separate explicit readiness gates, both default false. Their controls stay out of the production interface until verified email delivery is enabled. Google remains available and uses the original `/?myteam=1` redirect, preserving the configured transition path and remembered page.
- Registration, verification messaging/resend, password recovery and six-digit TOTP challenges use managed SDK methods. Verification resend has generic anti-enumeration messaging and a local one-minute retry cooldown; actual abuse limits remain the managed provider's responsibility. These email controls remain behind readiness gates. Auth callback cleanup removes codes, access/refresh tokens, token hashes and provider error details from navigation after SDK processing. Passwords never enter application RPCs, profile tables, logs or local application preference storage.
- Account settings use the canonical profile and saved-team system. Public nickname, leaderboard visibility and post-kickoff sharing are managed together. My Teams is a shortcut to the existing shared preference page rather than another favorite selector.
- An authenticated Google user can add a password using `auth.updateUser` while preserving the same user ID. The code checks the identity before and after. Existing-password validation uses the managed `current_password` attribute instead of creating a new sign-in session, which would downgrade an already verified MFA session. No migration path calls `signUp`.
- Password inputs require 12–64 characters and respect the managed bcrypt 72-byte limit. This is browser validation; provider enforcement must be verified separately in Auth configuration. All returned provider errors stay generic; only locally generated validation messages are shown directly.
- TOTP setup supports the SDK SVG data URL and raw SVG response as an image, never injected markup. Setup, verification, factor removal and session refresh use managed Auth. A verified TOTP user at `aal1` is prompted before private account RPCs; dismissing the header dialog leaves a working Verify authenticator action in Account settings. Removing a factor refreshes the session. Administrators cannot remove their last verified factor through this screen.
- Sign-out immediately removes rendered private account information. Async generation guards prevent late account responses from rendering after unmount or an identity change.
- Private support has category selection, request IDs and request history. Optional notifications invoke the existing Edge function only when its readiness flag is true; delivery failures never turn a saved request into an apparent unsaved submission. A configured public support email becomes a `mailto` contact for people who cannot sign in.
- Administration is a compact connected `#admin` page available from an administrator's Account settings. It checks the managed session, TOTP assurance and backend account role before loading user records, support requests or audit history. The database independently enforces every operation. The interface supports email/nickname search, suspension/reactivation, nickname moderation, request status/notes, notification status and action history. Notification delivery is labeled “Accepted by email provider,” without claiming inbox receipt. Retry controls only appear when delivery is configured.
- The administration interface has no passwords, future-pick reader, locked-pick editor, ranking override, role-grant control or result editor. Permanent account deletion is not represented by a fake action. Deletion requests cannot be marked resolved through this interface while the protected removal process remains disabled; review/close options explain what they do.

## Files

New shared modules: `frontend/account-auth.js`, `frontend/account-center.js`, `frontend/account-administration.js`, `frontend/account-support.js`, `frontend/account-center.css`.

Existing integration: `frontend/bracket-auth.js`, `frontend/app.js`, `frontend/index.html`, `frontend/platform-info.js`. The account and admin pages use their own compact title instead of adding a duplicate hero heading. Existing public page routes and historical links remain in place. No model/data publication code was changed by this branch.

New checks: `test/account-frontend.test.js`, `scripts/account-browser-quality.mjs`.

## Verification actually performed

- Fifteen focused Node tests passed with zero failures or skips. They cover readiness gates, password bounds, token cleanup, same-identity Google migration, MFA-preserving password updates, TOTP assurance, escaping, guest/user/admin UI authorization, stale-response guards, notification failures, deletion review limits and immediate private-data clearing on sign-out.
- A local static build passed with all then-current tests and produced 281 public pages for 138 FBS and 128 FCS teams. The parent subsequently produced the secured build with the shared CSP and its current larger test suite.
- The new account browser checks passed at widths **320, 390, 768 and 1440** against the secured local static build. They exercise profile changes, same-ID password setup, support/deletion review submission, TOTP enrollment/verification/removal, session refresh, signed-in header controls, Google redirect preservation, registration/recovery messaging, verification resend/cooldown, email sign-in, admin request updates and suspension UI. All inputs were labeled; no horizontal overflow or uncaught page error was found.
- The existing browser-quality suite passed **72 responsive routes**, along with duplicate-team matchup rejection, page labels, JSON/metadata, clean team URLs, scoreboard filters and the retained private-request UI.
- Desktop and narrow-mobile account screenshots were visually inspected. Local screenshots are under `../tmp/account-browser-preview/`; they use disposable test identities and are not production data.

The browser Auth and RPC flows use explicit disposable SDK/RPC doubles in a separate browser context. No test creates, edits or deletes a production identity, contest selection or user preference. The test output explicitly distinguishes these interactions from real provider delivery.

## Unverified or gated

- Real managed signup, verification email receipt, reset email receipt and final password recovery require a deliverable SMTP configuration and an isolated disposable identity. They remain gated off in production until verified.
- A real Google-to-password handshake, TOTP enrollment/challenge and cross-device login with a disposable managed user were not completed by this frontend branch. Mock behavior and backend SQL authorization do not prove those external provider journeys.
- The provider-side minimum password configuration and callback allowlist must be verified before enabling new email flows. The original Google callback stays intact.
- Public support email, notification delivery and administrator provisioning depend on the owner's secure configuration. The interface does not invent an administrator, credentials or a contact address.
- Permanent Auth deletion and the historical contest-record retention policy remain separately protected owner decisions. Submitting or closing a review request does not pretend to erase the identity or its locked picks.

Relevant managed-Auth references checked during implementation: [password authentication](https://supabase.com/docs/guides/auth/passwords), [password security and current-password validation](https://supabase.com/docs/guides/auth/password-security), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), and [TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp).
