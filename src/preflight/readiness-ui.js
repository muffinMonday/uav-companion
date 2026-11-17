// Motor diagnostics: Phase 2 read-only readiness view. Reachable only from the non-shipping lab page and only when the
// build-time flag is on. There is no dashboard entry. Text goes in through textContent via el(); no HTML strings.
// Wording rule (backlog "Product wording"): never "safe to fly", airworthy, certified or a guaranteed result.
import { el } from '../cards.js';
import { BLACKBOX_MODE_TOKENS } from './versions.js';

export const STATUS_LABEL = Object.freeze({ pass: 'Passed', warn: 'Check', fail: 'Blocked', unknown: 'Not confirmed' });
const ICON = Object.freeze({ pass: '✓', warn: '!', fail: '✕', unknown: '?' });
export const OVERALL_TEXT = Object.freeze({
  blocked: 'Blocked: at least one requirement is not met.',
  incomplete: 'Incomplete: some requirements could not be confirmed.',
  conditional: 'Conditional: no blocking item found. This is a read-only check; active testing does not exist in this version.',
});

// UI states for the workspace (read-only subset of the backlog state table).
export const VIEW_STATES = Object.freeze(['DISCONNECTED', 'READING', 'READINESS_BLOCKED', 'READINESS_INCOMPLETE', 'READINESS_CONDITIONAL', 'ERROR']);

export function viewState({ connected, reading, error, report }) {
  if (error) return 'ERROR';
  if (reading) return 'READING';
  if (!connected || !report) return 'DISCONNECTED';
  return report.overall === 'blocked' ? 'READINESS_BLOCKED' : report.overall === 'incomplete' ? 'READINESS_INCOMPLETE' : 'READINESS_CONDITIONAL';
}

function gateRow(g) {
  const row = el('li', `pf-gate pf-${g.status}`);
  row.dataset.gate = g.id;
  row.dataset.status = g.status;
  const head = el('div', 'pf-gate-head');
  head.append(el('span', 'pf-icon', ICON[g.status]), el('strong', '', g.title), el('span', 'pf-badge', STATUS_LABEL[g.status]));
  if (g.hardwareUnverified) head.append(el('span', 'pf-hw', 'hardware-unverified'));
  row.append(head);
  const d = el('details');
  d.append(el('summary', '', 'Details'));
  const dl = el('dl');
  for (const [k, v] of [['Found', g.detected], ['Required', g.required], ['Why it matters', g.why], ['What to do', g.manual]]) {
    if (!v) continue;
    dl.append(el('dt', '', k), el('dd', '', v));
  }
  d.append(dl);
  row.append(d);
  return row;
}

// ctx: { state, report, attestations, onAttest(patch), message }
export function renderReadiness(root, ctx) {
  root.replaceChildren();
  const state = ctx.state;
  const wrap = el('section', 'pf-ready');
  wrap.dataset.state = state;
  wrap.setAttribute('aria-label', 'Aircraft readiness check');
  wrap.append(el('h2', '', 'Aircraft readiness (read-only)'));
  wrap.append(el('p', 'pf-note', 'This check only reads values from the flight controller. It does not run motors, change settings or erase logs. It is not a statement that an aircraft is fit to fly.'));
  const live = el('p', 'pf-live'); live.setAttribute('role', 'status'); live.textContent = ctx.message || '';
  wrap.append(live);

  if (state === 'DISCONNECTED') { wrap.append(el('p', '', 'No aircraft connected.')); root.append(wrap); return wrap; }
  if (state === 'READING') { wrap.append(el('p', '', 'Reading the flight controller...')); root.append(wrap); return wrap; }
  if (state === 'ERROR') { wrap.append(el('p', 'pf-error', ctx.message || 'The connection failed.')); root.append(wrap); return wrap; }

  const r = ctx.report;
  const banner = el('p', `pf-overall pf-${r.overall}`, OVERALL_TEXT[r.overall]);
  banner.dataset.overall = r.overall;
  wrap.append(banner);
  wrap.append(el('p', 'pf-counts', `${r.counts.pass} passed, ${r.counts.warn} to check, ${r.counts.fail} blocked, ${r.counts.unknown} not confirmed.`));

  // attestations (the only inputs the app cannot read for itself)
  const att = el('fieldset', 'pf-attest');
  att.append(el('legend', '', 'You confirm (not readable from the flight controller)'));
  const mkCheck = (key, label) => {
    const l = el('label'); const c = el('input'); c.type = 'checkbox'; c.checked = ctx.attestations[key] === true; c.dataset.attest = key;
    c.addEventListener('change', () => ctx.onAttest({ [key]: c.checked }));
    l.append(c, document.createTextNode(' ' + label)); return l;
  };
  att.append(mkCheck('armSwitchOff', 'The transmitter arm switch is off and throttle is at minimum.'));
  att.append(mkCheck('batteryDisconnected', 'The flight battery is disconnected.'));
  if (r.gates.some((g) => g.id === 'bb-mode')) { // deferred: only when a caller asked for the Blackbox gates
  const lm = el('label'); lm.append(document.createTextNode('Blackbox mode (set in the Betaflight App): '));
  const sel = el('select'); sel.dataset.attest = 'blackboxMode';
  for (const v of ['', ...BLACKBOX_MODE_TOKENS]) { const o = el('option', '', v || 'not confirmed'); o.value = v; sel.append(o); }
  sel.value = ctx.attestations.blackboxMode || '';
  sel.addEventListener('change', () => ctx.onAttest({ blackboxMode: sel.value || undefined }));
  lm.append(sel); att.append(lm);
  }
  wrap.append(att);

  const ul = el('ul', 'pf-gates');
  for (const g of r.gates) ul.append(gateRow(g));
  wrap.append(ul);

  root.append(wrap);
  return wrap;
}
