// Motor bench test: the saved-results history (user-facing workspace). Reads only the local store of
// ../aircraft-diag-data.js, groups results by the FC/ESC identity (the temporary aircraft association) and renders each one with
// the same result view as a live result. Stored data is untrusted: every record is rendered inside its own try/catch and
// everything goes through el() and textContent.
import { el } from '../cards.js';
import { deleteAll, listRecords } from '../aircraft-diag-data.js';
import { renderResult } from './result-ui.js';
import { DISCLAIMER, REMINDER } from './result.js';

const text = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
const when = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : text(iso, 24); };

// A stored record back into the shape the result view renders.
export function resultFromRecord(rec) {
  return {
    ...rec.result,
    reasons: Array.isArray(rec.result.reasons) ? rec.result.reasons : [], notes: Array.isArray(rec.result.notes) ? rec.result.notes : [],
    motors: rec.motors.map((m) => ({ ...m, hard: Array.isArray(m.hard) ? m.hard : [], gaps: Array.isArray(m.gaps) ? m.gaps : [], differences: Array.isArray(m.differences) ? m.differences : [], metrics: m.metrics && typeof m.metrics === 'object' ? m.metrics : null })),
    comparison: { classified: false, sharedCommand: null, reason: '', differences: [], ...(rec.comparison || {}) },
    range: rec.range, disclaimer: DISCLAIMER, reminder: REMINDER,
  };
}

export const aircraftLabel = (rec) => {
  const f = rec.firmware || {};
  return [text(f.variant, 8), text(f.firmware, 20), text(f.targetName, 24) && `${text(f.targetName, 24)}${f.boardId ? ' / ' + text(f.boardId, 8) : ''}`, f.escFamily && `ESC ${text(f.escFamily, 24)}`].filter(Boolean).join(' · ') || 'Unidentified aircraft';
};

export function latestRecord(storage) {
  const { records } = listRecords(storage);
  return records.length ? records[records.length - 1] : null;
}

// parent: element. Returns the section.
export function drawHistory(parent, { storage } = {}) {
  const s = el('section', 'bt-section'); s.id = 'bt-sec-history'; s.dataset.kind = 'result';
  s.append(el('p', 'bt-kicker', 'Saved results'), el('h2', '', 'Motor diagnostics history'));
  const { records, available } = listRecords(storage);
  if (!available) s.append(el('p', 'bt-small', 'This browser does not allow local storage, so no results can be kept or shown.'));
  else if (!records.length) s.append(el('p', '', 'No saved results yet. After a complete check you can save its result here, on this device only.'));
  else {
    const groups = new Map();
    for (const r of [...records].reverse()) { const k = (r.association && typeof r.association.key === 'string' ? r.association.key : '?'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    for (const [, list] of groups) {
      const g = el('div', 'bt-hist-group'); g.append(el('h3', '', aircraftLabel(list[0])));
      for (const r of list) {
        const d = el('details', 'bt-card bt-hist-item'); d.dataset.recordId = text(r.id, 64);
        const sum = el('summary', ''); sum.append(el('strong', '', when(r.savedAt)), document.createTextNode(` — ${text(r.result.headline, 80) || 'Result'}`)); d.append(sum);
        let drawn = false;
        d.addEventListener('toggle', () => {
          if (!d.open || drawn) return; drawn = true;
          try { d.append(renderResult(resultFromRecord(r), false)); } catch { d.append(el('p', 'bt-warn', 'This saved result could not be displayed.')); }
        });
        g.append(d);
      }
      s.append(g);
    }
    s.append(el('p', 'bt-small', 'Saved results stay in this browser. They are not part of a trip export, sharing or sync. You can also delete them in Privacy, under Aircraft diagnostic data.'));
    const del = el('button', '', 'Delete all saved results'); del.type = 'button'; del.id = 'btn-history-delete';
    del.addEventListener('click', () => { deleteAll(storage); s.replaceWith(drawHistory(document.createDocumentFragment(), { storage })); });
    s.append(del);
  }
  parent.append(s);
  return s;
}
