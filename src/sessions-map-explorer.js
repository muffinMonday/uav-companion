// The Sessions map explorer: a non-modal dock beside the map (a left panel on a wide screen, a bottom sheet on a narrow one) that lists sessions as compact cards
// while the Leaflet map stays interactive. Tapping a card selects that occurrence and puts its marker in the middle of the part of the map the dock does not cover.
// The hub (sessions-hub.js) owns the data: this module only draws what `getItems()` returns and never keeps a second copy that could outlive a sign-out.
// Plain DOM, textContent only (titles and places are untrusted text). Spec and decisions: Project_context/docs/FLIGHT_SESSIONS_MAP_EXPLORER.md.
import L from 'leaflet';
import { whenText, capacityText, seriesText } from './sessions.js';
import { sessionMapActions, hasPoint } from './maplinks-ui.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DOCK_MIN = 300, DOCK_MAX = 360, MAP_MIN = 320, FIRST_ZOOM = 14, GAP = 8;
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const svg = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; // paths are constants
const I_CLOSE = svg('M6 6l12 12M18 6L6 18'), I_FOLD = svg('M6 9l6 6 6-6'), I_OUT = svg('M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7');

/**
 * { map, panel, getItems, onDetails, onExpand, onClose } -> { open({ focusId }), update(), close(), isOpen(), selected(), layout() }.
 * getItems() returns the sessions to show (the hub's current list; sessions with `lat`/`lng`); onDetails(session), onExpand() and onClose() are the three exits.
 */
