// Malaysia CAAM eAIP ENR 5.1 (Prohibited, Restricted, Danger areas) -> data/regions/my/my-enr51/layers/*.geojson.
// Usage: node scripts/airspace/my-enr51.mjs [--fetch] [--html <file>] [--edition 2026-11-03]
// Verified geometry is what the published text defines deterministically: coordinate polygons, circles (geodesic), lat/long boxes and arcs with a stated
// centre and radius. An arc whose direction is not stated is read as the shorter arc, and that reading is emitted only for areas listed in ARC_VERIFIED, i.e.
// checked against the official CAAM chart; any other such area is unresolved. Everything else is listed in exceptions.json with a one-line reason.
// Areas that need a coastline or border are not verified geometry: scripts/airspace/my-enr51-approx.mjs builds them as a separate, flagged approximate layer.
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

// ---- named references defined elsewhere in the CAAM AIP (references.json, written by --fetch-refs from ENR 4.1, ENR 4.4 and AD 2 WBKL) ----
const REFS_FILE = path.join(OUT, 'references.json');
const REFS_DOC = fs.existsSync(REFS_FILE) ? JSON.parse(fs.readFileSync(REFS_FILE, 'utf8')) : {};
let REFS = REFS_DOC.points ?? {};
const BOUNDS = REFS_DOC.boundaries ?? {}; // CTR/TMA/FIR boundaries that ENR 5.1 refers to, transcribed from AD 2 / ENR 2.1 (quoted text kept alongside)
const fmtCoord = ([lon, lat]) => {
  const f = (v, w, h) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), sec = ((a - d) * 60 - m) * 60; return String(d).padStart(w, '0') + String(m).padStart(2, '0') + sec.toFixed(2).padStart(5, '0') + h; };
  return f(lat, 2, lat < 0 ? 'S' : 'N') + ' ' + f(lon, 3, lon < 0 ? 'W' : 'E');
};
// [code, pattern, isArcCentre]; an arc centre becomes "centred on <coordinates>" so the arc reader sees a stated centre
const REF_PATTERNS = [
  ['VKB', /(?:(?:centred|centered)\s*(?:on|at|from)?\s*|from\s+)?\bVKB\s+(?:DVOR\/DME|VOR\/DME|VOR)\b/gi, true],
  ['VKG', /(?:(?:centred|centered)\s*(?:on|at|from)?\s*)?\bVKG\s+DVOR\/DME\b/gi, true],
  ['VLB', /(?:(?:centred|centered)\s*(?:on|at|from)?\s*)?\bLABUAN\s+DVOR\/DME\b/gi, true],
  ['LABUAN-ARP', /(?:(?:centred|centered)\s*(?:on|at|from)?\s*)?\bLabuan\s+ARP\b/gi, true],
  ['ADLEX', /\bADLEX\b/g, false],
];
const P1 = (s) => coords(s)[0].p;
/** Vertex list (implicitly closed unless def.open) of a boundary transcribed from the AIP: start, line and arc steps; arc endpoints must lie within 3% of the stated radius. */
function boundaryRing(def) {
  const pts = []; let cur;
  for (const op of def.path) {
    if (op.start) { cur = P1(op.start); pts.push(cur); }
    else if (op.line) { cur = P1(op.line); pts.push(cur); }
    else if (op.circle) pts.push(...circleRing(P1(op.circle.c), op.circle.rNM * 1852, 720).slice(0, -1));
    else if (op.arc) {
      const c = P1(op.arc.c), to = P1(op.arc.to), rM = op.arc.rNM * 1852;
      for (const e of [cur, to]) if (Math.abs(inverse(c[0], c[1], e[0], e[1]).s - rM) / rM > 0.03) throw new Error('boundary arc endpoint off radius: ' + def.source);
      pts.push(...arcPoints(c, rM, cur, to, op.arc.cw, 0.5), to); cur = to;
    }
  }
  return pts;
}
const pathLen = (pts) => pts.reduce((s, p, i) => (i ? s + inverse(pts[i - 1][0], pts[i - 1][1], p[0], p[1]).s : s), 0);
/** Intermediate vertices of the boundary between published points A and B (both within tolM of it). A closed boundary takes the clearly shorter way round; null if not decidable. */
function alongBoundary(def, A, B, tolM) {
  const r = boundaryRing(def), n = r.length, segs = def.open ? n - 1 : n, k = Math.cos(rad(A[1]));
  const proj = (p) => {
    let best = null;
    for (let i = 0; i < segs; i++) {
      const a = r[i], b = r[(i + 1) % n], ax = a[0] * k, dx = b[0] * k - ax, dy = b[1] - a[1], l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((p[0] * k - ax) * dx + (p[1] - a[1]) * dy) / l)) : 0, q = [a[0] + t * (b[0] - a[0]), a[1] + t * dy], d = inverse(p[0], p[1], q[0], q[1]).s;
      if (!best || d < best.d - 1e-6) best = { d, s: i + t };
    }
    return best;
  };
  const pa = proj(A), pb = proj(B);
  if (pa.d > tolM || pb.d > tolM) return null;
  const fwd = [], back = [];
  if (def.open) { // single polyline: vertices strictly between the two positions, in travel order
    const lo = Math.min(pa.s, pb.s), hi = Math.max(pa.s, pb.s), mid = [];
    for (let m = Math.floor(lo) + 1; m < hi; m++) mid.push(r[m]);
    return pa.s <= pb.s ? mid : mid.reverse();
  }
  const df = (pb.s - pa.s + n) % n, db = (pa.s - pb.s + n) % n;
  for (let m = Math.floor(pa.s) + 1; m - pa.s < df; m++) fwd.push(r[m % n]);
  for (let m = Math.ceil(pa.s) - 1; pa.s - m < db; m--) back.push(r[((m % n) + n) % n]);
  const lf = pathLen([A, ...fwd, B]), lb = pathLen([A, ...back, B]);
  if (Math.min(lf, lb) / Math.max(lf, lb) > 0.8) return null;
  return lf < lb ? fwd : back;
}
const BOUNDARY_PATTERNS = [
  ['KUANTAN CTR', /(?:thence\s+)?(?:along|following)\s+(?:the\s+)?KUANTAN\s+CONTROL\s*(?:Boundary|Bdry)?/gi, 2000],
  ['KUALA TERENGGANU CTR', /(?:thence\s+)?(?:along|following)\s+(?:the\s+)?KUALA\s+TERENGGANU\s+CTR\s*(?:Boundary|Bdry)?/gi, 2000],
  ['BUTTERWORTH TMA', /(?:thence\s+)?(?:along|following)\s+(?:the\s+)?Butterworth\s+TMA\s*(?:Boundary|Bdry)?/gi, 2000],
  ['KK FIR WEST', /(?:thence\s+)?(?:along|following)\s+(?:the\s+)?Singapore\s*\/\s*Kota\s+Kinabalu\s+FIR\s*(?:Boundary|Bdry)?/gi, 5000],
];
/** "along <named boundary>" between two published vertices becomes the boundary's own vertices, taken from references.json. */
function resolveBoundaries(text, defs = BOUNDS) {
  for (const [name, re, tol] of BOUNDARY_PATTERNS) {
    if (!defs[name]) continue;
    const orig = text;
    text = orig.replace(re, (m, off) => {
      const cs = coords(orig), A = cs.filter((c) => c.end <= off).at(-1), B = cs.find((c) => c.i >= off + m.length);
      const mid = A && B ? alongBoundary(defs[name], A.p, B.p, tol) : null;
      return mid ? ' ' + mid.map(fmtCoord).join(' ') + ' ' : m;
    });
  }
  return text;
}

