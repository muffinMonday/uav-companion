// The readiness view model (src/preflight/readiness-ui.js): ordering, wording and counts, without a browser.
import assert from 'node:assert/strict';
import { gateView, readinessModel, summaryText, CONFIRMATIONS } from '../src/preflight/readiness-ui.js';
import { countWord } from '../src/preflight/ui-parts.js';

const pass = (t) => console.log('PASS  ' + t);
const g = (id, status, extra = {}) => ({ id, title: id[0].toUpperCase() + id.slice(1), status, detected: 'd', required: 'r', why: 'w', manual: 'm', ...extra });
const report = { gates: [g('firmware', 'warn', { hardwareUnverified: true }), g('protocol', 'pass'), g('bidir', 'fail', { manual: 'Turn it on.' }), g('poles', 'unknown'), g('battery', 'unknown', { needsAttestation: 'batteryDisconnected' }), g('arming', 'unknown', { needsAttestation: 'armSwitchOff' }), g('3d', 'pass')] };

{
  const m = readinessModel(report, {});
  assert.deepEqual(m.needs.map((v) => v.id), ['bidir', 'poles'], 'the blocker (Action needed) is listed before the unreadable check');
  assert.deepEqual(m.needs.map((v) => v.status), ['action', 'unavailable']);
  assert.deepEqual(m.passed.map((v) => v.id).sort(), ['3d', 'firmware', 'protocol'], 'passed checks (a warn that policy accepts reads as Passed with a note) are grouped separately');
  assert.ok(!m.views.some((v) => v.id === 'battery' || v.id === 'arming'), 'what the user confirms is a confirmation row, not an automatic check');
  assert.equal(m.confirmations.length, 3); assert.equal(m.missing.length, 3);
  assert.equal(m.remaining, 5);
  pass('blockers first, passed checks grouped, user confirmations separate');
}
{
  const m = readinessModel({ gates: report.gates.filter((x) => x.id === 'protocol') }, { armSwitchOff: true, throttleMin: true, batteryDisconnected: true });
  assert.equal(m.remaining, 0);
  assert.equal(summaryText(m).headline, 'Ready to continue'); assert.equal(summaryText(m).kind, 'ok');
  const two = readinessModel({ gates: [g('bidir', 'fail'), g('poles', 'unknown')] }, { armSwitchOff: true, throttleMin: true, batteryDisconnected: true });
  assert.equal(summaryText(two).headline, 'Two actions remaining');
  assert.match(summaryText(two).detail, /Bidir, Poles/);
  const one = readinessModel({ gates: [g('bidir', 'fail')] }, { armSwitchOff: true, throttleMin: true, batteryDisconnected: true });
  assert.equal(summaryText(one).headline, 'One action remaining');
  assert.equal(countWord(11), '11');
  pass('plain-language headline: "Ready to continue", "One action remaining", "Two actions remaining"');
}
{
  for (const [status, label] of [['pass', 'passed'], ['warn', 'passed'], ['fail', 'action'], ['unknown', 'unavailable']]) assert.equal(gateView(g('firmware', status)).status, label);
  for (const v of [gateView(g('firmware', 'warn', { hardwareUnverified: true })), gateView(g('bidir', 'warn')), gateView(g('telemetry', 'warn')), gateView(g('arming', 'fail'))]) {
    assert.ok(!/phase|gate|READINESS|hardware-unverified|unknown|warn\b/i.test(v.text), 'no internal wording in the explanation: ' + v.text);
    assert.ok(v.text.length > 10);
  }
  assert.ok(gateView(g('firmware', 'warn', { hardwareUnverified: true })).evidence.some(([k, val]) => k === 'Status code' && /warn/.test(val)), 'the technical evidence keeps the raw status');
  assert.deepEqual(CONFIRMATIONS.map((c) => c.key), ['armSwitchOff', 'throttleMin', 'batteryDisconnected']);
  pass('statuses map to Passed / Action needed / Unavailable; explanations avoid internal wording; raw status stays in the evidence');
}
console.log('ALL OK');
