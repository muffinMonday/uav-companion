// Shared helpers for the Phase 3 bench-test suites: a deterministic clock, an in-memory storage and a harness that drives
// the controller against the synthetic flight controller. Synthetic and mocked only; nothing here touches hardware.
import { createBenchController } from '../src/benchtest/controller.js';
import { benchFcTransport } from '../src/benchtest/mock-bench-fc.js';
import { STATE } from '../src/benchtest/state-machine.js';
import { createMarkerStore } from '../src/benchtest/recovery-marker.js';
import { CHECKLIST_ITEMS, EXPECTED_POSITIONS } from '../src/benchtest/constants.js';

export class FakeClock {
  constructor() { this.t = 1_000_000; this.timers = []; this.seq = 0; }
  now() { return this.t; }
  setTimeout(fn, ms) { const id = ++this.seq; this.timers.push({ id, at: this.t + Math.max(0, ms), fn }); return id; }
  clearTimeout(id) { this.timers = this.timers.filter((x) => x.id !== id); }
  async flush() { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); }
  async advance(ms) {
    const end = this.t + ms;
    await this.flush();
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
      await this.flush();
    }
    this.t = end;
    await this.flush();
  }
}

export function memoryStorage(opts = {}) {
  const m = new Map();
  return {
    getItem: (k) => { if (opts.failRead) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (opts.failWrite) throw new Error('quota'); m.set(k, opts.corruptWrite ? v + 'x' : String(v)); },
    removeItem: (k) => { if (opts.failRemove) throw new Error('blocked'); if (opts.ignoreRemove) return; m.delete(k); },
    _map: m,
  };
}

export const ESC = { escFamily: 'Bluejay', escModel: 'synthetic' };

// A fully formed TEST fixture for a real-hardware allowlist entry (identity of the synthetic aircraft plus reviewed evidence). Never in src.
export const REAL_ENTRY = Object.freeze({ variant: 'BTFL', firmware: '2025.12.5', api: '1.47', targetName: 'SYNTH', boardId: 'SYN1', escFamily: 'Bluejay', escModel: 'synthetic', motorProtocol: 'DSHOT600', approvedBy: 'test owner', approvedOn: '2026-12-02', stopValidatedOn: '2026-12-01', stopValidatedBy: 'test owner', stopValidationTraceSha256: 'a'.repeat(64), externalStopValue: 1000, poweredStopValidated: true });

export async function makeHarness({ fc = {}, storage = memoryStorage(), allowlist, transportOpts } = {}) {
  const clock = new FakeClock();
  const marker = createMarkerStore(storage);
  const c = createBenchController({ clock, marker, ...(allowlist ? { allowlist } : {}) });
  const t = benchFcTransport(fc, transportOpts);
  const h = {
    clock, marker, storage, c, t, m: c.machine, fc: t.fc,
    state: () => c.machine.state,
    caps: () => c.view().caps,
    adv: (ms) => clock.advance(ms),
    reasons: () => c.machine.trace.filter((e) => !e.ok).map((e) => e.reason),
    faultReason: () => (c.machine.ctx.fault ? c.machine.ctx.fault.reason : null),
    sentMotorFrames: () => t.fc.received,
    async toReadiness() {
      await c.connect(t);
      c.setAttestation({ armSwitchOff: true, batteryDisconnected: true, blackboxMode: 'MOTOR_TEST' });
      c.setManual(ESC);
      return h;
    },
    async toSafeState() { await h.toReadiness(); c.proceed(); await h.adv(1500); return h; },
    async toChecklist() { await h.toSafeState(); return h; },
    async toReadyToPower() {
      await h.toChecklist();
      for (const i of CHECKLIST_ITEMS) c.setChecklistItem(i.key, true);
      c.confirmChecklist(1000);
      return h;
    },
    async toZeroVerification() { await h.toReadyToPower(); c.declareBatteryConnected(); await h.adv(5100); return h; },
    async toMotorReady() { await h.toZeroVerification(); await h.adv(3500); return h; },
    async startMotor(motor = 0) {
      c.selectMotor(motor); c.confirmTarget(motor);
      return c.startMotor(1000);
    },
    async finishStopProof(physical) {
      await h.adv(3000);
      c.confirmNoRotation();
      return c.reportPosition(physical);
    },
  };
  return h;
}

export { STATE, EXPECTED_POSITIONS, CHECKLIST_ITEMS };
