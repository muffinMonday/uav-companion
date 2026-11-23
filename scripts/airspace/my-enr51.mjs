// Malaysia CAAM eAIP ENR 5.1 (Prohibited, Restricted, Danger areas) -> data/regions/my/my-enr51/layers/*.geojson.
// Usage: node scripts/airspace/my-enr51.mjs [--fetch] [--html <file>] [--edition 2026-11-03]
// Only geometry that the published text defines deterministically is emitted: coordinate polygons, circles (geodesic), lat/long boxes and
// arcs with a stated centre, radius and direction. Everything else is listed in exceptions.json with a one-line reason; nothing is guessed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'regions', 'my', 'my-enr51');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const EDITION = arg('--edition', '2026-11-03');
const URL_ENR51 = `https://aip.caam.gov.my/aip/eAIP/${EDITION}/html/eAIP/WM-ENR-5.1-en-MS.html`;
const CACHE = arg('--html', path.join(process.env.TEMP || '/tmp', `my-enr51-${EDITION}.html`));

// ---- WGS84 geodesy (Vincenty direct and inverse) ----
const A = 6378137, F = 1 / 298.257223563, B = (1 - F) * A, rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
function direct(lon, lat, az, s) {
  const a1 = rad(az), tanU1 = (1 - F) * Math.tan(rad(lat)), cosU1 = 1 / Math.sqrt(1 + tanU1 ** 2), sinU1 = tanU1 * cosU1;
  const s1 = Math.atan2(tanU1, Math.cos(a1)), sinA = cosU1 * Math.sin(a1), cos2A = 1 - sinA ** 2;
  const u2 = (cos2A * (A * A - B * B)) / (B * B);
  const k1 = (Math.sqrt(1 + u2) - 1) / (Math.sqrt(1 + u2) + 1), kA = (1 + k1 ** 2 / 4) / (1 - k1), kB = k1 * (1 - (3 * k1 ** 2) / 8);
  let sg = s / (B * kA), prev, c2m, sinS, cosS;
  do {
    c2m = Math.cos(2 * s1 + sg); sinS = Math.sin(sg); cosS = Math.cos(sg);
    const dS = kB * sinS * (c2m + (kB / 4) * (cosS * (-1 + 2 * c2m ** 2) - (kB / 6) * c2m * (-3 + 4 * sinS ** 2) * (-3 + 4 * c2m ** 2)));
    prev = sg; sg = s / (B * kA) + dS;
  } while (Math.abs(sg - prev) > 1e-12);
  const x = sinU1 * sinS - cosU1 * cosS * Math.cos(a1);
  const lat2 = Math.atan2(sinU1 * cosS + cosU1 * sinS * Math.cos(a1), (1 - F) * Math.hypot(sinA, x));
  const l = Math.atan2(sinS * Math.sin(a1), cosU1 * cosS - sinU1 * sinS * Math.cos(a1));
  const C = (F / 16) * cos2A * (4 + F * (4 - 3 * cos2A));
  const L = l - (1 - C) * F * sinA * (sg + C * sinS * (c2m + C * cosS * (-1 + 2 * c2m ** 2)));
  return [lon + deg(L), deg(lat2)];
}
function inverse(lon1, lat1, lon2, lat2) { // distance (m) and initial azimuth (deg)
  const U1 = Math.atan((1 - F) * Math.tan(rad(lat1))), U2 = Math.atan((1 - F) * Math.tan(rad(lat2))), L = rad(lon2 - lon1);
  let lam = L, sinS, cosS, sg, cos2A, c2m, it = 0, sinL, cosL;
  do {
    sinL = Math.sin(lam); cosL = Math.cos(lam);
    sinS = Math.hypot(Math.cos(U2) * sinL, Math.cos(U1) * Math.sin(U2) - Math.sin(U1) * Math.cos(U2) * cosL);
    if (!sinS) return { s: 0, az: 0 };
    cosS = Math.sin(U1) * Math.sin(U2) + Math.cos(U1) * Math.cos(U2) * cosL; sg = Math.atan2(sinS, cosS);
    const sinA = (Math.cos(U1) * Math.cos(U2) * sinL) / sinS; cos2A = 1 - sinA ** 2;
    c2m = cos2A ? cosS - (2 * Math.sin(U1) * Math.sin(U2)) / cos2A : 0;
    const C = (F / 16) * cos2A * (4 + F * (4 - 3 * cos2A)), prev = lam;
    lam = L + (1 - C) * F * sinA * (sg + C * sinS * (c2m + C * cosS * (-1 + 2 * c2m ** 2)));
    if (Math.abs(lam - prev) < 1e-12) break;
  } while (++it < 200);
  const u2 = (cos2A * (A * A - B * B)) / (B * B);
  const kA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), kB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = kB * sinS * (c2m + (kB / 4) * (cosS * (-1 + 2 * c2m ** 2) - (kB / 6) * c2m * (-3 + 4 * sinS ** 2) * (-3 + 4 * c2m ** 2)));
  const az = deg(Math.atan2(Math.cos(U2) * sinL, Math.cos(U1) * Math.sin(U2) - Math.sin(U1) * Math.cos(U2) * cosL));
  return { s: B * kA * (sg - dS), az: (az + 360) % 360 };
}

