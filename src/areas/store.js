// Community flying areas, Phase 1: the local store (`uavzones.v1.areas`) and GeoJSON import/export. Nothing here talks to a server.
// Private drafts live only in this browser. A blocked or full storage falls back to memory with a warning (status().persistent is false).
// A stored value that cannot be read (broken JSON, unknown version) is copied to `uavzones.v1.areas.bak` before the store starts empty, so a
// bug or a newer app version can never silently destroy what a person drew; records that fail validation are dropped the same way.
import { validateArea, validateVertices, closeRing, openRing, cleanText, NAME_MAX } from './core.js';

export const KEY = 'uavzones.v1.areas';
export const BACKUP_KEY = 'uavzones.v1.areas.bak';
export const MAX_AREAS = 200;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const GEOJSON_KIND = 'uavzones.community-area';
export const SPOT_KIND = 'uavzones.setup-spot';

const newId = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString();
const isIso = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));

function defaultStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }

/** `storage`: anything with getItem/setItem (tests pass a fake); default localStorage. */
export function createAreaStore({ storage = defaultStorage() } = {}) {
  let areas = [];
  let persistent = !!storage;
  let warning = storage ? null : 'This browser blocks saving. Areas last only until the page is closed: export them to keep them.';
  let recovered = null; // { reason, dropped } when the stored value was damaged
  const listeners = new Set();

  const keepBackup = (raw) => { try { if (storage && raw && storage.getItem(BACKUP_KEY) === null) storage.setItem(BACKUP_KEY, raw); } catch { /* nothing more can be done */ } };

  function load() {
    let raw = null;
    try { raw = storage?.getItem(KEY) ?? null; } catch { persistent = false; warning = 'This browser blocks saving. Areas last only until the page is closed: export them to keep them.'; return; }
    if (raw === null) return;
    let data;
    try { data = JSON.parse(raw); } catch { keepBackup(raw); recovered = { reason: 'unreadable', dropped: 0 }; return; }
    if (!data || typeof data !== 'object' || data.v !== 1 || !Array.isArray(data.areas)) { keepBackup(raw); recovered = { reason: 'unknown-format', dropped: 0 }; return; }
    let dropped = 0;
    const seen = new Set();
    for (const rec of data.areas.slice(0, MAX_AREAS)) {
      const r = validateArea(rec);
      if (!r.ok || !rec.id || typeof rec.id !== 'string' || seen.has(rec.id)) { dropped++; continue; }
      seen.add(rec.id);
      areas.push({ ...r.area, id: rec.id, created: isIso(rec.created) ? rec.created : nowIso(), updated: isIso(rec.updated) ? rec.updated : nowIso() });
    }
    dropped += Math.max(0, data.areas.length - MAX_AREAS);
    if (dropped) { keepBackup(raw); recovered = { reason: 'invalid-records', dropped }; }
  }

  function persist() {
    if (persistent) {
      try { storage.setItem(KEY, JSON.stringify({ v: 1, areas })); }
      catch { persistent = false; warning = 'This browser could not save the areas (storage blocked or full). They last only until the page is closed: export them to keep them.'; }
    }
    for (const f of listeners) { try { f(); } catch { /* a listener must not break the store */ } }
  }
  load();

  const find = (id) => areas.find((a) => a.id === id) ?? null;
  const copy = (a) => structuredClone(a);

  return {
    list: () => areas.map(copy),
    get: (id) => (find(id) ? copy(find(id)) : null),
    count: () => areas.length,
    /** Adds a new area. `draft` is validated; the id and times are the store's. -> { ok, errors, area }. */
    add(draft) {
      if (areas.length >= MAX_AREAS) return { ok: false, errors: [{ code: 'too-many-areas', message: `You can keep at most ${MAX_AREAS} areas in this browser.` }], area: null };
      const r = validateArea(draft);
      if (!r.ok) return r;
      const t = nowIso();
      const area = { ...r.area, id: newId(), created: t, updated: t };
      areas.push(area); persist();
      return { ok: true, errors: [], area: copy(area) };
    },
    /** Replaces the content of an existing area (id and created time kept). -> { ok, errors, area }. */
    update(id, draft) {
      const old = find(id);
      if (!old) return { ok: false, errors: [{ code: 'not-found', message: 'That area no longer exists.' }], area: null };
      const r = validateArea({ ...draft, id });
      if (!r.ok) return r;
      Object.assign(old, r.area, { id, created: old.created, updated: nowIso() });
      persist();
      return { ok: true, errors: [], area: copy(old) };
    },
    /** A copy named "Copy of <name>" (cut to the name limit). -> the same result shape as add(). */
    duplicate(id) {
      const old = find(id);
      if (!old) return { ok: false, errors: [{ code: 'not-found', message: 'That area no longer exists.' }], area: null };
      const name = cleanText('Copy of ' + old.name, { max: NAME_MAX }).value || 'Copy';
      const clipped = Array.from(name).slice(0, NAME_MAX).join('');
      return this.add({ ...copy(old), name: clipped, spots: old.spots.map(({ id: _drop, ...s }) => s) });
    },
    remove(id) {
      const i = areas.findIndex((a) => a.id === id);
      if (i < 0) return false;
      areas.splice(i, 1); persist();
      return true;
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    /** { persistent, warning, recovered }: persistent is false when areas live in memory only. */
    status: () => ({ persistent, warning, recovered }),
    /** A GeoJSON FeatureCollection (object) of the given areas (default all). */
    toGeoJSON: (ids = null) => toGeoJSON(ids ? areas.filter((a) => ids.includes(a.id)) : areas),
    /** Validates `text` and adds every valid area as a new one. -> { added, skipped: [{ index, reason }], error } (error: the file as a whole was refused). */
    importGeoJSON(text) {
      const parsed = parseGeoJSON(text);
      if (parsed.error) return { added: 0, skipped: [], error: parsed.error };
      let added = 0;
      const skipped = [...parsed.skipped];
      for (const item of parsed.areas) {
        const r = this.add(item);
        if (r.ok) added++; else skipped.push({ index: item.sourceIndex, reason: r.errors[0]?.message ?? 'Not valid.' });
      }
      return { added, skipped, error: null };
    },
  };
}

/** Pure: a FeatureCollection for areas that are already valid records. Each spot is a Point feature that names its area. */
export function toGeoJSON(list) {
  const features = [];
  for (const a of list) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [a.geometry.coordinates[0].map((p) => [p[0], p[1]])] },
      properties: { kind: GEOJSON_KIND, v: 1, id: a.id, name: a.name, description: a.description, drawKind: a.drawKind, created: a.created, updated: a.updated },
    });
    for (const s of a.spots) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.coordinates[0], s.coordinates[1]] }, properties: { kind: SPOT_KIND, areaId: a.id, type: s.type, note: s.note } });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Pure: reads GeoJSON text without storing anything. Accepts a FeatureCollection, one Feature or a bare Polygon; only Polygon geometry becomes an
 * area (a MultiPolygon, polygon with holes or point is skipped with a reason). A name comes from properties.name; setup spots from Point features
 * whose properties.areaId names the polygon's properties.id. -> { areas: [draft with sourceIndex], skipped, error }.
 */