/** Polygon minus a simple polygon (single result piece); null when not supported. a is closed, b open. */
function subtractPolygon(a, b) {
  const A = a.slice(0, -1), B = b, nA = A.length, nB = B.length;
  const cross = (p, q, r, s) => { const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (!d) return null; const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return t > 0 && t < 1 && u > 0 && u < 1 ? [t, u] : null; };
  const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1]) && pt[0] < ((poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };
  const ea = A.map(() => []), eb = B.map(() => []); let id = 0;
  for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
    const x = cross(A[i], A[(i + 1) % nA], B[j], B[(j + 1) % nB]); if (!x) continue;
    const pt = [A[i][0] + x[0] * (A[(i + 1) % nA][0] - A[i][0]), A[i][1] + x[0] * (A[(i + 1) % nA][1] - A[i][1])];
    ea[i].push({ t: x[0], id, pt }); eb[j].push({ t: x[1], id, pt }); id++;
  }
  if (!id) return null;
  const build = (V, E) => V.flatMap((v, i) => [{ pt: v, x: -1 }, ...E[i].sort((p, q) => p.t - q.t).map((e) => ({ pt: e.pt, x: e.id }))]);
  const RA = build(A, ea), RB = build(B, eb), mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const idxA = (x) => RA.findIndex((n) => n.x === x), idxB = (x) => RB.findIndex((n) => n.x === x);
  const outsideNext = (k) => !inPoly(mid(RA[k].pt, RA[(k + 1) % RA.length].pt), B); // the A segment after node k lies outside B
  const out = [], used = new Set(); let guard = 0;
  for (let s = 0; s < RA.length; s++) {
    if (RA[s].x < 0 || used.has(RA[s].x) || !outsideNext(s)) continue;
    const piece = []; let k = s;
    do {
      used.add(RA[k].x); piece.push(RA[k].pt);
      k = (k + 1) % RA.length; // walk A outside B until it enters B at the next crossing
      while (RA[k].x < 0) { piece.push(RA[k].pt); k = (k + 1) % RA.length; }
      const j0 = idxB(RA[k].x); // follow B's boundary on the side that stays inside A, to its next crossing
      const step = inPoly(mid(RB[j0].pt, RB[(j0 + 1) % RB.length].pt), A) ? 1 : -1;
      let j = j0; piece.push(RA[k].pt);
      do { j = (j + step + RB.length) % RB.length; piece.push(RB[j].pt); } while (RB[j].x < 0 && ++guard < 100000);
      k = idxA(RB[j].x); used.add(RA[k].x);
    } while (k !== s && ++guard < 100000);
    out.push(ring(piece));
  }
  return out.length === 1 ? out[0] : null;
}

