// The adaptive marker host (Review 01 S4, MD-01 to MD-06): the marker window's content in a non-modal bottom sheet (little room) or side panel (room beside it),
// outside the Leaflet container, no scrim, the map stays operable. DEVELOPMENT SWITCH ONLY: poi-ui.js opens it instead of the popup when `markerHostEnabled()` is true,
// which is never the case in a production build. Lifecycle parity, recentring, gestures and actions are later steps (S5 to S8); see the backlog.
import { el } from './cards.js';
import { dockMode } from './free-area.js';
import { announce, onOverlay } from './overlay-policy.js';

const MAP_MIN = 320, MAP_MIN_H = 200, GAP = 8, PANEL_GAP = 12;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const KEY = 'uavzones.dev.markerhost';

/** True only on a development server, and only when asked for with `?markerhost=1` or `localStorage['uavzones.dev.markerhost'] = '1'`. A production build makes this a constant false. */
export function markerHostEnabled() {
  if (!import.meta.env.DEV) return false;
  try { return /[?&]markerhost=1\b/.test(location.search) || localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Width of the side panel for a viewport `w`: about 37% on a desktop (420 to 480 px), about 47% on an unfolded foldable (340 to 480 px). */
export const hostWidth = (w) => (w >= 1000 ? clamp(Math.round(w * 0.37), 420, 480) : clamp(Math.round(w * 0.47), 340, 480));

/**
 * { map, panel, build(id, edit, host) -> element, getExpanded(), onOpen(id), onClose(id), returnFocusTo(id) -> element | null, toggleSize() }
 * -> { open(id, { edit }), close(), isOpen(), id(), mode(), layout(), el }.
 */
export function createMarkerHost({ map, panel, build, getExpanded, onOpen, onClose, returnFocusTo, toggleSize }) {
  let isOpen = false, openId = null, mode = 'side', token = 0, raf = 0, opener = null, restorePanel = null, offUnsub = null;

  const root = el('aside', 'marker-host'); root.hidden = true; root.id = 'marker-host'; root.setAttribute('role', 'region'); root.tabIndex = -1;
  const handle = el('button', 'mh-handle'); handle.type = 'button'; handle.setAttribute('aria-label', 'Change the size of the marker sheet'); handle.append(el('span', 'mh-grip'));
  const body = el('div', 'mh-body');
  root.append(handle, body); document.body.append(root);
  handle.addEventListener('click', () => toggleSize?.());

  const panelEl = () => document.getElementById('panel');
  const panelShown = () => { const p = panelEl(); return !!p && !p.hidden && !!panel?.isOpen?.(); };

  function layout() {
    if (!isOpen) return;
    const w = innerWidth, vh = window.visualViewport?.height || innerHeight, c = map.getContainer().getBoundingClientRect();
    const dw = hostWidth(w);
    mode = dockMode(w, dw, MAP_MIN); root.dataset.mode = mode; document.body.dataset.mh = mode;
    const rs = document.documentElement.style;
    if (mode === 'side') {
      // the side panel stays beside it while the map keeps at least MAP_MIN px; below that it steps aside for as long as the marker panel is open (the saved choice is not touched)
      let right = GAP;
      if (panelShown()) {
        const pw = panelEl().offsetWidth + PANEL_GAP;
        if (c.width - dw - pw - GAP < MAP_MIN || c.height < MAP_MIN_H) restorePanel ??= panel.suspend?.() ?? null; else right = GAP + pw;
      }
      root.style.setProperty('--mh-w', dw + 'px'); root.style.setProperty('--mh-right', right + 'px');
      rs.setProperty('--mh-off', dw + right + GAP + 'px'); rs.setProperty('--mh-h', '0px');
    } else {
      const expandedH = Math.floor(map.getSize().y * 0.6); // the existing phone limit: 60% of the map, so the map stays reachable
      const compactH = Math.min(expandedH, Math.max(180, Math.round(0.36 * vh)));
      const h = getExpanded?.() ? expandedH : compactH;
      root.style.setProperty('--mh-h', h + 'px'); rs.setProperty('--mh-off', h + GAP + 'px'); rs.setProperty('--mh-w', '0px');
    }
    root.dataset.expanded = String(!!getExpanded?.());
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; layout(); }); };

  function open(id, { edit = false } = {}) {
    const mine = ++token;
    if (!isOpen) {
      opener = document.activeElement && document.activeElement !== document.body && !root.contains(document.activeElement) ? document.activeElement : null;
      isOpen = true;
      announce('marker', 'open'); // the Sessions explorer parks itself (U-04)
      addEventListener('resize', schedule); addEventListener('orientationchange', schedule); map.on('resize', schedule); window.visualViewport?.addEventListener('resize', schedule);
      document.addEventListener('keydown', onKey); map.on('popupopen', onPopup);
      offUnsub = onOverlay((owner, phase) => { if (owner === 'explorer' && phase === 'open') close({ keepFocus: true }); });
    }
    openId = id;
    const host = { close: () => close(), closeSelf: () => { if (mine === token) close(); }, update: () => schedule() };
    body.replaceChildren(build(id, edit, host));
    root.hidden = false;
    const h = body.querySelector('h3');
    if (h) { h.id = 'mh-title'; h.tabIndex = -1; root.setAttribute('aria-labelledby', 'mh-title'); } else { root.removeAttribute('aria-labelledby'); root.setAttribute('aria-label', 'Marker'); }
    layout();
    onOpen?.(id);
    (h ?? body.querySelector('input'))?.focus({ preventScroll: true });
  }

  const onPopup = () => close({ keepFocus: true }); // a point check or a live pin opens a popup: the marker panel gives way, as the popup did

  function close({ keepFocus = false } = {}) {
    if (!isOpen) return;
    const id = openId;
    isOpen = false; openId = null; token++; cancelAnimationFrame(raf); raf = 0;
    root.hidden = true; body.replaceChildren(); root.removeAttribute('aria-labelledby');
    delete document.body.dataset.mh; for (const v of ['--mh-off', '--mh-h']) document.documentElement.style.removeProperty(v);
    removeEventListener('resize', schedule); removeEventListener('orientationchange', schedule); map.off('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule);
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
