# Singapore no-fly zones (sg-nofly)

- Source: OneMap theme responses saved by the owner (CAAS, MHA, NParks). Layers: aerodrome 5 km, danger, prohibited, restricted (with height limits), protected areas (MHA), NParks parks and nature reserves, and three UA flying areas (pins).
- Semantics: `restrict`. Outside every zone means "not inside a mapped no-fly zone", never permission to fly. Temporary restricted areas are not included (CAAS notifies registered users by email).
- Files: `data/regions/sg/sg-nofly/source.json` and `boundary.geojson` are in git; `layers/*.json` (raw responses) are not. Rebuild with `npm run build:data` after placing the raw files.
- Published: yes (owner's decision, 2026-11-11). OneMap's terms have not been read; the data is approximate and every window links to the official OneMap Drone Query.
- Coverage: Natural Earth 1:10m outline plus a 1.5 km margin (`coverageMarginM`); Johor is "no data".
