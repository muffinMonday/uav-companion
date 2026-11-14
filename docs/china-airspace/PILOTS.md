# Guangdong and Chongqing pilot results

Checked 2026-11-14. These are **blocked acquisition pilots**, not completed province datasets. Both configurations are unverified reference and remain outside `data/regions`. No new flight verdicts or PMTiles were generated.

| Check | Guangdong | Chongqing |
|---|---|---|
| Public client index identifier | `guangdong`, `hasData` claimed | `chongqing`, `hasData` claimed |
| Historical lead | User reports successful GeoJSON response | User supplied a GeoJSON API endpoint |
| Previously acquired fixture | Not located locally | Not located locally |
| Geometry requests in this run | 0 | 0 |
| Planned partition | 4 columns × 3 rows, 5% overlap | 3 columns × 3 rows, 5% overlap |
| Planning envelope | `[109.5,20.1,117.4,25.6]` | `[105.2,28.1,110.3,32.3]` |
| Boundary | Approximate envelope only | User query envelope only |
| Geometry/topology/IDs | Not tested: no response | Not tested: no response |
| CRS | Provider client suggests WGS84; alignment unverified | Provider client suggests WGS84; alignment unverified |
| Overlap reproduction | Not tested: no paired responses | Not tested: no paired responses |
| Provincial completeness | Unverified | Unverified |
| Polygon semantics | Unverified | Unverified |
| Exact effective/snapshot date | Unknown | Unknown |
| Redistribution and API limits | Unknown | Unknown |
| Integration readiness | Blocked | Blocked |

The public client treats holes as internal-control reference, and the map claims a May release extracted in September. Those observations do not certify the supplied geometry endpoints. A [Jiangmen government article](https://www.jiangmen.gov.cn/home/bmdt/content/post_3495659.html) describes Guangdong's updated extent but provides no feature-level correspondence to KDji. Chongqing's [management rules](https://www.cq.gov.cn/zwgk/zfxxgkml/szfwj/zfgz/zfgz/202312/t20231205_12655876.html) are context rather than polygon evidence. No selected source geometry could be compared against authoritative maps without a source fixture; this validation remains outstanding.

Small machine-readable results: [Guangdong](pilots/cn-guangdong.report.json), [Chongqing](pilots/cn-chongqing.report.json). Reproduce them and the local `preview.html` maps with the two `pilot` commands in the [instructions](README.md). The previews show proposed overlapping queries and a visible `blocked-no-source-fixture` status. They deliberately do not draw invented polygons, label blank space as unrestricted, or fetch external tiles.

To resume independently of API access, put lawfully obtained GeoJSON responses in an ignored local directory and use `localFiles`, including each original query's bbox where known. Start with two overlapping queries and an independent larger query, confirm stable IDs and whole geometries, then audit request coverage against an authoritative province boundary. Repeatability in a shared window is a sample check, not a proof of provincial completeness. Do not change the pilot's permission or whole-feature flags merely to get past a guard.