function resolveRefs(text, refs = REFS) {
  let t = text.replace(/\((?:RDL|bearing)[^)]*\)/gi, '');
  for (const [code, re, centre] of REF_PATTERNS) if (refs[code]) t = t.replace(re, () => (centre ? 'centred on ' : '') + fmtCoord(refs[code]) + ' ');
  return t;
}

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

/** Fallback for a ring that self-intersects as published: a trailing vertex within 300 m of the first (but not equal to it) restates the start
 *  with a typo, so the ring closes at the first vertex. Used only when that removes the self-intersection; valid rings are never touched. */
function dropNearStart(pts) {
  if (pts.length < 5 || !selfIntersects(ring(pts))) return pts;
  const d = inverse(pts[0][0], pts[0][1], pts.at(-1)[0], pts.at(-1)[1]).s, cut = pts.slice(0, -1);
  return d > 0 && d < 300 && !selfIntersects(ring(cut)) ? cut : pts;
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
function geometryOf(rawText, refs = REFS) {
  let exclude = null;
  const text = resolveBoundaries(resolveRefs(rawText, refs)).replace(/\(\s*Excluding\s+KERTEH\s+CTR\s*\)/i, () => { if (BOUNDS['KERTEH CTR']) exclude = boundaryRing(BOUNDS['KERTEH CTR']); return ''; });
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
  const pts = dropNearStart(cs.map((c) => c.p)), closed = pts.length > 3 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1];
  const distinct = closed ? pts.length - 1 : pts.length;
  if (!closed && distinct < 4 && !/\b(bounded|bounding|within|contained)\b|\bto start\b/i.test(text)) return { reason: 'open path of three points (shape not defined)' };
  return { ring: ring(pts), kind: 'polygon', ...(exclude ? { exclude } : {}), ...(pts.length !== cs.length ? { note: 'last vertex restated the start within 300 m; the ring closes at the first vertex' } : {}) };
}

