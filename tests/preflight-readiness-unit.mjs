// Motor diagnostics Phase 2: read-only readiness gates over synthetic snapshots (no hardware).
// No gate is weakened to pass: every case that is wrong, unknown or unverified must block, and active testing is never eligible.
import assert from 'node:assert/strict';
import { evaluateReadiness } from '../src/preflight/readiness.js';
import { viewState, STATUS_LABEL, OVERALL_TEXT } from '../src/preflight/readiness-ui.js';
import { ReadOnlySession } from '../src/preflight/session.js';
import { mockFcTransport, defaultFc } from '../src/preflight/mock-fc.js';
import { BLACKBOX_MODE_TOKENS, lookupVersion, parseBlackboxModeToken } from '../src/preflight/versions.js';

const pass = (t) => console.log('PASS  ' + t);
const OK_ATT = { armSwitchOff: true, blackboxMode: 'MOTOR_TEST', batteryDisconnected: true };
const snap = (fc, o = { timeoutMs: 15, retries: 0 }) => new ReadOnlySession(mockFcTransport(fc), o).collectSnapshot();
const run = async (fc, att = OK_ATT, kind = 'web-serial') => evaluateReadiness({ snapshot: await snap(fc), attestations: att, transportKind: kind });
const g = (r, id) => r.gates.find((x) => x.id === id);
const bbWith = (mask, extra = {}) => ({ ...defaultFc().blackbox, mask, ...extra });

// ---- baseline: a perfect synthetic candidate aircraft is still only "conditional", never eligible
{
  const r = await run({});
  assert.equal(r.overall, 'conditional'); assert.equal(r.counts.fail, 0); assert.equal(r.counts.unknown, 0);
  assert.equal(r.eligibleForActiveTest, false);
  assert.equal(g(r, 'firmware').status, 'warn'); assert.match(g(r, 'firmware').why, /candidate/);
  assert.equal(g(r, 'bb-mode').status, 'warn'); assert.ok(g(r, 'bb-mode').hardwareUnverified);
  assert.ok(r.hardwareUnverified.includes('firmware') && r.hardwareUnverified.includes('bb-mode'));
  pass('a fully compatible synthetic candidate is "conditional" with hardware-unverified items, and is never eligible for active testing');
  assert.equal(Object.isFrozen(r), true);
}
{
  const r = await run({}, OK_ATT, 'mock');
  assert.equal(g(r, 'transport').status, 'warn'); assert.match(g(r, 'transport').manual, /Synthetic/);
  assert.equal((await run({}, OK_ATT, 'unknown')).overall, 'incomplete');
  pass('a mock transport is labelled synthetic; an unknown transport is not confirmed and the result is incomplete');
}

// ---- firmware identity and allowlist
{
  assert.equal(g(await run({ firmware: '4.3.2', api: '1.44', blackbox: bbWith(0, { maskPresent: false }) }), 'firmware').status, 'fail');
  assert.equal(g(await run({ firmware: '4.4.3', api: '1.45' }), 'firmware').status, 'fail');
  assert.equal(g(await run({ firmware: '4.5.4', api: '1.46' }), 'firmware').status, 'fail');
  assert.equal(g(await run({ firmware: '2025.12.5', api: '1.46' }), 'firmware').status, 'fail', 'right version, wrong API: exact pair required');
  assert.equal(g(await run({ firmware: '2026.6.2', api: '1.49' }), 'firmware').status, 'fail');
  assert.equal(g(await run({ variant: 'INAV' }), 'firmware').status, 'fail');
  assert.equal(g(await run({ silent: ['MSP_FC_VERSION'] }), 'firmware').status, 'unknown');
  for (const [fw, api] of [['4.5.5', '1.46'], ['2025.12.5', '1.47'], ['2026.6.2', '1.48']]) assert.equal(g(await run({ firmware: fw, api }), 'firmware').status, 'warn');
  pass('only exact candidate version and API pairs warn; other 4.5.x, wrong API, master, 4.3/4.4, another firmware and unreadable versions block or stay unknown');
  assert.equal(lookupVersion('2026.6.2', '1.48').status, 'candidate');
  assert.ok(!['4.5.5', '2025.12.5', '2026.6.2'].some((v) => lookupVersion(v, { '4.5.5': '1.46', '2025.12.5': '1.47', '2026.6.2': '1.48' }[v]).status === 'supported'));
  pass('no firmware row is marked supported');
}

