// Vietnam AIM/VATM eAIP ENR 5.1 (Prohibited VVP, Restricted VVR, Danger VVD areas) -> data/regions/vn/vn-enr51/layers/*.geojson.
// Usage: node scripts/airspace/vn-enr51.mjs [--fetch] [--html <file>] [--edition 2026-10-01-AIRAC]
// Geometry only where the published text defines it deterministically: explicit DMS coordinate polygons and geodesic (WGS84 Vincenty) centre/radius circles.
// Referenced-boundary definitions (airway parallels, aerodrome runways, ...) stay unresolved in exceptions.json; nothing is inferred or approximated.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { circleRing, inverse, coords, ring, ccw, signedArea, selfIntersects } from './my-enr51.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'regions', 'vn', 'vn-enr51');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const EDITION = arg('--edition', '2026-10-01-AIRAC');
const URL_ENR51 = `https://aim.vatm.vn/images/stories/vnaic.vn/SanPhamDichVu/AIPVietNam/AIP/${EDITION}/html/eAIP/VV-ENR-5.1-en-GB.html`;
const CACHE = arg('--html', path.join(OUT, 'source', 'VV-ENR-5.1-en-GB.html'));
const VN_WINDOW = { lon: [100, 118], lat: [6, 24] }; // Vietnamese FIRs plus their sea areas
const MAX_EDGE_M = 60000, MAX_DIAG_M = 150000; // plausibility screen for a mistyped vertex: no published polygon here legitimately exceeds this
const CLS = { P: 'prohibited', R: 'restricted', D: 'danger' };
const ID_RE = /^(VV[PRD]\d+[A-Z]?)\b/;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const strip = (s) => s.replace(/<span class="sdParams"[^>]*>.*?<\/span>/gs, '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim();
const paras = (td) => [...td.matchAll(/<p [^>]*>([\s\S]*?)<\/p>/g)].map((m) => strip(m[1])).filter(Boolean);
const lead = (s) => s.replace(/^"[^"]*">\s*/, '');

/** Table rows -> { rows, skipped }. Columns: identifier + name + geometry | upper / lower limit | remarks. */
function parseRows(html) {
  const rows = [], skipped = [];
  let section = null;
  for (const r of html.split(/<tr id=/).slice(1)) {
    const tds = r.split(/<\/td>/).slice(0, -1);
    if (tds.length === 1) { const t = strip(tds[0]); if (/PROHIBITED AREAS/.test(t)) section = 'P'; else if (/RESTRICTED AREAS/.test(t)) section = 'R'; else if (/DANGER AREAS/.test(t)) section = 'D'; continue; }
    if (tds.length !== 3) continue;
    const text = lead(strip(tds[0])), m = text.match(ID_RE);
    if (!m) { skipped.push(text.slice(0, 60)); continue; }
    const id = m[1];
    if (id[2] !== section) throw new Error(`${id}: designation letter does not match its table section (${section})`);
    const nameSpan = tds[0].match(/<span class="SD"[^>]*>([^<]*)<\/span><span class="sdParams"[^>]*>TAIRSPACE;TXT_NAME/);
    const name = nameSpan ? strip(nameSpan[1]) : '';
    let geom = text.slice(m[0].length).trim();
    if (name && geom.startsWith(name)) geom = geom.slice(name.length).trim();
    const [upper = '', lower = ''] = paras(tds[1]);
    rows.push({ id, designation: section, cls: CLS[section], name, text: geom, upper, lower, vertical: `${upper} / ${lower}`, remarks: strip(tds[2]) });
  }
  return { rows, skipped };
}

const COORD_AND_DASH = /\d{6}\s*[NS]\s*\d{7}\s*[EW]|\s-\s|\s+-\s*$/g;
/** Geometry from one description -> { ring, kind, center?, radiusM? } or { reason }. Only coordinate polygons and centre/radius circles. */
function geometryOf(text) {
  const cs = coords(text);
  const circle = text.match(/^\s*A circle,\s*(\d+(?:\.\d+)?)\s*(KM|NM|M)\s+radius,\s*centred (?:at|on)\s/i);
  if (circle) {
    if (cs.length !== 1) return { reason: 'circle without exactly one centre coordinate' };
    const rM = +circle[1] * ({ KM: 1000, NM: 1852, M: 1 })[circle[2].toUpperCase()];
    return { ring: circleRing(cs[0].p, rM, 144), kind: 'circle', center: cs[0].p, radiusM: rM };
  }
  const rest = text.replace(COORD_AND_DASH, '').trim();
  if (rest) return { reason: `description is not a plain coordinate list or circle (${rest.slice(0, 120)}...)` };
  if (cs.length < 4) return { reason: 'fewer than four coordinates' };
  const pts = cs.map((c) => c.p);
  if (pts[0][0] !== pts.at(-1)[0] || pts[0][1] !== pts.at(-1)[1]) return { reason: 'polygon is not closed in the source (last vertex differs from the first)' };
  return { ring: ring(pts), kind: 'polygon' };
}

/** Validation of an emitted ring; returns failure strings (empty when valid). */
function validate(g, outer) {
  const fail = [];
  if (outer[0][0] !== outer.at(-1)[0] || outer[0][1] !== outer.at(-1)[1]) fail.push('ring not closed');
  if (Math.abs(signedArea(outer)) < 1e-9) fail.push('zero area');
  if (signedArea(outer) < 0) fail.push('clockwise winding');
  if (selfIntersects(outer)) fail.push('self-intersecting ring');
  if (outer.some(([x, y]) => x < VN_WINDOW.lon[0] || x > VN_WINDOW.lon[1] || y < VN_WINDOW.lat[0] || y > VN_WINDOW.lat[1])) fail.push('vertex outside the Vietnamese window (lon/lat order?)');
  if (g.kind === 'polygon') {
    const edges = outer.slice(1).map((p, i) => inverse(outer[i][0], outer[i][1], p[0], p[1]).s);
    if (Math.max(...edges) > MAX_EDGE_M) fail.push(`implausible edge of ${(Math.max(...edges) / 1000).toFixed(0)} km (a mistyped vertex in the source?)`);
    const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
    if (inverse(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)).s > MAX_DIAG_M) fail.push('implausible extent');
  }
  if (g.kind === 'circle') {
    const e = Math.max(...outer.map((p) => Math.abs(inverse(g.center[0], g.center[1], p[0], p[1]).s - g.radiusM) / g.radiusM));
    if (e > 0.005) fail.push(`circle radius error ${(e * 100).toFixed(2)}%`);
  }
  return fail;
}

