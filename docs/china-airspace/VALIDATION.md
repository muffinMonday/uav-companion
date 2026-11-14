# Validation and Claude compatibility

Checked 2026-11-14 on `feature/china-airspace-data`, based on `e0a6d647b5cabdf4308b4fbadd74101d64798280`.

## Recorded checks

- New focused suite: `node --test tests/china-airspace.test.mjs`, 35 tests passed. Covers partition seams and boundary intersection; exact ID/geometry deduplication and conflicts; deterministic ring/part/hole ordering and winding; malformed, empty, invalid and paginated data; CRS declarations; intersections, holes, overlaps and work limits; offline local inputs; archived checksums; interrupted resume; validation-only even after the original local input is removed; transport backoff, access stops, cumulative HTTP budgets, response size caps and locks; output isolation; preview injection handling; inventory coverage; and existing reader/PMTiles compatibility.
- Repository skill: `node .claude/skills/test-impact/impact.mjs` selected all 53 existing unit suites. Under the normal Windows account all 53 passed (35 seconds). Initial sandbox run: 52 passed, `places-unit` date-label assertion failed. The unchanged suite reproduced with `en-SG` and passed with the normal account's `en-US`; no unrelated application/test code was edited to hide it.
- `npm run build` passed. Existing application code, package/lockfile and Vite configuration are unchanged. No full browser app suite was required for this tooling-only change; none was claimed.
- Offline Edge preview smoke: Guangdong, Chongqing, and a clearly labelled synthetic polygon-with-hole sample opened without page errors or HTTP requests. Source toggle, reset and wheel interactions exercised; screenshots inspected for query-grid visibility and preserved holes. This is a staging-tool check, not a basemap or regulatory comparison.
- Existing local Hubei shapefile was read **read-only** from the original checkout through unchanged `readRegion`: 84,863 polygons; bounds `[108.38562012,29.03137207,116.06643677,33.27758789]`; all passed per-feature ring/topology checks. Existing source metadata and build libraries are unchanged. This does not test all pairwise overlaps, imagery alignment, or regulatory currency.
- A synthetic polygon passed through the real GeoJSON reader, MVT generation and PMTiles v3 writer with deterministic repeated bytes and retained bounds. No full provincial PMTiles rebuild or source-to-tile random-point verification was performed in this change.

Raw logs, source research archives, generated previews/screenshots, and [local Hubei report](../../planning/china-airspace/hubei-regression.json) stay ignored under `planning/china-airspace`. Only small provenance summaries and blocker reports are tracked. Future checkouts must regenerate ignored artifacts.

## Technical limits and review gates

The validator accepts FeatureCollections of finite 2D Polygon/MultiPolygon features in declared WGS84 or GCJ-02, preserves exact coordinates, canonicalizes GeoJSON winding, and rejects unsupported input rather than repairing it. Coordinates outside the configured region are flagged. Bounded planar segment/interior checks find self-intersections, invalid holes, overlapping polygon parts and feature overlaps. Shared cell borders do not count as area overlap. Exhausted topology budgets fail explicitly. This is a conservative staging validator, not a certified GIS validity engine; independent robust GIS review is required for complex precision-sensitive geometry. No antimeridian or projected-CRS processing is provided.

Rings, ranges and deterministic checksums cannot establish alignment, airspace meaning or currency. Pairwise query comparison detects missing/clipped whole geometries within sampled overlap, but cannot prove there are no omissions everywhere. A complete successful query plan and a provider `hasData` flag never become provincial completeness. Effective dates, legal authority and redistribution remain separate review requirements. All reports retain `integrationReady: false`; there is no promotion path in this CLI.

## Concurrent UX work

Isolation: separate worktree `.worktrees/china-airspace-data` and branch `feature/china-airspace-data`. The nested worktree is excluded through local Git info/exclude, not the tracked `.gitignore`. No unfinished Claude commits, files or state were copied, cherry-picked, merged or overwritten.

`git fetch origin main` during final preparation still reported `e0a6d64`, the audited base. That includes the completed map explorer release. The active main checkout still had unfinished UX/discoverability work, including toolbar/help modules and checkpoint edits, so reconciliation against its final release remains pending. No merge/rebase into this branch was needed or performed.

Data contracts reviewed: source reader `Polygon`/`MultiPolygon`, WGS84/GCJ-02 conversion, ordinary-region attribute dropping, `allow`/`restrict`, coverage boundary point-check meaning, PMTiles `zones`, manifests, and `publish: false` separation. New files are confined to acquisition tooling, standalone tests and staging documentation/data. Package scripts, test registry, `src`, `public`, production region registration and build helpers are unchanged.

One narrow branch-only checkpoint block is added to `Project_context/docs/CURRENT_STATUS.md` as repository instructions require. Claude also owns that document; when reconciling, retain both feature checkpoint blocks. No other shared-file conflict is expected from this branch's file set.

Before merging after Claude finishes, fetch its completed main commit, compare changed paths, retain both checkpoint sections, rerun focused tests and the repository impact skill, and inspect any changes to `readers.js`, `crs.js`, `build-data.js`, manifest loading and point-check semantics. A future production layer/status contract must be proposed separately after UX completion; this change requires no new controls, layer states or app metadata fields. No merge or deployment is part of this work.
