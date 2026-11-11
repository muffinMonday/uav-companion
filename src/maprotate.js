// Turning the map. Leaflet has no rotation, and the one rotation plugin for it is GPL-licensed (this project is MIT), so the few things rotation needs are done here.
//
// The map's pane (tiles, zones, markers, popups) is turned about the centre of the map with the CSS `rotate` property; the map container, its controls, the
// crosshair and every other screen overlay stay where they are. `bearing` is the compass direction shown at the top of the screen: 0 is north up, 90 puts east
// at the top (the map is turned 90 degrees counter-clockwise). Everything else Leaflet does keeps working because of four small changes, all of which do
// nothing at a bearing of 0:
//   1. the screen point of a mouse or touch event is turned back before Leaflet uses it (clicks, holds, pinch zoom, the wheel, edit-mode marker drags);
//   2. dragging the map moves it by the turned amount;
//   3. tiles are loaded for a square that covers the turned view, so the corners are not blank;
//   4. markers, popups and labels are turned back by the bearing (about the point they mark) so they stay upright; route arrows turn with the map.
// Tested in tests/maprotate.mjs (a real browser, with touch).
import L from 'leaflet';

const rad = (d) => (d * Math.PI) / 180;
const norm180 = (d) => { const n = ((d % 360) + 360) % 360; return n > 180 ? n - 360 : n; };
const TURN_AWAY_DEG = 8; // a two-finger twist must pass this before the map starts to turn, so a pinch to zoom does not wobble it

