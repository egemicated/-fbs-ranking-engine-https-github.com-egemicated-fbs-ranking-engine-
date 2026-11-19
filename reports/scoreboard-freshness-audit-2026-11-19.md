# Score freshness and result-publication audit

## Confirmed state

At the November 19 public-source check, the ESPN default and explicit 2026 Week 12 feeds returned Akron 34–Massachusetts 33 (`401866467`) and Buffalo 40–Central Michigan 21 (`401866469`) as final. Both university boxscores independently confirmed those scores: [Akron](https://gozips.com/sports/football/stats/2026/umass/boxscore/11333), [Central Michigan](https://cmuchippewas.com/sports/football/stats/2026/buffalo/boxscore/11278). Direct public HTTPS reads succeeded; the web-reader extraction was unavailable. The public site's weekly picks and ranking JSON were still the November 18 publication, with both games scheduled. The original saved pregame capture times/probabilities were present and were not changed.

The current ESPN response cannot establish what its endpoint returned during the prior evening's review. Its ordinary response had a one-second cache lifetime, so browser caching alone has not been proven to explain that incident. The endpoint does not supply a reliable source-update timestamp, and its CORS policy does not expose the HTTP Date header. An HTTP Date would represent a response, not the underlying game's update time in any case.

## Confirmed defects and repairs

| Issue | Cause | Correction |
|---|---|---|
| A recent “Last checked” could imply all scores were fresh | It represented successful response receipt only | Label the last successful ESPN response precisely; disclose missing provider-update time and show attempts, locally observed changes, publication cutoffs and feed coverage separately |
| Scheduled games could remain unexplained past kickoff | There was no status-delay warning | Warn when a confirmed-time game remains scheduled more than 15 minutes past kickoff; leave TBD/future kickoffs out of this warning |
| Previously observed finals could regress or disappear | New responses replaced old slate state, and only one empty-slate branch was guarded | Retain a same-event/same-team/same-kickoff confirmed final if a subsequent response regresses to scheduled/live; accept explicit final-score corrections and reschedules; reject temporarily empty responses for the same known slate |
| Final with missing scores looked completed | Status alone determined the section | Display it as a schedule/data change with “Final score not reported,” without fabricating zero scores |
| Saved prediction links often opened only the general page | Saved game data loaded only after selecting the Close Matchups filter | Load the cached saved-game publication when the feed first loads, generate the existing week/game deep link, and label entries without a saved pick “Weekly picks” |
| Team links could lag behind loading the team directory | External updateRankings refreshed only rank cells | Re-render stable cards when published team data becomes available, preserving ordering/filter state |
| Scenario fixtures could look like confirmed future games | “Remaining” referred to the dated frozen snapshot | Explicitly label the list non-live, identify its published cutoff and link to the Live Scoreboard; all scenario mathematics and saved inputs remain untouched |

Live response receipt does not grade saved picks or write contest results. Weekly Picks, rankings and contest grading must use their documented publication/sync paths. An absent or delayed scheduled ingestion is a separate operational issue for the parent release, not solved by pretending the live response updates that publication.

## Verification and limits

Seven focused Node regressions cover status classification, postponed/incomplete/tied results, stale final regression, explicit corrections/reschedules, temporary emptiness, uncached requests, response receipt versus source timestamps, invalid/duplicate events, order-independent change detection, missing kickoff confirmation, and Mountain standard/daylight time. The dedicated `scripts/scoreboard-browser-quality.mjs` passed at 320, 375, 390, 768, 1024 and 1440 pixels using actual local application components and published game data with explicit ESPN transport fixtures. It exercised delayed-status warnings, eager saved links, final transitions, stale/empty/error preservation, accurate receipt labels, real game deep links and overflow checks.

No production account, pick, forecast, game result or source file was mutated for these checks. No CFBD call, paid service, credential or schedule change was introduced. The browser fixtures are not claimed as live-provider interaction. Deployment and scheduled-ingestion verification remain with the parent release coordinator.
