// The free area of the map: the part of the map container that no overlay (side panel, explorer dock, later the marker panel) covers,
// and the pan that puts a point in the middle of it. Extracted unchanged from sessions-map-explorer.js (Review 01, step S2); the explorer is its only user so far.
// No Leaflet import: the map's own project/unproject accept plain {x, y} points and [lat, lng] pairs, so the maths is testable without a browser.

const rectOf = (e) => e.getBoundingClientRect();

/** `r` minus an overlay `o` that sits along one edge: a bar over most of the height trims left or right, one over most of the width trims top or bottom. */
export function cut(r, o) {
  if (o.width <= 0 || o.height <= 0 || o.right <= r.left || o.left >= r.right || o.bottom <= r.top || o.top >= r.bottom) return r;
  const out = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  if (o.height >= 0.7 * (r.bottom - r.top) && o.width < 0.85 * (r.right - r.left)) { if ((o.left + o.right) / 2 < (r.left + r.right) / 2) out.left = Math.max(out.left, o.right); else out.right = Math.min(out.right, o.left); }
  else if (o.width >= 0.7 * (r.right - r.left)) { if ((o.top + o.bottom) / 2 > (r.top + r.bottom) / 2) out.bottom = Math.min(out.bottom, o.top); else out.top = Math.max(out.top, o.bottom); }
  return out;
}

/** The container rectangle minus every cover rectangle, applied in order. Pure: all rectangles are in the same (viewport) pixels. */
export function freeRect(container, covers) {
  let r = { left: container.left, top: container.top, right: container.right, bottom: container.bottom };
  for (const o of covers) r = cut(r, o);
  return r;
}

/** The middle of `free`, in the container's own pixels. Pure. */
export const freeCentre = (free, container) => ({ x: (free.left + free.right) / 2 - container.left, y: (free.top + free.bottom) / 2 - container.top });

/** An offset (x, y) in screen pixels turned by `bearing` radians: the same offset in the map's own (unturned) pixels. Pure. */
export const unrotate = (t, b) => ({ x: t.x * Math.cos(b) - t.y * Math.sin(b), y: t.x * Math.sin(b) + t.y * Math.cos(b) });

/**
 * `covers()` returns the overlay elements to subtract right now (hidden ones are skipped here; the caller drops any other it wants ignored).
 * -> { rect(), centre(), centerOn(latlng, { zoom, animate, duration }) }.
 */
export function createFreeArea(map, covers) {
  const bearing = () => (map._rot?.bearing?.() ?? 0) * Math.PI / 180;
  const rect = () => freeRect(rectOf(map.getContainer()), (covers() || []).filter((e) => e && !e.hidden).map(rectOf));
  const centre = () => freeCentre(rect(), rectOf(map.getContainer()));
  /** Pans (and zooms to `zoom` if given) so `latlng` ends up at the middle of the free area. Rotation-aware: the map pane is turned about the container's centre. */
  function centerOn(latlng, { zoom = map.getZoom(), animate = true, duration = 0.35 } = {}) {
    const size = map.getSize(), c = centre(), d = unrotate({ x: c.x - size.x / 2, y: c.y - size.y / 2 }, bearing()), p = map.project(latlng, zoom);
    map.setView(map.unproject({ x: p.x - d.x, y: p.y - d.y }, zoom), zoom, { animate, duration });
  }
  return { rect, centre, centerOn };
}

/** Where a docked overlay of width `dockW` goes in a viewport `viewW` wide: 'side' while the map keeps at least `mapMin` px beside it, else 'bottom'. One rule for the explorer and the marker panel. */
export const dockMode = (viewW, dockW, mapMin = 320) => (viewW - dockW >= mapMin ? 'side' : 'bottom');
