# Compact account directory and followed-team carousel

The administrator directory now uses compact expandable rows and ten accounts per page. Previous/Next controls and a bounded set of numbered buttons are calculated from the backend's matching-account count, including first/last pages. Search runs across the directory and resets to page one. Existing protected `admin_users` limit/offset arguments provide pagination; the client does not download all accounts. This bounds the interface at large totals; it is not a 50,000-account hosted capacity certification.

Signed-in visitors following multiple available teams can cycle through the Home My Team card with triangle arrows, keyboard arrows or horizontal touch gestures. Navigation wraps in both directions, has no autoplay, respects reduced motion, and does not change the primary favorite or write preferences. The primary team's existing update badge remains attached to its own seen marker. A single-team account retains the simpler card. Team extras are cleaned up between cards so late results cannot overwrite the selected team.

No database migration, authentication/permission change, dependency, paid service, CFBD pull, ranking-math change or publication-schedule change was introduced.

Local verification passed 450 Node tests, the 72-route browser gate, the account/MFA/support/callback browser regressions, and the security-policy browser check. The 23-user directory fixture verifies pages of 10/10/3, offsets 0/10/20, search reset, disabled boundaries and expandable rows at 320/390/768/1440 pixels. The dedicated carousel check uses the real local Home page and published team data with a disposable account adapter. It verifies circular navigation, keyboard/touch behavior, vertical-scroll preservation, 44-pixel arrow targets, reduced motion, no horizontal overflow, zero preference writes, sign-out clearing and stale asynchronous-result protection. It now runs in the existing GitHub release gate.

Production deployment verification is recorded after the exact-commit GitHub checks and Render rollout complete. Existing accounts and saved picks are not modified for these interface checks.
