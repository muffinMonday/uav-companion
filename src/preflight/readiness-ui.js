// Motor diagnostics: the readiness view, shared by the user-facing workspace, the engineering lab and the read-only lab. Reachable
// only when the build-time flag is on. Text goes in through textContent via el(); no HTML strings. It is made of the main app's own
// parts (ui-parts.js: production classes and tokens) in three sections:
//   1. Your safety confirmations  large tappable rows for what the app cannot read from the flight controller;
//   2. Automatic aircraft checks  one row per check: icon, title, status word, short explanation, expandable technical evidence;
//      blockers and required actions first, passed checks folded into a completed group;
//   3. Readiness summary          a plain-language headline, what to do next, one primary action, troubleshooting only if relevant.
// Wording rule (backlog "Product wording"): never "safe to fly", airworthy, certified or a guaranteed result.
import { checkRow, confirmRow, countWord, el, plural, section, statusEl } from './ui-parts.js';

// Kept for callers and tests that name the raw gate statuses; the screen itself uses the words in ui-parts STATUS.
export const STATUS_LABEL = Object.freeze({ pass: 'Passed', warn: 'Check', fail: 'Blocked', unknown: 'Not confirmed' });
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

// What the user confirms, because the flight controller cannot say. `key` is the attestation name; `gate` the readiness gate it feeds.
export const CONFIRMATIONS = Object.freeze([
  { key: 'armSwitchOff', label: 'The transmitter arm switch is off', help: 'The flight controller cannot report the switch position. Set it to off now.' },
  { key: 'throttleMin', label: 'The throttle is at minimum', help: 'Check the throttle stick on the transmitter, with the transmitter on.' },
  { key: 'batteryDisconnected', label: 'The flight battery is disconnected', help: 'The aircraft runs on USB power only for now. The app asks you to connect the battery later, through a smoke stopper.' },
]);

// Plain-language text per gate and state. Falls back to the gate's own wording. Never says "phase", "gate" or an internal state name.
const PLAIN = Object.freeze({
  transport: { passed: 'USB connection granted.', note: 'Practice mode: a simulated flight controller is connected. Nothing real is involved.', unavailable: 'Connect over USB with a supported browser.' },
  firmware: { passed: 'A supported Betaflight version.', note: 'This Betaflight version is accepted, but it has not been validated on hardware yet.', unavailable: 'The firmware version could not be read. Check the USB connection and read again.' },
  'motor-count': { passed: 'Four motors are configured.', action: 'This check needs exactly four motors.', unavailable: 'The motor count could not be read.' },
  protocol: { passed: 'A DShot motor protocol is in use.', unavailable: 'The motor protocol could not be read.' },
  bidir: { passed: 'Bidirectional DShot is on.', note: 'Bidirectional DShot is switched on. Working RPM telemetry is confirmed later, with the battery connected.', unavailable: 'Bidirectional DShot could not be read.' },
  '3d': { passed: '3D mode is off.', unavailable: '3D mode could not be read.' },
  arming: { passed: 'The flight controller reports disarmed.', note: 'The flight controller reports disarmed. The switch position is your confirmation above.', action: 'The flight controller reports that the aircraft is armed. Switch the transmitter arm switch off.', unavailable: 'The armed state could not be read. Check the connection and read again.' },
  poles: { passed: 'The motor pole count is in the expected range.', unavailable: 'The motor pole count could not be read.' },
  telemetry: { passed: 'Motor telemetry is readable.', note: 'DShot error statistics are not available with the battery disconnected. They are checked again once the aircraft is powered.', action: 'The telemetry does not match the number of motors.', unavailable: 'Motor telemetry could not be read.' },
});

// Raw readiness status to the screen's vocabulary. `warn` is acceptable by policy (it is carried by the later live checks), so it
// reads as Passed with a note; `unknown` is a check that could not be established.
export function gateView(g) {
  const status = g.status === 'pass' ? 'passed' : g.status === 'warn' ? 'passed' : g.status === 'fail' ? 'action' : 'unavailable';
  const p = PLAIN[g.id] || {};
  let text;
  if (g.status === 'pass') text = p.passed || '';
  else if (g.status === 'warn') text = p.note || g.why || '';
  else if (g.status === 'fail') text = p.action || g.manual || g.why || '';
  else text = p.unavailable || g.why || '';
  if (g.status === 'fail' && g.manual && p.action && p.action !== g.manual) text = `${p.action} ${g.manual}`;
  return {
    id: g.id, title: g.title, status, text, note: g.status === 'warn',
    evidence: [['Found', g.detected], ['Required', g.required], ['Why it matters', g.why], ['What to do', g.manual], ['Status code', g.status + (g.hardwareUnverified ? ' (not yet verified on hardware)' : '')]],
  };
}