// ---- motors, protocol, bidirectional, 3D, poles
{
  assert.equal(g(await run({ motorCount: 6 }), 'motor-count').status, 'fail');
  assert.equal(g(await run({ motorCount: 4 }), 'motor-count').status, 'pass');
  for (const p of [0, 1, 4, 8, 9]) assert.equal(g(await run({ protocol: p }), 'protocol').status, 'fail');
  for (const p of [5, 6, 7]) assert.equal(g(await run({ protocol: p }), 'protocol').status, 'pass');
  assert.equal(g(await run({ dshotTelemetry: false }), 'bidir').status, 'fail');
  assert.equal(g(await run({ dshotTelemetry: true }), 'bidir').status, 'warn', 'the flag alone is never a pass');
  assert.equal(g(await run({ threeD: true }), '3d').status, 'fail');
  for (const n of [0, 5, 29, 255]) assert.equal(g(await run({ poleCount: n }), 'poles').status, 'fail');
  for (const n of [6, 14, 28]) assert.equal(g(await run({ poleCount: n }), 'poles').status, 'pass');
  assert.equal(g(await run({ silent: ['MSP_MOTOR_CONFIG'] }), 'motor-count').status, 'unknown');
  pass('motor count, DShot protocol, bidirectional flag, 3D mode and pole range are enforced; the bidirectional flag alone never passes');
}

// ---- arming
{
  assert.equal(g(await run({ armed: true }), 'arming').status, 'fail');
  assert.equal(g(await run({}, { ...OK_ATT, armSwitchOff: false }), 'arming').status, 'unknown');
  assert.equal(g(await run({}, {}), 'arming').needsAttestation, 'armSwitchOff');
  assert.equal(g(await run({ boxIds: [1, 2, 3] }), 'arming').status, 'unknown', 'no ARM box in the list: unknown, never "disarmed"');
  assert.equal(g(await run({ silent: ['MSP_STATUS_EX'] }), 'arming').status, 'unknown');
  assert.equal(g(await run({ silent: ['MSP_BOXIDS'] }), 'arming').status, 'unknown');
  assert.equal(g(await run({}), 'arming').status, 'warn');
  assert.equal(g(await run({ armed: true, boxIds: [1, 0, 2] }), 'arming').status, 'fail');
  pass('armed blocks; an unconfirmed switch, a missing ARM box or unreadable status is unknown; a disarmed aircraft with a confirmed switch only warns');
}

// ---- Blackbox mode tokens
{
  assert.deepEqual([...BLACKBOX_MODE_TOKENS], ['NORMAL', 'MOTOR_TEST', 'ALWAYS']);
  for (const bad of ['ALWAYS_ON', 'always', 'Motor_Test', 'BLACKBOX_MODE_ALWAYS_ON', ' ', '1', 'MOTOR TEST']) {
    assert.equal(parseBlackboxModeToken(bad), bad === ' ' ? null : null);
    assert.equal(g(await run({}, { ...OK_ATT, blackboxMode: bad }), 'bb-mode').status, 'fail', `token ${bad}`);
  }
  assert.equal(g(await run({}, { ...OK_ATT, blackboxMode: 'NORMAL' }), 'bb-mode').status, 'fail');
  assert.equal(g(await run({}, { ...OK_ATT, blackboxMode: 'MOTOR_TEST' }), 'bb-mode').status, 'warn');
  assert.equal(g(await run({}, { ...OK_ATT, blackboxMode: 'ALWAYS' }), 'bb-mode').status, 'warn');
  assert.equal(g(await run({}, { armSwitchOff: true }), 'bb-mode').status, 'unknown');
  assert.equal(parseBlackboxModeToken(' ALWAYS '), 'ALWAYS');
  pass('Blackbox mode accepts exactly NORMAL, MOTOR_TEST, ALWAYS; ALWAYS_ON and other spellings fail; MOTOR_TEST and ALWAYS are only ever "attested", never a pass');
}

