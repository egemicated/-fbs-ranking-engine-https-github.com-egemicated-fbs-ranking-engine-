"""Restore the frozen research dataset from its compact versioned supplement.

Requires the exact cached original data/seasons inputs. Never overwrites them.
No NumPy, network, keys, polls or ranking overrides are used.
"""
import gzip
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent; ROOT=HERE.parent
path=HERE/"releases/historical-coverage-v1.json.gz"
metadata=json.loads((HERE/"releases/historical-coverage-v1.metadata.json").read_text())
raw=path.read_bytes()
if hashlib.sha256(raw).hexdigest()!=metadata["sha256"]:raise ValueError("Release checksum mismatch")
release=json.loads(gzip.decompress(raw))
directory=HERE/"datasets/historical-coverage-v1"; (directory/"seasons").mkdir(parents=True,exist_ok=True)
for year,patch in release["seasons"].items():
    source=(ROOT/f"data/seasons/{year}.json").read_bytes()
    if hashlib.sha256(source).hexdigest()!=patch["parentSha256"]:raise ValueError(f"Original {year} differs; do not silently mix source versions")
    data=json.loads(source);drops=set(patch["removeIds"])
    data["games"]=[g for g in data["games"] if g["id"] not in drops]+patch["addGames"]
    data["source"]={**data["source"],"researchRepair":patch["researchRepairMetadata"]}
    encoded=(json.dumps(data,indent=2)+"\n").encode()
    if hashlib.sha256(encoded).hexdigest()!=patch["outputSha256"]:raise ValueError(f"Restored {year} checksum mismatch")
    (directory/f"seasons/{year}.json").write_bytes(encoded)
(directory/"manifest.json").write_text(json.dumps(release["manifest"],indent=2)+"\n",encoding="utf-8")
print(f'Restored {len(release["seasons"])} research seasons with exact output checksums; originals unchanged')
