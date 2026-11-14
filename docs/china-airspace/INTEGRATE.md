# Express regional integration

Run from the repository root. This is an offline operator workflow, separate from acquisition.
PRs #1 and #2 were confirmed merged into `main` at `f03e2c2` before implementation.
No command below merges or deploys. Existing Hubei registrations and UI are unchanged.

| Operation | Result | Activates data? |
|---|---|---|
| `stage` | Full original inputs, winding derivative, source.json, boundary and technical report | No |
| `build` | Stage outputs plus PMTiles, point checks, real Leaflet/protomaps rendering smoke and screenshot | No |
| `promote` | Rebuild and smoke an approved **registration candidate** for review and the existing deployment workflow | No; publication is a separate authorized deployment |

Outputs must be new directories under ignored `planning/`. The app never reads this tree.
`COMPLETE.json` is written last, only after every region succeeds. Treat a directory without
this marker as incomplete (including after process termination). Failures remove the whole
output; even a failed cleanup cannot activate anything. Existing outputs are never overwritten.

## Setup and synthetic example

Use existing Node dependencies (`npm ci` if needed). GEOS uses the same optional pinned
dependencies as the acquisition audit; no dependency was added to the app:

```powershell
python -m pip install --only-binary=:all: --target planning/china-airspace/python-vendor -r scripts/china-airspace/requirements-geos.txt
# Only if Python is not callable as python:
$env:AIRSPACE_PYTHON = 'C:\path\to\python.exe'
# Browser default: installed Microsoft Edge. Optional: $env:BROWSER_CHANNEL = 'chrome'
```

The committed [fixture configuration](../../tests/fixtures/airspace/config.json) includes
two invented features, a hole and multipart geometry. Its approval file shows every required
gate as approved **for synthetic testing only**. `synthetic: true` blocks production promotion.
The following runs create only ignored local files:

```powershell
node scripts/airspace/integrate.mjs stage tests/fixtures/airspace/config.json --dry-run
node scripts/airspace/integrate.mjs stage tests/fixtures/airspace/config.json --out planning/example-stage
node scripts/airspace/integrate.mjs build tests/fixtures/airspace/config.json --out planning/example-build
node --test tests/airspace-integration.test.mjs
```

For the optional regression over **all** original Guangdong/Chongqing reference geometries,
including their flagged contact cases, point to the existing archived replay (no new collection):

```powershell
$env:AIRSPACE_REFERENCE_ROOT = 'C:\path\to\planning\china-airspace\local-pilots'
node --test tests/airspace-pilot-winding.test.mjs
```

This read-only regression checks the original identity reports, full 101/777 counts and GEOS
equivalence after normalization. It emits no derivatives or PMTiles and grants no approval.

`example-build/report.json` records the source and derivative hashes, GEOS engine versions,
conservative policy results, point checks and browser smoke. `render.png` shows the generated
PMTiles rendered by the same libraries and zone-layer contract as the app, without basemap
requests. `preview.html` is a standalone offline source-geometry inspection view. To reopen
`render.html`, serve the repo with Vite and visit its path; it uses local ES module dependencies.

## Prepare a real approved region

Copy the fixture's configuration **shape** into `planning/<region>/config.json`; use real
evidence and remove `synthetic: true` only for real data. All input/evidence paths are relative
to that configuration. `region` is the existing Hubei `source.json` schema, excluding
`file`, `boundary`, `layers` and `publish` (managed by this workflow). Set `format` to
`geojson` or `shapefile`. The generated source uses the complete normalized GeoJSON and the
existing region reader, builder, boundary handling and manifest format.

- `input`: complete FeatureCollection or `.shp` with adjacent `.shx`, `.dbf`, `.prj`.
- `boundary`: reviewed WGS84 Polygon/MultiPolygon or Feature. The boundary distinguishes
  unknown coverage from outside-zone answers; it never clips the source geometry.
- `expected.features` and `expected.contentSha256`: reviewed complete-source count and
  canonical content hash (`sha256(stringify(collection))` from acquisition `core.js`).
  For a shapefile, the collection is the result of the existing `shapefile.read` dependency.
  Anchor these in an independently established full-source inventory. Never derive replacement
  expectations from a diagnostic subset merely to make validation pass.
- `pointChecks`: WGS84 `{lon, lat, inside}` cases, including both true and false, away from
  edges. Add cases for every part, hole, border and significant contact. They compare source
  geometry with the application's actual PMTiles point reader at maximum data zoom.
- `approval`: separate approval JSON, following the committed example.
- `topologyBudget`: optional positive integer, at most 100,000,000; default remains 2,000,000. Set 3,000,000 for the complete Hunan grid. This changes only the conservative validator's work allowance, never its predicates or fail-closed exhaustion behavior. Reports record the allowance used; independent GEOS checks remain mandatory.

