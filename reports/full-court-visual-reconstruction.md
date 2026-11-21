# Operation Full Court visual review

Open the [private preview](http://127.0.0.1:4318/) on Bryan’s computer. Football still opens at `/football/` in preview. The review build listens on the local computer and is excluded from indexing.

## What changed

| Area | Changes |
| --- | --- |
| Shared navigation | One GD masthead and footer across the portal and both sports. The sport switcher opens the equivalent section when available. Football and basketball share grouped rankings, conferences, predictions, research, and postseason links. Mobile groups expand on tap. Search uses both cached team directories. Publication information is available from the account menu. |
| Universal home | Matched stadium and arena cards give both sports equal prominence. Each features its own season, current Strength of Record leader, record, and ranking link. |
| Football home | The existing stadium, ranking summary, team colors, Top 25, and feature links carry through. The preview removes the duplicate header and gives the desktop headline more room. |
| Basketball home | The arena hero and Top Five lead into a saved forecast, compact scores and upcoming games, three ranking leaders, a saved-pick report summary, conference records, and the tournament. The header search replaces the duplicate search panel. |
| Basketball rankings | Top 25 by default. Direct SOR, Predictive Strength, and Experimental Performance links preserve the selected filters. The complete rankings, conference selection, and team search stay accessible. Team names, mascots, rank, record, and school-color accents share a consistent hierarchy. |
| Basketball team browser | Search and conference filters update the directory in place. Alphabet jumps and a Show More control reveal longer lists progressively. Cards link to the existing season-specific team profiles. |
| Conference Strength | Overview, Head-to-Head, Team Strength, and Trends have shareable URLs. Six columns sort in either direction. Matrix cells link to the actual game list, with reciprocal records verified. The heat scale retains W–L text. The coverage and sample notes identify the limits of the quality estimates. |
| Scores and picks | Responsive cards distinguish scheduled, final, and awaiting-final games. Winner indicators, venue and tipoff labels, saved forecasts, available team box scores, and Matchup Lab links carry through. |
| March Madness | Desktop opens the full connected bracket. Visitors can zoom around the pointer, drag to pan, jump to regions or the Final Four, fit or reset the view, and use fullscreen. The touch-first layout retains region and round controls. The current view opens on the labeled GD projection while the official field is pending. Official, archive, and practice fields remain available. |

## Visual evidence

| View | Before | After |
| --- | --- | --- |
| Universal homepage | [Desktop](<../../tmp/gd-visual/before/sports-home-1440.png>) · [Mobile](<../../tmp/gd-visual/before/sports-home-390.png>) | [Desktop](<../../tmp/gd-visual/after/sports-home-1440.png>) · [Mobile](<../../tmp/gd-visual/after/sports-home-390.png>) |
| Football homepage | [Desktop](<../../tmp/gd-visual/before/football-home-1440.png>) | [Desktop](<../../tmp/gd-visual/after/football-home-1440.png>) · [Mobile](<../../tmp/gd-visual/after/football-home-390.png>) |
| Basketball homepage | [Desktop](<../../tmp/gd-visual/before/basketball-home-1440.png>) · [Mobile](<../../tmp/gd-visual/before/basketball-home-390.png>) | [Desktop](<../../tmp/gd-visual/after/basketball-home-1440.png>) · [Mobile](<../../tmp/gd-visual/after/basketball-home-390.png>) |
| Rankings | [Basketball desktop](<../../tmp/gd-visual/before/rankings-1440.png>) | [Football](<../../tmp/gd-visual/after/football-rankings-1440.png>) · [Basketball](<../../tmp/gd-visual/after/rankings-1440.png>) · [Mobile](<../../tmp/gd-visual/after/rankings-390.png>) |
| Basketball directory and team profile | [Directory](<../../tmp/gd-visual/before/teams-1440.png>) | [Directory](<../../tmp/gd-visual/after/teams-1440.png>) · [Mobile directory](<../../tmp/gd-visual/after/teams-390.png>) · [Team profile](<../../tmp/gd-visual/after/team-profile-1440.png>) |
| Conferences and scoreboard | [Conferences](<../../tmp/gd-visual/before/conferences-1440.png>) | [Conference desktop](<../../tmp/gd-visual/after/conferences-1440.png>) · [Mobile game cards](<../../tmp/gd-visual/after/scoreboard-390.png>) |
| Header, menu, and footer | [Football desktop](<../../tmp/gd-visual/before/football-home-1440.png>) | [Desktop header](<../../tmp/gd-visual/after/football-header-1440.png>) · [Mobile header](<../../tmp/gd-visual/after/basketball-header-390.png>) · [Desktop menu](<../../tmp/full-court-navigation/mega-menu-desktop.png>) · [Mobile menu](<../../tmp/full-court-navigation/basketball-mobile-menu.png>) · [Football footer](<../../tmp/gd-visual/after/football-footer-1440.png>) · [Basketball footer](<../../tmp/gd-visual/after/basketball-footer-1440.png>) |
| March Madness | [Previous desktop layout](<../../tmp/gd-full-court/visual-bracket/preview-before-1440.png>) | [Full bracket](<../../tmp/gd-full-court/visual-bracket/preview-projection-1440.png>) · [Region zoomed](<../../tmp/gd-full-court/visual-bracket/preview-zoomed-1440.png>) · [Fullscreen](<../../tmp/gd-full-court/visual-bracket/preview-fullscreen-1440.png>) · [Mobile](<../../tmp/gd-full-court/visual-bracket/preview-mobile-390.png>) |

## Implementation

The preview reuses the existing football build, football routes, basketball snapshots, accounts, and bracket engine. The shared masthead and footer live in `basketball/preview-ui.mjs`. The preview server integrates them with the football application at response time, so production football templates and scripts remain untouched. The portal and basketball views live in `basketball/preview-views.mjs`. Page and component styles use CSS, and bracket zoom and pan use the existing JavaScript application.

The indoor arena is an original generated image of a generic basketball venue. It contains no university marks and is stored in optimized 1536-pixel and 752-pixel WebP variants at 78,666 and 27,722 bytes. Two masthead crops together use 22,050 bytes. The site reuses the existing football stadium and GD logo.

## Performance

The table compares local Chromium loads from the old preview and the redesigned preview. Sizes are browser-reported KiB for the named resource types. These measurements are from a loopback server, so public network timings would differ.

| View | Width | Requests | CSS | JavaScript | Images | DOM ready |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Portal | 390 px | 7 → 15 | 55 → 73 | <1 → 8 | 252 → 232 | 27 → 33 ms |
| Portal | 1440 px | 7 → 15 | 55 → 73 | <1 → 8 | 252 → 359 | 21 → 28 ms |
| Football home | 390 px | 48 → 50 | 154 → 162 | 270 → 253 | 183 → 205 | 94 → 71 ms |
| Football home | 1440 px | 47 → 50 | 154 → 162 | 270 → 253 | 261 → 282 | 70 → 72 ms |
| Basketball home | 390 px | 5 → 15 | 55 → 81 | 0 → 11 | 70 → 128 | 22 → 33 ms |
| Basketball home | 1440 px | 6 → 15 | 55 → 81 | 0 → 11 | 79 → 177 | 27 → 27 ms |

The arena and shared controls add weight on desktop. Dedicated lightweight masthead crops recovered about 110 KiB of image transfer on the desktop portal compared with the first redesign build. The mobile menu now starts collapsed before scripting runs. On the final pass the observed initial layout-shift sum was less than 0.01 for the portal and basketball home at 390 px and 1440 px. A few legacy football routes still shifted as they rendered, including the Coaches Poll at 320 px. The bracket adds about 4.8 KiB of compressed code to its existing resources.

[Before measurements](<../../tmp/gd-visual/before/performance.json>) · [After measurements](<../../tmp/gd-visual/after/performance.json>)

## Verification and limits

- The full Node suite passed all 535 tests. The standalone football browser gate passed 168 checks. The integrated preview passed 405 route-and-viewport checks across nine widths from 320 px to 1920 px with reduced motion enabled.
- The navigation checks exercised 37 grouped destinations, real search results across both sports, sport switching, legacy football URLs, keyboard activation, Escape focus restoration, and mobile disclosure. A mobile basketball route also worked with browser scripting disabled.
- The basketball interior tests verified the Top 25 and full 365-team list, all three model views, live directory filtering, both sort directions for six conference columns, reciprocal head-to-head counts, six-season trends, and score, box-score, and matchup links at seven widths.
- March Madness tests verified both 68- and 76-team maps, pointer-centered zoom, drag, fit, reset, region and Final Four jumps, native fullscreen, pick advancement, invalidation of dependent picks, historical grading, and draft reopen.
- Production rankings, forecasts, historical publications, accounts, schedules, and contest data were outside this preview release. The branch changes only preview code, assets, tests, and this report. No provider or production account calls were needed.
- The private preview uses a local practice profile. Football saved teams and administration remain production-only. A practice bracket draft can reopen in the same browser under the same preview profile. It does not sync between devices.
- The projected bracket and historical replays are labeled in their respective views. Current movement stays unavailable when the cached dataset has only one saved edition, and games without saved pre-tipoff forecasts remain outside graded results.
- Bracket evidence uses still screenshots. A browser video capture runtime was unavailable.
- Browser checks covered Chromium. The preview did not include a separate screen-reader session or Safari and Firefox runs.
