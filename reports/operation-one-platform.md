# Operation One Platform

Open the [private preview](http://127.0.0.1:4318/) on Bryan’s computer. The sport switcher opens the equivalent section when available. The existing preview account remains the place to try local picks and bracket drafts.

## Presentation contract

| Shared element | Implementation |
| --- | --- |
| Shell and footer | A full-height, flex-column document gives short pages a bottom-aligned footer and lets long pages scroll naturally. Both sports reuse the existing GD masthead, menu destinations, and footer. |
| Page header | One sport-aware renderer supplies the same layout, type, spacing, and metadata slots. Home uses the cinematic split hero. Interior pages use a more compact header. Matchup Lab and playoff tools use the tool variant. Football retains its stadium, and basketball retains its arena. |
| Content and typography | The shared CSS sets the 1,456 px content width, responsive gutters, panel spacing, grid gaps, heading sizes, data values, supporting text, and table labels. |
| Panels and controls | Panel borders, padding, action styles, input heights, focus states, score badges, and empty states share the same tokens. The controls retain the same URLs and labels for assistive navigation. |
| Team discovery | Rank and Alphabetical ordering, immediate school/mascot search and conference filtering, color wedges, and a one-column narrow-phone layout. Football retains FBS and FCS. Basketball retains seasonal browsing and progressive Show More. |
| Conference reports | A common section-navigation style, responsive record markup, and sort conventions. Desktop tables retain their sortable headers. Narrow layouts show every column’s value in labeled cards with a mobile sort selector. The separate head-to-head matrix remains horizontally browsable. |
| In-place updates | Basketball uses its existing rendered data for ranking models, directory filters, date controls, ranking history, and Conference Strength. Matchup Lab keeps the active comparison, focus, and scroll position. Football still compares immediately and now restores earlier matchups with Back and Forward. |

The principal shared files are [platform-presentation.js](../frontend/platform-presentation.js), [platform-ui.css](../frontend/platform-ui.css), [team-discovery.css](../frontend/team-discovery.css), [conference-display.js](../frontend/conference-display.js), [conference-display.css](../frontend/conference-display.css), and [matchup-presentation.css](../frontend/matchup-presentation.css).

## Rendered comparisons

| Page | Desktop | Phone |
| --- | --- | --- |
| Home | [1440 px](<../../tmp/gd-one-platform/pairs/home-1440.png>) | [390 px](<../../tmp/gd-one-platform/pairs/home-390.png>) |
| Rankings | [1440 px](<../../tmp/gd-one-platform/pairs/rankings-1440.png>) | [390 px](<../../tmp/gd-one-platform/pairs/rankings-390.png>) |
| Teams | [1440 px](<../../tmp/gd-one-platform/pairs/teams-1440.png>) | [390 px](<../../tmp/gd-one-platform/pairs/teams-390.png>) |
| Scoreboard | [1440 px](<../../tmp/gd-one-platform/pairs/scoreboard-1440.png>) | [390 px](<../../tmp/gd-one-platform/pairs/scoreboard-390.png>) |
| Matchup Lab | [1440 px](<../../tmp/gd-one-platform/pairs/matchup-1440.png>) | [390 px](<../../tmp/gd-one-platform/pairs/matchup-390.png>) |
| Conference Strength | [1440 px](<../../tmp/gd-one-platform/pairs/conferences-1440.png>) | [390 px](<../../tmp/gd-one-platform/pairs/conferences-390.png>) |
| Model Report Card | [1440 px](<../../tmp/gd-one-platform/pairs/reports-1440.png>) | [390 px](<../../tmp/gd-one-platform/pairs/reports-390.png>) |

- Footer evidence includes the [unavailable football scoreboard](<../../tmp/gd-one-platform/footer/footer-football-scoreboard-1440.png>), [empty mobile team search](<../../tmp/gd-one-platform/footer/footer-empty-search-390.png>), and the bottom of a [long basketball homepage](<../../tmp/gd-one-platform/footer/footer-basketball-home-long-1440.png>).
- Narrow 320 px examples show [Wildcats](<../../tmp/gd-one-platform/discovery/basketball-wildcats-320.png>), [Mountaineers](<../../tmp/gd-one-platform/discovery/football-mountaineers-320.png>), and [Razorbacks](<../../tmp/gd-one-platform/discovery/basketball-razorbacks-320.png>) without mascot words splitting.
- For bracket detail, compare [region before](<../../tmp/gd-one-platform/conference-bracket/bracket-region-before.png>) and [after](<../../tmp/gd-one-platform/conference-bracket/bracket-region-after.png>), plus [Final Four before](<../../tmp/gd-one-platform/conference-bracket/bracket-national-before.png>) and [after](<../../tmp/gd-one-platform/conference-bracket/bracket-national-after.png>).

## Performance and geometry

At 1440 px, the two home heroes measured 459 and 501 px before. Both now measure 466 px. The two directory heroes measured 155 and 183 px before. Both now measure 178 px. The shared components reuse existing art and add no runtime dependencies.

The sampled 1440 px homepages loaded about 16 KiB more uncompressed CSS each. Football home JavaScript rose from 253.4 to 258.5 KiB and basketball from 10.6 to 14.4 KiB. Basketball Matchup Lab loads its additional interaction script only on that route. Warm directory searches took a median 9 ms in football and 166 ms in basketball in local Chromium, including basketball’s 140 ms typing debounce. Timing varies with local activity. [Paired browser measurements](<../../tmp/gd-one-platform/performance-paired.json>)

The bracket baseline measured roughly 6 px regional labels and 5 px Final Four labels at 1440 px. Region jumps now render 12 px labels at 1024, 1440, and 1920 px. Final Four labels measured roughly 13–15 px, with all three national games in view.

## Verification

- The full Node suite passed 535 tests. The integrated preview passed 450 rendered route-and-width checks, and the football browser gate passed 189 responsive route checks.
- The layout suite verified the seven paired page families and eleven short and long footer states at 320, 360, 390, 768, 1024, 1440, and 1920 px. It checked scoreboard date history, keyboard focus after date changes, and a directory at simulated 125% layout zoom.
- The dedicated Matchup Lab browser suite verified team and venue changes, scroll position, direct links, Back/Forward, reduced motion, and retained basketball comparison results after a simulated request failure at four widths.
- The paired directory suite verified immediate search and filtering, both sort orders, progressive basketball loading, state restoration, and mascot line geometry at seven widths.
- Conference checks exercised both sort directions, mobile cards, scope changes, correct row associations, and in-place head-to-head comparisons. Bracket checks covered zoom, pan, Fit Entire Bracket, fullscreen, Final Four jumps, and practice-pick advancement and invalidation.

## Route audit

| Page family | Review focus |
| --- | --- |
| Portal and sport homepages | One masthead, both sport destinations, matching sport hero geometry, SOR leaders, and footer. |
| Rankings, polls, Forge, and history | Direct and legacy navigation, consistent rank typography, model tabs, filter state, and the existing comparison and research destinations. |
| Teams, profiles, and SOR Compare | Search, conference and order controls, long mascot names, rank and record displays, and links into team evidence. |
| Scoreboards, Weekly/Daily Picks, and reports | Aligned headings, dates, badges and empty states. Football keeps its ESPN live-score and refresh behavior. Basketball labels its schedules and results as provider-published. |
| Conference Strength and matchup comparisons | Dedicated Conference Strength identity, consistent tool controls, numeric sorting, source records and links, and scroll-stable results. |
| CFP and March Madness | Shared typography where practical. March Madness retains the compact interactive workspace, with readable region and Final Four jumps. |
| Contest, account, support, methodology, and information pages | Main content and footer follow the shared shell without changing authentication, saved data, or explanatory evidence. |

## Intentional differences

Football’s Matchup Lab retains its established immediate response to team and venue changes. Basketball retains its Compare action and preserves its current form and working result if the new comparison fails. Changing the basketball season loads that season’s page so the header publication context stays accurate.

The March Madness shortcuts prioritize readable team labels. A region may require panning to see every game at that scale. Fit Entire Bracket still displays the whole tournament. The Final Four shortcut frames all three national games at a readable scale on tested desktop widths.

Football’s blocked-feed state was tested using local browser isolation. Basketball supplied its cached publications throughout. Physical-device touch, pinch interactions, and a separate Safari or Firefox pass are outside this verification.

## Production boundaries

This work runs in the private preview. The build uses existing local publications and practice accounts. The branch preserves the ranking and prediction engines, public historical and score inputs, saved forecasts, contest records, database and authentication rules, refresh schedules, and provider budgets. No data-provider calls or public deployment were used for this assignment.
