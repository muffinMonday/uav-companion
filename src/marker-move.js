// Staged Move for the adaptive marker host (Review 01 S7, MD-F, C-12). Development switch only: the host's Move action starts it.
// The marker stays where it is while the map is panned under a crosshair; the staged position is the map centre, held in memory only.
// Nothing is stored, invalidated or synced until Save. Cancel (button or Escape) changes nothing. Save goes through `apply` (poi-ui.js applyMove: the same
// store update and weather / elevation invalidation the hold-to-drag does, so routes, distance lines and spidering follow the store as they do for a drag).
// Undo: only for a marker of this device alone (not a shared trip: an Undo there would be a second write that could overwrite a collaborator, deferred),
// kept in memory, valid while the marker is exactly as the move left it and for a short time.
import { el } from './cards.js';

export const UNDO_MS = 8000;
const same = (a, b) => Math.abs(a - b) < 1e-9;
/** The marker without its position: what must be unchanged for an Undo to be safe. */
const rest = (it) => { const { lat, lon, ...r } = it; return JSON.stringify(r); };

/**
 * deps = { map, panel, get(id) -> item | undefined, apply(id, lat, lon) -> { ok, item? }, isShared(item) -> boolean, closeWindow(), reopen(id), toast(text, ms, action) }
 * -> { start(id), cancel(), isActive(), undoable() -> id | null }
 */
export function createMarkerMove({ map, panel, get, apply, isShared, closeWindow, reopen, toast }) {
  let st = null; // { id, restore } while a move is staged
  let undo = null; // { id, prev: {lat, lon}, now: {lat, lon}, sig, timer }
  let cross = null, bar = null, text = null, coords = null;
  const container = map.getContainer();

  function build() {
    cross = el('div', 'mv-cross'); cross.setAttribute('aria-hidden', 'true');
    cross.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3v12M20 25v12M3 20h12M25 20h12"/><circle cx="20" cy="20" r="2.5"/></svg>'; // built from constants only
    bar = el('div', 'mv-bar'); bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Move marker'); bar.tabIndex = -1;
    text = el('div', 'mv-text'); coords = el('div', 'mv-coords');
    const row = el('div', 'mv-row');
    const cancel = el('button', 'btn mv-cancel', 'Cancel'); cancel.type = 'button';
    const save = el('button', 'btn primary mv-save', 'Save'); save.type = 'button';
    cancel.addEventListener('click', () => cancelMove());
    save.addEventListener('click', () => saveMove());
    row.append(cancel, save);
    bar.append(text, coords, row);
    container.append(cross); document.body.append(bar);
  }
  const centre = () => map.getCenter().wrap();
  const paint = () => { if (!st) return; const c = centre(); coords.textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`; };
  const onKey = (e) => { if (e.key === 'Escape' && st && !e.defaultPrevented) { e.preventDefault(); cancelMove(); } };

  function clearUndo() { if (undo) { clearTimeout(undo.timer); undo = null; } }

  function start(id) {
    const it = get(id);
    if (!it) return;
    if (st) end();
    clearUndo();
    closeWindow();
    if (!bar) build();
    st = { id, restore: panel?.suspend?.() ?? null }; // the side panel would hide part of the map under the crosshair
    text.textContent = `Move “${it.name}”: pan the map to put the crosshair where it belongs, then Save.`;
    map.setView([it.lat, it.lon], map.getZoom(), { animate: false });
    container.classList.add('is-moving'); cross.hidden = false; bar.hidden = false;
    map.on('move', paint); document.addEventListener('keydown', onKey);
    paint();
    bar.focus({ preventScroll: true });
  }

  function end() {
    if (!st) return null;
    const s = st; st = null;
    map.off('move', paint); document.removeEventListener('keydown', onKey);
    container.classList.remove('is-moving'); cross.hidden = true; bar.hidden = true;
    s.restore?.();
    return s;
  }

  const back = (id) => { reopen(id); setTimeout(() => document.querySelector('#marker-host .pop-move')?.focus({ preventScroll: true }), 0); };

  function cancelMove() {
    const s = end();
    if (s) back(s.id); // nothing was stored, so there is nothing to undo
  }

  function saveMove() {
    if (!st) return;
    const c = centre(), id = st.id, before = get(id);
    end();
    if (!before) { toast('That marker no longer exists, so nothing was moved.', 5000); return; }
    const r = apply(id, c.lat, c.lng);
    if (!r?.item) { toast('Could not move the marker.', 5000); return; }
    const msg = r.ok ? 'Marker moved.' : 'Moved for now, but the browser would not store it. Export your markers to keep them.';
    if (isShared(r.item)) toast(msg, 3500); // a shared trip's move is saved and synced by the existing mechanisms; no Undo (deferred)
    else {
      const u = undo = { id, prev: { lat: before.lat, lon: before.lon }, now: { lat: r.item.lat, lon: r.item.lon }, sig: rest(r.item), timer: setTimeout(() => { undo = null; }, UNDO_MS) };
      toast(msg, UNDO_MS, { label: 'Undo', run: () => runUndo(u) });
    }
    back(id);
  }

  function runUndo(u) { // the very offer that was shown: a button from an older message cannot undo a newer move
    const id = u.id;
    if (undo !== u) { toast('Undo is no longer available.', 4000); return; }
    clearUndo();
    const it = get(id);
    if (!it) { toast('The marker was deleted, so the move cannot be undone.', 5000); return; }
    if (isShared(it)) { toast('The marker is now in a shared trip, so the move was not undone.', 5000); return; }
    if (!same(it.lat, u.now.lat) || !same(it.lon, u.now.lon) || rest(it) !== u.sig) { toast('The marker has changed since it was moved, so the move was not undone.', 5000); return; }
    const r = apply(id, u.prev.lat, u.prev.lon);
    toast(r?.item ? 'Move undone.' : 'Could not undo the move.', 3000);
  }

  return { start, cancel: cancelMove, abort: () => { end(); },  isActive: () => !!st, undoable: () => undo?.id ?? null };
}
