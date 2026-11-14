# Full-reference selection and investigation gates

**Neither current artifact is approved for production. Never integrate `normalized.geojson` as the full region.**

| Region | Complete `deduplicated-reference.geojson` | Diagnostic `normalized.geojson` subset | Features silently lost if substituted |
|---|---|---|---|
| Guangdong | 101 | 89 | 12 |
| Chongqing | 777 | 756 | 21 |

Each replay writes `DATASET_SELECTION.json` and `READ_BEFORE_INTEGRATION.txt` next to the files. The complete reference includes the independently GEOS-valid contact cases. The conservative Node policy continues to reject them; do not disable it or relabel its smaller output as complete. Complete means the supplied capture union, not provincial coverage.

Before any future derivative, call `assertCompleteReference(collection, report)` from `scripts/china-airspace/artifact-contract.js` against `pilot-report.json`. It checks the complete feature count and canonical content SHA-256 and rejects subsets and same-count modifications. This guard verifies identity only, not permission to integrate. Do not generate replacement expected hashes from the input being checked. Original response hashes remain anchored in `data/china-airspace/fixture-manifest.json`.

## Required future winding procedure

1. Work on a new local derivative of the checksum-verified **complete reference**. Keep originals, complete reference and their manifest hashes unchanged. Retain all 101/777 IDs, properties and Polygon/MultiPolygon components; establish a before/after inventory by ID, ring count, holes, coordinate multiset and extents.
2. Apply `canonicalGeometry` from `scripts/china-airspace/geometry.js` to each complete feature's geometry. It orders ring vertices deterministically and uses counterclockwise exterior rings and clockwise holes. Keep the first ring as the exterior and every subsequent ring as a hole within its original polygon; never infer shell/hole roles from source winding. Reordering holes or MultiPolygon components must preserve their membership.
3. Preserve every coordinate value and ring closure. For shell/hole or hole/hole point contacts, reverse/rotate the closed rings only: retain shared contact vertices exactly. Never use buffering, make-valid, snapping, rounding, hole deletion, flattening or union as a winding fix. Reject zero-area, ambiguous, or invalid cases for explicit review instead of repairing them automatically.
4. Independently revalidate every transformed feature with GEOS. Compare each result to its corresponding original using topological equality plus exact coordinate-multiset, ID/property, component/hole-count and extent checks. Confirm count 101/777, no omissions, no new overlaps, preserved contact cases, closed rings, and right-hand winding. Include synthetic hole/contact regressions and all real flagged cases in that future change's tests.
5. Write a separately named derivative, its own SHA-256 and a transformation manifest linking input content hash, source archive hashes, tool/engine versions and comparison results. Never overwrite existing hash identities. Re-run the conservative validator and retain its contact-policy findings: winding does not resolve those findings. Any policy change needs a separate reasoned review; GEOS validity alone does not authorize weakening the policy.
6. Production integration remains blocked until the following evidence gates are reviewed. Reader compatibility and correct winding are insufficient.

## Follow-up investigation checklist

Record evidence location, source date/version, reviewer, result and unresolved discrepancies for every item. Leave failed/unknown items open.

- [ ] **Coordinate alignment:** compare multiple independently identified landmarks across each region with authoritative coordinate references; test WGS84 versus GCJ-02 hypotheses, record residuals and acceptable tolerances, and inspect border cases. Source declarations and numeric ranges are insufficient.
- [ ] **Suitable-flight semantics:** obtain an authoritative source legend/schema matching this snapshot; establish shells, holes, height limits, aircraft applicability and temporary controls. Distinguish the third-party mirror from official data. Do not infer permission from polygon presence or missing data.
- [ ] **Geographic completeness:** obtain authoritative province boundaries and documented full-source counts/coverage. Establish filtering, clipping, pagination and truncation behavior with authorized evidence; repeat overlapping Guangdong and Chongqing queries only after access is established. Explain omissions and border gaps. Three local Guangdong windows and one Chongqing envelope cannot prove coverage.
- [ ] **Effective dates/current validity:** establish legal effective dates, source revision history and superseding notices; distinguish the claimed May publication month, September mirror timestamp, actual capture time and current regulatory validity. Document refresh/expiry and stale-data handling.
- [ ] **Redistribution:** record published terms or permission covering upstream data, mirror access, derivatives and public tile redistribution; document attribution and any restrictions. Public access is not redistribution permission.
- [ ] **API access and limits:** establish permitted automation, quotas and whole-feature/pagination contracts before changing live-access flags. Offline sample agreement is not authorization.
- [ ] **Integration review:** resolve contact-policy and winding evidence separately; verify full feature identity/counts, review any coverage boundary and `allow` semantics proposal, then seek explicit production/publication approval in a later change.

No new production region, PMTiles publication or UI change is authorized by this checklist.
