// Motor bench test (Phase 3): interlock rules as pure functions. The state machine is the only caller that acts on them;
// the UI only displays the results. Nothing here sends anything.
import { BENCH_TIMINGS, CHECKLIST_ITEMS, DSHOT_STATS, MOTOR } from './constants.js';

// Blackbox readiness gates are DEFERRED (owner decision 2026-11-17): they never block the bench test, even if a caller
// asked the readiness module to include them. Blackbox analysis is outside the current product scope.
const DEFERRED_GATES = new Set(['blackbox', 'bb-mode', 'bb-fields', 'bb-rate', 'storage']);

// DShot error statistics (invalidPct per motor, hundredths of a percent) as 'usable' | 'excessive' | 'unavailable'.
// The sentinel 10000 is what a build without DShot statistics reports: "unavailable", never a 100 % failure and never a
// motor-health verdict. Anything missing or malformed is also unavailable (fail closed). Unavailable wins over excessive.
export function dshotStatus(values) {
  if (!Array.isArray(values) || values.length !== MOTOR.enabledMotors) return 'unavailable';
  let excessive = false;
  for (const v of values) {
    if (!Number.isFinite(v) || v < 0 || v >= DSHOT_STATS.unavailableSentinel_centi) return 'unavailable';
    if (v >= DSHOT_STATS.excessiveErrors_centi) excessive = true;
  }
  return excessive ? 'excessive' : 'usable';
}

const DSHOT_WHY = Object.freeze({
  unavailable: 'DShot error statistics are unavailable with the ESCs powered (this firmware build may not report them, or the telemetry is not active). Nonzero testing stays blocked. This is not a motor-health result.',
  excessive: 'The DShot error percentage is at or above the provisional limit. Nonzero testing stays blocked. This is not a motor-health result.',
  unknown: 'DShot error statistics have not been observed with the ESCs powered yet.',
  short: 'DShot error statistics have not been usable for long enough yet.',
});

// Phase 3 readiness policy over a Phase 2 report (src/preflight/readiness.js).
// The Phase 2 gates are the evidence. Policy: no gate may be 'fail' or 'unknown'. 'warn' (candidate firmware, attested items,
// flag-only bidirectional DShot) is acceptable ONLY because the allowlist match and the live checks later in the flow
// carry the real decision. The report's own `eligibleForActiveTest` is always false and is never consulted.
export function phase3Policy({ report, combo, mode, unlocked, transportKind }) {
  const blockers = [];
  if (!report || !Array.isArray(report.gates)) blockers.push({ id: 'readiness', reason: 'No readiness report.' });
  else {
    for (const g of report.gates) {
      if (DEFERRED_GATES.has(g.id)) continue;
      if (g.status === 'fail') blockers.push({ id: g.id, reason: `${g.title}: ${g.detected} (needs ${g.required})` });
      else if (g.status === 'unknown') blockers.push({ id: g.id, reason: `${g.title}: not established` });
    }
    const by = Object.fromEntries(report.gates.map((g) => [g.id, g]));
    for (const id of ['motor-count', 'protocol', 'bidir', '3d', 'arming', 'telemetry', 'firmware']) {
      if (!by[id]) blockers.push({ id, reason: `Gate ${id} is missing from the report.` });
    }
    if (by.transport) {
      const okKind = (transportKind === 'web-serial' && by.transport.status === 'pass') || (transportKind === 'mock' && by.transport.status === 'warn');
      if (!okKind) blockers.push({ id: 'transport', reason: 'The transport is not a granted USB serial connection or the synthetic mock.' });
    }
  }
  if (mode !== 'mock' && mode !== 'real') blockers.push({ id: 'mode', reason: 'Unknown mode.' });
  if (mode === 'real' && unlocked !== true) blockers.push({ id: 'unlock', reason: 'Real-hardware controls are locked for this session.' });
  const gatesOk = blockers.length === 0;
  const comboOk = !!(combo && combo.entry);
  return Object.freeze({
    gatesOk,
    stopValidationOk: gatesOk, // external 1000 only; allowed without an allowlist entry
    nonzeroOk: gatesOk && comboOk, // nonzero output needs an exact allowlist entry too
    comboReason: comboOk ? '' : (combo && combo.reason) || 'This combination is not on the owner-approved test allowlist.',
    blockers: Object.freeze(blockers),
  });
}

export function checklistComplete(checklist) {
  return !!checklist && CHECKLIST_ITEMS.every((i) => checklist.items[i.key] === true);
}

