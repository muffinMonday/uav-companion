import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

export const MIN_Z = 3;
export const MAX_Z = 14;

function tileRange(bounds, z) {
  const n = 2 ** z;
  const lonX = (l) => Math.floor(((l + 180) / 360) * n);
  const latY = (l) => { const s = Math.sin(l * Math.PI / 180); return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n); };
  return {
    x0: Math.max(0, lonX(bounds[0])), x1: Math.min(n - 1, lonX(bounds[2])),
    y0: Math.max(0, latY(bounds[3])), y1: Math.min(n - 1, latY(bounds[1])),
  };
}

/** Slices features into vector tiles (layer "zones") for z MIN_Z..MAX_Z. Returns [{z,x,y,data}]. */
export function buildTiles(features, bounds, log = () => {}) {
  const index = new geojsonvt({ type: 'FeatureCollection', features }, { maxZoom: MAX_Z, indexMaxZoom: 8, tolerance: 3, extent: 4096, buffer: 64 });
  const tiles = [];
  for (let z = MIN_Z; z <= MAX_Z; z++) {
    const before = tiles.length;
    const { x0, x1, y0, y1 } = tileRange(bounds, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const t = index.getTile(z, x, y);
      if (!t || !t.features.length) continue;
      tiles.push({ z, x, y, data: Buffer.from(vtpbf.fromGeojsonVt({ zones: t }, { version: 2 })) });
    }
    log(`z${z}: ${tiles.length - before} tiles`);
  }
  return tiles;
}
