# China airspace enrichment: audit and implementation plan

Checked 2026-11-14, base `e0a6d64`, branch `feature/china-airspace-data`.

The active main checkout contains unfinished UX work. This work uses a separate worktree; no UX files, application configuration, production registrations, shared state or existing build code will be edited.

## Existing contract

- `data/regions/<country>/<region>/source.json` registers a region. `country.json` supplies its view. `boundary.geojson` is WGS84 coverage, not suitable-flight geometry. Raw sources stay local.
- `scripts/lib/readers.js` supports shapefile and GeoJSON Polygon/MultiPolygon; it drops attributes for ordinary regions. OneMap uses a separate classed-layer reader. `crs.js` accepts `wgs84` unchanged or iteratively converts `gcj02` to WGS84. A declaration is not alignment verification.
- `allow` means cells are suitable-flight areas; outside cells within coverage produces a controlled-airspace verdict. `restrict` means the polygons are restrictions. Unknown/mixed/reference semantics cannot use either safely. Missing polygons must never expand a known-data footprint.
- `scripts/build-data.js` generates MVT layer `zones`, zooms 3–14, content-hashed PMTiles, coverage files, country manifests and index, plus place indexes. Metadata dates and semantics flow into the app. Optional provenance fields in source metadata are not automatically copied to manifests.
- `publish: true` builds under ignored `public/data`; false builds under `public/data-local`, which deploy strips. Even a local-only production registration changes localhost point checks; staging must live outside `data/regions` and `public`.
- An id argument does **not** isolate a fresh build: missing previous manifests cause all registered regions to build. Do not run this against the shared checkout. `verify-data.js` is only a rectangular-shapefile comparison, not a general polygon validator.
- Hubei is 84,863 official suitable-flight cells, announced 2026-05-12, effective 2026-05-14, declared WGS84, imagery verification pending, redistribution unspecified. Its Natural Earth coverage boundary has documented border inaccuracies. Preserve metadata and behavior byte-for-byte.
- Publication uses generated files on `gh-pages` through deployment. No merge, deploy or reference-data publication is authorized here.

## Ordered work

1. Inspect official provincial notices and the public reference-map client; distinguish observed statements, user-supplied leads, and unknown API behavior. Record all 31 mainland divisions, including unavailable sources and superseded notices.
2. Implement independent CLI modules under `scripts/china-airspace/`: bounded partition planning, conservative serial HTTP/local acquisition, checksum archives, checkpoints, deterministic deduplication and geometry validation. Permission checks precede live fetch; dry-run and validation-only perform no network requests.
3. Keep pilot configurations and provenance under `data/china-airspace/`. Keep raw archives, normalized GeoJSON, logs and local previews under ignored `planning/china-airspace/`. Track small reports only. Never fabricate pilot fixtures or mark a missing response as an empty verified dataset.
4. Check geometry structure, topology (bounded work, fail closed when exhausted), holes, self-intersections, coordinate ranges, declared CRS, ID collisions, duplicates, overlaps, partition completeness and repeated-query consistency. Report technical and regulatory readiness separately.
5. Produce offline inspectable previews and pilot reports, including explicit blocked results when sources are unavailable. No integration-ready output until semantics, alignment, completeness, dates and redistribution all have reviewed evidence.
6. Add meaningful offline tests, including local HTTP simulations, deterministic outputs, validation failures, request boundaries, interrupted resumes, and the existing Hubei reader/PMTiles contract. Run repository impact checks and a production app build in this worktree.
7. Fetch completed upstream work before PR preparation; review changed paths/data contracts without copying or merging unfinished UX work. Open a draft PR for review; list remaining evidence and reconciliation requirements.

## Integration risks

Attribute dropping would erase a mixed layer's meaning. Coarse province boxes do not prove provincial coverage. Successful requests do not prove no truncation, and a source can return entire polygons crossing query boundaries. GeoJSON longitude/latitude ranges cannot distinguish WGS84 from GCJ-02. Checksums establish repeatability, not authority or currency. Existing Hubei licence/CRS exceptions do not authorize promotion of new reference data.