// ---- Blackbox device and field mask, per version
{
  assert.equal(g(await run({ blackbox: { ...defaultFc().blackbox, supported: false } }), 'blackbox').status, 'fail');
  assert.equal(g(await run({ blackbox: { ...defaultFc().blackbox, device: 0 } }), 'blackbox').status, 'fail');
  // 2025.12.5: GYRO 7, MOTOR 11, RPM 13, GYROUNFILT 14
  for (const [name, bit] of [['GYRO', 7], ['MOTOR', 11], ['RPM', 13], ['GYROUNFILT', 14]]) {
    const r = await run({ blackbox: bbWith(1 << bit) });
    assert.equal(g(r, 'bb-fields').status, 'fail', `2025.12.5 ${name}`);
    assert.match(g(r, 'bb-fields').detected, new RegExp(name));
  }
  // bits that are other groups on 2025.12.5 (8 attitude, 9 acc, 10 debug, 12 gps, 15 servo) do not block
  for (const bit of [8, 9, 10, 12, 15, 0, 3]) assert.equal(g(await run({ blackbox: bbWith(1 << bit) }), 'bb-fields').status, 'warn', `2025.12.5 bit ${bit}`);
  // 4.5.5: GYRO 7, MOTOR 10, RPM 12, GYROUNFILT 13 (different from 2025.12.5)
  const f455 = { firmware: '4.5.5', api: '1.46' };
  for (const [name, bit] of [['GYRO', 7], ['MOTOR', 10], ['RPM', 12], ['GYROUNFILT', 13]]) assert.equal(g(await run({ ...f455, blackbox: bbWith(1 << bit) }), 'bb-fields').status, 'fail', `4.5.5 ${name}`);
  assert.equal(g(await run({ ...f455, blackbox: bbWith(1 << 14) }), 'bb-fields').status, 'warn', '4.5.5 bit 14 is not a tracked group');
  assert.equal(g(await run({ ...f455, blackbox: bbWith(1 << 11) }), 'bb-fields').status, 'warn', '4.5.5 bit 11 is GPS, not MOTOR');
  assert.equal(g(await run({ blackbox: bbWith(1 << 12) }), 'bb-fields').status, 'warn', '2025.12.5 bit 12 is GPS, not RPM');
  assert.equal(g(await run({ blackbox: bbWith(0, { maskPresent: false }) }), 'bb-fields').status, 'unknown');
  assert.equal(g(await run({ firmware: '4.4.3', api: '1.45' }), 'bb-fields').status, 'fail', 'no native unfiltered gyro');
  pass('the field mask is read with the bit positions of the firmware that reported it: a bit that is RPM on one tag is GPS on another');
  const all = await run({ blackbox: bbWith((1 << 7) | (1 << 11) | (1 << 13) | (1 << 14)) });
  assert.match(g(all, 'bb-fields').detected, /GYRO, MOTOR, RPM, GYROUNFILT/);
}

// ---- logging rate, storage, battery, telemetry
{
  assert.equal(g(await run({ cycleTimeUs: 250 }), 'bb-rate').status, 'warn');
  assert.equal(g(await run({ cycleTimeUs: 250, blackbox: bbWith(0, { rateDenom: 8 }) }), 'bb-rate').status, 'fail', '4 kHz / 8 = 500 Hz');
  assert.equal(g(await run({ cycleTimeUs: 1000 }), 'bb-rate').status, 'warn', '1 kHz meets the floor exactly');
  assert.equal(g(await run({ cycleTimeUs: 2000 }), 'bb-rate').status, 'fail');
  assert.ok(g(await run({}), 'bb-rate').hardwareUnverified);
  assert.equal(g(await run({ dataflash: { ready: true, supported: true, sectors: 1, total: 100, used: 100 } }), 'storage').status, 'fail');
  assert.equal(g(await run({ dataflash: { ready: false, supported: true, sectors: 1, total: 100, used: 0 } }), 'storage').status, 'fail');
  assert.equal(g(await run({ dataflash: { ready: true, supported: false, sectors: 0, total: 0, used: 0 } }), 'storage').status, 'fail');
  assert.equal(g(await run({}), 'storage').status, 'warn');
  assert.equal(g(await run({ blackbox: bbWith(0, { device: 2 }), sdcard: { state: 4, freeKB: 1000, totalKB: 2000 } }), 'storage').status, 'warn');
  assert.equal(g(await run({ blackbox: bbWith(0, { device: 2 }), sdcard: { state: 0, freeKB: 0, totalKB: 0 } }), 'storage').status, 'fail');
  assert.equal(g(await run({ blackbox: bbWith(0, { device: 2 }) }), 'storage').status, 'fail', 'SD logging with no card summary data');
  assert.equal(g(await run({ blackbox: bbWith(0, { device: 3 }) }), 'storage').status, 'unknown');
  pass('logging rate is only an estimate above a floor; full, unready or missing storage blocks; unknown storage stays unknown');
  assert.equal(g(await run({}, { ...OK_ATT, batteryDisconnected: false }), 'battery').status, 'unknown');
  assert.equal(g(await run({ analog: { v_cV: 1660, mAh: 0, amp_cA: 0 } }), 'battery').status, 'warn', 'a battery-like voltage with an attestation is only a warning, never a pass');
  assert.match(g(await run({ analog: { v_cV: 1660, mAh: 0, amp_cA: 0 } }), 'battery').detected, /16\.60 V/);
  const tel = await run({ telemetry: [0, 1, 2, 3].map(() => ({ rpm: 0, invalidPct: 10000, temp: 0, volt: 0, cur: 0, cons: 0 })) });
  assert.equal(g(tel, 'telemetry').status, 'warn'); assert.match(g(tel, 'telemetry').why, /error data unavailable/);
  assert.equal(g(await run({ telemetry: [0, 1, 2, 3].map(() => ({ rpm: 0, invalidPct: 12, temp: 0, volt: 0, cur: 0, cons: 0 })) }), 'telemetry').status, 'pass');
  assert.equal(g(await run({ telemetry: [0, 1].map(() => ({ rpm: 0, invalidPct: 0, temp: 0, volt: 0, cur: 0, cons: 0 })) }), 'telemetry').status, 'fail');
  pass('battery state is attested (never proven by voltage); invalidPct of 100% is "error data unavailable", not a failing channel and not a pass; a telemetry count mismatch blocks');
}

