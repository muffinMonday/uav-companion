// Vietnam airport drone zones (vn-enr51 classes aerodrome-prohibited / aerodrome-restricted): AIP AD 2.12 threshold parsing, Decision 18/2020 rectangles
// (15 km beyond thresholds, 5 km each side; adjoining band +5 km / +3 km), ring validity, archive point checks, precedence of ENR 5.1 areas, wording.
// Reads public/data (run `node scripts/build-data.js vn-enr51` first).
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PMTiles } from 'pmtiles';
import { createServer } from 'vite';
import { ROOT } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const url = (p) => pathToFileURL(path.join(ROOT, p)).href;
const { zonesInArchive } = await import(url('src/zones.js'));
const { inverse, direct, signedArea, selfIntersects } = await import(url('scripts/airspace/my-enr51.mjs'));
const { dms, thresholds, rectangle } = await import(url('scripts/airspace/vn-ad.mjs'));
globalThis.document ??= { baseURI: 'http://localhost/' };
const vite = await createServer({ configFile: false, root: ROOT, logLevel: 'error', server: { middlewareMode: true, watch: null }, appType: 'custom', cacheDir: path.join(os.tmpdir(), 'vn-ad-vite') });
const { zoneSummary } = await vite.ssrLoadModule('/src/pointcheck.js');
const dir = path.join(ROOT, 'data/regions/vn/vn-enr51');
const gj = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const P = gj('layers/aerodrome-prohibited.geojson').features, Rr = gj('layers/aerodrome-restricted.geojson').features, prov = gj('ad-provenance.json');

// 1. Extraction
ok(dms('211330.95N') === 21.225264 && dms('1054733.25E') === 105.792569, 'DMS with decimal seconds (VVNB 11L threshold)');
const t = thresholds('x AD 2.12 RUNWAY PHYSICAL CHARACTERISTICS 06 060° 3 000 x 45 100437.01N 1054151.48E NIL THR 24 240° 3 000 x 45 100525.80N 1054316.82E NIL AD 2.13', 'VVCT');
ok(t.length === 2 && t[0].rwy === '06' && t[1].lat === dms('100525.80N') && thresholds('no table', 'X').length === 0, 'AD 2.12 thresholds parse with integer bearings; a missing table yields none');
const by = Object.fromEntries(prov.aerodromes.map((a) => [a.id, a]));
ok(by.VVNB.thresholds.length === 4 && by.VVNB.thresholds[0].text === '211330.95N 1054733.25E' && by.VVNB.arpText === '211318N 1054820E' && by.VVDN.thresholds.length === 4 && by.VVTS.thresholds.length === 4 && by.VVCS.thresholds.length === 2, 'official threshold and ARP text kept (Noi Bai 2 runways, Da Nang 2, Tan Son Nhat 2, Con Dao 1)');

// 2. Counts, identifiers, provenance
ok(prov.counts.ad1Index === 22 && prov.counts.aerodromes === 22 && prov.counts.prohibitedZones === 22 && prov.counts.restrictedZones === 22 && prov.counts.unresolved === 0 && prov.unresolved.length === 0, '22 AD 1.3 aerodromes, 22 prohibited + 22 restricted zones, none unresolved');
ok(new Set(P.map((f) => f.properties.icao)).size === 22 && new Set([...P, ...Rr].map((f) => f.properties.id)).size === 44 && P.every((f) => /^VV[A-Z]{2}$/.test(f.properties.icao)), 'unique ICAO identifiers and zone ids');
ok(prov.effective === '2026-10-01' && /18\/2020\/QD-TTg/.test(prov.rule.instrument) && /15,000 m/.test(prov.rule.prohibited) && /no circle/.test(prov.rule.basis) && prov.coverageLimits.length >= 3 && /effect status could not be confirmed/.test(prov.rule.currency), 'edition, legal basis, runway-rectangle basis and coverage limits recorded');
ok(Object.keys(prov.sources).length === 23 && Object.values(prov.sources).every((s) => /^[0-9a-f]{64}$/.test(s.sha256)), 'AD 1.3 and 22 AD 2 sources hashed');

