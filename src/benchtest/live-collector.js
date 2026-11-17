// Motor bench test: the PASSIVE live-sample collector (live MSP/DShot analysis layer).
//
// It records what the controller already observed. It has no reference to the state machine, the motor boundary or the
// transport; it cannot send anything, cannot decide anything and is never read by the safety path. Every public method is
// wrapped by its caller so a failure here can only lose analysis data, never delay or block Stop & zero.
//
// One sample is recorded per NEW telemetry frame (never per tick, never interpolated, never carried forward). Missing,
// stale and unavailable readings are recorded as null with an explicit freshness flag, and gaps between frames are listed.
// Memory is bounded (SAMPLE_LIMITS); anything dropped for that reason sets `truncated`, so a sweep can never look complete
// when it is not. See docs/MOTOR_DIAGNOSTICS_LIVE_ANALYSIS.md for the sample schema and units.
import { ANALYSIS_SCHEMA_VERSION, METRIC_RULES, SAMPLE_LIMITS } from './analysis-constants.js';
import { DSHOT_STATS, MOTOR, BENCH_TIMINGS } from './constants.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function createLiveCollector(opts = {}) {
  const clockNow = typeof opts.clockNow === 'function' ? opts.clockNow : () => Date.now(); // the clock that stamps telemetry frames
  const mono = typeof opts.mono === 'function' ? opts.mono : clockNow; // monotonic time for sample stamps (performance.now in the browser)
  const limits = { ...SAMPLE_LIMITS, ...(opts.limits || {}) };
  const sweeps = []; // every sweep of this session, oldest first, bounded
  let active = null;
  let version = 0;

  function begin(meta = {}) {
    if (active) end('incomplete', { reason: 'superseded-by-new-sweep' });
    const t0 = mono();
    active = {
      id: sweeps.length + 1,
      motor: Number.isInteger(meta.motor) ? meta.motor : null,
      startedAtMono: t0,
      samples: [], gaps: [], unavailable: [],
      truncated: false, droppedSamples: 0, stopSamplesTruncated: false,
      lastFrameAt: null, lastFrameT: null, firstStopT: null, openUnavailable: null,
      status: 'collecting',
      meta: {
        voltageBefore_cV: num(meta.voltageBefore_cV), voltageBeforeAgeMs: num(meta.voltageBeforeAgeMs),
        expectedPosition: typeof meta.expectedPosition === 'string' ? meta.expectedPosition : null,
        controllerThreshold: null,
      },
      end: null,
    };
    sweeps.push(active);
    while (sweeps.length > limits.maxSweeps) sweeps.shift(); // bounded: the oldest attempt is dropped
    version++;
    return active.id;
  }

  // input: { phase, motor, commands: number[4]|null, readback: {values,at,current}|null, telemetry: {motors:[{rpm,invalidPct_centi,temperatureC}]}|null,
  //          telemetryAt, armed, armedAt, voltage_cV, voltageAt, ack: {ok, kind}|null }
  function sample(input) {
    const a = active;
    if (!a || !input) return false;
    const t = mono() - a.startedAtMono;
    const tel = input.telemetry && Array.isArray(input.telemetry.motors) && input.telemetry.motors.length === MOTOR.enabledMotors ? input.telemetry : null;
    const telAt = num(input.telemetryAt);
    const age = tel && telAt !== null ? Math.max(0, clockNow() - telAt) : null;
    const fresh = tel !== null && age !== null && age <= BENCH_TIMINGS.staleTelemetryFaultMs;

    if (!tel || telAt === null || !fresh) { // an unavailable or stale observation: record the episode, never a sample
      if (!a.openUnavailable) { a.openUnavailable = { from: t, to: t, stale: tel !== null }; if (a.unavailable.length < limits.maxGapsPerSweep) a.unavailable.push(a.openUnavailable); }
      else a.openUnavailable.to = t;
      return false;
    }
    a.openUnavailable = null;
    if (a.lastFrameAt === telAt) return false; // the same frame: never a second sample
    if (input.phase === 'stop') {
      if (a.firstStopT === null) a.firstStopT = t;
      if (t - a.firstStopT > limits.stopPhaseMaxMs) { a.stopSamplesTruncated = true; return false; }
    }
    if (a.lastFrameT !== null && t - a.lastFrameT > METRIC_RULES.gapMs && a.gaps.length < limits.maxGapsPerSweep) a.gaps.push({ from: a.lastFrameT, to: t, ms: t - a.lastFrameT });
    a.lastFrameAt = telAt; a.lastFrameT = t;
    if (a.samples.length >= limits.maxSamplesPerSweep) { a.truncated = true; a.droppedSamples++; return false; }

    const cmds = Array.isArray(input.commands) && input.commands.length >= MOTOR.enabledMotors ? input.commands.slice(0, MOTOR.enabledMotors).map(num) : null;
    const rb = input.readback && Array.isArray(input.readback.values) ? input.readback : null;
    a.samples.push({
      t, phase: String(input.phase || ''), motor: a.motor,
      cmd: cmds && a.motor !== null ? cmds[a.motor] : null, cmds,
      rb: rb ? rb.values.slice(0, MOTOR.enabledMotors).map(num) : null,
      rbAgeMs: rb && num(rb.at) !== null ? Math.max(0, clockNow() - rb.at) : null,
      rbCurrent: rb ? rb.current === true : null,
      rpm: tel.motors.map((m) => num(m.rpm)),
      inv: tel.motors.map((m) => { const v = num(m.invalidPct_centi); return v === null || v < 0 || v >= DSHOT_STATS.unavailableSentinel_centi ? null : v; }), // sentinel and bad values: unavailable
      temp: tel.motors.map((m) => { const v = num(m.temperatureC); return v === null || v === 0 ? null : v; }), // 0 means not reported
      v_cV: num(input.voltage_cV) !== null && input.voltage_cV > 0 ? input.voltage_cV : null,
      vAt: num(input.voltageAt),
      armed: input.armed === true ? true : input.armed === false ? false : null,
      armedAgeMs: num(input.armedAt) !== null ? Math.max(0, clockNow() - input.armedAt) : null,
      telAgeMs: age,
      fresh: true,
      ack: input.ack ? (input.ack.ok === true ? 'ok' : 'failed') : 'none',
    });
    version++;
    return true;
  }

  function setControllerThreshold(v) { if (active) active.meta.controllerThreshold = num(v); }

  function end(status, info = {}) {
    const a = active;
    if (!a) return null;
    a.status = status === 'completed' ? 'completed' : 'incomplete';
    a.endedAtT = mono() - a.startedAtMono;
    // the machine ends a sweep the moment telemetry goes stale, before another tick could log the stretch: record it from the last frame
    if (typeof info.reason === 'string' && /^telemetry-/.test(info.reason) && a.lastFrameT !== null && !a.openUnavailable && a.unavailable.length < limits.maxGapsPerSweep) a.unavailable.push({ from: a.lastFrameT, to: a.endedAtT, stale: true });
    a.end = {
      status: a.status,
      reason: typeof info.reason === 'string' ? info.reason : null,
      stopProofComplete: info.stopProofComplete === true ? true : info.stopProofComplete === false ? false : null,
      reportedPosition: typeof info.reportedPosition === 'string' ? info.reportedPosition : null,
    };
    active = null;
    version++;
    return a;
  }

  return {
    begin, sample, end, setControllerThreshold,
    isActive: () => active !== null,
    activeMotor: () => (active ? active.motor : null),
    activeMeta: () => (active ? active.meta : null),
    setReportedPosition(p) { if (active) active.reportedPositionPending = typeof p === 'string' ? p : null; },
    pendingPosition: () => (active ? active.reportedPositionPending || null : null),
    sweeps: () => sweeps,
    version: () => version,
    clear() { sweeps.length = 0; active = null; version++; },
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
  };
}