export function createExplorer({ map, panel, getItems, onDetails, onExpand, onClose }) {
  let isOpen = false, collapsed = false, mode = 'side', selectedId = null, items = [], sig = '', token = 0, zoomed = false, userMoved = false, raf = 0, restorePanel = null, layer = null, markers = new Map();

  // ---- the dock
  const dock = el('aside', 'ses-explorer'); dock.hidden = true; dock.id = 'ses-explorer'; dock.setAttribute('role', 'region'); dock.setAttribute('aria-labelledby', 'ses-x-title');
  const head = el('header', 'ses-x-head'); const title = el('h2', 'ses-x-title', 'Sessions on the map'); title.id = 'ses-x-title'; title.tabIndex = -1;
  const count = el('small', 'ses-x-count'); const tools = el('div', 'ses-x-tools');
  const tool = (id, label, icon) => { const b = el('button', 'icon-btn'); b.type = 'button'; b.id = id; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = icon; return b; };
  const expandB = tool('ses-x-expand', 'Expand: back to the full sessions list', I_OUT), foldB = tool('ses-x-fold', 'Collapse the list', I_FOLD), closeB = tool('ses-x-close', 'Close the map view', I_CLOSE);
  tools.append(expandB, foldB, closeB); head.append(el('div', 'ses-x-titles'), tools); head.firstChild.append(title, count);
  const body = el('div', 'ses-x-body'); const list = el('ul', 'ses-x-list'); list.setAttribute('aria-label', 'Sessions'); body.append(list);
  dock.append(head, body); document.body.append(dock);

  expandB.addEventListener('click', () => onExpand?.());
  closeB.addEventListener('click', () => onClose?.());
  foldB.addEventListener('click', () => { collapsed = !collapsed; paintFold(); layout({ recenter: true }); });
  const paintFold = () => {
    dock.dataset.collapsed = String(collapsed); foldB.setAttribute('aria-expanded', String(!collapsed));
    const t = collapsed ? 'Show the list' : 'Collapse the list'; foldB.title = t; foldB.setAttribute('aria-label', t); body.hidden = collapsed;
  };
  const onKey = (e) => { if (e.key === 'Escape' && isOpen && !e.defaultPrevented && !document.querySelector('dialog[open]') && !map.getContainer().querySelector('.leaflet-popup')) { e.preventDefault(); onClose?.(); } };

  // ---- geometry: the part of the map the dock and the side panel do not cover
  const rectOf = (e) => e.getBoundingClientRect();
  /** `r` minus an overlay `o` that sits along one edge: a bar over most of the height trims left or right, one over most of the width trims top or bottom. */
  function cut(r, o) {
    if (o.width <= 0 || o.height <= 0 || o.right <= r.left || o.left >= r.right || o.bottom <= r.top || o.top >= r.bottom) return r;
    const out = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    if (o.height >= 0.7 * (r.bottom - r.top) && o.width < 0.85 * (r.right - r.left)) { if ((o.left + o.right) / 2 < (r.left + r.right) / 2) out.left = Math.max(out.left, o.right); else out.right = Math.min(out.right, o.left); }
    else if (o.width >= 0.7 * (r.right - r.left)) { if ((o.top + o.bottom) / 2 > (r.top + r.bottom) / 2) out.bottom = Math.min(out.bottom, o.top); else out.top = Math.max(out.top, o.bottom); }
    return out;
  }
  function visibleRect() {
    let r = rectOf(map.getContainer());
    r = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    const covers = [dock, document.getElementById('panel')].filter((e) => e && !e.hidden);
    for (const e of covers) { if (e === dock && collapsed && mode === 'side') continue; r = cut(r, rectOf(e)); }
    return r;
  }
  /** The middle of the visible part, in the map container's own pixels. */
  function visibleCenter() {
    const v = visibleRect(), c = rectOf(map.getContainer());
    return L.point((v.left + v.right) / 2 - c.left, (v.top + v.bottom) / 2 - c.top);
  }
  const bearing = () => (map._rot?.bearing?.() ?? 0) * Math.PI / 180;

  /** Pans (and, the first time, zooms) so the marker of `s` ends up at the middle of the visible part. Rotation-aware: the map pane is turned about the container's centre. */
  function centerOn(s, { keepZoom = false, animate = !reduced() } = {}) {
    const my = ++token;
    userMoved = false; // an explicit selection starts from the person's hands off the map
    if (map._animatingZoom) { map.once('zoomend', () => { if (my === token && !userMoved) centerOn(s, { keepZoom, animate }); }); return; } // Leaflet ignores a zoom asked for during a zoom animation
    const ll = L.latLng(s.lat, s.lng);
    let z = map.getZoom();
    if (!keepZoom && !zoomed) { z = Math.max(z, FIRST_ZOOM); zoomed = true; }
    const c = map.getSize().divideBy(2), t = visibleCenter().subtract(c), b = bearing();
    const d = L.point(t.x * Math.cos(b) - t.y * Math.sin(b), t.x * Math.sin(b) + t.y * Math.cos(b)); // the same offset in the map's own (unturned) pixels
    map.setView(map.unproject(map.project(ll, z).subtract(d), z), z, { animate, duration: 0.35 });
  }

  // ---- docking: which side, how big, and the room it leaves
  function layout({ recenter = false } = {}) {
    if (!isOpen) return;
    const w = innerWidth, vh = window.visualViewport?.height || innerHeight;
    const dw = clamp(Math.round(w * 0.36), DOCK_MIN, DOCK_MAX);
    const next = w - dw >= MAP_MIN ? 'side' : 'bottom';
    mode = next; dock.dataset.mode = mode; document.body.dataset.sesx = mode;
    const root = document.documentElement.style;
    if (mode === 'side') { root.setProperty('--ses-x-w', dw + 'px'); root.setProperty('--ses-x-off', dw + GAP + 'px'); root.setProperty('--ses-x-h', '0px'); }
    else { const h = Math.round(Math.min(0.4 * vh, Math.max(180, 0.36 * vh))); root.setProperty('--ses-x-h', h + 'px'); root.setProperty('--ses-x-off', (collapsed ? 56 : h) + GAP + 'px'); root.setProperty('--ses-x-w', '0px'); }
    // the right-hand panel stays unless it would leave the map too little room: then it steps aside for as long as the explorer is open (the saved choice is not touched)
    const panelEl = document.getElementById('panel');
    if (!restorePanel && panel?.isOpen?.() && panelEl && !panelEl.hidden) { const v = visibleRect(); if (v.right - v.left < MAP_MIN || v.bottom - v.top < 200) restorePanel = panel.suspend?.() ?? null; }
    if (recenter && selectedId && !userMoved) { const s = items.find((x) => x.id === selectedId); if (s && hasPoint(s.lat, s.lng)) centerOn(s, { keepZoom: true, animate: false }); }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; layout({ recenter: true }); }); };
  const touched = () => { userMoved = true; }; // the visitor moved the map by hand: leave it where they put it until the next selection

  // ---- the cards and the markers
  const keyOf = (s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
  const label = (s) => `${s.title}, ${whenText(s.startsAt, s.endsAt)}`;
  function card(s) {
    const li = el('li', 'ses-xcard'); li.dataset.id = s.id;
    const sel = el('button', 'ses-xsel'); sel.type = 'button';
    const top = el('span', 'ses-xtop'); top.append(el('b', 'ses-xtitle', s.title), el('span', 'badge', s.visibility === 'public' ? 'Public' : 'Private'));
    sel.append(top, el('span', 'ses-xwhen', whenText(s.startsAt, s.endsAt)));
    if (s.location) sel.append(el('span', 'ses-xplace', s.location));
    sel.append(el('span', 'ses-xmeta', [seriesText(s), capacityText(s)].filter(Boolean).join(' · ')));
    const acts = el('div', 'ses-xactions');
    acts.append(sessionMapActions({ lat: s.lat, lng: s.lng, title: s.title }));
    const d = el('button', 'btn small ses-xdetails', 'Details'); d.type = 'button'; d.dataset.act = 'details'; d.setAttribute('aria-label', `Details: ${s.title}`);
    d.addEventListener('click', (e) => { e.stopPropagation(); onDetails?.(s); });
    acts.append(d);
    li.append(sel, acts);
    li.addEventListener('click', (e) => { if (!e.target.closest('.ses-xactions')) select(s.id); }); // the buttons and links in the action row never select the card
    return li;
  }
  function paintSelection() {
    for (const li of list.children) { const on = li.dataset.id === selectedId; li.classList.toggle('selected', on); li.dataset.selected = String(on); const b = li.querySelector('.ses-xsel'); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
    for (const { ids, marker } of markers.values()) {
      const e = marker.getElement(); if (!e) continue;
      const on = ids.includes(selectedId); e.classList.toggle('sel', on); marker.setZIndexOffset(on ? 1000 : 200);
      const s = items.find((x) => x.id === (on ? selectedId : ids[0]));
      if (s) { e.title = label(s); e.setAttribute('alt', label(s)); e.dataset.id = s.id; }
    }
  }
  function drawMarkers() {
    layer?.remove(); layer = L.layerGroup().addTo(map); markers = new Map();
    const groups = new Map();
    for (const s of items) if (hasPoint(s.lat, s.lng)) { const k = keyOf(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    for (const [k, g] of groups) {
      const first = g[0], ids = g.map((x) => x.id);
      const html = '<span>✈</span>' + (g.length > 1 ? `<i class="ses-pin-n">${g.length}</i>` : '');
      const marker = L.marker([first.lat, first.lng], { icon: L.divIcon({ className: 'ses-map-pin', html, iconSize: [30, 30], iconAnchor: [15, 15] }), title: label(first), alt: label(first), keyboard: true, zIndexOffset: 200 });
      marker.on('click', () => { const at = ids.indexOf(selectedId); select(ids[(at + 1) % ids.length]); }); // a place with several occurrences: each tap moves to the next one
      marker.addTo(layer); markers.set(k, { ids, marker });
    }
  }
  function render() {
    const st = body.scrollTop, had = document.activeElement?.closest?.('.ses-xcard')?.dataset.id;
    list.replaceChildren(...items.map(card));
    if (!items.length) { const li = el('li', 'ses-xempty hint', 'No sessions to show on the map.'); list.append(li); }
    count.textContent = items.length ? ` · ${items.length}` : '';
    drawMarkers(); paintSelection(); body.scrollTop = st;
    if (had && document.activeElement === document.body) list.querySelector(`[data-id="${CSS.escape(had)}"] .ses-xsel`)?.focus({ preventScroll: true });
  }

  /** The card is marked, the marker is marked and the map moves; the latest selection wins (a new one stops the animation of the one before). */
  function select(id) {
    const s = items.find((x) => x.id === id); if (!s) return;
    selectedId = id; paintSelection();
    list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    if (hasPoint(s.lat, s.lng)) centerOn(s);
  }
  /** Redraws from the hub's current data (after a load, a filter, a sign-out). Nothing is kept that the hub no longer lists. */
  function update() {
    if (!isOpen) return;
    items = getItems().filter((s) => s && typeof s.id === 'string' && typeof s.title === 'string');
    const next = items.map((s) => [s.id, s.title, s.startsAt, s.endsAt, s.location, s.lat, s.lng, s.visibility, s.capacity, s.rsvpCount, s.status].join('|')).join('\n');
    if (selectedId && !items.some((s) => s.id === selectedId)) selectedId = null;
    if (next === sig) return;
    sig = next; render();
  }

  function open({ focusId = null } = {}) {
    if (isOpen) { update(); if (focusId) select(focusId); return; }
    isOpen = true; collapsed = false; zoomed = false; userMoved = false; sig = ''; selectedId = null;
    dock.hidden = false; paintFold(); items = []; update(); layout();
    const c = map.getContainer();
    for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown']) c.addEventListener(ev, touched, { passive: true, capture: true });
    addEventListener('resize', schedule); addEventListener('orientationchange', schedule); map.on('resize', schedule); window.visualViewport?.addEventListener('resize', schedule); document.addEventListener('keydown', onKey);
    if (focusId) select(focusId); // layout() has already given the dock its size
    title.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; token++; cancelAnimationFrame(raf); raf = 0;
    layer?.remove(); layer = null; markers = new Map(); list.replaceChildren(); items = []; sig = ''; selectedId = null;
    dock.hidden = true; delete document.body.dataset.sesx; for (const v of ['--ses-x-w', '--ses-x-h', '--ses-x-off']) document.documentElement.style.removeProperty(v);
    const c = map.getContainer(); for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown']) c.removeEventListener(ev, touched, { capture: true });
    removeEventListener('resize', schedule); removeEventListener('orientationchange', schedule); map.off('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule); document.removeEventListener('keydown', onKey);
    const r = restorePanel; restorePanel = null; r?.();
  }

  return { open, close, update, layout, isOpen: () => isOpen, selected: () => selectedId, mode: () => mode, el: dock };
}
