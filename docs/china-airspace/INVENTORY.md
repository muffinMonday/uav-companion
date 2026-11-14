# Nationwide acquisition inventory

Checked 2026-11-14. Machine-readable details: [inventory.json](../../data/china-airspace/inventory.json). This is a discovery inventory, not a coverage assertion. Dates below are notice publication dates, not polygon effective dates. The reference index claims 30 divisions; Beijing is absent. All new datasets remain blocked. Null fields mean unknown, never unrestricted airspace.

| Division | Code | Official source / observation | Format | Publication date | Readiness |
|---|---|---|---|---|---|
| Beijing | CN-11 | [official-notice](https://www.beijing.gov.cn/zhengce/gfxwj/202508/t20250804_4165802.html) | notice/map | 2025-08-04 | blocked |
| Tianjin | CN-12 | [official-notice-repealed](https://www.tj.gov.cn/sy/tzgg/202606/t20260605_7312494.html) | notice/map | 2026-06-05 | blocked |
| Hebei | CN-13 | [candidate-unverified](https://jtt.hebei.gov.cn/jtyst/zwgk/jcxxgk/tggs/101777341425751.html) | unknown | Unknown | blocked |
| Shanxi | CN-14 | [candidate-fetch-failed](https://jtyst.shanxi.gov.cn/jtzx/tzgg/202602/t20260203_10055293.shtml) | SHP reported, uninspected | Unknown | blocked |
| Inner Mongolia | CN-15 | unavailable | unknown | Unknown | blocked |
| Liaoning | CN-21 | [official-city-notice](https://www.shenyang.gov.cn/zwgk/qtzfxx/zfgg/202605/t20260527_5032074.html) | notice/map | 2026-05-27 | blocked |
| Jilin | CN-22 | [official-vector-link-download-blocked](https://jtyst.jl.gov.cn/zw_133208/tzgg/202605/t20260512_9599843.html) | ZIP grid + PDF | 2026-05-12 | blocked |
| Heilongjiang | CN-23 | [official-notice](https://www.heihe.gov.cn/hhs/c100750/202601/c11_346506.shtml) | notice/map | 2026-01-16 | blocked |
| Shanghai | CN-31 | [official-notice](https://www.shanghai.gov.cn/nw12344/20260807/30c537712f1448ed9181320820ffa0cb.html) | notice/map | 2026-08-07 | blocked |
| Jiangsu | CN-32 | [official-notice](https://www.nanjing.gov.cn/zt/njdzdkjjcygd/dkfwptzn/202605/t20260526_5846368.html) | map/interactive-platform | 2026-05-26 | blocked |
| Zhejiang | CN-33 | [candidate-unverified](https://jtyst.zj.gov.cn/col/col1229248360/art/2026/art_563de3a7376348a7920d256e45c1fcb7.html) | interactive-platform/unknown | Unknown | blocked |
| Anhui | CN-34 | [candidate-fetch-failed](https://jtt.ah.gov.cn/xwdt/zwdt/123189101.html) | unknown | Unknown | blocked |
| Fujian | CN-35 | [official-map](https://fgw.fujian.gov.cn/zwgk/gsgg/202605/t20260508_7145354.htm) | JPG map | 2026-05-08 | blocked |
| Jiangxi | CN-36 | [official-notice](https://www.nc.gov.cn/ncszf/tzgg/202605/d28f8b20a98b4244bcd5b37e1bb32640.shtml) | notice/map | Unknown | blocked |
| Shandong | CN-37 | [candidate-unverified](https://jtt.shandong.gov.cn/art/2026/5/14/art_15843_10329329.html) | unknown | Unknown | blocked |
| Henan | CN-41 | [candidate-unverified](https://fgw.henan.gov.cn/2026/05-15/3354631.html) | notice/map reported | Unknown | blocked |
| Hubei | CN-42 | [existing-official-vector](https://fgw.hubei.gov.cn/fbjd/zc/zcwj/gg/202605/t20260512_5934799.shtml) | ESRI shapefile | 2026-05-12 | existing-production-unchanged-not-new-approval |
| Hunan | CN-43 | [official-notice](https://fgw.hunan.gov.cn/fgw/xxgk_70899/gzdtf/gzdt/202605/t20260513_33975865.html) | notice/interactive-map | 2026-05-13 | blocked |
| Guangdong | CN-44 | [official-context-only](https://www.jiangmen.gov.cn/home/bmdt/content/post_3495659.html) | third-party GeoJSON reported | 2026-05-25 | blocked |
| Guangxi | CN-45 | [candidate-unverified](https://jtt.gxzf.gov.cn/zfxxgk/fdzdgk/tzgg/t27550208.shtml) | unknown | Unknown | blocked |
| Hainan | CN-46 | unavailable | unknown | Unknown | blocked |
| Chongqing | CN-50 | reference-only | third-party GeoJSON reported | Unknown | blocked |
| Sichuan | CN-51 | [candidate-fetch-failed](https://www.sc.gov.cn/10462/10778/10876/2026/5/12/ee71fce56e6c4c5abf9a59258bedafcc.shtml) | unknown | Unknown | blocked |
| Guizhou | CN-52 | unavailable | unknown | Unknown | blocked |
| Yunnan | CN-53 | [official-city-notice](https://lincang.gov.cn/artview/3/351049.html) | notice/map | 2026-05-18 | blocked |
| Tibet | CN-54 | unavailable | unknown | Unknown | blocked |
| Shaanxi | CN-61 | [official-city-notice](https://www.baoji.gov.cn/col9816/col17241/col9826/col9986/202607/t20260707_1283128.html) | notice/map | 2026-07-07 | blocked |
| Gansu | CN-62 | unavailable | unknown | Unknown | blocked |
| Qinghai | CN-63 | [candidate-fetch-failed](https://fgw.qinghai.gov.cn/xwzx/tzgg/202605/t20260514_91670.html) | unknown | Unknown | blocked |
| Ningxia | CN-64 | [candidate-fetch-failed](https://jtt.nx.gov.cn/xwzx/tzgg/202605/t20260511_5236967.html) | unknown | Unknown | blocked |
| Xinjiang | CN-65 | [official-notice](https://jtyst.xinjiang.gov.cn/xjjtysj/zwgg/202605/f9ce592e33054a0b96c9ed18aac2f4ef.shtml) | PDF map (22 MB) | 2026-05-13 | blocked |

Per-entry acquisition method, snapshot date, completeness, CRS, geometry result, redistribution, quality, last check and limitations are in the JSON. `verified-official` for Hubei describes established source provenance; it does not resolve its existing alignment or licence caveats. No other entry has been assigned verified status.
