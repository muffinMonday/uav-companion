// Community flying areas, Stage 3: the "Your submissions on this account" dialog (opened from My flying areas while signed in). It lists what the account submitted (any state)
// and, for each, either "Create editable copy" (nothing like it on this device) or "Replace local copy…" (one exists). Both ask first, in the row, and say what they do:
// nothing is sent or changed on the server, and a copy only ever replaces the content of a local draft after the person confirms. Text only (el/textContent).
import { el } from '../cards.js';
import { entryLine } from './recover.js';
import { showModalQuiet } from '../touch.js';

/** @param {{ recovery: ReturnType<import('./recover.js').createRecovery>, toast: Function, onRecovered?: (area) => void }} o */
export function createRecoverUI({ recovery, toast, onRecovered = () => {} }) {
  let dlg = null, state = { status: 'loading', entries: [], message: '' }, asking = null; // asking: { areaId, kind: 'create' | 'replace' }

  const b = (label, fn, { cls = 'btn', act = '', aria = '' } = {}) => { const x = el('button', cls, label); x.type = 'button'; if (act) x.dataset.act = act; if (aria) x.setAttribute('aria-label', aria); x.addEventListener('click', fn); return x; };

  async function load() {
    state = { status: 'loading', entries: [], message: '' }; paint();
    try { state = { status: 'ready', entries: await recovery.list(), message: '' }; }
    catch (e) { state = { status: 'error', entries: [], message: e?.message ?? 'Your submissions could not be loaded.' }; }
    paint();
  }
  async function run(e, replace) {
    asking = null; const r = await recovery.recover(e.areaId, { replace });
    if (r.ok) { toast(r.replaced ? 'Local copy replaced with the version on your account.' : 'Editable copy created in My flying areas. Nothing was sent.', 7000); onRecovered(r.area); }
    else toast(r.message, 8000);
    await load();
  }

  function row(e) {
    const li = el('li', 'area-item area-recover-item'); li.dataset.area = e.areaId;
    li.append(el('div', 'area-item-name', e.name), el('div', 'area-item-meta', `${e.latest.revisionNo > 1 ? `Version ${e.latest.revisionNo}` : 'Version 1'}${e.revisions > 1 ? ` of ${e.revisions}` : ''}`), el('div', 'area-item-status ' + e.latest.status, entryLine(e)));
    const acts = el('div', 'area-item-actions');
    if (asking?.areaId === e.areaId) {
      const replace = asking.kind === 'replace';
      acts.append(el('span', 'area-confirm', replace
        ? `Replace your local copy “${e.local.name}” with the version on your account?${e.local.changed ? ' Changes on this device that you have not submitted will be lost.' : ''}`
        : 'Create a private, editable copy of this area on this device? Nothing is sent, and nothing changes on the server.'),
      b(replace ? 'Replace local copy' : 'Create copy', () => run(e, replace), { cls: replace ? 'btn danger' : 'btn primary', act: replace ? 'confirm-replace' : 'confirm-create' }),
      b('Cancel', () => { asking = null; paint(); }, { act: 'cancel-recover' }));
    } else if (e.local) {
      acts.append(el('span', 'area-item-meta', 'Already on this device'), b('Replace local copy…', () => { asking = { areaId: e.areaId, kind: 'replace' }; paint(); }, { act: 'replace', aria: `Replace the local copy of ${e.name}` }));
    } else acts.append(b('Create editable copy', () => { asking = { areaId: e.areaId, kind: 'create' }; paint(); }, { cls: 'btn primary', act: 'create', aria: `Create an editable copy of ${e.name}` }));
    li.append(acts); return li;
  }

  function paint() {
    if (!dlg) return;
    const form = el('div', 'area-form');
    const h = el('h2', 'area-dlg-title', 'Your submissions on this account'); h.id = 'area-recover-title';
    form.append(h, el('p', 'area-note', 'Areas you submitted, from any device. Create an editable copy here to change an approved area or fix a declined one. This only reads your account: private drafts that were never submitted are not on it, and nothing here sends or deletes anything.'));
    if (state.status === 'loading') form.append(el('p', 'area-note', 'Loading…'));
    else if (state.status === 'error') { form.append(el('p', 'areas-warn', state.message)); form.append(b('Try again', load, { act: 'retry' })); }
    else if (!state.entries.length) form.append(el('p', 'area-note areas-empty', 'You have not submitted any flying areas with this account.'));
    else { const ul = el('ul', 'areas-list'); ul.setAttribute('aria-label', 'Your submissions'); for (const e of state.entries) ul.append(row(e)); form.append(ul); }
    const close = el('div', 'area-dlg-actions'); close.append(b('Close', () => dlg.close(), { act: 'close-recover' }));
    form.append(close);
    dlg.replaceChildren(form);
  }

  function open() {
    document.querySelector('dialog.area-recover-dialog')?.remove();
    dlg = el('dialog', 'area-dialog area-recover-dialog'); dlg.setAttribute('aria-labelledby', 'area-recover-title');
    dlg.addEventListener('close', () => { dlg?.remove(); dlg = null; asking = null; });
    document.body.append(dlg); asking = null; showModalQuiet(dlg); load();
  }
  return { open, isOpen: () => !!dlg?.open };
}
