// Motor bench test (Phase 3): THE guarded motor-control boundary.
//
// This is the ONLY module in the repository that may build or send an MSP_SET_MOTOR frame. A static test
// (tests/bench-safety-unit.mjs) fails if the message id, its name or a raw transport write appears anywhere else.
//
// Every frame passes four independent checks before it leaves:
//   1. the state machine's permission (`authorize`, the single authoritative decision),
//   2. this module's own hard limits (integer values; stop value or 1020..1100; never above the cap, whatever the state machine says),
//   3. one motor at a time (the frame carries the selected motor's value; every other slot is the stop value 1000),
//   4. the permission's own ceiling (a stop-validation-only permission has maxValue 1000, so it can never send anything else).
// It also tracks acknowledgements (150 ms, two consecutive failures raise a fault through `onAck`). An acknowledgement is
// NOT stop proof: it says only that the FC accepted the frame.
//
// Clean-room: the frame layout is the public MSP v1 layout (eight little-endian u16 values). No GPL source is copied.
import { MspParser } from '../preflight/msp-codec.js';
import { BENCH_TIMINGS, MOTOR } from './constants.js';

export const MSP_SET_MOTOR_ID = 214;
const HEADER = [0x24, 0x4d, 0x3c];

export class MotorCommandRefused extends Error {
  constructor(reason) { super(reason); this.name = 'MotorCommandRefused'; this.reason = reason; }
}

// values: array of eight external values (1000..2000 range). Returns the MSP v1 request frame.
export function buildMotorFrame(values) {
  if (!Array.isArray(values) || values.length !== MOTOR.slots) throw new MotorCommandRefused('a motor frame carries exactly eight values');
  const payload = [];
  for (const v of values) {
    if (!Number.isInteger(v) || v < MOTOR.stopValue || v > MOTOR.cap) throw new MotorCommandRefused(`value ${v} is outside ${MOTOR.stopValue}..${MOTOR.cap}`);
    payload.push(v & 0xff, (v >> 8) & 0xff);
  }
  let sum = payload.length ^ MSP_SET_MOTOR_ID;
  for (const b of payload) sum ^= b;
  return Uint8Array.from([...HEADER, payload.length, MSP_SET_MOTOR_ID, ...payload, sum & 0xff]);
}

// For the synthetic FC (the receiving side) and the tests: returns the eight values or null if this is not a motor frame.
export function parseMotorFrame(bytes) {
  if (!bytes || bytes.length !== 6 + 16 || bytes[0] !== 0x24 || bytes[1] !== 0x4d || bytes[2] !== 0x3c || bytes[3] !== 16 || bytes[4] !== MSP_SET_MOTOR_ID) return null;
  let sum = 16 ^ MSP_SET_MOTOR_ID;
  for (let i = 5; i < 21; i++) sum ^= bytes[i];
  if ((sum & 0xff) !== bytes[21]) return null;
  return Array.from({ length: MOTOR.slots }, (_, i) => bytes[5 + i * 2] | (bytes[6 + i * 2] << 8));
}

// For the synthetic FC (the receiving side): the acknowledgement frame, or an MSP error frame when ok is false.
export function buildMotorAck(ok = true) {
  if (!ok) return Uint8Array.from([0x24, 0x4d, 0x21, 0, MSP_SET_MOTOR_ID, MSP_SET_MOTOR_ID]);
  return Uint8Array.from([0x24, 0x4d, 0x3e, 0, MSP_SET_MOTOR_ID, MSP_SET_MOTOR_ID]);
}

const defaultTimers = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };

export class MotorBoundary {
  // transport: the object that moves bytes. authorize(req) -> { ok, maxValue, reason } from the state machine.
  // onAck({ ok, consecutiveFailures, kind }) is called for every command so the machine can fault on repeated failures.
  constructor({ transport, authorize, onAck = () => {}, clock = defaultTimers, motorCount = MOTOR.enabledMotors }) {
    if (typeof authorize !== 'function') throw new MotorCommandRefused('no authorizer');
    this.t = transport; this.authorize = authorize; this.onAck = onAck; this.clock = clock; this.motorCount = motorCount;
    this.parser = new MspParser();
    this.pending = [];
    this.consecutiveFailures = 0;
    this.commanded = Array(MOTOR.slots).fill(MOTOR.stopValue); // what this boundary last sent for each slot
    this.sentFrames = 0;
    transport.onData((b) => this._onData(b));
    transport.onClose(() => this._failAll('transport-closed'));
  }

