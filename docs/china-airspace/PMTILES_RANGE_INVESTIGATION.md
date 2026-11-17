# PMTiles HTTP Range investigation (2026-11-17)

**Status: range loading is NOT reliable on production. No range source was implemented. The whole-file source stays.** Nothing deployed, no infrastructure changed.

## Confirmed findings (live probes against https://uavcompanion.com/data/tiles/, node `fetch` and raw `https`)

Archives: `sg-nofly.52266140` (363,509 B), `cn-ningxia.99868b1d` (692,619 B), `cn-sichuan.493d55a3` (8,547,247 B, the largest). Each was fetched whole (SHA-256 prefix equals the hash in the name: full GETs are correct), then 8 ranges x 3 repeats were compared byte for byte (header, root directory, metadata, three data offsets, the last 1000 bytes, an odd offset).

| Check | Result |
|---|---|
| Full GET | 200, bytes correct, `Content-Encoding: gzip` for `Accept-Encoding: gzip`, `Access-Control-Allow-Origin: *` |
| Range, any `Accept-Encoding` (gzip, identity, none) | 206, but `Content-Range` total is the **gzip size** (sg 359,081; ningxia 239,638; sichuan 1,629,199) instead of the file size |
| Range body vs reference slice | mismatch on every range (24 of 24 per archive); the body equals the same slice of the **gzip stream** (verified for sg) |
| Range near the end of the real file | 416 (offset beyond the gzip length) |
| `Accept-Encoding: identity` | still a gzip slice, and **no `Content-Encoding` header** on it, so the bytes are mislabelled |
| Repeats (3x) | identical every time: deterministic, not intermittent |
| Other types on the same host | `.png`: ranges correct (not compressed). `.json`: same defect as `.pmtiles` |

## Root cause

Confirmed: the edge (Cloudflare in front of uavcompanion.com, over a Varnish cache) compresses `application/octet-stream` and JSON responses and applies the `Range` header to the **compressed representation**. The browser asks for bytes of the identity file, so every range is wrong, and the wrong `Content-Range` total and `Content-Length` are the symptoms seen on 2026-11-15 ("stale object"). The earlier diagnosis, a stale cached object, was a misreading of the same fault.

Content-hashed URLs do **not** fix it: the hashed `tiles/` URLs were probed and fail the same way. A browser could not use the responses even in principle, because it would receive a partial gzip stream.

Hypothesis, not tested (needs a deploy, which was not authorised): an extension or content type that the edge does not compress (`.png` is served uncompressed with correct ranges) would make ranges correct. It would need a hash-named file with a non-compressible type and a repeat of this probe.

## Context that changes the cost-benefit

- Deployed archives total about 25 MB on disk (8 regions, largest 8.5 MB), not "nearly all provinces".
- The whole-file download is already gzip-compressed on the wire: Sichuan is about 1.6 MB transferred for 8.5 MB held in memory; Ningxia 0.24 of 0.69 MB. The Cache API keeps the validated copy, so a reload costs 0 bytes.
- Loading is already lazy: only archives whose bounds meet the view are fetched.

## Decision and options for the owner

1. **Keep whole-file loading (recommended now).** No change; transfer is smaller than the file sizes suggest.
2. If more provinces make memory the limit, test a non-compressed extension on one archive (e.g. a `.bin` or similar), deploy to a scratch path, rerun `node scripts/range-probe.mjs` (byte comparison) and only then build a range source. A range source must verify every range against something: PMTiles has no per-range checksum, so the source would need a sha256 of the directory plus per-tile verification, or a fallback to whole-file on any header/length mismatch.
3. A different host (R2/S3 with identity encoding) is the other route; infrastructure change, needs owner approval.

Probe script: `scripts/range-probe.mjs`; it needs only the base URL and archive paths.