let patched = false;
function patchLeaflet() {
  if (patched) return;
  patched = true;

  // 1. the point on the map under a mouse or touch event
  const toContainer = L.Map.prototype.mouseEventToContainerPoint;
  L.Map.prototype.mouseEventToContainerPoint = function (e) {
    const p = toContainer.call(this, e);
    const b = this._rot?.bearing();
    if (!b) return p;
    const s = this.getSize(), cx = s.x / 2, cy = s.y / 2, a = rad(b), c = Math.cos(a), si = Math.sin(a);
    const dx = p.x - cx, dy = p.y - cy;
    return L.point(cx + dx * c - dy * si, cy + dx * si + dy * c); // the pane is turned by -bearing about the centre; this turns it back
  };

  // 2. dragging: the finger's movement on the screen is the pane's movement turned back
  const onMove = L.Draggable.prototype._onMove;
  L.Draggable.prototype._onMove = function (e) {
    const b = this._dragStartTarget?._rot?.bearing();
    if (!b || (e.touches && e.touches.length > 1)) return onMove.call(this, e);
    const first = e.touches && e.touches.length === 1 ? e.touches[0] : e;
    const dx = first.clientX - this._startPoint.x, dy = first.clientY - this._startPoint.y;
    const a = rad(b), c = Math.cos(a), si = Math.sin(a);
    const x = this._startPoint.x + dx * c - dy * si, y = this._startPoint.y + dx * si + dy * c;
    const fake = new Proxy(e, {
      get(t, k) {
        if (k === 'clientX') return x;
        if (k === 'clientY') return y;
        if (k === 'touches' && t.touches) return [{ clientX: x, clientY: y }];
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    return onMove.call(this, fake);
  };

  // 4a. upright markers and popups. The CSS `rotate` property is applied BEFORE `transform`, and Leaflet positions icons with `transform`, so turning an icon
  // about its anchor would also turn its position and throw it across the screen. While the map is turned, these elements are positioned with the separate
  // `translate` property instead, which is applied after `rotate`, so they are turned about their own anchor and then moved into place.
  const settle = (el, map) => {
    if (!el?._leaflet_pos) return;
    if (map?._rot?.bearing() && !el.classList.contains('route-arrow-box')) {
      el.style.translate = `${el._leaflet_pos.x}px ${el._leaflet_pos.y}px`;
      el.style.transform = 'none';
    } else if (el.style.translate) el.style.translate = ''; // (Leaflet writes its own transform again when it next positions the element)
  };
  const setPos = L.Marker.prototype._setPos;
  L.Marker.prototype._setPos = function (pos) { setPos.call(this, pos); settle(this._icon, this._map); };
  const updatePopup = L.Popup.prototype._updatePosition;
  L.Popup.prototype._updatePosition = function () { updatePopup.call(this); settle(this._container, this._map); };
  const animatePopup = L.Popup.prototype._animateZoom;
  L.Popup.prototype._animateZoom = function (e) { animatePopup.call(this, e); settle(this._container, this._map); };

  // 3. tiles for the whole turned view: a square that holds the map's diagonal
  const tiled = L.GridLayer.prototype._getTiledPixelBounds;
  L.GridLayer.prototype._getTiledPixelBounds = function (center) {
    const map = this._map;
    if (!map?._rot?.bearing()) return tiled.call(this, center);
    const zoom = map._animatingZoom ? Math.max(map._animateToZoom, map.getZoom()) : map.getZoom();
    const scale = map.getZoomScale(zoom, this._tileZoom), pc = map.project(center, this._tileZoom).floor();
    const s = map.getSize(), d = Math.hypot(s.x, s.y);
    const half = L.point(d, d).divideBy(scale * 2);
    return new L.Bounds(pc.subtract(half), pc.add(half));
  };
}

export function createRotation(map) {
  patchLeaflet();
  const container = map.getContainer(), pane = map.getPane('mapPane'), markerPane = map.getPane('markerPane');
  let bearing = 0, frame = 0, tileBearing = 0, tileTimer = 0, anim = 0, twist = null, was = false;
  const listeners = new Set(), handListeners = new Set();
  container._rot = map._rot = null; // set below, once the controller exists

  function apply() {
    frame = 0;
    const s = map.getSize();
    pane.style.transformOrigin = `${s.x / 2}px ${s.y / 2}px`;
    pane.style.rotate = bearing ? `${-bearing}deg` : '';
    container.style.setProperty('--unrot', `${bearing}deg`);
    const now = Math.abs(bearing) > 0.01;
    container.classList.toggle('rotated', now);
    if (now !== was) { // turned or straightened: markers and popups change how they are positioned (see settle in patchLeaflet)
      was = now;
      map.eachLayer((l) => { if (l instanceof L.Marker) l.update(); else if (l instanceof L.Popup) l._updatePosition(); });
    }
    if (Math.abs(bearing - tileBearing) > 4 || (!bearing && tileBearing) || (bearing && !tileBearing)) {
      tileBearing = bearing;
      clearTimeout(tileTimer);
      tileTimer = setTimeout(() => map.eachLayer((l) => { if (l instanceof L.GridLayer && l._map) l._update(); }), 120); // load what the turn uncovered
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };

  // markers upright about the point they mark (the icon's anchor, which Leaflet puts in its margins)
  const anchorOf = (el) => { if (el.classList?.contains('leaflet-marker-icon')) el.style.transformOrigin = `${-(parseFloat(el.style.marginLeft) || 0)}px ${-(parseFloat(el.style.marginTop) || 0)}px`; };
  markerPane.querySelectorAll('.leaflet-marker-icon').forEach(anchorOf);
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(anchorOf); }).observe(markerPane, { childList: true });
  // a popup stays upright about the point it is attached to: its tip, less the offset Leaflet shifts it by
  map.on('popupopen', (e) => {
    const p = e.popup, el = p?._container;
    if (!el) return;
    const o = L.point(p.options.offset || [0, 0]), a = typeof p._getAnchor === 'function' ? p._getAnchor() : L.point(0, 0);
    el.style.setProperty('--po', `calc(50% - ${o.x + a.x}px) calc(100% + 20px - ${o.y + a.y}px)`);
  });
  map.on('resize', schedule);

  const ctl = {
    /** The compass direction at the top of the screen, in (-180, 180]; 0 is north up. */
    bearing: () => bearing,
    /** Turns the map. `source` is passed to the listeners ('compass', 'hand', 'reset'). */
    set(deg, source = 'compass') {
      let b = norm180(deg);
      if (Math.abs(b) < 0.05) b = 0; // so close to north that it is north (and the map is then not "turned" for any of the patches above)
      if (b === bearing || (b !== 0 && Math.abs(b - bearing) < 0.05)) return;
      bearing = b; schedule();
      listeners.forEach((fn) => fn(bearing, source));
    },
    /** Turns the map smoothly (the short way round) to a bearing. */
    animateTo(deg, ms = 280, source = 'reset') {
      cancelAnimationFrame(anim);
      const from = bearing, delta = norm180(deg - from);
      if (Math.abs(delta) < 0.05) { ctl.set(deg, source); return; }
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3;
        ctl.set(k < 1 ? from + delta * e : deg, source); // the last step lands exactly on the target
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    },
    cancelAnimation: () => cancelAnimationFrame(anim),
    /** fn(bearing, source) whenever the map turns. */
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    /** fn() when a two-finger twist by hand starts turning the map. */
    onHandTurn: (fn) => { handListeners.add(fn); return () => handListeners.delete(fn); },
    /** Two fingers turning the map by hand. Does nothing on a device without touch. */
    enableTouchTurn() {
      const angle = (ts) => (Math.atan2(ts[1].clientY - ts[0].clientY, ts[1].clientX - ts[0].clientX) * 180) / Math.PI;
      container.addEventListener('touchstart', (e) => { twist = e.touches.length === 2 ? { a0: angle(e.touches), b0: bearing, on: false, skip: 0 } : null; }, { passive: true, capture: true });
      container.addEventListener('touchmove', (e) => {
        if (!twist || e.touches.length !== 2) return;
        const d = norm180(angle(e.touches) - twist.a0);
        if (!twist.on) {
          if (Math.abs(d) < TURN_AWAY_DEG) return;
          twist.on = true; twist.skip = Math.sign(d) * TURN_AWAY_DEG; // start from where the twist has got to, not with a jump
          ctl.cancelAnimation();
          handListeners.forEach((fn) => fn());
        }
        ctl.set(twist.b0 - (d - twist.skip), 'hand'); // fingers turning clockwise turn the map clockwise, so the compass direction at the top goes down
      }, { passive: true, capture: true });
      const end = (e) => { if (e.touches.length < 2) twist = null; };
      container.addEventListener('touchend', end, { passive: true, capture: true });
      container.addEventListener('touchcancel', end, { passive: true, capture: true });
    },
  };
  container._rot = map._rot = ctl;
  return ctl;
}
