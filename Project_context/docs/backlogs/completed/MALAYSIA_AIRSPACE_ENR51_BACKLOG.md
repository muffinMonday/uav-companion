> **Status: COMPLETED, released 2026-11-24** (partial ENR 5.1 coverage, documented). Commit `8c18781` on `main`; deployed with `deploy:live` (gh-pages `bc81bfab`); rollback target gh-pages `80d5f06`. Edition AIP AMDT 04/26, effective 2026-11-03: 108 numbered areas, 61 converted (P 5/7, R 25/65, D 31/36), 47 unresolved (IDs and reasons in `data/regions/my/my-enr51/exceptions.json`, summary in `docs/regions/my-enr51.md`). Tests: `my-enr51-unit` 28, `my-enr51` browser (desktop and phone, local and live), `sg`, `layers`, `fly-in`, `country-buttons`, `dashboard`, unit suite (only the standing `html-components-unit` and China-menu `country-groups-unit` failures). Residual risks: no reuse terms found on the eAIP (published on the owner's authorization; `publish: false` removes it); the 47 unresolved areas show "no data"; the first-visit Singapore view also loads the 0.6 MB Malaysia archive.

# Malaysia Airspace ENR 5.1 — Implementation Backlog

**Project:** UAV Companion (`muffinMonday/uav-companion`)  
**Target path:** `Project_context/docs/MALAYSIA_AIRSPACE_ENR51_BACKLOG.md`  
**Status:** Approved for autonomous implementation, subject to release checks  
**Priority:** High  
**Scope:** Malaysia CAAM eAIP ENR 5.1 — Prohibited, Restricted and Danger Areas  
**Out of scope:** ENR 2, NOTAMs, temporary restricted areas, temporary AIP supplements, live activation tracking, AIV10  
**Execution:** Codex, Medium reasoning; token-efficient; isolated branch/worktree

## 1. Mission and success criteria

Expand UAV Companion's map coverage to Malaysia by deriving reproducible polygons from the latest effective **Civil Aviation Authority of Malaysia (CAAM)** Aeronautical Information Publication (eAIP), **ENR 5.1**. Integrate validated permanent designations into the existing regional data/PMTiles architecture and, when release conditions are satisfied, publish to the live app.

**Success:** The live UAV Companion map displays correctly classified CAAM ENR 5.1 prohibited (P), restricted (R) and danger (D) areas, with source attribution, published vertical limits and a clear warning that temporary airspace changes are not tracked. Unresolved boundaries must be reported rather than invented.

A validated partial ENR 5.1 release is acceptable when omissions are clearly documented and do not imply unrestricted airspace.

## 2. Official sources and provenance

1. Start at <https://aip.caam.gov.my/> and identify the latest *effective* eAIP edition. Do not rely on a bookmarked historical edition without checking supersession.
2. Use CAAM's official ENR 5.1 as the primary source. Prefer an official machine-readable AIXM/XML/KML/SHP/GeoJSON dataset if available; otherwise derive geometry from official published coordinate descriptions.
3. Preserve each source URL, publication/edition date, effective date, identifier, source text/reference and extraction timestamp.
4. Review the publication's terms for public redistribution of derived polygons and PMTiles. Public access and a disclaimer alone do not establish reuse rights.
5. Do not use AIV10 or other third-party drone maps as geometry sources.

## 3. Inclusion and exclusions

**Include:** Permanent P, R and D designations from ENR 5.1; published lateral boundaries; lower/upper vertical limits and units; static activation conditions, where provided; identifiers, names and source metadata.

**Exclude:** Temporary restricted areas, NOTAM ingestion, temporary AIP supplements, real-time activation status, live scheduling/recurrence engines, ENR 2 controlled airspace and AIV10-derived data.

A permanently designated R or D area with conditional hours remains included, with the conditions retained as *static metadata*, not evaluated as currently active.

## 4. Repository baseline and isolation

- Fetch latest `main`, inspect merged China airspace acquisition/integration work and current UX architecture.
- Use a separate feature branch and worktree; protect unrelated working-tree changes.
- Read `scripts/build-data.js`, existing region/country metadata, `scripts/airspace/integrate.mjs`, PMTiles readers/writers, `src/zones.js`, map-layer controls and relevant tests.
- Reuse existing country/region registration and tile generation; avoid new services, databases and dependencies unless demonstrably necessary.
- Preserve all existing Hubei/China data, point-check behavior and UI workflows.

## 5. Deterministic geometry extraction

Build the smallest reproducible ENR 5.1 extractor supporting:

1. Latitude/longitude coordinate sequences and straight polygon edges.
2. Geodesic circles from published centers and radii, including nautical miles and kilometres.
3. Arcs when their centers, radii, directions and endpoints are unambiguous.
4. Referenced official boundaries only when the reference geometry can be resolved reliably from CAAM publications.

Use geodesic calculations, not planar degree offsets, for circles and arcs. Preserve precision, original references and deterministic outputs. Do not fabricate vertices, flatten holes, silently repair geometry or guess unresolved boundary references. Continue processing other areas and record each unresolved area in an exception report.

## 6. Airspace data model and semantics

Preserve CAAM's distinct classes:

| Designation | Display category | Interpretation |
|---|---|---|
| P | Prohibited | Published prohibited area |
| R | Restricted | Published restricted area; conditions may apply |
| D | Danger | Hazard/caution area; do not relabel as prohibited |

Retain area ID/name, vertical floor/ceiling, altitude datum/units where specified, static activation description and source edition. Do not infer flight permission from the absence of an ENR 5.1 polygon. Do not represent controlled airspace as a generic drone no-fly zone.

If the existing `allow`/`restrict` model cannot safely represent P/R/D distinctions, add the smallest backward-compatible classification extension and corresponding tests. Preserve existing Chinese semantics.

## 7. Validation and completeness

For every emitted feature, validate:

- WGS84 coordinate interpretation and longitude/latitude order.
- Polygon closure, winding, holes, multipart structure, topology and nonzero area.
- Geodesic circle radius, arc direction/endpoints and boundary-reference fidelity.
- Unique identifiers and correct P/R/D classification.
- Published vertical limits, units, static activation text and provenance.
- Deterministic source-to-output hashes and no silent feature omissions.

Independently cross-check representative converted features against the original official descriptions. Report total ENR 5.1 entries, converted entries, excluded temporary entries, unresolved complex entries and validation failures. Do not claim complete national coverage unless supported by the extraction results.

## 8. UAV Companion integration

- Register Malaysia under the repository's existing `my` country convention and compatible region IDs.
- Generate GeoJSON and PMTiles with the existing pipeline, preserving P/R/D distinctions and altitude metadata.
- Display source attribution, effective edition and any conditional-activation caveat.
- Use existing map controls and styling conventions; no toolbar/onboarding/dashboard redesign.
- Ensure point queries and unknown-coverage handling do not imply permission outside published polygons.
- Confirm Malaysian geometry cannot affect China's airspace verdicts or Hubei behavior.

## 9. Global disclaimer

Update the existing airspace disclaimer without removing other notices:

> UAV Companion displays published baseline airspace boundaries for planning reference only. Temporary restricted areas, NOTAMs, temporary activations and short-notice changes are not tracked. Some permanent zones may apply only under specific conditions. Always consult current official aviation publications and announcements before flying.

Apply this warning across supported countries, not just Malaysia.

## 10. Testing and acceptance

Run focused tests for coordinate parsing, geodesic circles/arcs, P/R/D classification, vertical limits, geometry validation, country registration, PMTiles generation, rendering, point queries, unknown coverage and China/Hubei regressions. Run the application build and desktop/mobile browser smoke tests for Malaysia. Record any unresolved areas and release limitations.

Do not weaken existing geometry checks, fabricate legal boundaries or misclassify danger areas as prohibited to make tests pass.

## 11. Token-efficient execution

- Use Medium reasoning and reuse existing tooling.
- Prioritize straightforward polygons and circles; attempt complex references only when feasible.
- Do not expand into ENR 2, NOTAM/TRA tracking or nationwide third-party research.
- Avoid broad refactoring and repeated reading of unchanged files.
- Commit small, reviewable changes; maintain concise extraction and release reports.
- Do not stop at planning or staging if publication conditions are satisfied.

## 12. Deliverables

1. Reproducible CAAM ENR 5.1 extraction workflow and source manifest.
2. Validated Malaysian GeoJSON with source-linked P/R/D metadata.
3. Malaysia PMTiles, country/region registration and map display.
4. Extraction completeness/exception report and updated disclaimer.
5. Focused test/build/browser results.
6. Production deployment verification, published commit/artifact hashes and rollback instructions.
7. Updated backlog status and concise completion report.

## 13. Release controls

The owner accepts reasonable uncertainty for a non-official hobby planning application, but does **not** authorize fabricated geometry, inaccurate regulatory classification, unauthorized source redistribution, bypassing access restrictions or ignoring failing critical tests.

A partial release is acceptable only for independently validated areas, with clear omissions and unknown-coverage semantics. If public redistribution rights cannot be sufficiently established, do not publish the affected geometry; preserve completed code/local artifacts and identify the exact blocker.

Follow branch protections and any mandatory repository review requirements. Do not deploy unrelated pending changes or make database migrations.

## 14. EXPRESS PRODUCTION DEPLOYMENT AUTHORIZATION

**The owner expressly authorizes Codex, for this Malaysia ENR 5.1 task, to implement, edit, test, commit, push, open and merge a pull request through the repository's permitted review workflow, execute the existing `npm run deploy:live` command, and perform read-only live verification once all release conditions above are satisfied.**

Before deploying, verify source redistribution rights, validated geometry/classification, complete build and smoke tests, preserved China/Hubei behavior, and a recorded rollback target. If a critical release condition remains unmet, stop publication and report that blocker rather than bypassing it.

**EXPRESS PERMISSION TO DEPLOY TO PRODUCTION IS GRANTED FOR THIS TASK, SUBJECT TO THE RELEASE CHECKS ABOVE.**
