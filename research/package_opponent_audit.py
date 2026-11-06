"""Preserve normalized research evidence and the baseline outcome graph offline."""
import gzip
import hashlib
import json
from pathlib import Path

from compare_merit import ROOT,current_dataset

HERE=Path(__file__).resolve().parent
directory=HERE/'results/opponents/17711b9bc8c1'
report=json.loads((directory/'opponent-audit.json').read_text())
snapshot=json.loads((ROOT/'published/latest.json').read_text())
assert report['snapshotHash']==snapshot['snapshotHash']
dataset=current_dataset(snapshot)
dataset['teams']=[{k:t[k] for k in ('id','name','division','conference','games')} for t in dataset['teams']]
packet={'report':report,'baselineGraph':dataset,
        'baselineFileSource':'https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/blob/afe5736a994e3eaf47c57440973f9dd3d1fded61/published/latest.json',
        'limits':'Normalized later-source evidence plus baseline outcome graph; original public response hashes are retained, but this packet does not reproduce full raw public response bytes.'}
raw=gzip.compress(json.dumps(packet,separators=(',',':')).encode(),mtime=0)
target=HERE/'releases/opponent-audit-2026-11-05.json.gz';target.write_bytes(raw)
metadata={'file':target.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'snapshotHash':snapshot['snapshotHash'],
          'auditFingerprint':report['auditFingerprint'],'counts':report['counts'],'scenarios':len(report['sensitivity']['scenarios'])}
(target.parent/'opponent-audit-2026-11-05.metadata.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
print(json.dumps(metadata,indent=2))
