# Full Court basketball models

The private preview uses `gd-ncaam-1.0-preview` for NCAA Division I men’s basketball. The three rankings answer different questions with independent scoring. All current rankings remain provisional during the opening weeks. Football calculations do not participate in these outputs.

## Strength of Record

Only verified, decisive D-I games enter the ranking graph. Overall records also show available non-D-I results separately. The graph ignores points, possession statistics, conference reputation and preseason ratings. Every school starts from the same 0.5 baseline. The win-only Colley rating solves `(2I + L)r = (wins − losses) / 2` on the D-I opponent graph, with `L` its game Laplacian and the reported rating equal to `0.5 + r`.

Each counted game gets an exact leave-one-out opponent rating using a rank-one inverse update. The equal-weight average of the D-I graph is always 0.5, including teams with sparse evidence. That fixed 0.5 is the reference. For each game, a reference team’s estimated chance to win is

```text
p_i = logistic(4.310746736838692 × (0.5 − leave_one_out_opponent)
               + 0.5976855367735421 × team_venue)
```

Venue equals +1 at home, −1 away and 0 at a neutral or unconfirmed location. The logistic effects were fitted on prior historical D-I games with only the pregame difference in Colley and the declared venue. A stable Poisson-binomial recurrence sums the probability of at least the observed number of D-I wins. SOR is `−log10(tail probability)`. A team with zero D-I wins has SOR zero after it has played, while no D-I games gives no rank. Exact numerical ties within 1e-10 share a rank. The team ID orders otherwise indistinguishable display rows.

The score compares total wins to the schedule’s difficulty. Two equal résumés can share an SOR even if the teams won different individual games. A schedule contribution shows the specific outcome and reference difficulty so the reader can see who each team beat. The independent outcome approximation conditions on the fixed schedule and estimated probabilities. It does not model opponent-rating uncertainty or infer an exact strength level from a sparse or weakly connected schedule. Each team is flagged before five D-I games or when its D-I schedule component contains less than 90% of the registry.

Historical sensitivity compares each season’s No. 25 and No. 50 win-only Colley team with the fixed average. No. 50 is a transparent tournament-bubble proxy. It has no connection to actual NCAA committee selections. In four January and pre-Opening-Round checkpoints spanning 2024–25 and 2025–26, the top-25 proxy retained 23–24 of the average-reference Top 25 and moved teams by 6.17–15.01 ranks on average. The bubble proxy retained 24 of 25 each time and moved teams by 4.36–6.38 ranks. The average reference is the simplest constant that stays comparable from the first game onward. The stronger references change with the season and can make many extremely ordinary résumés look equivalent.

## Predictive Strength

The selected model solves a ridge-regularized least-squares schedule graph using observed D-I scoring margins. It jointly fits a venue adjustment with the network ratings. The team rating has zero-centered ridge 5 and the fitted court term has a zero-centered ridge of 80 games, limiting early-season swings. A known overtime game scales its scoring margin by `40 / (40 + overtime minutes)`. An unconfirmed overtime duration leaves the native scoring margin unchanged. The model has no brand, poll, conference bonus or football prior.

The matchup uses the difference in graph ratings in points. Its historical probability and expected final point margin are independently fitted on the training seasons.

```text
p_home = logistic(0.17393601177622797 × rating_difference
                  + 0.6090412913481499 × venue)

expected_home_margin = 1.1637737221177602 × rating_difference
                       + 4.35988814700159 × venue
```

Neutral-site forecasts set venue to 0. Swapping sides and reversing the venue complements the probability and negates the margin. Rankings sort the team component of the neutral logit. The preview reports an expected spread. It withholds total-score projections because a model for totals has not cleared its own validation.

Candidates included a coin, venue-only, win-only Colley, sequential venue-aware Elo, opponent-adjusted margin, adjusted net efficiency, margin plus efficiency, and a model that added five-game scoring residuals and logged rest. Training fits normalized inputs with ridge 3 for logistic forecasts and ridge 5 for expected margins. The sequential Elo baseline starts each season at zero and updates by `24 × (result − p)` with standard 400-point scaling and a 55-point venue term. The efficiency candidate uses the margin feature when the necessary pregame box evidence is missing. Rest measures elapsed time since the latest observed final, with one- and eight-day bounds. The tuning rule requires a Brier improvement of at least 0.0002 before accepting another candidate, favoring simpler models. The context model improved tuning Brier by 0.000155 over margin, so the frozen preview chose margin.

## Performance Experimental

Two box-score possession counts are averaged for each D-I game. Provider possessions are preferred. When unavailable, each team estimate is `FGA − ORB + TOV + 0.475 × FTA`, which requires all four fields. Points per 100 possessions are modeled on both sides of the matchup by a joint offensive-versus-defensive ridge regression around the observed division average. Offense and defense have zero-centered ridge 8, and the model jointly estimates a signed court coefficient. The experimental rating is adjusted offensive efficiency less adjusted defensive efficiency. At least two usable box scores are required. Tempo is mean estimated possessions per 40 minutes, using explicit overtime minutes where available.

