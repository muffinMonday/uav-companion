"""Independent, read-only topology/filtering audit of archived pilot responses.

python scripts/china-airspace/validate_geos.py
Optional dependencies may be installed in planning/china-airspace/python-vendor.
No network, reprojection, repair, simplification or source-geometry output.
"""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "planning/china-airspace"
VENDOR = STAGING / "python-vendor"
if VENDOR.exists():
    sys.path.insert(0, str(VENDOR))
import shapely
import numpy
from shapely.geometry import shape, box
from shapely.strtree import STRtree


def digest(data):
    return hashlib.sha256(data).hexdigest()


def overlaps(geometries, ids):
    tree = STRtree(geometries)
    pairs, errors, touches = [], [], 0
    for i, g in enumerate(geometries):
        for index in tree.query(g):
            j = int(index)
            if j <= i:
                continue
            try:
                intersection = g.intersection(geometries[j])
                if intersection.area > 0:
                    pairs.append({"a": ids[i], "b": ids[j], "areaDegreesSquared": intersection.area})
                elif not intersection.is_empty:
                    touches += 1
            except shapely.errors.GEOSException as error:
                errors.append({"a": ids[i], "b": ids[j], "error": str(error)})
    return {"complete": not errors, "positiveAreaPairs": pairs, "boundaryTouchPairCount": touches, "errors": errors}


def main():
    manifest_bytes = (ROOT / "data/china-airspace/fixture-manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes.decode("utf-8-sig"))
    result = {
        "schemaVersion": 1, "manifestSha256": digest(manifest_bytes),
        "engine": {"shapely": shapely.__version__, "geos": shapely.geos_version_string, "numpy": numpy.__version__},
        "method": "Unmodified source coordinates; planar GEOS validity and intersections. No repair or CRS alignment verification.",
        "fixtures": [], "regions": [], "integrationReady": False,
    }
    regions = {}
    for entry in manifest["fixtures"]:
        raw = (ROOT / entry["archive"]).read_bytes()
        if digest(raw) != entry["sha256"]:
            raise ValueError("Source checksum mismatch: " + entry["file"])
        collection = json.loads(raw.decode("utf-8-sig"))
        geometries = [shape(feature["geometry"]) for feature in collection["features"]]
        ids = [feature["properties"]["id"] for feature in collection["features"]]
        invalid = [{"index": i, "id": ids[i], "reason": str(shapely.is_valid_reason(g))} for i, g in enumerate(geometries) if not g.is_valid]
        b = collection["bounds"]
        query = box(b["west"], b["south"], b["east"], b["north"])
        non_intersecting = [ids[i] for i, g in enumerate(geometries) if not g.intersects(query)]
        result["fixtures"].append({
            "file": entry["file"], "sourceSha256": entry["sha256"], "features": len(geometries),
            "validFeatures": len(geometries) - len(invalid), "invalidFeatures": invalid,
            "queryGeometryNonIntersections": non_intersecting,
            "featuresExtendingBeyondQuery": sum(not query.covers(g) for g in geometries),
            "overlaps": overlaps(geometries, ids),
        })
        region = regions.setdefault(entry["region"], {"items": {}, "conflicts": []})
        for ident, geometry in zip(ids, geometries):
            fingerprint = digest(geometry.normalize().wkb)
            previous = region["items"].get(ident)
            if previous and previous[1] != fingerprint:
                region["conflicts"].append(ident)
            else:
                region["items"][ident] = (geometry, fingerprint)
    for ident, region in regions.items():
        ids = sorted(region["items"])
        geometries = [region["items"][i][0] for i in ids]
        result["regions"].append({"region": ident, "uniqueIds": len(ids), "idConflicts": sorted(set(region["conflicts"])), "overlaps": overlaps(geometries, ids)})
    out = STAGING / "local-pilots/geos-report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(out.relative_to(ROOT)), "engine": result["engine"], "fixtures": [{"file": f["file"], "valid": f["validFeatures"], "invalid": len(f["invalidFeatures"]), "overlaps": len(f["overlaps"]["positiveAreaPairs"])} for f in result["fixtures"]]}))


if __name__ == "__main__":
    main()
