# Focused acquisition follow-up

2026-11-14. PR #4 confirmed merged; isolated branch `feature/airspace-focused-followup` starts from `main` at `5eb713e`. No nationwide research or changes to UI, production registration, source coordinates, geometry predicates or flight-zone semantics.

| Dataset | Result |
|---|---|
| Hunan | Direct original shapefile accepted; all **102,483** records preserved and independently GEOS-audited. Explicit `topologyBudget: 3000000`; full local PMTiles build, **51,340 tiles**, six source/application point checks and real Leaflet rendering passed. Output: ignored `planning/followup-hunan-build/`. |
| Jilin | Original geographic `WGS84(DD)` PRJ accepted directly. All **79,784** original shapefile records staged with coordinate/property/winding equivalence checked independently by GEOS. Output: ignored `planning/followup-jilin-direct/`. |
| Ningxia | Installed **UnRAR 7.23 x64** extracted the already archived RAR5 successfully (`e -p- -o-`, All OK). Actual SHP/SHX/DBF/PRJ/FIX files identified. **36,341** features; DBF/SHX counts agree, geographic WGS84(DD)/EPSG:4326 declaration. Conservative validation and full independent GEOS winding/equivalence/overlap audit pass for every feature. |

Detailed reports and original sidecar hashes: [Hunan](evidence/followup/cn-hunan.json), [Jilin](evidence/followup/cn-jilin.json), [Ningxia](evidence/followup/cn-ningxia.json). Original geometry and archives remain ignored/local. Ningxia original SHA-256 remains `a211ee4eae463dd65fbc991defb3b6cc1a68e3c5aa3ac8d69a8c96b850a2f68d`; no new source download.

Ningxia staging preflight was attempted and rejected: `Missing authority/effective date/license`. Its official notice's publication date is not an established effective date. `source.effective` remains null; no date or approval was fabricated to satisfy the CLI. No Ningxia staging completion marker, build or promotion candidate is claimed. Extraction timestamps (March 28) also do not establish legal validity. A reviewed effective date, coverage boundary and source evidence are still required.

The CLI's optional top-level `topologyBudget` retains the 2,000,000 default and accepts positive safe integers up to 100,000,000. Exhaustion remains fatal; the budget used is recorded in policy reports. All predicates and independent GEOS checks are unchanged. The new PRJ spelling requires a geographic GEOGCS root, WGS84 datum and ellipsoid, Greenwich prime meridian and degree units. Projected CRS, unknown names, conflicting datums, wrong ellipsoids/meridians and radian units are regression-tested as rejected. Existing supported geographic names remain supported.

Verification: **13/13 integration tests pass**, including the new budget and PRJ cases; application build passes. The required impact runner selected all 54 unit suites: **53 passed, one failed** (`places-unit`, fixed date-label text). The same 22-pass/1-fail result reproduces on unchanged merged-main source in the Phase 1 checkout; it is unrelated and left outside scope. Full UI tests were not required for these offline script changes. Final real-source preflights passed after tightening PRJ recognition; reports retain the code hashes from the original successful build/stage runs.

All six source/production approval gates remain pending. Diagnostic Natural Earth boundaries retain the Phase 1 caveats; no boundary was promoted or used to clip source geometry. No production registration, publication, merge or deployment. Rollback is discarding the ignored local outputs and this branch; production is unchanged.