// ---- text helpers ----
const COORD = /(\d{2})(\d{2})(\d{2}(?:\.\d+)?)?\s*([NS])[\s,]*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)?\s*([EW])/g;
const coordOf = (m) => {
  const lat = (+m[1] + +m[2] / 60 + (+m[3] || 0) / 3600) * (m[4] === 'S' ? -1 : 1);
  const lon = (+m[5] + +m[6] / 60 + (+m[7] || 0) / 3600) * (m[8] === 'W' ? -1 : 1);
  return [+lon.toFixed(6), +lat.toFixed(6)];
};
const coords = (t) => [...t.matchAll(COORD)].map((m) => ({ p: coordOf(m), i: m.index, end: m.index + m[0].length }));
const toM = (v, u) => v * ({ NM: 1852, KM: 1000, M: 1, FT: 0.3048 })[u.toUpperCase()];
const BAD_POLY = /\b(arc|arcs|coast|coastline|border|bdry|boundary|boundaries|railway|road|canal|ctr|ctl|tma|tangents?|racetrack|excluding|along|dme|vor|rdl|circles?|radius|centred|centered)\b/i;
const BAD_CIRCLE = /\b(arc|arcs|coast|coastline|border|bdry|boundary|boundaries|along|tangents?|racetrack|excluding|joined|joining|from|thence|dme|vor|rdl)\b/i;

const ring = (pts) => { const r = pts.map((p) => [...p]); if (r[0][0] !== r.at(-1)[0] || r[0][1] !== r.at(-1)[1]) r.push([...r[0]]); return r; };
const signedArea = (r) => r.reduce((s, p, i) => (i ? s + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : s), 0) / 2;
const ccw = (r) => (signedArea(r) < 0 ? [...r].reverse() : r);
function selfIntersects(r) {
  const seg = (i) => [r[i], r[i + 1]], n = r.length - 1;
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const [a, b] = seg(i), [c, d] = seg(j);
    if (o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)) return true;
  }
  return false;
}

function circleRing(c, rM, n = 144) {
  const pts = [];
  for (let k = 0; k < n; k++) pts.push(direct(c[0], c[1], (360 * k) / n, rM).map((v) => +v.toFixed(6)));
  return ring(pts);
}
function arcPoints(c, rM, from, to, clockwise, step = 2) {
  const a0 = inverse(c[0], c[1], from[0], from[1]).az, a1 = inverse(c[0], c[1], to[0], to[1]).az;
  let sweep = clockwise ? (a1 - a0 + 360) % 360 : -((a0 - a1 + 360) % 360);
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / step)), pts = [];
  for (let k = 1; k < n; k++) pts.push(direct(c[0], c[1], a0 + (sweep * k) / n, rM).map((v) => +v.toFixed(6)));
  return pts;
}

// ---- geometry from one description; returns { ring } or { reason } ----
function geometryOf(text) {
  const cs = coords(text);
  if (/\bBTN\s+LAT\b/i.test(text)) {
    const lats = [...text.matchAll(/\b(\d{2})(\d{2})(\d{2})([NS])\b/g)].map((m) => (+m[1] + +m[2] / 60 + +m[3] / 3600) * (m[4] === 'S' ? -1 : 1));
    const lons = [...text.matchAll(/\b(\d{3})(\d{2})(\d{2})([EW])\b/g)].map((m) => (+m[1] + +m[2] / 60 + +m[3] / 3600) * (m[4] === 'W' ? -1 : 1));
    if (lats.length !== 2 || lons.length !== 2) return { reason: 'latitude/longitude box without exactly two of each' };
    const [la0, la1] = lats.sort((a, b) => a - b), [lo0, lo1] = lons.sort((a, b) => a - b);
    return { ring: ring([[lo0, la0], [lo1, la0], [lo1, la1], [lo0, la1]].map((p) => p.map((v) => +v.toFixed(6)))), kind: 'box' };
  }
  const rad1 = text.match(/(\d+(?:\.\d+)?)\s*(NM|KM|FT|M)\b/i);
  if (rad1 && /radius|within|centred|centered/i.test(text) && cs.length === 1) {
    if (BAD_CIRCLE.test(text)) return { reason: 'circle combined with a coastline, border or other boundary reference' };
    const rM = toM(+rad1[1], rad1[2]);
    return { ring: circleRing(cs[0].p, rM), kind: 'circle', center: cs[0].p, radiusM: rM };
  }
  if (/\barc\b/i.test(text)) return arcPolygon(text, cs);
  if (BAD_POLY.test(text)) return { reason: 'boundary refers to a coastline, border, navaid, airspace boundary or arc without stated centre/direction' };
  if (cs.length < 3) return { reason: 'fewer than three coordinates' };
  const pts = cs.map((c) => c.p), closed = pts.length > 3 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1];
  const distinct = closed ? pts.length - 1 : pts.length;
  if (!closed && distinct < 4 && !/\b(bounded|bounding|within|contained)\b/i.test(text)) return { reason: 'open path of three points (shape not defined)' };
  return { ring: ring(pts), kind: 'polygon' };
}

