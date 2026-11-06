CURRENT OPPONENT AUDIT AND FROZEN COMPARISON

The saved November 5 snapshot was checked against later public schedules for
all 138 FBS teams and 98 direct FCS opponents. No discrepancies were found in
eligible older games: 1,078 distinct published games were corroborated.
Three recent finals were held aside because publication-time availability
cannot be established from later-fetched schedules.

Ten sensitivity scenarios cover sparse indirect opponents, four confirmed
canceled original slots and one unresolved tied context. These are scenario
results, not confidence intervals. Actual weather-shortened non-FBS ties are
retained. The saved publication is not automatically rewritten.

Primary membership transition checks and two complete official FCS opponent
record checks are saved with their URLs. This is not certification of every
historical membership entry or the completeness of every provider.

Frozen protocol: research/frozen-comparison.json
Future weekly observations: research/observations/
Calculator: research/lib/sor_candidate.mjs
Recorder: scripts/record-research-comparison.js

The existing Sunday update supplies the same games to both methods. Input
and implementation checksums are recorded. No poll weights, team overrides,
model blend, additional CFBD calls or extra scheduled service are introduced.
Public rankings stay on the current engine. A failed research calculation
does not prevent normal publication. Observations are retained in Git; source
response artifacts have the existing 14-day retention.

The research branch also stores the frozen normalized audit packet at
research/releases/opponent-audit-2026-11-05.json.gz. With Python and NumPy,
run python research/restore_opponent_audit.py to verify its checksum,
restore the report and reproduce all 138 baseline records/ranks and ten
sensitivity cases without network access. It preserves normalized evidence
and source hashes, not the complete original public response bytes.
