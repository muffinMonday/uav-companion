# Adding a region

A region is one official dataset for one area (a province, a city, a country). You submit its description, and the maintainer builds and publishes the tiles. Do not commit raw data or built tiles.

1. **Folder.** Create `data/regions/<country>/<region>/` (country code lower-case, e.g. `cn`, `sg`). A new country also needs `data/regions/<country>/country.json` (`id`, `name`, optional `nameZh`, and `view`: `[minLon, minLat, maxLon, maxLat]`, the box the "Go to" menu zooms to). A country with a `view` appears in that menu even before it has data.
2. **`source.json`.** Copy `data/regions/cn/hubei/source.json` and edit it:
   - `id`: `<country>-<region>`, lower-case.
   - `format`: `shapefile` or `geojson`; `file`: the main file inside the folder.
   - `crs`: `wgs84` or `gcj02` (converted at build). Anything else needs a converter in `scripts/lib/crs.js`.
   - `semantics`: `allow` or `restrict` (see README). Get this right: it decides what the app tells a pilot.
   - `maxHeightM`: the height limit if the source states one.
   - `source`: `authority`, `announced`, `effective`, and where the data was downloaded.
   - `license`: the licence or terms. If unknown write `unknown`. Set `publish` to `false` for any dataset whose terms do not allow redistribution.
3. **`boundary.geojson`.** A WGS84 polygon of the area the dataset covers (Natural Earth and geoBoundaries are open sources). The app uses it to tell "outside the zones" from "no data here". Without it the dataset's bounding box is used, which is less accurate.
4. **Provenance.** Add `docs/regions/<id>.md`: announcement link, date, licence, how to re-download, anything odd about the data.
5. **Build and check.** Put the raw files in the folder (they are gitignored), run `npm run build:data <id>`, and for rectangular-cell shapefiles `npm run verify:data <id>`. Open the map, compare the zones with a satellite basemap at a known landmark, then set `crsVerified` to `true`.
6. **Places (optional).** Add or extend `data/places/<country>.txt` (`local name|English name|lat|lon|city/county/landmark`).

Attribute-based classes (for example different height limits per zone) are not supported yet: the build drops attributes. If a dataset needs them, open an issue first.
