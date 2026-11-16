// Motor bench test (Phase 3): the controller. It connects the transport, the read-only session, the guarded motor
// boundary, the recovery marker and the state machine. It makes NO safety decision of its own: it reports facts to the
// machine (events and observations) and executes the effects the machine returns (send external 1000, run the sweep,
// clear the marker). The machine is the single authority; the UI reads machine.capabilities().
//
// Time and timers come from an injectable clock so the tests are deterministic. The only timers are setTimeout chains.
// The sweep (ramp, validation, plateau) is driven from the poll loop, which also runs the watchdog.
import { ReadOnlySession } from '../preflight/session.js';
import { evaluateReadiness } from '../preflight/readiness.js';
import { PROTOCOL_NAMES } from '../preflight/versions.js';
import { armedFromStatus } from '../preflight/msp-codec.js';
import { BENCH_TIMINGS, MOTOR } from './constants.js';
import { OWNER_APPROVED, SYNTHETIC_ALLOWLIST, matchAllowlist } from './allowlist.js';
import { MotorBoundary } from './motor-control.js';
import { createMarkerStore } from './recovery-marker.js';
import { STATE, createMachine } from './state-machine.js';

const MARKER_CLEAR_FAILED_TEXT = 'The recovery marker could not be deleted. Keep the flight battery disconnected: ordinary testing cannot resume until the marker is confirmed removed. Retry the deletion; if it keeps failing, clear this site\'s browser data by hand and reload.';

const realClock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };
const n = BENCH_TIMINGS;