/** A polygon with arcs: each arc needs a stated centre, radius, direction and endpoint coordinates; otherwise the area is unresolved. */
function arcPolygon(text, cs) {
  if (BAD_POLY.test(text.replace(/\b(arc|arcs|radius|circle|circles|centred|centered|along|dme|vor)\b/gi, ''))) return { reason: 'arc area with a coastline, border or airspace-boundary reference' };
  if (/\b(dme|vor)\b/i.test(text.replace(/\([^)]*\)/g, '')) && !/centred|centered/i.test(text)) return { reason: 'arc centred on a navaid with no stated coordinates' };
  const centres = cs.filter((c) => /(centred|centered)\s*(on|at|from)?\s*(\([^)]*\)|[A-Za-z .\/]*)?\s*\(?$/i.test(text.slice(Math.max(0, c.i - 60), c.i)));
  const verts = cs.filter((c) => !centres.includes(c));
  const pts = []; let inferred = false;
  for (let i = 0; i < verts.length; i++) {
    pts.push(verts[i].p);
    if (i === verts.length - 1) break;
    const between = text.slice(verts[i].end, verts[i + 1].i);
    if (!/\barc\b/i.test(between)) continue;
    const ctr = centres.find((c) => c.i > verts[i].end && c.end <= verts[i + 1].i);
    const rm = between.match(/(\d+(?:\.\d+)?)\s*(NM|KM)\b/i);
    let dir = /anti-?\s?clockwise|counter/i.test(between) ? false : /clockwise/i.test(between) ? true : null;
    if (!ctr || !rm) return { reason: 'arc without stated centre coordinates, radius or direction' };
    const rM = toM(+rm[1], rm[2]);
    if (dir === null) { // direction not published: take the shorter arc, only when it is clearly shorter (<= 170 degrees)
      const sw = (inverse(ctr.p[0], ctr.p[1], verts[i + 1].p[0], verts[i + 1].p[1]).az - inverse(ctr.p[0], ctr.p[1], verts[i].p[0], verts[i].p[1]).az + 360) % 360;
      if (sw > 170 && sw < 190) return { reason: 'arc direction not stated and the sweep is about 180 degrees' };
      dir = sw <= 170; inferred = true;
    }
    const d0 = inverse(ctr.p[0], ctr.p[1], verts[i].p[0], verts[i].p[1]).s, d1 = inverse(ctr.p[0], ctr.p[1], verts[i + 1].p[0], verts[i + 1].p[1]).s;
    if (Math.abs(d0 - rM) / rM > 0.03 || Math.abs(d1 - rM) / rM > 0.03) return { reason: 'arc endpoints are not on the stated radius' };
    pts.push(...arcPoints(ctr.p, rM, verts[i].p, verts[i + 1].p, dir));
  }
  if (!pts.length || !/\barc\b/i.test(text)) return { reason: 'arc area not reconstructable' };
  return { ring: ring(pts), kind: 'arc-polygon', ...(inferred ? { inferredArc: true, note: 'arc direction not published: the shorter arc (<= 170 degrees) was taken' } : {}) };
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

// Curated classification of the areas still unresolved after the CAAM-only recovery passes (checked against the published text, 2026-11-24).
// external-reference: the description needs a coastline or the Malaysia/Thailand border (or a road/railway/canal) that CAAM does not publish as coordinates.
// ambiguous: the CAAM text itself is inconsistent or incomplete.
const UNRESOLVED_NOTES = {
  WMP228: ['external-reference', 'southern border coincides with the coastline of South Johor'],
  WMR239A: ['external-reference', 'boundary follows the coastline'], WMR239B: ['external-reference', 'boundary follows the coastline'],
  WMR240A: ['external-reference', 'boundary follows the coastline'], WMR240B: ['external-reference', 'boundary follows the coastline'],
  WMR403: ['external-reference', 'coastline plus the Alor Star and Butterworth control-zone boundaries, which CAAM does not publish as coordinates here (not reconstructed)'],
  WMR404: ['external-reference', 'railway line, a canal, a runway-centred arc and the coastline between published points (not reconstructed: no defensible conservative shape)'],
  WMR405: ['external-reference', 'the permanent border danger area, whose boundary is not defined in ENR 5.1 (not reconstructed)'], WMR406: ['external-reference', 'the permanent border danger area (not defined in ENR 5.1) and the Butterworth TMA boundary (not reconstructed)'],
  WMR407: ['external-reference', 'Malaysia/Thailand border between published points (approximate layer)'], WMR408: ['external-reference', 'two public roads, the Butterworth/Alor Star boundaries and the border danger area (not reconstructed)'],
  WMR416A: ['external-reference', 'coastline'], WMR416B: ['external-reference', 'coastline'], WMR416C: ['external-reference', 'coastline'],
  WMR419: ['external-reference', 'coastline and the western boundary of WMR416C (itself coastline-bounded)'],
  WBR524: ['external-reference', 'coastline joining two published points'], WBR525: ['external-reference', 'coastline joining two published points; the closing line at 055400N 1163200E does not meet the 20 NM arc end at 1162159E (not reconstructed)'],
  WMD419: ['external-reference', 'Malaysia/Thailand border'],
  WMR225: ['ambiguous', 'the straight-line coordinates contradict the arc endpoints (020200N 1031224E vs 1032224E; 020730N 1032224E vs 1032154E) and the 6 NM arc endpoint is not on 6 NM'],
  WMR226: ['ambiguous', 'two arcs with no stated connecting lines or closure'],
  WBR523: ['ambiguous', 'the 40 NM arc starts at 055400N 1152200E, 37.9 NM from the stated centre; closing lines not fully stated'],
  WMD421: ['ambiguous', 'three points with no closing statement or shape'],
};

