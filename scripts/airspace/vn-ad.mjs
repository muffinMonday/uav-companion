// Vietnam aerodrome drone zones -> data/regions/vn/vn-enr51/layers/aerodrome-{prohibited,restricted}.geojson (+ ad-provenance.json).
// Usage: node scripts/airspace/vn-ad.mjs [--fetch] [--edition 2026-10-01-AIRAC]
// Rule (Decision 18/2020/QD-TTg of the Prime Minister, 10 June 2020, English translation read on luatvietnam.vn; Vietnamese original and amendment status not verified):
//  Art. 3(4): prohibited area at airports/aerodromes where civil and military aircraft operate = a RECTANGLE (not a circle): from the runway thresholds extended 15,000 m
//  lengthwise and 5,000 m widthwise from the runway centreline, all altitudes; 2+ runways: from the thresholds of the farthest runways, 5,000 m from the centreline of the two
//  outer runways. 3(4)(c): airports with <6 civil flights/day may use a flexible zone (approval of military flight management and ATM). Art. 4(4): adjacent restricted area =
//  prohibited rectangle expanded 3,000 m widthwise and 5,000 m lengthwise. No distance is measured from the ARP, so no ARP circle is drawn and Malaysia's 5 NM is NOT used.
// Thresholds: AIP Viet Nam AD 2.12 "THR coordinates" of each AD 2 aerodrome in AD 1.3. Aerodromes whose thresholds cannot be read or whose runways are not parallel are
// recorded as unresolved, never guessed. The Decision's Appendix illustrations were not available (untranslated), so the multi-runway rectangle is the text's reading.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { direct, inverse, ccw, signedArea, selfIntersects } from './my-enr51.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'regions', 'vn', 'vn-enr51');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
export const EDITION = arg('--edition', '2026-10-01-AIRAC');
const BASE = `https://aim.vatm.vn/images/stories/vnaic.vn/SanPhamDichVu/AIPVietNam/AIP/${EDITION}/html/eAIP/`;
const CACHE = path.join(process.env.TEMP || '/tmp', `vn-ad-${EDITION}`);
export const LEN_M = 15000, WIDTH_M = 5000, ADJ_LEN_M = 5000, ADJ_WIDTH_M = 3000; // Decision 18/2020 Art. 3(4)(a,b) and 4(4)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function page(name) {
  const f = path.join(CACHE, name);
  if (!fs.existsSync(f) || process.argv.includes('--fetch')) {
    const res = await fetch(BASE + name, { headers: { 'user-agent': 'uav-companion-data-build' } });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  const buf = fs.readFileSync(f);
  const text = buf.toString('utf8').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\bT[A-Z0-9_]+;[A-Za-z_:.0-9-]*;\d*/g, ' ').replace(/\s+/g, ' ');
  return { text, sha256: sha(buf), url: BASE + name };
}

/** "211330.95N" / "1054733.25E" (DDMMSS, DDDMMSS) -> decimal degrees, 6 places. */
export const dms = (s) => {
  const m = /^(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)([NSEW])$/.exec(s);
  if (!m) throw new Error('bad coordinate ' + s);
  return +((+m[1] + +m[2] / 60 + +m[3] / 3600) * (/[SW]/.test(m[4]) ? -1 : 1)).toFixed(6);
};
const rad = (d) => (d * Math.PI) / 180;

/** Runway thresholds of an AD 2.12 table: [{rwy, bearing, lon, lat, text}] in table order. */
export function thresholds(text, icao) {
  const a = text.search(/AD 2\.12\s+RUNWAY PHYSICAL/), b = text.indexOf('AD 2.13', a);
  if (a < 0 || b < 0) return [];
  return [...text.slice(a, b).matchAll(/\b(\d{2}[LRC]?) (\d{2,3}(?:\.\d+)? ?°)[^°]*?(\d{6}(?:\.\d+)?N) (\d{7}(?:\.\d+)?E)/g)]
    .map((m) => ({ icao, rwy: m[1], lon: dms(m[4]), lat: dms(m[3]), text: `${m[3]} ${m[4]}` }));
}

/** Rectangle with a geodesic frame: origin O, axis azimuth theta; extents along [a0,a1] and across [c0,c1] (metres). Corners are walked along the axis, then across it. */
export function rectangle(O, theta, a0, a1, c0, c1) {
  const at = (a) => { // the point a metres along the axis and its local axis bearing
    const p = a === 0 ? O : direct(O[0], O[1], a > 0 ? theta : theta + 180, Math.abs(a));
    const back = a === 0 ? theta : (inverse(p[0], p[1], O[0], O[1]).az + (a > 0 ? 180 : 0)) % 360;
    return [p, back];
  };
  const corner = (a, c) => { const [p, az] = at(a); return (c === 0 ? p : direct(p[0], p[1], az + (c > 0 ? 90 : -90), Math.abs(c))).map((v) => +v.toFixed(6)); };
  const r = [corner(a0, c0), corner(a1, c0), corner(a1, c1), corner(a0, c1)];
  return ccw([...r, r[0]]);
}

