// Malaysia aerodrome traffic zones (my-enr51 class aerodrome-traffic-zone): ARP extraction, 5 NM geodesic circles, ring validity, archive point checks,
// overlap with ENR 5.1 areas and the "authorisation required" wording. Reads public/data (run `node scripts/build-data.js my-enr51` first).
import fs from 'node:fs';
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
const { dms } = await import(url('scripts/airspace/my-atz.mjs'));
globalThis.document ??= { baseURI: 'http://localhost/' };
const vite = await createServer({ configFile: false, root: ROOT, logLevel: 'error', server: { middlewareMode: true, watch: null }, appType: 'custom', cacheDir: path.join(os.tmpdir(), 'my-atz-vite') });
const { zoneSummary } = await vite.ssrLoadModule('/src/pointcheck.js');

const dir = path.join(ROOT, 'data/regions/my/my-enr51');
const gj = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const atz = gj('layers/aerodrome-traffic-zone.geojson').features;
const prov = gj('atz-provenance.json');
const R = 5 * 1852;

// 1. ARP extraction (official AD 2.2 / AD 4.1 text -> decimal degrees)
const by = Object.fromEntries(atz.map((f) => [f.properties.id, f.properties]));
ok(dms('034611N') === 3.769722 && dms('1031234E') === 103.209444 && dms('054756.10N') === 5.798917, 'DMS conversion, including decimal seconds');
ok(by.WMKK.arp[0] === 101.698056 && by.WMKK.arp[1] === 2.743333 && by.WMKK.arpBasis.startsWith('AD 2.2'), 'WMKK ARP 024436N 1014153E from AD 2.2');
ok(by.WMKD.arp.join() === '103.209444,3.769722' && by.WMGK.arp.join() === '102.484361,5.798917' && prov.aerodromes.find((a) => a.id === 'WMKB').arpText === '052802.905N 1002329.995E', 'WMKD, WMGK (decimal seconds) and WMKB ARPs read from AD 2.2');
ok(JSON.stringify(by.WBKL.arp) === JSON.stringify(gj('references.json').points['LABUAN-ARP']), 'WBKL ARP equals the Labuan ARP CAAM publishes in AD 2 (independent check)');
ok(by.WBKU.section === 'AD 4' && /no separate ARP/.test(by.WBKU.arpBasis) && by['MY-JEROCO'].arp.join() === '118.396389,5.406111', 'AD 4 aerodromes use the AD 4.1 position and say so (incl. Jeroco, which has no ICAO code)');
ok(prov.counts.aerodromes === 66 && prov.counts.zones === 66 && atz.length === 66 && new Set(atz.map((f) => f.properties.id)).size === 66, '66 aerodromes, 66 zones, stable unique ids');
ok(prov.unresolved.map((u) => u.icao).sort().join() === 'WBKE,WMAE' && prov.unresolved.every((u) => u.reason), 'WBKE and WMAE (no position in AD 4.1) are recorded as unresolved with a reason, not guessed');
ok(prov.effective === '2026-11-03' && /11 August 2022/.test(prov.rule.zoneDefinition) && /140\(1\)\(b\)/.test(prov.rule.regulation), 'edition, effective date and the rule source are preserved');

// 2. Geodesic radius, 3. validity and winding
const errs = atz.map((f) => { const c = f.properties.arp; return Math.max(...f.geometry.coordinates[0].map((p) => Math.abs(inverse(c[0], c[1], p[0], p[1]).s - R))); });
ok(Math.max(...errs) < 1 && atz.every((f) => f.properties.radiusM === 9260), `every vertex is 9,260 m from the ARP (max error ${Math.max(...errs).toFixed(3)} m, 6-decimal rounding)`);
const rings = atz.map((f) => f.geometry.coordinates[0]);
ok(rings.every((r) => r.length === 145 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]), 'rings have 144 vertices and are closed');
ok(rings.every((r) => signedArea(r) > 0 && !selfIntersects(r)), 'rings are counter-clockwise and simple');
ok(rings.every((r) => { const area = Math.abs(signedArea(r)); return area > 0; }), 'rings have non-zero area');
ok(atz.every((f) => f.geometry.type === 'Polygon' && f.properties.class === 'ATZ' && f.properties.geometryKind === 'circle'), 'zones are circle polygons with class ATZ');

