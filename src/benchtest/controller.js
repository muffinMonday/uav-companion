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
import { BENCH_TIMINGS, EXPECTED_POSITIONS, MOTOR } from './constants.js';
import { createLiveCollector } from './live-collector.js';
import { buildBenchResult } from './result.js';
import { buildEvidenceExport, buildHistoryRecord, approxBytes } from './history.js';
import { deleteAll as deleteStoredDiagnostics, listRecords as listStoredDiagnostics, saveRecord as saveStoredDiagnostic, approxSize as storedDiagnosticsSize } from '../aircraft-diag-data.js';
import { OWNER_APPROVED, SYNTHETIC_ALLOWLIST, matchAllowlist } from './allowlist.js';
import { MotorBoundary } from './motor-control.js';
import { fourwayEnabledFor } from './flag.js';
import { deriveFingerprint } from './fingerprint.js';
import { createMarkerStore } from './recovery-marker.js';
import { STATE, createMachine } from './state-machine.js';

const MARKER_CLEAR_FAILED_TEXT = 'The recovery marker could not be deleted. Keep the flight battery disconnected: ordinary testing cannot resume until the marker is confirmed removed. Retry the deletion; if it keeps failing, clear this site\'s browser data by hand and reload.';

const realClock = { now: () => Date.now(), mono: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };
const n = BENCH_TIMINGS;

