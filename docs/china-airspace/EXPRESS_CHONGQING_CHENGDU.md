# Chongqing / Chengdu express release

2026-11-14. Chongqing is technically qualified; normal PR/deployment pending.
Chengdu is acquired and independently validated, **withheld from publication**.
Exact artifact identities and validation: [evidence](evidence/express-chongqing-chengdu.json).

Chongqing preserves the original checksum-bound 777-feature capture, metadata,
coordinates, contacts and holes. GEOS validates every feature and winding derivative.
The triangle `chongqing-271-0` collapses at the default z14/4096 integer grid.
An explicit regional `tilePrecision.maxZoomExtent: 65536` uses finer standard MVT
coordinates at z14 only. Lower zooms and default builds retain extent 4096.
There is no geometry repair, substitute point, runtime change or global resolution increase.
The existing extent-aware point reader and Leaflet renderer handle both extents.
All 777 source interiors, 13 point cases and real rendering pass. The exact tiny
triangle additionally passes inside/outside and desktop/mobile pixel-location tests.

Chengdu: a short official-domain check found no usable machine-readable download;
the known Sichuan government notice was inaccessible. Existing owner-attested
permission covers bounded provincial API retrieval and public PMTiles derivatives.
Two overlapping Sichuan API queries cover `[102.85,30,104.95,31.5]`, a padded city
envelope based on published government coordinates. Both complete raw responses,
HTTP metadata and checksums are archived under `planning/express/chengdu-capture-network/`.
59 occurrences deduplicate to **57 original polygons**, with two exact repeats,
no conflicts, agreeing shared geometry and observed bbox filtering. All 57 pass
full independent GEOS validity, winding/coordinate identity and overlap checks.
No truncation/pagination markers were returned; universal limits and completeness remain unknown.

The source returns whole polygons. `sichuan-66-0` spans much of Sichuan, far outside
Chengdu. Publishing the full union as city coverage would be misleading. The current
selected-source renderer does not mask geometry by an administrative boundary.
Chengdu therefore has **no production registration or published PMTiles**. The next
step needs a reviewed city boundary and matching rendering/point-query coverage mask,
with the complete original union retained. The query rectangle is not an administrative boundary.

Chongqing retains the existing positive-only selected-source policy, unknown legal
effective date and non-official disclaimer. All existing four-region, Hubei and
Singapore artifacts are retained byte-for-byte. No temporary restrictions are claimed.

Rollback baseline: production `ceffda1254bf8a1d39db92373686e28fe052b1da`;
complete static archive `planning/express/previous-production-ceffda1.zip`, SHA-256
`3513b889b24afa9eb857e903a2a8538a6670a2fb6596b9e232d50a87979a9d74`.
Restore the entire previous data tree and previous registration state together,
preserving unrelated changes; validate and redeploy with `npm run deploy:live`.
Do not remove an archive while a manifest references it.