/** A polygon with arcs: each arc needs a stated centre, radius, direction and endpoint coordinates; otherwise the area is unresolved. */
function arcPolygon(text, cs) {
  if (BAD_POLY.test(text.replace(/\b(arc|arcs|radius|circle|circles|centred|centered|along|dme|vor)\b/gi, ''))) return { reason: 'arc area with a coastline, border or airspace-boundary reference' };
  if (/\b(dme|vor)\b/i.test(text.replace(/\([^)]*\)/g, '')) && !/centred|centered/i.test(text)) return { reason: 'arc centred on a navaid with no stated coordinates' };
  const centres = cs.filter((c) => /(centred|centered)\s*(on|at|from)?\s*(\([^)]*\)|[A-Za-z .\/]*)?\s*$/i.test(text.slice(Math.max(0, c.i - 60), c.i)));
  const verts = cs.filter((c) => !centres.includes(c));
  const pts = [];
  for (let i = 0; i < verts.length; i++) {
    pts.push(verts[i].p);
    if (i === verts.length - 1) break;
    const between = text.slice(verts[i].end, verts[i + 1].i);
    if (!/\barc\b/i.test(between)) continue;
    const ctr = centres.find((c) => c.i > verts[i].end && c.end <= verts[i + 1].i);
    const rm = between.match(/(\d+(?:\.\d+)?)\s*(NM|KM)\b/i);
    const dir = /anti-?\s?clockwise|counter/i.test(between) ? false : /clockwise/i.test(between) ? true : null;
    if (!ctr || !rm || dir === null) return { reason: 'arc without stated centre coordinates, radius or direction' };
    const rM = toM(+rm[1], rm[2]);
    const d0 = inverse(ctr.p[0], ctr.p[1], verts[i].p[0], verts[i].p[1]).s, d1 = inverse(ctr.p[0], ctr.p[1], verts[i + 1].p[0], verts[i + 1].p[1]).s;
    if (Math.abs(d0 - rM) / rM > 0.03 || Math.abs(d1 - rM) / rM > 0.03) return { reason: 'arc endpoints are not on the stated radius' };
    pts.push(...arcPoints(ctr.p, rM, verts[i].p, verts[i + 1].p, dir));
  }
  if (!pts.length || !/\barc\b/i.test(text)) return { reason: 'arc area not reconstructable' };
  return { ring: ring(pts), kind: 'arc-polygon' };
}