// 4. Built archive: manifest class, centre and boundary point checks
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/my/manifest.json'), 'utf8'));
const region = manifest.regions.find((r) => r.id === 'my-enr51');
const cls = region.classes.find((c) => c.id === 'aerodrome-traffic-zone');
ok(!!cls && cls.verdict === 'authorisation-required' && cls.label === 'Airport traffic zone — authorisation required' && cls.count === 66 && !cls.approximate, 'the manifest carries the class, its label, verdict and zone count');
ok(cls.severity > Math.max(...region.classes.filter((c) => c.verdict !== 'authorisation-required').map((c) => c.severity)) && region.classes.map((c) => c.id)[0] === 'aerodrome-traffic-zone', 'airport zones sort after every P/R/D class and are drawn first (under them)');
const bytes = fs.readFileSync(path.join(ROOT, 'public/data', region.file));
const arch = new PMTiles({ getKey: () => region.file, getBytes: async (o, n) => ({ data: Uint8Array.from(bytes.subarray(o, o + n)).buffer }) });
const at = (lat, lon) => zonesInArchive(arch, region.maxZoom, lat, lon);
const hasAtz = (zs, id) => zs.some((z) => z.c === 'aerodrome-traffic-zone' && z.n.startsWith(id + ' '));
let centreMiss = [], inMiss = [], outMiss = [];
for (const f of atz) {
  const { id, arp } = f.properties;
  if (!hasAtz(await at(arp[1], arp[0]), id) && !(f.properties.icao === null && (await at(arp[1], arp[0])).some((z) => z.c === 'aerodrome-traffic-zone'))) centreMiss.push(id);
  const [ix, iy] = direct(arp[0], arp[1], 90, R - 40), [ox, oy] = direct(arp[0], arp[1], 90, R + 40);
  if (!(await at(iy, ix)).some((z) => z.c === 'aerodrome-traffic-zone')) inMiss.push(id);
  if ((await at(oy, ox)).some((z) => z.c === 'aerodrome-traffic-zone' && z.n.startsWith(id + ' '))) outMiss.push(id);
}
ok(!centreMiss.length, 'every ARP is inside its own zone in the archive' + (centreMiss.length ? ': ' + centreMiss : ''));
ok(!inMiss.length, 'a point 40 m inside the 5 NM boundary (due east) is inside a zone for every aerodrome' + (inMiss.length ? ': ' + inMiss : ''));
ok(!outMiss.length, 'a point 40 m outside the boundary is not in that aerodrome\'s zone' + (outMiss.length ? ': ' + outMiss : ''));
const far = await at(3.139, 101.687);
ok(far.length === 0, 'central Kuala Lumpur (outside every zone) stays unknown: no zone, no permission implied');

// 5. Overlap with ENR 5.1 and 6. wording
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const prd = ['prohibited', 'restricted', 'danger'].flatMap((k) => gj(`layers/${k}.geojson`).features.map((f) => ({ k, f })));
const overlap = [];
for (const a of atz) for (const p of prd) if (inRing(p.f.geometry.coordinates[0], a.properties.arp[0], a.properties.arp[1])) overlap.push({ a, p });
ok(overlap.length > 0, `${overlap.length} airport zone centres also lie inside a verified ENR 5.1 area (overlap cases exist)`);
const ov = overlap[0], zs = await at(ov.a.properties.arp[1], ov.a.properties.arp[0]);
ok(zs.some((z) => z.c === 'aerodrome-traffic-zone') && zs.some((z) => z.c === ov.p.k), 'at an overlap point the archive returns both the airport zone and the P/R/D zone');
const sum = zoneSummary({ status: 'inside', region, zones: zs });
const worst = ['prohibited', 'restricted', 'danger'].find((k) => zs.some((z) => z.c === k));
ok(new RegExp('^' + { prohibited: 'Prohibited', restricted: 'Restricted', danger: 'Danger' }[worst] + ' area').test(sum.title) && /Also inside: Airport traffic zone — authorisation required/.test(sum.detail), 'in an overlap the P/R/D area decides the headline and the airport zone is listed as well');
const only = zoneSummary({ status: 'inside', region, zones: [{ c: 'aerodrome-traffic-zone', n: 'WMKK KL INTERNATIONAL / SEPANG aerodrome traffic zone' }] });
ok(only.cls === 'no' && /^Airport traffic zone — authorisation required/.test(only.title) && /not an outright ban/.test(only.detail) && /prior authorisation from the Civil Aviation Authority of Malaysia/.test(only.detail), 'an airport zone alone reads "Airport traffic zone — authorisation required", not a ban');
ok(!/^(Prohibited|Restricted|Danger) area|No-fly/.test(only.title) && !/not permitted/.test(only.detail), 'an airport zone is never worded as prohibited, restricted, danger or no-fly');
const worstApprox = zoneSummary({ status: 'inside', region, zones: [{ c: 'aerodrome-traffic-zone', n: 'X' }, { c: 'approx-restricted', n: 'WMR239A' }] });
ok(/^Potential restricted airspace — approximate boundary/.test(worstApprox.title) && /Also inside: Airport traffic zone — authorisation required/.test(worstApprox.detail), 'an approximate P/R/D area still headlines over an airport zone, which is listed');
const none = zoneSummary({ status: 'outside', region, zones: [] });
ok(none.cls === 'unk' && /does not mean flying is allowed/.test(none.detail), 'outside every zone: unknown, never permission');
await vite.close();
