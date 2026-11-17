# Nationwide KDji express release (2026-11-17)

Owner-authorized (see [owner authorization](evidence/owner-api-authorization.json) and the 2026-11-17 express task). Source geometry is the KDji
suitable-flight endpoint output, unchanged: no clipping, simplification or repair; positive-only selected-source semantics; completeness,
currency and flight permission unverified; temporary restrictions not included. Same disclaimer and metadata as the earlier KDji regions.

Acquisition: `scripts/airspace/kdji-express.mjs` (serial, 3 s spacing, cached raw responses with SHA-256 under git-ignored
`planning/express-nationwide/<province>/`, overlapping windows, dedupe by feature ID with identical-geometry check, GEOS validity and winding
check). A window the provider refuses ("tooWide") or fails on (server memory fatal) is split into overlapping quadrants. Checks:
`scripts/airspace/kdji-verify.mjs` (every feature interior present in the z14 tiles, 300 tile-versus-source random points). Per-province hashes: [evidence](evidence/express-nationwide.json).

| Province | Unique polygons | Windows | Occurrences | Full-envelope request |
|---|---:|---:|---:|---|
| 安徽 (`anhui`) | 172 | 10 | 381 | refused (tooWide) |
| 福建 (`fujian`) | 601 | 10 | 1326 | refused (tooWide) |
| 甘肃 (`gansu`) | 159 | 26 | 199 | refused (tooWide) |
| 广西 (`guangxi`) | 590 | 10 | 1392 | refused (tooWide) |
| 贵州 (`guizhou`) | 425 | 10 | 926 | refused (tooWide) |
| 海南 (`hainan`) | 49 | 10 | 130 | refused (tooWide) |
| 河北 (`hebei`) | 1380 | 10 | 3070 | refused (tooWide) |
| 黑龙江 (`heilongjiang`) | 125 | 26 | 177 | refused (tooWide) |
| 河南 (`henan`) | 720 | 10 | 1725 | refused (tooWide) |
| 江苏 (`jiangsu`) | 918 | 10 | 2116 | refused (tooWide) |
| 江西 (`jiangxi`) | 674 | 10 | 1462 | refused (tooWide) |
| 辽宁 (`liaoning`) | 501 | 10 | 1116 | refused (tooWide) |
| 内蒙古 (`neimenggu`) | 437 | 100 | 622 | refused (tooWide) |
| 青海 (`qinghai`) | 701 | 26 | 895 | refused (tooWide) |
| 陕西 (`shaanxi`) | 1169 | 10 | 1519 | refused (tooWide) |
| 山东 (`shandong`) | 1034 | 10 | 2310 | refused (tooWide) |
| 上海 (`shanghai`) | 233 | 10 | 566 | refused (tooWide) |
| 山西 (`shanxi`) | 305 | 10 | 662 | refused (tooWide) |
| 天津 (`tianjin`) | 356 | 10 | 800 | refused (tooWide) |
| 新疆 (`xinjiang`) | 802 | 64 | 1163 | refused (tooWide) |
| 西藏 (`xizang`) | 241 | 49 | 336 | refused (tooWide) |
| 浙江 (`zhejiang`) | 1343 | 10 | 3050 | refused (tooWide) |

Not covered: **Beijing** (province id not supported by KDji, HTTP 404); **Yunnan** (the provider returns a PHP out-of-memory fatal for every window down to about 0.14 degrees; nothing acquired, not retried further). Hong Kong, Macau, Taiwan out of scope.
Production data guard: `scripts/preflight-data.js` compared each release with the live tree (additions only).