export function parseGeoJSON(text) {
  if (typeof text !== 'string' || !text.trim()) return { areas: [], skipped: [], error: 'The file is empty.' };
  if (text.length > MAX_IMPORT_BYTES) return { areas: [], skipped: [], error: 'The file is too large (2 MB at most).' };
  let doc;
  try { doc = JSON.parse(text); } catch { return { areas: [], skipped: [], error: 'The file is not valid JSON.' }; }
  let features;
  if (doc?.type === 'FeatureCollection' && Array.isArray(doc.features)) features = doc.features;
  else if (doc?.type === 'Feature') features = [doc];
  else if (doc?.type === 'Polygon') features = [{ type: 'Feature', geometry: doc, properties: {} }];
  else return { areas: [], skipped: [], error: 'The file is not GeoJSON (expected a FeatureCollection, Feature or Polygon).' };
  if (features.length > MAX_AREAS * 12) return { areas: [], skipped: [], error: 'The file has too many features.' };

  const areas = [], skipped = [], byId = new Map(), spotsOf = new Map();
  features.forEach((f, index) => {
    const props = f && typeof f.properties === 'object' && f.properties ? f.properties : {};
    const g = f?.geometry;
    if (g?.type === 'Point' && props.kind === SPOT_KIND && typeof props.areaId === 'string') {
      const list = spotsOf.get(props.areaId) ?? []; list.push({ type: props.type, note: props.note, coordinates: g.coordinates });
      spotsOf.set(props.areaId, list);
      return;
    }
    if (g?.type !== 'Polygon') { skipped.push({ index, reason: g?.type ? `${g.type} features are not supported (polygons only).` : 'The feature has no geometry.' }); return; }
    if (!Array.isArray(g.coordinates) || g.coordinates.length !== 1) { skipped.push({ index, reason: 'Polygons with holes are not supported.' }); return; }
    const ring = g.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 4 || JSON.stringify(ring[0]?.slice?.(0, 2)) !== JSON.stringify(ring[ring.length - 1]?.slice?.(0, 2))) { skipped.push({ index, reason: 'The polygon ring is not closed.' }); return; }
    const v = validateVertices(openRing(ring));
    if (!v.ok) { skipped.push({ index, reason: v.errors[0].message }); return; }
    const name = props.name ?? props.title;
    const item = { sourceIndex: index, name, description: props.description, drawKind: props.drawKind === 'rectangle' && v.vertices.length === 4 ? 'rectangle' : 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(v.vertices)] }, spots: [] };
    if (typeof props.id === 'string') byId.set(props.id, item);
    areas.push(item);
  });
  for (const [areaId, list] of spotsOf) { const a = byId.get(areaId); if (a) a.spots = list; } // spots whose area is absent are ignored
  return { areas, skipped, error: null };
}
