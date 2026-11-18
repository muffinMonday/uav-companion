// Motor diagnostics: how a 4-way ESC identification result is shown (scan screen, post-scan screen, result, saved history).
// Built from the shared production parts only. Wording rule: a reported firmware target or layout is NOT necessarily the retail
// hardware model; this screen says "Firmware target" and "Reported firmware", never "model", and shows anything it could not read
// as unavailable instead of guessing. No flashing, writing or configuration control exists here.
import { el, icon, quad, statusEl } from '../preflight/ui-parts.js';

export const RETAIL_NOTE = 'Retail model cannot be independently verified: the firmware target is what the ESC reports about its own firmware.';

const CELL_TEXT = Object.freeze({ waiting: 'Waiting', connecting: 'Reading', identified: 'Identified', unavailable: 'Unavailable', mismatch: 'Mismatch' });
const clip = (v, n = 24) => (typeof v === 'string' ? v.slice(0, n) : '');

// channels: [{ channel, state, family, version, target }]; position per motor is the default quad-X order the app expects.
export function escQuad(channels, positions) {
  const cells = [0, 1, 2, 3].map((i) => {
    const c = (channels && channels.find((x) => x && x.channel === i + 1)) || { state: 'waiting' };
    const state = CELL_TEXT[c.state] ? c.state : 'unavailable';
    const sub = state === 'identified' ? [clip(c.family), clip(c.version) && 'v' + clip(c.version)].filter(Boolean).join(' ') : '';
    return { motor: i, position: positions[i], state, text: CELL_TEXT[state], sub };
  });
  return quad(cells, { label: 'ESC identification by motor position, front at the top' });
}

// result: the scan result object (fourway/scan-result.js) or a stored, sanitized observation. Returns a section body (element).
export function escSummary(result, { idPrefix = '' } = {}) {
  const box = el('div', 'dg-esc');
  if (!result || result.status === 'not-run') { box.append(el('p', 'hint', 'ESC identification was not part of this session.')); return box; }
  const ids = (result.channels || []).filter((c) => c && c.state === 'identified').length;
  const kind = result.status === 'identified' && result.consistent === true ? 'ok' : 'unk';
  let head;
  if (result.status === 'identified') head = result.consistent === true ? 'Four ESCs identified, with matching reported firmware' : 'Four ESCs identified, but their reported firmware differs';
  else if (result.status === 'partial') head = `${ids} of 4 ESCs identified`;
  else head = 'ESC identification was unavailable';
  const banner = statusEl({ cls: result.consistent === false ? 'no' : kind, title: head, detail: RETAIL_NOTE });
  if (idPrefix) banner.id = idPrefix + 'esc-banner';
  box.append(banner);
  for (const w of result.warnings || []) { const p = el('p', 'form-error', clip(w, 240)); p.setAttribute('role', 'status'); box.append(p); }
  const list = el('div', 'dg-esc-list');
  for (const c of result.channels || []) {
    if (!c) continue;
    const d = el('details', 'dg-card'); d.dataset.escChannel = String(c.channel);
    const sum = el('summary'); sum.append(el('strong', '', `ESC ${c.channel}`), document.createTextNode(` · ${c.state === 'identified' ? [clip(c.family), clip(c.version) && 'v' + clip(c.version)].filter(Boolean).join(' ') : c.state === 'mismatch' ? 'Mismatch' : 'Unavailable'}`)); d.append(sum);
    const dl = el('dl', 'dg-readout');
    for (const [k, v] of [['Reported firmware', clip(c.family) || 'unavailable'], ['Firmware version', clip(c.version) || 'unavailable'], ['Firmware target', clip(c.target) || 'unavailable'], ['MCU or bootloader family', clip(c.mcu) || 'unavailable'], ['Signature', clip(c.signature) || 'unavailable'], ['Why unavailable', c.state === 'identified' ? '' : clip(c.reason, 60)]]) {
      if (v === '') continue; dl.append(el('dt', '', k), el('dd', '', v));
    }
    d.append(dl); list.append(d);
  }
  box.append(list);
  box.append(el('p', 'hint', 'Read-only: nothing was written to, flashed on or configured in any ESC.'));
  return box;
}

export { icon };
