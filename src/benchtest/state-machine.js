// Motor bench test (Phase 3): THE safety state machine. Backlog sections 4.3, 5, 17.1, 22; hazard analysis H1 to H10.
//
// One authoritative machine. It owns every decision that matters: which events are valid in which state, what counts as a
// fault, whether a motor output may be sent and how high, and when the recovery marker may be cleared. The controller only
// reports facts (events and observations) and executes the effects this machine returns. The UI only displays capabilities().
//
// Pure: no I/O, no timers, no storage, no network, no transport. Time comes from the caller (`now` in events). That makes
// every transition deterministic and testable.
//
// Fail closed: an unknown state, an unknown event, an invalid transition or an exception inside a handler never grants
// anything. In states where a motor could be energised an invalid event faults the session.
import { BENCH_TIMINGS, CHECKLIST_ITEMS, EXPECTED_POSITIONS, MOTOR, POSITION_NONE, UNLOCK_PHRASE } from './constants.js';
import { checklistComplete, dshotStatus, phase3Policy, startInterlocks } from './interlocks.js';

export const STATE = Object.freeze({
  DISCONNECTED: 'DISCONNECTED',
  READ_ONLY_READINESS: 'READ_ONLY_READINESS',
  STOP_VALIDATION_ONLY: 'STOP_VALIDATION_ONLY', // USB-only (battery attested disconnected): external 1000 and nothing else; FC command/read-back check
  SAFE_STATE_INIT: 'SAFE_STATE_INIT',
  SAFETY_CHECKLIST: 'SAFETY_CHECKLIST',
  READY_TO_CONNECT_POWER: 'READY_TO_CONNECT_POWER',
  POWER_CONNECT_RECONNECT: 'POWER_CONNECT_RECONNECT',
  POWERED_ZERO_VERIFICATION: 'POWERED_ZERO_VERIFICATION',
  POWERED_STOP_VALIDATION: 'POWERED_STOP_VALIDATION', // powered stop validation flow only: external 1000 and nothing else, battery connected
  MOTOR_READY: 'MOTOR_READY',
  RUNNING: 'RUNNING',
  VERIFYING_STOP: 'VERIFYING_STOP',
  LOCKED_FAULT: 'LOCKED_FAULT',
  BATTERY_REMOVAL_RECOVERY: 'BATTERY_REMOVAL_RECOVERY',
  UNCLEAN_EXIT_RECOVERY: 'UNCLEAN_EXIT_RECOVERY',
  BENCH_COMPLETE: 'BENCH_COMPLETE',
});
const S = STATE;

// States in which an external 1000 may be sent. DISCONNECTED and READ_ONLY_READINESS have no motor path at all.
const STOP_CAPABLE = new Set([S.STOP_VALIDATION_ONLY, S.SAFE_STATE_INIT, S.SAFETY_CHECKLIST, S.READY_TO_CONNECT_POWER, S.POWER_CONNECT_RECONNECT,
  S.POWERED_ZERO_VERIFICATION, S.POWERED_STOP_VALIDATION, S.MOTOR_READY, S.RUNNING, S.VERIFYING_STOP, S.LOCKED_FAULT, S.BATTERY_REMOVAL_RECOVERY, S.UNCLEAN_EXIT_RECOVERY, S.BENCH_COMPLETE]);
// Invalid events in these states fault the session; elsewhere they are only rejected.
const FAULT_ON_INVALID = new Set([S.STOP_VALIDATION_ONLY, S.SAFE_STATE_INIT, S.SAFETY_CHECKLIST, S.READY_TO_CONNECT_POWER, S.POWER_CONNECT_RECONNECT,
  S.POWERED_ZERO_VERIFICATION, S.POWERED_STOP_VALIDATION, S.MOTOR_READY, S.RUNNING, S.VERIFYING_STOP]);
const QUIET = new Set(['OBSERVE', 'STOP_SENT', 'STOP_ACKED', 'READBACK', 'ACK_RESULT']);
const TRACE_MAX = 600;
const n = BENCH_TIMINGS;

const freshStop = () => ({ attempts: 0, acks: 0, readbackOk: false, zeroSince: null, zeroOk: false, userNoRotation: false });
const freshZero = () => ({ since: null, samples: 0, lastAt: null });
const freshDshot = () => ({ status: 'unknown', since: null, lastAt: null }); // DShot error statistics seen with the ESCs powered
const freshMarkerClear = () => ({ pending: false, failed: false });

function freshCtx(extra = {}) {
  return {
    mode: null, transportKind: null, transportAvailable: false, unlocked: false,
    readinessReport: null, combo: null, policy: null, motorCount: null,
    safeStateDone: false, checklist: { items: {}, finalHold: false }, markerAvailable: true, markerVerified: false,
    batteryDeclared: false, reconnected: false, zeroVerified: false, zero: freshZero(), baselineVoltage_cV: null,
    selectedMotor: null, targetConfirmed: null, runAuthorized: false, runResult: null, purpose: null,
    completedMotors: [], lastStopProofAt: null, positionOk: false,
    fault: null, stop: freshStop(), facts: null, runStartedAt: null, batteryRemoved: false, markerCleared: false, graceStartedAt: null,
    flow: null, // 'usb-stopval' | 'powered-stopval' | 'bench': which workflow this connection is in; only 'bench' can ever reach MOTOR_READY
    usbStopValidated: false, poweredStopValidated: false,
    dshot: freshDshot(), markerClear: freshMarkerClear(),
    ...extra,
  };
}

const isPowered = (state, ctx) => state === S.POWER_CONNECT_RECONNECT || state === S.POWERED_ZERO_VERIFICATION || state === S.POWERED_STOP_VALIDATION || state === S.MOTOR_READY || state === S.RUNNING
  || state === S.VERIFYING_STOP || (state === S.READY_TO_CONNECT_POWER && ctx.batteryDeclared);
const proofParts = (ctx) => ctx.stop.attempts >= n.stopMinAttempts && ctx.stop.readbackOk && ctx.stop.zeroOk;
const proofComplete = (ctx) => proofParts(ctx) && ctx.stop.userNoRotation;

