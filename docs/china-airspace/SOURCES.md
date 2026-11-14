# Source and API investigation

Checked 2026-11-14. Findings distinguish direct observations, provider claims, inference, and unknowns. [Inventory](INVENTORY.md) records every mainland division. No government correspondence is required.

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
| Bounding box semantics | Client sends geographic west/south/east/north, converting its map view to WGS84 first. Server intersection, containment and clipping rules untested. |
| Maximum area / feature count | Unknown. No probing or nationwide geometry requests. |
| Clipping / whole features | Unknown. Need paired overlapping responses; pipeline compares full canonical geometries without unioning disagreements away. |
| Stable feature IDs | Unknown; no geometry response archived. Client rendering does not use a stable ID. |
| Pagination / truncation | No pagination loop observed in the client; this does not prove unlimited or complete results. |
| Dates | Provider claims May release / September extraction. No exact polygon snapshot/effective dates verified. May snapshots may predate official revisions. |
| Access terms | No explicit automated acquisition permission or documented API quota established. robots.txt is not an API licence. Collection disabled. |
| Redistribution | Unknown. No raw third-party geometry, screenshots, script copies or generated tiles committed. |

The user supplied a Chongqing endpoint with envelope `[105.20,28.10,110.30,32.30]` and reported a successful Guangdong response. These are leads, not independently reproduced datasets. No prior fixture was found by filename search in the repository and Downloads. Private accounts, credentials and caches outside that scope were not searched.

Four public research resources were retrieved serially, without invoking the geometry API. Local originals are ignored under `planning/china-airspace/research/`; recorded SHA-256:

| Resource | SHA-256 |
|---|---|
| map HTML | `bfd1cd0c630240c718f4e8f725847644ec89c36830b6b3c75a48250d535b2190` |
| robots.txt | `4242277756e082c750a56d7761dd5db17eab0b5c6e5788850e63216bb95665ad` |
| client JavaScript | `09caf16c8e7dbabf9e2c27da901505c769f3663c981e6f9d63b3519052143a18` |
| static index | `ad098a00c5e74b3fc052bf0710e44d11d589def71d0daf138e2f482628bf1ef7` |

Source pages change; a future retrieval may have a different checksum. None of these resource snapshots is a polygon dataset.

## Official priorities

- **Hubei:** preserve the existing official shapefile workflow and its [documented caveats](../regions/cn-hubei.md). A new web fetch of the announcement returned 412; no bypass attempted. Local raw files were readable and checked separately.
- **Jilin:** the [official page](https://jtyst.jl.gov.cn/zw_133208/tzgg/202605/t20260512_9599843.html) links a PDF and [grid ZIP](https://jtyst.jl.gov.cn/zw_133208/tzgg/202605/P020260512515648788871.zip). Download returned 403 in the web tool; collection stopped. Do not mark archive contents or CRS verified. This is a high-priority official-vector candidate once obtainable through an authorized ordinary download.
- **Fujian:** the [official notice](https://fgw.fujian.gov.cn/zwgk/gsgg/202605/t20260508_7145354.htm) exposes a JPG map in the retrieved page. No visible vector attachment; third-party claims of official vector data remain unverified.
- **Xinjiang:** the [official notice](https://jtyst.xinjiang.gov.cn/xjjtysj/zwgg/202605/f9ce592e33054a0b96c9ed18aac2f4ef.shtml) links a roughly 22 MB PDF, not a verified polygon download. Do not extract or guess production polygons from an image.
- **Shanghai:** [August 2026 edition](https://www.shanghai.gov.cn/nw12344/20260807/30c537712f1448ed9181320820ffa0cb.html) is newer than the reference provider's claimed release.
- **Tianjin:** the [June notice](https://www.tj.gov.cn/sy/tzgg/202606/t20260605_7312494.html) explicitly says it was repealed by a 2026-09-30 notice. Do not approve historical suitable-flight geometry using that notice.

Other official source candidates, failed fetches, city-only coverage, formats, dates and missing evidence are recorded per division. Unknown fields are intentional. Administrative-boundary datasets are useful for acquisition planning but are not airspace datasets or evidence of suitable-flight status. No boundary geometry was silently substituted for a zone dataset.
