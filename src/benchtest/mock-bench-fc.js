// Motor bench test (Phase 3): a SYNTHETIC flight controller that also accepts motor frames, with fault injection.
// Everything here is simulated. No real aircraft, port or motor is involved. It is the only transport the automated tests
// and the lab's synthetic mode use.
//
// Physical model: a motor "rotates" (nonzero RPM) when the commanded external value is at or above that motor's start value.
// Fault injection flags live in `fc.inject` and can be changed at any time during a test.
import { ALLOWED_REQUESTS, encodeResponseV1 } from '../preflight/msp-codec.js';
import { MockTransport } from '../preflight/transport.js';
import { defaultFc, payloadFor } from '../preflight/mock-fc.js';
import { buildMotorAck, parseMotorFrame } from './motor-control.js';

export function benchFc(over = {}) {
  const fc = { ...defaultFc(), target: 'SYNTH', ...over };
  fc.motors = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
  fc.startValue = over.startValue || [1030, 1040, 1035, 1045]; // per-motor value where RPM begins
  fc.rpmPerUnit = over.rpmPerUnit || 40;
  fc.analog = { v_cV: 1480, mAh: 0, amp_cA: 0 };
  fc.inject = {
    silentSetMotor: false, // no acknowledgement for motor frames
    rejectSetMotor: false, // MSP error frame for motor frames
    stuckReadback: null, // array of four values returned by MSP_MOTOR regardless of commands
    ignoreStop: false, // motor frames are acknowledged but the model does not change (RPM stays, readback stays)
    rpmFrozen: null, // array of four RPM values reported regardless of the model
    invalidPct_centi: null, // array of four DShot invalidPct values (10000 = statistics unavailable); null = a build with working statistics (0)
    telemetrySilent: false, // MSP_MOTOR_TELEMETRY gets no reply
    telemetryError: false, // MSP error frame
    extraRpm: null, // { index, rpm }: another motor reports rotation
    armed: false,
    voltage_cV: null, // overrides MSP_ANALOG voltage when set
    tempC: 0,
    statusSilent: false,
    sagOnNonzero_cV: 0, // voltage sag while any motor is commanded above stop
    ...(over.inject || {}),
  };
  fc.received = []; // every motor frame the FC accepted, as eight values
  return fc;
}

function rpmFor(fc) {
  const i = fc.inject;
  if (i.rpmFrozen) return i.rpmFrozen.slice();
  const out = fc.motors.slice(0, 4).map((v, k) => (v >= fc.startValue[k] ? (v - 1000) * fc.rpmPerUnit : 0));
  if (i.extraRpm) out[i.extraRpm.index] = i.extraRpm.rpm;
  return out;
}

export function benchFcTransport(over = {}, opts = {}) {
  const fc = benchFc(over);
  const idToName = Object.fromEntries(Object.entries(ALLOWED_REQUESTS).map(([k, v]) => [v, k]));
  class BenchMock extends MockTransport {
    _write(bytes) {
      const values = parseMotorFrame(bytes);
      if (values === null) return super._write(bytes);
      this.sent.push(Uint8Array.from(bytes));
      const i = fc.inject;
      if (!i.ignoreStop) { fc.motors = values.slice(); fc.received.push(values.slice()); }
      else fc.received.push(values.slice());
      if (i.silentSetMotor) return undefined;
      const out = buildMotorAck(!i.rejectSetMotor);
      if (!this.closed) queueMicrotask(() => { if (!this.closed) this._emitData(out); });
      return undefined;
    }
  }
  const t = new BenchMock((id) => {
    const name = idToName[id];
    const i = fc.inject;
    if (!name || fc.silent.includes(name)) return null;
    if (fc.rejected.includes(name)) return 'error';
    if (name === 'MSP_MOTOR_TELEMETRY') {
      if (i.telemetrySilent) return null;
      if (i.telemetryError) return 'error';
      fc.telemetry = rpmFor(fc).map((rpm, k) => ({ rpm, invalidPct: i.invalidPct_centi ? i.invalidPct_centi[k] : 0, temp: i.tempC, volt: 0, cur: 0, cons: 0 }));
    }
    if ((name === 'MSP_STATUS_EX' || name === 'MSP_BOXIDS') && i.statusSilent) return null;
    if (name === 'MSP_STATUS_EX') fc.armed = i.armed;
    if (name === 'MSP_ANALOG') {
      const sag = fc.motors.slice(0, 4).some((v) => v > 1000) ? i.sagOnNonzero_cV : 0;
      fc.analog = { ...fc.analog, v_cV: i.voltage_cV != null ? i.voltage_cV : 1480 - sag };
    }
    let p;
    if (name === 'MSP_MOTOR' && i.stuckReadback) p = [...i.stuckReadback.slice(0, 4), 0, 0, 0, 0].flatMap((v) => [v & 0xff, (v >> 8) & 0xff]);
    else p = payloadFor(name, fc);
    return p ? encodeResponseV1(id, p) : null;
  }, opts);
  t.fc = fc;
  return t;
}
