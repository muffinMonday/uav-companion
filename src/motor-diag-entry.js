// The dashboard entry for the experimental Motor diagnostics workspace (/motor-diagnostics/). It is built ONLY when the build-time
// flag VITE_BENCH_PHASE3=1 is set: with the flag off the condition below is a constant false, so the card builder and everything it
// imports are removed from the bundle and no entry exists. The same flag decides whether the workspace page is built at all, so one
// switch turns the whole feature off. This file holds no motor, transport or safety code: the card only links to the workspace
// and reads the local list of saved results (aircraft-diag-data.js).
import { latestSaved } from './aircraft-diag-data.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

function buildCard() {
  const base = new URL('motor-diagnostics/', document.baseURI).href;
  const c = el('section', 'dash-card dash-diag'); c.id = 'diag-entry';
  const h = el('h3', '', 'Motor diagnostics '); h.append(el('span', 'badge', 'Experimental')); c.append(h);
  c.append(el('p', '', 'Run a propeller-free, low-output motor and telemetry check over USB.'));
  const last = latestSaved();
  if (last) {
    const d = new Date(last.savedAt);
    const p = el('p', 'diag-latest'); p.id = 'diag-latest';
    p.append(el('strong', '', 'Latest check: '), document.createTextNode(`${Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : ''} — ${String(last.result.headline).slice(0, 80)}`));
    c.append(p);
  }
  const row = el('div', 'btn-row');
  const open = el('a', 'btn primary', 'Open diagnostics'); open.href = base; open.id = 'diag-open'; row.append(open);
  if (last) { const hist = el('a', 'btn', 'View history'); hist.href = base + '#history'; hist.id = 'diag-history'; row.append(hist); }
  c.append(row);
  c.append(el('p', 'hint', 'Requires a compatible Betaflight flight controller, bidirectional DShot and a supported USB browser.'));
  return c;
}

export const motorDiagCard = import.meta.env.VITE_BENCH_PHASE3 === '1' ? buildCard : () => null;
