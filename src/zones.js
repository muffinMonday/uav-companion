// Reading zones out of PMTiles vector tiles. No DOM and no network of its own, so Node tests can use it with an in-memory archive.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

export async function gunzipIfNeeded(ab) {
  const b = new Uint8Array(ab);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
  const stream = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Is (px, py) inside these rings? Even-odd: a ring inside another is a hole. */
export function inRings(rings, px, py) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * The zones containing a point, read from a PMTiles archive (anything with getZxy) at its highest zoom: the properties of every
 * polygon that holds the point ({} for a region whose zones carry none). Overlapping zones all come back.
 */
export async function zonesInArchive(arc, maxZoom, lat, lon) {
  const z = maxZoom, n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  const tile = await arc.getZxy(z, x, y);
  if (!tile) return [];
  const layer = new VectorTile(new PbfReader(await gunzipIfNeeded(tile.data))).layers.zones;
  if (!layer) return [];
  const px = (fx - x) * layer.extent, py = (fy - y) * layer.extent;
  const found = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (inRings(f.loadGeometry(), px, py)) found.push({ ...f.properties });
  }
  return found;
}
