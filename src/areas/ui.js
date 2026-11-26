// Community flying areas, Phase 1: the "My flying areas" panel (list, draw, import, export) and its map button. The button carries data-tool="areas", so the
// More tools menu folds it into a row like the other map tools (map-tool-labels.js). Everything is local: nothing is sent, nothing needs an account.
import L from 'leaflet';
import { el } from '../cards.js';
import { formatArea, SPOT_LABELS } from './core.js';
import { DISCLAIMER } from './layer.js';
import { MAX_IMPORT_BYTES } from './store.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6.5 14 4l5 6-2 8-9 2-3-7z" stroke-dasharray="3 2.5"/></svg>';

/** Saves `text` as a file download. */
export function download(name, text, type = 'application/geo+json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function createAreasUI({ map, store, layer, draw, toast, panel }) {
  const container = map.getContainer();
  let isOpen = false, btn = null, confirmId = null, shown = true;

  const root = el('div', 'areas-panel'); root.id = 'areas-panel'; root.hidden = true;
  root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'My flying areas');
  L.DomEvent.disableClickPropagation(root); L.DomEvent.disableScrollPropagation(root);
  container.append(root);

  const fileIn = el('input'); fileIn.type = 'file'; fileIn.accept = '.geojson,.json,application/geo+json,application/json'; fileIn.hidden = true; fileIn.id = 'areas-file';
  root.append(fileIn);
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0]; fileIn.value = '';
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) { toast('That file is too large (2 MB at most).', 7000); return; }
    let text; try { text = await f.text(); } catch { toast('The file could not be read.', 7000); return; }
    const r = store.importGeoJSON(text);
    if (r.error) toast(`Nothing imported: ${r.error}`, 8000);
    else {
      const why = r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped[0].reason}${r.skipped.length > 1 ? ' (and others)' : ''}` : '';
      toast(`${r.added} area${r.added === 1 ? '' : 's'} imported.${why}`, 9000);
    }
    paint();
  });

  const b = (label, fn, { cls = 'btn', act = '', aria = '' } = {}) => { const x = el('button', cls, label); x.type = 'button'; if (act) x.dataset.act = act; if (aria) x.setAttribute('aria-label', aria); x.addEventListener('click', fn); return x; };

  function paint() {
    root.classList.toggle('sheet', matchMedia('(max-width: 520px)').matches);
    if (btn) { btn.classList.toggle('on', isOpen); btn.setAttribute('aria-pressed', String(isOpen)); }
    root.hidden = !isOpen;
    if (!isOpen) return;
    const head = el('div', 'areas-head');
    head.append(el('strong', 'areas-title', 'My flying areas'), b('×', () => set(false), { cls: 'areas-close', act: 'close', aria: 'Close My flying areas' }));
    const intro = el('p', 'areas-intro', 'Draw places you recommend for flying. They stay in this browser, private to you, and do not change any point check. ' + DISCLAIMER);
    const st = store.status();
    const warn = st.warning ? el('p', 'areas-warn', st.warning) : null;
    const rec = st.recovered ? el('p', 'areas-warn', st.recovered.dropped ? `${st.recovered.dropped} saved area(s) could not be read and were left out; the original data is kept in this browser.` : 'The saved areas could not be read; the original data is kept in this browser and the list starts empty.') : null;
    const make = el('div', 'areas-actions');
    make.append(b('Draw polygon', () => begin({ kind: 'polygon' }), { cls: 'btn primary', act: 'draw-polygon' }), b('Draw rectangle', () => begin({ kind: 'rectangle' }), { cls: 'btn primary', act: 'draw-rect' }),
      b('Import GeoJSON', () => fileIn.click(), { act: 'import' }), b('Export all', () => exportAll(), { act: 'export-all' }));
    const showLabel = el('label', 'areas-show'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = shown; cb.id = 'areas-show-cb';
    cb.addEventListener('change', () => { shown = cb.checked; layer.setVisible(shown); }); showLabel.append(cb, el('span', '', 'Show my areas on the map'));
    const list = el('ul', 'areas-list'); list.setAttribute('aria-label', 'Saved areas');
    const all = store.list();
    if (!all.length) list.append(el('li', 'areas-empty', 'No areas yet.'));
    for (const a of all) {
      const li = el('li', 'area-item'); li.dataset.id = a.id;
      const meta = [formatArea(a.areaM2 ?? 0), a.spots.length ? `${a.spots.length} setup spot${a.spots.length === 1 ? '' : 's'}` : null, a.drawKind].filter(Boolean).join(' · ');
      li.append(el('div', 'area-item-name', a.name), el('div', 'area-item-meta', meta));
      if (a.description) li.append(el('div', 'area-item-desc', a.description));
      const row = el('div', 'area-item-actions');
      if (confirmId === a.id) {
        row.append(el('span', 'area-confirm', 'Delete this area?'), b('Delete', () => { store.remove(a.id); confirmId = null; toast('Area deleted.'); paint(); }, { cls: 'btn danger', act: 'confirm-delete' }), b('Keep', () => { confirmId = null; paint(); }, { act: 'keep' }));
      } else {
        row.append(b('Show', () => { layer.select(a.id); layer.fit(a.id); if (matchMedia('(max-width: 520px)').matches) set(false); }, { act: 'show', aria: `Show ${a.name} on the map` }),
          b('Edit', () => begin({ areaId: a.id }), { act: 'edit', aria: `Edit ${a.name}` }),
          b('Duplicate', () => { const r = store.duplicate(a.id); toast(r.ok ? 'Duplicated.' : r.errors[0].message); }, { act: 'duplicate', aria: `Duplicate ${a.name}` }),
          b('Export', () => download(`${a.name.replace(/[^\w.-]+/g, '-').slice(0, 40) || 'area'}.geojson`, JSON.stringify(store.toGeoJSON([a.id]), null, 2)), { act: 'export', aria: `Export ${a.name}` }),
          b('Delete', () => { confirmId = a.id; paint(); }, { act: 'delete', aria: `Delete ${a.name}` }));
      }
      li.append(row); list.append(li);
    }
    root.replaceChildren(head, intro, ...(warn ? [warn] : []), ...(rec ? [rec] : []), make, showLabel, list, fileIn);
  }
  function begin(opts) {
    if (!draw.start(opts)) return;
    panel?.closeIfPhone?.();
    set(false);
  }
  function exportAll() {
    if (!store.count()) { toast('There are no areas to export.'); return; }
    download('uav-flying-areas.geojson', JSON.stringify(store.toGeoJSON(), null, 2));
  }
  function set(on) {
    if (on === isOpen) return;
    if (on && draw.isBusy()) return;
    isOpen = on; confirmId = null; paint();
    if (on) root.querySelector('[data-act="draw-polygon"]')?.focus({ preventScroll: true });
    else if (btn && document.activeElement !== document.body && root.contains(document.activeElement)) btn.focus({ preventScroll: true });
  }

  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'areas-btn', bar);
      a.href = '#'; a.role = 'button'; a.dataset.tool = 'areas'; a.title = 'My flying areas';
      a.setAttribute('aria-label', 'My flying areas'); a.setAttribute('aria-pressed', 'false'); a.setAttribute('aria-controls', 'areas-panel');
      a.innerHTML = ICON;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); set(!isOpen); });
      btn = a; return bar;
    },
  });
  new Control().addTo(map);
  store.onChange(() => { if (isOpen) paint(); });
  addEventListener('resize', () => { if (isOpen) paint(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen && root.contains(document.activeElement)) { e.stopPropagation(); set(false); } }, true);
  paint();
  return { open: () => set(true), close: () => set(false), get isOpen() { return isOpen; }, button: () => btn };
}
