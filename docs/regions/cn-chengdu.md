# cn-chengdu

**Validated release candidate, 2026-11-15; not deployed.** Release is deferred while
Claude's mascot integration is active. [Artifact identities and rollback](../china-airspace/evidence/chengdu-release.json).
Implementation `29478d2` is pushed on `feature/chengdu-city-mask`;
[draft PR #10](https://github.com/muffinMonday/uav-companion/pull/10) is open for review.

KDji third-party UOM reference mirror: <https://kdji.cn/support/nfz-map.html>.
The source claims publication in May 2026 and snapshot
`2026-09-22T05:49:15.173Z`; the two bounded responses were acquired 2026-11-14.
**59 occurrences, 57 unique original polygons, two identical duplicates, zero
conflicts.** Existing owner-attested joint-project permission covers bounded
retrieval and public PMTiles derivatives; see the
[authorization](../china-airspace/evidence/owner-api-authorization.json).
No public open licence, legal effective date, height limit, current flight
permission or completeness is established. CRS is source-declared WGS84;
independent alignment remains unverified. Temporary restrictions are not included.

## City coverage boundary

The boundary is [OpenStreetMap relation 2110264](https://www.openstreetmap.org/relation/2110264),
administrative level 5, division code `510100`, Chengdu / 成都市. Relation metadata
version 72 is dated `2026-07-25T09:08:46Z`; individual member edits may be newer.
The full-resolution geometry was retrieved through
[Nominatim](https://nominatim.openstreetmap.org/search?city=Chengdu&country=China&format=jsonv2&polygon_geojson=1&limit=1)
on 2026-11-15, with no simplification or reprojection. Nominatim GeoJSON is
WGS84 longitude/latitude; coordinate ranges, closed rings, GEOS validity, and
extent were checked. This is a community administrative boundary, not an official
aviation or surveyed legal boundary. It is distributed separately under
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), © OpenStreetMap contributors;
the committed `boundary.geojson` supplies the reusable boundary geometry.

Extent: `[102.989623, 30.0916339, 104.8948475, 31.4370968]`, approximately
14,279 km² (local degree-to-distance estimate, not an official area).
Checks include central Chengdu, Dujiangyan and Jianyang inside, with Deyang,
Meishan and Ziyang outside. Neither the acquisition rectangle nor Sichuan province
is treated as city coverage.

## Mask behavior and preservation

`maskToBoundary: true` opts only this selected-source region into a strict mask.
The builder publishes a content-hashed copy of the boundary and sets the region's
navigation/coverage bounds to its extent. **All 57 original source features remain
unchanged in the local source, and all 57 interiors survive in PMTiles.** No clipping,
geometry repair or feature removal occurs during the build. Source properties,
IDs, coordinates, rings and holes are preserved in the source; the existing generic
tile reader continues to omit source attributes from MVT.

GEOS finds 31 features with positive-area intersections, eight crossing the city
boundary and 26 entirely outside. The original `sichuan-66-0` is retained in full.
The archive contains original geometry beyond Chengdu and **must be used with its
manifest mask**; it is not a standalone city-clipped airspace dataset.

The application uses the same validated boundary for both paths:

- Rendering applies an even-odd canvas mask after every protomaps tile paint and
  rerender, before its ready callback, including overzoom and high pixel density.
- Point queries require boundary membership before accepting any positive archive
  hit. No boundary margin applies. Missing or invalid masks suppress the layer and
  positive results, with subsequent requests allowed to retry.

Within the city, holes, gaps and unavailable tiles remain unknown. Outside the
city, this region never establishes suitable flight. Existing Hubei/Singapore
verdicts retain precedence, and other regions retain their existing behavior.
Provider explanations remain metadata-driven and identify KDji; the mask receives
separate OpenStreetMap attribution. Canvas edges retain normal raster antialiasing.

## Reproduce and verify

Original captures remain read-only in the earlier worktree:
`.worktrees/express-chongqing-chengdu/planning/express/chengdu-capture-network/`.
The current candidate worktree is `.worktrees/chengdu-city-mask/`.
Keep both raw responses and their metadata; do not use the acquisition pipeline's
diagnostic normalized subset. Reconstruct the complete union with existing
`fixtureEvidence` / `deduplicateEvidence` helpers as described in the
[regional source README](../../data/regions/cn/chengdu/README.md).

```powershell
node --max-old-space-size=8192 scripts/build-data.js cn-chengdu
python scripts/airspace/verify-city-mask.py data/regions/cn/chengdu/zones.geojson data/regions/cn/chengdu/boundary.geojson
node --test tests/city-mask.test.mjs tests/selected-airspace.test.mjs
node .claude/skills/test-impact/impact.mjs
npm run build
node scripts/preflight-data.js dist/data --production planning/chengdu/production/data
```

Python uses the existing optional `requirements-geos.txt` environment. PMTiles
tests require the candidate's generated `public/data`; they must not be skipped for
release. The focused tests check 57 original interiors, actual mask witnesses,
actual crossing-feature pixels, synthetic holes/multipart masks, missing-mask
rendering/query behavior, rerenders, zooms 10/14/17, pixel densities 1/2, the six
existing Chinese registrations and Hubei/Singapore point verdicts.

Validation: five city-mask tests and the selected-source regression pass; all 62
unit suites pass under the normal Windows account (the initial sandbox run has
the known `places-unit` locale mismatch). Application build and production-data preflight
pass: eight total regions versus seven in production, none removed. Existing
Chinese and Singapore descriptors and referenced data files match production
exactly. No unrelated browser suites, real-phone or independent alignment checks
were performed. The existing bundle-size warning remains.

## Release and rollback

Candidate archive: `tiles/cn/cn-chengdu.66de882a.pmtiles`, **57 source polygons**,
92,940 addressed tiles, 5,744,094 bytes. Boundary:
`cn/cn-chengdu.boundary.a54e47db.json`. Full hashes and GEOS witnesses are in the
linked evidence files. Generated artifacts remain local and git-ignored.
The full candidate data/source package is `planning/chengdu/validated-data.zip`,
SHA-256 `3592d490921952ca56c2fea045ac91c4846c1caf4019e75d721f6012b5b77335`.

Before deployment, reconcile with latest merged `main`, confirm Claude has finished
and no other deployment is active, preserve its mascot assets, restore current
production data, then rerun the checks and deploy through `npm run deploy:live`.
Do not deploy this isolated checkout while Claude's work is active. Refresh the
rollback archive if production changes.

Rollback baseline: production `de81956bede48477ef25ffca0e1505f3e5c9b96e`.
Complete static ZIP: `planning/chengdu/production-baseline.zip`, SHA-256
`7fb203ea9ed23070df2ccba2cecee8d6dfad80640cdeea49434c086c35925146`.
Retain subsequent completed UI work when rolling back: remove only the Chengdu
registration and restore its prior runtime behavior as appropriate, retaining all
existing regions. The full archive is disaster-recovery evidence, not permission
to overwrite later releases. No rollback is needed yet because nothing was deployed.
