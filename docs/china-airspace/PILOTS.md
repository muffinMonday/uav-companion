# Guangdong and Chongqing pilot results

Historical pilot record. Later selected-source publication supersedes its production
blockers: [four-region release](SELECTED_SOURCE_RELEASE.md),
[Chongqing precision follow-up](EXPRESS_CHONGQING_CHENGDU.md). Original source identities
and conservative-policy findings below remain valid.

Checked 2026-11-14. Both pilots have advanced to **technically validated reference staging with conservative-policy warnings**. Original geometry is archived and independently GEOS-valid. Both remain **unverified reference**, with `integrationReady: false`. No production registrations, PMTiles, live API requests, merge or deployment.

## Supplied originals

**Do not integrate the Node-normalized subsets (89/756). Complete references contain 101/777.** The [integration gates](INTEGRATION_GATES.md) specify the identity guard, loss counts, full winding procedure and required source investigations. Neither artifact is production-approved.

The expected 55/79-feature Shenzhen responses and 777-feature Chongqing response were found in the main checkout's ignored staging directories. An additional Guangzhou capture has 80 features; it is not a replacement for the expected 79-feature response. All four were copied byte-for-byte into the isolated worktree's content-addressed archive.

| Original response | Features / unique IDs | Positions | Holes | Extent `[west,south,east,north]` |
|---|---|---|---|---|
| `guangdong-shenzhen-a.geojson` | 55 / 55 | 22,402 | 509 | `[111.922594,22.441551,115.278168,25.51691]` |
| `guangdong-shenzhen-b.geojson` | 79 / 79 | 23,989 | 542 | `[111.922594,22.441551,115.278168,25.51691]` |
| `guangdong-guangzhou.geojson` | 80 / 80 | 27,707 | 624 | `[111.922594,21.998749,115.278168,25.51691]` |
| `chongqing-full.geojson` | 777 / 777 | 65,401 | 974 | `[105.293158,28.166218,110.191549,32.203522]` |

All features are 2D Polygons with closed rings, finite coordinates, no missing IDs, and no within-capture duplicate IDs or exact duplicate geometry. IDs are in `properties.id`; top-level feature IDs are absent. Coordinates fit the declared geographic convention and pilot envelopes. Ranges alone do not establish landmark alignment or distinguish a plausible GCJ-02 offset.

Every supplied shell is clockwise and every hole counterclockwise, opposite RFC 7946's producer winding convention. GEOS validity is independent of winding. Raw archives and the complete deduplicated references deliberately preserve that original ordering; they are not advertised as RFC-normalized output. The existing strict normalizer canonicalizes winding only for its accepted subset. A future complete integration derivative needs a reviewed winding-normalization step as well as the contact-policy review. The snapshot's IDs have not been demonstrated to be official identifiers or stable across revisions.

[Fixture manifest](../../data/china-airspace/fixture-manifest.json) records full metadata, byte lengths and original SHA-256 identities:

| Original response | SHA-256 |
|---|---|
| Shenzhen A | `582f0ea46fec212021dc284a5dd7b90b7251ed1dea36d82939aa79c4ce2fd157` |
| Shenzhen B | `b1ecfc2a15404c7ff51f10690999e3c7a20a83395e25ff6cd846fea7b7ab8ee2` |
| Guangzhou | `bd7476e83aed9d44f5a5a1533984aa6c613228a8ce3d67c7ffcbcc7be3e4c1f1` |
| Chongqing | `78f86e54c762c008b78effc89e7ee0aa561b9d1405f7ba20587f80ab74c510a3` |

Metadata declares `coordinateSystem: WGS84`, a May 2026 publication month, and snapshot timestamps `2026-09-22T05:48:55.817Z` (Guangdong) / `2026-09-22T05:48:52.820Z` (Chongqing). These remain source claims. `snapshotFetchedAt` is not established as the HTTP capture time of these files. Original headers, capture times, exact legal effective dates, and a chain of custody back to the conversation uploads are unavailable. Checksums establish the identity of the supplied files from this receipt onward.

## Geometry and deduplication

The unchanged Node validator initially exhausted its 2,000,000-operation budget on complex rings (the largest has 10,571 positions). Its bounded intersection checks now use a spatial candidate tree; exact predicates and rejection rules are preserved. All supplied features are inspected without budget exhaustion.

