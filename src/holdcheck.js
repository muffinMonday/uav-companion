// Point check by press and hold. A quick click on blank map does nothing but close windows; holding still for HOLD_MS checks that spot.
// A right-click checks at once (mouse users should not have to wait), and Enter on the focused map checks its centre.

export const HOLD_MS = 2000;  // how long to hold
const SLOP = 8;               // px of movement that turns a hold into a drag

/**
 * @param {object} o
 * @param {L.Map} o.map
 * @param {() => boolean} o.isBusy      true while placing or editing markers: holding does nothing then
 * @param {(latlng) => void} o.onCheck  runs the point check for a coordinate
 * @returns {{ consumeClick: () => boolean }}  consumeClick() is true once after a hold fired: that click must be ignored
 */
export function initHoldCheck({ map, isBusy, onCheck, holdMs = HOLD_MS }) {
  const box = map.getContainer();
  let timer = null, ring = null, start = null, lastType = 'mouse', swallow = false, swallowTimer = null;

  const cancel = () => {
    clearTimeout(timer); timer = null;
    ring?.remove(); ring = null; start = null;
  };
  const blocked = (t) => !!t.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control, .leaflet-tooltip');

  box.addEventListener('pointerdown', (e) => {
    lastType = e.pointerType || 'mouse';
    if (timer) { cancel(); return; }                  // a second finger: a pinch, not a hold
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (isBusy() || blocked(e.target)) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    const r = box.getBoundingClientRect();
    ring = document.createElement('div');
    ring.className = 'hold-ring';
    ring.style.setProperty('--hold-ms', `${holdMs}ms`);
    ring.style.left = `${e.clientX - r.left}px`;
    ring.style.top = `${e.clientY - r.top}px`;
    box.append(ring);
    const point = map.mouseEventToContainerPoint(e);
    timer = setTimeout(() => {
      const latlng = map.containerPointToLatLng(point);
      cancel();
      swallow = true; clearTimeout(swallowTimer); swallowTimer = setTimeout(() => { swallow = false; }, 1500); // the release must not count as a click
      navigator.vibrate?.(30);
      onCheck(latlng.wrap());
    }, holdMs);
  });
  box.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
  });
  for (const ev of ['pointerup', 'pointercancel']) box.addEventListener(ev, cancel);
  box.addEventListener('pointerleave', cancel);
  map.on('movestart zoomstart', cancel);

  // right-click: check at once. A touch long-press also raises "contextmenu" on some phones, which must not fire the check early.
  map.on('contextmenu', (e) => {
    e.originalEvent.preventDefault();
    if (lastType !== 'mouse' || isBusy() || blocked(e.originalEvent.target)) return;
    cancel();
    onCheck(e.latlng.wrap());
  });
  box.addEventListener('contextmenu', (e) => { if (lastType !== 'mouse') e.preventDefault(); });

  // keyboard: Enter on the focused map checks the spot at its centre
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target !== box || isBusy()) return;
    e.preventDefault();
    onCheck(map.getCenter().wrap());
  });

  return {
    consumeClick() { if (!swallow) return false; swallow = false; clearTimeout(swallowTimer); return true; },
  };
}
