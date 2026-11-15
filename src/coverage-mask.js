// Optional strict geographic mask. The original PMTiles polygons remain intact.

const masks = new Map();

export function maskPolygons(gj) {
  const g = gj?.type === 'Feature' ? gj.geometry : gj;
  if (!['Polygon', 'MultiPolygon'].includes(g?.type)) throw new Error('Invalid coverage mask geometry');
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  if (!polys.length) throw new Error('Empty coverage mask');
  for (const poly of polys) {
    if (!poly.length) throw new Error('Empty coverage mask polygon');
    for (const ring of poly) {
      if (ring.length < 4 || ring.some(p => p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) >= 85.051129)
        || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('Invalid coverage mask ring');
    }
  }
  return polys;
}

export async function loadCoverageMask(r) {
  if (!r.boundary) throw new Error('A strict coverage mask requires a boundary');
  const { regionUrl } = await import('./config.js');
  const url = regionUrl(r, r.boundary);
  if (!masks.has(url)) {
    const request = fetch(url).then(res => {
      if (!res.ok) throw new Error(`coverage mask ${res.status}`);
      return res.json();
    }).then(maskPolygons).catch(error => { masks.delete(url); throw error; });
    masks.set(url, request);
  }
  return masks.get(url);
}

export function inMask(polys, lat, lon) {
  return polys.some(poly => {
    let inside = false;
    for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > lat) !== (b[1] > lat) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  });
}

// Coordinates in the renderer's 256 CSS-pixel tile space, including overzoom.
export function maskTilePoint([lon, lat], { x, y, z }) {
  const n = 2 ** z, s = Math.sin(lat * Math.PI / 180);
  return [(((lon + 180) / 360) * n - x) * 256,
    ((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n - y) * 256];
}

export function applyTileMask(canvas, coords, polys) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(canvas.width / 256, 0, 0, canvas.height / 256, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  for (const poly of polys) for (const ring of poly) {
    ring.forEach((p, i) => {
      const [x, y] = maskTilePoint(p, coords);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.fill('evenodd');
  ctx.restore();
}

/** Apply before the tile-ready callback, also on library rerenders. No unmasked frame. */
export function maskZoneLayer(layer, r) {
  const render = layer.renderTile;
  layer.renderTile = async function(coords, canvas, key, done = () => {}) {
    let polys;
    try { polys = await loadCoverageMask(r); }
    catch (error) {
      canvas.width = canvas.width; // clear any previous pixels, including a rerender
      done(error);
      return;
    }
    return render.call(this, coords, canvas, key, () => {
      applyTileMask(canvas, coords, polys);
      done();
    });
  };
  return layer;
}
