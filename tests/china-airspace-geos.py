"""Optional cross-check harness: python tests/china-airspace-geos.py."""
import runpy
import unittest
from pathlib import Path

module = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/china-airspace/validate_geos.py"))
shape, overlaps = module["shape"], module["overlaps"]


class GeosCrossCheck(unittest.TestCase):
    def test_valid_point_contact_is_not_repaired_or_rejected(self):
        geometry = shape({"type": "Polygon", "coordinates": [[[0,0],[4,0],[4,4],[0,4],[0,0]], [[0,2],[1,1],[1,3],[0,2]]]})
        self.assertTrue(geometry.is_valid)
        self.assertEqual(len(geometry.interiors), 1)

    def test_self_intersection_is_invalid(self):
        geometry = shape({"type": "Polygon", "coordinates": [[[0,0],[2,2],[0,2],[2,0],[0,0]]]})
        self.assertFalse(geometry.is_valid)

    def test_positive_area_and_boundary_touches_are_separate(self):
        a, b = module["box"](0,0,2,2), module["box"](1,1,3,3)
        report = overlaps([a,b], ["a","b"])
        self.assertEqual(report["positiveAreaPairs"][0]["areaDegreesSquared"], 1)
        touch = overlaps([a,module["box"](2,0,3,2)], ["a","c"])
        self.assertEqual(touch["positiveAreaPairs"], [])
        self.assertEqual(touch["boundaryTouchPairCount"], 1)


if __name__ == "__main__":
    unittest.main()
