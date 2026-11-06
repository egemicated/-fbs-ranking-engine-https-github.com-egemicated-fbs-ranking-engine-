"""Package frozen additions, explicit removals, provenance and checksums."""
import gzip
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent; ROOT=HERE.parent
directory=HERE/"datasets/historical-coverage-v1"
manifest=json.loads((directory/"manifest.json").read_text())
release={"manifest":manifest,"seasons":{}}
for year,audit in manifest["seasons"].items():
    repaired=json.loads((directory/f"seasons/{year}.json").read_text())
    added={g["id"] for g in audit["added"]}
    release["seasons"][year]={"parentSha256":audit["inputSha256"],"outputSha256":audit["outputSha256"],
                              "removeIds":audit["removedDuplicates"],
                              "addGames":[g for g in repaired["games"] if g["id"] in added],
                              "researchRepairMetadata":repaired["source"]["researchRepair"]}
encoded=gzip.compress(json.dumps(release,separators=(",",":")).encode(),mtime=0)
target=HERE/"releases/historical-coverage-v1.json.gz";target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(encoded)
metadata={"file":target.name,"sha256":hashlib.sha256(encoded).hexdigest(),"bytes":len(encoded),
          "datasetFingerprint":manifest["datasetFingerprint"],"addedGames":manifest["totals"]["addedPostseasonGames"],
          "removedDuplicates":manifest["totals"]["removedDuplicateOccurrences"]}
(target.parent/"historical-coverage-v1.metadata.json").write_text(json.dumps(metadata,indent=2)+"\n")
print(json.dumps(metadata,indent=2))
