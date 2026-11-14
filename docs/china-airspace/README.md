# China airspace acquisition staging

[Focused follow-up](FOCUSED_FOLLOWUP.md): Hunan complete local build, Jilin direct-shapefile compatibility, and Ningxia archive/geometry inspection; source approvals remain pending.

This workflow prepares evidence and reproducible local datasets for UAV Companion. It does not register regions, change point checks, or publish tiles. [Audit and plan](PLAN.md), [nationwide inventory](INVENTORY.md), [source investigation](SOURCES.md), [pilot results](PILOTS.md), [compatibility and checks](VALIDATION.md).

For the separate stage/build/approved-registration-candidate CLI, batch commands and rollback procedure, see [Express regional integration](INTEGRATE.md). Neither workflow automatically activates or publishes data.

[Phase 1 official acquisitions](PHASE1.md): Jilin and Hunan originals acquired (182,267 cells audited), one local Jilin PMTiles build; all source/production approval gates remain open. Ningxia archive and Batch A access/version blockers are recorded separately.

## Run

**Integration warning:** `normalized.geojson` is a diagnostic subset: Guangdong **89 of 101**, Chongqing **756 of 777**. Never substitute it for the complete `deduplicated-reference.geojson`. Both remain unapproved for production. Read the [mandatory artifact identity guard, winding procedure and investigation checklist](INTEGRATION_GATES.md) first.

Use Node 24 and the repository's existing dependencies (`npm ci` in a clean checkout). Commands below run from the feature worktree root. No new dependencies or package scripts are needed.

```powershell
# Inspect local source inputs: no HTTP requests and no filesystem writes.
node scripts/china-airspace/cli.mjs acquire data/china-airspace/pilots/cn-guangdong.json --dry-run
node scripts/china-airspace/cli.mjs acquire data/china-airspace/pilots/cn-chongqing.json --dry-run

# Replay the complete supplied-fixture audit after the optional GEOS check below.
node scripts/china-airspace/resume-pilots.mjs

# Check the inventory and regenerate its table.
node scripts/china-airspace/inventory.mjs

# Focused tests (separate from the shared UX suite registry).
node --test tests/china-airspace.test.mjs
node .claude/skills/test-impact/impact.mjs
npm run build
```

## Resume the supplied local pilots

The original 55/79-feature Guangdong and 777-feature Chongqing responses, plus an 80-feature Guangzhou response, are now archived locally. Raw originals remain ignored, with identities and relative archive paths in `data/china-airspace/fixture-manifest.json`. A fresh checkout needs those exact bytes; do not reconstruct geometry from reports. Import from an ordinary directory laid out as `<directory>/<region>/<original-filename>`:

```powershell
node scripts/china-airspace/resume-pilots.mjs --import-from "<original-checkout>/planning/china-airspace" --import-only

# Optional isolated audit environment; used here with Python 3.14.
python -m pip install --only-binary=:all: --target planning/china-airspace/python-vendor -r scripts/china-airspace/requirements-geos.txt
python tests/china-airspace-geos.py
python scripts/china-airspace/validate_geos.py
node scripts/china-airspace/resume-pilots.mjs
```

This runs the existing local acquisition and strict validation, then combines independent checksum-bound GEOS evidence with raw-file summaries and cross-query comparisons. GEOS processes unmodified source geometry and never repairs it. Node preserves its conservative contact policy. The two results are recorded separately; a complete derivative is emitted only after the independent source-bound audit succeeds. Import, Python analysis and replay make no HTTP calls. The optional pip installation contacts package repositories, not the airspace API.

Latest pilot outputs are `planning/china-airspace/local-pilots/cn-guangdong/` and `cn-chongqing/`. Each contains exact response archives, the conservative `normalized.geojson` **subset**, a complete `deduplicated-reference.geojson`, `pilot-report.json`, and `preview.html`. Do not confuse the subset with the complete reference. Repeat the Python audit and Node replay to regenerate reports; unchanged inputs produced byte-identical pilot reports and complete-reference content hashes.

Open the latest `preview.html` directly. It works offline, supports pan/zoom, shows coordinates and captured query windows, and includes provenance. All 101/777 deduplicated reference features are shown. The simple longitude/latitude plot has no basemap and is **not** a landmark alignment check. The generic `cli.mjs pilot/acquire` commands still return exit 2 on these source contact-policy cases; they do not override those checks or enable live collection. Historical empty previews under `planning/china-airspace/<region>/` are superseded by `local-pilots`.

## Local sources and overlap reproduction

Put externally obtained responses and a local configuration under ignored `planning/china-airspace/`. Paths in a configuration are relative to that configuration. For example, save `planning/china-airspace/local/config.json`:

```json
{
  "id": "cn-local-reference",
  "bbox": [105.2, 28.1, 110.3, 32.3],
  "localFiles": [
    { "file": "response-a.geojson", "bbox": [105.2, 28.1, 108.2, 32.3] },
    { "file": "response-b.geojson", "bbox": [107.8, 28.1, 110.3, 32.3] }
  ],
  "validation": { "crs": "unknown", "topologyBudget": 2000000 },
  "quality": "unverified-reference",
  "provenance": { "semantics": "unknown", "effectiveDate": null, "redistribution": "unknown" }
}
```

