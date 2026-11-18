// Motor bench test: how the combined four-motor confirmation is shown in a result (live or saved) and as the locked/eligible card state text.
// el() and textContent only. Observations only: no motor, ESC or battery is named as faulty, and voltage change is never a battery assessment.
import { el, statusEl } from '../preflight/ui-parts.js';
import { COMBINED_NOT_REPORTED, COMBINED_TITLE } from './combined.js';
import { EXPECTED_POSITIONS } from './constants.js';

const num = (v, unit = '') => (v === null || v === undefined ? 'Not available' : `${v}${unit}`);
const KIND = Object.freeze({ completed: 'ok', 'inspection-recommended': 'no', incomplete: 'unk' });

// combined: a sanitized combined result, the string 'skipped' (the bench finished without running it), or null (nothing to show).
export function combinedResultBlock(combined, { live = true } = {}) {
  if (!combined) return null;
  const box = el('section', 'dash-card dg-section dg-combined-result'); if (live) box.id = 'bt-sec-combined-result'; box.dataset.kind = 'combined';
  box.append(el('h3', 'section-title dg-block-title', COMBINED_TITLE));
  if (combined === 'skipped') { box.dataset.combined = 'skipped'; box.append(el('p', '', 'Skipped: the combined confirmation was not run in this session.')); return box; }
  box.dataset.combined = combined.status;
  box.append(statusEl({ cls: KIND[combined.status] || 'unk', title: combined.headline, detail: combined.summary }));
  if (combined.reasons.length) { const ul = el('ul', 'dg-reasons'); for (const r of combined.reasons) ul.append(el('li', '', r)); box.append(ul); }
  const dl = el('dl', 'dg-readout');
  const row = (k, v) => dl.append(el('dt', '', k), el('dd', '', v));
  row('Common command (external)', `${num(combined.targetCommand)} (cap ${combined.capCommand})`);
  for (const m of combined.motors) row(`Motor ${m.motor + 1} (${EXPECTED_POSITIONS[m.motor]}): median RPM`, num(m.medianRpm, ' RPM'));
  row('RPM peer difference', combined.rpmPeerDifferencePct === null ? 'Not available' : `${combined.rpmPeerDifferencePct} % (provisional)`);
  row('DShot invalid packets (max)', combined.dshotInvalidPctMax === null ? 'Not available' : `${combined.dshotInvalidPctMax.toFixed(2)} %`);
  row('Usable / missing samples', `${num(combined.usableSamples)} / ${num(combined.missingSamples)}`);
  row('Battery voltage before / minimum', `${num(combined.voltage.before_V, ' V')} / ${num(combined.voltage.min_V, ' V')}`);
  row('Observed voltage change', `${num(combined.voltage.drop_V, ' V')} (bench-load observation, not a battery assessment)`);
  for (const m of combined.motors) row(`Motor ${m.motor + 1} ESC temperature (max)`, m.maxTempC === null ? COMBINED_NOT_REPORTED : `${m.maxTempC} °C`);
  row('Stop proof', combined.stopProofComplete === true ? 'completed' : combined.stopProofComplete === false ? 'not completed' : 'not applicable');
  box.append(dl);
  box.append(el('p', 'hint', combined.note));
  return box;
}
