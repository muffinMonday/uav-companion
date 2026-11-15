# Sichuan original-source inputs

See [provenance](../../../../docs/regions/cn-sichuan.md) and
[release/rollback procedure](../../../../docs/china-airspace/SICHUAN_REPLACEMENT.md).
`zones.geojson` is ignored raw data: 468 original, unmasked KDji polygons.
`source.json` retains selected-source confidence and positive-only semantics.

Use `node scripts/airspace/prepare-sichuan.mjs` with the archived bounded captures
to reconstruct the exact original union, compare all 57 historical Chengdu features,
and rerun GEOS. No live requests occur in that command. The acquisition config and
all original responses are included in the local validated package. Administrative
boundaries are not inputs to Sichuan rendering, point checks or acquisition filtering.
