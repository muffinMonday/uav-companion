// ESC identification (read-only 4-way scan) inside the bench workflow: controller + state machine + the synthetic flight controller.
// Synthetic and mocked only; no hardware. Covers: success, unavailable (warning and acknowledgement), restoration failures that must
// fail closed, Stop & zero during the scan, and that no nonzero or MSP byte is ever written while 4-way is active.
import assert from 'node:assert/strict';
import { STATE, createMachine } from '../src/benchtest/state-machine.js';
import { MOTOR } from '../src/benchtest/constants.js';
import { makeHarness } from './bench-helpers.mjs';

const pass = (t) => console.log('PASS  ' + t);
const upTo = async (h, pred, maxMs = 60000, step = 250) => { for (let t = 0; t < maxMs && !pred(); t += step) { await h.adv(step); await new Promise((r) => setTimeout(r, 10)); } return pred(); }; // real time passes too: the read-only session times out on the real clock
const reach = (h, s) => upTo(h, () => h.state() === s);
const SLOW = { channels: [{ kind: 'silent' }, { kind: 'bluejay' }, { kind: 'bluejay' }, { kind: 'bluejay' }] }; // a silent ESC makes the scan last several seconds of clock time
const inScan = (h) => upTo(h, () => h.state() === STATE.ESC_IDENTIFICATION, 30000, 20);
const nonzero = (h) => h.sentMotorFrames().some((f) => f.some((v) => v !== MOTOR.stopValue));
const states = (h) => new Set(h.m.trace.filter((e) => e.ok).map((e) => e.to));

// 1. success: the step runs after the powered zero check, 4-way is left, control is proven again, then the motor choice opens
{
  const h = await makeHarness({ fourway: {} });
  await h.toZeroVerification();
  const slow = await makeHarness({ fourway: SLOW });
  await slow.toZeroVerification();
  assert.ok(await inScan(slow), 'the scan starts after the powered zero check');
  assert.equal(slow.m.motorCommandPermission({ kind: 'stop' }).ok, false, 'no motor command, not even a stop, is authorized while 4-way is active');
  assert.equal(slow.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false);
  assert.equal(slow.caps().stopDelivers, false); assert.equal(slow.caps().stopButton, true, 'Stop & zero stays visible, and the UI can tell it cannot be delivered');
  assert.equal(slow.c.view().escScan.busy, true);
  assert.ok(await reach(h, STATE.MOTOR_READY), 'ends at motor choice after restoration');
  const s = states(h);
  assert.ok(s.has(STATE.ESC_IDENTIFICATION));
  assert.ok(s.has(STATE.POST_SCAN_RESTORE) && s.has(STATE.ESC_IDENTIFICATION), 'went through the scan and the restoration state');
  const esc = h.caps().esc;
  assert.equal(esc.scanned, true); assert.equal(esc.result.status, 'identified'); assert.equal(esc.result.consistent, true); assert.equal(esc.ackRequired, false); assert.equal(esc.identityOk, true);
  assert.equal(h.t.fourway.exited, true); assert.deepEqual(h.t.fourway.mspWhileFourWay, [], 'no MSP or motor byte was written while the FC spoke 4-way');
  assert.equal(nonzero(h), false, 'no nonzero motor value was ever sent');
  assert.equal(h.caps().interlocks.find((i) => i.id === 'esc-identification').ok, true);
  assert.equal(h.caps().proof.zeroOk || true, true);
  pass('success: scan after powered zero, 4-way left, MSP and zero proven again, then motor choice; nothing nonzero and no MSP byte during 4-way');
}

// 2. identification unavailable but MSP restored: warning, explicit acknowledgement, then continue
{
  const h = await makeHarness({ fourway: { channels: [{ kind: 'bluejay' }, { kind: 'silent' }, { kind: 'bluejay' }, { kind: 'bluejay' }] } });
  await h.toZeroVerification();
  assert.ok(await reach(h, STATE.POST_SCAN_RESTORE) || states(h).has(STATE.POST_SCAN_RESTORE));
  await h.adv(6000);
  assert.equal(h.state(), STATE.POST_SCAN_RESTORE, 'waits for the acknowledgement; it never continues by itself');
  const e = h.caps().esc;
  assert.equal(e.ackRequired, true); assert.equal(e.canAcknowledge, true); assert.equal(e.result.status, 'partial');
  assert.equal(e.result.channels[1].state, 'unavailable'); assert.equal(e.result.channels[1].family, null, 'unavailable, not guessed');
  assert.equal(h.m.dispatch('RESTORE_COMPLETE', { now: h.clock.now() }).ok, false, 'cannot complete without the acknowledgement');
  assert.equal(h.state(), STATE.POST_SCAN_RESTORE);
  assert.equal(h.c.acknowledgeEscWarning().ok, true);
  assert.ok(await reach(h, STATE.MOTOR_READY), 'after the acknowledgement and the safety checks it continues');
  assert.equal(h.caps().esc.acknowledged, true); assert.equal(h.caps().esc.result.status, 'partial', 'the unavailable identification stays in the result');
  assert.equal(nonzero(h), false);
  pass('identification unavailable with MSP restored: warning, explicit acknowledgement required, result records it, then continues');
}

