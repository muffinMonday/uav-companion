// Malaysia aerodrome traffic zones -> data/regions/my/my-enr51/layers/aerodrome-traffic-zone.geojson (+ atz-provenance.json).
// Usage: node scripts/airspace/my-atz.mjs [--fetch] [--edition 2026-11-03]
// Rule (verified): MCAR 2016 reg. 140(1)(b) forbids flying an unmanned aircraft system within an aerodrome traffic zone unless authorised; CAAM Safety Information 11/2022
// (11 Aug 2022) states "CAAM classifies the boundary of an aerodrome traffic zone as 5 nautical miles (9.26 kilometers) to the aerodrome reference point (ARP)", ARPs "can be
// found on the Malaysian AIP". The notice does not distinguish controlled/uncontrolled/military/private aerodromes, so every aerodrome with a published position gets the
// same 5 NM circle; the category is recorded, not used to change the radius. Heliports: none (AD 3 omitted in the AIP). No other boundary is published, so no circle is invented.
// ARP sources: AD 2.2 item 1 "ARP coordinates" of each AD 2 aerodrome page; for AD 4 aerodromes, the position in the AD 4.1 index (no separate ARP is published; arpBasis says so).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { circleRing, inverse, ccw, signedArea, selfIntersects } from './my-enr51.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'regions', 'my', 'my-enr51');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const EDITION = arg('--edition', '2026-11-03');
const BASE = `https://aip.caam.gov.my/aip/eAIP/${EDITION}/html/eAIP/`;
const CACHE = path.join(process.env.TEMP || '/tmp', `my-atz-${EDITION}`);
export const RADIUS_M = 5 * 1852; // 9,260 m (MCAR 2016: International Nautical Mile = 1852 m)
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
  const text = buf.toString('utf8').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\bT[A-Z0-9_]+;[A-Za-z_:.0-9-]*;\d*/g, ' ').replace(/TRULES_PROC;[A-Z_]+;\d/g, ' ').replace(/\s+/g, ' ');
  return { text, sha256: sha(buf), url: BASE + name };
}

/** "034611N" / "1031234E" (DDMMSS, DDDMMSS) -> decimal degrees, 6 places. */
export const dms = (s) => {
  const m = /^(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)([NSEW])$/.exec(s);
  if (!m) throw new Error('bad coordinate ' + s);
  return +((+m[1] + +m[2] / 60 + +m[3] / 3600) * (/[SW]/.test(m[4]) ? -1 : 1)).toFixed(6);
};

const CATEGORY = (t) => (/\bINTL\b/.test(t) ? 'international' : /\bDOM\b/.test(t) && !/\bMIL\b/.test(t) ? 'domestic' : /\bMIL\b/.test(t) && !/\bDOM\b/.test(t) ? 'military' : /\bMIL\b/.test(t) ? 'domestic-military-shared' : 'state/private-use');

