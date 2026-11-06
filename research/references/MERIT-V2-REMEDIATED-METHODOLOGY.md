# Merit v2 Remediated Methodology

Two independent earned-resume candidates remain under study.

SOR assigns a team the negative base-10 logarithm of the probability that an FBS-reference team would earn at least the observed number of wins against the same schedule and venues. OAGV sums actual outcome minus the same schedule-adjusted expected outcome for each game.

For a game being valued, the estimator removes exactly that occurrence and recalculates:

1. the regularized Colley opponent-strength network;
2. the mean rating of the FBS reference population;
3. the opponent's opponent-adjusted schedule strength; and
4. the venue-adjusted reference win probability.

This prevents the evaluated result from increasing its own value through the opponent rating or reference mean. No blanket FCS penalty is applied; FCS identities participate individually in the connected Division I network.

Venue parameters are frozen from 2014–2019: Colley slope 4.2967562254 and home log-odds 0.4745547195. The Colley prior is 2.0. The 2026 snapshot is not used to tune those values.

Uncertainty uses 2,000 paired season-week block bootstrap replicates with seed 20261019. Every replicate applies the exact LOO estimator to both candidates. Reported rank bands are empirical stability bands, not calibrated confidence intervals. Leave-one-game and leave-one-week diagnostics expose sensitivity to individual evidence and schedule blocks.

No candidate is selected. Historical 2021–2024 evidence is retrospective and previously consumed; it cannot establish prospective superiority.

