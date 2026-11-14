# Phase 1 acquisition review

Checked 2026-11-14 against merged `main` at `31a3799149c9ab24306a76f28834283b6984e47a` (PR #3, including the completed UX baseline). Branch: `feature/china-airspace-phase1`; isolated worktree: `.worktrees/china-airspace-phase1`. This is an acquisition/evidence review, not a production-registration request. Geographic data does not grant permission to fly.

## Progress

| New milestone | Jilin | Hunan | Shanxi | Shandong | Ningxia (Batch B) |
|---|---|---|---|---|---|
| Official vector acquired | Yes | Yes | No | No | GIS-labelled RAR acquired; members unverified |
| Full geometry technically audited | 79,784 cells; pass | 102,483 cells; pass, CLI budget blocker | No | No | No |
| Existing CLI staging | Pass | Blocked; no subset substituted | No | No | No |
| Local PMTiles + smoke | Pass, 16 points + rendering | Blocked | No | No | No |
| All required source evidence verified | No | No | No | No | No |
| Promotion candidate ready | No | No | No | No | No |
| Production registered / live deployed | No / No | No / No | No / No | No / No | No / No |

**Two official vector datasets, 182,267 original polygons audited; one complete local build. Zero new approvals, production regions or deployments.** Hubei's existing registration is unchanged. All six approval categories remain pending; no reviewer or approval evidence was invented.

Reports: [Jilin](evidence/phase1/cn-jilin.json), [Hunan](evidence/phase1/cn-hunan.json), [download/member checksums and failures](evidence/phase1/acquisition-manifest.json). Paths in reports are relative to the new worktree. All source bytes, extracted sidecars, geometry, PDF maps, screenshots and PMTiles stay in ignored `planning/china-airspace/phase1/`; the PR contains metadata and reports only.

## Acquired originals and source findings

| Region | Official notice / attachment | Observation |
|---|---|---|
| Jilin | [May 12 notice](https://jtyst.jl.gov.cn/zw_133208/tzgg/202605/t20260512_9599843.html), [grid ZIP](https://jtyst.jl.gov.cn/zw_133208/tzgg/202605/P020260512515648788871.zip) | Ordinary Windows curl GET: HTTP 200, 2,321,391 bytes. SHP/SHX/DBF/PRJ/FIX inspected; notice states activation May 14 at 00:00. Earlier web-tool 403 remains historical; no spoofed headers, credentials or challenge bypass used. |
| Hunan | [May 13 notice](https://fgw.hunan.gov.cn/fgw/xxgk_70899/gzdtf/gzdt/202605/t20260513_33975865.html), [grid ZIP](https://fgw.hunan.gov.cn/fgw/xxgk_70899/gzdtf/gzdt/202605/33975865/files/664bcd483b7d4a0783a4aebd81134cd5.zip) | HTTP 200, 2,928,930 bytes. SHP/SHX/DBF/PRJ/FIX inspected; activation May 14 at 00:00. Paired PDF downloaded (3,103,771 bytes); no map geometry reconstructed. |
| Ningxia | [published mobile notice](https://jtt.nx.gov.cn/xwzx/tzgg/202605/t20260511_5236967_wap.html), [RAR](https://jtt.nx.gov.cn/xwzx/tzgg/202605/P020260526350229632001.rar) | Both HTTP 200; RAR is 716,438 bytes with RAR5 magic. Windows tar cannot read its filenames; contents/CRS/counts remain unverified. Notice says suitable airspace below 120 m true height for micro/light/small UAVs. Notice published May 11; attachment HTTP Last-Modified May 26: version/effective-date reconciliation remains open. |
| Shandong | [May 14 notice](https://jtt.shandong.gov.cn/art/2026/5/14/art_15843_10329329.html), [attachment labelled SHP](https://jtt.shandong.gov.cn/module/download/downfile.jsp?classid=0&filename=fbfc632be0e646a0a567a0e36ed0402a.docx) | HTTP 200, 21,323 bytes; actual Word OOXML document, no embedded GIS. Text points to `https://pan.baidu.com/s/1shXAgndPUmOV6i7OBUIviA`, published code `5igr`. No login/share access flow attempted. |

Original ZIP SHA-256:

- Jilin: `04211e891698153926cf547575bfe0dbd3efcc52ad5efc394aa79b82cb2b692b`.
- Hunan: `60c5eab1adffda18f336c98ef2ae2ff9b5291ac3c9e87c0ca5181348f8edbf39`.

The Jilin paired PDF request timed out at 40 seconds after 5,111,526 of 9,228,666 bytes. Its `.pdf.partial` is retained and checksummed as incomplete, never used as authoritative map evidence. Python's initial sandbox network failure and TLS failure on Hunan preceded the successful ordinary Windows HTTPS download; TLS verification remained enabled.

No redistribution licence was found in the two inspected ZIPs or their announcement bodies. These observations do not establish permission to redistribute official data, derived GeoJSON or public tiles. Ningxia's archive terms are uninspected. Source/authority review remains a human approval gate despite observed government-hosted download provenance.

## Supersession and blocked leads

- **Shanxi:** [September 20 official URL lead](https://jtyst.shanxi.gov.cn/jtzx/tzgg/202609/t20260920_10223695.shtml) was located through a single metadata-only public notice-index request. Both it and the old February URL failed to connect (curl exit 28, HTTP 000). No attachment URL was obtained. [Secondary reporting](https://www.peopleapp.com/column/30053182644-500007707212) describes activation September 20; primary contents remain unverified. Do not approve the February extent.
- **Shandong:** [September reporting](https://news.e23.cn/shandong/2026-09-22/2026092200048.html) identifies a September 20 provincial DRC revision. Its original government URL and current download are unresolved. The May document's cloud link is not a current provincial dataset.
- **Jilin/Hunan:** targeted searches for later revisions found no superseding official notice. This limited negative result is not proof of current validity; recurring/temporary controls and the legal scope still need review.
- **Anhui:** additional official GIS lead `https://jtt.ah.gov.cn/gsgg/123369181.html` returned 403 in the web tool; stopped. No client/header variation or attachment probing.
- **Fujian:** rechecked original notice still exposes a JPG only. Third-party claims of official vectors do not establish an obtainable download.
- **Tianjin:** the [September 30 primary notice](https://www.tj.gov.cn/sy/tzgg/202609/t20260930_7386087.html) was inspected and preserved. It expressly replaces the June notice and describes the entire administrative area as controlled airspace from publication. A future `restrict` proposal needs separate semantics review; no boundary was substituted for an airspace dataset here.

The third-party index was used only to find original notice URLs, with `include_geometry=false`. Its mapped-status, dates and classifications are leads, not verified regulatory facts. No KDji geometry API requests or cloud authentication were made.

## Full-source technical validation

Both ZIPs have one shapefile with matching SHP record counts, SHX entries and DBF records; declared SHP byte lengths and end-of-file record alignment agree. Every `name` grid code is unique; all features are non-null, two-dimensional, axis-aligned rectangular Polygons with five closed-ring positions and no holes or multipart geometry. No record was dropped or deduplicated.

Both PRJs declare geographic `WGS84(DD)` / datum `WGS84`, degree units, longitude/latitude axes and EPSG:4326. This establishes the declared convention, not landmark alignment. Existing winding normalization reverses/rotates rings only. Independent Shapely 2.2.0 / GEOS 3.14.1 audits passed for every feature: identity/properties, exact per-ring coordinate multisets, closure/winding, extents, topology/equality and absence of positive-area overlaps. No clipping, snapping, buffering, simplification, reprojection or geometry repair was used.

Two existing workflow limits were recorded without modifying infrastructure:

1. Direct shapefile staging rejects the source's geographic `WGS84(DD)` spelling because the existing PRJ regular expression expects a separator in `WGS 84`. For Jilin, the complete, unchanged `shapefile.read` FeatureCollection was exported to local GeoJSON and staged through the existing GeoJSON path. Original SHP and every sidecar remain checksum-bound in the archive/report. No unknown/projected CRS was relabelled. A future narrow PR may recognize this EPSG:4326 spelling with geographic/projected regression cases.
2. Hunan exhausts the integration CLI's 2,000,000-operation budget after 83,333 accepted features. The complete 102,483-feature input passes the **existing** `validateCollection(..., {crs:'wgs84', topologyBudget:3000000})` option with zero errors and passes the independent full GEOS audit. The unchanged CLI still rejects its stage dry-run. No diagnostic subset is proposed for integration. A separate review can expose a bounded operator work-budget option, retaining every predicate and fail-closed exhaustion result.

## Coverage boundary review and Jilin local build

Natural Earth 1:10m Admin-1 boundaries were acquired from its ordinary public S3 ZIP, retaining the original archive and checksum. Exactly one feature was selected by `CN-JL` / `CN-HN`; boundary coordinates were not rounded or repaired. These public-domain outlines are **diagnostic, not approved production coverage boundaries**. Both are independently valid, but 5,029/79,784 Jilin and 15,155/102,483 Hunan cell centres fall outside them. Neither cells nor boundaries were silently clipped, expanded or unioned. Border/no-data verdicts need a reviewed boundary; a complete attachment is not proof of provincial completeness.

Latest Jilin output: `planning/china-airspace/phase1/jilin-build-reviewed-points/`.

- `COMPLETE.json`, `report.json`, `checksums.json`, normalized full geometry, local source/boundary metadata, preview and `render.png` are present.
- PMTiles: `tiles/cn/cn-jilin.1a61ce2c.pmtiles`, **6,780,461 bytes**, **41,455 tiles**, zooms 3–14; SHA-256 `1a61ce2cc4bd45209966314cdc4a038c87de71e73b9aaff11dde5555cc0fc007`.
- Sixteen source-versus-application tile point checks pass: five distributed cell centres, five interior gaps, four extreme-border cells, one source cell outside the diagnostic boundary, and one outside the source extent. These test tile fidelity, not regulatory permissions or independent CRS alignment.
- Real Leaflet/protomaps rendering passed with no page errors and external requests blocked. `local: true`, `crsVerified: false`, `maxHeightM: null`; suitable-flight meaning is a local proposal derived from the notice, pending human scope review.
- Promotion dry-run rejected: `crsVerified must be explicitly true for promotion`. There is no approval file, promoted candidate, application region index change or production manifest change. All six gates remain pending even though the first failing gate stops the probe.

Re-run from this worktree with the existing optional GEOS dependencies available and `AIRSPACE_PYTHON` set if required. Local inputs/configurations and their hashes are in the reports; use a **new** output directory:

```powershell
node scripts/china-airspace/inventory.mjs
node --max-old-space-size=8192 scripts/airspace/integrate.mjs build planning/china-airspace/phase1/cn-jilin/config.json --out planning/china-airspace/phase1/jilin-review-rebuild
node --max-old-space-size=8192 scripts/airspace/integrate.mjs stage planning/china-airspace/phase1/cn-hunan/config.json --dry-run
```

The last command is expected to fail at the unchanged work budget. [Local inspection recipe identities](evidence/phase1/local-recipes.json) identify the retained one-off operator scripts; they are not application dependencies. A fresh checkout requires the exact archived originals and local inputs; do not reconstruct geometry from these reports.

## Approval evidence still required

| Category | Evidence available | Required before approval |
|---|---|---|
| Semantics | Government notice titles/bodies; original grid fields | Human review of applicable aircraft, height, shells/holes and temporary controls; Jilin/Hunan height scope unresolved |
| CRS alignment | Geographic WGS84 PRJs; preserved coordinates | Independent landmarks, residuals, tolerances and border checks |
| Completeness | Complete attachment bytes and matching record inventories | Province-wide coverage evidence and an approved boundary, resolving the diagnostic discrepancies |
| Effective dates | Jilin/Hunan notices state May 14 activation | Human current-validity/supersession review and refresh/expiry policy |
| Redistribution | No explicit grant established | Published terms or authorization for derivatives and public tiles |
| Production | None | Owner approval bound to the exact reviewed snapshot, source/boundary metadata and point checks |

No region meets all non-production requirements, so no promotion candidate or executable production manifest patch is proposed. Once those requirements are satisfied, use the existing [integration/promotion/registration/rollback workflow](INTEGRATE.md#registration-publication-and-rollback). A future proposal must contain the exact reviewed metadata, boundary, point checks, complete build reports, approval subject, previous release/artifact hashes and rollback target. Explicit owner authorization is required before registration/publication; merge and deployment are also unauthorized. Current rollback: discard the local candidate; production is unchanged.

## Remaining divisions

All 31 entries remain in the [machine inventory](../../data/china-airspace/inventory.json). Rows without new findings below are carried forward from the merged inventory; their check dates are not claims of a new investigation. All new datasets share the six pending approval gates above.

| Division | Unresolved blocker / next evidence |
|---|---|
| Beijing | No provincial vector identified; current notice/semantics review needed. |
| Tianjin | September controlled-area notice verified as a source observation; separate semantics and boundary proposal required. |
| Hebei | September original URL lead inaccessible; current notice and vector availability unverified. |
| Shanxi | September primary connection failure; exact GIS attachment URL unknown. |
| Inner Mongolia | No verified official vector; client index claim alone insufficient. |
| Liaoning | Shenyang-only notice; provincial scope unproven. |
| Jilin | Full local build passed; alignment, completeness/boundary, current legal scope and rights/approvals open. |
| Heilongjiang | Provincial notice on city portal; vector and latest revision unverified. |
| Shanghai | August notice newer than reference release; no inspected vector. |
| Jiangsu | Query platform only; no documented public download verified. |
| Zhejiang | Platform/notice lead; downloadable vector unverified. |
| Anhui | New official notice lead returned 403; acquisition stopped. |
| Fujian | Original page JPG only; vector claim unverified. |
| Jiangxi | Municipal announcement; precise revision and provincial vector unverified. |
| Shandong | May DOCX is a cloud pointer; September original and current data unresolved. |
| Henan | Primary contents and downloadable vector not inspected. |
| Hubei | Existing production unchanged; established CRS-alignment and licence caveats remain. |
| Hunan | Full technical audit passed; CLI work budget, alignment, boundary and approvals open. |
| Guangdong | Preserve complete 101-feature capture union and identity guard; selected windows do not prove provincial completeness; source/date/rights/contact-policy gates open. |
| Guangxi | Primary revision and vector format unverified. |
| Hainan | Platform/news leads only; official provincial vector unverified. |
| Chongqing | Preserve complete 777-feature reference and identity guard; one response does not prove completeness, repeatability or current validity; source/rights/contact-policy gates open. |
| Sichuan | Official lead inaccessible; format unknown. |
| Guizhou | No verified primary downloadable vector. |
| Yunnan | City scope only; provincial lead unverified. |
| Tibet | Airport notice does not establish provincial suitable-flight coverage. |
| Shaanxi | Municipal notices only; province-wide scope unproven. |
| Gansu | No verified primary machine-readable provincial source. |
| Qinghai | Primary lead inaccessible; vector format unverified. |
| Ningxia | Official RAR preserved; compatible extraction, CRS/counts, version reconciliation and approvals needed. |
| Xinjiang | Large PDF map only; no verified vector; no image reconstruction. |

Guangdong/Chongqing original manifests, 101/777 identity guards, contact policy and 89/756 diagnostic subsets were not changed. No UI, toolbar, onboarding, dashboard, navigation or verdict code was modified.

## Review checks

`node --test tests/china-airspace.test.mjs tests/airspace-pilot-winding.test.mjs` passed **44/44**, including both original full-reference winding regressions. The first run lacked the ignored local fixture archives; the existing checksum-verified `resume-pilots.mjs --import-only` restored them and the complete run passed. Inventory regeneration validates all 31 divisions. Local source/output checksums were rechecked. Application code and production registrations are unchanged; the full UI suite was not rerun. Final fetch confirmed `origin/main` remains `31a3799`.
