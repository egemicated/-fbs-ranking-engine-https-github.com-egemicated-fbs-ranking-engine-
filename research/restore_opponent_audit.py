"""Verify the frozen audit packet and reproduce its numerical ranking scenarios.

No network or provider credentials. Full original public response bytes are not
in this compact packet; their recorded source hashes/URLs remain in the report.
"""
import gzip
import hashlib
import json
from pathlib import Path

from compare_merit import fit_network,merit
from audit_opponents import run_sensitivity

HERE=Path(__file__).resolve().parent
metadata=json.loads((HERE/'releases/opponent-audit-2026-11-05.metadata.json').read_text())
raw=(HERE/'releases'/metadata['file']).read_bytes()
assert hashlib.sha256(raw).hexdigest()==metadata['sha256'],'Packet checksum mismatch'
packet=json.loads(gzip.decompress(raw));report=packet['report'];graph=packet['baselineGraph']
baseline=merit(fit_network(graph));expected={r['team']:r for r in report['rankAudits']}
for row in baseline:
    original=expected[row['team']]
    assert (row['colleyRank'],row['sorRank'],f'{row["wins"]}-{row["losses"]}')==(original['colley'],original['sor'],original['record'])
scenarios=run_sensitivity(graph,baseline,{g['id']:g for g in report['evidence']},report['tiedContextChecks'])
assert scenarios['ranges']==report['sensitivity']['ranges'],'Sensitivity rank ranges differ'
assert scenarios['scenarios']==report['sensitivity']['scenarios'],'Sensitivity cases differ'
directory=HERE/f"results/opponents/{report['auditFingerprint'][:12]}";directory.mkdir(parents=True,exist_ok=True)
(directory/'opponent-audit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(f'Restored audit report; reproduced all {len(baseline)} FBS records/ranks and {len(scenarios["scenarios"])} sensitivity cases; no provider calls')
