# Ranking methodology

## Current published ranking: division-aware strength of record

The current CFBD season is displayed in order of division-aware strength of
record (SOR). It measures how difficult a team's actual win total would be for
an average FBS reference team facing the same opponents at the same venues.
Higher SOR means the model considers that record harder to achieve.

The user approved promoting this tested candidate while further research
continues. That is a publication decision, not proof that it is the uniquely
correct ranking or that it will outperform every alternative on future games.
There are no human polls, conference weights, team overrides or manual ranks.

### Colley opponent network

Let L be the undirected game multigraph Laplacian, with one edge per completed
game. Solve `(2I + L) x = (wins - losses)/2`, then `achievement = 0.5 + x`.
Ties add a graph edge but contribute zero to the right side. This is the
[Colley matrix](https://www.colleyrankings.com/matrate.pdf). It remains the
opponent-rating backbone and a retained baseline ranking.

All teams in the source schedule are modeled individually, including FCS and
other opponents; only teams marked FBS in that season enter the published FBS
ranking. This avoids treating every FCS opponent as one fixed-strength team.
Season-specific subdivision labels matter; current membership must not be
copied backward into historical seasons. Conference labels group results but
never enter the calculation.

### Remove each game before assessing its difficulty

For each game on a team's schedule, remove that game from the Colley network
and recalculate the opponent's rating and the mean rating of that season's FBS
teams. This is exact game removal, implemented through the equivalent matrix
update. The game's own outcome cannot directly improve the opponent or
reference ratings used to assess that same game.

Other completed games remain in the network, including games played later in
the season than the game being assessed. SOR is therefore a retrospective
assessment of the current resume, not a stored pregame forecast.

### Reference win probabilities

For an FBS reference team playing each opponent, calculate:

`p = logistic(beta * (referenceWithoutGame - opponentWithoutGame) + H * venue + gamma * fcsOpponent)`

Here `logistic(z) = 1 / (1 + exp(-z))`. `venue` is +1 for a home game, 0 for a
neutral game and -1 for an away game, from the evaluated team's perspective.
`fcsOpponent` is 1 for a confirmed FCS opponent and 0 for a confirmed FBS
opponent. The frozen coefficients from the second division research round are:

| Parameter | Value | Role |
| --- | ---: | --- |
| beta | 5.159563190867806 | Opponent/reference Colley difference |
| H | 0.3809700209732449 | Venue adjustment in this probability mapping |
| gamma | 2.401314541603099 | Residual FBS-versus-FCS adjustment |

These are probabilities for the average FBS reference team, not the evaluated
team's own predicted win probabilities. The subdivision term measures the
remaining cross-subdivision effect after accounting for Colley difference and
venue. It does not add another weight to the game network or multiply actual
wins or losses. Strong FCS and weak FBS programs can overlap in the model.

The mapping requires known season-specific FBS/FCS classifications for direct
FBS opponents. Other-level and unknown nodes can still supply network context;
they are not silently classified as FCS.

### Convert schedule difficulty and actual wins into SOR

Using those per-game probabilities, calculate the exact Poisson-binomial tail
`tail = P(reference wins >= actual wins)`, then `SOR = -log10(tail)`.
For example, a tail of 0.01 produces SOR 2. A smaller tail produces a higher
SOR and a better displayed rank. Expected reference wins equal `sum(p)`.
The exact tail calculation assumes independent game outcomes conditional on
the fitted probabilities; it is not a confidence interval for a team's rank.

Only completed current-season results earn achievement credit. Historical
games were used to estimate and freeze the population-level coefficients;
last season's team rating, record, reputation or conference does not supply
this season's SOR credit. Each actual outcome is counted once. Score margin
does not enter either current SOR achievement or the Colley backbone.

FBS-involving ties need an explicit new SOR policy and are not silently treated
as wins or losses. Teams without completed games do not receive invented SOR
evidence. Rank ties use a 1e-9 tolerance.

## Retained baselines, SOS and API compatibility

The current publication retains Colley `achievement` and its original `rank`
as the baseline. The current website uses `displayRank` for SOR ordering.
Clients must read the explicit ranking-method metadata rather than assume
that the legacy `rank` field changed meaning. The published metadata identifies
the current-season SOR method, reference and fixed coefficients, and the
retained Colley baseline.

`achievementScheduleStrength` is the mean Colley achievement of a team's
opponents. The separate `scheduleStrength` field is the mean predictive
strength of its opponents. These SOS summaries remain distinct from SOR,
which considers the reference win probability for every scheduled game.

The retained Colley score also exposes its decomposition:
`(1 + (wins-losses)/2 + sum(opponent achievement)) / (games+2)`.
Its baseline, record and opponent terms sum to the Colley score. These are
accounting contributions within the solved network, not independent estimates
of a game's causal effect or contributions to SOR.

Historical season endpoints remain Colley archives. Their order and legacy
fields are not relabeled as division-aware SOR. Method metadata makes this
scope difference explicit. Historical predictive priors and existing model
configuration remain unchanged by this publication change.

## Separate predictive strength model

Predictive strength estimates future performance and remains separate from
earned achievement. For each game, start with home points minus away points.
If period scores confirm an overtime tie at the end of regulation, replace
this margin with +1 or -1 for the eventual winner. Compute:

`target = cap * tanh(margin/cap) - (neutral ? 0 : homeAdvantage)`

The margin transform is a smooth bound with `cap = 28`. It approaches 28
gradually; it is not a hard cutoff where a 28-point and a 50-point win become
identical. This transform belongs only to predictive strength, not SOR or
Colley achievement.

Solve `(lambda I + L) strength = gameTargets + lambda * preseasonStrength`,
where each target adds positively for the home team and negatively for the
away team. `preseasonStrength = previousOwnStrength * retention^seasonGap`.
New teams start at zero; there is no prestige or subdivision bonus in this
strength fit. Positive regularization identifies disconnected teams.

The unchanged deployed configuration in `data/model.json` is ridge 3,
retention 0.75, home advantage 2.5, margin cap 28 and probability scale 14.
The predictive home-advantage constant is separate from SOR's fitted H.
The selection command compares ridge {3,5,8} and retention {0,.5,.75} using
2019-2022 weekly log loss. Other constants are engineering defaults and are
not claimed optimal.

Predicted margin is strength difference plus venue advantage. Experimental
win probability is `logistic(predicted margin / 14)`; this scale is not yet
calibrated. Predicted margins should not be treated as betting spreads. The
reported prior weight `lambda/(lambda+games)` is the direct coefficient share,
not an exact total historical influence: opponents' priors also propagate
through the network.

## Validation and reproducibility

Predictive backtests make each competition week's predictions before any game
in that week enters training. Only prior-season snapshots and previously
completed weeks may contribute. A 24-hour buffer after kickoff approximates
historical final-score availability. Regular-season and postseason week
numbers are distinct. Predictive parameter selection uses 2019-2022;
evaluation uses 2023-2025, with earlier seasons supplying warmup. FBS-versus-FBS
non-tied games, including postseason, are evaluated using log loss, Brier
score, accuracy and margin MAE against a fixed home-only baseline.

The division research separately compared a two-variable control and a
three-variable division candidate on the same Colley network and the same
FBS-involving calibration games. The promoted final-network game-removal
coefficients were fitted on repaired 2014-2019 history. Later historical
replications and prior-week-only probability checks are supporting evidence;
they do not make the retrospective SOR probabilities pregame forecasts.
Previously inspected seasons are not an untouched holdout. No prospective
cross-validation proof or universal superiority is claimed. Future testing
continues with independently recorded evidence.

The existing frozen research protocols and comparisons keep their original
identities and files. Publication does not rewrite them or silently replace
their coefficients. A failure in a research comparison must not block the
scheduled ranking publication.

Snapshots retain model/configuration metadata, source provenance, input
hashes, records, opponent ratings, per-game evidence, sample sizes and
connected-component sizes. Historical hashes include prior snapshot lineage.
SOR method metadata identifies the fixed mapping and its current-season scope.
Retain the same inputs, source classifications, configuration and implementation
to reproduce a result. Source corrections can change reconstructed history.

## Weekly publication and data freshness

The publisher refreshes on Sunday at 00:01 America/Denver, following Mountain
Time daylight-saving changes. The normal primary refresh uses two CFBD requests:
one season-wide results request and one year-specific FBS roster request.
It counts games CFBD marks complete, with kickoff no later than retrieval.
It does not impose the retrospective 24-hour kickoff buffer on confirmed
current results. The API key remains a GitHub Actions repository secret.

Every visitor receives the saved published data. Page views, team-page clicks
and ordinary API reads do not trigger CFBD calls. There is no continuous
live-scoreboard refresh.

`asOf` and source retrieval timestamps describe the data cutoff. Republishing
the same data under a newly approved model preserves those timestamps.
`modelPublishedAt` separately records when that model publication was produced;
it must not imply that newer games were fetched. A completed game after the
cutoff enters when the underlying data is refreshed.

## Known limitations and next evidence needed

- Historical inputs contain retrospective corrections, not exact archived
  observations of what each provider displayed at every past cutoff.
- Original 2004-2022 CSV archives lack provider-labeled postseason rows.
  Those labels do not prove that all actual FCS playoff games are absent:
  some were labeled regular season. Separate research repairs and semantic
  game checks do not silently rewrite the historical public archives.
- The 2020 FCS season extended into spring 2021, with source roster and
  coverage gaps. Calendar 2021 includes two distinct football seasons.
- Default CSVs omit period scores, so their predictive overtime adjustment
  uses the bounded final margin when regulation scores are unavailable.
- Garbage time and play-by-play efficiency are not modeled. Offense/defense
  efficiency, special teams and confidence intervals need separate validation.
- Teams absent from a season schedule cannot be discovered from that CSV;
  current CFBD mode also uses its year-specific FBS roster.
- Incomplete lower-division context, sparse conference crossover and changing
  source coverage can affect opponent ratings and coefficient transfer.
- Cross-subdivision schedules overwhelmingly put FBS teams at home and are
  selected matchups. The fitted division term is not a causal estimate of the
  resource gap or a universal neutral-site win rate between subdivisions.
- Connected-component and sample-size fields expose evidence limitations;
  they are not statistical confidence intervals.
- Probability quality alone cannot establish a uniquely correct achievement
  order. A win need not increase a team's rank because other results also
  change the network and relative resumes.
- Health indicates that the process is running. A missing season returns 503
  rather than fabricated rankings; source timestamps expose data freshness.

This is a transparent statistical model with human-chosen rules. No individual
may manually alter a team's calculated rank.
