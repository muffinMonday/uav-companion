// The plain side of the session map preview (src/sessions-preview.js): which four raster tiles show a meeting point and where the pin sits. No browser, no network.
// A 2 x 2 grid of 256 px tiles at one zoom, laid out so the point is as near the middle as the tiles allow (Web Mercator, the same scheme the basemap uses).

export const PREVIEW_ZOOM = 15, TILE = 256;

/** Fractional tile coordinates of a point at a zoom. */
export function tileXY(lat, lng, z) {
  const n = 2 ** z, la = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n };
}

/** The tile URL for a basemap template ("{s}" taken as the first subdomain), or null when the template is unusable. */
export function tileUrl(template, subdomains, z, x, y) {
  if (typeof template !== 'string') return null;
  const s = typeof subdomains === 'string' && subdomains ? subdomains[0] : 'a';
  return template.replace('{s}', s).replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

/**
 * The grid for a point: `tiles` (url, left/top in px inside the 512 px grid) and `pin` (px inside the grid). Longitude wraps; latitude is clamped to the Mercator limit.
 * Returns null when the point or the template is invalid.
 */
export function tileGrid(lat, lng, [template, opts = {}], z = PREVIEW_ZOOM) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const { x, y } = tileXY(lat, lng, z), n = 2 ** z;
  const x0 = Math.floor(x - 0.5), y0 = Math.max(0, Math.min(n - 2, Math.floor(y - 0.5)));
  const tiles = [];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const url = tileUrl(template, opts.subdomains, z, ((x0 + dx) % n + n) % n, y0 + dy);
    if (!url) return null;
    tiles.push({ url, left: dx * TILE, top: dy * TILE });
  }
  return { tiles, pin: { x: (x - x0) * TILE, y: (y - y0) * TILE }, size: TILE * 2 };
}

/** The attribution as plain text (the basemap's own HTML credit with the markup removed), always naming OpenStreetMap contributors. */
export function creditText(html) {
  const t = String(html ?? '').replace(/<[^>]*>/g, '').replace(/&copy;/g, '©').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return t || '© OpenStreetMap contributors';
}