The conservative Node policy flags any shell/hole or hole/hole contact. It retains 47/55 Shenzhen A, 70/79 Shenzhen B, 69/80 Guangzhou, and 756/777 Chongqing features; across the Guangdong union, 89/101. These `normalized.geojson` outputs are **filtered subsets**, not complete pilot datasets. The policy has not been weakened.

Independent Shapely 2.2.0 / GEOS 3.14.1 checks on original coordinates find **all 991 captured occurrences valid**, including the flagged contacts. Valid point contacts can violate the stricter Node policy. Within-capture and deduplicated-region positive-area overlap checks completed with zero overlaps; boundary touches are recorded separately. No geometry was repaired, snapped, clipped, simplified, unioned or reprojected.

| Region reference union | Captured occurrences | Unique IDs / geometry | Exact repeats removed | ID/geometry conflicts |
|---|---|---|---|---|
| Guangdong, three captures | 214 | 101 / 101 | 113 | 0 |
| Chongqing | 777 | 777 / 777 | 0 | 0 |

Complete `deduplicated-reference.geojson` files retain original geometry and properties, removing exact repeats only. They are emitted after a checksum-bound independent audit succeeds and remain separate from conservative pipeline subsets. The unchanged GeoJSON reader parses all 101/777 complete-reference features with matching extents. No tiles were generated; reader compatibility does not override policy or semantics gates.

## Sampled API behavior

Original `bounds` fields describe query windows, not coverage boundaries:

| Capture | Query `[west,south,east,north]` | Features extending beyond query |
|---|---|---|
| Shenzhen A | `[113.93331,22.54032,114.23889,22.74925]` | 11 |
| Shenzhen B | `[113.85737,22.44768,114.23991,22.84037]` | 10 |
| Guangzhou | `[112.9,22.5,114.1,23.95]` | 7 |
| Chongqing | `[105.2,28.1,110.3,32.3]` | 0 |

- A's window is inside B's. All 55 A IDs occur in B with identical canonical geometry; B adds 24. Guangzhou shares 36 IDs with A and 58 with B, again with identical geometry and properties. Bounding-box-selected common-window comparisons agree across all three pairings.
- Filtering the **observed 101-feature Guangdong union** by feature bounding-box intersection reproduces every captured ID list exactly (55, 79, 80), with no missing or extra predictions in that observed universe.
- B includes `guangdong-141-0`, bbox `[113.670044,22.815857,113.929596,22.962799]`. Its bbox intersects B's query but its polygon does not; Node and GEOS agree. This supports bbox intersection as the sampled filter rather than exact polygon intersection.
- Identical shared features and source polygons extending far outside queries support absence of **capture-specific viewport clipping** in these samples. They do not prove source geometry is unmodified relative to an official original.
- One Chongqing response establishes within-file uniqueness and validity, but not repeat-query behavior, stable IDs across source revisions, limits, or municipality-wide completeness. Its filename `full` is not completeness evidence.

The ordinary strict `compareResponses` guard still returns invalid-input for complete collections because of its contact policy. Separate fixture evidence analysis reports sampled identity/filtering observations after independent GEOS review; it does not enable live collection. Universal response limits, pagination, permitted quotas, and completeness remain unknown.

## Resolved and remaining blockers

| Question | Current result |
|---|---|
| Original fixtures/checksums | Resolved locally: expected captures plus Guangzhou, archived byte-for-byte. |
| Structure, topology, IDs, extents, overlaps | All source features checked; independently valid, no ID conflicts or positive-area overlaps. Conservative contact-policy review remains. |
| Declared CRS / snapshot date | Present in response metadata; verified alignment, capture time and effective date remain unknown. |
| Deduplication/filtering | Consistent Guangdong sample evidence. Universal behavior, source-revision stability and Chongqing repeatability need additional evidence. |
| Provincial completeness | Unproven: Guangdong supplies selected queries; Chongqing one envelope response. Need authoritative boundaries and completeness/truncation evidence. |
| Airspace meaning | Unverified reference. Client labels and treatment of holes do not constitute authoritative classification. |
| Current validity / redistribution / API access and quotas | Unresolved; additional source/terms evidence or authorized records needed. Live collection stays disabled. |

Reports: [Guangdong](pilots/cn-guangdong.report.json), [Chongqing](pilots/cn-chongqing.report.json). Reproduce with [local replay instructions](README.md#resume-the-supplied-local-pilots). Previews: `planning/china-airspace/local-pilots/<region>/preview.html`; all deduplicated reference geometry is visible, including contact-policy cases. No external maps are fetched. Blank space remains unknown coverage.
