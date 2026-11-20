# cn-yunnan

**Image-derived approximate suitable-flight geometry.** Not original GIS data, not a government release. Positive-only: areas outside the 11 polygons are unknown, never restricted.

## Source and provenance
- Source: a published image of the Yunnan provincial suitable-flight map (`yunnan_fly_zone.jpg`, 1080 x 942, SHA-256 `f5eb13252a7200471775ee88bb72eefe29d2f2902943358b45bfac7470e06820`, kept locally in `planning/`). No machine-readable Yunnan geometry could be obtained through the normal acquisition routes.
- UAV Companion extracted the geometry: colour segmentation of the visible suitable-flight area, owner-supplied corrections for areas hidden by labels and other artefacts (purple footprints restored as flyable, orange footprints forced unknown), linear georeferencing to the published Yunnan extent, vectorization. The owner approved the result as the production candidate on 2026-11-20.
- Candidate file `data/regions/cn/yunnan/zones.geojson` (from `planning/yunnan_fly_zone_corrected_v1.geojson`): SHA-256 `6e6d37af8a49f62195a914e4eebdd907efff977686bd401bfd98a0a02956ce4a`; extraction metadata `planning/yunnan_fly_zone_corrected_v1_metadata.json`, SHA-256 `46b762e98010977e19446438e95f5bed07f89ede871dcc4604dc8db74352ad1c`. The metadata is preserved verbatim in `source.json` under `source.extraction` and reaches the manifest.
- Accuracy: the georeferencing is a linear fit to the Yunnan extent (97.5275, 21.1422, 106.1964, 29.2522); boundary-to-boundary registration is still recommended. No metre-level accuracy is claimed. Coordinate alignment, completeness and currency are unverified; temporary restrictions are not included.
- Rights: owner-approved derivation for this project (`rightsBasis: owner-approved-image-derivation`, licence `LicenseRef-OwnerApproved-ImageDerived-Yunnan`); not an open licence and not verified permission to fly.

## Validation (2026-11-21)
- Valid FeatureCollection, 11 Polygon features, 1240 coordinates, 43 holes (all in the large polygon), every ring closed, longitude/latitude order, extent 97.5275 to 106.1964 E and 21.1422 to 29.2522 N (a plausible Yunnan extent). No coordinate was changed, repaired or reprojected; the build reads the file as supplied.
- GEOS 3.14.1 / Shapely 2.2.0: all 11 features valid.
- Build: `cn-yunnan.c03b1a7d.pmtiles`, 5,266,848 bytes, 89,183 tiles, SHA-256 `c03b1a7d2e253b36393cb0bd2556febdc525ca9da4ae1dd9d382566167a6015b`. `tests/yunnan-unit.mjs` finds every one of the 11 polygons in the archive at z14 (none lost to quantization), and a gap point and a hole point return no zone.

## Classification and wording
- `semantics: allow`, `coverageMode: positive-only`, `sourceConfidence.mode: selected-source`, type `image-derived-approximate`. Point-check precedence is unchanged (authoritative regions first, then selected-source regions).
- `sourceConfidence.notice` carries the user warning: "Yunnan data was extracted from a published image of the official provincial suitable-flight map rather than original GIS data. Boundaries are approximate and may contain extraction or positional inaccuracies. Check the current official map before flying." It is shown in the Yunnan point-check detail line (`src/pointcheck.js`), the map key and the coverage note (`src/app/region-ui.js`). Any region may set `notice`; others do not.
- Loading and unloading use the generic region lifecycle; nothing is Yunnan-specific.

Rebuild: `node --max-old-space-size=8192 scripts/build-data.js cn-yunnan`, then `node scripts/preflight-data.js --restore` (the build drops regions that have no folder in `data/regions`; the restore copies them back from production).
