# Frozen future-game blend observations

The Sunday 08:00 America/Denver workflow saves derived predictions here using
the existing primary and experimental Performance snapshots. No extra provider
requests are made. SOR, Predictive Strength, Performance, and the public interface
remain separate.

`research/frozen-blend-prospective-v1.json` fixes the models, normalization,
equal weights, eligibility and older-only probability calibration. Each file
records its actual capture time, source cutoff, model/input checksums, common
team population and the next seven days' available FBS-versus-FBS fixtures.
Missing or stale Performance data skips new captures rather than inventing a
value. A saved ranking index is not itself a win probability.

Observations are immutable and capture must finish before kickoff. The first
eligible capture per season/game is scored once against confirmed later results;
reruns do not replace predictions. A game moved before capture or outside the
declared seven-day horizon is excluded explicitly. These are recorded forecast
times, not claims of a separately certified public registration timestamp.

No historical backfill is treated as future evidence. At setup there are no
prospective observations; collection begins with the next successful weekly run.
Provider responses, normalized source arrays and credentials are never stored
in this directory. An optional research failure cannot block the main refresh.
