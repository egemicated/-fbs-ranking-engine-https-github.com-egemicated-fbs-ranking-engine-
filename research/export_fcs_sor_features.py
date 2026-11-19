"""Rebuild and verify cached Colley features; no fitting, fetching or publication.

Run with the already validated local Python/NumPy runtime.  The retained Round 2
cache is checked against its archived input and implementation fingerprints, then
every selected feature is independently reconstructed from the source seasons.
The exported fixture is public research data, not a production input.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CONTEXTS = ("prior-week-only", "excluded-game-final-network")
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None, "Source date needs an explicit timezone"
    return parsed.timestamp()


def graph(teams, games, inverse=False):
    index = {team["id"]: i for i, team in enumerate(teams)}
    matrix = np.eye(len(teams)) * 2
    rhs = np.zeros(len(teams))
    a = np.array([index[g["home"]] for g in games], dtype=int)
    b = np.array([index[g["away"]] for g in games], dtype=int)
    outcome = np.array([(g["homePoints"] > g["awayPoints"]) -
                        (g["homePoints"] < g["awayPoints"]) for g in games])
    np.add.at(matrix, (a, a), 1)
    np.add.at(matrix, (b, b), 1)
    np.add.at(matrix, (a, b), -1)
    np.add.at(matrix, (b, a), -1)
    np.add.at(rhs, a, outcome / 2)
    np.add.at(rhs, b, -outcome / 2)
    inv = np.linalg.inv(matrix) if inverse else None
    rating = .5 + (inv @ rhs if inverse else np.linalg.solve(matrix, rhs))
    assert np.max(np.abs(matrix @ (rating - .5) - rhs)) < 1e-9
    counts = np.zeros(len(teams), dtype=int)
    np.add.at(counts, a, 1)
    np.add.at(counts, b, 1)
    return index, rating, counts, inv, a, b, outcome


def rebuild(data):
    teams = sorted(data["teams"], key=lambda team: team["id"])
    divisions = {team["id"]: team["division"] for team in teams}
    games = [game for game in data["games"] if game["completed"]]
    assert len({g["id"] for g in games}) == len(games)
    assert all(g["home"] != g["away"] for g in games)
    groups = defaultdict(list)
    for game in games:
        groups[(game["seasonType"], game["week"])].append(game)

    def eligible(game):
        ds = [divisions[game[side]] for side in ("home", "away")]
        return all(d in ("fbs", "fcs") for d in ds) and "fcs" in ds and game["homePoints"] != game["awayPoints"]

    def row(game, difference, counts, index, cutoff=None, past=None):
        home, away = game["home"], game["away"]
        hd, ad = divisions[home], divisions[away]
        return dict(season=data["year"], gameId=game["id"], home=home, away=away,
                    homeDivision=hd, awayDivision=ad,
                    group="FCS-FCS" if hd == ad else "FBS-FCS",
                    startDate=game["startDate"],
                    block=f'{data["year"]}:{game["seasonType"]}:{game["week"]}',
                    x=[float(difference), 0 if game["neutral"] else 1,
                       int(hd == "fbs") - int(ad == "fbs")],
                    y=int(game["homePoints"] > game["awayPoints"]),
                    early=bool(min(counts[index[home]], counts[index[away]]) < 4),
                    cutoff=None if cutoff is None else datetime.fromtimestamp(cutoff, timezone.utc).isoformat(),
                    latestTrainingKickoff=None if not past else max(past, key=lambda g: timestamp(g["startDate"]))["startDate"],
                    trainingGames=None if past is None else len(past))

    result = {context: [] for context in CONTEXTS}
    seen = set()
    checkpoints = []
    for (kind, week), targets in sorted(groups.items(), key=lambda item: (min(timestamp(g["startDate"]) for g in item[1]), item[0])):
        cutoff = min(timestamp(g["startDate"]) for g in targets)
        past = sorted((g for g in games if g["id"] in seen and timestamp(g["startDate"]) + 86400 <= cutoff), key=lambda g: g["id"])
        assert not {g["id"] for g in past} & {g["id"] for g in targets}
        index, rating, counts, *_ = graph(teams, past)
        checkpoints.append(dict(season=data["year"], group=f"{kind}:{week}", cutoff=datetime.fromtimestamp(cutoff, timezone.utc).isoformat(),
                                eligibleGameIdsSha256=sha(json.dumps([g["id"] for g in past], separators=(",", ":")).encode()),
                                trainingGames=len(past)))
        for game in targets:
            if eligible(game):
                result[CONTEXTS[0]].append(row(game, rating[index[game["home"]]] - rating[index[game["away"]]], counts, index, cutoff, past))
        seen.update(g["id"] for g in targets)
    index, rating, counts, inv, a, b, outcome = graph(teams, games, True)
    denominator = 1 - inv[a, a] - inv[b, b] + 2 * inv[a, b]
    assert not len(denominator) or min(denominator) > 1e-10
    factor = (rating[a] - rating[b] - outcome / 2) / denominator
    home = rating[a] + (inv[a, a] - inv[a, b]) * factor
    away = rating[b] + (inv[a, b] - inv[b, b]) * factor
    for i, game in enumerate(games):
        if eligible(game):
            reduced = counts.copy()
            reduced[a[i]] -= 1
            reduced[b[i]] -= 1
            result[CONTEXTS[1]].append(row(game, home[i] - away[i], reduced, index))
    return result, checkpoints


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", default=str(ROOT.parent / "fbs-ranking-engine"))
    args = parser.parse_args()
    source_root = Path(args.input_root)
    report_path = ROOT / "research/results/round2/6489ccaec521/round2.json.gz"
    report_raw = report_path.read_bytes()
    unpacked_parent = gzip.decompress(report_raw)
    parent = json.loads(unpacked_parent)
    frozen = json.loads((ROOT / "research/frozen-division-comparison-v2.json").read_bytes())
    assert sha(unpacked_parent) == frozen["researchReportSha256"]
    assert parent["runFingerprint"] == "6489ccaec521c1337e8859fc5eb18205519ca8f7711805890815127b6636aaa0"
    release_raw = (ROOT / "research/releases/fcs-coverage-v1.json.gz").read_bytes()
    release_metadata = json.loads((ROOT / "research/releases/fcs-coverage-v1.metadata.json").read_bytes())
    assert sha(release_raw) == release_metadata["sha256"]
    release = json.loads(gzip.decompress(release_raw))
    manifest_raw = (source_root / "research/datasets/fcs-coverage-v1/manifest.json").read_bytes()
    manifest = json.loads(manifest_raw)
    assert manifest == release["manifest"]
    assert sha(manifest_raw) == parent["repairManifestSha256"]
    old_manifest_raw = (source_root / "research/datasets/historical-coverage-v1/manifest.json").read_bytes()
    old_manifest = json.loads(old_manifest_raw)
    assert sha(old_manifest_raw) == manifest["parentManifestSha256"]
    assert manifest["datasetFingerprint"] == frozen["datasetFingerprint"] == release_metadata["datasetFingerprint"]
    fixture = dict(status="Independently reconstructed offline research features; not predictions or production inputs",
                   parentFingerprint=parent["runFingerprint"], parentReportSha256=sha(report_raw),
                   parentUncompressedSha256=sha(unpacked_parent), releaseSha256=sha(release_raw),
                   repairManifestSha256=sha(manifest_raw), parentManifestSha256=sha(old_manifest_raw),
                   exporterSha256=sha(Path(__file__).read_bytes()), sourceHashes={}, cacheHashes={}, checkpoints=[],
                   verification={}, contexts={context: [] for context in CONTEXTS}, cfbdCalls=0)
    for year in range(2014, 2026):
        path = source_root / f"research/datasets/fcs-coverage-v1/seasons/{year}.json"
        raw = path.read_bytes()
        assert sha(raw) == parent["inputSha256"][str(year)], f"Dataset changed: {year}"
        assert sha(raw) == manifest["seasons"][str(year)]["outputSha256"]
        old_raw = (source_root / f"research/datasets/historical-coverage-v1/seasons/{year}.json").read_bytes()
        assert sha(old_raw) == manifest["seasons"][str(year)]["inputSha256"] == old_manifest["seasons"][str(year)]["outputSha256"]
        original_raw = (source_root / f"data/seasons/{year}.json").read_bytes()
        assert sha(original_raw) == old_manifest["seasons"][str(year)]["inputSha256"]
        fixture["sourceHashes"][str(year)] = sha(raw)
        key = sha((sha(raw) + json.dumps(parent["implementationSha256"], sort_keys=True) + "fullSource").encode())
        cache_path = source_root / f"research/cache/round2/{year}-{key}.npz"
        cache_raw = cache_path.read_bytes()
        fixture["cacheHashes"][str(year)] = sha(cache_raw)
        calculated, checkpoints = rebuild(json.loads(raw))
        fixture["checkpoints"].extend(checkpoints)
        errors = {}
        with np.load(cache_path, allow_pickle=False) as cached:
            for context, rows in calculated.items():
                ids = cached[f"{context}::ids"].tolist()
                assert len(ids) == len(set(ids))
                positions = {identity: i for i, identity in enumerate(ids)}
                error = 0.
                for row in rows:
                    j = positions[row["gameId"]]
                    error = max(error, float(np.max(np.abs(np.array(row["x"]) - cached[f"{context}::x"][j]))))
                    assert row["y"] == cached[f"{context}::y"][j]
                    assert row["group"] == cached[f"{context}::group"][j]
                    assert row["early"] == bool(cached[f"{context}::early"][j])
                    assert row["block"] == cached[f"{context}::block"][j]
                assert error < 1e-9, f"Cache mismatch: {year}, {context}, {error}"
                assert len(rows) == sum(cached[f"{context}::group"] != "FBS-FBS")
                errors[context] = dict(rows=len(rows), maxAbsoluteFeatureError=error)
                fixture["contexts"][context].extend(rows)
        fixture["verification"][str(year)] = errors
        print(f"Verified {year}: {errors}", flush=True)
    output = ROOT / "research/results/division-calibration-v1"
    output.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(fixture, separators=(",", ":"), sort_keys=True) + "\n").encode()
    packed = gzip.compress(encoded, mtime=0)
    (output / "fcs-features.json.gz").write_bytes(packed)
    (output / "fcs-features.metadata.json").write_text(json.dumps(dict(fixtureSha256=sha(packed),
        uncompressedSha256=sha(encoded), bytes=len(encoded), compressedBytes=len(packed),
        rows={context: len(rows) for context, rows in fixture["contexts"].items()},
        verification=fixture["verification"], cfbdCalls=0), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
