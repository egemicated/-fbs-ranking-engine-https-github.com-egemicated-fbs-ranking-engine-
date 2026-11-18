# Accuracy and stabilization baseline

Captured before this project's corrections on November 18, 2026. The source
commit is `ccd98b38bb97bf68d884d2063a2b4c3a7c1cea0d`, verified against both
GitHub main and Render's live deployment `dep-dbv0sc61egvs73ejngo0`.

## Verified production state

- Source cutoff: `2026-11-18T12:30:14.250Z`.
- Source snapshot SHA256: `a36df50d7f94c050e03b2d5df03cba802067d8dd2a1732f715a3ea3cc57dc4c1`.
- Published populations: 138 FBS and 128 FCS teams.
- Unique game coverage: 632 FBS/FBS, 123 FBS/FCS, 590 FCS/FCS;
  48 unknown-subdivision nodes and 106 unknown-involved context games.
- Frozen SOR policy: `division-sor-v2`, publication version `1.0.0`;
  slope `5.159563190867806`, home log odds `0.3809700209732449`,
  division log odds `2.401314541603099`.
- Predictive engine settings: ridge 3, retention 0.75, home advantage 2.5,
  bounded-margin parameter 28, baseline probability scale 14.
- Approved FBS/FBS probability scale: `6.147406563247917`.
- Approved FCS/FCS probability scale: `6.74434303402901`.
  Cross-subdivision estimates still use the uncalibrated scale 14.
- Production historical team prior: `published/prior-2025.json`, from the
  original archive. The repaired historical release remains research-only.
- Existing public sitemap: 281 generated URLs.
- Full Node baseline: 321 passed, 0 failed, 0 skipped, using `npm test`.
- Existing Engine checks already runs Node tests indirectly through
  `prepare-static.js`; it has no isolated SQL test step. Render currently
  deploys on commit, rather than waiting for the complete browser/SQL checks.
- Scheduled result check: 03:45 America/Denver daily; Sunday backup 20:11.
  CFP release checks remain 20:00 and 20:05 on configured release dates.

## Saved accounts and recoverability

Read-only production queries found 134 saved weekly picks, one contest player,
one saved-team preference row, and zero private account requests. All eight
application tables have RLS enabled. Private tables deny direct client access;
the preference ownership policy includes both read and write ownership checks.
No account or pick was changed to establish this baseline.

A complete Git bundle was written outside the repository, under the local
`tmp/stabilization-backup-2026-11-18` directory, and `git bundle verify` passed.
It includes all refs and the complete publication history at the baseline.

The same non-public directory contains a Windows DPAPI-encrypted backup of
all eight application tables, application function definitions and ACLs,
policies and constraint definitions. Byte-for-byte decryption roundtrip and
the 134-pick JSON count passed. Auth secrets, password hashes and access tokens
were not exported. Decryption requires the same Windows user profile. The
separate recovery instructions are kept with the private backup, not on the
public website. A full database restore drill is reported separately.

For code rollback, restore/revert to the verified baseline commit and rebuild
the static site. Do not roll back a privacy fix merely to restore old UI
behavior. Do not overwrite newer saved picks with a baseline backup. Any
production row restoration must be reviewed against the current database.

## Findings before implementation

### Confirmed defects

- Three older SQL tests expect behaviors superseded by the current kickoff
  privacy and multi-team validation rules.
- Historical Conference Strength has no 2025 AP/CFP editions; the 2026 source
  has only three recent editions per poll. Existing date-only mapping cannot
  resolve verified same-day releases and does not separate absent CFP polls
  from unavailable historical evidence.
- The community-picks test demonstrates a future-game unanimous tally from
  three private participants. That aggregate can disclose selections before
  kickoff and does not enforce public-sharing consent.

### Missing or incomplete evidence

- The 2025 conference archive has 245 FBS interconference games and 126
  separate FBS/FCS games, with zero archived AP/CFP editions.
- The 2026 conference dataset has 179 FBS interconference games and 123
  separate FBS/FCS games. AP editions are November 1, 8 and 16; CFP editions
  are November 3, 10 and 17. Only six games map to pregame evidence per poll.
- The original archive has known postseason omissions and duplicates. The
  retained repair release already identifies 674 recovered FBS postseason
  results and eight duplicate removals; its exact hashes require verification
  before any further use.
- Historical source corrections are retrospective; replay results are not
  evidence that equivalent information was available in real time.

### Unverified behavior

- Real Google OAuth sign-in/sign-out and cross-device behavior have not been
  exercised with disposable live accounts. Controlled UI adapters are not a
  substitute for that test.
- Full private-backup database restoration, exhaustive historical truth, and
  a complete WCAG audit have not yet been certified.

### Outside this feature freeze

New website sections, new ranking models, paid data services, wholesale visual
changes, and automatic promotion of older-history or repaired-history models.
No material model change is authorized without separate approval.