// 3. Geometry: dimensions, winding, validity
const dim = Object.fromEntries(prov.dimensionChecks.map((c) => [c.id, c]));
const rwyLen = (a) => inverse(a.thresholds[0].lon, a.thresholds[0].lat, a.thresholds[1].lon, a.thresholds[1].lat).s;
ok(P.every((f) => { const a = by[f.properties.icao], d = dim[a.id]; return a.thresholds.length === 2 ? Math.abs(d.lengthM - (rwyLen(a) + 30000)) < 3 && Math.abs(d.widthM - 10000) < 3 : d.lengthM > 31000 && d.widthM > 10000; }), 'single-runway zones are runway length + 2 x 15 km by 10 km (within 3 m); multi-runway zones are wider than 10 km (outer centrelines)');
const rings = [...P.map((f) => f.geometry.coordinates[0]), ...Rr.map((f) => f.geometry.coordinates[0])];
ok(rings.every((r) => r.length === 5 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] && signedArea(r) > 0 && !selfIntersects(r)), 'rectangles are closed, counter-clockwise and simple');
ok(Rr.every((f) => f.geometry.coordinates.length === 2 && signedArea(f.geometry.coordinates[1]) < 0), 'each restricted zone is a band: outer rectangle with the prohibited rectangle as a hole');
const side = (r, i) => inverse(r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]).s;
ok(Rr.every((f, i) => { const o = f.geometry.coordinates[0], p = P[i].geometry.coordinates[0], a = [side(o, 0), side(o, 1)].sort((x, y) => y - x), b = [side(p, 0), side(p, 1)].sort((x, y) => y - x); return Math.abs(a[0] - b[0] - 10000) < 3 && Math.abs(a[1] - b[1] - 6000) < 3; }), 'the band adds 5 km at each end (+10 km long) and 3 km each side (+6 km wide) (Art. 4(4))');
const nb = P.find((f) => f.properties.icao === 'VVNB').geometry.coordinates[0], arp = by.VVNB.arp;
const ds = nb.slice(0, 4).map((p) => inverse(arp[0], arp[1], p[0], p[1]).s);
ok(Math.min(...ds) > 17000 && Math.max(...ds) < 19500, 'Noi Bai corners are ~18 km from the ARP (a runway rectangle, not a fixed ARP radius)');
const e = rectangle([105, 20], 90, -1000, 1000, -500, 500);
ok(e.length === 5 && Math.abs(Math.max(side(e, 0), side(e, 1)) - 2000) < 1 && Math.abs(Math.min(side(e, 0), side(e, 1)) - 1000) < 1, 'rectangle() builds geodesic sides of the requested size');

// 4. Archive: classification, point checks
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/vn/manifest.json'), 'utf8'));
const region = manifest.regions.find((r) => r.id === 'vn-enr51');
const cp = region.classes.find((c) => c.id === 'aerodrome-prohibited'), cr = region.classes.find((c) => c.id === 'aerodrome-restricted');
ok(cp.verdict === 'prohibited' && cp.count === 22 && !cp.approximate && cr.verdict === 'restricted' && cr.count === 22 && !cr.approximate, 'manifest classes: prohibited (22) and restricted (22), exact (not approximate)');
const others = region.classes.filter((c) => !c.id.startsWith('aerodrome-'));
ok(cp.severity > Math.max(...others.map((c) => c.severity)) && cr.severity > cp.severity && region.classes.slice(0, 2).every((c) => c.id.startsWith('aerodrome-')), 'airport zones rank after every ENR 5.1 class (existing P/R/D lead) and are drawn first, under them');
const bytes = fs.readFileSync(path.join(ROOT, 'public/data', region.file));
const arch = new PMTiles({ getKey: () => region.file, getBytes: async (o, n) => ({ data: Uint8Array.from(bytes.subarray(o, o + n)).buffer }) });
const at = async (lat, lon) => (await zonesInArchive(arch, region.maxZoom, lat, lon)).map((z) => z.c);
const rel = (id, along, cross) => { const a = by[id], p = a.thresholds[0], q = a.thresholds[1], r0 = inverse(p.lon, p.lat, q.lon, q.lat), mid = direct(p.lon, p.lat, r0.az, r0.s / 2), s = direct(mid[0], mid[1], along >= 0 ? r0.az : r0.az + 180, Math.abs(along)), r = cross === 0 ? s : direct(s[0], s[1], r0.az + (cross > 0 ? 90 : -90), Math.abs(cross)); return [r[1], r[0]]; };
// Con Dao VVCS (single runway on an island: no ENR 5.1 overlap)
const L = rwyLen(by.VVCS) / 2;
const only = async (id, along, cross) => (await at(...rel(id, along, cross)));
ok((await only('VVCS', 0, 0)).join() === 'aerodrome-prohibited', 'runway midpoint: airport prohibited zone only (the restricted band has a hole there)');
ok((await only('VVCS', L + 14500, 0)).join() === 'aerodrome-prohibited' && (await only('VVCS', -(L + 14500), 3000)).join() === 'aerodrome-prohibited', '14.5 km beyond a threshold is prohibited, on either end');
ok((await only('VVCS', L + 15500, 0)).join() === 'aerodrome-restricted' && (await only('VVCS', 0, 5500)).join() === 'aerodrome-restricted' && (await only('VVCS', 0, -7500)).join() === 'aerodrome-restricted', '15.5 km past a threshold, 5.5 km and 7.5 km beside the centreline are restricted only');
ok((await only('VVCS', L + 20500, 0)).length === 0 && (await only('VVCS', 0, 8500)).length === 0 && (await only('VVCS', 0, -8500)).length === 0, '20.5 km past a threshold and 8.5 km beside it are outside every zone: unknown');
const bad = [];
for (const f of P) { const a = by[f.properties.icao], c = a.thresholds[0]; if (!(await at(c.lat, c.lon)).includes('aerodrome-prohibited')) bad.push(a.id); }
ok(!bad.length, 'every first runway threshold is inside its own prohibited zone' + (bad.length ? ': ' + bad : ''));
ok((await at(10.0, 100.5)).length === 0 && (await at(20.5, 105.0)).length === 0, 'points outside every mapped polygon read no zone (unknown, never permission)');