`unknown` deliberately fails CRS validation. After source evidence establishes the declared coordinate convention, set `validation.crs` to `wgs84` or `gcj02`; this still does not verify geographic alignment. Set `validation.idProperty` if a stable source ID is in properties. Otherwise use GeoJSON feature IDs with exact geometry fallback.

```powershell
node scripts/china-airspace/cli.mjs acquire planning/china-airspace/local/config.json --out planning/china-airspace/local/run-01
node scripts/china-airspace/cli.mjs acquire planning/china-airspace/local/config.json --validation-only --out planning/china-airspace/local/run-01
node scripts/china-airspace/cli.mjs validate planning/china-airspace/local/response-a.geojson --crs wgs84 --out planning/china-airspace/local/check
node scripts/china-airspace/cli.mjs compare planning/china-airspace/local/response-a.geojson planning/china-airspace/local/response-b.geojson --bbox-a 105.2,28.1,108.2,32.3 --bbox-b 107.8,28.1,110.3,32.3 --crs wgs84
```

Acquisition writes `plan.json`, `checkpoint.json`, exact `responses/*.json`, `acquisition.jsonl`, `normalized.geojson`, `report.json`, and `preview.html`. SHA-256 covers original response bytes and canonical normalized content. The normalized-content checksum excludes output whitespace, timestamps and local paths. Reordered responses, ring starts/orientation, holes and polygon parts produce the same content checksum. Input coordinates are never rounded, clipped, repaired, unioned or silently transformed. **GCJ-02 stays GCJ-02** in staging and must retain that CRS metadata for the existing reader to convert on any later approved integration. Unknown CRS output cannot be used as WGS84.

Validation-only replays/checks archives without fetching. Re-running acquisition resumes verified cached responses. Config, boundary and local input hashes bind the checkpoint; changed inputs require a new output directory. A changed checksum fails rather than repairing the archive. An interrupted run leaves its completed responses. After a crashed process, inspect the PID in `acquisition.lock`, confirm that process is gone, then remove only that lock before resuming. Do not delete checkpoints to evade backoff or request budgets.

## Controlled live acquisition

Both pilot configurations have live access disabled and now reference local archives. No new geometry API requests were made. The public static client index was read during initial research; supplied responses are replayed offline.

Live collection requires `access.status: "permitted"`, a reviewed `access.evidence` reference, `access.checkedOn`, and `access.maxRequests` (at most 64, including retries across resumes). It also requires an evidenced response contract: `responsePolicy.pagination: "none"`, `wholeFeatures: true`, and `evidence`. The generic adapter does not guess pagination. A provider with pagination needs a documented adapter before collection. Unknown area/feature limits require a conservative approved plan or local files, never probing until an error occurs.

Requests are serial, at least 2.5 seconds apart (default 3 seconds), with at most 3 attempts by default, bounded exponential backoff, 30-second headers timeout, a 25 MB response cap, and no automatic redirects. HTTP 401, 403, 429 and redirects stop immediately. Retry-After and a minimum one-minute stop are checkpointed; long 5xx backoff also persists. Short 5xx retries respect Retry-After. No credentials, browser impersonation, authentication bypass, alternate-domain retry, or anti-bot workarounds are provided.

`partition` accepts `columns`, `rows`, and fractional per-cell `overlap` below 0.5, bounded by `maxRequests`. An optional `boundaryFile` (Polygon/MultiPolygon, or a Feature containing one) filters queries by geometry intersection. It is a query boundary, not a certified completeness footprint. Source polygons crossing bounds remain whole. All planned requests succeeding does not establish source coverage.

Exit status: 0 means the requested technical operation completed (or pilot blocker report was produced), 1 means configuration/access/transport failure, 2 means invalid, empty, inconsistent or potentially truncated data. Zero never means regulatory approval. Reports always keep `integrationReady: false`; this tool has no promotion command.

## Evidence required for later integration

Quality categories are `verified-official` (Verified official), `verified-reference` (Verified reference), and `unverified-reference` (Unverified reference). They describe reviewed source evidence, separately from geometry validity. A source URL or valid GeoJSON alone cannot upgrade a category. Reference data remains unverified in this change.

Before proposing an integration-ready region, obtain a dated source snapshot; documented suitable-flight meaning for shells and holes; stable response IDs and whole-feature/no-truncation behavior; repeated overlapping-query agreement; full province boundary coverage evidence; landmark alignment against an authoritative coordinate reference; current effective-date evidence; and redistribution clearance. Review all overlaps and technical failures with an independent GIS engine for complex data. Query completeness is distinct from polygon area: suitable-flight cells need not fill the province.

Only after that review should a separate integration change add the existing `source.json`/coverage-boundary structure, accurately set `semantics`, preserve the CRS for `readRegion`, run PMTiles generation and point checks, and request any required publication decision. `publish: false` is not a substitute for staging because it changes localhost flight verdicts too. Hubei's existing exceptions do not waive these gates for new datasets.