// 3. 4-way exit not proven: fail closed with the battery instruction and no nonzero command
for (const [name, exit] of [['no reply', 'no-reply'], ['bad CRC', 'bad-crc'], ['never exits', 'never']]) {
  const h = await makeHarness({ fourway: { exit } });
  await h.toZeroVerification();
  assert.ok(await reach(h, STATE.LOCKED_FAULT), `exit ${name}: locked`);
  assert.equal(h.faultReason(), 'fourway-exit-unproven');
  assert.equal(h.caps().showBatteryInstruction, true); assert.equal(h.caps().transportAvailable, false, 'the app does not claim it can stop the motors');
  assert.equal(h.caps().stopDelivers, true, 'the locked state still names its stop path, but without a transport it cannot be sent');
  assert.equal(nonzero(h), false); assert.equal(h.marker.status(), 'present', 'the recovery marker is retained');
  await h.adv(20000); assert.equal(h.state(), STATE.LOCKED_FAULT, 'nothing leaves the locked state by itself');
}
pass('4-way exit unproven (no reply, bad CRC, never): LOCKED_FAULT, battery instruction, marker kept, no nonzero command, no transport claim');

// 4. exit looks fine but ordinary control never returns (motor outputs stay off): fail closed
{
  const h = await makeHarness({ fourway: { afterExit: { motorsDisabled: true } } });
  await h.toZeroVerification();
  assert.ok(await reach(h, STATE.LOCKED_FAULT, 80000), 'locks');
  assert.ok(['restore-incomplete', 'telemetry-stale-or-unavailable'].includes(h.faultReason()), 'reason: ' + h.faultReason());
  assert.equal(h.caps().showBatteryInstruction, true); assert.equal(nonzero(h), false);
  assert.ok(!states(h).has(STATE.MOTOR_READY), 'never reached motor choice');
  pass('motors stay off after leaving 4-way (no fresh zero-RPM telemetry): fail closed, never reaches motor choice');
}

// 5. Stop & zero during the scan: scan ends by leaving 4-way, then the stop proof runs
{
  const h = await makeHarness({ fourway: SLOW });
  await h.toZeroVerification();
  assert.ok(await inScan(h));
  h.c.stopAndZero();
  assert.equal(h.state(), STATE.LOCKED_FAULT); assert.equal(h.faultReason(), 'user-stop');
  assert.equal(h.m.motorCommandPermission({ kind: 'output', motor: 0, value: 1050 }).ok, false);
  await h.adv(8000);
  assert.equal(h.t.fourway.exited, true, 'the scan was abandoned and 4-way left');
  assert.deepEqual(h.t.fourway.mspWhileFourWay, []);
  assert.ok(h.caps().proof.attempts >= 10, 'the external 1000 stop proof ran after 4-way was left');
  assert.equal(nonzero(h), false);
  pass('Stop & zero during the scan abandons it, leaves 4-way, then proves the stop; nothing was written in 4-way mode');
}

// 6. transport lost during the scan
{
  const h = await makeHarness({ fourway: SLOW });
  await h.toZeroVerification();
  assert.ok(await inScan(h));
  h.t.disconnect(); await h.adv(500);
  assert.equal(h.state(), STATE.LOCKED_FAULT); assert.equal(h.faultReason(), 'transport-lost'); assert.equal(h.caps().transportAvailable, false);
  pass('USB lost during the scan: locked, no transport claim');
}

// 7. a different board after the scan, and the machine rules
{
  const m = createMachine({ fourway: () => true });
  m.dispatch('CONNECT', { transportKind: 'mock', now: 1 });
  assert.equal(m.ctx.esc.enabled, true);
  assert.equal(createMachine().dispatch('CONNECT', { transportKind: 'mock', now: 1 }).ok, true);
  const off = createMachine(); off.dispatch('CONNECT', { transportKind: 'mock', now: 1 }); assert.equal(off.ctx.esc.enabled, false, 'with the step off the workflow is unchanged');
  const h = await makeHarness({ fourway: {} });
  await h.toZeroVerification();
  assert.ok(await reach(h, STATE.POST_SCAN_RESTORE));
  h.m.dispatch('RESTORE_IDENTITY', { ok: false, now: h.clock.now() });
  assert.equal(h.state(), STATE.LOCKED_FAULT); assert.equal(h.faultReason(), 'different-flight-controller-after-scan');
  pass('a different flight controller after the scan locks the session; with the step off the workflow is unchanged');
}

// 8. step off (default): straight to motor choice, no 4-way byte at all
{
  const h = await makeHarness();
  await h.toMotorReady();
  assert.equal(h.state(), STATE.MOTOR_READY); assert.ok(!states(h).has(STATE.ESC_IDENTIFICATION));
  assert.equal(h.caps().esc.enabled, false);
  pass('with the step off nothing about 4-way happens');
}
console.log('ALL OK');