// Curated reasons for the areas left unresolved (checked against the published text).
const NOTES = {
  VVR19: ['external-reference', 'boundaries are the parallels 15 km from airways W1 and R468 (ENR 3 route geometry), a runway-relative line at Bien Hoa and a 75 km circle about the Tan Son Nhat ARP; not defined by coordinates in ENR 5.1. Checked 2026-11-24 against the official ENR 3.1/3.3/4.1/4.4 of the 2026-10-01 edition: W1 gives AC (An Loc NDB) but no point `BU`, and R468 ends at TAN SON NHAT (TSH) in the Vietnamese AIP, so PNH (Phnom Penh, AIP Cambodia) has no official Vietnamese coordinates; the runway-relative line and "parallel" extents are also undefined. Not reconstructed'],
  VVD43: ['source-inconsistent', 'the 4th vertex 200333N 1052801E is a full degree of latitude from its neighbours (210333N intended?); not corrected. Checked 2026-11-24: ENR 5.1 text is identical in the 2025-01-23, 2025-09-04, 2026-01-22, 2026-03-19, 2026-05-14 and 2026-10-01 AIRAC editions, and the official chart ENR 5.1-11 (graphics/9130, identical in 2025-01-23 and 2026-10-01) draws the same far vertex, so neither is independent evidence'],
  VVD45: ['source-inconsistent', 'the 1st vertex 210159N 1062002E is 1 degree of longitude from its neighbours (1052002E intended?); not corrected. Same check as VVD43: identical text in six editions and the same far vertex drawn on chart ENR 5.1-11'],
};

async function main() {
  if (process.argv.includes('--fetch') || !fs.existsSync(CACHE)) {
    const res = await fetch(URL_ENR51);
    if (!res.ok) throw new Error(`fetch ${URL_ENR51}: ${res.status}`);
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
  }
  const buf = fs.readFileSync(CACHE), html = buf.toString('utf8');
  const { rows, skipped } = parseRows(html);
  const ids = rows.map((r) => r.id), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) throw new Error(`duplicate IDs in source: ${dup.join(', ')}`);

  const layers = { prohibited: [], restricted: [], danger: [] }, exceptions = [];
  for (const r of rows) {
    const g = geometryOf(r.text);
    let reason = g.reason;
    if (g.ring) { const f = validate(g, ccw(g.ring)); if (f.length) reason = f.join('; '); }
    if (reason) {
      const [category, detail] = NOTES[r.id] ?? [/implausible|self-intersect|not closed/.test(reason) ? 'source-inconsistent' : 'unclassified', ''];
      exceptions.push({ id: r.id, class: r.designation, category, reason: detail ? `${reason} [${detail}]` : reason });
      continue;
    }
    const description = `Upper ${r.upper}, lower ${r.lower || 'n/a'}. ${r.remarks}`.replace(/\.\s*\./g, '.').trim().slice(0, 500);
    layers[r.cls].push({
      type: 'Feature',
      properties: { id: r.id, name: `${r.id}${r.name ? ' ' + r.name : ''}`, class: r.designation, upper: r.upper, lower: r.lower, vertical: r.vertical, restriction: '', remarks: r.remarks, description, geometryKind: g.kind },
      geometry: { type: 'Polygon', coordinates: [ccw(g.ring)] },
    });
  }
  fs.mkdirSync(path.join(OUT, 'layers'), { recursive: true });
  for (const [k, features] of Object.entries(layers)) fs.writeFileSync(path.join(OUT, 'layers', `${k}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  const emitted = Object.values(layers).flat();
  const report = {
    source: { url: URL_ENR51, edition: EDITION, htmlSha256: sha(buf), htmlBytes: buf.length, rawCopy: path.relative(OUT, CACHE).replace(/\\/g, '/') },
    parsed: rows.length, applicable: rows.length, excluded: [], converted: emitted.length, unresolved: exceptions.length,
    counts: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, { parsed: rows.filter((r) => r.cls === k).length, converted: v.length }])),
    notAreas: skipped, exceptions,
  };
  fs.writeFileSync(path.join(OUT, 'exceptions.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ parsed: report.parsed, converted: report.converted, unresolved: report.unresolved, counts: report.counts, sha256: report.source.htmlSha256, exceptions: exceptions.map((e) => `${e.id} [${e.category}]: ${e.reason.slice(0, 140)}`) }, null, 1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
export { parseRows, geometryOf, validate, EDITION };
