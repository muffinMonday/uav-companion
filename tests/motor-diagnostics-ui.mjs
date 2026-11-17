// Motor diagnostics, the user-facing beta: dashboard card (flag on and off), the /motor-diagnostics/ workspace, the complete
// SYNTHETIC journey from the dashboard to a saved result and back, navigation limits while powered, recovery through the
// user route, history, deletion through Privacy, and layouts at 360 px, a typical Android viewport and desktop.
// Starts its own Vite dev servers (flag on and off). The simulated flight controller is reachable only with ?synthetic=1 on a
// non-production build; no real device, port or motor is used.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CHANNEL, chromium, LATEST_SEEN, ROOT } from './lib.mjs';

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
const on = await startVite(5193, { VITE_BENCH_PHASE3: '1' });
const off = await startVite(5194, {});
const b = await chromium.launch({ channel: CHANNEL, headless: true });
const errs = [];
const ON = 'http://127.0.0.1:5193/', OFF = 'http://127.0.0.1:5194/';
const RETURNING = { showOnStart: true, welcomed: true, seen: LATEST_SEEN };
const text = (p, sel) => p.locator(sel).innerText();
const waitState = (p, s, timeout = 25000) => p.waitForSelector(`#bt-state[data-state="${s}"]`, { state: 'attached', timeout }).catch(async (e) => { console.log('STATE WAIT FAILED for ' + s + ': now ' + (await p.locator('#bt-state').getAttribute('data-state').catch(() => '?')) + ' | ' + (await p.locator('.bt-overlay').innerText().catch(() => '')).slice(0, 700)); throw e; });
async function hold(p, sel, ms = 1200) {
  await p.locator(sel).evaluate((e) => e.scrollIntoView({ block: 'center' })); // centred, so the fixed Stop & zero bar does not cover it
  const box = await p.locator(sel).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up();
}
async function open(url, { width = 1200, height = 850, init, mobile = false } = {}) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(([d, extra]) => {
    if (sessionStorage.__md) return; sessionStorage.__md = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, ...d }));
    for (const [k, v] of Object.entries(extra || {})) localStorage.setItem(k, v);
  }, [RETURNING, init]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto(url, { waitUntil: 'networkidle' });
  return { ctx, p };
}
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const REC = { id: 'seed1', schemaVersion: 1, analysisSchemaVersion: 1, savedAt: '2026-11-16T03:00:00.000Z', date: '2026-11-16', firmware: { variant: 'BTFL', firmware: '2025.12.5', targetName: 'STM32F7X2', boardId: 'F722', escFamily: 'BLHeli_32' }, association: { kind: 'fc-esc-identity', key: 'k1' }, result: { category: 'test-incomplete', headline: 'Test incomplete', summary: 'seed', reasons: [], notes: [] }, motors: [0, 1, 2, 3].map((m) => ({ motor: m, position: 'p', status: 'not-run', hard: [], gaps: ['This motor has not been tested.'], differences: [], metrics: null })), comparison: { classified: false, reason: 'none', differences: [] }, range: { startCommand: 1020, capCommand: 1100, step: 5, stopCommand: 1000, note: 'External motor values; 1000 is stop.' } };
const SEED = { 'uavzones.aircraftdiag.v1': JSON.stringify({ v: 1, records: [REC] }) };