  // After a 4-way session the bytes the FC sent in that mode may have left a half frame in the parser: start clean.
  resetParser() { this.parser = new MspParser(); }

  _onData(bytes) {
    for (const ev of this.parser.push(bytes)) {
      if (ev.type !== 'frame' || ev.cmd !== MSP_SET_MOTOR_ID) continue;
      const p = this.pending.shift();
      if (p) { this.clock.clearTimeout(p.timer); this._settle(p, !ev.flagError); }
    }
  }

  _settle(p, ok, notify = true) {
    this.consecutiveFailures = ok ? 0 : this.consecutiveFailures + 1;
    if (notify) { try { this.onAck({ ok, consecutiveFailures: this.consecutiveFailures, kind: p.kind }); } catch { /* the machine decides; a listener error never blocks the command path */ } }
    p.resolve({ ok, consecutiveFailures: this.consecutiveFailures });
  }

  // The transport closed: pending commands fail, but the loss itself is reported by the transport's close event
  // (TRANSPORT_LOST), not as an acknowledgement failure.
  _failAll() {
    for (const p of this.pending.splice(0)) { this.clock.clearTimeout(p.timer); this._settle(p, false, false); }
  }

  // External 1000 on every motor. Needs only the stop permission (valid in every state that has a motor path).
  sendStop() {
    return this._send({ kind: 'stop' }, Array(MOTOR.slots).fill(MOTOR.stopValue));
  }

  // One motor at a nonzero value (or 1000). Everything else stays at 1000.
  sendOutput(motor, value) {
    if (!Number.isInteger(motor) || motor < 0 || motor >= this.motorCount) throw new MotorCommandRefused('motor index outside the four enabled motors');
    if (!Number.isInteger(value)) throw new MotorCommandRefused('value is not an integer');
    if (value !== MOTOR.stopValue && (value < MOTOR.startValue || value > MOTOR.cap)) throw new MotorCommandRefused(`value ${value} is outside the permitted range`);
    const values = Array(MOTOR.slots).fill(MOTOR.stopValue);
    values[motor] = value;
    return this._send({ kind: 'output', motor, value }, values);
  }

  _send(req, values) {
    const perm = this.authorize(req);
    if (!perm || perm.ok !== true) throw new MotorCommandRefused(perm && perm.reason ? perm.reason : 'not authorized');
    const top = Math.max(...values);
    if (top > MOTOR.cap) throw new MotorCommandRefused('above the absolute cap');
    if (top > perm.maxValue) throw new MotorCommandRefused('above the ceiling of the current permission');
    const raised = values.map((v, i) => (v !== MOTOR.stopValue ? i : -1)).filter((i) => i >= 0);
    if (raised.length > 1) throw new MotorCommandRefused('more than one motor');
    if (this.pending.length >= 64) throw new MotorCommandRefused('too many unacknowledged commands');
    const frame = buildMotorFrame(values);
    this.commanded = values.slice();
    this.sentFrames++;
    return new Promise((resolve) => {
      const p = { kind: req.kind, resolve, timer: null };
      p.timer = this.clock.setTimeout(() => {
        const i = this.pending.indexOf(p);
        if (i >= 0) { this.pending.splice(i, 1); this._settle(p, false); }
      }, BENCH_TIMINGS.motorAckTimeoutMs);
      this.pending.push(p);
      try {
        const w = this.t._write(frame); // the only raw write in the repository; transport.write() refuses this frame by design
        if (w && w.catch) w.catch(() => { const i = this.pending.indexOf(p); if (i >= 0) { this.pending.splice(i, 1); this.clock.clearTimeout(p.timer); this._settle(p, false); } });
      } catch {
        const i = this.pending.indexOf(p); if (i >= 0) { this.pending.splice(i, 1); this.clock.clearTimeout(p.timer); }
        this._settle(p, false);
      }
    });
  }

  commandedValues() { return this.commanded.slice(0, this.motorCount); }
}
