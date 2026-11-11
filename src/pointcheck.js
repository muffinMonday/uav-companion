// F4: what does the data say about this point? Reads the same PMTiles the map draws, at the highest zoom.
import { PMTiles } from 'pmtiles';
import { zonesInArchive } from './zones.js';
import { regionUrl } from './config.js';
import { el, statusEl, disclaimer } from './cards.js';

const archives = new Map();
const boundaries = new Map();
let regions = [];

export function initPointCheck(list) { regions = list; }

const archive = (r) => {
  if (!archives.has(r.id)) archives.set(r.id, new PMTiles(regionUrl(r, r.file)));
  return archives.get(r.id);
};

/** Metres from a point to the nearest edge of a set of polygons ([[ring, ...], ...] of [lon, lat]); good enough for a margin of a few km. */
function metresToPolygons(polys, lat, lon) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let best = Infinity;
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j][0] - lon) * kx, ay = (ring[j][1] - lat) * ky, bx = (ring[i][0] - lon) * kx, by = (ring[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

/** Is the point inside the region's coverage boundary (or within its margin)? Regions without a boundary fall back to their bounding box. */
async function inCoverage(r, lat, lon) {
  if (!r.boundary) return true; // caller has already tested the bounding box
  if (!boundaries.has(r.id)) {
    boundaries.set(r.id, fetch(regionUrl(r, r.boundary)).then((res) => {
      if (!res.ok) throw new Error(`boundary ${res.status}`);
      return res.json();
    }).then((gj) => {
      const g = gj.type === 'Feature' ? gj.geometry : gj;
      return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    }));
  }
  let polys;
  try { polys = await boundaries.get(r.id); } catch { boundaries.delete(r.id); return true; } // boundary unavailable: bbox only
  let inside = false;
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > lat) !== (b[1] > lat) && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  // a region can allow a margin around its boundary (the outline is coarse, and zones run out over the water)
  return inside || (!!r.coverageMarginM && metresToPolygons(polys, lat, lon) <= r.coverageMarginM);
}

/**
 * Returns { status: 'inside' | 'outside' | 'nodata', region, zones }.
 *  inside  : the point is within a zone polygon of `region` (zones: the properties of each polygon holding it).
 *  outside : the point is within the region's coverage but not in any zone polygon.
 *  nodata  : no loaded region covers the point, so the data says nothing about it.
 * What "inside" means (permitted or restricted) comes from region.semantics; see describeCheck.
 */
export async function checkPoint(lat, lon) {
  const near = regions.filter((r) => {
    const b = r.coverageBounds || r.bounds;
    return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
  });
  for (const r of near) {
    const zones = await zonesInArchive(archive(r), r.maxZoom, lat, lon);
    if (zones.length) return { status: 'inside', region: r, zones };
  }
  for (const r of near) if (await inCoverage(r, lat, lon)) return { status: 'outside', region: r, zones: [] };
  return { status: 'nodata', zones: [] };
}

const dmy = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const classOf = (r, z) => r.classes?.find((c) => c.id === z.c);
/** The zones of a result, most serious first (a class has a severity: 1 is the most serious). */
export function sortedZones(res) {
  const r = res.region;
  return [...(res.zones ?? [])].sort((a, b) => (classOf(r, a)?.severity ?? 9) - (classOf(r, b)?.severity ?? 9) || String(a.n).localeCompare(String(b.n)));
}

/** Wording per meaning of the data. `allow` = zones are where flying is permitted; `restrict` = zones are restricted areas. */
function wording(res) {
  const r = res.region;
  if (res.status === 'nodata') {
    return ['unk', 'No data for this area', 'This map does not cover this location yet. It says nothing about whether flying is allowed.'];
  }
  const source = `${r.name} data (${r.source.authority}, effective ${r.source.effective})`;
  if (r.semantics === 'allow') {
    return res.status === 'inside'
      ? ['ok', `Suitable-flight zone${r.maxHeightM ? `, below ${r.maxHeightM} m true height` : ''}`, `Per ${source}.`]
      : ['no', 'Outside the suitable-flight zone (controlled airspace)',
        `No suitable-flight cell here in the ${r.name} data. Near a region's edge, this can also mean the point is outside the data's coverage.`];
  }
  if (r.classes) { // restrict, with named classes of zone (Singapore): say which, and point to the official map
    if (res.status === 'inside') {
      const zs = sortedZones(res);
      const worst = classOf(r, zs[0]);
      const kinds = [...new Set(zs.map((z) => classOf(r, z)?.label ?? z.c))];
      return ['no', `No-fly zone: ${worst?.label ?? 'restricted'}${kinds.length > 1 ? ` and ${kinds.length - 1} more` : ''}`,
        `${kinds.join('; ')}. Flying here needs permission, or is not allowed. Check the official map before flying.`];
    }
    return ['unk', 'Not inside a mapped no-fly zone',
      'This does not mean flying is allowed. Temporary restricted areas, notices to airmen and rules that are not in this data still apply. Check the official map before flying.'];
  }
  return res.status === 'inside'
    ? ['no', 'Restricted area', `Inside a restricted area in the ${source}. Flying here may need permission.`]
    : ['unk', `Not inside a restricted area in the ${r.name} data`,
      'This does not mean flying is allowed. Other rules (height limits, registration, permits) still apply.'];
}

/** The verdict for a check result: { cls: 'ok' | 'no' | 'unk', title, detail }. */
export function zoneSummary(res) {
  const [cls, title, detail] = wording(res);
  return { cls, title, detail };
}

/** The zones holding the point, one row each: name and kind, the rule (with any height limit), and who published it and when. */
function zoneList(res) {
  const r = res.region;
  const ul = el('ul', 'zone-list');
  for (const z of sortedZones(res)) {
    const c = classOf(r, z);
    const li = el('li');
    const dot = el('i', 'zone-dot'); dot.style.background = c?.color ?? '#999';
    const head = el('div', 'zone-name'); head.append(dot, el('strong', '', z.n || c?.label || 'Zone'), ` · ${c?.label ?? z.c}`);
    li.append(head, el('small', 'zone-rule', z.d || c?.description || c?.summary || ''));
    if (c) li.append(el('small', 'zone-src', `${c.owner} · updated ${dmy(c.updated)}`));
    ul.append(li);
  }
  return ul;
}

/** Builds popup content (DOM, no innerHTML) for a check result. `note`: an extra line (for example about a flying area). */
export function describeCheck(res, title, note) {
  const box = el('div', 'pop check');
  if (title) box.append(el('div', 'pop-sub', title));
  if (note) box.append(el('p', 'check-note', note));
  box.append(statusEl(zoneSummary(res)));
  if (res.status === 'inside' && res.region.classes) box.append(zoneList(res));
  box.append(disclaimer());
  return box;
}
