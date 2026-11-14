"""Read-only independent winding audit. No repair, reprojection or geometry output."""
import json
import sys
from collections import Counter
from pathlib import Path

# Same optional dependencies as the existing acquisition audit.
vendor = Path(__file__).resolve().parents[2] / "planning/china-airspace/python-vendor"
if vendor.exists():
    sys.path.insert(0, str(vendor))
import shapely
from shapely.geometry import shape
from shapely.strtree import STRtree


def audit(before, after):
    if len(before["features"]) != len(after["features"]):
        raise ValueError("feature count changed")
    geometries = []
    for a, b in zip(before["features"], after["features"]):
        ga, gb = a["geometry"], b["geometry"]
        if {k: v for k, v in a.items() if k != "geometry"} != {k: v for k, v in b.items() if k != "geometry"}:
            raise ValueError("feature identity/properties changed")
        if ga["type"] != gb["type"]:
            raise ValueError("geometry type changed")
        pa = [ga["coordinates"]] if ga["type"] == "Polygon" else ga["coordinates"]
        pb = [gb["coordinates"]] if gb["type"] == "Polygon" else gb["coordinates"]
        if len(pa) != len(pb):
            raise ValueError("component count changed")
        for p, q in zip(pa, pb):
            if len(p) != len(q):
                raise ValueError("hole count changed")
            for i, (r, s) in enumerate(zip(p, q)):
                if Counter(map(tuple, r[:-1])) != Counter(map(tuple, s[:-1])):
                    raise ValueError("ring coordinates changed")
                if s[0] != s[-1] or shape({"type": "Polygon", "coordinates": [s]}).exterior.is_ccw != (i == 0):
                    raise ValueError("closure/winding mismatch")
        x, y = shape(ga), shape(gb)
        if not x.is_valid or not y.is_valid or x.is_empty or y.is_empty:
            raise ValueError("invalid geometry: " + str(shapely.is_valid_reason(x)))
        if x.bounds != y.bounds or not x.equals(y):
            raise ValueError("topology/extents changed")
        geometries.append(y)
    tree = STRtree(geometries)
    for i, g in enumerate(geometries):
        for index in tree.query(g):
            j = int(index)
            if j > i and g.intersection(geometries[j]).area > 0:
                raise ValueError(f"positive-area overlap: {i}/{j}")
    return {"valid": True, "features": len(geometries), "shapely": shapely.__version__, "geos": shapely.geos_version_string}


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    print(json.dumps(audit(payload["before"], payload["after"])))
