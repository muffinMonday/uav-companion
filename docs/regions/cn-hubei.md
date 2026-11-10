# cn-hubei

| | |
|---|---|
| Authority | Hubei Development and Reform Commission |
| Announced / effective | 2026-05-12 / 2026-05-14 |
| Attachment | `P020260512578795333014.zip`, folder `湖北/湖北适飞网格` |
| Semantics | `allow`: each cell is suitable-flight airspace, below 120 m true height |
| Format | ESRI shapefile, 84,863 axis-aligned rectangular cells, about 130 m up to about 1 km a side |
| CRS | Declared WGS84 (EPSG:4326). **Not yet verified against imagery** (could be GCJ-02). |
| Licence | Not stated in the attachment. Published on the project's own judgement; remove or replace if the issuer objects. |
| Fields | `name` (grid code, unique per cell), `color_code` (constant). Dropped at build. |
| Boundary | Natural Earth 1:10m Admin 1 (public domain), `boundary.geojson` |

**Boundary accuracy.** The Natural Earth outline is coarser than the official cells: about 15% of cells (1.5% of area) have their centre outside it. Near the provincial border, "outside the zone" and "no data" answers can therefore be wrong by up to about a kilometre. Cells themselves always win: a point inside a cell is reported as suitable regardless of the boundary.

**Re-downloading.** Take the attachment from the announcement above, unzip, and copy `grid.shp`, `.shx`, `.dbf`, `.prj`, `.fix` into `data/regions/cn/hubei/`.