// ---- overall behaviour: unreadable FC, no gate is weakened by missing data
{
  const all = ['MSP_API_VERSION', 'MSP_FC_VARIANT', 'MSP_FC_VERSION', 'MSP_BOARD_INFO', 'MSP_UID', 'MSP_FEATURE_CONFIG', 'MSP_MOTOR_CONFIG', 'MSP_ADVANCED_CONFIG', 'MSP_MOTOR_3D_CONFIG', 'MSP_BLACKBOX_CONFIG', 'MSP_DATAFLASH_SUMMARY', 'MSP_SDCARD_SUMMARY', 'MSP_ANALOG', 'MSP_STATUS_EX', 'MSP_BOXIDS', 'MSP_MOTOR', 'MSP_MOTOR_TELEMETRY'];
  const r = await run({ silent: all });
  assert.equal(r.overall, 'incomplete'); assert.deepEqual(r.gates.filter((x) => x.status === 'pass').map((x) => x.id), ['transport']); assert.equal(r.counts.fail, 0);
  assert.equal(r.eligibleForActiveTest, false);
  const none = evaluateReadiness({});
  assert.equal(none.overall, 'incomplete'); assert.equal(none.counts.pass, 0); assert.equal(none.eligibleForActiveTest, false);
  pass('an unreadable FC passes nothing but the transport gate, an absent one passes nothing, and both are "incomplete"');
  // sweep: whatever the aircraft, eligibility is never true, and a single failed gate always makes the result blocked
  const variants = [{}, { motorCount: 5 }, { armed: true }, { threeD: true }, { protocol: 0 }, { firmware: '4.3.2', api: '1.44' }, { poleCount: 2 }, { dshotTelemetry: false }, { blackbox: bbWith(1 << 13) }, { silent: ['MSP_ANALOG'] }, { firmware: '4.5.5', api: '1.46' }];
  for (const v of variants) for (const att of [OK_ATT, {}, { blackboxMode: 'NORMAL' }, { blackboxMode: 'ALWAYS_ON' }]) {
    const x = await run(v, att);
    assert.equal(x.eligibleForActiveTest, false);
    assert.equal(x.overall === 'blocked', x.counts.fail > 0);
    assert.ok(x.overall !== 'ready');
  }
  pass(`across ${variants.length * 4} aircraft/attestation combinations eligibility is always false, and any failed gate means "blocked"`);
}

// ---- view states and wording
{
  assert.equal(viewState({ connected: false }), 'DISCONNECTED');
  assert.equal(viewState({ connected: true, reading: true, report: { overall: 'blocked' } }), 'READING');
  assert.equal(viewState({ connected: true, error: 'x', report: { overall: 'blocked' } }), 'ERROR');
  assert.equal(viewState({ connected: true, report: { overall: 'blocked' } }), 'READINESS_BLOCKED');
  assert.equal(viewState({ connected: true, report: { overall: 'incomplete' } }), 'READINESS_INCOMPLETE');
  assert.equal(viewState({ connected: true, report: { overall: 'conditional' } }), 'READINESS_CONDITIONAL');
  assert.equal(viewState({ connected: true, report: null }), 'DISCONNECTED');
  pass('the view-state mapping covers disconnected, reading, error, blocked, incomplete and conditional');
  const words = JSON.stringify([STATUS_LABEL, OVERALL_TEXT]);
  assert.ok(!/safe to fly|airworth|certif|guarantee|ready/i.test(words.replace(/active testing does not exist/g, '')));
  assert.ok(!/\bPassed\b.*all/i.test(OVERALL_TEXT.conditional));
  pass('status wording has no "safe to fly", airworthiness, certification, guarantee or "ready" claim');
}

console.log('ALL OK');