export function createBenchController(opts = {}) {
  const clock = opts.clock || realClock;
  const marker = opts.marker || createMarkerStore();
  const lists = opts.allowlist ? { mock: opts.allowlist, real: opts.allowlist } : { mock: SYNTHETIC_ALLOWLIST, real: OWNER_APPROVED };
  const mstatus = marker.status();
  const machine = createMachine({ markerPresent: mstatus === 'present', markerAvailable: mstatus !== 'unavailable' });

  let transport = null, session = null, boundary = null, snapshot = null, boxIds = null, identityKey = null;
  let attestations = {}, manual = { escFamily: '', escModel: '' };
  let polling = false, loopTimer = null, graceTimer = null, escTimer = null, disposed = false, tickCount = 0;
  let proofRun = 0;
  const obs = { telemetry: null, telemetryAt: null, armed: null, armedAt: null, voltage_cV: null, readback: null, lastSendAt: -1 };
  const inflight = { tel: false, status: false, motor: false, analog: false };
  const last = { statusAt: -Infinity, analogAt: -Infinity };
  let sweep = null;
  const notes = { message: '', error: '', markerError: '', proofFailed: false };
  const listeners = new Set();

  const now = () => clock.now();
  const sleep = (ms) => new Promise((r) => clock.setTimeout(r, ms));
  const emit = () => { for (const l of listeners) { try { l(); } catch { /* a UI listener error never touches the safety path */ } } };

  // ---- dispatching and effects
  function dispatch(event, payload = {}) {
    const r = machine.dispatch(event, { ...payload, now: now() });
    for (const fx of r.effects || []) runEffect(fx);
    syncTimers();
    if (!['OBSERVE', 'STOP_SENT', 'STOP_ACKED', 'READBACK', 'ACK_RESULT'].includes(event) || r.effects.length) emit();
    return r;
  }

  function runEffect(fx) {
    switch (fx.type) {
      case 'stop-and-prove': immediateStop(); runStopLoop('proof', true); break;
      case 'start-stop-proof': immediateStop(); runStopLoop('proof', true); break;
      case 'start-stop-validation': runStopLoop('proof'); break;
      case 'start-safe-state': runStopLoop('safe-state'); break;
      case 'start-sweep': beginSweep(); break;
      case 'clear-marker': { // a verified transition: the machine stays locked until it is told the marker is confirmed absent
        const ok = marker.clear() === true && marker.status() === 'absent';
        notes.markerError = ok ? '' : MARKER_CLEAR_FAILED_TEXT;
        dispatch('MARKER_CLEAR_RESULT', { ok });
        break;
      }
      default: break;
    }
  }

  function syncTimers() {
    const st = machine.state;
    if (st === STATE.POWER_CONNECT_RECONNECT) {
      if (graceTimer === null) {
        graceTimer = clock.setTimeout(() => { graceTimer = null; dispatch('GRACE_EXPIRED'); }, n.reconnectGraceMs + 1);
      }
    } else if (graceTimer !== null) { clock.clearTimeout(graceTimer); graceTimer = null; }
    if (escTimer !== null && st !== STATE.READY_TO_CONNECT_POWER && st !== STATE.POWER_CONNECT_RECONNECT) { clock.clearTimeout(escTimer); escTimer = null; }
  }

  // ---- stop path
  function transportAlive() { return !!(transport && session && !session.closed && machine.capabilities().transportAvailable); }

  function sendStopTracked() {
    if (!boundary) return false;
    try {
      obs.lastSendAt = now();
      boundary.sendStop().catch(() => {});
      dispatch('STOP_SENT');
      return true;
    } catch { return false; } // refused: the machine has no motor path in this state
  }
  function immediateStop() { if (transportAlive()) sendStopTracked(); }

  async function runStopLoop(goal, alreadySentFirst = false) {
    const id = ++proofRun;
    let skipSend = alreadySentFirst;
    const t0 = now();
    let readbackBusy = false;
    notes.proofFailed = false;
    while (id === proofRun && !disposed) {
      const st = machine.state;
      if (!transportAlive()) return; // no transport: never claim the motor is stopped
      const caps = machine.capabilities(now());
      if (goal === 'safe-state') {
        if (st !== STATE.SAFE_STATE_INIT && st !== STATE.POWER_CONNECT_RECONNECT) return;
        if (caps.proof.attempts >= n.stopMinAttempts && caps.proof.acks >= 1 && caps.proof.readbackOk) {
          const r = dispatch('SAFE_STATE_DONE');
          if (r.ok && st === STATE.POWER_CONNECT_RECONNECT) armEscTimer();
          return;
        }
      } else {
        if (![STATE.VERIFYING_STOP, STATE.LOCKED_FAULT, STATE.STOP_VALIDATION_ONLY, STATE.POWERED_STOP_VALIDATION, STATE.BATTERY_REMOVAL_RECOVERY].includes(st)) return;
        if (caps.proof.complete) return;
      }
      if (now() - t0 > n.stopProofTimeoutMs && !(goal === 'proof' && caps.proof.partsDone)) {
        if (goal === 'safe-state') dispatch('FAULT', { reason: 'safe-state-incomplete' });
        else { notes.proofFailed = true; if (st === STATE.VERIFYING_STOP || st === STATE.POWERED_STOP_VALIDATION) dispatch('FAULT', { reason: 'stop-proof-incomplete' }); else emit(); }
        return;
      }
      const slow = goal === 'proof' && caps.proof.partsDone;
      if (skipSend) skipSend = false; else sendStopTracked(); // a refusal is retried until the timeout
      if (caps.proof.attempts >= n.stopMinAttempts && !caps.proof.partsDone && !readbackBusy && session) {
        readbackBusy = true;
        session.request('MSP_MOTOR').then((v) => { dispatch('READBACK', { values: v.values.slice(0, MOTOR.enabledMotors) }); }).catch(() => { dispatch('READBACK', { values: null }); }).finally(() => { readbackBusy = false; });
      }
      await sleep(slow ? n.stopCadenceMs * 10 : n.stopCadenceMs);
    }
  }

  // ---- sweep: ramp, candidate validation, plateau. Driven by the poll loop; every output goes through the boundary.
  function beginSweep() {
    sweep = { motor: machine.ctx.selectedMotor, phase: 'ramp', value: null, lastChange: now(), windowStart: null, threshold: null, plateauAt: null, startedAt: now(), output: MOTOR.stopValue };
  }
  function out(value) {
    obs.lastSendAt = now();
    sweep.output = value; sweep.lastChange = now();
    boundary.sendOutput(sweep.motor, value).catch(() => {});
  }
  function advanceSweep() {
    if (!sweep) return;
    if (machine.state !== STATE.RUNNING) { sweep = null; return; }
    const t = now();
    if (t - sweep.startedAt > n.runTimeoutMs) { dispatch('TIMEOUT', { reason: 'run-timeout' }); return; }
    const rpm = obs.telemetry && obs.telemetryAt !== null && t - obs.telemetryAt <= n.staleTelemetryFaultMs ? obs.telemetry.motors[sweep.motor] : null;
    const spinning = !!rpm && rpm.rpm > 0;
    const stepUp = () => {
      const next = sweep.value + MOTOR.step;
      if (next > MOTOR.cap) { try { boundary.sendStop().catch(() => {}); } catch { /* machine decides */ } dispatch('RUN_ABORTED', { reason: 'no-stable-rotation-by-cap' }); sweep = null; return; }
      sweep.value = next; sweep.phase = 'ramp'; sweep.windowStart = null; out(next);
    };
    if (sweep.phase === 'ramp') {
      if (sweep.value === null) { sweep.value = MOTOR.startValue; out(sweep.value); return; }
      if (t - sweep.lastChange >= MOTOR.dwellMs) {
        if (spinning) { sweep.phase = 'validate'; sweep.windowStart = t; } else stepUp();
      }
    } else if (sweep.phase === 'validate') {
      if (!spinning) { stepUp(); return; }
      if (t - sweep.windowStart >= MOTOR.candidateValidationMs) {
        sweep.threshold = sweep.value;
        const target = Math.min(MOTOR.cap, sweep.threshold + MOTOR.plateauOffset);
        sweep.phase = 'plateau'; sweep.plateauAt = t; sweep.value = target; out(target);
      }
    } else if (sweep.phase === 'plateau') {
      if (t - sweep.plateauAt >= Math.min(MOTOR.plateauMs, MOTOR.plateauMaxMs)) {
        try { boundary.sendStop().catch(() => {}); } catch { /* machine decides */ }
        sweep.output = MOTOR.stopValue; sweep.phase = 'done';
        dispatch('RUN_COMPLETE', { result: 'completed' });
        sweep = null;
      }
    }
  }

  // ---- polling and watchdog
  function pollOnce() {
    if (!session || session.closed) return;
    const t = now();
    if (!inflight.tel) {
      inflight.tel = true;
      session.request('MSP_MOTOR_TELEMETRY').then((v) => { if (v.count === MOTOR.enabledMotors) { obs.telemetry = v; obs.telemetryAt = now(); } }).catch(() => {}).finally(() => { inflight.tel = false; });
    }
    if (t - last.statusAt >= n.statusPollMs) {
      last.statusAt = t;
      if (!inflight.status) {
        inflight.status = true;
        session.request('MSP_STATUS_EX').then((v) => { const a = armedFromStatus(v, boxIds); obs.armed = a; obs.armedAt = now(); }).catch(() => {}).finally(() => { inflight.status = false; });
      }
      if (!inflight.motor) {
        inflight.motor = true;
        const requestedAt = now();
        session.request('MSP_MOTOR').then((v) => { obs.readback = { values: v.values.slice(0, MOTOR.enabledMotors), at: now(), requestedAt }; }).catch(() => {}).finally(() => { inflight.motor = false; });
      }
    }
    if (t - last.analogAt >= n.analogPollMs && !inflight.analog) {
      last.analogAt = t; inflight.analog = true;
      session.request('MSP_ANALOG').then((v) => { obs.voltage_cV = v.voltage_cV; }).catch(() => {}).finally(() => { inflight.analog = false; });
    }
  }

  function observe() {
    const rb = obs.readback ? { values: obs.readback.values, at: obs.readback.at, current: obs.readback.requestedAt > obs.lastSendAt } : null;
    dispatch('OBSERVE', {
      telemetryAt: obs.telemetryAt, rpm: obs.telemetry ? obs.telemetry.motors.map((m) => m.rpm) : null,
      tempsC: obs.telemetry ? obs.telemetry.motors.map((m) => m.temperatureC) : [],
      dshotInvalidPct_centi: obs.telemetry ? obs.telemetry.motors.map((m) => m.invalidPct_centi) : null, // the machine classifies these (usable, excessive, unavailable)
      armed: obs.armed, armedAt: obs.armedAt, voltage_cV: obs.voltage_cV,
      commanded: boundary ? boundary.commandedValues() : null, readback: rb,
    });
  }

  function loop() {
    loopTimer = null;
    if (!polling || disposed) return;
    try {
      pollOnce();
      if (machine.state !== STATE.DISCONNECTED && machine.state !== STATE.READ_ONLY_READINESS) observe();
      advanceSweep();
      if (++tickCount % 5 === 0) emit();
    } catch (e) {
      notes.error = 'Internal error: ' + (e && e.message ? e.message : e);
      dispatch('COMMAND_PATH_ERROR', { reason: 'uncaught-command-path-error' });
    }
    loopTimer = clock.setTimeout(loop, n.telemetryPollMs);
  }
  function startPolling() { if (!polling) { polling = true; loopTimer = clock.setTimeout(loop, n.telemetryPollMs); } }
  function stopPolling() { polling = false; if (loopTimer !== null) { clock.clearTimeout(loopTimer); loopTimer = null; } }

  // ---- transport and readiness
  function identity() {
    const r = (name) => (snapshot && snapshot.reads[name] && snapshot.reads[name].ok ? snapshot.reads[name].value : null);
    const api = r('MSP_API_VERSION'), fv = r('MSP_FC_VERSION'), vr = r('MSP_FC_VARIANT'), bi = r('MSP_BOARD_INFO'), adv = r('MSP_ADVANCED_CONFIG'), uid = r('MSP_UID');
    return {
      variant: vr && vr.variant, firmware: fv && fv.text, api: api && api.text, targetName: bi && bi.targetName, boardId: bi && bi.boardId,
      motorProtocol: adv ? PROTOCOL_NAMES[adv.motorProtocol] : null, escFamily: manual.escFamily, escModel: manual.escModel, uidHex: uid ? uid.hex : null,
    };
  }

  function refreshReadiness() {
    if (!snapshot || machine.state !== STATE.READ_ONLY_READINESS) return;
    const kind = transport ? transport.kind : 'unknown';
    const report = evaluateReadiness({ snapshot, attestations, transportKind: kind });
    const id = identity();
    const combo = matchAllowlist(id, kind === 'mock' ? 'mock' : 'real', lists[kind === 'mock' ? 'mock' : 'real']);
    const mc = snapshot.reads.MSP_MOTOR_CONFIG;
    dispatch('READINESS_UPDATE', { report, combo, motorCount: mc && mc.ok ? mc.value.motorCount : null });
  }

  function attach(t) {
    transport = t;
    session = new ReadOnlySession(t, { retries: 0 });
    boundary = new MotorBoundary({
      transport: t, clock,
      authorize: (req) => machine.motorCommandPermission(req),
      onAck: (a) => {
        if (a.kind === 'stop' && a.ok) dispatch('STOP_ACKED');
        dispatch('ACK_RESULT', { ok: a.ok, consecutiveFailures: a.consecutiveFailures });
      },
    });
    obs.telemetry = null; obs.telemetryAt = null; obs.armed = null; obs.armedAt = null; obs.voltage_cV = null; obs.readback = null; obs.lastSendAt = -1;
    t.onClose((reason) => onTransportClosed(t, reason));
  }

  function onTransportClosed(t, reason) {
    if (t !== transport) return; // a late event from an old transport
    stopPolling(); proofRun++; sweep = null;
    notes.message = `The connection closed (${reason}).`;
    dispatch('TRANSPORT_LOST', { reason: String(reason) });
  }

  async function connect(t) {
    notes.error = ''; notes.message = '';
    const st = machine.state;
    try {
      if (st === STATE.DISCONNECTED || st === STATE.UNCLEAN_EXIT_RECOVERY) {
        await t.open();
        attach(t);
        const r = dispatch('CONNECT', { transportKind: t.kind });
        if (!r.ok) { notes.error = r.reason; return r; }
        startPolling();
        if (machine.state === STATE.READ_ONLY_READINESS) { snapshot = await session.collectSnapshot(); const b = snapshot.reads.MSP_BOXIDS; boxIds = b && b.ok ? b.value : null; identityKey = JSON.stringify([identity().uidHex, identity().targetName]); refreshReadiness(); }
        emit();
        return r;
      }
      if (st === STATE.POWER_CONNECT_RECONNECT || st === STATE.BATTERY_REMOVAL_RECOVERY) {
        await t.open();
        attach(t);
        const r = dispatch('RECONNECTED', { transportKind: t.kind });
        if (!r.ok) { try { await t.close(); } catch { /* closing */ } return r; }
        startPolling();
        if (st === STATE.POWER_CONNECT_RECONNECT) {
          const snap = await session.collectSnapshot(); const b = snap.reads.MSP_BOXIDS; boxIds = b && b.ok ? b.value : boxIds;
          snapshot = snap;
          if (JSON.stringify([identity().uidHex, identity().targetName]) !== identityKey) dispatch('FAULT', { reason: 'different-flight-controller-after-reconnect' });
        }
        emit();
        return r;
      }
      const r = dispatch('RECONNECTED', { transportKind: t.kind }); // outside the grace state: the machine faults
      try { await t.close(); } catch { /* closing */ }
      return r;
    } catch (e) {
      notes.error = 'Could not connect: ' + (e && e.message ? e.message : e);
      emit();
      return { ok: false, reason: notes.error };
    }
  }

  function armEscTimer() {
    if (escTimer !== null) clock.clearTimeout(escTimer);
    escTimer = clock.setTimeout(() => { escTimer = null; dispatch('ESC_READY'); }, n.escReadyWaitMs);
  }

  // ---- public API (each method maps to one machine event; none decides)
  const api = {
    machine,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    connect,
    async reread() { if (session && machine.state === STATE.READ_ONLY_READINESS) { snapshot = await session.collectSnapshot(); refreshReadiness(); } },
    setAttestation(p) { attestations = { ...attestations, ...p }; for (const k of Object.keys(attestations)) if (attestations[k] === undefined) delete attestations[k]; refreshReadiness(); },
    setManual(p) { manual = { ...manual, ...p }; refreshReadiness(); },
    unlock(phrase, acknowledged) { const r = dispatch('UNLOCK', { phrase, acknowledged }); refreshReadiness(); if (!r.ok) notes.error = r.reason; return r; },
    lock() { const r = dispatch('LOCK'); refreshReadiness(); return r; },
    proceed() { return dispatch('READINESS_OK'); },
    startStopValidation() { return dispatch('ENTER_STOP_VALIDATION'); }, // USB-only (battery disconnected): FC command and read-back check
    startPoweredStopValidation() { return dispatch('ENTER_POWERED_STOP_VALIDATION'); }, // the full safety flow, then external 1000 with the battery connected
    finishPoweredStopValidation() { return dispatch('POWERED_STOP_VALIDATION_DONE'); },
    retryMarkerClear() { return dispatch('RETRY_MARKER_CLEAR'); },
    leaveStopValidation() { return dispatch('LEAVE_STOP_VALIDATION'); },
    finishStopValidation() { return dispatch('STOP_VALIDATION_DONE'); },
    setChecklistItem(key, value) { return dispatch('CHECKLIST_ITEM', { key, value }); },
    confirmChecklist(holdMs) {
      notes.markerError = '';
      const h = dispatch('FINAL_HOLD_DONE', { holdMs });
      if (!h.ok) return h;
      const ok = marker.set(now());
      dispatch('MARKER_RESULT', { ok });
      if (!ok) { notes.markerError = 'The recovery marker could not be written and verified, so powered testing is not allowed.'; emit(); return { ok: false, reason: notes.markerError }; }
      return dispatch('CHECKLIST_COMPLETE');
    },
    declareBatteryConnected() { const r = dispatch('BATTERY_DECLARED'); if (r.ok) armEscTimer(); return r; },
    selectMotor(motor) { return dispatch('SELECT_MOTOR', { motor }); },
    confirmTarget(motor) { return dispatch('CONFIRM_TARGET', { motor }); },
    startMotor(holdMs) { return dispatch('START_HOLD_COMPLETE', { holdMs }); },
    stopAndZero() { return dispatch('USER_STOP', { reason: 'user-stop' }); },
    confirmNoRotation() { return dispatch('USER_CONFIRMS_NO_ROTATION'); },
    reportPosition(physical) { return dispatch('POSITION_REPORTED', { physical }); },
    finishBench() { return dispatch('FINISH_BENCH'); },
    completeFinish() { return dispatch('FINISH_STOP_DONE'); },
    beginBatteryRemoval() { return dispatch('BEGIN_BATTERY_REMOVAL'); },
    confirmBatteryRemoved() { return dispatch('BATTERY_REMOVED_CONFIRMED'); },
    completeRecovery() { return dispatch('RECOVERY_COMPLETE'); },
    reset() { return dispatch('RESET'); },
    // page lifecycle: visibility hidden, pagehide, window blur, freeze. A hidden page may still attempt a stop; never relied on.
    notifyVisibilityLoss(kind = 'visibility') { return dispatch('VISIBILITY_LOST', { reason: `visibility-or-focus-lost:${kind}` }); },
    async disconnect() { // pre-power states only; the UI offers it only there
      const t = transport;
      if (t) { try { await t.close(); } catch { /* closing */ } onTransportClosed(t, 'closed by user'); }
    },
    view() {
      const t = now();
      return {
        caps: machine.capabilities(t), trace: machine.trace, attestations, manual, notes: { ...notes }, snapshot, identity: identity(),
        telemetry: obs.telemetry, telemetryAgeMs: obs.telemetryAt === null ? null : t - obs.telemetryAt, armed: obs.armed, voltage_cV: obs.voltage_cV,
        readiness: machine.ctx.readinessReport, markerStatus: marker.status(),
        sweep: sweep ? { motor: sweep.motor, phase: sweep.phase, output: sweep.output, elapsedMs: t - sweep.startedAt, threshold: sweep.threshold } : null,
        commanded: boundary ? boundary.commandedValues() : null, transportKind: transport ? transport.kind : null,
      };
    },
    dispose() { disposed = true; stopPolling(); proofRun++; if (graceTimer !== null) clock.clearTimeout(graceTimer); if (escTimer !== null) clock.clearTimeout(escTimer); },
    // test access
    _obs: obs,
    _sweepForTests: () => sweep,
  };
  return api;
}
