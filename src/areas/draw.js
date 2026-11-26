// Community flying areas, Phase 1: the drawing session on the map. Rules live in editor.js; this file turns map events into calls on it and paints the result.
//   - Taps/clicks add points; dragging a handle moves it (Leaflet's marker drag, which maprotate.js already makes right for a turned map); a midpoint handle adds a point.
//   - While a session is open, isBusy() is true: holdcheck.js and inspect.js are given it, so a press-and-hold or right-click never starts a point check mid-drawing,
//     and main.js ignores the map click. Panning, pinch zoom and two-finger rotation are untouched (a drag or pinch never raises 'click').
//   - Double-tap zoom is switched off for the session (it would add two points and zoom); it comes back when the session ends.
//   - Every action also has a button (Add point at map centre, Delete point, Undo) so nothing needs a precise tap, and the bar is the keyboard route.
import L from 'leaflet';
import { createEditor } from './editor.js';
import { AREA_STYLE, ensurePanes, spotIcon, spotPopup } from './layer.js';
import { SPOT_TYPES, SPOT_LABELS, MAX_SPOTS, formatArea, rectangleFromCorners } from './core.js';
import { el } from '../cards.js';
import { openDetails } from './form.js';

const ll = (p) => [p[1], p[0]];                                 // [lng, lat] -> Leaflet [lat, lng]
const pos = (latlng) => { const w = latlng.wrap(); return [w.lng, w.lat]; };
const handleIcon = (cls) => L.divIcon({ className: `area-vtx ${cls}`, html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 15] });

