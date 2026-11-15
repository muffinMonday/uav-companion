# cn-sichuan

**Validated replacement candidate, 2026-11-15; not deployed.** The owner confirmed
Claude is still implementing Google OAuth: prepare the PR and defer release.
Production still registers `cn-chengdu` at gh-pages `b9e2378`; PR #10 is merged.
This candidate replaces it with Sichuan / 四川 (`cn-sichuan`, `allow`, `positive-only`).

KDji UOM reference mirror: <https://kdji.cn/support/nfz-map.html>.
Source snapshot `2026-09-22T05:49:15.173Z`, publication claim May 2026;
retrieved 2026-11-15. **16 successful HTTP requests, 593 occurrences, 468 unique
polygons, 125 exact repeats, zero conflicts or missing IDs.** One earlier sandbox
network failure makes 17 logged attempts. All 57 original Chengdu features have
identical IDs, coordinates, rings, holes and properties. No Chengdu reacquisition.

## Acquisition and geometry

Endpoint `https://kdji.cn/nfz-api.php?action=uom&province=sichuan`, with
`west`, `south`, `east`, `north` for each bounded window. Envelope
`[97.2,25.9,108.7,34.5]` encloses the extent 97°21′–108°33′ E,
26°03′–34°19′ N reported in [Sichuan provincial planning](https://nynct.sc.gov.cn/nynct/c100664/2022/1/26/d9b0697dd04143ea946895073e46b12a/files/%E5%9B%9B%E5%B7%9D%E7%9C%81%E5%85%BB%E6%AE%96%E6%B0%B4%E5%9F%9F%E6%BB%A9%E6%B6%82%E8%A7%84%E5%88%92%EF%BC%882019-2030%E5%B9%B4%EF%BC%89.pdf).
A 4×4 grid expands each core by 5% of its dimensions on each side, bounded by
the envelope. Three-second spacing, one attempt per invocation, 30-second timeout,
25 MB response ceiling, stop on access/rate-limit/redirect responses.
The budget was increased from 16 to 17 only to retain the failed sandbox attempt;
the original plan/checkpoint and acquisition log remain archived.

Raw bodies, HTTP status/content type/ETag/Last-Modified, URLs, dates and SHA-256
are archived at `planning/china-airspace/sichuan-network/` in the isolated worktree.
[Acquisition evidence](../china-airspace/evidence/sichuan-acquisition.json) records
each capture hash, exact duplicate checks, stable-ID comparisons, intersecting
window comparisons and filtering against the complete acquired union.
No truncation markers or size-limit hits were observed. Every window matches
the union's bounding-box-selected IDs; shared geometries are identical.
The undocumented pagination contract and unknown provider inventory mean this
does **not** establish geographic completeness.

Original features are preserved in `data/regions/cn/sichuan/zones.geojson`.
No administrative clipping, mask, coordinate repair, reprojection or query-rectangle
rendering mask is applied. Navigation bounds describe the acquired geometry,
not legal coverage. The existing PMTiles pipeline quantizes/simplifies tile geometry
and omits source properties as before; the full original properties and coordinates
remain in the source archive. Rendering and point checks read the same tiles.
Holes, gaps and unavailable tiles remain unknown; authoritative Hubei/Singapore
precedence and selected-source overlap behavior remain intact.

Source coordinates are declared WGS84; independent alignment, regulatory currency,
flight permission and completeness remain unverified. Temporary restrictions are
not included. Existing source-confidence metadata and disclaimers are retained.
Rights basis: [owner-attested joint-project permission](../china-airspace/evidence/owner-api-authorization.json)
and the owner's express Sichuan acquisition/publication authorization. This is
neither a public open licence nor independently verified legal permission to fly.

## Validation and identities

GEOS 3.14.1 / Shapely 2.2.0 validates all 468 features, no positive-area overlaps;
independent winding normalization preserves topology, bounds and every ring's
coordinate values. The conservative acquisition normalizer reports touching-ring
and topology-budget findings and emits only 420 diagnostic features: **that subset
is not used**. Full-source GEOS and raw-window evidence resolve those technical
policy findings without weakening the generic acquisition policy or changing geometry.

All 468 source interiors survive PMTiles and application point queries. Browser
checks confirm formerly masked outside-Chengdu polygons paint and return positive
results, holes/gaps remain unknown, selected-source overlap continues past holes,
and authoritative verdicts persist. All seven other regional descriptors and
referenced artifacts equal production. All 136 application suites (64 unit, 72 browser) pass in 748 seconds; configured build and production preflight pass. The full run used a temporary browser localhost-to-IPv4 resolver to reach this isolated app without disturbing an existing IPv6 preview. Real-phone/alignment checks remain unverified.

- Source file SHA-256: `094f6dad6d26641e24b4e86a72e3c6962f2bdef519cc0f16df59eb7a9e850451`.
- Canonical content SHA-256: `8e12e3ed54ca3768bd190406558f813a0abf76bbc369eaccf75ec7622faa4ffa`.
- PMTiles: `cn/cn-sichuan.493d55a3.pmtiles`, 8,547,247 bytes, 129,488 addressed tiles.
- PMTiles SHA-256: `493d55a35b30e2a86f39282152af866c999d37a22001bb46b460995c50720c28`.
- [GEOS witnesses](../china-airspace/evidence/sichuan-geos.json),
  [release evidence](../china-airspace/evidence/sichuan-release.json),
  [release procedure and rollback](../china-airspace/SICHUAN_REPLACEMENT.md).

To reconstruct offline, restore the archived capture/source folders, set
`AIRSPACE_PYTHON` to the existing Python executable with the optional GEOS
dependencies (`scripts/china-airspace/requirements-geos.txt`), then run:

```powershell
node scripts/airspace/prepare-sichuan.mjs
node --max-old-space-size=8192 scripts/build-data.js cn-sichuan
node --test tests/sichuan-release.test.mjs tests/selected-airspace.test.mjs
node scripts/preflight-data.js public/data --production planning/sichuan/production/data
```

Restore production's other artifacts before building, so unrelated raw datasets
are not rebuilt. Historical Chengdu captures, source, mask and release records
are retained; no ignored original files were deleted.
