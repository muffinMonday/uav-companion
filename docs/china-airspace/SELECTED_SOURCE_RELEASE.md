# Selected operational airspace source release

2026-11-14. Four Chinese API-reference datasets are registered separately from the
existing high-confidence approval workflow. The owner selected KDji as the fallback
source and affirmed joint-project permission for bounded retrieval and public PMTiles
redistribution. [Exact authorization](evidence/owner-api-authorization.json) is an owner
attestation, not a claim that a public open licence was found.

| Region | Acquired polygons | Capture scope |
|---|---:|---|
| Jilin | 140 | Two overlapping province-envelope windows |
| Hunan | 53 | Two overlapping province-envelope windows |
| Ningxia | 79 | Two overlapping province-envelope windows |
| Guangdong | 101 | Three previously supplied selected windows |

**373 complete acquired-source polygons**, not the counts of official shapefile grid
cells and not proven complete provincial coverage. Source wrappers claim May 2026
publication and September 22 snapshots; exact timestamps and raw hashes are in the
[release evidence](evidence/selected-source-release.json). Legal effective dates remain
null. The directly acquired government shapefiles are preserved locally and are not
published by this release. Jilin's official-site permission condition was not bypassed.

Chongqing is withheld: its complete 777-feature source is GEOS-valid, but one approximately 20 by 30 cm polygon is absent at the current tile precision. No diagnostic subset or repaired geometry is substituted. The whole source and failed presence-check evidence remain local for a later precision fix.

## Application behavior

The map uses the existing teal `allow` rendering. The source provider's archived client
places complete polygons in its suitable-flight reference layer and draws holes as
internal-control references. [Semantics evidence](evidence/kdji-source-semantics.json)
records that convention; no official current-permission claim is inferred from it.

New descriptors explicitly set `coverageMode: positive-only` and
`sourceConfidence.mode: selected-source`. Only mapped polygon interiors produce the
selected-source suitable-flight result. Holes, gaps, unavailable selected archives and
areas outside the polygons remain unknown. They never imply province-wide controlled
airspace. Legacy Hubei/Singapore positive and negative verdicts take precedence in
geographic overlaps. Hubei remains the initial map view, with its existing height,
metadata, tiles and boundary unchanged.

Point-check text and the existing contextual key identify the selected reference
source, snapshot, unknown effective date and unverified current permission. Independent
alignment, regulatory currency, provincial completeness and temporary controls remain
explicitly unverified. No controls, account behavior or unrelated UX were redesigned.

## Technical and source checks

Six authorized API requests were made serially: two per Jilin/Hunan/Ningxia, with
three-second spacing, one attempt and a 25 MB response cap. All raw responses and HTTP
metadata/hashes are archived locally. Shared overlap IDs/geometries agree; observed
bbox filtering matches each captured union. These observations do not establish an
unlimited response contract or completeness. No automated nationwide crawl was run.
Existing Guangdong/Chongqing raw fixtures were reused without new requests.

The selected-source CLI verifies the complete checksum-bound response union and
preserves all acquired IDs, properties, components, coordinates, rings and holes.
Winding normalization only reverses/rotates closed rings. Independent GEOS checks
validity, exact coordinate inventories, topological equality and positive-area overlaps
for every source feature. No geometry repair or contact-feature deletion is used.
Conservative Node contact/work-budget findings are retained, with a separately recorded
full-source GEOS review. The strict `promote` workflow still rejects unresolved policy
findings and still requires all six approval gates.

All four qualifying candidates passed source-versus-PMTiles point checks and actual Leaflet rendering. Every one of the 373 qualifying source feature interiors is also present in its PMTiles at maximum data zoom; the selected-source CLI now enforces this check and rejects a whole batch on a lost feature.
The local application smoke checks all 40 qualifying source cases and verifies legacy verdict
precedence. Desktop/phone source popups were checked. Focused regressions cover unknown
coverage, missing tiles, overlap precedence, null dates, source loss, tampered evidence,
truncated originals, undeclared CRS and strict-workflow isolation. Full application
checks and deployment outcomes are recorded in the release PR/session record.

## Reproduction and packaging

Local inputs/configurations: `planning/rollout/selected-<province>/`. New captures:
`planning/rollout/live-<province>/capture/`. The complete four-member selected-source
candidate is `planning/rollout/qualified-release/`; `COMPLETE.json` is required. Original
responses, normalized geometry, selection evidence, manifests, checksums and render
screenshots remain local. Raw source geometry is ignored, as with existing regions.

Run the `select` batch documented in [INTEGRATE.md](INTEGRATE.md#selected-operational-source-candidates)
into a new planning directory to reproduce the candidates. Copy complete candidate regional
sources into their matching `data/regions/cn/<province>/` directories and the matching
hashed tile artifacts into `public/data/cn/`. Merge the candidate region entries into
the existing China manifest and update the index count, preserving other countries and
Hubei artifacts. The local assembly recipe is `planning/rollout/assemble-registration.mjs`;
it verifies every candidate checksum and existing regional artifact hash. Existing
`buildRegion` generated these manifests/tiles; there is no replacement tile format.

A later normal `node --max-old-space-size=8192 scripts/build-data.js <regionId>` rebuild
uses the registered normalized source. Have complete sources or cached outputs for the
other existing regions available, as the builder can rebuild missing artifacts.

Before deployment, verify every index/manifest reference, filename hash prefix and
full tile hash, all four qualifying source counts, unchanged Hubei/Singapore hashes, the focused
checks and repository-required application tests/build. Publish one complete batch
through the normal PR workflow and `npm run deploy:live`; never a partial batch.

## Rollback

Baseline source: `0df811ea5bb498f37b3fc2e9f8a293f44ec5a532`, including the completed UX
refinement. Previous production: `a2216319a5b7f74d2088d16f8988649f8f507761`.
A complete static rollback snapshot is preserved at
`planning/rollout/previous-production-a221631.zip`, SHA-256
`adef35d164c2570eb38ca3b4f767b0ccedd03e30b2935ad9666472a294d2de5e`.
The release evidence records unchanged Hubei/Singapore tile and boundary hashes.
Refresh this baseline if another release occurs before deployment.

Before publication, revert the dedicated registration/runtime change; production is
unaffected. After publication, revert those changes through the reviewed workflow,
restore the **entire previous data tree** from the rollback ZIP (index, country manifests
and all referenced tiles/boundaries together), rebuild/test, then use the authorized
`npm run deploy:live` path. That command rebuilds application assets, not data. Preserve
subsequent unrelated UX changes. Verify the removed region IDs are absent, Hubei/Singapore
hashes and point checks match the baseline, and accounts remain enabled. Never remove
a PMTiles file while a manifest still references it.