async function main() {
  const idx = await page('VV-AD-1.3-en-GB.html');
  const rows = [...idx.text.matchAll(/([A-Z][A-Z /-]+?) (VV[A-Z]{2}) (INTL - NTL|NTL) IFR - VFR/g)].map((m) => ({ name: m[1].replace(/^(?:VV[A-Z]{2} )+/, '').trim(), icao: m[2], category: m[3] === 'NTL' ? 'national' : 'international-national' }));
  const ad2 = [...new Set([...idx.text.matchAll(/AD 2 - (VV[A-Z]{2})/g)].map((m) => m[1]))].sort();
  const sources = { 'AD 1.3': { url: idx.url, sha256: idx.sha256 } }, aerodromes = [], unresolved = [], features = { prohibited: [], restricted: [] }, checks = [];
  for (const icao of ad2) {
    const row = rows.find((r) => r.icao === icao);
    try {
      const p = await page(`VV-AD-2.${icao}-en-GB.html`);
      sources[`AD 2 ${icao}`] = { url: p.url, sha256: p.sha256 };
      const name = row?.name ?? (new RegExp(`${icao} — (.+?) ${icao}`).exec(p.text)?.[1] ?? icao);
      const arp = /ARP coordinates and site at AD\s+(?:LAT\s+)?(\d{6}(?:\.\d+)?[NS])\s*[-–—]?\s*(?:LONG\s+)?(\d{7}(?:\.\d+)?[EW])/.exec(p.text);
      const thr = thresholds(p.text, icao);
      const a = { id: icao, icao, name, category: row?.category ?? 'unknown', arp: arp ? [dms(arp[2]), dms(arp[1])] : null, arpText: arp ? `${arp[1]} ${arp[2]}` : null, thresholds: thr.map(({ rwy, lon, lat, text }) => ({ rwy, lon, lat, text })) };
      aerodromes.push(a);
      if (thr.length < 2 || thr.length % 2) { unresolved.push({ icao, name, reason: `AD 2.12 yielded ${thr.length} threshold coordinates (need pairs); no rectangle drawn` }); continue; }
      // axis = the longest threshold pair; every runway must lie within 10 degrees of it (parallel runways), otherwise the multi-runway rectangle is ambiguous
      let best = { s: -1 };
      for (let i = 0; i < thr.length; i++) for (let j = i + 1; j < thr.length; j++) { const r = inverse(thr[i].lon, thr[i].lat, thr[j].lon, thr[j].lat); if (r.s > best.s) best = { ...r, i, j }; }
      const O = [thr[best.i].lon, thr[best.i].lat], theta = best.az;
      let nonParallel = false;
      for (let k = 0; k < thr.length; k += 2) { const az = inverse(thr[k].lon, thr[k].lat, thr[k + 1].lon, thr[k + 1].lat).az, d = Math.abs(((az - theta + 540) % 360) - 180); if (Math.min(d, 180 - d) > 10) nonParallel = true; }
      if (nonParallel) { unresolved.push({ icao, name, reason: 'runways are not parallel; the published rule (rectangle from the farthest runways) is ambiguous, no rectangle drawn' }); continue; }
      let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      for (const t of thr) { const r = inverse(O[0], O[1], t.lon, t.lat), d = rad(r.az - theta); const al = r.s * Math.cos(d), cr = r.s * Math.sin(d); a0 = Math.min(a0, al); a1 = Math.max(a1, al); c0 = Math.min(c0, cr); c1 = Math.max(c1, cr); }
      const inner = rectangle(O, theta, a0 - LEN_M, a1 + LEN_M, c0 - WIDTH_M, c1 + WIDTH_M);
      const outer = rectangle(O, theta, a0 - LEN_M - ADJ_LEN_M, a1 + LEN_M + ADJ_LEN_M, c0 - WIDTH_M - ADJ_WIDTH_M, c1 + WIDTH_M + ADJ_WIDTH_M);
      const bad = [];
      for (const [n, r] of [['prohibited', inner], ['restricted', outer]]) {
        if (signedArea(r) <= 0) bad.push(`${n} ring not counter-clockwise`);
        if (selfIntersects(r)) bad.push(`${n} ring self-intersecting`);
        if (r.some((q) => q[0] < 102 || q[0] > 110 || q[1] < 8 || q[1] > 24)) bad.push(`${n} ring outside the Vietnamese window`);
      }
      // dimension check: inner long side must equal the runway extent plus 2 x 15 km (within 5 m, geodesic vs frame)
      const e0 = inverse(inner[0][0], inner[0][1], inner[1][0], inner[1][1]).s, e1 = inverse(inner[1][0], inner[1][1], inner[2][0], inner[2][1]).s, side = Math.max(e0, e1), wide = Math.min(e0, e1), want = a1 - a0 + 2 * LEN_M;
      if (Math.abs(side - want) > 5) bad.push(`long side ${side.toFixed(1)} m, expected ${want.toFixed(1)} m`);
      if (Math.abs(wide - (c1 - c0 + 2 * WIDTH_M)) > 5) bad.push(`short side ${wide.toFixed(1)} m, expected ${(c1 - c0 + 2 * WIDTH_M).toFixed(1)} m`);
      if (bad.length) { unresolved.push({ icao, name, reason: bad.join('; ') }); continue; }
      checks.push({ id: icao, lengthM: +side.toFixed(1), widthM: +wide.toFixed(1) });
      const common = { icao, aerodrome: name, category: a.category, thresholds: a.thresholds.map((t) => `${t.rwy} ${t.text}`).join('; '), runwayCount: thr.length / 2, section: 'AD 2.12', geometryKind: 'runway-rectangle' };
      features.prohibited.push({ type: 'Feature', properties: { id: icao + '-P', name: `${icao} ${name} airport drone prohibited zone`, class: 'AD-P', ...common,
        description: `Drone prohibited zone at an airport: rectangle 15 km beyond the runway thresholds and 5 km either side of the runway centreline, all altitudes (Decision 18/2020/QD-TTg Art. 3(4)). Airports with fewer than 6 civil flights a day may apply a flexible zone with military and air traffic approval. Thresholds: AIP Viet Nam AD 2.12, ${EDITION}.` }, geometry: { type: 'Polygon', coordinates: [inner] } });
      features.restricted.push({ type: 'Feature', properties: { id: icao + '-R', name: `${icao} ${name} airport drone restricted zone`, class: 'AD-R', ...common,
        description: `Drone restricted zone adjoining the airport prohibited zone: a further 3 km each side and 5 km at each end (Decision 18/2020/QD-TTg Art. 4(4)). Flight needs the permission of the competent authority. Thresholds: AIP Viet Nam AD 2.12, ${EDITION}.` }, geometry: { type: 'Polygon', coordinates: [outer, [...inner].reverse()] } });
    } catch (e) { unresolved.push({ icao, name: row?.name, reason: String(e.message ?? e) }); }
  }
  for (const k of ['prohibited', 'restricted']) features[k].sort((x, y) => x.properties.id.localeCompare(y.properties.id));
  fs.mkdirSync(path.join(OUT, 'layers'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'layers', 'aerodrome-prohibited.geojson'), JSON.stringify({ type: 'FeatureCollection', features: features.prohibited }) + '\n');
  fs.writeFileSync(path.join(OUT, 'layers', 'aerodrome-restricted.geojson'), JSON.stringify({ type: 'FeatureCollection', features: features.restricted }) + '\n');
  const prov = {
    classification: ['aerodrome-prohibited', 'aerodrome-restricted'], edition: EDITION, effective: '2026-10-01',
    rule: {
      instrument: 'Decision No. 18/2020/QD-TTg of the Prime Minister, 10 June 2020 (effective 10 June 2020; Official Gazette 647-648), establishing prohibited and restricted areas for unmanned aircraft and ultra-light flying objects.',
      url: 'https://english.luatvietnam.vn/decision-no-18-2020-qd-ttg-on-establishment-of-prohibited-areas-and-restricted-areas-for-unmanned-aircraft-184590-doc1.html',
      prohibited: 'Art. 3(4)(a,b): airports and aerodromes where civil and military aircraft operate: rectangle from the runway thresholds extended 15,000 m and 5,000 m either side of the centreline (outer runways for 2+), all altitudes.',
      flexible: 'Art. 3(4)(c): airports with fewer than 6 civil flights per day may apply a flexible prohibited area (no flights inside the airport boundary, or none within an hour of manned operations) and flights need approval of military flight management and ATM. Flight counts are not in the AIP, so no airport is treated as flexible.',
      restricted: 'Art. 4(4): adjoining area expanded 3,000 m widthwise and 5,000 m lengthwise from the prohibited area; flight needs the competent authority (Art. 4(5)).',
      basis: 'Runway-based rectangles; no aerodrome reference point radius exists in the rule, so no circle and no Malaysian 5 NM radius is used.',
      currency: `Checked 2026-11-26: no amendment or repeal found; effect status could not be confirmed (official Vietnamese text and consolidated status are behind a login). Decree 288/2025/ND-CP and a 2026 draft decree were not read. English translation only; the Appendix illustrations were not read.`,
    },
    counts: { ad1Index: ad2.length, aerodromes: aerodromes.length, prohibitedZones: features.prohibited.length, restrictedZones: features.restricted.length, unresolved: unresolved.length },
    coverageLimits: ['Military-only aerodromes and heliports are not in AIP AD 1.3/AD 2 coordinates and are not mapped.', 'The 120 m AGL and crowded/border restricted areas of Art. 4 are not geographic here.', 'Temporary MND prohibitions (Art. 3(6)), NOTAMs and the 500 m / 200 m margins of other sites are not tracked.'],
    dimensionChecks: checks, sources, unresolved,
    aerodromes: aerodromes.map((a) => ({ id: a.id, name: a.name, category: a.category, arp: a.arp, arpText: a.arpText, thresholds: a.thresholds })),
  };
  fs.writeFileSync(path.join(OUT, 'ad-provenance.json'), JSON.stringify(prov, null, 1) + '\n');
  console.log(JSON.stringify({ counts: prov.counts, unresolved }, null, 1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
