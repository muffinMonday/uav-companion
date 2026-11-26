// Community flying areas, Phase 1: the pure rules (no DOM, no Leaflet, no storage), so Node tests can use them.
// A community area is a user recommendation, never flight authorization, and nothing here is read by the point check (pointcheck.js).
// Coordinates are WGS-84 GeoJSON order [longitude, latitude]. A ring is closed (first position repeated last) and stored counter-clockwise.
//
// Limits are the owner-approved ones (COMMUNITY_FLYING_AREAS_PLAN.md sections 1, 3 and 13.5): 3 to 100 distinct vertices, at most 25 km2,
// name 1 to 80 characters, description up to 500, up to 10 Pilot setup spots, a spot note up to 120. The area is a spherical approximation
// (mean Earth radius); a server added in a later phase must use the same formula, or its limit would disagree with this one at the edge.

export const MIN_VERTICES = 3;
export const MAX_VERTICES = 100;
export const MAX_AREA_M2 = 25e6;
export const NAME_MAX = 80;
export const DESC_MAX = 500;
export const MAX_SPOTS = 10;
export const SPOT_NOTE_MAX = 120;
export const DECIMALS = 7;                 // about 1 cm; coordinates are rounded to this before they are checked or stored
const MIN_AREA_M2 = 1;                     // below this a ring is a line, not an area
const SAME = 1e-7;                         // degrees: two vertices closer than this are the same vertex
const EARTH_R = 6371008.8;                 // metres, mean radius

/** The fixed Pilot setup spot types (an explicit owner decision: no free-form types). */
export const SPOT_TYPES = ['shelter', 'seating', 'open', 'other'];
export const SPOT_LABELS = { shelter: 'Pavilion / shelter', seating: 'Seating / picnic area', open: 'Open setup space', other: 'Other setup spot' };
export const DRAW_KINDS = ['polygon', 'rectangle'];

const err = (code, message) => ({ code, message });
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;
const rad = (d) => (d * Math.PI) / 180;
const cps = (s) => Array.from(s).length;   // length in characters, so an emoji counts once

/** A position [lng, lat] with both numbers in range, rounded to DECIMALS; null when it is not one. Extra elements (altitude) are dropped. */
export function cleanPosition(p) {
  if (!Array.isArray(p) || p.length < 2 || !isNum(p[0]) || !isNum(p[1])) return null;
  if (p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90) return null;
  return [round(p[0]), round(p[1])];
}

const same = (a, b) => Math.abs(a[0] - b[0]) < SAME && Math.abs(a[1] - b[1]) < SAME;

