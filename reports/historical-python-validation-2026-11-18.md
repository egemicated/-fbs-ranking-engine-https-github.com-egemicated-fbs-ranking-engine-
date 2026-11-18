# Legacy Python research validation, November 18, 2026

All 135 existing `research/test*.py` tests passed with zero failures, errors,
skips or expected failures. This supersedes the initial report's Python-runtime
limitation. The requested `test_audit`, `test_repairs`, `test_fcs_repairs` and
`test_research` subset also passed separately: 32 tests, included in the 135.

The full discovery run includes historical repairs, source audits, original
research safeguards, division handling, opponent audits, Performance model,
ingest and experiment checks, adaptive/advanced Performance, and composite
replay/experiment tests. This is unit and frozen-data validation, not new model
fitting or prospective evidence.

The machine had no installed Python. A portable Windows x64 CPython 3.13.9
runtime was downloaded from the [official Python release](https://www.python.org/downloads/release/python-3139/)
into `../tmp/historical-python-validation/runtime`. Its release-page MD5 and
SHA256 digest from the official Sigstore bundle matched. Windows Authenticode
reported a valid Python Software Foundation signature on `python.exe`. This
does not claim a full Sigstore certificate-chain verification. Runtime ZIP
SHA256: `91d828c2da3a029b41699e918674a0cb379c02cf20dab9c501306885f837402a`.

The pinned `numpy==2.3.5` from `research/performance-requirements.txt` used the
CPython 3.13 Windows x64 wheel from [official PyPI metadata](https://pypi.org/pypi/numpy/2.3.5/json).
Its SHA256 matched:
`00dc4e846108a382c5869e77c6ed514394bdeb3403461d25a829711041217d5b`.
No operating-system installation, administrator installation, global PATH
change, package-index configuration change or paid service was required.

Tests ran from `../tmp/historical-python-validation/test-mirror`. Shipping
research Python files and root research JSON/text fixtures were copied there
without byte changes. All Python module checksums were compared to the current
worktree before discovery. The original tests calculate `ROOT`/`HERE` normally
from those scratch file locations; no test, function or ROOT constant was
monkeypatched.

Explicit private directory junctions supply the missing ignored inputs:

| Scratch path | Target |
| --- | --- |
| `data` | Existing `../fbs-ranking-engine/data` |
| `research/datasets`, `research/cache`, `research/results` | Existing corresponding sibling research directories |
| `src`, `frontend`, `published` | Current shipping worktree directories |
| `research/releases`, `research/lib` | Current shipping research directories |

Thus numerical fixtures came from the already verified sibling archives and
JavaScript equivalence tests ran the current shipping engine. Python network
connections fail closed in the harness. Protected production numerical files,
raw CSVs, original seasons and both repaired season sets were hashed before and
after the full run; all remained unchanged. Tests wrote only the private
scratch Python bytecode and requested test evidence. No production source,
input, prior, publication or user record was changed.

The retained [test log](../research/results/historical-foundation-v1/python-all-tests.txt),
[validation manifest](../research/results/historical-foundation-v1/python-validation.json)
and [harness](../research/results/historical-foundation-v1/python-validation-harness.py)
record checksums, runtime provenance, explicit junction mappings and results.
The separate core-subset log is `python-core-tests.txt` in the same directory.

Reproduce with that retained scratch environment:

```powershell
& ../tmp/historical-python-validation/runtime/python.exe research/results/historical-foundation-v1/python-validation-harness.py C:/Users/Bryan/Documents/ChatGPT/Bryan/fbs-engagement-features C:/Users/Bryan/Documents/ChatGPT/Bryan/tmp/historical-python-validation/test-mirror
```

The runtime and NumPy wheel stay outside the repository. There were zero CFBD
calls, no added scheduled job and no recurring hosting/database cost. Downloads
were the runtime, its official signature bundle, PyPI metadata and the pinned
wheel. Existing historical completeness, membership and prospective-evaluation
limitations remain; passing these tests does not remove those evidence limits.
