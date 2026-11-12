---
name: region-data
description: Add, rebuild or verify a flight-zone region dataset (shapefile to pmtiles). Use when a task touches data/regions/, scripts/build-data.js, scripts/verify-data.js, scripts/lib/ or docs/regions/.
---

# region-data

- Source per region: `data/regions/<country>/<region>/source.json` (+ `boundary.geojson`). Raw shapefiles are git-ignored and local. Write the region's facts (authority, dates, semantics, CRS, licence, boundary accuracy) in `docs/regions/<id>.md`, using `cn-hubei.md` as the model; read only that file.
- Build: `node --max-old-space-size=8192 scripts/build-data.js <regionId>` (no id rebuilds everything; avoid that unless asked). Output goes to git-ignored `public/data/`, or `public/data-local/` when `"publish": false`.
- Verify: `node scripts/verify-data.js <regionId> [samples]` compares tiles with the shapefile (rectangular-cell sources only). Report mismatches; do not hide them.
- Unit check of the build libraries: `node tests/run.mjs onemap` (also covers `strip-local.js`).
- `publish: false` regions must never be deployed: do not touch `scripts/strip-local.js` behaviour. Published data and licence claims need the owner's decision.
- Deploying data goes through the normal deploy, which needs the owner's approval.
