# Attributions

| Component | Use | Licence / terms |
|---|---|---|
| Hubei suitable-flight grid | Zone geometry | Hubei Development and Reform Commission announcement of 2026-05-12. **Licence not stated; confirm before public redistribution.** |
| Jilin, Hunan, Ningxia, Guangdong and Chongqing suitable-flight polygons | Zone geometry (`data/regions/cn/{jilin,hunan,ningxia,guangdong,chongqing}/source.json`) | Provider: KDji third-party UOM reference mirror, <https://kdji.cn/support/nfz-map.html> (May 2026 publication claim; snapshots captured 2026-09-22; effective date unknown). Used under the owner-attested KDji joint-project permission ([attestation](china-airspace/evidence/owner-api-authorization.json)). **Not a publicly established open licence.** These are third-party reference snapshots, not the officially published government shapefiles. Sources and hashes: [selected-source release](china-airspace/SELECTED_SOURCE_RELEASE.md), [Chongqing](china-airspace/EXPRESS_CHONGQING_CHENGDU.md), [regions](regions/). |
| Singapore no-fly zones (aerodrome 5 km, danger, prohibited, restricted, protected areas, NParks parks, UA flying areas) | Zone geometry (`data/regions/sg/sg-nofly/`) | Published by CAAS, MHA and NParks on OneMap (Singapore Land Authority). **Terms not yet read; published on the owner's decision. Approximate: check OneMap Drone Query.** |
| Natural Earth 1:10m Admin 0 | Singapore coverage boundary (`data/regions/sg/sg-nofly/boundary.geojson`) | Public domain |
| Natural Earth 1:10m Admin 1 | Hubei coverage boundary (`data/regions/cn/hubei/boundary.geojson`) | Public domain |
| Sichuan KDji snapshot (live) | 468 original, unmasked suitable-flight polygons, acquired 2026-11-15 through 16 overlapping provincial windows; replaces the former Chengdu registration | Same owner-attested KDji project authorization; snapshot 2026-09-22, currency and completeness unverified, temporary restrictions excluded. [Provenance and hashes](regions/cn-sichuan.md). |
| Yunnan suitable-flight polygons (image-derived, approximate) | 11 polygons vectorized by UAV Companion from a published image of the Yunnan provincial suitable-flight map, with owner corrections (`data/regions/cn/yunnan/`, [provenance](regions/cn-yunnan.md)) | Not original GIS data and not a government release. Owner-approved derivation for this project; positional and extraction inaccuracies possible; currency, completeness and permission unverified. A user-facing warning is shown with Yunnan results. |
| OpenStreetMap contributors, administrative relation 2110264 | Historical Chengdu city mask retained for rollback (`data/regions/cn/chengdu/boundary.geojson`), retrieved via Nominatim 2026-11-15 | © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); [source and credit](https://www.openstreetmap.org/copyright). Boundary distributed separately, unchanged geometry. |
| Natural Earth 1:50m Admin 0 | China outline for "is this place in China" (`src/data/china-outline.js`, by `scripts/make-china-outline.js`) | Public domain |
| Google Maps URLs, Amap URI API | Links that open a place or route in those apps (no keys, no data sent until a link is tapped) | Documented public link formats |
| OpenStreetMap | Basemap tiles, Nominatim search | ODbL; usage policy applies to tiles and Nominatim. |
| Humanitarian OpenStreetMap Team style, CyclOSM style (hosted by OpenStreetMap France) | Basemap tiles (`tile.openstreetmap.fr`, `tile-cyclosm.openstreetmap.fr`) | OSM data under ODbL; community-run servers, for light use; attribution shown on the map. |
| OpenTopoMap | Basemap tiles | CC-BY-SA; data from OSM and SRTM. |
| Open-Meteo | Weather forecast and ground elevation (terrain model), only when the visitor asks or opts in (privacy settings) | CC BY 4.0, credit shown in the weather card. Free API: non-commercial use only, under 10,000 calls a day ([terms](https://open-meteo.com/en/terms)). |
| Photon (Komoot) | Online search | Public instance, fair-use limits. |
| Leaflet | Map library | BSD-2-Clause |
| protomaps-leaflet, pmtiles | Vector tile rendering and reading | BSD-3-Clause |
| @mapbox/vector-tile, pbf | Tile decoding for the point check | BSD-3-Clause |
| geojson-vt, vt-pbf, shapefile | Build-time tooling | ISC / MIT / BSD-3-Clause |
