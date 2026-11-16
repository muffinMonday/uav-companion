// Motor diagnostics: inventory panel (Phase 1). Manual fields, UID opt-in with its warning, local export buttons.
// Text goes in through textContent via el(). The ESC firmware family is typed by the user; the app never reads the ESC.
import { el } from '../cards.js';
import { ESC_FIRMWARE_FAMILIES } from './versions.js';
import { UID_WARNING } from './inventory.js';

// ctx: { inventory, manual, onManual(patch), onExport(kind, includeUid) }
export function renderInventoryPanel(root, ctx) {
  root.replaceChildren();
  const inv = el('section', 'pf-inventory');
  inv.append(el('h3', '', 'Aircraft inventory'));
  const mf = (label, key, max) => {
    const l = el('label'); l.append(document.createTextNode(label + ' ')); const i = el('input'); i.type = 'text'; i.maxLength = max; i.value = ctx.manual[key] || ''; i.dataset.manual = key;
    i.addEventListener('change', () => ctx.onManual({ [key]: i.value })); l.append(i); return l;
  };
  inv.append(mf('Aircraft name', 'aircraftLabel', 80));
  const cl = el('label'); cl.append(document.createTextNode('Class '));
  const cs = el('select'); cs.dataset.manual = 'aircraftClass';
  for (const v of ['', '5-inch', '2.5-inch', 'whoop', 'other']) { const o = el('option', '', v || 'not set'); o.value = v; cs.append(o); }
  cs.value = ctx.manual.aircraftClass || ''; cs.addEventListener('change', () => ctx.onManual({ aircraftClass: cs.value })); cl.append(cs); inv.append(cl);
  const el2 = el('label'); el2.append(document.createTextNode('ESC firmware family (you enter this; the app never reads the ESC) '));
  const es = el('select'); es.dataset.manual = 'escFirmwareFamily';
  for (const v of ESC_FIRMWARE_FAMILIES) { const o = el('option', '', v); o.value = v; es.append(o); }
  es.value = ctx.manual.escFirmwareFamily || 'Unknown'; es.addEventListener('change', () => ctx.onManual({ escFirmwareFamily: es.value })); el2.append(es); inv.append(el2);
  inv.append(mf('Phone model (if on Android)', 'clientPhoneModel', 80), mf('Android version', 'clientOsVersion', 40), mf('Notes', 'notes', 500));
  const uidBox = el('label', 'pf-uid'); const uidCheck = el('input'); uidCheck.type = 'checkbox'; uidCheck.dataset.export = 'includeUid';
  uidBox.append(uidCheck, document.createTextNode(' Include the board UID in the export. ' + UID_WARNING));
  inv.append(uidBox);
  const btns = el('div', 'pf-actions');
  for (const [k, t] of [['json', 'Save inventory (JSON)'], ['md', 'Save inventory (Markdown)']]) {
    const b = el('button', '', t); b.type = 'button'; b.dataset.export = k; b.addEventListener('click', () => ctx.onExport(k, uidCheck.checked)); btns.append(b);
  }
  inv.append(btns);
  if (ctx.inventory && ctx.inventory.unresolved.length) {
    const u = el('details'); u.append(el('summary', '', 'Not settled by this check'));
    const l = el('ul'); for (const x of ctx.inventory.unresolved) l.append(el('li', '', x)); u.append(l); inv.append(u);
  }
  root.append(inv);
  return inv;
}