try {
  // ---------- dashboard card: hidden with the flag off, visible with it on
  {
    const { ctx, p } = await open(OFF, { init: SEED });
    await p.waitForSelector('#dash:not([hidden])');
    ok((await p.locator('#diag-entry').count()) === 0 && !/Motor diagnostics/.test(await text(p, '#dash')), 'flag off: no dashboard card, even with saved results in storage');
    await p.goto(OFF + 'motor-diagnostics/', { waitUntil: 'networkidle' });
    ok((await p.locator('[data-disabled]').count()) === 1 && (await p.locator('#btn-connect-real, #bt-stop-zero, #btn-stop-zero').count()) === 0, 'flag off: the workspace page has no control and no active route');
    await ctx.close();
  }
  {
    const { ctx, p } = await open(ON);
    await p.waitForSelector('#dash:not([hidden])');
    const card = await text(p, '#diag-entry');
    ok(/Motor diagnostics/.test(card) && /Experimental/.test(card) && card.includes('Run a propeller-free, low-output motor and telemetry check over USB.') && card.includes('Open diagnostics') && card.includes('Requires a compatible Betaflight flight controller, bidirectional DShot and a supported USB browser.'), 'flag on: the dashboard card shows the title, badge, description, action and requirement note');
    ok(!/Phase 3|prototype|developer|synthetic/i.test(card), 'the card has no implementation language');
    ok((await p.locator('#diag-latest').count()) === 0 && (await p.locator('#diag-history').count()) === 0, 'with no saved result there is no latest line and no history action');
    ok(await p.locator('#diag-open').evaluate((a) => a.tagName === 'A' && getComputedStyle(a).minHeight !== ''), 'the action is a real link (keyboard operable)');
    await p.click('#diag-open');
    await p.waitForURL('**/motor-diagnostics/');
    await p.waitForSelector('#bt-sec-connect');
    ok(/Motor diagnostics/i.test(await text(p, 'h1')) && /Experimental/i.test(await text(p, 'h1')), 'the card opens the workspace');
    ok((await p.locator('#bt-back').count()) === 1, 'while unpowered there is a way back to the dashboard');
    await p.click('#bt-back');
    await p.waitForSelector('#dash');
    ok(new URL(p.url()).pathname === '/', 'Back returns to the dashboard');
    await ctx.close();
  }
  {
    const { ctx, p } = await open(ON, { init: SEED });
    await p.waitForSelector('#diag-latest');
    ok(/Latest check: .*Test incomplete/.test(await text(p, '#diag-latest')) && (await p.locator('#diag-history').count()) === 1, 'a saved result shows its date and headline on the card, with a View history action');
    await p.click('#diag-history'); await p.waitForURL('**/motor-diagnostics/#history');
    await p.waitForSelector('#bt-sec-history');
    ok(/BTFL · 2025.12.5 · STM32F7X2 \/ F722 · ESC BLHeli_32/.test(await text(p, '#bt-sec-history')), 'history is grouped by the aircraft (FC and ESC identity)');
    await p.click('#bt-sec-history details summary'); await p.waitForSelector('#bt-sec-history .bt-result');
    ok((await p.locator('#bt-sec-history .bt-result').count()) === 1 && /does not mean/.test(await text(p, '#bt-sec-history .bt-result')), 'a saved result opens with the same result view and its limits statement');
    await ctx.close();
  }

  // ---------- the normal user view: no developer presentation
  {
    const { ctx, p } = await open(ON + 'motor-diagnostics/');
    const body = (await p.evaluate(() => document.body.innerText)).replace(/This is a record of what[\s\S]*?subtle vibration faults\./, '');
    ok((await p.locator('#btn-connect-mock, #bt-inject, #bt-trace, [data-attest="blackboxMode"]').count()) === 0, 'no synthetic connection, fault injection, trace or Blackbox control');
    ok(!/Phase 3|prototype|developer|synthetic|state machine|transition|READ_ONLY|DISCONNECTED/i.test(body), 'no developer wording or raw state names are displayed');
    ok(await p.locator('#bt-state').isHidden() && /^Step 1 of 8/.test(await text(p, '#bt-step')), 'the raw state is hidden and a plain-language step is shown');
    ok(!/safe to fly|airworth|healthy|certified/i.test(body), 'no safe-to-fly, airworthiness or health wording outside the limits statement');
    ok(/does not mean/.test(await text(p, '#bt-sec-connect')) && /propellers removed/.test(await text(p, '#bt-sec-connect')), 'the limits and the compatibility explanation are shown before connecting');
    ok((await p.locator('#btn-connect-real').count()) === 1, 'a USB connect action is offered');
    for (const [w, h] of [[360, 740], [412, 915], [1200, 850]]) { await p.setViewportSize({ width: w, height: h }); ok(await noHScroll(p), `the first screen has no horizontal scroll at ${w} px`); }
    await ctx.close();
  }

  // ---------- the complete synthetic journey at an Android-sized viewport: dashboard to result and back
  {
    const { ctx, p } = await open(ON, { width: 412, height: 915, mobile: true });
    // a non-production synthetic start is only possible with ?synthetic=1: go straight to the workspace as the card would
    await p.goto(ON + 'motor-diagnostics/?synthetic=1', { waitUntil: 'networkidle' });
    await p.click('#btn-connect-mock'); await waitState(p, 'READ_ONLY_READINESS');
    ok((await p.locator('[data-gate="bb-mode"], [data-gate="blackbox"], [data-gate="storage"], select[data-attest="blackboxMode"]').count()) === 0 && !/blackbox/i.test(await text(p, '#bt-readiness')), 'no Blackbox readiness gate or mode control');
    ok((await p.locator('#bt-identity').count()) === 1 && /BTFL/.test(await text(p, '#bt-identity')), 'the detected aircraft is shown to confirm');
    ok((await p.locator('#btn-stopval, #btn-powered-stopval').count()) === 0, 'the owner-only stop-validation procedures are not offered');
    ok(/Safety and readiness check/i.test(await p.locator('#bt-sec-policy .bt-kicker').textContent()) && /^Step 2 of 8/.test(await text(p, '#bt-step')), 'readiness is labelled as a safety check and the step is in plain language');
    ok(await noHScroll(p), 'readiness has no horizontal scroll at 412 px');
    await p.check('[data-attest="armSwitchOff"]'); await p.check('[data-attest="batteryDisconnected"]');
    await p.waitForFunction(() => !document.querySelector('#btn-proceed').disabled);
    ok((await text(p, '#btn-proceed')) === 'Begin active motor test', 'the primary action is "Begin active motor test"');
    // keyboard: the primary action is reachable by Tab and shows a visible focus ring
    let focused = false;
    for (let i = 0; i < 60 && !focused; i++) { await p.keyboard.press('Tab'); focused = await p.evaluate(() => document.activeElement && document.activeElement.id === 'btn-proceed'); }
    ok(focused && await p.evaluate(() => { const o = getComputedStyle(document.activeElement); return o.outlineStyle !== 'none' && parseFloat(o.outlineWidth) >= 2; }), 'the primary action is keyboard reachable with a visible focus state');
    await p.click('#btn-proceed'); await waitState(p, 'SAFETY_CHECKLIST');
    ok((await p.locator('#bt-back').count()) === 0, 'once the flow has begun the way back is removed');
    ok((await p.locator('#hold-final-timed').count()) === 1, 'the press-and-hold has a switch-access timed alternative');
    for (const cb of await p.locator('[data-item]').all()) { await cb.scrollIntoViewIfNeeded(); await cb.check(); }
    await p.waitForFunction(() => !document.querySelector('#hold-final').disabled);
    await hold(p, '#hold-final', 1300);
    await waitState(p, 'READY_TO_CONNECT_POWER');
    await p.click('#btn-battery-connected');
    await waitState(p, 'MOTOR_READY', 30000);
    ok(await p.locator('#btn-stop-zero').isVisible(), 'Stop & zero is visible once powered');
    await p.setViewportSize({ width: 360, height: 740 });
    ok(await noHScroll(p) && await p.locator('#btn-stop-zero').isVisible(), 'the powered screen fits 360 px with Stop & zero visible');
    await p.setViewportSize({ width: 412, height: 915 });
    // navigation is restricted while powered: Back is absorbed with an explanation, the way back is absent, closing asks first
    await p.goBack().catch(() => {});
    await p.waitForSelector('text=Going back is blocked', { timeout: 5000 });
    ok(new URL(p.url()).pathname === '/motor-diagnostics/' && (await p.locator('#bt-back').count()) === 0, 'while powered the browser Back button is absorbed and explained');
    // all four motors, one at a time
    const POS = ['rear-right', 'front-right', 'rear-left', 'front-left'];
    for (let m = 0; m < 4; m++) {
      await p.click(`#btn-motor-${m + 1}`); await p.click('#btn-confirm-target');
      await p.waitForFunction(() => !document.querySelector('#hold-start').disabled, null, { timeout: 20000 });
      await hold(p, '#hold-start', 1300);
      await waitState(p, 'RUNNING');
      if (m === 0) {
        ok(/Motor 1 running/.test(await text(p, '#bt-sec-run h2')) && (await p.locator('#rd-big').count()) === 1, 'the active motor is highlighted with a large readout');
        ok(await p.locator('#btn-stop-zero').isVisible() && await noHScroll(p), 'Stop & zero stays visible while running, with no horizontal scroll');
      }
      await waitState(p, 'VERIFYING_STOP', 30000);
      await p.waitForSelector('#btn-no-rotation', { timeout: 15000 }); await p.click('#btn-no-rotation');
      await p.click(`#btn-pos-${POS[m]}`);
      await waitState(p, 'MOTOR_READY');
    }
    await p.waitForSelector('#bt-sec-result');
    ok(/Completed — no issue observed|Difference observed/.test(await text(p, '#bt-result-headline')), 'after four motors a result headline is shown: ' + (await text(p, '#bt-result-headline')));
    ok((await p.locator('.bt-rescell').count()) === 4 && (await p.locator('details.bt-card').count()) === 4, 'the quad and four expandable motor cards are shown');
    ok(/1020 to 1100/.test(await text(p, '#bt-sec-result')) && /propeller-free/.test(await text(p, '#bt-sec-result')) && /does not mean/.test(await text(p, '#bt-sec-result')), 'range, cap, the propeller-free limitation and the not-a-certification statement are shown');
    await p.locator('details.bt-card').first().locator('summary').click();
    ok(/Start threshold/.test(await text(p, 'details.bt-card[open]')) && /DShot errors/.test(await text(p, 'details.bt-card[open]')), 'a motor card expands to its evidence');
    ok(await noHScroll(p), 'the result has no horizontal scroll at 412 px');
    await p.setViewportSize({ width: 360, height: 740 }); ok(await noHScroll(p), 'the result has no horizontal scroll at 360 px');
    await p.setViewportSize({ width: 1200, height: 850 }); ok(await noHScroll(p), 'the result has no horizontal scroll at desktop width');
    // finish, disconnect the battery, save
    await p.click('#btn-finish');
    await waitState(p, 'VERIFYING_STOP', 15000);
    await p.waitForSelector('#btn-no-rotation', { timeout: 15000 }); await p.click('#btn-no-rotation');
    await p.click('#btn-finish-stop'); await waitState(p, 'BENCH_COMPLETE');
    ok((await p.locator('#bt-back').count()) === 0, 'the way back is still withheld until the battery is disconnected and confirmed');
    await p.click('#btn-battery-removed');
    await p.waitForSelector('#btn-reset:not([disabled])', { timeout: 10000 });
    await p.click('#btn-save-result');
    ok(/Saved/.test(await text(p, '#bt-save-status')) && await p.evaluate(() => localStorage.getItem('uavzones.aircraftdiag.samples.v1') === null), 'the result is saved on request, with no live samples by default');
    await p.click('#btn-reset'); await waitState(p, 'DISCONNECTED');
    ok((await p.locator('#bt-back').count()) === 1, 'after the battery is disconnected the way back to the dashboard returns');
    await p.waitForSelector('#bt-sec-history details');
    ok((await p.locator('#bt-sec-history details').count()) === 1, 'the saved result is listed in the history');
    await p.click('#bt-back'); await p.waitForSelector('#diag-latest');
    ok(/Latest check: .*(Completed|Difference)/.test(await text(p, '#diag-latest')), 'the dashboard card shows the saved result');
    // deletion through the Privacy card
    await p.click('#privacy-btn'); await p.waitForSelector('#aircraft-diag-card', { state: 'visible' });
    await p.click('#aircraft-diag-delete');
    await p.waitForFunction(() => localStorage.getItem('uavzones.aircraftdiag.v1') === null);
    ok(true, 'Delete in the Privacy card removes the saved results');
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('#diag-entry');
    ok((await p.locator('#diag-latest').count()) === 0, 'the dashboard card no longer shows a latest result');
    await ctx.close();
  }

  // ---------- closing the page while powered asks first (the page also stops the motors); recovery through the user route
  {
    const { ctx, p } = await open(ON + 'motor-diagnostics/?synthetic=1');
    await p.click('#btn-connect-mock'); await waitState(p, 'READ_ONLY_READINESS');
    await p.check('[data-attest="armSwitchOff"]'); await p.check('[data-attest="batteryDisconnected"]');
    await p.waitForFunction(() => !document.querySelector('#btn-proceed').disabled);
    await p.click('#btn-proceed'); await waitState(p, 'SAFETY_CHECKLIST');
    for (const cb of await p.locator('[data-item]').all()) await cb.check();
    await p.waitForFunction(() => !document.querySelector('#hold-final').disabled);
    await hold(p, '#hold-final', 1300); await waitState(p, 'READY_TO_CONNECT_POWER');
    ok(await p.evaluate(() => localStorage.getItem('uavzones.benchtest.unclean.v1') !== null), 'the durable recovery marker is set before the battery step');
    const prevented = await p.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    await waitState(p, 'LOCKED_FAULT');
    ok(prevented, 'closing or leaving the page while the battery step is open asks for confirmation and sends the stop first (a forced close or a crash is uncontrollable and recovers through the marker)');
    await ctx.close();
  }
  {
    const { ctx, p } = await open(ON + 'motor-diagnostics/?synthetic=1', { init: { 'uavzones.benchtest.unclean.v1': JSON.stringify({ v: 1, unclean: true, at: 1 }) } });
    await p.waitForSelector('.bt-overlay');
    ok((await text(p, '.bt-overlay')).startsWith('Disconnect the flight battery now.'), 'after an interrupted session the user route leads with "Disconnect the flight battery now."');
    ok((await p.locator('#bt-back, #btn-proceed, #hold-final, #hold-start').count()) === 0 && (await p.locator('.bt-overlay [data-state], .bt-overlay pre').count()) === 0, 'no ordinary navigation, active control, raw state or trace is offered during recovery');
    await p.click('#btn-battery-removed'); await p.click('#btn-connect-mock');
    await waitState(p, 'BATTERY_REMOVAL_RECOVERY');
    await p.waitForSelector('#btn-no-rotation', { timeout: 15000 }); await p.click('#btn-no-rotation');
    await p.click('#btn-complete-recovery'); await waitState(p, 'DISCONNECTED');
    ok(await p.evaluate(() => localStorage.getItem('uavzones.benchtest.unclean.v1') === null) && (await p.locator('#bt-back').count()) === 1, 'recovery clears the marker only after the proof and battery confirmation, then the way back returns');
    await ctx.close();
  }
} finally {
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
  on.kill(); off.kill();
}
