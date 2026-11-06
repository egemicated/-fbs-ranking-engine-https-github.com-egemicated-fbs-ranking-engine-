"""Restore pinned public team boxscores without changing the source snapshot.

Run with --cached-only to verify local files without making any requests. Normal
mode downloads missing or damaged files from the pinned GitHub release only.
Neither mode reads credentials or calls CollegeFootballData.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "research/results/performance/source-manifest.json"
DEFAULT_CACHE = ROOT / "research/cache/performance"
RELEASE_PREFIX = (
    "https://github.com/sportsdataverse/sportsdataverse-data/releases/"
    "download/espn_cfb_team_box/"
)
CHUNK_SIZE = 64 * 1024


class SourceError(ValueError):
    """A source does not match the pinned provenance manifest."""


class ReleaseRedirects(HTTPRedirectHandler):
    """Allow GitHub's HTTPS release delivery hosts, without authentication."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if (
            target.scheme != "https"
            or target.hostname not in {
                "release-assets.githubusercontent.com",
                "objects.githubusercontent.com",
                "github-releases.githubusercontent.com",
            }
            or target.username is not None
            or target.password is not None
            or target.port not in (None, 443)
        ):
            raise SourceError("Release redirected outside GitHub asset delivery")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def read_pins(manifest_bytes):
    """Validate every pin before any file writes or requests are possible."""
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict):
        raise SourceError("Manifest must be an object")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise SourceError("Manifest must contain a nonempty files list")
    seen = set()
    pins = []
    for entry in files:
        if not isinstance(entry, dict):
            raise SourceError("Manifest file entry must be an object")
        year = entry.get("year")
        if type(year) is not int or not 1000 <= year <= 9999:
            raise SourceError("Manifest file year must contain four digits")
        name = f"team_box_{year}.csv"
        if entry.get("name") != name or entry.get("downloadUrl") != RELEASE_PREFIX + name:
            raise SourceError(f"Unapproved source URL or filename for {year}")
        size, digest = entry.get("bytes"), entry.get("sha256")
        if type(size) is not int or size <= 0:
            raise SourceError(f"Invalid byte count for {name}")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
            raise SourceError(f"Invalid SHA-256 for {name}")
        digest = digest.lower()
        if "expectedBytes" in entry and entry["expectedBytes"] != size:
            raise SourceError(f"Conflicting byte counts for {name}")
        if "releaseDigest" in entry:
            release_digest = entry["releaseDigest"]
            if not isinstance(release_digest, str) or release_digest.lower() != "sha256:" + digest:
                raise SourceError(f"Conflicting SHA-256 values for {name}")
        if name in seen:
            raise SourceError(f"Duplicate source file: {name}")
        seen.add(name)
        pins.append({"name": name, "url": entry["downloadUrl"], "bytes": size, "sha256": digest})
    return pins


def matches_pin(path, pin):
    if not path.is_file() or path.stat().st_size != pin["bytes"]:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest() == pin["sha256"]


def download_pin(pin, target, opener):
    """Verify the full temporary download before replacing any cached file."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".performance-", delete=False) as output:
            temporary = Path(output.name)
            digest, count = hashlib.sha256(), 0
            request = Request(pin["url"], headers={"User-Agent": "FBS-Intelligence-pinned-source/1"})
            with opener.open(request, timeout=60) as response:
                while True:
                    chunk = response.read(min(CHUNK_SIZE, pin["bytes"] - count + 1))
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > pin["bytes"]:
                        raise SourceError(f"Pinned size differs for {pin['name']}; source snapshot unchanged")
                    digest.update(chunk)
                    output.write(chunk)
            if count != pin["bytes"] or digest.hexdigest() != pin["sha256"]:
                raise SourceError(f"Pinned bytes/SHA-256 differ for {pin['name']}; source snapshot unchanged")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def save_manifest(manifest_bytes, target):
    if target.is_file() and target.read_bytes() == manifest_bytes:
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".performance-manifest-", delete=False) as output:
            temporary = Path(output.name)
            output.write(manifest_bytes)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def materialize(manifest_path=DEFAULT_MANIFEST, cache_dir=DEFAULT_CACHE, *, cached_only=False, opener=None):
    manifest_bytes = Path(manifest_path).read_bytes()
    pins = read_pins(manifest_bytes)
    cache_dir = Path(cache_dir)
    missing = [pin for pin in pins if not matches_pin(cache_dir / pin["name"], pin)]
    if missing and cached_only:
        raise SourceError("Missing or mismatched cached files: " + ", ".join(pin["name"] for pin in missing))
    cache_dir.mkdir(parents=True, exist_ok=True)
    if missing:
        opener = opener if opener is not None else build_opener(ReleaseRedirects())
        for pin in missing:
            download_pin(pin, cache_dir / pin["name"], opener)
    # Preserve the pinned file verbatim, including whitespace and provenance dates.
    save_manifest(manifest_bytes, cache_dir / "manifest.json")
    return {"verifiedFiles": len(pins), "cachedFiles": len(pins) - len(missing),
            "downloadedFiles": len(missing), "cfbdCalls": 0, "cachedOnly": cached_only}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--cached-only", action="store_true", help="Fail if a pinned file is missing or damaged; never use the network")
    args = parser.parse_args()
    try:
        result = materialize(args.manifest, args.cache_dir, cached_only=args.cached_only)
    except (OSError, ValueError) as exc:
        print(f"Source verification failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
