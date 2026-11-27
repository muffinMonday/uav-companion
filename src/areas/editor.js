// Community flying areas, Phase 1: the drawing session as plain state (no DOM, no Leaflet), so the rules for polygons, rectangles, vertex editing,
// undo and cancel are tested in Node. draw.js only turns map events into calls on this and paints what it reports.
// Positions are [lng, lat]. A polygon is built point by point and finished by hand; a rectangle is two opposite corners and is complete at once.
import { validateVertices, validateSpots, rectangleFromCorners, pointInPolygon, openRing, cleanPosition, MAX_VERTICES, MAX_SPOTS, SPOT_TYPES } from './core.js';

const SAME = 1e-7;
const sameAt = (a, b) => Math.abs(a[0] - b[0]) < SAME && Math.abs(a[1] - b[1]) < SAME;
const snap = (s) => ({ vertices: s.vertices.map((p) => [...p]), spots: s.spots.map((x) => ({ ...x, coordinates: [...x.coordinates] })), closed: s.closed });
let counter = 0;
const spotId = () => 's' + Date.now().toString(36) + (counter++).toString(36);

/**
 * @param {object} o
 * @param {'polygon'|'rectangle'} o.kind
 * @param {object} [o.area] an existing area to edit (its geometry, spots, name and description are the starting point)
 */
