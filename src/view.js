// Where the map sits when a window opens: the tapped coordinate is centred, and a window that would not fit above it scrolls inside.

const PHONE_MAX = 520;
const isPhone = () => window.innerWidth <= PHONE_MAX;

/** Width of the side panel when it covers part of the map (desktop only; on a phone the panel is closed first), else 0. */
export function panelInset() {
  const p = document.getElementById('panel');
  return p && !p.hidden && !isPhone() ? p.offsetWidth + 24 : 0;
}

/** Pans so `latlng` is in the middle of the visible map (left of a docked side panel), keeping the zoom. */
export function centreOn(map, latlng, { animate = true } = {}) {
  const z = map.getZoom();
  const p = map.project(latlng, z);
  p.x += panelInset() / 2;
  map.setView(map.unproject(p, z), z, { animate });
}

/**
 * The tallest a window can be while still fitting in the space above a centred point: half the map, minus the gap the
 * pin takes (`offsetY`, how far above the point the window starts), the pointer tip and the search row at the top.
 */
export function popupMaxHeight(map, offsetY = 0) {
  return Math.max(160, Math.floor(map.getSize().y / 2 - Math.abs(offsetY) - 28 - 64));
}
