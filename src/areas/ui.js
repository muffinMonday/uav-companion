// Community flying areas, Phase 1: the "My flying areas" panel (list, draw, import, export) and its map button. The button carries data-tool="areas", so the
// More tools menu folds it into a row like the other map tools (map-tool-labels.js). Everything is local: nothing is sent, nothing needs an account.
import L from 'leaflet';
import { el } from '../cards.js';
import { formatArea, SPOT_LABELS } from './core.js';
import { DISCLAIMER } from './layer.js';
import { MAX_IMPORT_BYTES } from './store.js';
import { MAX_PENDING } from './api.js';
import { showModalQuiet } from '../touch.js';
import { createRecoverUI } from './recover-ui.js';

import { submissionLine, deleteWarning } from './status.js';
export { submissionLine };

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6.5 14 4l5 6-2 8-9 2-3-7z" stroke-dasharray="3 2.5"/></svg>';

/** Saves `text` as a file download. */
export function download(name, text, type = 'application/geo+json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function createAreasUI({ map, store, layer, draw, toast, panel, submit, openDetails = null, closeDetails = null, admin = null, recovery = null }) {
  const recoverUI = recovery ? createRecoverUI({ recovery, toast, onRecovered: (a) => { layer.fit?.(a.id); } }) : null;
  const container = map.getContainer();
  let isOpen = false, btn = null, confirmId = null, withdrawId = null, shown = true;

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
    const note = el('p', 'areas-note', `Submit for review is optional and needs an account. Up to ${MAX_PENDING} submissions can wait for review at once.`);
    const st = store.status();
    const warn = st.warning ? el('p', 'areas-warn', st.warning) : null;
    const rec = st.recovered ? el('p', 'areas-warn', st.recovered.dropped ? `${st.recovered.dropped} saved area(s) could not be read and were left out; the original data is kept in this browser.` : 'The saved areas could not be read; the original data is kept in this browser and the list starts empty.') : null;
    const make = el('div', 'areas-actions');
    make.append(b('Draw polygon', () => begin({ kind: 'polygon' }), { cls: 'btn primary', act: 'draw-polygon' }), b('Draw rectangle', () => begin({ kind: 'rectangle' }), { cls: 'btn primary', act: 'draw-rect' }),
      b('Import GeoJSON', () => fileIn.click(), { act: 'import' }), b('Export all', () => exportAll(), { act: 'export-all' }));
    const rcv = recoverUI && submit.backend.available() ? el('div', 'areas-actions') : null; // reading the account's own submissions: signed-in only, never sends anything
    if (rcv) rcv.append(b('Recover my submitted areas', () => { if (!submit.backend.signedIn()) { toast('Sign in to recover the areas you submitted.', 6000); submit.backend.signIn(); return; } recoverUI.open(); }, { act: 'recover' }));
    const adm = admin?.isAdmin() ? el('div', 'areas-actions') : null; // presentation only: the server checks the role on every moderation call
    if (adm) adm.append(b('Review submissions (administrator)', () => { set(false); admin.open(); }, { cls: 'btn primary', act: 'admin-review' }));
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
      const sst = submit.state(a);
      const line = submissionLine(sst);
      if (line) { const sl = el('div', 'area-item-status ' + sst.kind, line); sl.dataset.status = sst.kind; li.append(sl); }
      const row = el('div', 'area-item-actions');
      if (withdrawId === a.id) {
        row.append(el('span', 'area-confirm', 'Withdraw this submission? Your draft stays here.'), b('Withdraw', async () => { withdrawId = null; const r = await submit.withdraw(a.id); toast(r.ok ? 'Submission withdrawn. Your draft is kept.' : r.message, 6000); paint(); }, { cls: 'btn danger', act: 'confirm-withdraw' }), b('Keep submitted', () => { withdrawId = null; paint(); }, { act: 'keep-submission' }));
      } else if (confirmId === a.id) {
        row.append(el('span', 'area-confirm', deleteWarning(a.submission)), b('Delete', () => { store.remove(a.id); confirmId = null; toast('Area deleted.'); paint(); }, { cls: 'btn danger', act: 'confirm-delete' }), b('Keep', () => { confirmId = null; paint(); }, { act: 'keep' }));
      } else {
        row.append(b('Show', () => { layer.fit(a.id); if (openDetails) { openDetails(a.id); set(false); } else { layer.select(a.id); if (matchMedia('(max-width: 520px)').matches) set(false); } }, { act: 'show', aria: `Show ${a.name} on the map` }),
          b('Edit', () => begin({ areaId: a.id }), { act: 'edit', aria: `Edit ${a.name}` }),
          b('Duplicate', () => { const r = store.duplicate(a.id); toast(r.ok ? 'Duplicated.' : r.errors[0].message); }, { act: 'duplicate', aria: `Duplicate ${a.name}` }),
          b('Export', () => download(`${a.name.replace(/[^\w.-]+/g, '-').slice(0, 40) || 'area'}.geojson`, JSON.stringify(store.toGeoJSON([a.id]), null, 2)), { act: 'export', aria: `Export ${a.name}` }),
          b('Delete', () => { confirmId = a.id; paint(); }, { act: 'delete', aria: `Delete ${a.name}` }));
        if (submit.eligible(a) || sst.kind === 'sending') {
          const rv = submit.isRevision(a), sb = b(sst.kind === 'sending' ? 'Submitting…' : rv ? 'Submit changes' : 'Submit for review', () => startSubmit(a.id), { cls: 'btn primary', act: 'submit', aria: rv ? `Submit changes to ${a.name} for review` : `Submit ${a.name} for review` });
          if (sst.kind === 'sending') { sb.disabled = true; sb.setAttribute('aria-busy', 'true'); }
          row.append(sb);
        } else if (sst.kind === 'pending') row.append(b('Withdraw', () => { withdrawId = a.id; paint(); }, { act: 'withdraw', aria: `Withdraw ${a.name}` }));
      }
      li.append(row); list.append(li);
    }
    root.replaceChildren(head, intro, note, ...(warn ? [warn] : []), ...(rec ? [rec] : []), make, ...(rcv ? [rcv] : []), ...(adm ? [adm] : []), showLabel, list, fileIn);
  }
  /** Submit pressed: a guest is sent to sign in (and the wish is kept); a signed-in person gets the acknowledgement dialog. Nothing is sent until that is confirmed. */
  function startSubmit(id) {
    const a = store.get(id);
    if (!a || !submit.eligible(a)) return;
    if (!submit.backend.available()) { toast('Submitting needs an account, which this version of the app does not have.', 7000); return; }
    if (!submit.backend.signedIn()) {
      submit.intent.set(id);
      toast('Sign in to submit. Your area stays saved here; you will come back to this step.', 8000);
      submit.backend.signIn();
      return;
    }
    openSubmitDialog(a);
  }
  function openSubmitDialog(a) {
    document.querySelector('dialog.area-submit-dialog')?.remove();
    const dlg = el('dialog', 'area-dialog area-submit-dialog'); dlg.setAttribute('aria-labelledby', 'area-submit-title');
    const form = el('form', 'area-form'); form.method = 'dialog'; form.noValidate = true;
    const rv = submit.isRevision(a);
    const h = el('h2', 'area-dlg-title', rv ? 'Submit changes for review' : 'Submit for review'); h.id = 'area-submit-title';
    const what = el('p', 'area-note'); if (rv) what.append('Send your changes to ', el('strong', '', a.name), ' to the administrators for review. The published version stays visible to everyone, unchanged, until an administrator approves your change; if it is rejected or you withdraw it, nothing public changes.');
    else what.append('Send ', el('strong', '', a.name), ' to the administrators for review. Your private copy stays in this browser either way.');
    const privacy = el('p', 'area-note', 'The name, description, outline and setup spots are sent, with your account so you can track and withdraw it. Do not put personal information in the name or description.');
    const disc = el('p', 'area-note area-disclaimer', DISCLAIMER);
    const limit = el('p', 'area-note', `You can have up to ${MAX_PENDING} submissions waiting for review at once.`);
    const ack = el('label', 'area-ack'); const cb = el('input'); cb.type = 'checkbox'; cb.id = 'area-ack'; ack.append(cb, el('span', '', ' I have read this: it is a community recommendation, not flight authorization.'));
    const err = el('div', 'area-errors'); err.setAttribute('role', 'alert');
    const go = el('button', 'btn primary', rv ? 'Submit changes' : 'Submit for review'); go.type = 'submit'; go.dataset.act = 'confirm-submit'; go.disabled = true;
    const cancel = el('button', 'btn', 'Cancel'); cancel.type = 'button'; cancel.dataset.act = 'cancel-submit';
    const actions = el('div', 'area-dlg-actions'); actions.append(go, cancel);
    cb.addEventListener('change', () => { go.disabled = !cb.checked || submit.isBusy(a.id); });
    cancel.addEventListener('click', () => dlg.close());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!cb.checked || submit.isBusy(a.id)) return;
      go.disabled = true; err.replaceChildren();
      const r = await submit.submit(a.id);
      if (r.ok) { dlg.close(); toast(r.status === 'pending' ? 'Submitted for review. Your private draft is kept.' : 'Submission recorded. Your private draft is kept.', 7000); }
      else { err.replaceChildren(el('p', '', r.message)); go.disabled = !cb.checked; if (r.code === 'signed-out') { submit.intent.set(a.id); } }
      paint();
    });
    dlg.addEventListener('close', () => dlg.remove());
    form.append(h, what, privacy, disc, limit, ack, err, actions); dlg.append(form); document.body.append(dlg);
    showModalQuiet(dlg);
  }
  /** After signing in: reopen the dialog for the area the person wanted to submit (they still have to acknowledge and confirm). */
  function resumeIntent() {
    if (!submit.backend.signedIn()) return;
    const id = submit.intent.take();
    if (!id) return;
    const a = store.get(id);
    if (!a || !submit.eligible(a) || draw.isBusy()) return;
    set(true);
    openSubmitDialog(a);
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
    isOpen = on; confirmId = null; withdrawId = null; paint();
    if (on) submit.refresh();
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
  submit.onChange(() => { if (isOpen) paint(); });
  let wasIn = submit.backend.signedIn();
  submit.backend.onChange?.(() => { const now = submit.backend.signedIn(); if (now === wasIn) return; wasIn = now; if (now) { submit.refresh(); resumeIntent(); } else if (isOpen) paint(); });
  addEventListener('resize', () => { if (isOpen) paint(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen && root.contains(document.activeElement)) { e.stopPropagation(); set(false); } }, true);
  paint();
  setTimeout(resumeIntent, 0); // a return from sign-in (the page reloaded)
  /** The same operations the list uses, for the details panel's actions (adapter-private.js). */
  const ops = {
    edit: (id) => { begin({ areaId: id }); if (draw.isBusy()) closeDetails?.(); },
    remove: (id) => { store.remove(id); toast('Area deleted.'); },
    exportOne: (id) => { const a = store.get(id); if (a) download(`${a.name.replace(/[^\w.-]+/g, '-').slice(0, 40) || 'area'}.geojson`, JSON.stringify(store.toGeoJSON([id]), null, 2)); },
    startSubmit,
    withdraw: async (id) => { const r = await submit.withdraw(id); toast(r.ok ? 'Submission withdrawn. Your draft is kept.' : r.message, 6000); },
  };
  return { open: () => set(true), close: () => set(false), get isOpen() { return isOpen; }, button: () => btn, ops };
}
