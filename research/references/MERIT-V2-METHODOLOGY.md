# Vanta Merit v2 Methodology

## Purpose and decision boundary

Merit v2 measures what a team earned from completed games. It is intentionally separate from
Bradley-Terry outcome strength, Scoring Power, Elo, and forecast accuracy. It uses wins, losses,
opponent quality, venue, and schedule context. It does not use scoring margin, AP rankings,
conference reputation, roster priors, or a predictive power rating.

The selected research candidate is Strength of Record (SOR). Opponent-Adjusted Game Value
(OAGV) remains an independently inspectable alternative and supplies game-level contribution
evidence. Neither is authorized as a public or final Vanta ranking.

## Shared opponent network

Both candidates use one outcome-only Division I opponent network. For each team `i`, the Colley
system is:

```text
(2 + n_i) r_i - sum_j(n_ij r_j) = 1 + (wins_i - losses_i) / 2
```

The prior of two centers an unobserved team at 0.5 and makes the connected system stable. FBS
and FCS teams are fitted jointly and retain individual identities. There is no fixed FCS penalty
and no rule that every FBS program must rank above every FCS program.

This network carries schedule information recursively. An opponent's rating depends on its
results and opponents, whose ratings in turn depend on the broader schedule graph. Raw opponent
winning percentage is not substituted for this estimate.

### Circular-credit safeguard

Every game uses an exact leave-one-game-out (LOO) opponent rating. Removing a game from the
Colley matrix is a rank-one downdate. Merit v2 applies the Sherman-Morrison identity to the
original inverse column, producing the same result as a complete refit within numerical
tolerance. A regression test verifies the analytic downdate against an explicit refit.

The opponent record, opponents' opponents, and schedule difficulty are explanation fields. They
are not added again as weighted bonuses. Opponent strength enters each candidate once through
the LOO network estimate, preventing double-counting.

## Historically frozen venue adjustment

Venue parameters were estimated from approved 2014-2019 final snapshots before the 2026 ranking
was evaluated. For every development-season game, the model generated chronological pregame
Colley differences using only earlier games. A logistic model then estimated:

```text
logit(P(home win)) = beta * (home strength - away strength) + H
```

The frozen values are:

- `beta = 4.2967562253807925`
- `H = 0.47455471946025424` log odds
- equal-team home win probability = `0.616461229284476`
- development observations = `9,033`
- development log loss = `0.5914374186523101`
- development Brier score = `0.2036108984670815`

Neutral games receive no venue term. The current-snapshot Bradley-Terry home estimate is
published only as a comparison and is not used by Merit v2.

## Candidate A: Strength of Record

The reference team is the average FBS Colley rating in the snapshot. For a game against LOO
opponent strength `o_g`, the reference team's win probability is:

```text
p_g = logistic(beta * (reference_strength - o_g) + H * venue_sign)
```

`venue_sign` is `+1` when the reference team would be home, `-1` when away, and `0` at a neutral
site. The independent Bernoulli probabilities are combined with exact Poisson-binomial dynamic
programming. If a team won `W` games, its schedule accomplishment probability is:

```text
tail = P(reference team wins at least W games on that same schedule)
SOR = -log10(tail)
```

Higher SOR is better. This answers a résumé question: how unusual is it for an average FBS team
to match or exceed the observed win total against these opponents at these venues? It does not
estimate how many points the ranked team would win by or its probability of winning its next
game.

## Candidate B: Opponent-Adjusted Game Value

For game `g`:

```text
game_value_g = actual_win_indicator_g - p_g
OAGV = sum_g(game_value_g)
```

Wins that would be difficult for the reference team contribute more; expected wins contribute
less; losses subtract the probability that the reference team would have won. Higher OAGV is
better.

OAGV is transparent and additive, but its scale grows with schedule length and requires an
additional choice if converted to a record-level comparison. SOR was selected before inspecting
the 2026 ranking order because its probability interpretation handles the complete record and
schedule length without another arbitrary weight. OAGV remains the contribution audit and the
primary methodological sensitivity alternative.

## Historical evaluation and success criteria

Venue parameters use 2014-2019 development data. Merit behavior is assessed on 2021 historical
validation, untouched 2022-2023 holdouts, and a 2024 development reference. Each snapshot is
cutoff-safe and reconstructed; none is described as a contemporaneously archived ranking.

Merit success is defined without AP-poll agreement or prediction accuracy:

- identical snapshot and parameters produce identical output;
- changing a loss to a win on the same schedule improves the résumé score;
- same-record teams are separated by opponent-network quality;
- rankings remain reasonably stable when one season-week block is removed;
- FBS and FCS teams are calibrated jointly without a blanket subdivision ordering.

Forecast accuracy remains a separate Power-model diagnostic. AP agreement is not an input,
optimization target, or acceptance criterion.

## Ranking uncertainty

The point estimates use exact per-game LOO opponent values. Stability is estimated with 500
deterministic season-week block bootstrap replicates using seed `20261019`. Each replicate
resamples week blocks, refits the opponent network, and recomputes the résumé. Bootstrap network
refits do not repeat the exact per-game LOO downdate and are explicitly labeled an approximation.

Published outputs include score intervals, rank intervals, median rank, Top-25 frequency,
adjacent-rank overlap, and sensitivity to no venue, Colley prior 1, and Colley prior 4. These are
ranking-stability bands, not definitive frequentist confidence intervals. Ranking-bootstrap
literature cautions that exact rank coverage is difficult; the intervals are best interpreted as
evidence about distinguishability and order of magnitude.

Missing or excluded games are reported separately. The analysis does not claim zero indirect
impact merely because no excluded game directly involves an FBS team; missing FCS evidence can
propagate through the joint network.

## Research basis

- Wesley Colley, [Colley's Bias Free College Football Ranking Method](https://www.colleyrankings.com/matrate.pdf): outcome-only schedule-adjusted network foundation.
- Samuel Burer, [Robust Rankings for College Football](https://optimization-online.org/2011/10/3199/): motivation for explicit sensitivity analysis because ranking leaders can respond materially to game perturbations.
- Peter Hall and Hugh Miller, [Using the bootstrap to quantify the authority of an empirical ranking](https://arxiv.org/abs/0911.3749): motivation and limitations for bootstrap rank-stability statements.