// Arc direction not published (shorter arc taken): each area below was overlaid on the official CAAM chart (the AIP's "Prohibited, Restricted and Danger Areas" charts,
// vector PDFs georeferenced from the chart's graticule ticks; checked 2026-11-24) and the shorter arc matches the depicted hatched area.
const CHART_KL = 'CAAM AIP ENR 6 chart "Prohibited, Restricted and Danger Areas - Kuala Lumpur" (ENR 6-7, AMDT 03/2024; graphics/265779.pdf)';
const CHART_SS = 'CAAM AIP ENR 6 chart "Prohibited, Restricted and Danger Areas - Sabah/Sarawak" (ENR 6-9, AMDT 03/25; graphics/288679.pdf)';
const ARC_VERIFIED = Object.fromEntries([
  ...['WMR105', 'WMR106', 'WMR107', 'WMR108', 'WMR225A', 'WMR225B'].map((id) => [id, CHART_KL]),
  ...['WBR508', 'WBR509', 'WBR510', 'WBR511', 'WBR518', 'WBR519', 'WBR520'].map((id) => [id, CHART_SS]),
]);

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Point coordinates the ENR 5.1 text refers to by name, read from the official pages (ENR 4.1 navaids, ENR 4.4 waypoints, AD 2 WBKL ARP). */
async function fetchRefs() {
  const base = URL_ENR51.replace(/[^/]+$/, '');
  const text = async (f) => { const res = await fetch(base + f); if (!res.ok) throw new Error('fetch ' + f + ': ' + res.status); return (await res.text()).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '); };
  const after = (t, marker) => { const i = t.indexOf(marker); if (i < 0) throw new Error('reference not found: ' + marker); const c = coords(t.slice(i, i + 400).replace(/\bT[A-Z_]+;[^\s;]+;\d+/g, ' '))[0]; if (!c) throw new Error('no coordinates after ' + marker); return c.p; };
  const [e41, e44, wbkl] = await Promise.all([text('WM-ENR-4.1-en-MS.html'), text('WM-ENR-4.4-en-MS.html'), text('WM-AD-2.WBKL-en-MS.html')]);
  const points = {
    VKB: after(e41, ' VKB TVOR;CODE_ID'), VKG: after(e41, ' VKG TVOR;CODE_ID'), VLB: after(e41, ' VLB TVOR;CODE_ID'),
    ADLEX: after(e44, 'ADLEX TDESIGNATED_POINT;CODE_ID'), 'LABUAN-ARP': after(wbkl, 'ARP coordinates and site at AD'),
  };
  const sources = { VKB: 'ENR 4.1 Kota Bharu DVOR/DME', VKG: 'ENR 4.1 Kuching DVOR/DME', VLB: 'ENR 4.1 Labuan DVOR/DME', ADLEX: 'ENR 4.4 designated point ADLEX', 'LABUAN-ARP': 'AD 2 WBKL 2.2 ARP coordinates' };
  fs.writeFileSync(REFS_FILE, JSON.stringify({ edition: EDITION, note: 'Named points that ENR 5.1 area descriptions use as arc centres or vertices; official CAAM AIP coordinates.', sources, points, boundaries: BOUNDS }, null, 1) + '\n');
  REFS = points; return points;
}

/** Administering state, from the published ENR 5.1 text. Returns { state, evidence }. */
const BRUNEI_BY_LOCATION = { WBD508: 'Brunei Temburong district', WBD514: 'Brunei Temburong district', WBD515: 'Brunei Tutong/Belait districts' };
function administration(r) {
  const t = r.text + ' ' + r.restriction + ' ' + r.remarks + ' ' + r.name;
  if (/\bDCA Brunei\b/i.test(t)) return { state: 'BN', evidence: 'Controlling Authority: DCA Brunei' };
  if (/\bBrunei Shell Petroleum\b/i.test(t)) return { state: 'BN', evidence: 'Controlling Authority: Brunei Shell Petroleum Co Sdn. Bhd.' };
  if (/\bHM Sultan['’]s Flight\b/i.test(t)) return { state: 'BN', evidence: "Controlling Authority: HM Sultan's Flight (Brunei), Sultan's Palace" };
  const place = t.match(/\b(JERUDONG|BERAKAS|TUTONG|BINTURAN|BUKIT AGOK|LUMUT RANGE)\b/);
  if (/^WB/.test(r.id) && place) return { state: 'BN', evidence: 'named Brunei site: ' + place[1] };
  if (BRUNEI_BY_LOCATION[r.id]) return { state: 'BN', evidence: 'published coordinates lie in ' + BRUNEI_BY_LOCATION[r.id] };
  if (/^WS/.test(r.id)) return { state: 'SG', evidence: 'WS-series Singapore designator' + (/Singapore ATCC|TENGAH/i.test(t) ? '; Tengah Approach / Singapore ATCC' : '') };
  return { state: 'MY', evidence: '' };
}

async function main() {
  if (process.argv.includes('--fetch-refs')) await fetchRefs();
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

  const layers = { prohibited: [], restricted: [], danger: [] }, exceptions = [], checks = [], excluded = [];
  const parsed = rows.length;
  for (const r of rows) {
    const adm = administration(r);
    if (adm.state !== 'MY') { excluded.push({ id: r.id, class: r.designation, administeredBy: adm.state === 'SG' ? 'Singapore' : 'Brunei', evidence: adm.evidence }); continue; }
    const g = geometryOf(r.name && r.text.startsWith(r.name) ? r.text.slice(r.name.length) : r.text);
    if (g.exclude && g.ring) {
      const cut = subtractPolygon(g.ring, g.exclude);
      if (cut) { g.ring = cut; g.note = 'the published Kerteh CTR is subtracted (ENR 5.1 "excluding KERTEH CTR"; CTR from AD 2 WMKE 2.17)'; } else { g.ring = null; g.reason = 'excluded CTR could not be subtracted'; }
    }
    if (g.ring && g.inferredArc && !ARC_VERIFIED[r.id]) { g.ring = null; g.reason = 'arc direction not published and not verified against an official CAAM chart'; }
    if (!g.ring) { const [category, detail] = UNRESOLVED_NOTES[r.id] ?? ['unclassified', '']; exceptions.push({ id: r.id, class: r.designation, category, reason: detail ? g.reason + ' [' + detail + ']' : g.reason }); continue; }
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
      properties: { id: r.id, name: `${r.id}${r.name !== r.id ? ' ' + r.name : ''}`, class: r.designation, upper: r.upper, lower: r.lower, vertical: r.vertical, restriction: r.restriction, remarks: r.remarks, description: description.trim().slice(0, 500), geometryKind: g.kind, ...(g.note ? { geometryNote: g.note } : {}), ...(g.inferredArc ? { arcVerifiedAgainst: ARC_VERIFIED[r.id] } : {}) },
      geometry: { type: 'Polygon', coordinates: [outer] },
    });
    checks.push({ id: r.id, kind: g.kind });
  }
  fs.mkdirSync(path.join(OUT, 'layers'), { recursive: true });
  for (const [k, features] of Object.entries(layers)) fs.writeFileSync(path.join(OUT, 'layers', `${k}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  const emitted = Object.values(layers).flat();
  const malaysian = rows.filter((r) => !excluded.some((e) => e.id === r.id));
  const report = {
    source: { url: URL_ENR51, edition: EDITION, htmlSha256: sha(buf), htmlBytes: buf.length, extractedAt: new Date().toISOString() },
    parsed, excludedSingapore: excluded.filter((e) => e.administeredBy === 'Singapore').length, excludedBrunei: excluded.filter((e) => e.administeredBy === 'Brunei').length,
    applicable: malaysian.length, converted: emitted.length, unresolved: exceptions.length,
    counts: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, { applicable: malaysian.filter((r) => r.cls === k).length, converted: v.length }])),
    notAreas: skipped, excluded, exceptions,
  };
  fs.writeFileSync(path.join(OUT, 'exceptions.json'), JSON.stringify(report, null, 2) + '\n');
  const outHash = sha(Buffer.from(Object.values(layers).map((f) => JSON.stringify(f)).join('')));
  console.log(JSON.stringify({ parsed, excludedSingapore: report.excludedSingapore, excludedBrunei: report.excludedBrunei, applicable: report.applicable, converted: report.converted, unresolved: report.unresolved, counts: report.counts, layersSha256: outHash.slice(0, 16), notAreas: skipped }, null, 1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
export { subtractPolygon, boundaryRing, administration, resolveRefs, geometryOf, parseRows, circleRing, direct, inverse, coords, arcPoints, ring, ccw, signedArea, selfIntersects, ARC_VERIFIED, REFS_DOC, EDITION, CACHE };
