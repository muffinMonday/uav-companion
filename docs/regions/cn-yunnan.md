# cn-yunnan

**Image-derived approximate suitable-flight geometry.** Not original GIS data, not a government release. Positive-only: areas outside the 14 polygons are unknown, never restricted.

## Source and provenance
- Source: a published image of the Yunnan provincial suitable-flight map (`yunnan_fly_zone.jpg`, 1080 x 942, SHA-256 `f5eb13252a7200471775ee88bb72eefe29d2f2902943358b45bfac7470e06820`, kept locally in `planning/`). No machine-readable Yunnan geometry could be obtained through the normal acquisition routes.
- UAV Companion extracted the geometry: colour segmentation of the visible suitable-flight area, owner-supplied corrections for areas hidden by labels and other artefacts (purple footprints restored as flyable, orange footprints forced unknown), and Web Mercator georeferencing calibrated on visible city control points.
- **Current geometry: corrected v2** (`planning/yunnan_fly_zone_corrected_v2.geojson`, SHA-256 `783fedf8e433ce4427c8a1aa784db0c1b07f5cb93bc69a8e5ae2da27a5329aad`), copied unchanged to `data/regions/cn/yunnan/zones.geojson`. Extraction metadata `planning/yunnan_fly_zone_corrected_v2_metadata.json`, SHA-256 `da6f26e293d447ca2c237e4bfa8b292ab151e0b6bb98139c5e6e3053dc99e9f4`. The metadata's extraction fields are recorded in `source.json` under `source.extraction` and reach the manifest.
- v2 supersedes v1 (`corrected-v1`, 11 polygons, SHA-256 `6e6d37af…ce4a`). v1 had incorrect georeferencing and was visibly offset west and north; it is no longer referenced by any production artefact.
- Accuracy: the v2 calibration fits 9 visible city control points with RMSE 1.381 km and maximum error 1.907 km (metadata `controlRmseKm` / `controlMaxErrorKm`). The metadata itself warns that local boundary error can exceed the control-point residuals. No metre-level accuracy is claimed. Coordinate alignment, completeness and currency are unverified; temporary restrictions are not included.
- Rights: owner-approved derivation for this project (`rightsBasis: owner-approved-image-derivation`, licence `LicenseRef-OwnerApproved-ImageDerived-Yunnan`); not an open licence and not verified permission to fly.

## Validation (v2, 2026-11-24)
- SHA-256 of `zones.geojson` verified equal to the v2 hash above (the value named in the owner's request).
- Valid FeatureCollection, 14 Polygon features, 161 rings (147 holes), 6,422 coordinates, every ring closed, longitude/latitude order, extent 97.7077 to 106.1951 E and 21.2607 to 29.1314 N. No coordinate was changed, repaired or reprojected; the build reads the file as supplied.
- The project's Shapely/GEOS check was not re-run for v2: no Python interpreter is installed on the build machine. The Yunnan unit test below checks the ring structure and the archive.
- Build: `cn-yunnan.8c769712.pmtiles`, 5.8 MB, 94,178 tiles, SHA-256 `8c76971230a016979bbf25a62bb1015c52de00c39c4e2b497383d8a6201fb267`. `tests/yunnan-unit.mjs` finds every one of the 14 source polygons in the archive at z14 (none lost), and a gap point and a hole point return no zone. The test's witness-point heuristic was changed to measure distance to edges (it had measured to vertices and picked a point on a thin polygon's edge, which the archive correctly did not return); no geometry changed.

## Classification and wording
- `semantics: allow`, `coverageMode: positive-only`, `sourceConfidence.mode: selected-source`, type `image-derived-approximate`. Point-check precedence is unchanged (authoritative regions first, then selected-source regions).
- `sourceConfidence.notice` carries the user warning: "Yunnan data was extracted from a published image of the official provincial suitable-flight map rather than original GIS data. Boundaries are approximate and may contain extraction or positional inaccuracies. Check the current official map before flying." It is shown in the Yunnan point-check detail line (`src/pointcheck.js`), the map key and the coverage note (`src/app/region-ui.js`). Any region may set `notice`; others do not.
- Loading and unloading use the generic region lifecycle; nothing is Yunnan-specific.

Rebuild: `node --max-old-space-size=8192 scripts/build-data.js cn-yunnan`, then `node scripts/preflight-data.js --restore` (the build drops regions that have no folder in `data/regions`; the restore copies them back from production).