// ---- table parsing ----
const clean = (s) => s.replace(/<span class="sdParams"[^>]*>.*?<\/span>/gs, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim();
const ID_RE = /^(W[MBS][PRD]\s?\d+[A-Z]?(?:\/\d+)?)\b/;
const CLS = { P: 'prohibited', R: 'restricted', D: 'danger' };

function parseRows(html) {
  const rows = [], skipped = [];
  let section = null;
  for (const r of html.split(/<tr id=/).slice(1)) {
    const tds = r.split(/<\/td>/).slice(0, -1);
    const cells = tds.map(clean);
    if (cells[0] !== undefined) cells[0] = cells[0].replace(/^"[^"]*">\s*/, ''); // the split leaves the <tr id="..."> attribute at the start
    if (cells.length === 1) { if (/PROHIBITED AREAS/.test(cells[0])) section = 'P'; else if (/RESTRICTED AREAS/.test(cells[0])) section = 'R'; else if (/DANGER AREAS/.test(cells[0])) section = 'D'; continue; }
    if (cells.length < 3) continue;
    const m = cells[0].match(ID_RE);
    if (!m) { skipped.push(cells[0].slice(0, 60)); continue; }
    const id = m[1].replace(/\s/g, '');
    if (id[2] !== section) throw new Error(`${id}: designation letter does not match its table section (${section})`);
    const spanName = tds[0].match(/<span class="SD"[^>]*>([^<]*)<\/span><span class="sdParams"[^>]*>TAIRSPACE;TXT_NAME/);
    let rest = cells[0].slice(m[0].length).replace(/^\s*-\s*/, '');
    let name = spanName ? clean(spanName[1]) : '';
    if (!name) { // fallback: the leading run of capitalised words before the description starts
      const words = [], tokens = rest.split(' ');
      for (const t of tokens) { if (/^[A-Z][A-Z()\-.]+$/.test(t) && t.length > 1 && t !== 'BTN' && t !== 'LAT') words.push(t); else break; }
      name = words.join(' ');
    }
    if (!name) name = id;
    const vertical = cells[1], [up, ...lo] = vertical.split(/\s\/\s/);
    rows.push({
      id, cls: CLS[section], designation: section, name, text: rest, upper: up.trim(), lower: lo.join(' / ').trim(), vertical,
      restriction: cells[2], remarks: cells[3] ?? '',
    });
  }
  return { rows, skipped };
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function main() {
  if (process.argv.includes('--fetch') || !fs.existsSync(CACHE)) {
    const res = await fetch(URL_ENR51);
    if (!res.ok) throw new Error(`fetch ${URL_ENR51}: ${res.status}`);
    fs.writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
  }
  const buf = fs.readFileSync(CACHE), html = buf.toString('utf8');
  const { rows, skipped } = parseRows(html);
  const ids = rows.map((r) => r.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) throw new Error(`duplicate IDs in source: ${dup.join(', ')}`);

  const layers = { prohibited: [], restricted: [], danger: [] }, exceptions = [], checks = [];
  for (const r of rows) {
    const g = geometryOf(r.text);
    if (!g.ring) { exceptions.push({ id: r.id, class: r.designation, reason: g.reason }); continue; }
    const outer = ccw(g.ring);
    const fail = [];
    if (Math.abs(signedArea(outer)) < 1e-9) fail.push('zero area');
    if (selfIntersects(outer)) fail.push('self-intersecting ring');
    if (outer.some(([x, y]) => x < 95 || x > 120 || y < 0 || y > 10)) fail.push('vertex outside the Malaysian FIR window (lon/lat order?)');
    if (g.kind === 'circle') {
      const e = Math.max(...outer.map((p) => Math.abs(inverse(g.center[0], g.center[1], p[0], p[1]).s - g.radiusM) / g.radiusM));
      if (e > 0.005) fail.push(`circle radius error ${(e * 100).toFixed(2)}%`);
    }
    if (fail.length) { exceptions.push({ id: r.id, class: r.designation, reason: fail.join('; ') }); continue; }
    const description = [`Upper ${r.upper}`, `lower ${r.lower || 'n/a'}`].join(', ') + `. ${r.restriction ? r.restriction + '. ' : ''}${r.remarks}`.replace(/\.\s*\./g, '.');
    layers[r.cls].push({
      type: 'Feature',
      properties: { id: r.id, name: `${r.id}${r.name !== r.id ? ' ' + r.name : ''}`, class: r.designation, upper: r.upper, lower: r.lower, vertical: r.vertical, restriction: r.restriction, remarks: r.remarks, description: description.trim().slice(0, 500), geometryKind: g.kind },
      geometry: { type: 'Polygon', coordinates: [outer] },
    });
    checks.push({ id: r.id, kind: g.kind });
  }
  fs.mkdirSync(path.join(OUT, 'layers'), { recursive: true });
  for (const [k, features] of Object.entries(layers)) fs.writeFileSync(path.join(OUT, 'layers', `${k}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  const emitted = Object.values(layers).flat();
  const report = {
    source: { url: URL_ENR51, edition: EDITION, htmlSha256: sha(buf), htmlBytes: buf.length, extractedAt: new Date().toISOString() },
    applicable: rows.length, converted: emitted.length, unresolved: exceptions.length,
    counts: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, { applicable: rows.filter((r) => r.cls === k).length, converted: v.length }])),
    notAreas: skipped, exceptions,
  };
  fs.writeFileSync(path.join(OUT, 'exceptions.json'), JSON.stringify(report, null, 2) + '\n');
  const outHash = sha(Buffer.from(Object.values(layers).map((f) => JSON.stringify(f)).join('')));
  console.log(JSON.stringify({ applicable: report.applicable, converted: report.converted, unresolved: report.unresolved, counts: report.counts, layersSha256: outHash.slice(0, 16), notAreas: skipped }, null, 1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
export { geometryOf, parseRows, circleRing, direct, inverse };
