# Private support workflow and administrator clarity

Status: implemented and tested locally; the additive backend migration is installed in production. Frontend release and real-browser production verification are recorded by the release coordinator. No existing user, request, pick, credential, MFA setting or paid service was changed by the migration.

| Confirmed issue | Cause and correction | Verification |
|---|---|---|
| Users could see request status but no administrator response | Added private, append-only administrator responses and owner-scoped history. Responses are separate from internal review notes. | SQL owner/other-user/admin/anonymous boundaries, browser response display, escaped-content Node check. |
| Two support forms differed | Account and Support now reuse one category list, request form, submission validation, status history and response rendering. | Both components use identical categories; six-width browser checks exercise them. |
| A second question in an already-open category silently disappeared | The existing deduplication path now reports `alreadyOpen`; both forms retain the unsent draft, identify the existing request and do not send another email alert. | SQL preserves the original text/ID and creates only one notification; both browser forms keep their draft and do not invoke duplicate notifications. |
| Deletion acknowledgement appeared for ordinary questions and was absent on the other form | Hidden/disabled for normal categories; revealed and required for deletion-review requests only. | Submission tests and browser change/reset checks. Actual deletion remains disabled. |
| Pending count could look like the count of all requests | The title identifies its selected status; all four status totals appear separately. | SQL totals and browser/Node display tests. |
| Global email processing remained actionable without due work | Backend returns due and failed counts; the bulk action is disabled when nothing is due or coverage is unavailable. Failed messages still require individual reasoned review. | SQL counts, disabled-state unit check, existing requeue regressions. |
| Technical audit labels obscured completed changes | Named action types, actor/target labels, status transitions, dates and an explicit completed-action scope. Stored audit entries remain append-only. | SQL projection and Node escaping/label checks. |
| Search displayed zero-to-zero ranges and unnecessary pagination | Empty results use a plain statement; pagination is omitted when there is only one page. Routine refresh keeps the established view while repeating full backend authorization. Auth changes still clear private content immediately. | Empty/search/page browser checks; existing guest/user/MFA/stale-view regressions. |
| Authenticator names exposed raw generated timestamps | Generated names are displayed as readable Mountain Time dates while custom labels remain intact. | Node date/custom-label checks. |

## Data and permission design

The additive migration was generated with the CLI, then aligned with its hosted record as `20261119140050_support_responses_and_review.sql`. `support_private.request_responses` has RLS enabled, no direct client/service-role table grants and append-only protection. The public reply wrapper is an invoker; its private implementation calls the existing live-session/MFA administrator guard. A client-generated UUID makes a retry of the same response idempotent. Reusing that UUID with changed content is rejected.

Request history is scoped to the authenticated owner and retains optional-MFA enforcement. It includes that owner's original question, response body and action-requested flag, but never the administrator's internal note, author identifier, other users' requests or contest selections. Original details are escaped and expandable. A suspended owner can read their private support with the required authenticator; an enrolled owner at AAL1 is denied. The response path does not put private text into notification mail. Responses currently appear in-app; no new user-response email sender or provider credential was introduced.

Response records cannot be edited or deleted through the interface. Permanent account removal still needs an approved contest/support retention policy and a deliberate protected procedure; this migration does not implement or authorize it.

## Tests actually run

- **29 focused Node tests passed** for account/support/admin behavior.
- **15 migrations and all 14 SQL suites passed** against a randomly named disposable database on task-owned loopback PostgreSQL 18. Fixtures rolled back and the disposable database was removed. The existing PostgreSQL server was left running.
- **Account browser checks passed at 320, 375, 390, 768, 1024 and 1440 pixels**, including shared support categories, conditional deletion acknowledgement, private response display, administrator reply submission, status counts, user pagination/no-match states, expanded cards, labels and overflow checks.
- **Seven existing callback browser regressions passed.**

The browser provider/RPC boundaries are explicit disposable doubles. SQL tests use synthetic identity/session claims against the actual migration functions. These checks do not claim hosted email delivery, a genuine Google OAuth migration, or a production private-response interaction.

## Administrator authenticator continuity

The existing account screen already lets the owner add and verify another authenticator and prevents removal of the last verified administrator factor. The recommended owner-controlled preparation is to enroll a second independently accessible authenticator, verify it, and test it before relying on it. Keep the current verified factor until that test succeeds. Do not publish or send QR images, setup secrets or six-digit codes.

If all verified factors are lost, stop at the protected owner recovery process: verify control through the existing Supabase project owner, review the recorded administrator identity and obtain explicit authorization for any credential/factor change. A password reset must not be advertised as bypassing administrator MFA. No backdoor or automatic administrative re-provisioning was created.
