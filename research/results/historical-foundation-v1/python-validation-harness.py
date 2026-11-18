"""Offline legacy test evidence, using byte-identical shipping Python copies.

The scratch mirror changes filesystem location only. Its data/datasets/cache
junctions point at the already verified sibling archive; src/frontend/published
point at the current shipping worktree. No ROOT constant or test is monkeypatched.
Run with the documented portable CPython runtime and NumPy 2.3.5.
"""
from pathlib import Path
import hashlib
import json
import socket
import sys
import time
import unittest

shipping = Path(sys.argv[1]).resolve()
scratch = Path(sys.argv[2]).resolve()
output = shipping / 'research/results/historical-foundation-v1'
runtime = scratch.parent

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

code = {}
for original in sorted((shipping / 'research').glob('*.py')):
    copied = scratch / 'research' / original.name
    assert sha(original) == sha(copied), original.name
    code[original.name] = sha(original)

protected = {}
for name in ['src/engine.js', 'src/history.js', 'src/ingest.js',
             'data/model.json', 'data/matchup-validation.json',
             'data/fcs-matchup-validation.json', 'published/latest.json',
             'published/prior-2025.json']:
    protected[str(shipping / name)] = sha(shipping / name)
for folder, pattern in [('data/seasons', '*.json'), ('data/raw', '*.csv'),
                        ('research/datasets/historical-coverage-v1/seasons', '*.json'),
                        ('research/datasets/fcs-coverage-v1/seasons', '*.json')]:
    for path in sorted((scratch / folder).glob(pattern)):
        protected[str(path.resolve())] = sha(path)

def forbid_network(*args, **kwargs):
    raise RuntimeError('Offline test harness forbids network connections')

socket.socket.connect = forbid_network
socket.socket.connect_ex = forbid_network
socket.create_connection = forbid_network
sys.path.insert(0, str(scratch / 'research'))
import numpy

start = time.perf_counter()
suite = unittest.defaultTestLoader.discover(str(scratch / 'research'), pattern='test*.py')
with (output / 'python-all-tests.txt').open('w', encoding='utf-8') as stream:
    result = unittest.TextTestRunner(verbosity=2, stream=stream).run(suite)
elapsed = time.perf_counter() - start
unchanged = all(sha(Path(path)) == expected for path, expected in protected.items())
assert unchanged, 'A protected production/archive source changed during tests'
manifest = {
    'purpose': 'Legacy offline Python research/model validation',
    'python': sys.version, 'numpy': numpy.__version__,
    'portableRuntime': json.loads((runtime / 'download-manifest.json').read_text(encoding='utf-8-sig')),
    'pythonAuthenticode': 'Valid, Python Software Foundation (checked before execution)',
    'runtimeVerification': 'Official release-page MD5 and official Sigstore SHA256 digest matched; no full Sigstore certificate-chain verification claimed. NumPy wheel SHA256 matched official PyPI metadata.',
    'environmentOverride': 'Byte-identical research Python modules and root JSON/text fixtures copied into private scratch mirror; no code/test/ROOT monkeypatch. Relative ROOT/HERE resolve to scratch. Explicit junctions supply existing original/cache/repaired data and current shipping JS/frontend/publications.',
    'junctions': json.loads((runtime / 'mirror-junctions.json').read_text(encoding='utf-8-sig')),
    'sourcePythonSha256': code,
    'harnessSha256': sha(Path(__file__)),
    'testOutputSha256': sha(output / 'python-all-tests.txt'),
    'protectedInputSha256': protected,
    'protectedInputsUnchanged': unchanged,
    'networkPolicy': 'Python socket connect/connect_ex/create_connection fail closed; no provider calls',
    'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
    'skipped': len(result.skipped), 'unexpectedSuccesses': len(result.unexpectedSuccesses),
    'expectedFailures': len(result.expectedFailures), 'elapsedSeconds': elapsed,
    'failureDetails': [{'test': str(test), 'traceback': text} for test, text in result.failures],
    'errorDetails': [{'test': str(test), 'traceback': text} for test, text in result.errors],
    'cfbdCalls': 0, 'productionChanges': False,
}
(output / 'python-validation.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: manifest[key] for key in ['testsRun', 'failures', 'errors', 'skipped', 'elapsedSeconds', 'protectedInputsUnchanged']}))
sys.exit(0 if result.wasSuccessful() else 1)
