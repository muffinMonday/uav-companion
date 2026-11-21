// The adaptive marker host (Review 01 S4 and S5, MD-01 to MD-12): the marker window's content in a non-modal bottom sheet (little room) or side panel (room beside it),
// outside the Leaflet container, no scrim, the map stays operable. DEVELOPMENT SWITCH ONLY: poi-ui.js opens it instead of the popup when `markerHostEnabled()` is true,
// which is never the case in a production build. The lifecycle (open, close, replace) is this file's small interface; poi-ui.js routes every "close the window" through it.
// Recentring uses the shared free-area service (src/free-area.js); the pop-up path keeps view.js centreOn (DEF-S2-01).
import { el } from './cards.js';
import { createFreeArea, dockMode } from './free-area.js';
import { announce, onOverlay } from './overlay-policy.js';

const MAP_MIN = 320, MAP_MIN_H = 200, GAP = 8, PANEL_GAP = 12, DRAG_START = 8, DRAG_STEP = 40;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const KEY = 'uavzones.dev.markerhost';
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** True only on a development server, and only when asked for with `?markerhost=1` or `localStorage['uavzones.dev.markerhost'] = '1'`. A production build makes this a constant false. */
export function markerHostEnabled() {
  if (!import.meta.env.DEV) return false;
  try { return /[?&]markerhost=1\b/.test(location.search) || localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Width of the side panel for a viewport `w`: about 37% on a desktop (420 to 480 px), about 47% on an unfolded foldable (340 to 480 px). */
export const hostWidth = (w) => (w >= 1000 ? clamp(Math.round(w * 0.37), 420, 480) : clamp(Math.round(w * 0.47), 340, 480));

/** Pixels the on-screen keyboard takes from the bottom of the layout viewport (0 when there is none, or a small browser bar). Pure; `vv` is a VisualViewport-like { height, offsetTop }. */
export const keyboardInset = (innerH, vv) => { const k = vv ? Math.round(innerH - vv.height - (vv.offsetTop || 0)) : 0; return k >= 80 ? k : 0; };

/**
 * { map, panel, build(id, edit, host) -> element, getExpanded(), setExpanded(on), latlngOf(id), onOpen(id), onClose(id), returnFocusTo(id) -> element | null }
 * -> { open(id, { edit }), close(), isOpen(), id(), mode(), layout(), el }.
 * host (given to `build`) = { close(), closeSelf(), update(), verticalSwipe: false, actions: 'panel' } (actions: 'panel' = the action layout of marker-actions.js).
 */
export function createMarkerHost({ map, panel, build, getExpanded, setExpanded, latlngOf, onOpen, onClose, returnFocusTo }) {
  let isOpen = false, openId = null, mode = 'side', token = 0, raf = 0, opener = null, restorePanel = null, offUnsub = null, userMoved = false, drag = null;

  const root = el('aside', 'marker-host'); root.hidden = true; root.id = 'marker-host'; root.setAttribute('role', 'region'); root.tabIndex = -1;
  const handle = el('button', 'mh-handle'); handle.type = 'button'; handle.setAttribute('aria-label', 'Change the size of the marker sheet'); handle.append(el('span', 'mh-grip'));
  const body = el('div', 'mh-body');
  root.append(handle, body); document.body.append(root);
  handle.addEventListener('click', () => setExpanded?.(!getExpanded?.()));
  handle.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setExpanded?.(e.key === 'ArrowUp'); } });
  root.addEventListener('focusin', (e) => { if (mode === 'bottom' && e.target.matches?.('input,select,textarea')) setTimeout(() => e.target.scrollIntoView?.({ block: 'nearest' }), 60); });

  // ---- the free part of the map: the container minus this host, the open side panel and an open explorer dock
  const area = createFreeArea(map, () => [root, document.getElementById('panel'), document.getElementById('ses-explorer')]);
  function recentre({ animate = true } = {}) {
    const ll = openId != null ? latlngOf?.(openId) : null;
    if (!ll) return;
    const my = token;
    if (map._animatingZoom) { map.once('zoomend', () => { if (my === token && isOpen && !userMoved) recentre({ animate }); }); return; } // Leaflet ignores a view change asked for during a zoom animation
    area.centerOn(ll, { animate: animate && !reduced() }); // keeps the zoom; rotation-aware
  }
  const touched = () => { userMoved = true; }; // the visitor moved the map by hand: leave it until the next explicit selection

  const panelEl = () => document.getElementById('panel');
  const panelShown = () => { const p = panelEl(); return !!p && !p.hidden && !!panel?.isOpen?.(); };
  const vv = () => window.visualViewport;
  const sizes = () => {
    const vh = vv()?.height || innerHeight;
    const expandedH = Math.min(Math.floor(map.getSize().y * 0.6), Math.floor(vh - 16)); // the existing phone limit: 60% of the map, so the map stays reachable
    return { expandedH, compactH: Math.min(expandedH, Math.max(180, Math.round(0.36 * vh))) };
  };

  function place() {
    if (!isOpen) return;
    const w = innerWidth, c = map.getContainer().getBoundingClientRect(), dw = hostWidth(w);
    mode = dockMode(w, dw, MAP_MIN); root.dataset.mode = mode; document.body.dataset.mh = mode;
    const rs = document.documentElement.style;
    if (mode === 'side') {
      // the side panel stays beside it while the map keeps at least MAP_MIN px; below that it steps aside for as long as the marker panel is open (the saved choice is not touched)
      let right = GAP;
      if (panelShown()) {
        const pw = panelEl().offsetWidth + PANEL_GAP;
        if (c.width - dw - pw - GAP < MAP_MIN || c.height < MAP_MIN_H) restorePanel ??= panel.suspend?.() ?? null; else right = GAP + pw;
      }
      root.style.setProperty('--mh-w', dw + 'px'); root.style.setProperty('--mh-right', right + 'px'); root.style.setProperty('--mh-kb', '0px');
      rs.setProperty('--mh-off', dw + right + GAP + 'px'); rs.setProperty('--mh-h', '0px');
    } else {
      const { expandedH, compactH } = sizes(), kb = keyboardInset(innerHeight, vv());
      const h = getExpanded?.() ? expandedH : compactH;
      root.style.setProperty('--mh-h', h + 'px'); root.style.setProperty('--mh-kb', kb + 'px'); root.style.setProperty('--mh-w', '0px');
      rs.setProperty('--mh-off', h + kb + GAP + 'px');
    }
    root.dataset.expanded = String(!!getExpanded?.());
  }
  /** Places the host again and, unless the visitor has moved the map since the last selection, keeps the marker in the middle of what is left free. */
  function layout() { place(); if (isOpen && !userMoved) recentre({ animate: false }); }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; layout(); }); };

  // ---- the sheet's own gesture: drag the handle or the top bar up (expand), down (collapse; from compact, close). The sheet is outside the map, so it never pans the map.
  root.addEventListener('pointerdown', (e) => {
    if (mode !== 'bottom' || (e.pointerType === 'mouse' && e.button > 0) || !e.target.closest('.mh-handle, .pop-bar')) return;
    drag = { id: e.pointerId, y0: e.clientY, h0: root.getBoundingClientRect().height, moved: false };
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) { if (Math.abs(dy) < DRAG_START) return; drag.moved = true; try { root.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ } root.classList.add('mh-dragging'); }
    const { expandedH, compactH } = sizes();
    root.style.setProperty('--mh-h', clamp(drag.h0 - dy, Math.round(compactH * 0.5), expandedH) + 'px');
    e.preventDefault();
  });
  const stray = (c) => { c.stopPropagation(); c.preventDefault(); };
  const endDrag = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag, dy = e.clientY - d.y0; drag = null;
    root.classList.remove('mh-dragging');
    if (!d.moved) return;
    root.addEventListener('click', stray, true); setTimeout(() => root.removeEventListener('click', stray, true), 60); // the release is not a tap on a button under the finger
    const was = !!getExpanded?.();
    if (!cancelled && dy <= -DRAG_STEP && !was) setExpanded?.(true);
    else if (!cancelled && dy >= DRAG_STEP && was) setExpanded?.(false);
    else if (!cancelled && dy >= DRAG_STEP && !was) { close(); return; }
    else layout(); // not far enough: back to the size it had
  };
  root.addEventListener('pointerup', (e) => endDrag(e, false));
  root.addEventListener('pointercancel', (e) => endDrag(e, true));

  // ---- the lifecycle: one open marker panel; opening another replaces it; the rest close it
  function open(id, { edit = false } = {}) {
    const mine = ++token;
    if (!isOpen) {
      opener = document.activeElement && document.activeElement !== document.body && !root.contains(document.activeElement) ? document.activeElement : null;
      isOpen = true;
      announce('marker', 'open'); // the Sessions explorer parks itself (U-04)
      addEventListener('resize', schedule); addEventListener('orientationchange', schedule); map.on('resize', schedule);
      vv()?.addEventListener('resize', schedule); vv()?.addEventListener('scroll', schedule);
      const c = map.getContainer(); for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown']) c.addEventListener(ev, touched, { passive: true, capture: true });
      document.addEventListener('keydown', onKey); map.on('popupopen', onPopup);
      offUnsub = onOverlay((owner, phase) => { if (owner === 'explorer' && phase === 'open') close({ keepFocus: true }); });
    }
    openId = id; userMoved = false; // an explicit selection starts from the person's hands off the map
    const host = { close: () => close(), closeSelf: () => { if (mine === token) close(); }, update: () => schedule(), verticalSwipe: false, actions: 'panel' };
    body.replaceChildren(build(id, edit, host));
    root.hidden = false;
    const h = body.querySelector('h3');
    if (h) { h.id = 'mh-title'; h.tabIndex = -1; root.setAttribute('aria-labelledby', 'mh-title'); } else { root.removeAttribute('aria-labelledby'); root.setAttribute('aria-label', 'Marker'); }
    place();
    recentre({ animate: true });
    onOpen?.(id);
    (h ?? body.querySelector('input'))?.focus({ preventScroll: true });
  }

  const onPopup = () => close({ keepFocus: true }); // a point check or a live pin opens a popup: the marker panel gives way, as the popup did

  function close({ keepFocus = false } = {}) {
    if (!isOpen) return;
    const id = openId;
    isOpen = false; openId = null; token++; cancelAnimationFrame(raf); raf = 0; drag = null;
    root.classList.remove('mh-dragging'); root.hidden = true; body.replaceChildren(); root.removeAttribute('aria-labelledby');
    delete document.body.dataset.mh; for (const v of ['--mh-off', '--mh-h']) document.documentElement.style.removeProperty(v);
    removeEventListener('resize', schedule); removeEventListener('orientationchange', schedule); map.off('resize', schedule);
    vv()?.removeEventListener('resize', schedule); vv()?.removeEventListener('scroll', schedule);
    const c = map.getContainer(); for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown']) c.removeEventListener(ev, touched, { capture: true });
    document.removeEventListener('keydown', onKey); map.off('popupopen', onPopup);
    offUnsub?.(); offUnsub = null;
    const r = restorePanel; restorePanel = null; r?.();
    onClose?.(id);
    announce('marker', 'close'); // a parked explorer comes back
    if (!keepFocus) { const back = opener?.isConnected ? opener : returnFocusTo?.(id); back?.focus?.({ preventScroll: true }); }
    opener = null;
  }

  // Escape closes the panel unless a dialog is open (the dialog takes the key)
  function onKey(e) { if (e.key === 'Escape' && isOpen && !e.defaultPrevented && !document.querySelector('dialog[open]')) { e.preventDefault(); close(); } }

  return { open, close, isOpen: () => isOpen, id: () => openId, mode: () => mode, layout, el: root };
}
