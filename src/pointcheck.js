// F4: what does the data say about this point? Reads the same PMTiles the map draws, at the highest zoom.
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { dataUrl } from './config.js';
import { el, statusEl, disclaimer } from './cards.js';

const archives = new Map();
const boundaries = new Map();
let regions = [];

export function initPointCheck(list) { regions = list; }

const archive = (r) => {
  if (!archives.has(r.id)) archives.set(r.id, new PMTiles(dataUrl(r.file)));
  return archives.get(r.id);
};

async function gunzipIfNeeded(ab) {
  const b = new Uint8Array(ab);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
  const stream = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function inRings(rings, px, py) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

async function insideZones(r, lat, lon) {
  const z = r.maxZoom, n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  const tile = await archive(r).getZxy(z, x, y);
  if (!tile) return false;
  const layer = new VectorTile(new PbfReader(await gunzipIfNeeded(tile.data))).layers.zones;
  if (!layer) return false;
  const px = (fx - x) * layer.extent, py = (fy - y) * layer.extent;
  for (let i = 0; i < layer.length; i++) if (inRings(layer.feature(i).loadGeometry(), px, py)) return true;
  return false;
}

/** Is the point inside the region's coverage boundary? Regions without a boundary fall back to their bounding box. */
async function inCoverage(r, lat, lon) {
  if (!r.boundary) return true; // caller has already tested the bounding box
  if (!boundaries.has(r.id)) {
    boundaries.set(r.id, fetch(dataUrl(r.boundary)).then((res) => {
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
  return inside;
}

/**
 * Returns { status: 'inside' | 'outside' | 'nodata', region }.
 *  inside  : the point is within a zone polygon of `region`.
 *  outside : the point is within the region's coverage but not in any zone polygon.
 *  nodata  : no loaded region covers the point, so the data says nothing about it.
 * What "inside" means (permitted or restricted) comes from region.semantics; see describeCheck.
 */
export async function checkPoint(lat, lon) {
  const near = regions.filter((r) => {
    const b = r.coverageBounds || r.bounds;
    return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
  });
  for (const r of near) if (await insideZones(r, lat, lon)) return { status: 'inside', region: r };
  for (const r of near) if (await inCoverage(r, lat, lon)) return { status: 'outside', region: r };
  return { status: 'nodata' };
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

/** Builds popup content (DOM, no innerHTML) for a check result. */
export function describeCheck(res, title) {
  const box = el('div', 'pop check');
  if (title) box.append(el('div', 'pop-sub', title));
  box.append(statusEl(zoneSummary(res)), disclaimer());
  return box;
}
