HISTORICAL COVERAGE V1 - RESEARCH ONLY

The production data safeguards are on main. This research does not change the
public ranking formula, current snapshot, prior snapshot or frontend.

The frozen release contains 674 added completed FBS postseason games from
2004-2022, eight explicit original duplicate removals, parent/output checksums,
source provenance and exclusions. It compresses to about 27 KB.

Restore from the exact original cached data/seasons inputs:
  python research/apply_release.py

Evaluate the repaired dataset using unchanged production math:
  node research/evaluate_repairs.mjs
  python research/validate_venue.py

Run all offline research checks (Python with NumPy plus Node):
  python -m unittest discover -s research -p "test_*.py" -v

The original source season files must match the release's parent checksums;
the restore stops instead of silently mixing corrected or newly downloaded
source versions. Research outputs go to research/datasets and research/results.

fetch_public_postseason.mjs and repair_history.py document the acquisition and
construction process. Fetching public data again is not needed to restore the
frozen release. The scripts whitelist outcome/venue fields and exclude polls.

Remaining concerns: lower-division schedule gaps, 2020 roster omissions,
unresolved 2004 venue metadata and the need for genuinely future evaluation.

The research report is results/repairs/summary.html. Forecast changes are small
and mixed; no new parameters or corrected historical prior are promoted here.
