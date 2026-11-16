// Motor diagnostics Phase 1: read-only session and snapshot over a mocked transport (synthetic data, no hardware).
import assert from 'node:assert/strict';
import { ReadOnlySession, SNAPSHOT_READS } from '../src/preflight/session.js';
import { ALLOWED_REQUESTS, isAllowedRequestFrame } from '../src/preflight/msp-codec.js';
import { mockFcTransport } from '../src/preflight/mock-fc.js';
import { MockTransport } from '../src/preflight/transport.js';

const pass = (t) => console.log('PASS  ' + t);
const fast = { timeoutMs: 20, retries: 1 };

{
  const t = mockFcTransport();
  const s = new ReadOnlySession(t);
  const snap = await s.collectSnapshot();
  assert.equal(Object.keys(snap.reads).length, SNAPSHOT_READS.length);
  assert.ok(Object.values(snap.reads).every((r) => r.ok), JSON.stringify(Object.entries(snap.reads).filter(([, r]) => !r.ok)));
  assert.equal(snap.version.text, '2025.12.5'); assert.equal(snap.api.text, '1.47'); assert.equal(snap.variant.variant, 'BTFL');
  pass('a full snapshot reads every allowlisted message from a synthetic FC');
  assert.equal(t.sent.length, SNAPSHOT_READS.length);
  assert.ok(t.sent.every(isAllowedRequestFrame));
  assert.ok(t.sent.every((f) => Object.values(ALLOWED_REQUESTS).includes(f[4])));
  assert.ok(!t.sent.some((f) => f[4] === 214));
  pass('every byte string sent is an allowlisted read; no motor command, CLI line or write');
}
{
  const t = mockFcTransport({ silent: ['MSP_MOTOR_TELEMETRY'] });
  const s = new ReadOnlySession(t, fast);
  const snap = await s.collectSnapshot();
  assert.equal(snap.reads.MSP_MOTOR_TELEMETRY.ok, false); assert.equal(snap.reads.MSP_MOTOR_TELEMETRY.error, 'timeout');
  assert.ok(snap.reads.MSP_MOTOR.ok);
  assert.equal(t.sent.filter((f) => f[4] === ALLOWED_REQUESTS.MSP_MOTOR_TELEMETRY).length, 2);
  pass('a silent message times out after one retry and the other reads still succeed');
}
{
  const t = mockFcTransport({ rejected: ['MSP_BLACKBOX_CONFIG'] });
  const snap = await new ReadOnlySession(t, fast).collectSnapshot();
  assert.equal(snap.reads.MSP_BLACKBOX_CONFIG.error, 'fc-rejected');
  assert.equal(t.sent.filter((f) => f[4] === ALLOWED_REQUESTS.MSP_BLACKBOX_CONFIG).length, 1);
  pass('an MSP error reply is recorded as fc-rejected and is not retried');
}
{
  // a corrupt reply is not accepted: the read fails closed (timeout), never a guessed value
  const good = mockFcTransport();
  const corrupt = new MockTransport((id) => { const t = good.respond ? good.respond(id) : null; if (!(t instanceof Uint8Array)) return t; const c = Uint8Array.from(t); c[c.length - 1] ^= 0x55; return c; });
  corrupt.respond = ((orig) => (id) => { const r = orig(id); if (!(r instanceof Uint8Array)) return r; const c = Uint8Array.from(r); c[c.length - 1] ^= 0x55; return c; })(good.respond);
  const s = new ReadOnlySession(corrupt, fast);
  await assert.rejects(s.request('MSP_API_VERSION'), (e) => e.code === 'timeout');
  assert.ok(s.parseErrors >= 1);
  pass('a reply with a bad checksum is counted and the read fails closed');
}
{
  const t = mockFcTransport({ firmware: '4.5.5', api: '1.46' });
  const snap = await new ReadOnlySession(t).collectSnapshot();
  assert.equal(snap.version.text, '4.5.5');
  pass('a SemVer firmware reads through the API-dependent version decoder');
}
{
  const t = mockFcTransport({}, { delayMs: 2 });
  const s = new ReadOnlySession(t);
  const order = [];
  const ps = ['MSP_API_VERSION', 'MSP_MOTOR', 'MSP_UID'].map((n) => s.request(n).then(() => order.push(n)));
  await Promise.all(ps);
  assert.deepEqual(order, ['MSP_API_VERSION', 'MSP_MOTOR', 'MSP_UID']);
  assert.deepEqual(t.sent.map((f) => f[4]), [1, 104, 160]);
  pass('concurrent requests are serialised: one in flight at a time, in order');
}
{
  const t = mockFcTransport({}, { delayMs: 30 });
  const s = new ReadOnlySession(t);
  const p = s.request('MSP_API_VERSION');
  setTimeout(() => t.disconnect('cable pulled'), 5);
  await assert.rejects(p, (e) => e.code === 'transport-closed');
  await assert.rejects(s.request('MSP_MOTOR'), (e) => e.code === 'transport-closed');
  pass('a disconnect rejects the pending read and every later read (no silent reuse)');
}
{
  const t = mockFcTransport({}, { delayMs: 40 });
  const s = new ReadOnlySession(t, { timeoutMs: 15, retries: 0 });
  await assert.rejects(s.request('MSP_API_VERSION'), (e) => e.code === 'timeout');
  await new Promise((r) => setTimeout(r, 60)); // the late reply arrives now and must be ignored
  const t2 = mockFcTransport();
  const ok = await new ReadOnlySession(t2).request('MSP_API_VERSION');
  assert.equal(ok.text, '1.47');
  assert.equal(s.pending, null);
  pass('a late reply after a timeout does not resolve anything');
}

console.log('ALL OK');