/** Twice the signed area of the ring in degrees (positive = counter-clockwise); only the sign is used. `ring` open or closed. */
function signedTwice(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) { const a = v[i], b = v[(i + 1) % v.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s;
}

/** Geodesic (spherical) area in square metres of a polygon given as open or closed ring of [lng, lat]. Always positive. */
export function geodesicAreaM2(vertices) {
  const v = openRing(vertices);
  if (v.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    sum += rad(b[0] - a[0]) * (2 + Math.sin(rad(a[1])) + Math.sin(rad(b[1])));
  }
  return Math.abs(sum * EARTH_R * EARTH_R / 2);
}

/** The same ring without a repeated closing position. */
export function openRing(ring) {
  if (!Array.isArray(ring)) return [];
  return ring.length > 1 && same(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring.slice();
}

/** Closed, counter-clockwise ring for an open vertex list (GeoJSON right-hand rule). */
export function closeRing(vertices) {
  const v = vertices.map((p) => [p[0], p[1]]);
  if (signedTwice(v) < 0) v.reverse();
  return [...v, [v[0][0], v[0][1]]];
}

// ---- self-intersection (planar test in longitude/latitude: topology is the same as on the ground for areas this small) ----
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSeg = (a, b, p) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
/** True when closed segments a-b and c-d share any point (a touch or a collinear overlap counts). */
function segmentsMeet(a, b, c, d) {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSeg(a, b, c)) || (d2 === 0 && onSeg(a, b, d)) || (d3 === 0 && onSeg(c, d, a)) || (d4 === 0 && onSeg(c, d, b));
}

/** True when an open vertex list (>= 3, distinct) crosses or touches itself, or folds back along an edge. */
export function selfIntersects(v) {
  const n = v.length;
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % n];
    // the next edge shares b: it may only leave b in another direction (a spike that doubles back along this edge is degenerate)
    const c = v[(i + 2) % n];
    if (cross(a, b, c) === 0 && ((c[0] - b[0]) * (a[0] - b[0]) + (c[1] - b[1]) * (a[1] - b[1])) > 0) return true;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the first and last edges share v[0]
      if (segmentsMeet(a, b, v[j], v[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Validates an open list of [lng, lat] vertices (no repeated closing position). Never throws.
 * -> { ok, errors: [{ code, message }], vertices (cleaned, rounded), areaM2 }. Codes: not-array, vertex-count, bad-coordinate, duplicate-vertex,
 *    antimeridian, self-intersection, degenerate, too-large.
 */
export function validateVertices(input) {
  const errors = [];
  if (!Array.isArray(input)) return { ok: false, errors: [err('not-array', 'The shape is not a list of points.')], vertices: [], areaM2: 0 };
  if (input.length > MAX_VERTICES + 1) errors.push(err('vertex-count', `A flying area can have at most ${MAX_VERTICES} points.`)); // (a closed ring carries one repeat)
  const cleaned = [];
  for (const p of input.slice(0, MAX_VERTICES + 2)) {
    const c = cleanPosition(p);
    if (!c) { errors.push(err('bad-coordinate', 'A point has an invalid longitude or latitude.')); return { ok: false, errors, vertices: [], areaM2: 0 }; }
    cleaned.push(c);
  }
  const v = openRing(cleaned);
  if (v.length > MAX_VERTICES && !errors.some((e) => e.code === 'vertex-count')) errors.push(err('vertex-count', `A flying area can have at most ${MAX_VERTICES} points.`));
  if (v.length < MIN_VERTICES) errors.push(err('vertex-count', `A flying area needs at least ${MIN_VERTICES} points.`));
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (same(v[i], v[j])) { errors.push(err('duplicate-vertex', 'Two points are in the same place.')); i = v.length; break; }
  if (errors.length) return { ok: false, errors, vertices: v, areaM2: 0 };
  for (let i = 0; i < v.length; i++) if (Math.abs(v[(i + 1) % v.length][0] - v[i][0]) > 180) { errors.push(err('antimeridian', 'Areas that cross the 180° meridian are not supported.')); return { ok: false, errors, vertices: v, areaM2: 0 }; }
  const areaM2 = geodesicAreaM2(v);
  if (selfIntersects(v)) errors.push(err('self-intersection', 'The outline crosses or touches itself.'));
  else if (areaM2 < MIN_AREA_M2) errors.push(err('degenerate', 'The points are in a line: the shape has no area.'));
  else if (areaM2 > MAX_AREA_M2) errors.push(err('too-large', `The area is ${(areaM2 / 1e6).toFixed(1)} km²; the largest allowed is ${MAX_AREA_M2 / 1e6} km².`));
  return { ok: errors.length === 0, errors, vertices: v, areaM2 };
}

/** The four corners (south-west, south-east, north-east, north-west) of the axis-aligned rectangle with opposite corners a and b. */
export function rectangleFromCorners(a, b) {
  const w = Math.min(a[0], b[0]), e = Math.max(a[0], b[0]), s = Math.min(a[1], b[1]), n = Math.max(a[1], b[1]);
  return [[w, s], [e, s], [e, n], [w, n]];
}

/** Point in polygon, boundary included (a point on an edge or vertex is inside). `ring` open or closed; `p` = [lng, lat]. */
export function pointInPolygon(p, ring) {
  const v = openRing(ring);
  const n = v.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = v[i], b = v[j];
    if (cross(a, b, p) === 0 && onSeg(a, b, p)) return true; // on the boundary
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Text for a name (`multiline` false: one line) or a description. -> { ok, value, error }. */
export function cleanText(value, { max, required = false, multiline = false, label = 'Text' } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') return { ok: false, value: '', error: `${label} must be text.` };
  // eslint-disable-next-line no-control-regex
  let s = value.replace(/\r\n?/g, '\n').replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]+/g, multiline ? '' : ' ');
  s = multiline ? s.trim() : s.replace(/\s+/g, ' ').trim();
  if (required && !s) return { ok: false, value: s, error: `${label} is required.` };
  if (cps(s) > max) return { ok: false, value: s, error: `${label} can be at most ${max} characters.` };
  return { ok: true, value: s, error: null };
}

/** Validates the setup spots of an area whose ring is `ring`. -> { ok, errors: [{ code, message, index? }], spots (cleaned) }. */
export function validateSpots(input, ring) {
  const errors = [], spots = [];
  if (input === undefined || input === null) return { ok: true, errors, spots };
  if (!Array.isArray(input)) return { ok: false, errors: [err('spots-not-array', 'Setup spots must be a list.')], spots };
  if (input.length > MAX_SPOTS) errors.push(err('too-many-spots', `An area can have at most ${MAX_SPOTS} setup spots.`));
  input.slice(0, MAX_SPOTS + 1).forEach((s, index) => {
    if (!s || typeof s !== 'object') { errors.push({ ...err('bad-spot', 'A setup spot is not valid.'), index }); return; }
    const c = cleanPosition(s.coordinates);
    if (!c) { errors.push({ ...err('bad-coordinate', 'A setup spot has an invalid position.'), index }); return; }
    if (!SPOT_TYPES.includes(s.type)) { errors.push({ ...err('bad-spot-type', 'A setup spot has an unknown type.'), index }); return; }
    const note = cleanText(s.note, { max: SPOT_NOTE_MAX, multiline: false, label: 'The setup spot note' });
    if (!note.ok) { errors.push({ ...err('bad-note', note.error), index }); return; }
    if (ring && !pointInPolygon(c, ring)) errors.push({ ...err('spot-outside', 'A setup spot is outside the area.'), index });
    const out = { type: s.type, note: note.value, coordinates: c };
    if (typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s.id)) out.id = s.id;
    spots.push(out);
  });
  return { ok: errors.length === 0, errors, spots };
}

/**
 * Validates and normalises a whole area record (what is stored and exported). Never throws.
 * Input: { id?, name, description?, drawKind?, geometry: { type: 'Polygon', coordinates: [ring] }, spots?, created?, updated? }.
 * -> { ok, errors, area } where area is the cleaned record (its ring closed and counter-clockwise) only when ok.
 */
export function validateArea(rec) {
  const errors = [];
  if (!rec || typeof rec !== 'object') return { ok: false, errors: [err('not-object', 'The area is not valid.')], area: null };
  const name = cleanText(rec.name, { max: NAME_MAX, required: true, label: 'The name' });
  if (!name.ok) errors.push(err('name', name.error));
  const desc = cleanText(rec.description, { max: DESC_MAX, multiline: true, label: 'The description' });
  if (!desc.ok) errors.push(err('description', desc.error));
  const g = rec.geometry;
  let ring = null, areaM2 = 0;
  if (!g || g.type !== 'Polygon' || !Array.isArray(g.coordinates) || !Array.isArray(g.coordinates[0])) errors.push(err('geometry', 'The shape must be one polygon.'));
  else if (g.coordinates.length !== 1) errors.push(err('holes', 'Polygons with holes are not supported.'));
  else {
    const v = validateVertices(g.coordinates[0]);
    errors.push(...v.errors); areaM2 = v.areaM2;
    if (v.ok) ring = closeRing(v.vertices);
  }
  const spots = validateSpots(rec.spots, ring);
  errors.push(...spots.errors);
  if (errors.length) return { ok: false, errors, area: null };
  const drawKind = DRAW_KINDS.includes(rec.drawKind) ? rec.drawKind : 'polygon';
  const area = { id: typeof rec.id === 'string' ? rec.id : '', name: name.value, description: desc.value, drawKind, geometry: { type: 'Polygon', coordinates: [ring] }, spots: spots.spots, areaM2: Math.round(areaM2), created: rec.created, updated: rec.updated };
  return { ok: true, errors, area };
}

/** Bounding box [west, south, east, north] of a ring. */
export function bboxOf(ring) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

/** "1.23 km²" or "4,500 m²". */
export function formatArea(m2) {
  return m2 >= 1e6 ? `${(m2 / 1e6).toFixed(m2 >= 1e7 ? 1 : 2)} km²` : `${Math.round(m2).toLocaleString('en')} m²`;
}