// Every condition that must hold before a nonzero output can be authorized. Returns [{ id, ok, why }].
// `facts` is the latest observation; `ctx` is the machine's context. A missing fact is a failed check (fail closed).
// opts.combined: the combined four-motor confirmation. Every check stays except the single-motor ones, which are replaced by
// "all four individual checks done", "every command and read-back proven at 1000" and "no fresh over-temperature reading".
export function startInterlocks(ctx, facts, now, opts = {}) {
  const f = facts || {};
  const stale = BENCH_TIMINGS.staleTelemetryFaultMs;
  const rpm = Array.isArray(f.rpm) ? f.rpm : null;
  const c = [];
  const add = (id, ok, why) => c.push({ id, ok: ok === true, why });
  add('mode-unlocked', ctx.mode === 'mock' || (ctx.mode === 'real' && ctx.unlocked === true), 'Real-hardware controls are locked.');
  add('allowlist', !!(ctx.policy && ctx.policy.nonzeroOk), ctx.policy ? ctx.policy.comboReason || 'Readiness gates are not all satisfied.' : 'No readiness policy.');
  add('four-motors', ctx.motorCount === MOTOR.enabledMotors, 'Exactly four motors are required.');
  add('safe-state', ctx.safeStateDone === true, 'USB-only external 1000 initialization with FC-side read-back is not done.');
  add('checklist', checklistComplete(ctx.checklist) && ctx.checklist.finalHold === true, 'The physical safety checklist and final confirmation are not complete.');
  add('marker', ctx.markerVerified === true, 'The unclean-session marker is not written and verified.');
  add('powered-zero', ctx.zeroVerified === true, 'Powered-zero verification is not complete.');
  // when the ESC identification step is part of the workflow: it must have run, 4-way must have been left with MSP proven, and a warning must be acknowledged
  const esc = ctx.esc || { enabled: false };
  add('esc-identification', !esc.enabled || (esc.scanned === true && esc.identityOk === true && (!esc.ackRequired || esc.acknowledged === true)), 'The ESC identification step, or its warning acknowledgement, is not complete.');
  const d = ctx.dshot || {};
  const dshotOk = d.status === 'usable' && Number.isFinite(d.since) && Number.isFinite(d.lastAt) && d.lastAt - d.since >= DSHOT_STATS.usableForMs && now - d.lastAt <= stale;
  add('dshot-stats', dshotOk, DSHOT_WHY[d.status === 'usable' ? 'short' : d.status] || DSHOT_WHY.unknown);
  add('disarmed', f.armed === false, 'The aircraft is not confirmed disarmed.');
  if (opts.combined) {
    const done = new Set(ctx.completedMotors || []);
    add('four-individual-complete', [0, 1, 2, 3].every((m) => done.has(m)) && ctx.combinedDone !== true, 'All four individual motor checks must be complete, and the combined confirmation not yet run.');
    const cmd = Array.isArray(f.commanded) ? f.commanded : null;
    const rb = f.readback;
    add('all-stopped-proven', cmd !== null && cmd.length === MOTOR.enabledMotors && cmd.every((v) => v === MOTOR.stopValue) && !!rb && rb.current === true && Number.isFinite(rb.at) && now - rb.at <= BENCH_TIMINGS.readbackStaleMs && Array.isArray(rb.values) && rb.values.slice(0, MOTOR.enabledMotors).every((v) => v === MOTOR.stopValue), 'All four motors are not proven at external 1000 (command and fresh read-back).');
    add('no-over-temperature', !(Array.isArray(f.tempsC) && f.tempsC.some((t) => Number.isFinite(t) && t >= BENCH_TIMINGS.escTempFaultC)), 'A fresh ESC temperature reading is at or above the fault limit.');
  } else {
    add('one-motor', Number.isInteger(ctx.selectedMotor) && ctx.selectedMotor >= 0 && ctx.selectedMotor < MOTOR.enabledMotors, 'Exactly one motor must be selected.');
    add('target-confirmed', ctx.selectedMotor !== null && ctx.targetConfirmed === ctx.selectedMotor, 'The physical motor to be tested is not confirmed.');
  }
  add('telemetry-fresh', rpm !== null && rpm.length === MOTOR.enabledMotors && Number.isFinite(f.telemetryAt) && now - f.telemetryAt <= stale, 'RPM telemetry is not fresh and valid.');
  add('all-rpm-zero', rpm !== null && rpm.every((r) => r === 0), 'A motor reports nonzero RPM.');
  add('inter-sweep-settle', ctx.lastStopProofAt === null || now - ctx.lastStopProofAt >= BENCH_TIMINGS.interSweepSettleMs, 'Wait for the zero-output settle interval after the previous motor (about 5 seconds, provisional).');
  add('transport', ctx.transportAvailable === true, 'The connection is not available.');
  add('no-fault', ctx.fault === null, 'The session is locked.');
  return c;
}
