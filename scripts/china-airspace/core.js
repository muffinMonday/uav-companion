import crypto from 'node:crypto';
import { budget, geometryErrors, canonicalGeometry, boundsOf, bboxIntersects, geometryOverlap, intersectsBox } from './geometry.js';

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export const stringify = value => JSON.stringify(stable(value));
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export function validBox(b) {
  return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[0] >= -180 && b[2] <= 180 && b[1] >= -85 && b[3] <= 85 && b[0] < b[2] && b[1] < b[3];
}
export function partition(box, { columns = 1, rows = 1, overlap = 0, boundary = null, maxRequests = 64 } = {}) {
  if (!validBox(box)) throw new Error('Invalid bbox [west,south,east,north], within Web Mercator latitude range');
  if (![columns, rows, maxRequests].every(n => Number.isInteger(n) && n > 0) || columns * rows > maxRequests || !Number.isFinite(overlap) || overlap < 0 || overlap >= 0.5) throw new Error('Invalid partition or request budget');
  if (boundary && geometryErrors(boundary).length) throw new Error('Invalid boundary geometry');
  const [w, s, e, n] = box, dx = (e - w) / columns, dy = (n - s) / rows;
  const out = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const core = [w + col * dx, s + row * dy, col === columns - 1 ? e : w + (col + 1) * dx, row === rows - 1 ? n : s + (row + 1) * dy];
    const bbox = [Math.max(w, core[0] - dx * overlap), Math.max(s, core[1] - dy * overlap), Math.min(e, core[2] + dx * overlap), Math.min(n, core[3] + dy * overlap)];
    if (!boundary || intersectsBox(boundary, bbox)) out.push({ key: `${row}-${col}`, core, bbox });
  }
  return out;
}
function featureId(f, idProperty) {
  const id = idProperty ? f.properties?.[idProperty] : f.id;
  if (id === undefined || id === null) return null;
  if ((typeof id !== 'string' && typeof id !== 'number') || id === '' || (typeof id === 'number' && !Number.isSafeInteger(id))) throw new Error('invalid-feature-id');
  return `${typeof id}:${id}`;
}
export function validateCollection(collection, { crs = 'unknown', idProperty, topologyBudget = 2_000_000 } = {}) {
  const errors = [], tick = budget(topologyBudget);
  if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) return { valid: false, errors: ['expected-feature-collection'], features: [] };
  if (!collection.features.length) errors.push('empty-response');
  if (!['wgs84', 'gcj02'].includes(crs)) errors.push('crs-unverified-or-unsupported');
  if (collection.coordinateSystem !== undefined) {
    const declared = {WGS84:'wgs84','EPSG:4326':'wgs84','GCJ-02':'gcj02',GCJ02:'gcj02'}[collection.coordinateSystem];
    if (!declared || declared !== crs) errors.push('conflicting-or-unsupported-coordinate-system');
  }
  if (collection.crs) {
    const name = collection.crs?.properties?.name;
    if (crs !== 'wgs84' || !['EPSG:4326', 'urn:ogc:def:crs:OGC:1.3:CRS84', 'urn:ogc:def:crs:EPSG::4326'].includes(name)) errors.push('conflicting-or-unsupported-declared-crs');
  }
  if (collection.truncated === true || collection.hasMore === true || collection.next || collection.nextPage || collection.links?.some?.(x => x.rel === 'next') || (Number.isFinite(collection.totalFeatures) && collection.totalFeatures !== collection.features.length) || (Number.isFinite(collection.numberMatched) && collection.numberMatched !== collection.features.length)) errors.push('pagination-or-truncation');
  const features = [];
  try {
    for (let i = 0; i < collection.features.length; i++) {
      const f = collection.features[i];
      if (!f || f.type !== 'Feature' || (f.properties !== null && (typeof f.properties !== 'object' || Array.isArray(f.properties)))) { errors.push(`feature-${i}:invalid-feature`); continue; }
      const issues = geometryErrors(f.geometry, tick);
      if (issues.length) { errors.push(...issues.map(e => `feature-${i}:${e}`)); continue; }
      const b = boundsOf(f.geometry);
      if (b[1] < -85 || b[3] > 85) { errors.push(`feature-${i}:outside-pmtiles-latitude`); continue; }
      let id;
      try { id = featureId(f, idProperty); } catch (e) { errors.push(`feature-${i}:${e.message}`); continue; }
      const geometry = canonicalGeometry(f.geometry);
      features.push({ feature: { type: 'Feature', ...(id !== null && { id: idProperty ? f.properties[idProperty] : f.id }), properties: stable(f.properties ?? {}), geometry }, id, geometryHash: sha256(stringify(geometry)), bounds: b });
    }
  } catch (e) { if (e.message !== 'topology-budget-exhausted') throw e; errors.push(e.message); }
  return { valid: !errors.length, errors: errors.slice(0, 200), errorCount: errors.length, features };
}
export function normalize(collections, options = {}) {
  const errors = [], ids = new Map(), geometries = new Map(), duplicates = [], conflicts = [];
  const inputs = collections.map(c => validateCollection(c, options));
  for (let i = 0; i < inputs.length; i++) {
    errors.push(...inputs[i].errors.map(e => `response-${i}:${e}`));
    for (const item of inputs[i].features) {
      if (item.id !== null) {
        const previous = ids.get(item.id);
        if (previous && (previous.geometryHash !== item.geometryHash || stringify(previous.feature.properties) !== stringify(item.feature.properties))) conflicts.push({ id: item.id, reason: 'stable-id-conflict' });
        else ids.set(item.id, item);
      }
      const previous = geometries.get(item.geometryHash);
      if (previous) {
        duplicates.push({ id: item.id, previousId: previous.id, geometryHash: item.geometryHash });
        if (stringify(previous.feature.properties) !== stringify(item.feature.properties)) conflicts.push({ geometryHash: item.geometryHash, reason: 'geometry-properties-conflict' });
        if (stringify(item.feature) < stringify(previous.feature)) geometries.set(item.geometryHash, item);
      } else geometries.set(item.geometryHash, item);
    }
  }
  const items = [...geometries.values()].sort((a, b) => a.geometryHash < b.geometryHash ? -1 : a.geometryHash > b.geometryHash ? 1 : 0);
  const overlaps = [], tick = budget(options.topologyBudget);
  let overlapComplete = true;
  const ordered = [...items].sort((a, b) => a.bounds[0] - b.bounds[0]);
  try {
    for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length && ordered[j].bounds[0] < ordered[i].bounds[2]; j++) {
      tick();
      if (bboxIntersects(ordered[i].bounds, ordered[j].bounds, true) && geometryOverlap(ordered[i].feature.geometry, ordered[j].feature.geometry, tick)) overlaps.push([ordered[i].geometryHash, ordered[j].geometryHash]);
    }
  } catch (e) { if (e.message !== 'topology-budget-exhausted') throw e; overlapComplete = false; errors.push(e.message); }
  const geojson = { type: 'FeatureCollection', features: items.map(x => x.feature) };
  return { geojson, sha256: sha256(stringify(geojson)), report: { valid: !errors.length && !conflicts.length && !overlaps.length && items.length > 0, inputResponses: collections.length, inputFeatures: collections.reduce((n, c) => n + (c?.features?.length ?? 0), 0), uniqueFeatures: items.length, duplicateCount: duplicates.length, duplicates, conflicts, overlaps, overlapCheckComplete: overlapComplete, errors: errors.slice(0, 200), errorCount: errors.length, crs: options.crs ?? 'unknown', crsAlignment: 'unverified', semantics: 'unknown', regulatoryValidity: 'unverified', integrationReady: false } };
}
// Compare entire features in the common area; never clip/union a disagreement away.
export function compareResponses(a, aBox, b, bBox, options = {}) {
  const av = validateCollection(a, options), bv = validateCollection(b, options);
  if (!av.valid || !bv.valid || !validBox(aBox) || !validBox(bBox)) return { status: 'invalid-input' };
  const common = [Math.max(aBox[0], bBox[0]), Math.max(aBox[1], bBox[1]), Math.min(aBox[2], bBox[2]), Math.min(aBox[3], bBox[3])];
  if (!validBox(common)) return { status: 'no-overlapping-query-area' };
  const select = v => new Set(v.features.filter(x => intersectsBox(x.feature.geometry, common)).map(x => x.geometryHash));
  const as = select(av), bs = select(bv), onlyA = [...as].filter(x => !bs.has(x)).sort(), onlyB = [...bs].filter(x => !as.has(x)).sort();
  return { status: onlyA.length || onlyB.length ? 'inconsistent' : as.size ? 'consistent-sample' : 'empty-common-area-unproven', common, onlyA, onlyB, matched: [...as].filter(x => bs.has(x)).length, provesProvincialCompleteness: false };
}
