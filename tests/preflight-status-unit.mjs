// Regression: a successful reconnect and read must clear an earlier disconnect message (stale "NetworkError").
// Uses the real WebSerialTransport over a fake serial port (no hardware, no browser) and the lab's status rules.
import assert from 'node:assert/strict';
import { WebSerialTransport } from '../src/preflight/transport.js';
import { ReadOnlySession } from '../src/preflight/session.js';
import { mockFcTransport } from '../src/preflight/mock-fc.js';
import { beginRead, finishReadOk, finishReadFailed, transportClosed, statusText } from '../src/preflight/session-status.js';

const pass = (t) => console.log('PASS  ' + t);

// A fake port whose reader fails like an unplugged USB device.
function unpluggedPort() {
  let fail;
  const failure = new Promise((_, rej) => { fail = rej; });
  return {
    port: {
      open: async () => {},
      close: async () => {},
      readable: { getReader: () => ({ read: () => failure, cancel: async () => {}, releaseLock() {} }) },
      writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
    },
    unplug: () => fail(Object.assign(new Error('The device has been lost.'), { name: 'NetworkError' })),
  };
}

const S = { transport: null, snapshot: null, reading: false, error: null, message: '' };
const lab = (transport) => async () => {}; // placeholder to keep the flow readable

// 1. first connection, then unplug: the message names the transport error
const a = unpluggedPort();
const t1 = new WebSerialTransport(a.port);
beginRead(S); S.transport = t1; await t1.open();
t1.onClose((r) => { transportClosed(S, t1, String(r)); });
S.snapshot = { ok: true }; finishReadOk(S);
a.unplug();
await new Promise((r) => setTimeout(r, 10));
assert.match(statusText(S), /NetworkError/, 'the unplug is shown');
pass('unplugging the port shows "The connection closed (NetworkError)."');

// 2. reconnect and read successfully: the stale message must be gone
const t2 = mockFcTransport();
beginRead(S);
assert.equal(S.message, '', 'starting a new read clears the earlier transport message');
S.transport = t2; await t2.open();
t2.onClose((r) => transportClosed(S, t2, String(r)));
S.snapshot = await new ReadOnlySession(t2).collectSnapshot();
finishReadOk(S);
assert.ok(!/NetworkError|closed/.test(statusText(S)), 'no stale disconnect text after a successful read');
assert.equal(statusText(S), 'Read complete (read-only).');
pass('a successful reconnect and read clears the earlier NetworkError message');

// 3. a late close event from the old transport must not overwrite the new session
t1._emitClose('NetworkError');
assert.equal(statusText(S), 'Read complete (read-only).', 'late close of the old transport is ignored');
pass('a late close event from the previous transport is ignored');

// 4. a real close of the current transport is still shown, and a failed read shows its error
t2.disconnect('NetworkError');
assert.match(statusText(S), /NetworkError/);
beginRead(S); finishReadFailed(S, 'Could not read the flight controller: x');
assert.equal(statusText(S), 'Could not read the flight controller: x');
beginRead(S);
assert.equal(statusText(S), 'Reading the flight controller...');
pass('a close of the current transport and a failed read are still reported');

console.log('ALL OK');