The Four Factors shown in evidence use their own opportunities and game counts. Effective field goal percentage is `(FGM + 0.5 × 3PM) / FGA`, turnover rate is `TOV / possessions`, offensive rebound rate is `ORB / (ORB + opponent DRB)`, and free-throw rate is `FTA / FGA`. These quantities describe how scoring happened. They have no extra weights in the experimental ranking. The current five leaders are also the predictive top five, as expected when margins and efficiency are strongly correlated. Beyond the leaders, 22 teams appear in both top 25s, and the 364 mutually ranked teams differ by 6.70 places on average, with a maximum difference of 38. The independent efficiency forecast candidate achieved 70.84% accuracy with Brier 0.18899 and margin MAE 10.03 on the same holdout.

Possession definitions and schedule-adjusted offense and defense are established basketball statistical approaches. This implementation uses its own graph, weights, records, and training. [Basketball possession and rating glossary](https://kenpom.com/blog/ratings-glossary/) · [NCAA team sheet and evaluation notes](https://www.ncaa.org/championships/march-madness/selections-101/division-i-mens-basketball-championship/)

## Historical validation

Each replay trains the season’s team state once at UTC midnight, before that day’s games. Results with no measured original availability receive a 24-hour tipoff buffer, or 48 hours if the tipoff was unconfirmed. Unconfirmed tipoffs are excluded from grading. The immutable CBBD extracts include later corrections and do not reproduce original source delivery times. Each prior-day replay is a retrospective estimate with an explicitly modeled data cutoff.

The ending-year cohorts are 2022–24 training with 16,916 games, 2025 tuning with 5,764 games, and 2026 held out with 5,752 games. No result from those holdout games determined the selected model or coefficients. The JSON report includes source content hashes, individual-season counts, candidates, confidence bands, and schedule and venue slices.

| Holdout | Games | Accuracy | Brier | Log loss | Margin MAE |
| --- | ---: | ---: | ---: | ---: | ---: |
| All games | 5,752 | 70.54% | 0.18836 | 0.55417 | 9.87 |
| Known home court | 5,073 | 71.46% | 0.18547 | 0.54764 | 9.94 |
| Neutral site | 679 | 63.70% | 0.20998 | 0.60300 | 9.38 |
| Early season | 1,028 | 76.22% | 0.16805 | 0.51052 | 12.43 |
| Established season | 4,724 | 69.31% | 0.19278 | 0.56367 | 9.31 |
| Conference | 3,660 | 67.73% | 0.20257 | 0.58883 | 9.04 |
| NCAA tournament | 67 | 74.63% | 0.15864 | 0.47145 | 9.94 |

The holdout confidence-bin error is 1.59 percentage points. Average forecast confidence and actual accuracy were 54.94% and 51.80% in the 50–59% bin, 65.02% and 63.82% in the 60–69% bin, 74.92% and 73.71% in the 70–79% bin, 84.73% and 83.50% in the 80–89% bin, and 93.87% and 94.61% in the 90–100% bin. Brier uncertainty uses an approximate normal interval at the game level. Repeated appearances by teams create dependencies and can make this interval optimistic. The NCAA tournament slice has a substantially smaller sample than the general holdout. The qualifying historical seasons have score and box coverage sufficient for the tested features. Player availability and season-end external rankings were outside the pregame training inputs.

Reproduce the report using the normalized local source files.

```powershell
node scripts/basketball-model-replay.js reports/full-court-basketball-validation.json data/seasons/basketball/2022.json data/seasons/basketball/2023.json data/seasons/basketball/2024.json data/seasons/basketball/2025.json data/seasons/basketball/2026.json
```

The frozen coefficients in `basketball/model-settings.json` are verified against the historical report by tests. The source cache remains local. [CollegeBasketballData data availability](https://api.collegebasketballdata.com/data-availability)

## Prospective records

An upcoming game can enter the separate append-only forecast ledger once, in the 72 hours before confirmed tipoff. Each entry stores the actual capture time, publication cutoff, input snapshot hash and model version. A corrected tipoff at or before capture, a changed team assignment or a cancellation excludes the original prediction from grading. A late, missing or unverified capture stays absent. Only prospective entries enter the private preview’s live report. The replay report contains no retrospective entries described as live evidence.

## Conference Strength

Conference results use the season’s actual D-I memberships. Only completed interconference games in both teams’ ranking evidence at the snapshot cutoff count. Each game contributes one result to each side of the head-to-head matrix. Home, road and neutral records are separate. An unconfirmed venue still counts in the record and is omitted from the quality estimate.

For each rated game the team earns `result − p_reference`, where a win is 1, a loss is 0, and `p_reference` is the average D-I team’s win chance against that opponent at the actual venue. The comparison uses the current win-only Colley graph with the individual game removed. Win surplus is the sum, and its per-game version divides by the number of rated games. A positive surplus means the league’s teams won more than the reference would be expected to on those matchups. This is a retrospective achievement measure. Its values depend on the opponents and venues present in the sample. Ratings are absent when there are no rated games and flagged when there are fewer than ten.

The distinct descriptive power view summarizes each conference’s distribution of team Predictive Strength scores. Mean, median, first and third quartiles and range exclude unranked teams. It uses neutral-game model logits, the score used to order the individual power rankings.
