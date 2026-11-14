# Source and API investigation

Checked 2026-11-14. Findings distinguish direct observations, provider claims, inference, and unknowns. [Inventory](INVENTORY.md) records every mainland division. [Supplied-fixture results](PILOTS.md) now supplement the initial public-client investigation. No government correspondence is required.

## Reference provider: KDji

Public research resources:

- [Map](https://kdji.cn/support/nfz-map.html)
- [Public client JavaScript](https://kdji.cn/theme.js?v=1793806591)
- [Public static index](https://kdji.cn/assets/nfz-map-20261010/miniapp-index.json)
- [robots.txt](https://kdji.cn/robots.txt)
- [Small observed index summary](evidence/kdji-index-summary.json)

The map describes a third-party miniapp mirror: release month May 2026, extraction month September 2026. These are provider claims, not independently verified polygon effective dates. It labels suitable-flight and internal-control references separately and directs users to UOM.

The client calls `action=uom`, passing a province ID and `west/south/east/north` longitude/latitude bounds. Its display converts incoming coordinates to GCJ-02; a client comment describes WGS84 data. This suggests WGS84 inputs, but does not prove polygon alignment. The index's `airportsCoordinateSystem` field applies to airports.

The client renders outer polygons as suitable-flight reference and polygon holes as internal-control reference. Preserve holes; do not flatten them or infer the meaning of every returned feature solely from the action name. It requests geometry only at map zoom 9 or above. That is a client display rule, not evidence of a server query limit.

The static index lists 30 province IDs; Beijing is absent. All listed entries claim `hasData: true`. Special IDs include `neimenggu` for Inner Mongolia and `xizang` for Tibet. Exact observed IDs and the index checksum are in the summary. `hasData` proves neither current availability nor completeness.

| Question | Evidence / remaining work |
|---|---|
| Bounding box semantics | Client sends geographic west/south/east/north. All three supplied Guangdong ID lists match feature-bbox filtering of their observed union; one polygon does not itself intersect its query. Universal server behavior remains unverified. |
| Maximum area / feature count | Unknown. No probing or nationwide geometry requests. |
| Clipping / whole features | Shared Guangdong geometry is identical and extends beyond query windows: no capture-specific clipping observed. This is sampled evidence, not a universal contract or comparison to official originals. |
| Stable feature IDs | Supplied `properties.id` values are unique within all four captures. Guangdong shared IDs have identical geometry/properties; stability across revisions and Chongqing repeat requests remains untested. |
| Pagination / truncation | No pagination loop observed in the client; this does not prove unlimited or complete results. |
| Dates | Responses claim May publication and snapshot timestamps on 2026-09-22. These are source metadata, not established HTTP capture or legal effective dates. |
| Access terms | No explicit automated acquisition permission or documented API quota established. robots.txt is not an API licence. Collection disabled. |
| Redistribution | Unknown. No raw third-party geometry, screenshots, script copies or generated tiles committed. |

The user supplied the original responses after the initial filename search found none. The expected 55/79/777 counts match, plus an additional 80-feature Guangzhou capture. The [manifest](../../data/china-airspace/fixture-manifest.json) binds their bytes and embedded query/source metadata. No live geometry requests were needed. Receipt checksums cannot authenticate historical uploads or prove regulatory provenance.

Four public research resources were retrieved serially, without invoking the geometry API. Local originals are ignored under `planning/china-airspace/research/`; recorded SHA-256:

| Resource | SHA-256 |
|---|---|
| map HTML | `bfd1cd0c630240c718f4e8f725847644ec89c36830b6b3c75a48250d535b2190` |
| robots.txt | `4242277756e082c750a56d7761dd5db17eab0b5c6e5788850e63216bb95665ad` |
| client JavaScript | `09caf16c8e7dbabf9e2c27da901505c769f3663c981e6f9d63b3519052143a18` |
| static index | `ad098a00c5e74b3fc052bf0710e44d11d589def71d0daf138e2f482628bf1ef7` |

Source pages change; a future retrieval may have a different checksum. These four initial research resources are distinct from the subsequently supplied polygon-response archives.

Independent topology cross-check uses [Shapely validity reasons](https://shapely.readthedocs.io/en/stable/reference/shapely.is_valid_reason.html) and its [STRtree](https://shapely.readthedocs.io/en/stable/strtree.html) for candidate overlap checks. The optional environment is pinned separately from application dependencies. Geometry validity is a planar technical result, not a coordinate alignment or airspace-authority determination.

## Official priorities

- **Hubei:** preserve the existing official shapefile workflow and its [documented caveats](../regions/cn-hubei.md). A new web fetch of the announcement returned 412; no bypass attempted. Local raw files were readable and checked separately.
- **Jilin:** [Phase 1](PHASE1.md) obtained the official grid ZIP through an ordinary Windows curl GET (HTTP 200), without bypassing the earlier web-tool restriction. All 79,784 cells and sidecars were inspected; geographic WGS84 is declared, alignment remains unverified. Full local staging/build and 16 point checks/rendering passed. Source/legal/boundary/redistribution approvals remain open; nothing registered or published.
- **Hunan:** the official notice's ZIP was acquired and all 102,483 cells independently audited. The unchanged integration CLI exhausts its work budget; no subset was substituted. See the [technical report and source blockers](PHASE1.md).
- **Shanxi/Shandong:** September revisions were located as leads. Shanxi's current primary URL failed to connect; Shandong's May SHP-labelled download is actually a DOCX cloud-share pointer, not geometry. Do not assume either older extent is current. Exact URLs and failure evidence are in [Phase 1](PHASE1.md).
- **Ningxia:** published mobile notice and its linked RAR downloaded HTTP 200. RAR5 signature verified; local extractor cannot read member filenames. No feature count, CRS or vector contents claimed as verified. [Acquisition manifest](evidence/phase1/acquisition-manifest.json).
- **Fujian:** the [official notice](https://fgw.fujian.gov.cn/zwgk/gsgg/202605/t20260508_7145354.htm) exposes a JPG map in the retrieved page. No visible vector attachment; third-party claims of official vector data remain unverified.
- **Xinjiang:** the [official notice](https://jtyst.xinjiang.gov.cn/xjjtysj/zwgg/202605/f9ce592e33054a0b96c9ed18aac2f4ef.shtml) links a roughly 22 MB PDF, not a verified polygon download. Do not extract or guess production polygons from an image.
- **Shanghai:** [August 2026 edition](https://www.shanghai.gov.cn/nw12344/20260807/30c537712f1448ed9181320820ffa0cb.html) is newer than the reference provider's claimed release.
- **Tianjin:** the [September 30 primary notice](https://www.tj.gov.cn/sy/tzgg/202609/t20260930_7386087.html) was inspected in Phase 1: it describes the entire administrative area as controlled airspace and expressly repeals the June notice. No geometry or regulatory semantics were implemented; any future `restrict` proposal requires separate review.

Other official source candidates, failed fetches, city-only coverage, formats, dates and missing evidence are recorded per division. Unknown fields are intentional. Administrative-boundary datasets are useful for acquisition planning but are not airspace datasets or evidence of suitable-flight status. No boundary geometry was silently substituted for a zone dataset.
