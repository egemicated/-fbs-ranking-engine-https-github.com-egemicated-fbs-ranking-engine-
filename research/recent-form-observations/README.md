# Recent-form forecast trial

This research trial compares the existing calibrated Predictive Strength pick with a frozen recent-form challenger. Both use the same verified results, the same previous-season ratings and the same venue adjustment. The challenger gives newer games more weight and makes a small adjustment for recent margins relative to earlier forecasts.

The normal rankings refresh records a pair only for a newly issued official FBS–FBS pick with a confirmed kickoff. A valid pair uses the same snapshot and has both forecasts in the record before kickoff. Duplicate checkpoints and older public picks are ineligible for a second pair. The observation files contain derived forecasts and input checksums.

The evaluator grades the first eligible pair against a matched final. It reports correct picks, Brier score and log loss, plus pending or excluded games. The trial is descriptive and the size of the paired sample should accompany any interpretation. Public predictions continue to use Predictive Strength.

Read the [frozen protocol](../frozen-recent-form-shadow-v1.json) and the [latest evaluation](../recent-form-evaluations/latest.json) once a regular refresh runs. The trial reuses the existing refresh, with zero additional provider requests.