// Everything the screen needs, derived once: it is also what the tests assert on.
export function readinessModel(report, attestations = {}, extraChecks = []) {
  const att = attestations || {};
  const confirmations = CONFIRMATIONS.map((c) => ({ ...c, checked: att[c.key] === true }));
  const auto = (report && report.gates ? report.gates : []).filter((g) => g.id !== 'battery' && !(g.id === 'arming' && g.needsAttestation));
  const views = [...auto.map(gateView), ...extraChecks];
  const rank = { action: 0, unavailable: 1, unconfirmed: 1, checking: 2, passed: 3 };
  const needs = views.filter((v) => v.status !== 'passed').sort((a, b) => rank[a.status] - rank[b.status]);
  const passed = views.filter((v) => v.status === 'passed');
  const missing = confirmations.filter((c) => !c.checked);
  const remaining = needs.length + missing.length;
  return { confirmations, needs, passed, missing, remaining, views };
}

export function summaryText(model) {
  if (model.remaining === 0) return { kind: 'ok', headline: 'Ready to continue', detail: 'Every check passed and you confirmed each item. The next step is the physical safety checklist.' };
  const parts = [];
  if (model.missing.length) parts.push(`confirm ${model.missing.length === 1 ? 'the item' : 'the ' + countWord(model.missing.length).toLowerCase() + ' items'} under "Your safety confirmations"`);
  if (model.needs.length) parts.push(`resolve ${model.needs.slice(0, 3).map((n) => n.title).join(', ')}${model.needs.length > 3 ? ' and more' : ''}`);
  return {
    kind: model.needs.some((n) => n.status === 'action') ? 'no' : 'unk',
    headline: `${countWord(model.remaining)} ${plural(model.remaining, 'action', 'actions')} remaining`,
    detail: `To continue: ${parts.join(', then ')}.`,
  };
}

// ctx: { state, report, attestations, onAttest(patch), message, extraChecks?: view[], below?: Node[] (shown inside the summary section: the primary action and anything else), troubleshooting?: Node[] }
export function renderReadiness(root, ctx) {
  root.replaceChildren();
  const state = ctx.state;
  const wrap = el('div', 'dg-ready');
  wrap.dataset.state = state;
  wrap.setAttribute('aria-label', 'Aircraft readiness check');
  const live = el('p', 'hint dg-live'); live.setAttribute('role', 'status'); live.textContent = ctx.message || '';

  if (state === 'DISCONNECTED') { wrap.append(el('p', '', 'No aircraft connected.'), live); root.append(wrap); return wrap; }
  if (state === 'READING') {
    const s = section('Checking the aircraft', 'bt-sec-reading');
    const ul = el('ul', 'dg-checks'); ul.append(checkRow({ id: 'reading', title: 'Reading the flight controller', status: 'checking', text: 'This takes a few seconds. Nothing is changed on the aircraft.' }));
    s.append(ul); wrap.append(s, live); root.append(wrap); return wrap;
  }
  if (state === 'ERROR') { const e = el('p', 'form-error', ctx.message || 'The connection failed.'); wrap.append(e, live); root.append(wrap); return wrap; }

  const model = readinessModel(ctx.report, ctx.attestations, ctx.extraChecks || []);
  wrap.dataset.overall = ctx.report.overall;

  // 1. the user's confirmations
  const conf = section('Your safety confirmations', 'bt-sec-confirm');
  conf.append(el('p', 'hint', 'These cannot be read from the flight controller. Confirm each one yourself.'));
  const list = el('div', 'dg-confirms');
  for (const c of model.confirmations) list.append(confirmRow({ id: 'att-' + c.key, attest: c.key, label: c.label, help: c.help, checked: c.checked, onChange: (v) => ctx.onAttest({ [c.key]: v }) }));
  conf.append(list);
  wrap.append(conf);

  // 2. automatic checks: what needs attention first, then what passed
  const auto = section('Automatic aircraft checks', 'bt-sec-checks');
  auto.append(el('p', 'hint', 'The app reads these from the flight controller. Nothing is changed on the aircraft.'));
  if (model.needs.length) {
    const ul = el('ul', 'dg-checks'); ul.id = 'bt-needs';
    for (const v of model.needs) ul.append(checkRow(v));
    auto.append(ul);
  } else auto.append(el('p', 'dg-allclear', 'Nothing needs your attention here.'));
  if (model.passed.length) {
    const d = el('details', 'dg-passed'); d.id = 'bt-passed';
    d.append(el('summary', '', `${model.passed.length} ${plural(model.passed.length, 'check', 'checks')} passed`));
    const ul = el('ul', 'dg-checks'); for (const v of model.passed) ul.append(checkRow(v));
    d.append(ul); auto.append(d);
  }
  wrap.append(auto);

  // 3. the summary: what it means and the one thing to do next
  const sum = section('Readiness summary', 'bt-sec-summary');
  const t = summaryText(model);
  const banner = statusEl({ cls: t.kind, title: t.headline, detail: t.detail }); banner.id = 'bt-summary'; banner.dataset.remaining = String(model.remaining);
  banner.setAttribute('role', 'status');
  sum.append(banner);
  for (const n of ctx.below || []) sum.append(n);
  if (ctx.troubleshooting && ctx.troubleshooting.length && model.remaining > 0) {
    const d = el('details', 'dg-trouble'); d.id = 'bt-trouble'; d.append(el('summary', '', 'Troubleshooting'));
    for (const n of ctx.troubleshooting) d.append(n);
    sum.append(d);
  }
  wrap.append(sum, live);
  root.append(wrap);
  return wrap;
}
