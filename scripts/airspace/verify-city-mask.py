"""Read-only GEOS checks and witnesses for a source and administrative mask.

Usage: python scripts/airspace/verify-city-mask.py zones.geojson boundary.geojson
Uses the existing optional requirements-geos.txt environment; never repairs geometry.
"""
import json
import sys
from pathlib import Path

vendor = Path(__file__).resolve().parents[2] / 'planning/china-airspace/python-vendor'
if vendor.exists():
    sys.path.insert(0, str(vendor))
import shapely
from shapely.geometry import shape, Point, box
from shapely.strtree import STRtree

source = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
boundary = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
mask = shape(boundary['geometry'] if boundary['type'] == 'Feature' else boundary)
assert mask.is_valid and not mask.is_empty, 'invalid administrative boundary'
assert mask.geom_type in ('Polygon', 'MultiPolygon')
geometries = [shape(f['geometry']) for f in source['features']]
assert all(g.is_valid and not g.is_empty for g in geometries), 'invalid source geometry'
tree = STRtree(geometries)
for i, g in enumerate(geometries):
    for j in tree.query(g):
        assert j <= i or g.intersection(geometries[j]).area == 0, 'source overlap'

def witness(g):
    p = g.representative_point()
    return {'lon': p.x, 'lat': p.y}

features = []
for f, g in zip(source['features'], geometries):
    inside, outside = g.intersection(mask), g.difference(mask)
    # Include outside-city points within the mask's bbox: a bbox gate cannot pass this test.
    outside_bbox = outside.intersection(box(*mask.bounds))
    features.append({
        'id': f.get('id', f.get('properties', {}).get('id')),
        'originalInterior': witness(g),
        'maskedInterior': witness(inside) if inside.area > 0 else None,
        'outsideMaskInterior': witness(outside) if outside.area > 0 else None,
        'outsideMaskWithinBounds': witness(outside_bbox) if outside_bbox.area > 0 else None,
        'crossesMask': inside.area > 0 and outside.area > 0,
    })

print(json.dumps({
    'valid': True, 'shapely': shapely.__version__, 'geos': shapely.geos_version_string,
    'sourceFeatures': len(features), 'maskBounds': list(mask.bounds),
    'maskAreaKm2Approx': mask.area * 111.32 * 110.54 * __import__('math').cos(mask.centroid.y * __import__('math').pi / 180),
    'intersectingFeatures': sum(f['maskedInterior'] is not None for f in features),
    'crossingFeatures': sum(f['crossesMask'] for f in features),
    'features': features,
}))
