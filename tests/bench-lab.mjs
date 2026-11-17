// Phase 3 browser suite: the isolated bench lab page against the SYNTHETIC flight controller, plus a fake Web Serial port
// (a canned in-page responder, not hardware) to check that real-hardware mode starts locked. It starts its own Vite dev
// servers (flag on and off). No real device, no real serial port, no real motor is used.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CHANNEL, chromium, ROOT } from './lib.mjs';
import { defaultFc, payloadFor } from '../src/preflight/mock-fc.js';
import { ALLOWED_REQUESTS, encodeResponseV1 } from '../src/preflight/msp-codec.js';

const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js');

function startVite(port, env2) {
  const env = { ...process.env, ...env2 };
  for (const k of ['VITE_BENCH_PHASE3', 'VITE_PREFLIGHT_DIAGNOSTICS']) if (!(k in env2)) delete env[k];
  const child = spawn(process.execPath, [VITE, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start on ' + port)), 60000);
    child.stdout.on('data', (d) => { if (/Local:|ready in/i.test(String(d))) { clearTimeout(t); resolve(child); } });
    child.stderr.on('data', (d) => { if (/EADDRINUSE|error/i.test(String(d))) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}

// canned responses for the fake serial port: id -> bytes
const fc = { ...defaultFc(), target: 'REALFAKE', motors: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000] };
const canned = {};
for (const [name, id] of Object.entries(ALLOWED_REQUESTS)) { const p = payloadFor(name, fc); if (p) canned[id] = Array.from(encodeResponseV1(id, p)); }
const FAKE_SERIAL = `(() => {
  const canned = ${JSON.stringify(canned)};
  window.__written = [];
  let ctl;
  const readable = new ReadableStream({ start(c) { ctl = c; } });
  const port = {
    open: async () => {}, close: async () => {}, getInfo: () => ({}),
    readable: { getReader: () => readable.getReader() },
    writable: { getWriter: () => ({ releaseLock() {}, write: async (b) => {
      window.__written.push(Array.from(b));
      const id = b[4];
      if (id === 214) ctl.enqueue(Uint8Array.from([0x24, 0x4d, 0x3e, 0, 214, 214]));
      else if (canned[id]) ctl.enqueue(Uint8Array.from(canned[id]));
    } }) },
  };
  Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => port, getPorts: async () => [], addEventListener() {} } });
})();`;

const on = await startVite(5190, { VITE_BENCH_PHASE3: '1' });
const off = await startVite(5191, {});
const b = await chromium.launch({ channel: CHANNEL, headless: true });
const errs = [], hosts = new Set();
const U = 'http://127.0.0.1:5190/tools/motor-bench-lab/';
const text = (p, sel) => p.locator(sel).innerText();
const state = (p) => p.locator('#bt-state').getAttribute('data-state');
const waitState = (p, s, timeout = 20000) => p.waitForSelector(`#bt-state[data-state="${s}"]`, { timeout });
async function hold(p, sel, ms = 1200) {
  await p.locator(sel).evaluate((e) => e.scrollIntoView({ block: 'center' })); // centred, so the fixed Stop & zero bar does not cover it
  const box = await p.locator(sel).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up();
}
async function toChecklist(p) {
  await p.goto(U, { waitUntil: 'networkidle' });
  await p.click('#btn-connect-mock');
  await waitState(p, 'READ_ONLY_READINESS');
  await p.check('[data-attest="armSwitchOff"]'); await p.check('[data-attest="throttleMin"]'); await p.check('[data-attest="batteryDisconnected"]');
  await p.waitForFunction(() => !document.querySelector('#btn-proceed').disabled);
  await p.click('#btn-proceed');
  await waitState(p, 'SAFETY_CHECKLIST');
}
async function toReadyToPower(p) {
  await toChecklist(p);
  for (const cb of await p.locator('[data-item]').all()) await cb.check();
  await p.waitForFunction(() => !document.querySelector('#hold-final').disabled);
  await hold(p, '#hold-final');
  await waitState(p, 'READY_TO_CONNECT_POWER');
}
async function toMotorReady(p) {
  await toReadyToPower(p);
  await p.click('#btn-battery-connected');
  await waitState(p, 'MOTOR_READY', 25000);
}

try {
  // ---------- flag ON, synthetic mode
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
  let p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('request', (r) => { try { hosts.add(new URL(r.url()).host); } catch { /* data: urls */ } });
  await p.goto(U, { waitUntil: 'networkidle' });
  ok((await p.locator('meta[name="robots"][content="noindex"]').count()) === 1, 'the page carries noindex');
  const banner = await text(p, '#bt-header');
  ok(/Engineering lab/.test(banner), 'it says it is the engineering lab');
  ok(/not access control/.test(banner), 'it says an unlinked static route is not access control');
  ok(/Not connected/.test(await text(p, '#bt-mode')) && /synthetic/i.test(await text(p, '#bt-header')), 'it starts unconnected and offers the synthetic mode');
  ok((await p.locator('#btn-stop-zero').count()) === 0 && (await p.locator('#hold-start, #hold-final, [data-item]').count()) === 0, 'before connecting there is no Stop & zero and no active control');
  ok((await p.locator('a[href]').count()) === 0, 'the page has no outgoing links');

  await p.click('#btn-connect-mock'); await waitState(p, 'READ_ONLY_READINESS');
  ok((await text(p, '#btn-proceed')) === 'Continue to the safety checklist' && /Zero-output initialization happens first/.test(await text(p, '#bt-actions')), 'the readiness action is "Continue to the safety checklist" and says zero-output initialization happens first');
  ok((await p.locator('select[data-attest="blackboxMode"], [data-gate="bb-mode"], [data-gate="blackbox"]').count()) === 0 && !/blackbox/i.test(await text(p, '#bt-readiness')), 'no Blackbox control, gate or message in the live workflow');
  ok((await p.locator('#bt-sec-summary').count()) === 1 && (await p.locator('#bt-sec-summary .eyebrow').textContent()) === 'Safety and readiness' && (await p.locator('#bt-sec-confirm, #bt-sec-checks').count()) === 2, 'readiness has its three sections, labelled as a safety and readiness check');
  await toChecklist(p);
  ok(/Practice mode/.test(await text(p, '#bt-mode')) && (await p.locator('#bt-mode').getAttribute('data-mode')) === 'mock', 'the synthetic mode is shown conspicuously');
  ok((await p.locator('#btn-stop-zero').count()) === 1, 'the persistent Stop & zero button is present once powered testing can start');
  const stopStyle = await p.locator('#btn-stop-zero').evaluate((e) => getComputedStyle(e).backgroundColor);
  ok(stopStyle === 'rgb(198, 40, 40)', 'Stop & zero is red (the app\'s own danger fill)');
  ok((await p.locator('[data-item]').count()) === 6, 'six individual physical-safety checks are shown');
  ok(await p.locator('#hold-final').isDisabled(), 'the final confirmation is locked until every item is ticked');
  await p.locator('[data-item]').first().check();
  ok(await p.locator('#hold-final').isDisabled(), 'one tick is not enough');
  for (const cb of await p.locator('[data-item]').all()) await cb.check();
  await p.waitForFunction(() => !document.querySelector('#hold-final').disabled);
  await hold(p, '#hold-final', 300);
  ok((await state(p)) === 'SAFETY_CHECKLIST', 'a short press does not confirm the checklist');
  await hold(p, '#hold-final', 1200);
  await waitState(p, 'READY_TO_CONNECT_POWER');
  ok(await p.evaluate(() => !!localStorage.getItem('uavzones.benchtest.unclean.v1')), 'the recovery marker is set before the battery step');

  // reload with the marker present: recovery leads
  await p.reload({ waitUntil: 'networkidle' });
  ok((await text(p, '#bt-overlay')).startsWith('Disconnect the flight battery now.'), 'after a reload with the marker the screen leads with "Disconnect the flight battery now."');
  ok((await p.locator('#hold-start, #hold-final, [data-item], #btn-proceed').count()) === 0, 'no ordinary navigation or active control is offered during recovery');
  await p.click('#btn-battery-removed');
  await p.click('#btn-connect-mock');
  await waitState(p, 'BATTERY_REMOVAL_RECOVERY');
  await p.waitForSelector('#btn-no-rotation', { timeout: 10000 });
  await p.click('#btn-no-rotation');
  await p.click('#btn-complete-recovery');
  await waitState(p, 'DISCONNECTED');
  ok(await p.evaluate(() => localStorage.getItem('uavzones.benchtest.unclean.v1') === null), 'recovery clears the marker only after the proof and battery-removal confirmation');

  // full synthetic run of one motor
  await toMotorReady(p);
  ok((await p.locator('.dg-selected').count()) === 0, 'no motor is selected by default');
  await p.click('#btn-motor-1');
  ok((await p.locator('.dg-selected').count()) === 1 && /rear right/.test(await text(p, '.dg-selected')), 'the selected motor and its position are highlighted');
  ok(await p.locator('#hold-start').isDisabled(), 'start is locked until the physical motor is confirmed');
  ok(/not confirmed/i.test(await text(p, '#bt-interlocks')), 'the locked reason is shown');
  await p.click('#btn-confirm-target');
  await p.waitForFunction(() => !document.querySelector('#hold-start').disabled);
  await hold(p, '#hold-start', 300);
  ok((await state(p)) === 'MOTOR_READY', 'a brief press does not start a sweep');
  await hold(p, '#hold-start', 1200);
  await waitState(p, 'RUNNING');
  ok(/Motor 1 running/.test(await text(p, '#bt-sec-run h2')), 'a focused active-motor view is shown');
  ok((await p.locator('#bt-sec-run .eyebrow').textContent()) === 'Active test' && (await p.locator('#rd-big').count()) === 1 && (await p.locator('#rd-progress').count()) === 1, 'the active sweep is labelled and shows a large command and RPM readout with a progress bar');
  await p.setViewportSize({ width: 360, height: 740 });
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) && await p.locator('#btn-stop-zero').isVisible(), 'the active-sweep view has no horizontal scroll at 360 px and Stop & zero stays visible');
  await p.setViewportSize({ width: 1000, height: 900 });
  await p.waitForFunction(() => Number(document.getElementById('rd-output').textContent) >= 1020);
  ok(/^\d+ ms$/.test(await text(p, '#rd-age')) && /s$/.test(await text(p, '#rd-elapsed')), 'output, RPM, telemetry age and elapsed time are shown');
  ok((await p.locator('#bt-sec-run details.dg-details').count()) === 1, 'advanced readings are in an expandable section');
  ok((await p.locator('#btn-stop-zero').count()) === 1, 'Stop & zero stays visible while running');
  await waitState(p, 'VERIFYING_STOP', 20000);
  await p.waitForSelector('#btn-no-rotation', { timeout: 10000 });
  await p.click('#btn-no-rotation');
  await p.click('#btn-pos-rear-right');
  await waitState(p, 'MOTOR_READY');
  ok(/Tested motors: 1/.test(await text(p, '#bt-sec-ready')), 'the first motor is recorded after the stop proof and the position confirmation');
  ok((await p.locator('#bt-sec-result').count()) === 1 && /Test incomplete/.test(await text(p, '#bt-result-headline')) && (await p.locator('#bt-sec-result .eyebrow').textContent()) === 'Observed result', 'after one motor the observational result says "Test incomplete"');
  ok((await p.locator('.dg-quad-result .dg-motor').count()) === 4 && (await p.locator('details.dg-card').count()) === 4 && (await p.locator('.dg-quad-result .dg-motor[data-state="unavailable"], .dg-quad-result .dg-motor[data-state="waiting"], .dg-quad-result .dg-motor[data-state="passed"]').count()) === 4, 'a quad diagram and four expandable motor cards are shown, each with a text status');
  ok((await p.locator('details.dg-card[data-motor="0"] summary').innerText()).includes('rear right'), 'the first motor card names its position');
  const resText = await p.evaluate(() => { const c = document.getElementById('bt-sec-result').cloneNode(true); for (const q of c.querySelectorAll('p')) if (/does not mean/.test(q.textContent)) q.remove(); return c.textContent; });
  ok(!/healthy|faulty|passed|airworth|safe to fly|certified/i.test(resText), 'the result makes no health, pass or safety claim outside the one limits statement');
  ok(/does not mean/.test(await text(p, '#bt-sec-result')) && /propeller-free/.test(await text(p, '#bt-sec-result')), 'the limits statement and the propeller-free reminder are shown');
  ok(/1020 to 1100/.test(await text(p, '#bt-sec-result')), 'the output range and cap are shown');
  ok(/Off by default/.test(await text(p, '#bt-keep')) && (await p.locator('#bt-retain').isChecked()) === false, 'keeping the live samples is off by default and the approximate size is shown');
  await p.click('#btn-save-result');
  await p.setViewportSize({ width: 360, height: 740 });
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the result screen has no horizontal scroll at 360 px');
  ok(await p.evaluate(() => [...document.querySelectorAll('#bt-sec-result button, #bt-sec-result summary')].every((e) => e.getBoundingClientRect().height >= 40)), 'result controls keep a touch-sized target at 360 px');
  await p.setViewportSize({ width: 1000, height: 900 });
  ok(/Saved/.test(await text(p, '#bt-save-status')), 'the result is saved only when asked');
  await p.waitForTimeout(6000); // the inter-sweep settle interlock changes after 5 s and redraws the screen
  ok(/Saved/.test(await text(p, '#bt-save-status')), 'the save message survives a redraw of the screen');
  ok(await p.evaluate(() => localStorage.getItem('uavzones.aircraftdiag.v1') !== null && localStorage.getItem('uavzones.aircraftdiag.samples.v1') === null), 'the derived record is stored locally and no live samples are kept');
  const ev = await Promise.all([p.waitForEvent('download'), p.click('#btn-download-evidence')]);
  ok(ev[0].suggestedFilename() === 'motor-bench-evidence.json', 'the evidence file can be downloaded');

  // position mismatch locks
  await p.click('#btn-motor-2'); await p.click('#btn-confirm-target');
  await p.waitForFunction(() => !document.querySelector('#hold-start').disabled, null, { timeout: 15000 });
  await hold(p, '#hold-start', 1200);
  await waitState(p, 'VERIFYING_STOP', 25000);
  await p.waitForSelector('#btn-no-rotation', { timeout: 10000 }); await p.click('#btn-no-rotation');
  await p.click('#btn-pos-rear-left'); // motor 2 is expected at front right
  await waitState(p, 'LOCKED_FAULT');
  ok(/Disconnect the flight battery now\./.test(await text(p, '#bt-overlay')) && /not the one expected/.test(await text(p, '#bt-overlay')), 'a motor-position mismatch locks the workflow with the mismatch explained');

  // ---------- Stop & zero during a run, and USB loss, from fresh browser profiles (the fault above left its recovery marker, as designed)
  const fresh = async () => { const pg = await (await b.newContext({ viewport: { width: 1000, height: 900 } })).newPage(); pg.on('pageerror', (e) => errs.push('pageerror ' + e.message)); pg.on('console', (m) => m.type() === 'error' && errs.push(m.text())); return pg; };
  const keep = p;
  p = await fresh();
  await toMotorReady(p);
  await p.click('#btn-motor-3'); await p.click('#btn-confirm-target');
  await p.waitForFunction(() => !document.querySelector('#hold-start').disabled, null, { timeout: 15000 });
  await hold(p, '#hold-start', 1200); await waitState(p, 'RUNNING');
  await p.click('#btn-stop-zero');
  await waitState(p, 'LOCKED_FAULT');
  ok(/You pressed Stop & zero/.test(await text(p, '#bt-overlay')), 'Stop & zero is one action with no confirmation and locks the session');
  await p.waitForSelector('#btn-no-rotation', { timeout: 10000 });
  ok((await p.locator('#bt-proof li.done').count()) === 3, 'three of the four stop-proof parts are met automatically before the user confirmation');
  ok((await p.locator('#btn-stop-zero').count()) === 1, 'Stop & zero stays on the fault screen');

  void keep; p = await fresh();
  await toMotorReady(p);
  await p.click('#btn-motor-1'); await p.click('#btn-confirm-target');
  await p.waitForFunction(() => !document.querySelector('#hold-start').disabled, null, { timeout: 15000 });
  await hold(p, '#hold-start', 1200); await waitState(p, 'RUNNING');
  await p.click('#inj-disconnect');
  await waitState(p, 'LOCKED_FAULT');
  const ov = await text(p, '#bt-overlay');
  ok(ov.startsWith('Disconnect the flight battery now.') && /cannot stop or verify the motors/.test(ov), 'USB loss shows the full-screen battery instruction and does not claim a stop');
  ok((await p.locator('#btn-no-rotation').count()) === 0, 'no stop confirmation is offered without a transport');
  ok(await p.evaluate(() => { const r = document.querySelector('#bt-overlay').getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }), 'the warning is full screen');

  // trace
  ok((await p.locator('#bt-overlay #bt-trace-fault').count()) === 1, 'the trace is also reachable from the fault screen');
  const trace = await p.evaluate(() => document.getElementById('bt-trace').textContent);
  ok(/MOTOR_READY -> RUNNING {2}START_HOLD_COMPLETE/.test(trace) && /TRANSPORT_LOST/.test(trace), 'the transition trace lists the transitions for review');

  // narrow viewport
  await p.setViewportSize({ width: 360, height: 740 });
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'at 360 px width there is no horizontal page scroll');
  const small = await p.evaluate(() => [...document.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().height < 44).length);
  ok(small === 0, `all buttons are at least 44 px tall (${small} smaller)`);
  ok([...hosts].every((h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h)), `only the local server was contacted (${[...hosts].join(', ')})`);
  ok(errs.length === 0, 'no console or page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));

  // ---------- keyboard and switch-accessible equivalents of press-and-hold (fresh profile)
  const kb = await fresh();
  await toChecklist(kb);
  for (const cb of await kb.locator('[data-item]').all()) await cb.check();
  await kb.waitForFunction(() => !document.querySelector('#hold-final').disabled);
  await kb.locator('#hold-final').focus();
  await kb.keyboard.down(' '); await kb.waitForTimeout(300); await kb.keyboard.up(' ');
  ok((await state(kb)) === 'SAFETY_CHECKLIST', 'a short key press does not confirm the checklist');
  await kb.keyboard.down('Enter'); await kb.waitForTimeout(1250); await kb.keyboard.up('Enter');
  await waitState(kb, 'READY_TO_CONNECT_POWER');
  ok(true, 'holding Enter or Space for one second confirms the checklist (keyboard equivalent)');
  await kb.click('#btn-battery-connected');
  await waitState(kb, 'MOTOR_READY', 25000);
  await kb.click('#btn-motor-4'); await kb.click('#btn-confirm-target');
  await kb.waitForFunction(() => !document.querySelector('#hold-start').disabled, null, { timeout: 15000 });
  await kb.click('#hold-start-timed');
  ok(/Confirming in 1 s/.test(await text(kb, '.dg-holdstatus')), 'the timed confirm announces its countdown');
  await kb.click('#hold-start-timed');
  ok(/Cancelled/.test(await text(kb, '.dg-holdstatus')), 'activating it again cancels');
  await kb.waitForTimeout(1300);
  ok((await state(kb)) === 'MOTOR_READY', 'a cancelled timed confirm starts nothing');
  await kb.click('#hold-start-timed');
  await waitState(kb, 'RUNNING');
  ok(true, 'the timed confirm (single-switch equivalent) starts a sweep after its countdown');
  await kb.click('#btn-stop-zero');
  await waitState(kb, 'LOCKED_FAULT');

  // ---------- powered stop validation (synthetic) and verified marker deletion, from a fresh profile
  const pv = await fresh();
  await pv.goto(U, { waitUntil: 'networkidle' });
  await pv.click('#btn-connect-mock'); await waitState(pv, 'READ_ONLY_READINESS');
  await pv.check('[data-attest="armSwitchOff"]'); await pv.check('[data-attest="throttleMin"]'); await pv.check('[data-attest="batteryDisconnected"]');
  await pv.waitForFunction(() => !document.querySelector('#btn-stopval').disabled);
  ok(await pv.locator('#btn-powered-stopval').isDisabled(), 'the powered stop validation is locked until the USB-only validation is recorded');
  ok(/USB-only stop validation/.test(await text(pv, '#btn-stopval')) && /battery disconnected/.test(await text(pv, '#btn-stopval')), 'the USB-only validation is labelled as such');
  await pv.click('#btn-stopval'); await waitState(pv, 'STOP_VALIDATION_ONLY');
  ok(/cannot show that a motor stopped/.test(await text(pv, '#bt-sec-stopval')) && /FC command and read-back check/.test(await text(pv, '#bt-sec-stopval')), 'the USB-only state says it cannot prove a physical stop');
  ok((await pv.locator('#bt-battery-state').getAttribute('data-battery')) === 'attested-disconnected', 'the battery state is shown as attested disconnected');
  await pv.waitForSelector('#btn-no-rotation', { timeout: 10000 }); await pv.click('#btn-no-rotation');
  await pv.click('#btn-stopval-done'); await waitState(pv, 'READ_ONLY_READINESS');
  ok(!(await pv.locator('#btn-powered-stopval').isDisabled()), 'the powered stop validation unlocks after the USB-only validation is recorded');
  await pv.click('#btn-powered-stopval'); await waitState(pv, 'SAFETY_CHECKLIST', 25000);
  ok(/Powered stop validation/.test(await text(pv, '.dg-body .status >> nth=0')), 'the workflow says it is a powered stop validation with no motor start');
  for (const cb of await pv.locator('[data-item]').all()) await cb.check();
  await pv.waitForFunction(() => !document.querySelector('#hold-final').disabled);
  await hold(pv, '#hold-final', 1200); await waitState(pv, 'READY_TO_CONNECT_POWER');
  ok(await pv.evaluate(() => !!localStorage.getItem('uavzones.benchtest.unclean.v1')), 'the recovery marker is set before the battery step of the powered stop validation');
  await pv.click('#btn-battery-connected'); await waitState(pv, 'POWERED_STOP_VALIDATION', 30000);
  ok((await pv.locator('#bt-battery-state').getAttribute('data-battery')) === 'declared-connected', 'the battery state is shown as declared connected');
  ok((await pv.locator('#hold-start, [id^="btn-motor-"], #btn-finish').count()) === 0, 'the powered stop validation shows no motor selection and no start control');
  ok((await pv.locator('#btn-stop-zero').count()) === 1, 'Stop & zero is present during the powered stop validation');
  await pv.waitForSelector('#btn-no-rotation', { timeout: 15000 });
  ok(await pv.locator('#btn-powered-stopval-done').isDisabled(), 'finishing needs the user no-rotation confirmation');
  await pv.click('#btn-no-rotation'); await pv.click('#btn-powered-stopval-done'); await waitState(pv, 'BENCH_COMPLETE');
  ok(await pv.evaluate(() => !!localStorage.getItem('uavzones.benchtest.unclean.v1')), 'the marker is kept after the powered proof, until the battery is confirmed disconnected');
  ok(await pv.locator('#btn-battery-removed').count() === 1, 'the battery-disconnection confirmation is requested');
  // a failed marker deletion keeps the screen locked and blocks Reset
  await pv.evaluate(() => { window.__realRemove = Storage.prototype.removeItem; Storage.prototype.removeItem = function () { throw new Error('blocked'); }; });
  await pv.click('#btn-battery-removed');
  await pv.waitForSelector('#btn-retry-marker');
  ok((await state(pv)) === 'BENCH_COMPLETE' && await pv.locator('#btn-reset').isDisabled(), 'a failed marker deletion keeps BENCH_COMPLETE and keeps Reset disabled');
  ok(/battery disconnected/.test(await text(pv, '#bt-sec-complete')) && /cannot resume/.test(await text(pv, '#bt-sec-complete')), 'the message says to keep the battery disconnected and that ordinary testing cannot resume');
  await pv.click('#btn-retry-marker');
  ok(await pv.locator('#btn-reset').isDisabled() && (await pv.locator('#btn-retry-marker').count()) === 1, 'a retry that fails again stays locked');
  await pv.evaluate(() => { Storage.prototype.removeItem = window.__realRemove; });
  await pv.click('#btn-retry-marker');
  await pv.waitForFunction(() => !document.querySelector('#btn-reset').disabled);
  ok(await pv.evaluate(() => localStorage.getItem('uavzones.benchtest.unclean.v1') === null), 'the deliberate retry removes the marker and only then enables Reset');
  await pv.click('#btn-reset'); await waitState(pv, 'DISCONNECTED');

  // a reload during the powered stop validation enters unclean-exit recovery
  const pr = await fresh();
  await pr.goto(U, { waitUntil: 'networkidle' });
  await pr.click('#btn-connect-mock'); await waitState(pr, 'READ_ONLY_READINESS');
  await pr.check('[data-attest="armSwitchOff"]'); await pr.check('[data-attest="throttleMin"]'); await pr.check('[data-attest="batteryDisconnected"]');
  await pr.waitForFunction(() => !document.querySelector('#btn-stopval').disabled);
  await pr.click('#btn-stopval'); await pr.waitForSelector('#btn-no-rotation', { timeout: 10000 }); await pr.click('#btn-no-rotation'); await pr.click('#btn-stopval-done');
  await waitState(pr, 'READ_ONLY_READINESS'); await pr.click('#btn-powered-stopval'); await waitState(pr, 'SAFETY_CHECKLIST', 25000);
  for (const cb of await pr.locator('[data-item]').all()) await cb.check();
  await pr.waitForFunction(() => !document.querySelector('#hold-final').disabled);
  await hold(pr, '#hold-final', 1200); await waitState(pr, 'READY_TO_CONNECT_POWER');
  await pr.click('#btn-battery-connected'); await waitState(pr, 'POWERED_STOP_VALIDATION', 30000);
  await pr.reload({ waitUntil: 'networkidle' });
  ok((await text(pr, '#bt-overlay')).startsWith('Disconnect the flight battery now.'), 'a reload during the powered stop validation leads with "Disconnect the flight battery now."');
  ok((await pr.locator('#hold-start, #hold-final, [data-item], #btn-proceed, #btn-powered-stopval').count()) === 0, 'no ordinary control is offered after the reload');

  // ---------- real-hardware mode (fake serial port): starts locked, unlock is session-only
  const ctx2 = await b.newContext({ viewport: { width: 1000, height: 900 } });
  const r = await ctx2.newPage();
  await r.addInitScript(FAKE_SERIAL);
  const rerrs = [];
  r.on('pageerror', (e) => rerrs.push(e.message));
  await r.goto(U, { waitUntil: 'networkidle' });
  await r.click('#btn-connect-real');
  await waitState(r, 'READ_ONLY_READINESS');
  ok((await r.locator('#bt-mode').getAttribute('data-mode')) === 'real' && /Connected/.test(await text(r, '#bt-mode')), 'real-hardware mode is conspicuously indicated');
  ok(await r.locator('#btn-proceed').isDisabled() && await r.locator('#btn-stopval').isDisabled(), 'real mode starts locked: no way forward before the unlock');
  ok((await r.locator('#btn-stop-zero').count()) === 0 && (await r.locator('#hold-start, [data-item]').count()) === 0, 'no motor control appears in read-only real mode');
  ok((await r.evaluate(() => window.__written.every((w) => w[2] === 0x3c && w[3] === 0))) === true, 'only payload-free read requests were written before the unlock');
  await r.check('[data-attest="armSwitchOff"]'); await r.check('[data-attest="throttleMin"]'); await r.check('[data-attest="batteryDisconnected"]');
  ok((await r.locator('#bt-esc-family, #bt-esc-model').count()) === 0, 'there is no manual ESC family or model field');
  ok(await r.locator('#btn-stopval').isDisabled(), 'still locked with every gate satisfied: the session unlock is missing');
  await r.fill('#bt-unlock-phrase', 'UNLOCK BENCH TEST'); await r.click('#btn-unlock');
  ok(await r.locator('#btn-unlock').count() === 1 && await r.locator('#btn-stopval').isDisabled(), 'the phrase without the acknowledgement does not unlock');
  await r.check('#bt-unlock-ack'); await r.click('#btn-unlock');
  await r.waitForSelector('.dg-unlocked');
  ok(await r.locator('#btn-proceed').isDisabled(), 'unlocked, but no FC/ESC combination is on the owner allowlist: no nonzero path');
  ok(/allowlist/i.test(await text(r, '#bt-needs')), 'the allowlist reason is displayed');
  ok(!(await r.locator('#btn-stopval').isDisabled()), 'stop validation (external 1000 only) becomes available');
  await r.click('#btn-stopval');
  await waitState(r, 'STOP_VALIDATION_ONLY');
  await r.waitForSelector('#btn-no-rotation', { timeout: 10000 });
  const frames = await r.evaluate(() => window.__written.filter((w) => w[4] === 214));
  ok(frames.length >= 10 && frames.every((f) => f.slice(5, 21).every((v, i) => (i % 2 === 0 ? v === (1000 & 255) : v === (1000 >> 8)))), `only external 1000 was written to the fake port (${frames.length} motor frames)`);
  ok((await r.locator('#hold-start, [data-item]').count()) === 0, 'stop-validation-only shows no start control');
  // reload removes the unlock
  await r.reload({ waitUntil: 'networkidle' });
  await r.click('#btn-connect-real');
  await waitState(r, 'READ_ONLY_READINESS');
  ok((await r.locator('.dg-unlocked').count()) === 0 && (await r.locator('#bt-unlock-phrase').count()) === 1, 'a reload removes the session unlock');
  ok(rerrs.length === 0, 'no page errors in real mode' + (rerrs.length ? ': ' + rerrs[0] : ''));

  // ---------- flag OFF
  const p2 = await (await b.newContext()).newPage();
  const e2 = [];
  p2.on('pageerror', (e) => e2.push(e.message));
  await p2.goto('http://127.0.0.1:5191/tools/motor-bench-lab/', { waitUntil: 'networkidle' });
  ok((await p2.locator('[data-disabled]').count()) === 1 && (await p2.locator('button').count()) === 0, 'flag off: the page shows only the disabled notice and no control');
  const p3 = await (await b.newContext()).newPage();
  await p3.addInitScript(() => { try { localStorage.setItem('VITE_BENCH_PHASE3', '1'); localStorage.setItem('uavzones.v1.bench', '1'); } catch { /* ignore */ } });
  await p3.goto('http://127.0.0.1:5191/tools/motor-bench-lab/?bench=1&VITE_BENCH_PHASE3=1', { waitUntil: 'networkidle' });
  ok((await p3.locator('[data-disabled]').count()) === 1, 'flag off: storage keys and URL parameters cannot switch the feature on');
  const p4 = await (await b.newContext()).newPage();
  await p4.goto('http://127.0.0.1:5191/', { waitUntil: 'networkidle' }); await p4.waitForTimeout(1200);
  ok(!/motor-bench|bench test|motor bench/i.test(await p4.content()), 'the app page (flag off) has no reference to the bench lab');
  const p5 = await (await b.newContext()).newPage();
  await p5.goto('http://127.0.0.1:5190/', { waitUntil: 'networkidle' }); await p5.waitForTimeout(1200);
  ok(!/motor-bench|bench test|motor bench|Stop & zero/i.test(await p5.content()), 'the app page (flag ON) still has no entry, link or control for the bench lab');
  ok((await p5.locator('a[href*="motor-bench"], a[href*="preflight"]').count()) === 0, 'no link to either lab anywhere in the app');
  // the existing read-only lab on the flag-on server never gains a motor control
  await p5.goto('http://127.0.0.1:5190/tools/preflight-spike/', { waitUntil: 'networkidle' });
  ok((await p5.locator('#btn-stop-zero, #hold-start, [data-item], .dg-stop').count()) === 0 && !/Stop & zero|bench/i.test(await p5.locator('body').innerText()), 'the read-only lab has no motor control');
  ok(e2.length === 0, 'flag off: no page errors');
} finally {
  await b.close(); on.kill(); off.kill();
}
