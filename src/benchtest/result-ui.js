// Motor bench test: the observational result screen (live MSP/DShot analysis layer).
// Builds DOM with el() and textContent only, from the shared production parts (ui-parts.js). It owns no rule: it renders the object
// from result.js and calls the controller's passive analysis methods (save, export). Wording: observations only, never a health
// verdict, never a safety claim; the single sentence that spells out the limits is DISCLAIMER in result.js.
import { PEER_COMPARISON, METRIC_RULES } from './analysis-constants.js';
import { CATEGORY } from './result.js';
import { button, confirmRow, el, quad, statusEl } from '../preflight/ui-parts.js';
import { escSummary } from './esc-ui.js';

const STATUS_TEXT = Object.freeze({
  completed: 'Completed — no issue observed',
  difference: 'Difference observed',
  inspect: 'Inspection recommended',
  incomplete: 'Test incomplete',
  'not-run': 'Not tested',
});
// result status -> the shared cell vocabulary (icon and word in the cell, so colour never carries it alone)
const CELL = Object.freeze({ completed: 'passed', difference: 'unconfirmed', inspect: 'action', incomplete: 'unavailable', 'not-run': 'waiting' });
const BANNER = Object.freeze({ completed: 'ok', difference: 'unk', inspect: 'no', incomplete: 'unk', 'not-run': 'unk' });
const fmt = (v, unit = '') => (v === null || v === undefined ? 'unavailable' : `${v}${unit}`);
const kb = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

function quadDiagram(result) {
  const cells = result.motors.map((mo) => ({ motor: mo.motor, position: mo.position, state: CELL[mo.status] || 'unavailable', text: STATUS_TEXT[mo.status] || mo.status }));
  const g = quad(cells, { label: 'Motor results, front at the top' });
  g.classList.add('dg-quad-result');
  return g;
}

function row(dl, k, v) { dl.append(el('dt', '', k), el('dd', '', v)); }

function motorCard(mo) {
  const d = el('details', `dg-card dg-st-${mo.status}`); d.dataset.motor = String(mo.motor);
  const sum = el('summary', ''); sum.append(el('strong', '', `Motor ${mo.motor + 1}: ${mo.position}`), document.createTextNode(` — ${STATUS_TEXT[mo.status] || mo.status}`)); d.append(sum);
  for (const t of mo.hard) d.append(el('p', 'form-error', t));
  for (const t of mo.gaps) d.append(el('p', 'hint', t));
  for (const t of mo.differences || []) d.append(el('p', 'hint', `${t} (provisional comparison)`));
  const m = mo.metrics;
  if (!m) return d;
  const dl = el('dl', 'dg-readout');
  row(dl, 'Start threshold', m.startThresholdConfirmed ? `${m.startThreshold} (command units)` : 'unavailable');
  row(dl, 'Time to stable rotation', fmt(m.timeToStableRotationMs, ' ms'));
  row(dl, 'Plateau command', fmt(m.plateauCommand, ' (command units)'));
  row(dl, 'Plateau duration', fmt(m.plateauDurationMs, ' ms'));
  row(dl, 'Plateau RPM median', fmt(m.plateauRpm.median, ' RPM'));
  row(dl, 'Plateau RPM spread', m.plateauRpm.range === null ? 'unavailable' : `P10–P90 ${m.plateauRpm.range} RPM; MAD ${m.plateauRpm.mad} RPM`);
  row(dl, 'Plateau RPM min / max', m.plateauRpm.min === null ? 'unavailable' : `${m.plateauRpm.min} / ${m.plateauRpm.max} RPM`);
  row(dl, 'Usable samples / missing', `${m.plateauUsableSamples} / ${m.plateauMissingSamples === null ? 'unavailable' : m.plateauMissingSamples} (gaps in sweep: ${m.gapCount})`);
  row(dl, 'DShot errors (max / median)', m.dshot.motor.maxPct === null ? 'unavailable' : `${m.dshot.motor.maxPct.toFixed(2)} % / ${m.dshot.motor.medianPct.toFixed(2)} %`);
  row(dl, 'Voltage before / minimum', `${fmt(m.voltage.before_V, ' V')} / ${fmt(m.voltage.min_V, ' V')}`);
  row(dl, 'Observed voltage drop', `${fmt(m.voltage.drop_V, ' V')} (bench-load observation, not a battery assessment)`);
  row(dl, 'ESC temperature (max)', m.temperature.selectedMaxC === null ? 'unavailable (not reported)' : `${m.temperature.selectedMaxC} °C`);
  row(dl, 'Stop proof', m.stopProofComplete === true ? 'completed' : m.stopProofComplete === false ? 'not completed' : 'not applicable (the session was locked)');
  row(dl, 'Expected / confirmed position', `${fmt(m.expectedPosition)} / ${fmt(m.reportedPosition)}`);
  row(dl, 'Safety fault or abort', m.faultReason ? m.faultReason : 'none observed');
  d.append(dl);
  if (m.unavailable.length) { const ul = el('ul', 'hint'); for (const u of m.unavailable) ul.append(el('li', '', u)); d.append(el('p', 'hint', 'Not available:'), ul); }
  return d;
}