export function createDrawController({ map, store, layer, toast, isBusy = () => false, onEnd = () => {} }) {
  ensurePanes(map);
  const container = map.getContainer();
  let ed = null, editingId = null, mode = 'shape', selVertex = null, spotType = 'open', confirming = false, dbl = false;
  const group = L.layerGroup();
  let shape = null, hint = '';

  // ---- the bar ----
  const bar = el('div', 'area-bar'); bar.hidden = true; bar.id = 'area-bar';
  bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Draw a flying area');
  const title = el('strong', 'area-bar-title'), status = el('div', 'area-bar-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const modes = el('div', 'area-bar-row area-modes'), tools = el('div', 'area-bar-row'), spotRow = el('div', 'area-bar-row area-spotrow');
  bar.append(title, status, modes, spotRow, tools);
  L.DomEvent.disableClickPropagation(bar); L.DomEvent.disableScrollPropagation(bar);
  document.body.append(bar);
  const btn = (label, fn, { cls = 'btn', id = '', disabled = false, pressed = null } = {}) => {
    const b = el('button', cls, label); b.type = 'button'; if (id) b.dataset.act = id; b.disabled = disabled;
    if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', fn); return b;
  };

  const say = (t) => { hint = t || ''; paintBar(); };
  const afterEdit = (r) => { if (!r.ok) say(r.message); else hint = ''; paint(); };

  function paintBar() {
    if (!ed) return;
    const closed = ed.closed, check = ed.check(), n = ed.vertices.length;
    title.textContent = editingId ? `Editing “${ed.name || 'area'}”` : ed.kind === 'rectangle' ? 'Drawing a rectangle' : 'Drawing a polygon';
    let msg;
    if (confirming) msg = 'Discard this drawing? Nothing has been saved yet.';
    else if (hint) msg = hint;
    else if (!closed && ed.kind === 'rectangle') msg = n === 0 ? 'Tap the map for one corner.' : 'Tap the opposite corner.';
    else if (!closed) msg = n < 3 ? `Tap the map to add points (${n} of at least 3).` : check.ok ? `${n} points, ${formatArea(check.areaM2)}. Keep tapping, or press Finish.` : check.errors[0].message;
    else if (!check.ok) msg = check.errors[0].message;
    else if (mode === 'spots') msg = `Tap inside the area to add a setup spot (${ed.spots.length} of ${MAX_SPOTS}). Drag a spot to move it.`;
    else msg = `${formatArea(check.areaM2)}. Drag a point to move it${ed.kind === 'polygon' ? '; the small handles add points' : ''}.`;
    status.textContent = msg;
    status.classList.toggle('bad', !confirming && (!!hint || (n >= 3 && !check.ok)));
    modes.replaceChildren(); spotRow.replaceChildren(); tools.replaceChildren();
    modes.hidden = !closed || confirming; spotRow.hidden = !(closed && mode === 'spots') || confirming;
    if (confirming) {
      tools.append(btn('Discard', () => end(), { cls: 'btn primary', id: 'discard' }), btn('Keep editing', () => { confirming = false; paintBar(); }, { id: 'keep' }));
      return;
    }
    if (closed) {
      modes.append(btn('Outline', () => { mode = 'shape'; paint(); }, { id: 'mode-shape', pressed: mode === 'shape' }), btn('Setup spots', () => { mode = 'spots'; selVertex = null; paint(); }, { id: 'mode-spots', pressed: mode === 'spots' }));
      const sel = el('select', 'area-spot-type'); sel.setAttribute('aria-label', 'Setup spot type');
      for (const t of SPOT_TYPES) { const o = el('option', '', SPOT_LABELS[t]); o.value = t; sel.append(o); }
      sel.value = spotType; sel.addEventListener('change', () => { spotType = sel.value; });
      spotRow.append(sel, btn('Add at map centre', () => afterEdit(addSpotAt(map.getCenter())), { id: 'spot-centre' }));
    }
    tools.append(btn('Undo', () => { if (ed.undo()) { selVertex = null; hint = ''; paint(); } }, { id: 'undo', disabled: !ed.canUndo }));
    if (!closed && ed.kind === 'polygon') {
      tools.append(btn('Add point at map centre', () => afterEdit(ed.addVertex(pos(map.getCenter()))), { id: 'centre' }), btn('Finish', () => { const r = ed.finish(); if (r.ok) { mode = 'shape'; hint = ''; paint(); } else say(r.message); }, { cls: 'btn primary', id: 'finish', disabled: n < 3 || !check.ok }));
    } else if (!closed) {
      tools.append(btn('Add corner at map centre', () => afterEdit(ed.addVertex(pos(map.getCenter()))), { id: 'centre' }));
    }
    if (closed && mode === 'shape' && ed.kind === 'polygon') tools.append(btn('Delete point', () => removeSelected(), { id: 'delete', disabled: selVertex === null }));
    if (closed) tools.append(btn('Details and save…', () => details(), { cls: 'btn primary', id: 'details' }));
    tools.append(btn('Cancel', () => requestCancel(), { id: 'cancel' }));
  }

  // ---- the map ----
  function addSpotAt(latlng) {
    if (!ed?.closed || mode !== 'spots') return { ok: false, message: 'Switch to Setup spots first.' };
    return ed.addSpot(pos(latlng), spotType);
  }
  function removeSelected() {
    if (selVertex === null) return;
    const r = ed.removeVertex(selVertex);
    if (r.ok) selVertex = null;
    afterEdit(r);
  }

  function paint() {
    group.clearLayers(); shape = null;
    if (!ed) return;
    const v = ed.vertices, check = ed.check();
    const bad = v.length >= 3 && !check.ok;
    const style = { ...AREA_STYLE, interactive: false, className: 'community-area is-draft' + (bad ? ' is-bad' : ''), weight: 3 };
    if (v.length >= 3) shape = L.polygon(v.map(ll), style).addTo(group);
    else if (v.length >= 1) shape = L.polyline(v.map(ll), { ...style, fill: false }).addTo(group);
    const showHandles = !ed.closed || mode === 'shape';
    if (showHandles) v.forEach((p, i) => {
      const m = L.marker(ll(p), { icon: handleIcon(i === selVertex ? 'sel' : ''), draggable: ed.closed || ed.kind === 'polygon', keyboard: true, title: `Point ${i + 1}`, alt: `Point ${i + 1}`, zIndexOffset: 800 }).addTo(group);
      m.on('click', () => { if (ed.closed) { selVertex = selVertex === i ? null : i; paint(); } });
      m.on('drag', (e) => preview(i, e.latlng));
      m.on('dragend', (e) => { const r = ed.moveVertex(i, pos(e.target.getLatLng())); selVertex = i; if (!r.ok) say(r.message); else hint = ''; paint(); });
      m.on('keydown', (e) => { const k = e.originalEvent.key; if ((k === 'Delete' || k === 'Backspace') && ed.closed) { e.originalEvent.preventDefault(); selVertex = i; removeSelected(); } });
    });
    if (showHandles && ed.closed && ed.kind === 'polygon' && v.length >= 3) v.forEach((p, i) => { // midpoint handles: drag or tap one to add a point there
      const q = v[(i + 1) % v.length], mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const m = L.marker(ll(mid), { icon: handleIcon('mid'), draggable: true, keyboard: false, zIndexOffset: 700 }).addTo(group);
      const add = (at) => { const r = ed.insertVertex(i, at); if (r.ok) { selVertex = i + 1; hint = ''; } else hint = r.message; paint(); };
      m.on('click', () => add(mid)); m.on('dragend', (e) => add(pos(e.target.getLatLng())));
    });
    const out = new Set(ed.outsideSpotIds());
    if (ed.closed) for (const s of ed.spots) {
      const m = L.marker(ll(s.coordinates), { icon: spotIcon(s.type, { out: out.has(s.id) }), draggable: mode === 'spots', keyboard: true, title: SPOT_LABELS[s.type], alt: SPOT_LABELS[s.type], zIndexOffset: 900 }).addTo(group);
      m.on('dragend', (e) => { const r = ed.moveSpot(s.id, pos(e.target.getLatLng())); if (!r.ok) say(r.message); else hint = ''; paint(); });
      m.on('click', () => { if (mode !== 'spots') { m.bindPopup(() => spotPopup(s, { name: ed.name || 'this area', areaM2: check.areaM2 }), { closeOnClick: false }).openPopup(); } });
    }
    paintBar();
  }
  /** Live shape while a handle is being dragged (the editor is only told at the end). */
  function preview(i, latlng) {
    if (!shape || !ed) return;
    const v = ed.vertices, p = [latlng.lng, latlng.lat];
    if (ed.kind === 'rectangle' && ed.closed) shape.setLatLngs(rectangleFromCorners(v[(i + 2) % 4], p).map(ll));
    else { v[i] = p; shape.setLatLngs(v.map(ll)); }
  }

  // A press held for the point-check time (or just over half a second) is a hold, not a tap: its release must not add a point.
  const TAP_MS = 600;
  let downAt = 0;
  const onDown = (e) => { if (e.isPrimary !== false) downAt = performance.now(); };
  const onMapClick = (e) => {
    if (!ed || confirming) return;
    if (downAt && performance.now() - downAt > TAP_MS) { downAt = 0; return; }
    if (e.originalEvent?.target?.closest?.('.area-vtx, .area-spot, .leaflet-popup')) return;
    if (ed.closed) {
      if (mode === 'spots') afterEdit(addSpotAt(e.latlng)); else if (selVertex !== null) { selVertex = null; paint(); }
      return;
    }
    afterEdit(ed.addVertex(pos(e.latlng)));
  };

  function details() {
    openDetails({ editor: ed, editingId, onChange: paint, onSave(draft) {
      const r = editingId ? store.update(editingId, draft) : store.add(draft);
      if (!r.ok) return r;
      ed.markSaved();
      const keep = r.area.id;
      end();
      layer.select(keep); layer.fit(keep);
      toast(store.status().persistent ? 'Saved privately in this browser. It is not shared.' : 'Saved for this visit only: this browser blocks saving. Export it to keep it.', 6000);
      return r;
    } });
  }

  function requestCancel() {
    if (!ed) return;
    if (ed.dirty && ed.vertices.length) { confirming = true; paintBar(); bar.querySelector('[data-act="discard"]')?.focus(); } else end();
  }

  const onKey = (e) => {
    if (!ed || e.key !== 'Escape' || document.querySelector('dialog.area-dialog[open]')) return;
    e.preventDefault(); e.stopPropagation();
    if (confirming) { confirming = false; paintBar(); } else requestCancel();
  };

  function start({ kind = 'polygon', areaId = null } = {}) {
    if (ed) return false;
    if (isBusy()) { toast('Finish placing or editing the marker first.'); return false; }
    const area = areaId ? store.get(areaId) : null;
    if (areaId && !area) return false;
    ed = createEditor(area ? { area } : { kind });
    editingId = area?.id ?? null; mode = 'shape'; selVertex = null; confirming = false; hint = '';
    dbl = map.doubleClickZoom.enabled(); map.doubleClickZoom.disable();
    container.classList.add('is-drawing');
    layer.hide(editingId);
    group.addTo(map);
    map.on('click', onMapClick);
    container.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    bar.hidden = false;
    if (area) map.fitBounds(L.latLngBounds(area.geometry.coordinates[0].map(ll)), { padding: [60, 60], maxZoom: 18 });
    paint();
    return true;
  }

  function end() {
    if (!ed) return;
    ed = null; editingId = null; confirming = false;
    map.off('click', onMapClick);
    container.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    group.clearLayers(); map.removeLayer(group);
    bar.hidden = true;
    container.classList.remove('is-drawing');
    if (dbl) map.doubleClickZoom.enable();
    layer.hide(null);
    document.querySelector('dialog.area-dialog[open]')?.close();
    onEnd();
  }

  return { start, cancel: () => end(), get active() { return !!ed; }, isBusy: () => !!ed, get editor() { return ed; } };
}