export function createBenchController(opts = {}) {
  const clock = opts.clock || realClock;
  const marker = opts.marker || createMarkerStore();
  const lists = opts.allowlist ? { mock: opts.allowlist, real: opts.allowlist } : { mock: SYNTHETIC_ALLOWLIST, real: OWNER_APPROVED };
  const mstatus = marker.status();
  const machine = createMachine({ markerPresent: mstatus === 'present', markerAvailable: mstatus !== 'unavailable', fourway: opts.fourway || fourwayEnabledFor });

  let transport = null, session = null, boundary = null, snapshot = null, boxIds = null, identityKey = null;
  let attestations = {}, fingerprint = null;
  // 4-way identification: fwBusy is true from just before 4-way starts until ordinary MSP has answered again (or the session faulted). While it is true
  // the controller sends NO MSP at all (polling, stop loops and the motor boundary are all gated), because the FC parses 4-way frames, not MSP.
  let fwBusy = false, scanRun = 0, scanAbort = false;
  const fwView = { phase: 'idle', channels: [0, 1, 2, 3].map((i) => ({ channel: i + 1, state: 'waiting' })) };
  let polling = false, loopTimer = null, graceTimer = null, escTimer = null, disposed = false, tickCount = 0;
  let proofRun = 0;
  const obs = { telemetry: null, telemetryAt: null, armed: null, armedAt: null, voltage_cV: null, voltageAt: null, readback: null, lastSendAt: -1, lastAck: null };
  // Passive analysis layer: it only records what the loop already observed. It never feeds back into the machine or the boundary.
  const collector = createLiveCollector({ clockNow: () => clock.now(), mono: typeof clock.mono === 'function' ? () => clock.mono() : undefined });
  const diagStorage = opts.diagStorage; // undefined: the browser's local storage; tests pass an in-memory one
  let resultCache = { version: -1, value: null };
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
    analysisAfterDispatch(event, payload, r); // after every effect: the stop path never waits for analysis
    if (!['OBSERVE', 'STOP_SENT', 'STOP_ACKED', 'READBACK', 'ACK_RESULT'].includes(event) || r.effects.length) emit();
    return r;
  }

  // Analysis hooks. Every one is wrapped: a failure here can only lose analysis data.
  function analysisAfterDispatch(event, payload, r) {
    try {
      if (!collector.isActive()) return;
      if (event === 'POSITION_REPORTED') collector.setReportedPosition(payload && payload.physical);
      if (event === 'POSITION_REPORTED' && r.ok) { collector.end('completed', { stopProofComplete: true, reportedPosition: payload.physical }); return; }
      const st = machine.state;
      if (st !== STATE.RUNNING && st !== STATE.VERIFYING_STOP) {
        const reason = st === STATE.LOCKED_FAULT && machine.ctx.fault ? machine.ctx.fault.reason : String(event).toLowerCase();
        collector.end('incomplete', { reason, reportedPosition: collector.pendingPosition() });
      }
    } catch { /* analysis never touches the safety path */ }
  }
  function collectSample() {
    try {
      if (!collector.isActive()) return;
      const phase = sweep ? sweep.phase : (machine.state === STATE.VERIFYING_STOP ? 'stop' : null);
      if (!phase) return;
      collector.sample({ phase, commands: boundary ? boundary.commandedValues() : null, readback: obs.readback ? { values: obs.readback.values, at: obs.readback.at, current: obs.readback.requestedAt > obs.lastSendAt } : null,
        telemetry: obs.telemetry, telemetryAt: obs.telemetryAt, armed: obs.armed, armedAt: obs.armedAt, voltage_cV: obs.voltage_cV, voltageAt: obs.voltageAt, ack: obs.lastAck });
    } catch { /* analysis never touches the safety path */ }
  }

  function runEffect(fx) {
    switch (fx.type) {
      case 'stop-and-prove':
        if (fwBusy) { scanAbort = true; break; } // in 4-way mode no zero command can be delivered: the scan finishes by leaving 4-way, then the stop proof runs
        immediateStop(); runStopLoop('proof', true); break;
      case 'start-fourway-scan': runFourWayScan(); break;
      case 'start-restore': runRestore(); break;
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
  function transportAlive() { return !!(transport && session && !session.closed && !fwBusy && machine.capabilities().transportAvailable); }

  function sendStopTracked() {
    if (!boundary || fwBusy) return false;
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

  // ---- ESC identification (read-only 4-way scan) and the proof that ordinary MSP is back. Every decision is the machine's; this only drives I/O.
  const MOTORS_STOPPED = (v) => Array.isArray(v) && v.length === MOTOR.enabledMotors && v.every((x) => x === MOTOR.stopValue);
  async function mspAnswers() { // the strongest available proof that the FC is NOT in 4-way mode: it answers an MSP read
    for (let a = 0; a < 3; a++) { try { if (!session || session.closed) return false; await session.request('MSP_API_VERSION'); return true; } catch { await sleep(200); } }
    return false;
  }
  async function runFourWayScan() {
    const id = ++scanRun;
    scanAbort = false; fwBusy = true; fwView.phase = 'preparing'; fwView.channels = [0, 1, 2, 3].map((i) => ({ channel: i + 1, state: 'waiting' })); emit();
    const finish = async (result, entered) => {
      // restoration is proven by MSP answering, not by 4-way's own exit reply
      const alive = id === scanRun && !disposed && (await mspAnswers());
      if (id !== scanRun || disposed) return;
      if (boundary && typeof boundary.resetParser === 'function') boundary.resetParser();
      fwBusy = false; fwView.phase = 'idle';
      if (machine.state === STATE.ESC_IDENTIFICATION) {
        dispatch(alive ? 'FOURWAY_FINISHED' : 'FOURWAY_UNPROVEN', { result, exitProven: alive, reason: 'fourway-exit-unproven', entered });
      } else if (machine.state === STATE.LOCKED_FAULT) { // the user stopped (or something faulted) during the scan: prove the stop now, or say the link is unusable
        if (alive) runStopLoop('proof', true); else dispatch('TRANSPORT_LOST', { reason: 'fourway-exit-unproven' });
      }
      emit();
    };
    let result = null, entered = false;
    try {
      const [{ FourWayBoundary }, scan] = await Promise.all([import('../fourway/boundary.js'), import('../fourway/scan-result.js')]);
      // let in-flight MSP requests finish, then require the preconditions: every command so far was external 1000, disarmed
      for (let i = 0; i < 40 && Object.values(inflight).some(Boolean); i++) await sleep(25);
      const pre = boundary && MOTORS_STOPPED(boundary.commandedValues()) && obs.armed === false && !Object.values(inflight).some(Boolean);
      if (!pre || scanAbort || id !== scanRun) {
        result = scan.buildScanResult({ reportedCount: null, channels: [], entered: false, exit: { ok: true, reason: 'not entered' }, error: scanAbort ? 'aborted-before-start' : 'preconditions-not-met' });
        return await finish(result, false);
      }
      const fb = new FourWayBoundary({ transport, clock });
      fwView.phase = 'scanning'; emit();
      const ent = await fb.enter();
      entered = ent.ok;
      let raw = [];
      if (ent.ok && !scanAbort && id === scanRun) {
        raw = await fb.identifyAll({
          count: ent.escCount, shouldAbort: () => scanAbort || id !== scanRun,
          onProgress: ({ phase, channel }) => { const c = fwView.channels[channel]; if (c && phase === 'init') { c.state = 'connecting'; emit(); } },
        });
        if (raw.some((r) => r && r.init)) await fb.resetChannels(raw.filter((r) => r && r.init).map((r) => r.channel));
      }
      fwView.phase = 'leaving'; emit();
      const exit = fb.active ? await fb.exit() : { ok: true, reason: 'not entered' };
      result = scan.buildScanResult({ reportedCount: ent.ok ? ent.escCount : null, channels: raw, entered: ent.ok, exit, error: ent.ok ? null : ent.reason });
      const entry = machine.ctx.combo && machine.ctx.combo.entry;
      if (entry && entry.referenceEscFamily) result.warnings.push(...scan.compareToReference(result, entry.referenceEscFamily));
      return await finish(result, entered);
    } catch (e) {
      result = result || { status: 'unavailable', expected: 4, reportedCount: null, channels: [], consistent: null, warnings: ['The scan stopped on an internal error.'], exit: { ok: false, reason: 'error' }, note: 'Retail model cannot be independently verified' };
      return finish(result, entered);
    }
  }
  function tryFinishRestore() { if (machine.state === STATE.POST_SCAN_RESTORE) dispatch('RESTORE_COMPLETE'); }
  // After 4-way: re-read the identity (a different board is a fault), then external 1000 with read-back and valid zero RPM until proven.
  async function runRestore() {
    const id = ++proofRun;
    let ok = false;
    try {
      const names = ['MSP_API_VERSION', 'MSP_FC_VARIANT', 'MSP_FC_VERSION', 'MSP_BOARD_INFO', 'MSP_UID', 'MSP_MOTOR_CONFIG', 'MSP_ADVANCED_CONFIG'];
      const snap = await session.collectSnapshot(names);
      const same = (n, f) => { const a = snapshot && snapshot.reads[n] && snapshot.reads[n].ok ? f(snapshot.reads[n].value) : null; const b = snap.reads[n] && snap.reads[n].ok ? f(snap.reads[n].value) : null; return a !== null && a === b; };
      ok = rawKey(snap) === identityKey && same('MSP_FC_VERSION', (v) => v.text) && same('MSP_FC_VARIANT', (v) => v.variant) && same('MSP_API_VERSION', (v) => v.text) && same('MSP_BOARD_INFO', (v) => v.boardId);
    } catch { ok = false; }
    if (id !== proofRun || disposed) return;
    dispatch('RESTORE_IDENTITY', { ok });
    if (!ok || machine.state !== STATE.POST_SCAN_RESTORE) return;
    let t0 = now(), proven = false, readbackBusy = false;
    immediateStop();
    while (id === proofRun && !disposed) {
      if (machine.state !== STATE.POST_SCAN_RESTORE || !transportAlive()) return;
      const caps = machine.capabilities(now());
      if (caps.proof.partsDone) {
        t0 = now();
        if (!proven) { const r = dispatch('SAFE_STATE_DONE'); proven = r.ok; }
        tryFinishRestore();
        if (machine.state !== STATE.POST_SCAN_RESTORE) return;
      } else if (now() - t0 > n.stopProofTimeoutMs) { dispatch('FAULT', { reason: 'restore-incomplete' }); return; }
      sendStopTracked();
      if (caps.proof.attempts >= n.stopMinAttempts && !caps.proof.partsDone && !readbackBusy && session) {
        readbackBusy = true;
        session.request('MSP_MOTOR').then((v) => { dispatch('READBACK', { values: v.values.slice(0, MOTOR.enabledMotors) }); }).catch(() => { dispatch('READBACK', { values: null }); }).finally(() => { readbackBusy = false; });
      }
      await sleep(caps.proof.partsDone ? n.stopCadenceMs * 10 : n.stopCadenceMs);
    }
  }

  // ---- sweep: ramp, candidate validation, plateau. Driven by the poll loop; every output goes through the boundary.
  function beginSweep() {
    try { collector.begin({ motor: machine.ctx.selectedMotor, voltageBefore_cV: obs.voltage_cV, voltageBeforeAgeMs: obs.voltageAt === null ? null : now() - obs.voltageAt, expectedPosition: EXPECTED_POSITIONS[machine.ctx.selectedMotor] }); } catch { /* analysis only */ }
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
        try { collector.setControllerThreshold(sweep.threshold); } catch { /* analysis only */ }
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
      session.request('MSP_ANALOG').then((v) => { obs.voltage_cV = v.voltage_cV; obs.voltageAt = now(); }).catch(() => {}).finally(() => { inflight.analog = false; });
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
      if (!fwBusy) pollOnce(); // never MSP while the FC speaks 4-way
      if (machine.state !== STATE.DISCONNECTED && machine.state !== STATE.READ_ONLY_READINESS) observe();
      collectSample(); // records the observation as the machine just saw it, before this tick changes the output
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
      motorProtocol: adv ? PROTOCOL_NAMES[adv.motorProtocol] : null, fcFingerprint: fingerprint,
    };
  }
  // The raw UID is used here, in memory, only to notice a different board after a reconnect or a scan. It is never part of identity(), the view, a record or an export.
  function rawKey(snap = snapshot) {
    const r = (name) => (snap && snap.reads[name] && snap.reads[name].ok ? snap.reads[name].value : null);
    const uid = r('MSP_UID'), bi = r('MSP_BOARD_INFO');
    return JSON.stringify([uid ? uid.hex : null, bi && bi.targetName]);
  }

  // the view (what the UI can reach) never carries the raw UID
  function redactedSnapshot() {
    if (!snapshot) return snapshot;
    const reads = { ...snapshot.reads };
    if (reads.MSP_UID) reads.MSP_UID = reads.MSP_UID.ok ? { ok: true, value: { redacted: true } } : reads.MSP_UID;
    return { ...snapshot, reads };
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
        obs.lastAck = { ok: a.ok === true, kind: a.kind };
        if (a.kind === 'stop' && a.ok) dispatch('STOP_ACKED');
        dispatch('ACK_RESULT', { ok: a.ok, consecutiveFailures: a.consecutiveFailures });
      },
    });
    obs.telemetry = null; obs.telemetryAt = null; obs.armed = null; obs.armedAt = null; obs.voltage_cV = null; obs.voltageAt = null; obs.readback = null; obs.lastSendAt = -1; obs.lastAck = null;
    t.onClose((reason) => onTransportClosed(t, reason));
  }

  function onTransportClosed(t, reason) {
    if (t !== transport) return; // a late event from an old transport
    stopPolling(); proofRun++; scanRun++; fwBusy = false; sweep = null;
    notes.message = `The connection closed (${reason}).`;
    dispatch('TRANSPORT_LOST', { reason: String(reason) });
  }

  async function connect(t) {
    notes.error = ''; notes.message = '';
    const st = machine.state;
    try {
      if (st === STATE.DISCONNECTED || st === STATE.UNCLEAN_EXIT_RECOVERY) {
        await t.open();
        if (st === STATE.DISCONNECTED) { try { collector.clear(); } catch { /* analysis only */ } } // a new session starts with no analysis data
        attach(t);
        const r = dispatch('CONNECT', { transportKind: t.kind });
        if (!r.ok) { notes.error = r.reason; return r; }
        startPolling();
        if (machine.state === STATE.READ_ONLY_READINESS) { snapshot = await session.collectSnapshot(); const b = snapshot.reads.MSP_BOXIDS; boxIds = b && b.ok ? b.value : null; identityKey = rawKey(); fingerprint = await deriveFingerprint(((snapshot.reads.MSP_UID && snapshot.reads.MSP_UID.ok && snapshot.reads.MSP_UID.value.hex) || null), identity().targetName); refreshReadiness(); }
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
          if (rawKey() !== identityKey) dispatch('FAULT', { reason: 'different-flight-controller-after-reconnect' });
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
    // The user accepts that ESC identification was incomplete (warning path). Only meaningful in POST_SCAN_RESTORE; the machine decides.
    acknowledgeEscWarning() { const r = dispatch('ESC_ACK'); if (r.ok) tryFinishRestore(); return r; },
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
    reportPosition(physical) { try { collector.setReportedPosition(physical); } catch { /* analysis only */ } return dispatch('POSITION_REPORTED', { physical }); }, // noted first: a mismatch faults inside this dispatch and ends the sweep record
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
        caps: machine.capabilities(t), trace: machine.trace, attestations, escScan: { busy: fwBusy, phase: fwView.phase, channels: fwView.channels.map((c) => ({ ...c })) }, notes: { ...notes }, snapshot: redactedSnapshot(), identity: identity(),
        telemetry: obs.telemetry, telemetryAgeMs: obs.telemetryAt === null ? null : t - obs.telemetryAt, armed: obs.armed, voltage_cV: obs.voltage_cV,
        readiness: machine.ctx.readinessReport, markerStatus: marker.status(),
        sweep: sweep ? { motor: sweep.motor, phase: sweep.phase, output: sweep.output, elapsedMs: t - sweep.startedAt, threshold: sweep.threshold } : null,
        analysis: api.analysisSummary(), commanded: boundary ? boundary.commandedValues() : null, transportKind: transport ? transport.kind : null,
      };
    },
    dispose() { disposed = true; stopPolling(); proofRun++; if (graceTimer !== null) clock.clearTimeout(graceTimer); if (escTimer !== null) clock.clearTimeout(escTimer); },
    // ---- live MSP/DShot analysis (passive; none of these touch the machine or the boundary)
    analysisResult() {
      try {
        const sw = collector.sweeps();
        const key = sw.map((x) => x.id + x.status[0]).join(',');
        if (!sw.some((x) => x.status !== 'collecting')) return null;
        if (resultCache.key !== key) resultCache = { key, value: buildBenchResult(sw, { sessionNotes: [] }) };
        return resultCache.value;
      } catch { return null; }
    },
    analysisSummary() { const sw = collector.sweeps(); return { sweeps: sw.length, collecting: collector.isActive(), samples: sw.reduce((n, x) => n + x.samples.length, 0), truncated: sw.some((x) => x.truncated) }; },
    // The derived record is stored only when the user asks. Live samples are kept only with retainSamples:true (default off).
    saveAnalysis({ retainSamples = false } = {}) {
      try {
        const result = api.analysisResult();
        if (!result) return { ok: false, reason: 'no-result' };
        const record = buildHistoryRecord({ result, identity: identity(), now: Date.now(), samplesRetained: retainSamples === true, esc: machine.ctx.esc.result });
        const set = retainSamples === true ? buildEvidenceExport({ sweeps: collector.sweeps(), result, identity: identity(), now: Date.now(), esc: machine.ctx.esc.result }) : null;
        const r = saveStoredDiagnostic(record, set, diagStorage);
        return { ...r, id: record.id, recordBytes: approxBytes(record), sampleBytes: set ? approxBytes(set) : 0 };
      } catch { return { ok: false, reason: 'error' }; }
    },
    // Approximate size of the live samples, shown before the user chooses to keep them.
    approxSampleBytes() { try { const result = api.analysisResult(); return result ? approxBytes(buildEvidenceExport({ sweeps: collector.sweeps(), result, identity: identity(), esc: machine.ctx.esc.result })) : 0; } catch { return 0; } },
    exportEvidence() { try { const result = api.analysisResult(); return result ? buildEvidenceExport({ sweeps: collector.sweeps(), result, identity: identity(), esc: machine.ctx.esc.result }) : null; } catch { return null; } },
    savedDiagnostics() { return { ...listStoredDiagnostics(diagStorage), size: storedDiagnosticsSize(diagStorage) }; },
    deleteSavedDiagnostics() { return deleteStoredDiagnostics(diagStorage); },
    // test access
    _collector: collector,
    _obs: obs,
    _rawUidHexForTests: () => (snapshot && snapshot.reads.MSP_UID && snapshot.reads.MSP_UID.ok ? snapshot.reads.MSP_UID.value.hex : null),
    _sweepForTests: () => sweep,
  };
  return api;
}