async function main() {
  const idx = await page('WM-AD-1.3-en-MS.html');
  // AD 1.3 rows: "NAME ICAO <traffic> IFR/VFR ..." (names can be absent of ICAO for two AD 4 strips)
  const traffic = {};
  for (const m of idx.text.matchAll(/\b(W[A-Z]{3}) ((?:(?:INTL|DOM|MIL|ST)(?:, )?)+) (?:IFR|VFR)/g)) traffic[m[1]] ??= m[2];
  const ad2Icao = [...new Set([...idx.text.matchAll(/AD 2- ?(W[A-Z]{3})/g)].map((m) => m[1]))].sort();
  const ad4Icao = [...new Set([...idx.text.matchAll(/\b(W[A-Z]{3}) (?:(?:INTL|DOM|MIL|ST)(?:, )?)+ VFR[^A]{0,12}AD 4/g)].map((m) => m[1]))].sort();

  const aerodromes = [], unresolved = [], sources = { 'AD 1.3': { url: idx.url, sha256: idx.sha256 } };
  for (const icao of ad2Icao) {
    try {
      const p = await page(`WM-AD-2.${icao}-en-MS.html`);
      const name = (new RegExp(`${icao} — (.+?) ${icao}`).exec(p.text)?.[1] ?? '').replace(/ Note:.*/, '').trim();
      const m = /ARP coordinates and site at AD\s+(?:LAT\s+)?(\d{6}(?:\.\d+)?[NS])\s+(?:LONG\s+)?(\d{7}(?:\.\d+)?[EW])/.exec(p.text);
      if (!m) { unresolved.push({ icao, name, reason: 'no ARP coordinates found in AD 2.2' }); continue; }
      sources[`AD 2 ${icao}`] = { url: p.url, sha256: p.sha256 };
      aerodromes.push({ icao, name, section: 'AD 2', arpBasis: 'AD 2.2 item 1 ARP coordinates', arpText: `${m[1]} ${m[2]}`, arp: [dms(m[2]), dms(m[1])], category: CATEGORY(traffic[icao] ?? ''), traffic: traffic[icao] ?? '' });
    } catch (e) { unresolved.push({ icao, reason: String(e.message ?? e) }); }
  }
  const ad4 = await page('WM-AD-4.1-en-MS.html');
  sources['AD 4.1'] = { url: ad4.url, sha256: ad4.sha256 };
  for (const m of ad4.text.matchAll(/\b(W[A-Z]{3}|-) ([A-Z][A-Z /().'-]*?) (\d{6}(?:\.\d+)?[NS]) (\d{7}(?:\.\d+)?[EW])\b/g)) {
    const icao = m[1] === '-' ? null : m[1];
    aerodromes.push({ icao, name: m[2].trim(), section: 'AD 4', arpBasis: 'AD 4.1 index position (no separate ARP published for AD 4 aerodromes)', arpText: `${m[3]} ${m[4]}`, arp: [dms(m[4]), dms(m[3])], category: icao ? CATEGORY(traffic[icao] ?? '') : 'state/private-use', traffic: traffic[icao] ?? '' });
  }
  // AD 1.3 lists AD 4 aerodromes: any that AD 4.1 did not yield a position for is recorded, never guessed
  // AD 1.3 rows with no location indicator ("NAME - DOM, ST VFR ... AD 4"): the position is looked up by name in AD 4.1
  for (const m of idx.text.matchAll(/ ([A-Z][A-Z /]+?) - (?:(?:INTL|DOM|MIL|ST)(?:, )?)+ VFR[^A]{0,12}AD 4/g)) {
    const name = m[1].replace(/^W[A-Z]{3} /, '').replace(/^(?:SABAH|SARAWAK) /, '').trim(), p = new RegExp(String.raw`\b${name.replace(/[/]/g, '[ /]+')} (\d{6}(?:\.\d+)?[NS]) (\d{7}(?:\.\d+)?[EW])\b`).exec(ad4.text);
    if (!p && aerodromes.some((a) => a.section === 'AD 4' && name.includes(a.name))) continue; // e.g. "TUNGUD / PAMOL" is WBKP PAMOL in AD 4.1
    if (!p) { unresolved.push({ icao: null, name, reason: 'listed in AD 1.3 (AD 4) without a location indicator; no position found in AD 4.1' }); continue; }
    aerodromes.push({ icao: null, name, section: 'AD 4', arpBasis: 'AD 4.1 index position (no separate ARP published for AD 4 aerodromes)', arpText: `${p[1]} ${p[2]}`, arp: [dms(p[2]), dms(p[1])], category: 'state/private-use', traffic: '' });
  }
  // AD 1.3 lists AD 4 aerodromes: any that AD 4.1 did not yield a position for is recorded, never guessed. AD 1.3 prints WMKU for Kuala Penyu; AD 4.1 (and the position) use WBKU.
  const ALIAS = { WMKU: 'WBKU' };
  for (const icao of ad4Icao) if (!aerodromes.some((a) => a.icao === (ALIAS[icao] ?? icao))) unresolved.push({ icao, reason: 'listed in AD 1.3 (AD 4) but AD 4.1 publishes no position for it; not inferred' });

  // stable-id dedupe: ICAO where there is one, otherwise a slug of the name
  const seen = new Set(), list = [];
  for (const a of aerodromes) {
    const id = a.icao ?? 'MY-' + a.name.replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (seen.has(id)) continue; seen.add(id); list.push({ id, ...a });
  }
  const features = [], checks = [];
  for (const a of list.sort((x, y) => x.id.localeCompare(y.id))) {
    const outer = ccw(circleRing(a.arp, RADIUS_M, 144));
    const err = Math.max(...outer.map((p) => Math.abs(inverse(a.arp[0], a.arp[1], p[0], p[1]).s - RADIUS_M)));
    const bad = [];
    if (outer[0][0] !== outer.at(-1)[0] || outer[0][1] !== outer.at(-1)[1]) bad.push('ring not closed');
    if (signedArea(outer) <= 0) bad.push('not counter-clockwise');
    if (selfIntersects(outer)) bad.push('self-intersecting');
    if (a.arp[0] < 95 || a.arp[0] > 120 || a.arp[1] < 0 || a.arp[1] > 10) bad.push('ARP outside the Malaysian window');
    if (err > 1) bad.push(`radius error ${err.toFixed(2)} m`);
    if (bad.length) { unresolved.push({ icao: a.icao, name: a.name, reason: bad.join('; ') }); continue; }
    checks.push({ id: a.id, maxRadiusErrorM: +err.toFixed(3) });
    features.push({
      type: 'Feature',
      properties: {
        id: a.id, name: `${a.id.startsWith('MY-') ? '' : a.id + ' '}${a.name} aerodrome traffic zone`.trim(), class: 'ATZ', icao: a.icao, aerodrome: a.name, category: a.category, traffic: a.traffic,
        radiusM: RADIUS_M, arp: a.arp, arpBasis: a.arpBasis, section: a.section,
        description: `Airport traffic zone, 5 NM (9.26 km) radius around the aerodrome reference point (${a.arpText}). Flying an unmanned aircraft here needs CAAM authorisation (MCAR 2016 reg. 140(1)(b); CAAM Safety Information 11/2022); this is not a flat ban. Zone height is not published. Source: AIP Malaysia ${a.section}, effective ${EDITION}.`.slice(0, 500),
        geometryKind: 'circle',
      },
      geometry: { type: 'Polygon', coordinates: [outer] },
    });
  }
  fs.mkdirSync(path.join(OUT, 'layers'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'layers', 'aerodrome-traffic-zone.geojson'), JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  const prov = {
    classification: 'aerodrome-traffic-zone', label: 'Airport traffic zone — authorisation required', edition: EDITION, effective: EDITION, radiusM: RADIUS_M, radiusNm: 5,
    rule: {
      regulation: 'Civil Aviation Regulations 2016 (P.U.(A) 97), reg. 140(1)(b): no person shall fly an unmanned aircraft system within an aerodrome traffic zone unless authorised.',
      zoneDefinition: 'CAAM Safety Information 11/2022, 11 August 2022: "CAAM classifies the boundary of an aerodrome traffic zone as 5 nautical miles (9.26 kilometers) to the aerodrome reference point (ARP)".',
      url: 'https://www.caam.gov.my/wp-content/uploads/2022/08/SI-11_2022-Unmanned-Aircraft-System-UAS-Operations-Flown-Without-Approval-From-CAAM.pdf',
      differentiation: 'The notice does not differentiate controlled, uncontrolled, military or private aerodromes; all receive the same circle and the category is recorded only.',
      currency: 'No newer published CAAM text was found (checked 2026-11-26). CAAM announced a new UAS regulation in March 2025; no published text was located, so the 2022 rule stands. SI 01/2025 re-cites reg. 140.',
      activation: 'Authorisation is by ATF; CAAM issues a NOTAM with it. NOTAMs and temporary authorisations are not tracked.',
    },
    counts: { ad1Index: { ad2: ad2Icao.length, ad4: ad4Icao.length }, aerodromes: list.length, zones: features.length, unresolved: unresolved.length },
    heliports: 'None published (AIP Malaysia AD 1.1.1.4: AD 3 omitted).',
    maxRadiusErrorM: Math.max(...checks.map((c) => c.maxRadiusErrorM)),
    sources, unresolved, aerodromes: list.map((a) => ({ id: a.id, icao: a.icao, name: a.name, section: a.section, arp: a.arp, arpText: a.arpText, category: a.category })),
  };
  fs.writeFileSync(path.join(OUT, 'atz-provenance.json'), JSON.stringify(prov, null, 1) + '\n');
  console.log(JSON.stringify({ counts: prov.counts, maxRadiusErrorM: prov.maxRadiusErrorM, unresolved }, null, 1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