GeoJSON supports the existing WGS84/GCJ-02 reader conversions. Shapefiles require geographic
WGS84 `.prj`; the geographic `WGS84(DD)` spelling requires the WGS84 datum/ellipsoid, Greenwich prime meridian and degree units. Projected/ambiguous sources require a separate reviewed reprojection. CRS labels
do not prove alignment. All null/non-polygon records, invalid rings, truncated responses,
count/hash mismatches, positive-area overlaps and unsupported CRS declarations fail closed.
No deduplication, dropping, clipping, simplification or geometric repair occurs in staging.
PMTiles retain the existing rendering generalization; full normalized geometry and original
bytes remain in the candidate as the source of truth.

Winding changes only reverse/rotate each closed ring. Shell/hole membership, component and
hole order, geometry type, feature order, IDs and properties stay intact. Independent GEOS
checks exact per-ring coordinate multisets, validity, topological equality, extents and
overlaps. Conservative acquisition policy findings are retained. Valid point-contact cases
may be staged intact but **cannot build or promote** while that policy rejects them.

Guangdong and Chongqing additionally require the original `referenceReport` (`pilot-report.json`)
and its existing complete-reference identity guard. Their 101/777 complete capture unions are
still unverified reference staging, **not** proof of provincial completeness. The 89/756
diagnostic subsets are forbidden. [Existing investigation gates](INTEGRATION_GATES.md) remain open.

## Approval and batch commands

First run the dry-run to obtain `subjectSha256` and have the reviewer bind their approval to it:

```powershell
node scripts/airspace/integrate.mjs build planning/cn-approved/config.json --dry-run
```

The approval file requires `subjectSha256`, `validUntil` (YYYY-MM-DD) and six `gates`:
`semantics`, `crsAlignment`, `completeness`, `effectiveDates`, `redistribution`, `production`.
Every gate needs `status: "approved"`, `reviewer`, `reviewedAt`, an `evidence` file path and
its byte `sha256`. Store authoritative notices, source version, review findings and unresolved
discrepancies there. Gate evidence can share a reviewed document. The production gate must
explicitly authorize this region and snapshot for public registration/redistribution.
`crsVerified` must be true, approval unexpired and source already effective.

Subject hashes bind all region metadata, the original input and sidecar byte hashes, complete
content hash/count, boundary bytes, synthetic flag and point checks. Changed inputs require
new review. A hash authenticates identity, not authority: trusted human review of the evidence
remains essential. The CLI does not invent or sign approvals or infer them from technical validity.

One approved region, or a batch (preflight all members; any failure rejects the output):

```powershell
node scripts/airspace/integrate.mjs build planning/cn-approved/config.json --approved --out planning/approved-local-build
node scripts/airspace/integrate.mjs build planning/cn-a/config.json planning/cn-b/config.json --approved --out planning/approved-batch-build
node scripts/airspace/integrate.mjs promote planning/cn-approved/config.json --dry-run
node scripts/airspace/integrate.mjs promote planning/cn-approved/config.json --out planning/review-candidate
node scripts/airspace/integrate.mjs promote planning/cn-a/config.json planning/cn-b/config.json --out planning/review-batch
```

For batches each region has its own subdirectory. Promotion copies the reviewed evidence into
the candidate. Check `COMPLETE.json`, `approval.json`, `report.json`, `checksums.json`, geometry,
boundaries, point coverage and `render.png` before registration. A candidate has no application
`index.json` and never writes `data/regions/`, `public/data/`, `public/data-local/` or UI files.

## Registration, publication and rollback

After a separate review authorizes registration, copy only a **complete promoted candidate's**
`data/regions/<country>/<region>/` into a clean integration branch's matching directory.
Use an existing reviewed `country.json`; new countries need separate country registration review.
Retain the evidence/report in the review record and write the regional facts using
`docs/regions/cn-hubei.md` as the model. `source.json` and `boundary.geojson` are tracked;
raw/normalized geometry remains ignored under the existing source-data policy.

Build through `node --max-old-space-size=8192 scripts/build-data.js <regionId>` and review the
generated manifests and all relevant tests before the registration PR. The existing builder
may rebuild other missing regions even when passed an ID: have their original data available
and work in a clean checkout. Do not change Hubei metadata to satisfy these new-region gates.
Deployment remains the existing separately authorized `npm run deploy:live` workflow. This
task does **not** execute registration, merge or deployment.

Before any future publication, record the registration commit, previous published `gh-pages`
commit and data artifact hashes; retain the previous complete release locally. For rollback:

1. Before deployment: discard the candidate/registration branch; production is unchanged.
2. After registration but before deployment: revert the registration commit and rebuild in a
   clean checkout with existing sources. Review the index/manifests: the region must be absent.
3. After publication: restore the entire previous known-good static release through the existing
   authorized deployment process, or revert registration and rebuild/deploy with complete source
   data. Restore **both** manifests/index and their referenced hashed artifacts together. Never
   delete only a PMTiles file while a manifest still references it. Verify the removed region is
   absent and Hubei point checks/rendering still work. Record the rollback release/commit.

Local candidate cleanup needs no production change. Preserve source/evidence archives; remove
only the specific ignored output directory after checking its absolute path.
