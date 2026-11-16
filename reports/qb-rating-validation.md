# FBS Intelligence QB Rating

**Experimental.** Ratings describe verified passing production within the quarterback’s own subdivision and season. FBS and FCS each have their own reference group.

```text
Rating = 100 + 10 × (Y + 15 × TD − 40 × INT − D − A × L) / (A + 60)
```

- Y, TD and INT are passing yards, passing touchdowns and interceptions thrown from complete game rows. A is the number of pass attempts in those rows.
- D is the sum of each game’s attempts multiplied by the opponent’s estimated passing allowance. That allowance starts at the subdivision’s earlier average and moves toward the opponent’s earlier box-score results as its sample grows.
- L is the attempts-weighted, opponent-adjusted passing rate of the rated player’s covered subdivision and season.

Yards measure progress, the touchdown credit rewards finishing drives, and the interception penalty reflects giving up possession. The 15 and 40 yard-equivalent weights are fixed experimental design choices. Completion counts verify consistency and remain visible alongside the rating. In 2024–25, 4,560 of 5,215 verified FBS passing player-games had an attributed rushing line and 1,293 had a fumbles line with losses filled in. Those are record-presence counts. An absent line leaves the difference between no event and an unavailable field unresolved. College statistics can also count sack losses as rushing yards. The first rating uses the consistent passing evidence, and the pages can display the other categories as reported. [NCAA statistics rules](https://fs.ncaa.org/Docs/stats/Stats_Manuals/Football.pdf)

The rating treats 60 league-average attempts as prior evidence. Twenty verified attempts are required to display a numeric rating, and anything below 60 is marked as a small sample. The comparison group needs at least 200 verified attempts across five teams. The defense estimate uses 180 prior attempts to reduce volatility and considers only passing lines against that opponent by teams in the same subdivision, at least 24 hours after earlier kickoffs. A game without earlier opponent evidence receives zero opponent adjustment, and rated rows expose the number of attempts with an adjustment. Higher is better, and 100 is the subdivision reference.

## Historical forecast test

The test rebuilt the existing team Strength baseline and used only evidence available before the first kickoff of each historical week, with a 24-hour buffer on earlier games. An experimental QB adjustment was fitted in 2022–23 and tested on the same paired games as the baseline in 2024–25. The QB selector used the highest recorded pass volume over the previous two team games. Archived passing evidence cannot reliably establish the announced starter or game-day availability.

| Paired 2024–25 games | Games | Baseline Brier | QB Brier | Baseline Log loss | QB Log loss |
| --- | ---: | ---: | ---: | ---: | ---: |
| FBS vs. FBS | 1,468 of 1,606 | 0.18665 | 0.18731 | 0.54793 | 0.54980 |
| FCS vs. FCS | 40 of 1,380 | 0.20667 | 0.20667 | 0.59423 | 0.59423 |

Lower is better for Brier and log loss. The FBS challenger picked four more winners across the paired games and worsened both probability scores. FCS fit selected zero QB weight, and its sparse paired coverage leaves predictive value unresolved. The experimental rating is suitable for displaying covered passing performance. The evidence does not support integrating it into the game prediction model.

Reproduce from the existing private archives with zero CFBD calls:

```powershell
node research/replay-qb-rating.mjs ../fbs-ranking-engine/research/datasets/fcs-coverage-v1/seasons ../fbs-ranking-engine/research/cache/preseason-player reports/qb-rating-validation.json
```

The JSON report records SHA-256 checksums for both archives, paired game counts, and metrics by division and test year.