/** The result view for one result object (a live result or one rebuilt from a saved record). `live` gives the elements their fixed ids; the history view uses none. */
export function renderResult(result, live = true, esc = null) {
  const s = el('section', `dash-card dg-section dg-result bt-res-${result.category}`); if (live) s.id = 'bt-sec-result'; s.dataset.category = result.category; s.dataset.kind = 'result';
  s.append(el('p', 'eyebrow', 'Observed result'));
  const banner = statusEl({ cls: BANNER[result.motors.some((m) => m.status === 'inspect') ? 'inspect' : result.motors.some((m) => m.status === 'difference') ? 'difference' : result.motors.every((m) => m.status === 'completed') ? 'completed' : 'incomplete'], title: result.headline, detail: result.summary });
  const h = banner.querySelector('strong'); if (live) h.id = 'bt-result-headline';
  s.append(banner);
  if (result.reasons.length) { const ul = el('ul', 'dg-reasons'); if (live) ul.id = 'bt-result-reasons'; for (const r of result.reasons) ul.append(el('li', '', r.text)); s.append(ul); }
  for (const n of result.notes) s.append(el('p', 'hint', n));
  s.append(quadDiagram(result));
  const cards = el('div', 'dg-cards'); for (const mo of result.motors) cards.append(motorCard(mo)); s.append(cards);
  if (esc) { const e = el('div', 'dg-esc-block'); e.append(el('h3', 'section-title', 'ESC identification'), escSummary(esc)); s.append(e); }

  s.append(el('p', 'hint', `Output range used: external ${result.range.startCommand} to ${result.range.capCommand} (the cap), steps of ${result.range.step}. ${result.range.note}`));
  const cmp = el('details', 'dg-details'); cmp.append(el('summary', '', 'Peer comparison and provisional thresholds'));
  cmp.append(el('p', 'hint', `Provisional: no known-bad motor has been used to validate these values. Minimum motors with a complete sweep: ${PEER_COMPARISON.minMotors}. Start threshold difference: ${PEER_COMPARISON.startThresholdDifference} command units. RPM difference at one shared command: ${Math.round(PEER_COMPARISON.rpmRelativeDifference * 100)} %. DShot error difference: ${(PEER_COMPARISON.dshotDifference_centi / 100).toFixed(2)} percentage points. Plateau settle time ignored: ${METRIC_RULES.plateauSettleMs} ms. A peer difference alone never produces "Inspection recommended".`));
  cmp.append(el('p', 'hint', result.comparison.classified ? (result.comparison.sharedCommand !== null ? `RPM was compared at command ${result.comparison.sharedCommand}.` : 'RPM was not compared between motors (no shared command level had enough valid samples).') : result.comparison.reason));
  s.append(cmp);
  s.append(el('p', 'hint', result.reminder));
  s.append(el('p', 'hint', result.disclaimer));
  return s;
}

// ctx: { controller, form: { retain: boolean } }
export function drawResult(parent, ctx) {
  const { controller, form } = ctx;
  const result = controller.analysisResult();
  if (!result) return false;
  if (form.statusFor !== result) { form.status = ''; form.statusFor = result; } // a new result starts without the old save message
  const esc = controller.view().caps.esc;
  const s = renderResult(result, true, esc && esc.scanned ? esc.result : null);

  // keep or export: nothing is stored unless the user presses Save
  const keep = el('div', 'dg-keep'); keep.id = 'bt-keep';
  keep.append(el('h3', 'section-title', 'Keep this result'));
  keep.append(el('p', 'hint', 'Nothing is stored unless you press Save. A saved result stays in this browser, on this device only, and is not part of a trip export, sharing or sync.'));
  const status = el('p', 'hint', form.status || ''); status.id = 'bt-save-status'; status.setAttribute('role', 'status'); // the screen redraws when an interlock changes: the message lives in `form`, not only in the DOM
  const say = (t) => { form.status = t; status.textContent = t; };
  keep.append(confirmRow({ id: 'bt-retain', label: 'Also keep the live samples in this browser', help: `About ${kb(controller.approxSampleBytes())}. Off by default.`, checked: form.retain === true, onChange: (v) => { form.retain = v; } }));
  const acts = el('div', 'dg-actions');
  acts.append(button('Save this result in this browser', () => {
    const r = controller.saveAnalysis({ retainSamples: form.retain === true });
    say(r.ok ? `Saved (${kb(r.recordBytes)}${r.sampleBytes ? ` plus ${kb(r.sampleBytes)} of samples` : ''}). It stays on this device; delete it in Privacy.` : `Could not save (${r.reason}).`);
  }, { id: 'btn-save-result', primary: true }));
  acts.append(button('Download evidence file (JSON, no flight-controller UID)', () => {
    const ev = controller.exportEvidence();
    if (!ev) { say('There is no evidence to download.'); return; }
    const a = el('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(ev, null, 1)], { type: 'application/json' })); a.download = 'motor-bench-evidence.json'; document.body.append(a); a.click(); a.remove();
  }, { id: 'btn-download-evidence' }));
  keep.append(acts, status);
  s.append(keep);
  parent.append(s);
  return true;
}

export const RESULT_CATEGORIES = CATEGORY;