export function createEditor({ kind = 'polygon', area = null } = {}) {
  const st = {
    kind: area ? area.drawKind : kind,
    vertices: area ? openRing(area.geometry.coordinates[0]).map((p) => [...p]) : [],
    spots: area ? area.spots.map((s) => ({ ...s, id: s.id ?? spotId(), coordinates: [...s.coordinates] })) : [],
    closed: !!area,           // the outline is complete (rectangle: both corners placed; polygon: Finish pressed)
    name: area?.name ?? '', description: area?.description ?? '',
    attributes: area?.attributes ? JSON.parse(JSON.stringify(area.attributes)) : {},
  };
  let history = [];           // snapshots before each change, for undo
  const snapshot = () => JSON.stringify([st.vertices, st.spots, st.name, st.description, st.attributes]);
  let baseline = snapshot();

  const push = () => { history.push(snap(st)); if (history.length > 200) history.shift(); };
  const result = (ok, message = null) => ({ ok, message });

  const api = {
    get kind() { return st.kind; },
    get closed() { return st.closed; },
    get vertices() { return st.vertices.map((p) => [...p]); },
    get spots() { return st.spots.map((s) => ({ ...s, coordinates: [...s.coordinates] })); },
    get name() { return st.name; }, get description() { return st.description; },
    get attributes() { return JSON.parse(JSON.stringify(st.attributes)); },
    /** Replaces the site details (a plain object; validated when saved). */
    setAttributes(a) { st.attributes = a && typeof a === 'object' ? JSON.parse(JSON.stringify(a)) : {}; },
    setText({ name, description }) { if (name !== undefined) st.name = name; if (description !== undefined) st.description = description; },
    /** Unsaved changes since the session started (or since the last markSaved). */
    get dirty() { return snapshot() !== baseline; },
    markSaved() { baseline = snapshot(); },
    get canUndo() { return history.length > 0; },

    /** A tap or click at `p` while the outline is being drawn. Rectangle: the first tap is one corner, the second the opposite one. */
    addVertex(p) {
      const c = cleanPosition(p);
      if (!c) return result(false, 'That is not a valid position.');
      if (st.closed) return result(false, 'The outline is finished: drag a point to change it.');
      if (st.kind === 'rectangle') {
        if (st.vertices.length === 0) { push(); st.vertices = [c]; return result(true); }
        const a = st.vertices[0];
        if (a[0] === c[0] || a[1] === c[1]) return result(false, 'Pick a corner that is not in line with the first one.');
        push(); st.vertices = rectangleFromCorners(a, c); st.closed = true;
        return result(true);
      }
      if (st.vertices.length >= MAX_VERTICES) return result(false, `A flying area can have at most ${MAX_VERTICES} points.`);
      if (st.vertices.some((v) => sameAt(v, c))) return result(false, 'There is already a point there.');
      push(); st.vertices.push(c);
      return result(true);
    },
    /** Polygon: ends drawing when the outline is valid. Rectangle: already complete. */
    finish() {
      if (st.closed) return result(true);
      if (st.kind === 'rectangle') return result(false, 'Pick the second corner.');
      const v = validateVertices(st.vertices);
      if (!v.ok) return result(false, v.errors[0].message);
      push(); st.closed = true;
      return result(true);
    },
    /** Moves vertex `i`. In a rectangle the opposite corner stays and the shape stays a rectangle. */
    moveVertex(i, p) {
      const c = cleanPosition(p);
      if (!c || i < 0 || i >= st.vertices.length) return result(false, 'That point cannot be moved there.');
      if (st.kind === 'rectangle' && st.closed) {
        const opp = st.vertices[(i + 2) % 4];
        if (opp[0] === c[0] || opp[1] === c[1]) return result(false, 'A rectangle needs width and height.');
        push(); st.vertices = rectangleFromCorners(opp, c);
        return result(true);
      }
      if (st.vertices.some((v, j) => j !== i && sameAt(v, c))) return result(false, 'There is already a point there.');
      push(); st.vertices[i] = c;
      return result(true);
    },
    /** Inserts a point after vertex `i` (the midpoint handle). Polygons only. */
    insertVertex(i, p) {
      const c = cleanPosition(p);
      if (st.kind === 'rectangle') return result(false, 'A rectangle has four corners.');
      if (!c || i < 0 || i >= st.vertices.length) return result(false, 'That point cannot be added there.');
      if (st.vertices.length >= MAX_VERTICES) return result(false, `A flying area can have at most ${MAX_VERTICES} points.`);
      if (st.vertices.some((v) => sameAt(v, c))) return result(false, 'There is already a point there.');
      push(); st.vertices.splice(i + 1, 0, c);
      return result(true);
    },
    /** Removes vertex `i`. A finished polygon keeps at least three. */
    removeVertex(i) {
      if (st.kind === 'rectangle' && st.closed) return result(false, 'A rectangle cannot lose a corner. Undo or start again.');
      if (i < 0 || i >= st.vertices.length) return result(false);
      if (st.closed && st.vertices.length <= 3) return result(false, 'A flying area needs at least 3 points.');
      push(); st.vertices.splice(i, 1);
      return result(true);
    },

    addSpot(p, type = 'open', note = '') {
      const c = cleanPosition(p);
      if (!c) return result(false, 'That is not a valid position.');
      if (!SPOT_TYPES.includes(type)) return result(false, 'Unknown setup spot type.');
      if (st.spots.length >= MAX_SPOTS) return result(false, `An area can have at most ${MAX_SPOTS} setup spots.`);
      if (!st.closed || !validateVertices(st.vertices).ok) return result(false, 'Finish a valid outline before adding setup spots.');
      if (!pointInPolygon(c, st.vertices)) return result(false, 'A setup spot must be inside the area.');
      push(); st.spots.push({ id: spotId(), type, note: String(note).slice(0, 120), coordinates: c });
      return result(true);
    },
    moveSpot(id, p) {
      const s = st.spots.find((x) => x.id === id), c = cleanPosition(p);
      if (!s || !c) return result(false);
      if (!pointInPolygon(c, st.vertices)) return result(false, 'A setup spot must be inside the area.');
      push(); s.coordinates = c;
      return result(true);
    },
    /** Changes a spot's type or note. */
    setSpot(id, { type, note }) {
      const s = st.spots.find((x) => x.id === id);
      if (!s) return result(false);
      if (type !== undefined && !SPOT_TYPES.includes(type)) return result(false, 'Unknown setup spot type.');
      push(); if (type !== undefined) s.type = type; if (note !== undefined) s.note = String(note).slice(0, 120);
      return result(true);
    },
    removeSpot(id) {
      const i = st.spots.findIndex((x) => x.id === id);
      if (i < 0) return result(false);
      push(); st.spots.splice(i, 1);
      return result(true);
    },
    /** Ids of spots that no longer lie inside the outline (after the outline was edited). */
    outsideSpotIds() { return validateVertices(st.vertices).ok ? st.spots.filter((s) => !pointInPolygon(s.coordinates, st.vertices)).map((s) => s.id) : []; },

    undo() {
      const s = history.pop();
      if (!s) return false;
      st.vertices = s.vertices; st.spots = s.spots; st.closed = s.closed;
      return true;
    },
    /** Live check of the outline so far. -> { ok, errors, areaM2 }; with fewer than 3 points it only says how many are missing. */
    check() { return validateVertices(st.vertices); },
    /** Everything but the area record's id and times: ready for the store (which validates again). */
    toDraft() {
      return { name: st.name, description: st.description, drawKind: st.kind, geometry: { type: 'Polygon', coordinates: [[...st.vertices, st.vertices[0]]] }, spots: st.spots.map((s) => ({ ...s })), attributes: JSON.parse(JSON.stringify(st.attributes)) };
    },
    /** Full validation of what would be saved, spots included. -> { ok, errors } */
    validate() {
      const v = validateVertices(st.vertices);
      const errors = [...v.errors];
      if (!st.closed) errors.push({ code: 'not-finished', message: 'Finish the outline first.' });
      if (v.ok) errors.push(...validateSpots(st.spots, v.vertices).errors);
      return { ok: errors.length === 0, errors };
    },
  };
  return api;
}
