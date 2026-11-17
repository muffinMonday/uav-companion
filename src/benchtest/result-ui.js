// Motor bench test: the observational result screen (live MSP/DShot analysis layer).
// Builds DOM with el() and textContent only. It owns no rule: it renders the object from result.js and calls the controller's
// passive analysis methods (save, export). Wording: observations only, never a health verdict, never a safety claim; the single
// sentence that spells out the limits is DISCLAIMER in result.js.
import { el } from '../cards.js';
import { PEER_COMPARISON, METRIC_RULES } from './analysis-constants.js';
import { CATEGORY } from './result.js';

const STATUS_TEXT = Object.freeze({
  completed: 'Completed — no issue observed',
  difference: 'Difference observed',
  inspect: 'Inspection recommended',
  incomplete: 'Test incomplete',
  'not-run': 'Not tested',
});
const fmt = (v, unit = '') => (v === null || v === undefined ? 'unavailable' : `${v}${unit}`);
const kb = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

function quadDiagram(result) {
  const g = el('div', 'bt-quad bt-resquad'); g.setAttribute('role', 'list'); g.setAttribute('aria-label', 'Motor results, front at the top');
  for (const m of [3, 1, 2, 0]) { // front left, front right, rear left, rear right
    const mo = result.motors[m];
    const cell = el('div', `bt-rescell bt-st-${mo.status}`); cell.setAttribute('role', 'listitem'); cell.dataset.motor = String(m); cell.dataset.status = mo.status;
    cell.append(el('strong', '', `Motor ${m + 1}: ${mo.position}`), el('span', '', STATUS_TEXT[mo.status] || mo.status)); // text states the status; colour alone never does
    g.append(cell);
  }
  return g;
}

function row(dl, k, v) { dl.append(el('dt', '', k), el('dd', '', v)); }

function motorCard(mo) {
  const d = el('details', `bt-card bt-st-${mo.status}`); d.dataset.motor = String(mo.motor);
  const sum = el('summary', ''); sum.append(el('strong', '', `Motor ${mo.motor + 1}: ${mo.position}`), document.createTextNode(` — ${STATUS_TEXT[mo.status] || mo.status}`)); d.append(sum);
  for (const t of mo.hard) d.append(el('p', 'bt-warn', t));
  for (const t of mo.gaps) d.append(el('p', 'bt-small', t));
  for (const t of mo.differences || []) d.append(el('p', 'bt-note', `${t} (provisional comparison)`));
  const m = mo.metrics;
  if (!m) return d;
  const dl = el('dl', 'bt-readout bt-evidence');
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
  if (m.unavailable.length) { const ul = el('ul', 'bt-small'); for (const u of m.unavailable) ul.append(el('li', '', u)); d.append(el('p', 'bt-small', 'Not available:'), ul); }
  return d;
}

// ctx: { controller, form: { retain: boolean }, onChange }
export function drawResult(parent, ctx) {
  const { controller, form } = ctx;
  const result = controller.analysisResult();
  if (!result) return false;
  if (form.statusFor !== result) { form.status = ''; form.statusFor = result; } // a new result starts without the old save message
  const s = el('section', `bt-section bt-result bt-res-${result.category}`); s.id = 'bt-sec-result'; s.dataset.category = result.category; s.dataset.kind = 'result';
  s.append(el('p', 'bt-kicker', 'Observational result'));
  const h = el('h2', 'bt-res-headline', result.headline); h.id = 'bt-result-headline'; s.append(h);
  s.append(el('p', '', result.summary));
  if (result.reasons.length) { const ul = el('ul', 'bt-res-reasons'); ul.id = 'bt-result-reasons'; for (const r of result.reasons) ul.append(el('li', '', r.text)); s.append(ul); }
  for (const n of result.notes) s.append(el('p', 'bt-small', n));
  s.append(quadDiagram(result));
  const cards = el('div', 'bt-cards'); for (const mo of result.motors) cards.append(motorCard(mo)); s.append(cards);

  s.append(el('p', 'bt-small', `Output range used: external ${result.range.startCommand} to ${result.range.capCommand} (the cap), steps of ${result.range.step}. ${result.range.note}`));
  const cmp = el('details', 'bt-adv'); cmp.append(el('summary', '', 'Peer comparison and provisional thresholds'));
  cmp.append(el('p', 'bt-small', `Provisional: no known-bad motor has been used to validate these values. Minimum motors with a complete sweep: ${PEER_COMPARISON.minMotors}. Start threshold difference: ${PEER_COMPARISON.startThresholdDifference} command units. RPM difference at one shared command: ${Math.round(PEER_COMPARISON.rpmRelativeDifference * 100)} %. DShot error difference: ${(PEER_COMPARISON.dshotDifference_centi / 100).toFixed(2)} percentage points. Plateau settle time ignored: ${METRIC_RULES.plateauSettleMs} ms. A peer difference alone never produces "Inspection recommended".`));
  cmp.append(el('p', 'bt-small', result.comparison.classified ? (result.comparison.sharedCommand !== null ? `RPM was compared at command ${result.comparison.sharedCommand}.` : 'RPM was not compared between motors (no shared command level had enough valid samples).') : result.comparison.reason));
  s.append(cmp);
  s.append(el('p', 'bt-small', result.reminder));
  s.append(el('p', 'bt-small', result.disclaimer));

  // keep or export: nothing is stored unless the user presses Save
  const keep = el('div', 'bt-keep');
  const status = el('p', 'bt-small', form.status || ''); status.id = 'bt-save-status'; status.setAttribute('role', 'status'); // the screen redraws when an interlock changes: the message lives in `form`, not only in the DOM
  const say = (t) => { form.status = t; status.textContent = t; };
  const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.id = 'bt-retain'; cb.checked = form.retain === true;
  cb.addEventListener('change', () => { form.retain = cb.checked; });
  lab.append(cb, ` Also keep the live samples in this browser (about ${kb(controller.approxSampleBytes())}). Off by default.`);
  keep.append(lab);
  keep.append(el('button', '', 'Save this result in this browser'));
  keep.lastChild.type = 'button'; keep.lastChild.id = 'btn-save-result';
  keep.lastChild.addEventListener('click', () => {
    const r = controller.saveAnalysis({ retainSamples: form.retain === true });
    say(r.ok ? `Saved (${kb(r.recordBytes)}${r.sampleBytes ? ` plus ${kb(r.sampleBytes)} of samples` : ''}). It stays on this device; delete it in Privacy.` : `Could not save (${r.reason}).`);
  });
  const dl = el('button', '', 'Download evidence file (JSON, no flight-controller UID)'); dl.type = 'button'; dl.id = 'btn-download-evidence';
  dl.addEventListener('click', () => {
    const ev = controller.exportEvidence();
    if (!ev) { say('There is no evidence to download.'); return; }
    const a = el('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(ev, null, 1)], { type: 'application/json' })); a.download = 'motor-bench-evidence.json'; document.body.append(a); a.click(); a.remove();
  });
  keep.append(dl, status);
  s.append(keep);
  parent.append(s);
  return true;
}

export const RESULT_CATEGORIES = CATEGORY;