export function createMachine(opts = {}) {
  let state = opts.markerPresent ? S.UNCLEAN_EXIT_RECOVERY : S.DISCONNECTED;
  let ctx = freshCtx({ markerAvailable: opts.markerAvailable !== false });
  const trace = [];
  let seq = 0;

  const log = (at, from, event, to, ok, reason) => {
    if (trace.length >= TRACE_MAX) trace.shift();
    trace.push({ seq: ++seq, at, from, event, to, ok, reason: reason || '' });
  };

  // ---- fault: the only way into LOCKED_FAULT. Expires everything that must not survive a fault.
  function enterFault(reason, transportAvailable, at) {
    const fromPowered = isPowered(state, ctx) || state === S.RUNNING;
    ctx.fault = { reason, at, transportAvailable: !!transportAvailable, fromState: state, fromPowered };
    ctx.unlocked = false;
    ctx.checklist = { items: {}, finalHold: false };
    ctx.runAuthorized = false;
    ctx.selectedMotor = null; ctx.targetConfirmed = null; ctx.positionOk = false;
    ctx.zeroVerified = false; ctx.safeStateDone = false;
    ctx.transportAvailable = !!transportAvailable;
    ctx.stop = freshStop();
    ctx.batteryRemoved = false;
    state = S.LOCKED_FAULT;
    return [{ type: 'stop-and-prove' }];
  }

  function toDisconnected() {
    const keep = { markerAvailable: ctx.markerAvailable, markerCleared: ctx.markerCleared };
    ctx = freshCtx({ markerAvailable: keep.markerAvailable });
    state = S.DISCONNECTED;
  }

  // ---- permission to send a motor value. The motor-control boundary asks this before every frame.
  function motorCommandPermission(req) {
    const deny = (reason) => ({ ok: false, maxValue: 0, reason });
    try {
      if (!req || (req.kind !== 'stop' && req.kind !== 'output')) return deny('unknown request');
      if (!STOP_CAPABLE.has(state)) return deny(`no motor output in ${state}`);
      if (req.kind === 'stop' || req.value === MOTOR.stopValue) return { ok: true, maxValue: MOTOR.stopValue, reason: '' };
      // nonzero: only RUNNING, only the selected motor, only under an authorized run
      if (state !== S.RUNNING || ctx.flow !== 'bench') return deny(`nonzero output is not permitted in ${state}`);
      if (ctx.runAuthorized !== true || ctx.fault !== null || ctx.transportAvailable !== true) return deny('the run is not authorized');
      if (!Number.isInteger(req.motor) || req.motor !== ctx.selectedMotor) return deny('only the selected motor may be commanded');
      if (!Number.isInteger(req.value) || req.value < MOTOR.startValue || req.value > MOTOR.cap) return deny('value outside the permitted range');
      return { ok: true, maxValue: MOTOR.cap, reason: '' };
    } catch { return deny('error while deciding'); }
  }

  function trackDshot(p, telFresh) {
    if (!telFresh) return; // stale telemetry already faults in the live states; never read statistics from a stale frame
    const status = dshotStatus(p.dshotInvalidPct_centi);
    const d = ctx.dshot;
    if (status !== d.status) { d.status = status; d.since = status === 'usable' ? p.telemetryAt : null; }
    d.lastAt = p.telemetryAt;
  }

  // ---- observation handling: all fault detection from measurements lives here
  function observe(p) {
    const now = p.now;
    ctx.facts = { ...p };
    const rpm = Array.isArray(p.rpm) && p.rpm.length === MOTOR.enabledMotors && p.rpm.every((r) => Number.isFinite(r) && r >= 0) ? p.rpm : null;
    const telFresh = rpm !== null && Number.isFinite(p.telemetryAt) && now - p.telemetryAt <= n.staleTelemetryFaultMs;

    // stop-proof zero tracking (also used for recovery proofs)
    if (state === S.VERIFYING_STOP || state === S.LOCKED_FAULT || state === S.BATTERY_REMOVAL_RECOVERY || state === S.STOP_VALIDATION_ONLY || state === S.POWERED_STOP_VALIDATION || state === S.SAFE_STATE_INIT) {
      if (telFresh && rpm.every((r) => r === 0)) {
        if (ctx.stop.zeroSince === null) ctx.stop.zeroSince = p.telemetryAt;
        if (now - ctx.stop.zeroSince >= n.stopProofZeroRpmMs && ctx.stop.attempts > 0) ctx.stop.zeroOk = true;
      } else { ctx.stop.zeroSince = null; ctx.stop.zeroOk = false; }
    }

    // DShot error statistics only count with the ESCs powered (never in the USB-only states): see DSHOT_STATS in constants.js
    if (state === S.POWERED_ZERO_VERIFICATION || state === S.POWERED_STOP_VALIDATION || state === S.MOTOR_READY || state === S.RUNNING) trackDshot(p, telFresh);

    const live = state === S.POWERED_ZERO_VERIFICATION || state === S.POWERED_STOP_VALIDATION || state === S.MOTOR_READY || state === S.RUNNING || (state === S.READY_TO_CONNECT_POWER && ctx.batteryDeclared);
    if (!live) return { ok: true };
    const fail = (reason) => ({ ok: true, fault: reason });

    if (!telFresh) return fail('telemetry-stale-or-unavailable');
    if (p.armed === true) return fail('arming-state-changed');
    if (p.armed !== false || !Number.isFinite(p.armedAt) || now - p.armedAt > n.statusStaleMs) return fail('arming-state-unavailable');
    if (state === S.RUNNING) {
      for (let i = 0; i < rpm.length; i++) {
        if (i !== ctx.selectedMotor && rpm[i] !== 0) return fail('peer-motor-rpm');
      }
      if (rpm[ctx.selectedMotor] > n.rpmCeiling) return fail('rpm-above-plausibility-ceiling');
      // statistics lost or excessive during a real run: abort to the stop and recovery path (never a motor-health verdict)
      if (ctx.dshot.status === 'unavailable') return fail('dshot-statistics-unavailable');
      if (ctx.dshot.status === 'excessive') return fail('dshot-errors-excessive');
    } else if (rpm.some((r) => r !== 0)) return fail(state === S.POWERED_ZERO_VERIFICATION ? 'rotation-during-zero-verification' : 'unexpected-rotation');
    if (ctx.baselineVoltage_cV !== null && Number.isFinite(p.voltage_cV) && p.voltage_cV > 0 && ctx.baselineVoltage_cV - p.voltage_cV > n.voltageSagFault_cV) return fail('voltage-fault');
    if (Array.isArray(p.tempsC) && p.tempsC.some((t) => Number.isFinite(t) && t >= n.escTempFaultC)) return fail('temperature-fault');
    // FC-side read-back against what the boundary last commanded: the stop value must read back exactly
    if (p.readback && p.readback.current !== false && Array.isArray(p.readback.values) && Array.isArray(p.commanded)) {
      for (let i = 0; i < MOTOR.enabledMotors; i++) {
        const want = p.commanded[i], got = p.readback.values[i];
        const tol = want === MOTOR.stopValue ? 0 : n.readbackToleranceNonzero;
        if (!Number.isFinite(got) || Math.abs(got - want) > tol) return fail('readback-mismatch');
      }
    }
    if (state === S.RUNNING && (!p.readback || !Number.isFinite(p.readback.at) || now - p.readback.at > n.readbackStaleMs)) return fail('readback-unavailable');

    if (state === S.POWERED_ZERO_VERIFICATION) {
      if (ctx.zero.since === null) ctx.zero.since = p.telemetryAt;
      if (p.telemetryAt !== ctx.zero.lastAt) { ctx.zero.samples++; ctx.zero.lastAt = p.telemetryAt; }
      if (now - ctx.zero.since >= n.poweredZeroObservationMs && ctx.zero.samples >= n.poweredZeroMinSamples) return { ok: true, auto: 'zero-verified' };
    }
    return { ok: true };
  }

  // ---- transitions. Each entry: guard(payload) -> true | reason string; apply(payload) -> effects[]; `to` is a state or SELF.
  const SELF = 'SELF';
  const zeroDone = () => ctx.zero.since !== null && ctx.zero.samples >= n.poweredZeroMinSamples;
  const T = (to, guard, apply) => ({ to, guard, apply });
  const connectGuard = (p) => ((p.transportKind === 'mock' || p.transportKind === 'web-serial') ? true : 'unknown transport kind');
  const connectApply = (p) => {
    ctx = freshCtx({ markerAvailable: ctx.markerAvailable, batteryRemoved: ctx.batteryRemoved && state === S.UNCLEAN_EXIT_RECOVERY });
    ctx.transportKind = p.transportKind; ctx.mode = p.transportKind === 'mock' ? 'mock' : 'real'; ctx.transportAvailable = true;
    return [];
  };

  const TABLE = {
    [S.DISCONNECTED]: {
      CONNECT: T(S.READ_ONLY_READINESS, connectGuard, connectApply),
    },
    [S.UNCLEAN_EXIT_RECOVERY]: {
      BATTERY_REMOVED_CONFIRMED: T(SELF, null, () => { ctx.batteryRemoved = true; return []; }),
      CONNECT: T(S.BATTERY_REMOVAL_RECOVERY, connectGuard, (p) => {
        const removed = ctx.batteryRemoved;
        connectApply(p); ctx.batteryRemoved = removed; ctx.stop = freshStop(); ctx.fault = { reason: 'unclean-exit', at: p.now, transportAvailable: true, fromState: S.UNCLEAN_EXIT_RECOVERY, fromPowered: true };
        return [{ type: 'stop-and-prove' }];
      }),
    },
    [S.READ_ONLY_READINESS]: {
      READINESS_UPDATE: T(SELF, null, (p) => { ctx.readinessReport = p.report; ctx.combo = p.combo || null; ctx.motorCount = p.motorCount ?? ctx.motorCount; recomputePolicy(); return []; }),
      UNLOCK: T(SELF, (p) => (ctx.mode !== 'real' ? 'mock mode needs no unlock' : p.phrase === UNLOCK_PHRASE && p.acknowledged === true ? true : 'the unlock phrase and acknowledgement are required'),
        () => { ctx.unlocked = true; recomputePolicy(); return []; }),
      LOCK: T(SELF, null, () => { ctx.unlocked = false; recomputePolicy(); return []; }),
      READINESS_OK: T(S.SAFE_STATE_INIT, () => (ctx.policy && ctx.policy.nonzeroOk ? true : 'readiness or the allowlist is not satisfied'), () => { ctx.flow = 'bench'; return [{ type: 'start-safe-state' }]; }),
      // USB-only stop validation (battery attested disconnected): an FC command and read-back check, not proof of a physical stop
      ENTER_STOP_VALIDATION: T(S.STOP_VALIDATION_ONLY, () => (ctx.policy && ctx.policy.stopValidationOk ? true : 'readiness gates are not satisfied'), () => { ctx.stop = freshStop(); ctx.flow = 'usb-stopval'; return [{ type: 'start-stop-validation' }]; }),
      // Powered stop validation: the full physical-safety flow (safe state, fresh checklist, final hold, verified marker, ready to connect power).
      // Needs the USB-only validation first and no allowlist entry (the entry itself needs this evidence); it can never reach MOTOR_READY.
      ENTER_POWERED_STOP_VALIDATION: T(S.SAFE_STATE_INIT, () => {
        if (!(ctx.policy && ctx.policy.stopValidationOk)) return 'readiness gates are not satisfied';
        if (ctx.usbStopValidated !== true) return 'complete the USB-only stop validation first';
        return ctx.markerAvailable ? true : 'browser storage is unavailable, so the recovery marker cannot be written';
      }, () => { ctx.flow = 'powered-stopval'; ctx.stop = freshStop(); return [{ type: 'start-safe-state' }]; }),
      TRANSPORT_LOST: T(S.DISCONNECTED, null, () => { toDisconnected(); return []; }),
      RESET: T(S.DISCONNECTED, null, () => { toDisconnected(); return []; }),
    },
    [S.STOP_VALIDATION_ONLY]: {
      STOP_VALIDATION_DONE: T(S.READ_ONLY_READINESS, () => (proofComplete(ctx) ? true : 'the stop proof is not complete'), () => { ctx.usbStopValidated = true; ctx.flow = null; ctx.stop = freshStop(); return []; }),
      LEAVE_STOP_VALIDATION: T(S.READ_ONLY_READINESS, null, () => { ctx.flow = null; ctx.stop = freshStop(); return []; }),
      USER_CONFIRMS_NO_ROTATION: T(SELF, () => (proofParts(ctx) ? true : 'stop proof parts 1 to 3 are not complete'), () => { ctx.stop.userNoRotation = true; return []; }),
      TRANSPORT_LOST: T(S.DISCONNECTED, null, () => { toDisconnected(); return []; }),
    },
    [S.SAFE_STATE_INIT]: {
      SAFE_STATE_DONE: T(S.SAFETY_CHECKLIST, () => (ctx.stop.acks >= 1 && ctx.stop.attempts >= n.stopMinAttempts && ctx.stop.readbackOk ? true : 'external 1000 and FC-side read-back are not complete'),
        () => { ctx.safeStateDone = true; ctx.checklist = { items: {}, finalHold: false }; return []; }),
      TRANSPORT_LOST: T(S.DISCONNECTED, null, () => { toDisconnected(); return []; }),
    },
    [S.SAFETY_CHECKLIST]: {
      CHECKLIST_ITEM: T(SELF, (p) => (CHECKLIST_ITEMS.some((i) => i.key === p.key) && typeof p.value === 'boolean' ? true : 'unknown checklist item'),
        (p) => { ctx.checklist.items[p.key] = p.value; if (!p.value) ctx.checklist.finalHold = false; ctx.markerVerified = false; return []; }),
      FINAL_HOLD_DONE: T(SELF, (p) => (checklistComplete(ctx.checklist) && p.holdMs >= n.holdFinalConfirmMs ? true : 'every item and a full hold are required'), () => { ctx.checklist.finalHold = true; return []; }),
      MARKER_RESULT: T(SELF, null, (p) => { ctx.markerVerified = p.ok === true; return []; }),
      CHECKLIST_COMPLETE: T(S.READY_TO_CONNECT_POWER, () => (checklistComplete(ctx.checklist) && ctx.checklist.finalHold && ctx.markerAvailable && ctx.markerVerified && ctx.safeStateDone ? true : 'checklist, final confirmation or the recovery marker is missing'),
        () => { ctx.batteryDeclared = false; return []; }),
      VISIBILITY_LOST: T(SELF, null, () => { ctx.checklist = { items: {}, finalHold: false }; ctx.markerVerified = false; return []; }),
      TRANSPORT_LOST: T(S.DISCONNECTED, null, () => { toDisconnected(); return []; }),
    },
    [S.READY_TO_CONNECT_POWER]: {
      BATTERY_DECLARED: T(SELF, null, (p) => { ctx.batteryDeclared = true; ctx.graceStartedAt = p.now; return []; }),
      ESC_READY: T(S.POWERED_ZERO_VERIFICATION, () => (ctx.batteryDeclared ? true : 'the battery has not been declared connected'), () => { ctx.zero = freshZero(); ctx.dshot = freshDshot(); ctx.zeroVerified = false; return []; }),
      TRANSPORT_LOST: T(S.POWER_CONNECT_RECONNECT, () => (ctx.batteryDeclared ? true : 'no battery was declared'), (p) => { ctx.transportAvailable = false; ctx.graceStartedAt = p.now; ctx.reconnected = false; ctx.safeStateDone = false; return []; }),
      VISIBILITY_LOST: T(S.SAFETY_CHECKLIST, () => (!ctx.batteryDeclared ? true : 'powered: a fault'), () => { ctx.checklist = { items: {}, finalHold: false }; ctx.markerVerified = false; return []; }),
    },
    [S.POWER_CONNECT_RECONNECT]: {
      RECONNECTED: T(SELF, (p) => (p.now - ctx.graceStartedAt <= n.reconnectGraceMs ? true : 'the reconnect grace period has expired'), (p) => { ctx.transportAvailable = true; ctx.reconnected = true; ctx.stop = freshStop(); ctx.transportKind = p.transportKind || ctx.transportKind; return [{ type: 'start-safe-state' }]; }),
      SAFE_STATE_DONE: T(SELF, () => (ctx.reconnected && ctx.stop.acks >= 1 && ctx.stop.attempts >= n.stopMinAttempts && ctx.stop.readbackOk ? true : 'safe-state re-initialization is not complete'), () => { ctx.safeStateDone = true; return []; }),
      ESC_READY: T(S.POWERED_ZERO_VERIFICATION, () => (ctx.reconnected && ctx.safeStateDone ? true : 'reconnect and safe-state re-initialization are not complete'), () => { ctx.zero = freshZero(); ctx.dshot = freshDshot(); ctx.zeroVerified = false; return []; }),
      GRACE_EXPIRED: T(S.LOCKED_FAULT, (p) => (p.now - ctx.graceStartedAt > n.reconnectGraceMs ? true : 'the grace period is still running'), (p) => enterFault('reconnect-grace-expired', false, p.now)),
      TRANSPORT_LOST: T(SELF, null, () => { ctx.transportAvailable = false; ctx.reconnected = false; ctx.safeStateDone = false; return []; }),
    },
    [S.POWERED_ZERO_VERIFICATION]: {
      ZERO_VERIFIED: T(S.MOTOR_READY, () => (ctx.flow !== 'bench' ? 'this workflow can never reach MOTOR_READY' : zeroDone() ? true : 'zero verification is not complete'),
        () => { ctx.zeroVerified = true; ctx.baselineVoltage_cV = ctx.facts && Number.isFinite(ctx.facts.voltage_cV) && ctx.facts.voltage_cV > 0 ? ctx.facts.voltage_cV : null; return []; }),
      // powered stop validation flow: after the powered-zero window, prove the stop with the battery connected (external 1000 only)
      ZERO_VERIFIED_STOPVAL: T(S.POWERED_STOP_VALIDATION, () => (ctx.flow !== 'powered-stopval' ? 'not the powered stop validation workflow' : zeroDone() ? true : 'zero verification is not complete'),
        () => { ctx.zeroVerified = true; ctx.purpose = 'stopval'; ctx.stop = freshStop(); return [{ type: 'start-stop-proof' }]; }),
    },
    [S.POWERED_STOP_VALIDATION]: {
      USER_CONFIRMS_NO_ROTATION: T(SELF, () => (proofParts(ctx) ? true : 'stop proof parts 1 to 3 are not complete'), () => { ctx.stop.userNoRotation = true; return []; }),
      POWERED_STOP_VALIDATION_DONE: T(S.BENCH_COMPLETE, () => (ctx.flow === 'powered-stopval' && proofComplete(ctx) ? true : 'the powered stop proof is not complete'),
        (p) => { ctx.poweredStopValidated = true; ctx.lastStopProofAt = p.now; ctx.batteryRemoved = false; return []; }),
    },
    [S.MOTOR_READY]: {
      SELECT_MOTOR: T(SELF, (p) => (Number.isInteger(p.motor) && p.motor >= 0 && p.motor < MOTOR.enabledMotors ? true : 'select exactly one of the four motors'), (p) => { ctx.selectedMotor = p.motor; ctx.targetConfirmed = null; ctx.positionOk = false; return []; }),
      CONFIRM_TARGET: T(SELF, (p) => (ctx.selectedMotor !== null && p.motor === ctx.selectedMotor ? true : 'the confirmed motor is not the selected motor'), (p) => { ctx.targetConfirmed = p.motor; return []; }),
      START_HOLD_COMPLETE: T(S.RUNNING, (p) => {
        if (!(p.holdMs >= n.holdStartMs)) return 'the start hold was too short';
        const bad = startInterlocks(ctx, ctx.facts, p.now).filter((c) => !c.ok);
        return bad.length ? `interlock: ${bad.map((b) => b.id).join(', ')}` : true;
      }, (p) => { ctx.runAuthorized = true; ctx.runResult = null; ctx.purpose = 'run'; ctx.runStartedAt = p.now; return [{ type: 'start-sweep' }]; }),
      FINISH_BENCH: T(S.VERIFYING_STOP, null, () => { ctx.purpose = 'finish'; ctx.stop = freshStop(); ctx.selectedMotor = null; ctx.targetConfirmed = null; return [{ type: 'start-stop-proof' }]; }),
    },
    [S.RUNNING]: {
      RUN_COMPLETE: T(S.VERIFYING_STOP, (p) => (p.result === 'completed' ? true : 'only a completed run proceeds to stop verification'), (p) => { ctx.runAuthorized = false; ctx.runResult = p.result; ctx.stop = freshStop(); ctx.positionOk = false; ctx.purpose = 'run'; return [{ type: 'start-stop-proof' }]; }),
      RUN_ABORTED: T(S.LOCKED_FAULT, null, (p) => enterFault(p.reason || 'run-aborted', true, p.now)),
    },
    [S.VERIFYING_STOP]: {
      USER_CONFIRMS_NO_ROTATION: T(SELF, () => (proofParts(ctx) ? true : 'stop proof parts 1 to 3 are not complete'), () => { ctx.stop.userNoRotation = true; return []; }),
      POSITION_REPORTED: T(S.MOTOR_READY, (p) => (ctx.purpose === 'run' && proofComplete(ctx) && typeof p.physical === 'string' && p.physical === EXPECTED_POSITIONS[ctx.selectedMotor] ? true : 'position unconfirmed or mismatched'),
        (p) => { ctx.completedMotors = [...ctx.completedMotors, ctx.selectedMotor]; ctx.lastStopProofAt = p.now; ctx.selectedMotor = null; ctx.targetConfirmed = null; ctx.stop = freshStop(); return []; }),
      FINISH_STOP_DONE: T(S.BENCH_COMPLETE, () => (ctx.purpose === 'finish' && proofComplete(ctx) ? true : 'the final stop proof is not complete'), (p) => { ctx.lastStopProofAt = p.now; ctx.batteryRemoved = false; return []; }),
    },
    [S.LOCKED_FAULT]: {
      USER_CONFIRMS_NO_ROTATION: T(SELF, () => (proofParts(ctx) && ctx.transportAvailable ? true : 'stop proof parts 1 to 3 are not complete'), () => { ctx.stop.userNoRotation = true; return []; }),
      BEGIN_BATTERY_REMOVAL: T(S.BATTERY_REMOVAL_RECOVERY, null, () => []),
      TRANSPORT_LOST: T(SELF, null, () => { ctx.transportAvailable = false; ctx.fault.transportAvailable = false; return []; }),
    },
    [S.BATTERY_REMOVAL_RECOVERY]: {
      BATTERY_REMOVED_CONFIRMED: T(SELF, null, () => { ctx.batteryRemoved = true; return []; }),
      RECONNECTED: T(SELF, (p) => (p.transportKind === 'mock' || p.transportKind === 'web-serial' ? true : 'unknown transport'), (p) => { ctx.transportAvailable = true; ctx.transportKind = p.transportKind; ctx.mode = p.transportKind === 'mock' ? 'mock' : 'real'; ctx.stop = freshStop(); return [{ type: 'stop-and-prove' }]; }),
      USER_CONFIRMS_NO_ROTATION: T(SELF, () => (proofParts(ctx) && ctx.transportAvailable ? true : 'stop proof parts 1 to 3 are not complete'), () => { ctx.stop.userNoRotation = true; return []; }),
      // Completing recovery only REQUESTS the marker deletion. The machine stays locked here until the deletion is confirmed
      // (MARKER_CLEAR_RESULT ok); a failed deletion keeps it locked and RETRY_MARKER_CLEAR tries again.
      RECOVERY_COMPLETE: T(SELF, () => (!(ctx.batteryRemoved && proofComplete(ctx)) ? 'battery removal and the full stop proof are both required' : ctx.markerClear.pending || ctx.markerClear.failed ? 'the marker deletion is already requested' : true),
        () => { ctx.markerClear = { pending: true, failed: false }; return [{ type: 'clear-marker' }]; }),
      RETRY_MARKER_CLEAR: T(SELF, () => (ctx.markerClear.failed && !ctx.markerClear.pending && ctx.batteryRemoved && proofComplete(ctx) ? true : 'there is no failed marker deletion to retry'),
        () => { ctx.markerClear = { pending: true, failed: false }; return [{ type: 'clear-marker' }]; }),
      MARKER_CLEAR_RESULT: T(SELF, () => (ctx.markerClear.pending ? true : 'no marker deletion is pending'),
        (p) => { if (p.ok === true) toDisconnected(); else ctx.markerClear = { pending: false, failed: true }; return []; }),
      TRANSPORT_LOST: T(SELF, null, () => { ctx.transportAvailable = false; return []; }),
    },
    [S.BENCH_COMPLETE]: {
      // markerCleared becomes true only when MARKER_CLEAR_RESULT reports the deletion confirmed; Reset needs it.
      BATTERY_REMOVED_CONFIRMED: T(SELF, () => (!proofComplete(ctx) ? 'the stop proof is not complete' : ctx.markerClear.pending || ctx.markerClear.failed || ctx.markerCleared ? 'the marker deletion is already requested' : true),
        () => { ctx.batteryRemoved = true; ctx.markerClear = { pending: true, failed: false }; return [{ type: 'clear-marker' }]; }),
      RETRY_MARKER_CLEAR: T(SELF, () => (ctx.markerClear.failed && !ctx.markerClear.pending && ctx.batteryRemoved && proofComplete(ctx) ? true : 'there is no failed marker deletion to retry'),
        () => { ctx.markerClear = { pending: true, failed: false }; return [{ type: 'clear-marker' }]; }),
      MARKER_CLEAR_RESULT: T(SELF, () => (ctx.markerClear.pending ? true : 'no marker deletion is pending'),
        (p) => { if (p.ok === true) { ctx.markerCleared = true; ctx.markerClear = freshMarkerClear(); } else ctx.markerClear = { pending: false, failed: true }; return []; }),
      RESET: T(S.DISCONNECTED, () => (ctx.markerCleared ? true : 'battery removal and the marker deletion are not confirmed'), () => { toDisconnected(); return []; }),
      TRANSPORT_LOST: T(SELF, null, () => { ctx.transportAvailable = false; return []; }),
    },
  };

  function recomputePolicy() {
    ctx.policy = ctx.readinessReport ? phase3Policy({ report: ctx.readinessReport, combo: ctx.combo, mode: ctx.mode, unlocked: ctx.unlocked, transportKind: ctx.transportKind }) : null;
  }

  const own = (st, ev) => (Object.prototype.hasOwnProperty.call(TABLE, st) && Object.prototype.hasOwnProperty.call(TABLE[st], ev) ? TABLE[st][ev] : null);

  function dispatch(event, payloadIn) {
    const payload = payloadIn && typeof payloadIn === 'object' ? payloadIn : {};
    const at = Number.isFinite(payload.now) ? payload.now : 0;
    const from = state;
    const result = (ok, reason, effects = []) => ({ ok, from, to: state, reason: reason || '', effects });
    try {
      if (!Object.prototype.hasOwnProperty.call(TABLE, state)) { // unknown or corrupt state: fail closed, never grant anything
        const fx = enterFault('unknown-state', false, at);
        log(at, from, event, state, false, 'unknown state');
        return result(false, 'unknown state', fx);
      }
      // quiet counters and observations
      if (event === 'STOP_SENT') {
        if (!STOP_CAPABLE.has(state)) return result(false, 'not applicable');
        ctx.stop.attempts++;
        return result(true);
      }
      if (event === 'STOP_ACKED') {
        if (!STOP_CAPABLE.has(state)) return result(false, 'not applicable');
        ctx.stop.acks++;
        return result(true);
      }
      if (event === 'READBACK') {
        if (!STOP_CAPABLE.has(state)) return result(false, 'not applicable');
        const v = payload.values;
        const ok = Array.isArray(v) && v.length >= MOTOR.enabledMotors && v.slice(0, MOTOR.enabledMotors).every((x) => x === MOTOR.stopValue);
        // a read-back only counts after at least one stop attempt in this proof
        ctx.stop.readbackOk = ok && ctx.stop.attempts >= 1;
        return result(true);
      }
      if (event === 'ACK_RESULT') {
        if (!STOP_CAPABLE.has(state) || state === S.LOCKED_FAULT || state === S.BATTERY_REMOVAL_RECOVERY) return result(true);
        if (payload.consecutiveFailures >= n.motorAckConsecutiveFailuresFault) {
          const fx = enterFault('acknowledgement-failure', true, at);
          log(at, from, event, state, true, 'acknowledgement-failure');
          return result(true, 'acknowledgement-failure', fx);
        }
        return result(true);
      }
      if (event === 'OBSERVE') {
        const r = observe(payload);
        if (r.fault) { const fx = enterFault(r.fault, true, at); log(at, from, event, state, true, r.fault); return result(true, r.fault, fx); }
        if (r.auto === 'zero-verified') {
          if (ctx.flow === 'powered-stopval') { // never MOTOR_READY: prove the stop with the battery connected instead
            const a = apply(own(state, 'ZERO_VERIFIED_STOPVAL'), 'ZERO_VERIFIED_STOPVAL', payload, at, from);
            return { ...a, reason: a.ok ? 'zero-verified' : a.reason };
          }
          state = S.MOTOR_READY; ctx.zeroVerified = true; ctx.baselineVoltage_cV = Number.isFinite(payload.voltage_cV) && payload.voltage_cV > 0 ? payload.voltage_cV : null; log(at, from, 'ZERO_VERIFIED', state, true, 'auto'); return result(true, 'zero-verified');
        }
        return result(true);
      }

      // user stop and timeouts and visibility: the generic fault path (valid wherever a motor could be energised)
      if (event === 'USER_STOP' || event === 'TIMEOUT' || event === 'COMMAND_PATH_ERROR' || event === 'FAULT' || event === 'VISIBILITY_LOST') {
        const reason = payload.reason || ({ USER_STOP: 'user-stop', TIMEOUT: 'timeout', COMMAND_PATH_ERROR: 'command-path-error', VISIBILITY_LOST: 'visibility-or-focus-lost' }[event] || 'fault');
        const specific = own(state, event);
        if (specific && (specific.guard ? specific.guard(payload) === true : true)) return apply(specific, event, payload, at, from);
        if (state === S.DISCONNECTED || state === S.READ_ONLY_READINESS || state === S.UNCLEAN_EXIT_RECOVERY) {
          ctx.unlocked = false; recomputePolicy(); // a fault, a stop or losing the page always drops the session unlock
          log(at, from, event, state, true, 'no motor path'); return result(true, 'no motor path');
        }
        if (state === S.LOCKED_FAULT || state === S.BATTERY_REMOVAL_RECOVERY || state === S.BENCH_COMPLETE) { log(at, from, event, state, true, 'already locked'); return result(true, 'already locked'); }
        if (event === 'VISIBILITY_LOST' && !isPowered(state, ctx) && state !== S.RUNNING) { log(at, from, event, state, true, 'not powered'); return result(true, 'not powered'); }
        const fx = enterFault(reason, payload.transportAvailable !== false && ctx.transportAvailable !== false, at);
        log(at, from, event, state, true, reason);
        return result(true, reason, fx);
      }
      if (event === 'TRANSPORT_LOST') {
        const specific = own(state, 'TRANSPORT_LOST');
        if (specific && (specific.guard ? specific.guard(payload) === true : true)) return apply(specific, event, payload, at, from);
        const fx = enterFault('transport-lost', false, at); // powered state without a rule: lock, battery instruction
        log(at, from, event, state, true, 'transport-lost');
        return result(true, 'transport-lost', fx);
      }
      if (event === 'RECONNECTED' && !own(state, 'RECONNECTED')) { // reconnect outside the approved grace state
        const fx = FAULT_ON_INVALID.has(state) || state === S.LOCKED_FAULT ? (state === S.LOCKED_FAULT ? [] : enterFault('reconnect-outside-grace', false, at)) : [];
        log(at, from, event, state, false, 'reconnect outside the power-connect grace state');
        return result(false, 'reconnect outside the power-connect grace state', fx);
      }

      const spec = own(state, event);
      if (!spec) {
        let fx = [];
        if (FAULT_ON_INVALID.has(state)) fx = enterFault(`invalid-transition:${event}`, ctx.transportAvailable, at);
        log(at, from, event, state, false, 'invalid transition');
        return result(false, 'invalid transition', fx);
      }
      return apply(spec, event, payload, at, from);
    } catch (e) { // an exception inside a handler is a fault, never a grant
      const fx = FAULT_ON_INVALID.has(state) || isPowered(state, ctx) ? enterFault('handler-exception', ctx.transportAvailable, at) : [];
      log(at, from, event, state, false, 'exception: ' + (e && e.message));
      return result(false, 'exception', fx);
    }
  }

  function apply(spec, event, payload, at, from) {
    const g = spec.guard ? spec.guard(payload) : true;
    if (g !== true) {
      let fx = [];
      // a refused start is not a fault; a refused powered-state step that the controller should never have attempted is
      if (FAULT_ON_INVALID.has(state) && !['START_HOLD_COMPLETE', 'CONFIRM_TARGET', 'SELECT_MOTOR', 'CHECKLIST_ITEM', 'FINAL_HOLD_DONE', 'CHECKLIST_COMPLETE', 'USER_CONFIRMS_NO_ROTATION', 'POSITION_REPORTED', 'SAFE_STATE_DONE', 'STOP_VALIDATION_DONE', 'ZERO_VERIFIED', 'ESC_READY', 'FINISH_STOP_DONE', 'RECONNECTED', 'RUN_COMPLETE', 'ZERO_VERIFIED_STOPVAL', 'POWERED_STOP_VALIDATION_DONE'].includes(event)) {
        fx = enterFault(`guard:${event}`, ctx.transportAvailable, at);
      } else if (event === 'POSITION_REPORTED' && state === S.VERIFYING_STOP && proofComplete(ctx) && ctx.purpose === 'run') {
        fx = enterFault('motor-position-mismatch', ctx.transportAvailable, at); // the wrong motor moved or the answer was none: lock
      } else if (event === 'RECONNECTED' && state === S.POWER_CONNECT_RECONNECT) {
        fx = enterFault('reconnect-outside-grace', false, at);
      }
      log(at, from, event, state, false, String(g));
      return { ok: false, from, to: state, reason: String(g), effects: fx };
    }
    const effects = spec.apply ? spec.apply(payload) || [] : [];
    if (spec.to !== SELF && state === from) state = spec.to; // apply() may already have moved to LOCKED_FAULT or DISCONNECTED
    if (state === S.DISCONNECTED || state === S.LOCKED_FAULT) ctx.unlocked = false;
    if (state !== S.RUNNING) ctx.runAuthorized = false;
    if (!QUIET.has(event)) log(at, from, event, state, true, '');
    return { ok: true, from, to: state, reason: '', effects };
  }

  // ---- what the UI may show. Everything is derived from state and ctx; the UI never decides on its own.
  function capabilities(now = 0) {
    const st = state;
    const known = Object.prototype.hasOwnProperty.call(TABLE, st);
    const locked = st === S.LOCKED_FAULT || st === S.BATTERY_REMOVAL_RECOVERY || st === S.UNCLEAN_EXIT_RECOVERY || !known || ctx.markerClear.failed;
    // explicit battery state: attested disconnected only in the USB-only states; declared connected once powered; unknown after a fault or reload
    const poweredNow = isPowered(st, ctx);
    const batteryState = !known || st === S.UNCLEAN_EXIT_RECOVERY || st === S.LOCKED_FAULT || ((st === S.BATTERY_REMOVAL_RECOVERY || st === S.BENCH_COMPLETE) && !ctx.batteryRemoved) ? 'unknown'
      : ctx.batteryRemoved ? 'removed-confirmed' : poweredNow || st === S.RUNNING ? 'declared-connected' : 'attested-disconnected';
    const interlocks = st === S.MOTOR_READY ? startInterlocks(ctx, ctx.facts, now) : [];
    const needBatteryNow = st === S.UNCLEAN_EXIT_RECOVERY || st === S.LOCKED_FAULT || st === S.BATTERY_REMOVAL_RECOVERY || !known;
    return {
      state: st, mode: ctx.mode, unlocked: ctx.unlocked, locked,
      showBatteryInstruction: needBatteryNow,
      stopButton: known && STOP_CAPABLE.has(st) && st !== S.UNCLEAN_EXIT_RECOVERY,
      maxOutput: known && STOP_CAPABLE.has(st) ? (st === S.RUNNING ? MOTOR.cap : MOTOR.stopValue) : 0,
      canConnect: st === S.DISCONNECTED || st === S.UNCLEAN_EXIT_RECOVERY,
      realControlsVisible: ctx.mode === 'mock' || ctx.unlocked === true,
      canUnlock: st === S.READ_ONLY_READINESS && ctx.mode === 'real' && !ctx.unlocked,
      canProceed: st === S.READ_ONLY_READINESS && !!(ctx.policy && ctx.policy.nonzeroOk),
      canStopValidation: st === S.READ_ONLY_READINESS && !!(ctx.policy && ctx.policy.stopValidationOk),
      canPoweredStopValidation: st === S.READ_ONLY_READINESS && !!(ctx.policy && ctx.policy.stopValidationOk) && ctx.usbStopValidated === true && ctx.markerAvailable,
      flow: ctx.flow,
      usbStopValidated: ctx.usbStopValidated, poweredStopValidated: ctx.poweredStopValidated,
      canFinishPoweredStopValidation: st === S.POWERED_STOP_VALIDATION && proofComplete(ctx),
      batteryState,
      dshot: { status: ctx.dshot.status, usableForMs: ctx.dshot.status === 'usable' && Number.isFinite(ctx.dshot.since) && Number.isFinite(ctx.dshot.lastAt) ? ctx.dshot.lastAt - ctx.dshot.since : 0 },
      markerClearPending: ctx.markerClear.pending, markerClearFailed: ctx.markerClear.failed,
      canRetryMarkerClear: (st === S.BATTERY_REMOVAL_RECOVERY || st === S.BENCH_COMPLETE) && ctx.markerClear.failed && !ctx.markerClear.pending && ctx.batteryRemoved && proofComplete(ctx),
      policy: ctx.policy,
      checklistEditable: st === S.SAFETY_CHECKLIST,
      canFinalHold: st === S.SAFETY_CHECKLIST && checklistComplete(ctx.checklist),
      canCompleteChecklist: st === S.SAFETY_CHECKLIST && checklistComplete(ctx.checklist) && ctx.checklist.finalHold && ctx.markerAvailable,
      markerAvailable: ctx.markerAvailable,
      canDeclareBattery: st === S.READY_TO_CONNECT_POWER && !ctx.batteryDeclared,
      batteryDeclared: ctx.batteryDeclared,
      canSelectMotor: st === S.MOTOR_READY,
      selectedMotor: ctx.selectedMotor, targetConfirmed: ctx.targetConfirmed,
      canConfirmTarget: st === S.MOTOR_READY && ctx.selectedMotor !== null && ctx.targetConfirmed !== ctx.selectedMotor,
      interlocks, canStart: st === S.MOTOR_READY && interlocks.length > 0 && interlocks.every((c) => c.ok),
      canFinish: st === S.MOTOR_READY,
      completedMotors: ctx.completedMotors.slice(),
      proof: { ...ctx.stop, partsDone: proofParts(ctx), complete: proofComplete(ctx) },
      canConfirmNoRotation: (st === S.VERIFYING_STOP || st === S.STOP_VALIDATION_ONLY || st === S.POWERED_STOP_VALIDATION || (ctx.transportAvailable && (st === S.LOCKED_FAULT || st === S.BATTERY_REMOVAL_RECOVERY))) && proofParts(ctx) && !ctx.stop.userNoRotation,
      needsPosition: st === S.VERIFYING_STOP && ctx.purpose === 'run' && proofComplete(ctx),
      canFinishStop: st === S.VERIFYING_STOP && ctx.purpose === 'finish' && proofComplete(ctx),
      canBeginBatteryRemoval: st === S.LOCKED_FAULT,
      canConfirmBatteryRemoved: (st === S.BATTERY_REMOVAL_RECOVERY || st === S.UNCLEAN_EXIT_RECOVERY || (st === S.BENCH_COMPLETE && proofComplete(ctx))) && !ctx.batteryRemoved,
      batteryRemoved: ctx.batteryRemoved,
      canCompleteRecovery: st === S.BATTERY_REMOVAL_RECOVERY && ctx.batteryRemoved && proofComplete(ctx) && !ctx.markerClear.pending && !ctx.markerClear.failed,
      canReset: st === S.BENCH_COMPLETE && ctx.markerCleared,
      transportAvailable: ctx.transportAvailable,
      fault: ctx.fault ? { ...ctx.fault } : null,
      graceStartedAt: ctx.graceStartedAt,
    };
  }

  return {
    dispatch,
    capabilities,
    motorCommandPermission,
    get state() { return state; },
    get ctx() { return ctx; },
    get trace() { return trace; },
    // test hook: lets a test corrupt the state to prove fail-closed behaviour. Not used by any app code.
    _corruptStateForTests(s) { state = s; },
    _tableForTests: TABLE,
  };
}

export const ALL_STATES = Object.freeze(Object.values(STATE));
export { POSITION_NONE };