// 5. Overlap with existing P/R/D and wording
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const prd = ['prohibited', 'restricted', 'danger'].flatMap((k) => gj(`layers/${k}.geojson`).features.map((f) => ({ k, f })));
let ov = null;
for (const a of P) for (const p of prd) if (!ov && inRing(p.f.geometry.coordinates[0], by[a.properties.icao].arp[0], by[a.properties.icao].arp[1])) ov = { a, p };
ok(!!ov, 'at least one airport ARP lies inside an ENR 5.1 area (overlap case exists)');
const zs = await zonesInArchive(arch, region.maxZoom, by[ov.a.properties.icao].arp[1], by[ov.a.properties.icao].arp[0]);
ok(zs.some((z) => z.c === 'aerodrome-prohibited') && zs.some((z) => z.c === ov.p.k), `${ov.a.properties.icao}: the archive returns the airport zone and ENR 5.1 ${ov.p.k} ${ov.p.f.properties.id}`);
const sum = zoneSummary({ status: 'inside', region, zones: zs });
ok(new RegExp('^' + { prohibited: 'Prohibited', restricted: 'Restricted', danger: 'Danger' }[ov.p.k] + ' area: ').test(sum.title) && !/airport drone/.test(sum.title) && /Also inside: Airport drone prohibited zone/.test(sum.detail), 'in an overlap the existing ENR 5.1 area decides the headline; the airport zone is listed as "Also inside"');
const alone = zoneSummary({ status: 'inside', region, zones: [{ c: 'aerodrome-prohibited', n: 'VVCS HO CHI MINH/CON DAO airport drone prohibited zone' }] });
ok(alone.cls === 'no' && /^Prohibited area: VVCS/.test(alone.title) && /not permitted/.test(alone.detail), 'an airport prohibited zone alone reads prohibited (Decision 18/2020)');
const band = zoneSummary({ status: 'inside', region, zones: [{ c: 'aerodrome-restricted', n: 'VVCS HO CHI MINH/CON DAO airport drone restricted zone' }] });
ok(band.cls === 'no' && /^Restricted area: VVCS/.test(band.title) && /conditions are met/.test(band.detail) && !/not permitted/.test(band.detail), 'the adjoining band reads restricted (conditions), never a ban');
const none = zoneSummary({ status: 'outside', region, zones: [] });
ok(none.cls === 'unk' && /does not mean flying is allowed/.test(none.detail), 'outside every zone: unknown, never permission');

// 6. The 74 ENR 5.1 geometries are byte-identical to the pre-change release
const SHA = { 'prohibited.geojson': 'e54b00ec4047b6b85d891a0212de049040ce91c2dd980d664194bf9dc6136ecf', 'restricted.geojson': 'b16470995e71dcdeddf033b5df1643048fba0b407d7d9a5df0177cc9958587fe', 'danger.geojson': '264d8742e1b4cdfce2f17b2d484d0807e7a3632ff4b45ebab119371d7328b062', 'approx-restricted.geojson': '2432794367a11146e17ca9f514d97af00aa0278805b904f561686e64fad196f2', 'approx-danger.geojson': 'adcedee5b2be73b5afcd4da2dd483b6572488e81ce18321f95ef0dea3f16fa53' };
ok(Object.entries(SHA).every(([f, h]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'layers', f))).digest('hex') === h), 'the five ENR 5.1 layer files (74 areas) are byte-identical to the release before this change');
await vite.close();
