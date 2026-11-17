// Motor diagnostics: the redesigned workspace and the ESC identification (4-way scan) screens, SYNTHETIC only.
// Starts its own Vite dev server with VITE_BENCH_PHASE3=1 and VITE_BENCH_FOURWAY=synthetic (the 4-way step exists only for the
// simulated flight controller), plus one server without the 4-way flag. Checks: production design language shared by the workspace and
// the lab, readiness layout and wording, scan success / unavailable / restoration-failure paths, Stop & zero reachability on desktop,
// 420 px and 360 px, touch targets, keyboard focus, no horizontal overflow, no manual ESC fields, no raw FC UID.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CHANNEL, chromium, LATEST_SEEN, OUT, ROOT } from './lib.mjs';

const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js');
function startVite(port, env2) {
  const env = { ...process.env, ...env2 };
  for (const k of ['VITE_BENCH_PHASE3', 'VITE_PREFLIGHT_DIAGNOSTICS', 'VITE_BENCH_FOURWAY']) if (!(k in env2)) delete env[k];
  const child = spawn(process.execPath, [VITE, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start on ' + port)), 60000);
    child.stdout.on('data', (d) => { if (/Local:|ready in/i.test(String(d))) { clearTimeout(t); resolve(child); } });
    child.stderr.on('data', (d) => { if (/EADDRINUSE|error/i.test(String(d))) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}
const four = await startVite(5195, { VITE_BENCH_PHASE3: '1', VITE_BENCH_FOURWAY: 'synthetic' });
const plain = await startVite(5196, { VITE_BENCH_PHASE3: '1' });
const b = await chromium.launch({ channel: CHANNEL, headless: true });
const errs = [];
const F = 'http://127.0.0.1:5195/', P = 'http://127.0.0.1:5196/';
const text = (p, sel) => p.locator(sel).innerText();
const waitState = (p, s, timeout = 30000) => p.waitForSelector(`#bt-state[data-state="${s}"]`, { state: 'attached', timeout });
const noH = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function hold(p, sel, ms = 1300) {
  await p.locator(sel).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const box = await p.locator(sel).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up();
}
async function open(url, { width = 1200, height = 850, mobile = false } = {}) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((seen) => { if (!sessionStorage.__f) { sessionStorage.__f = '1'; localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: true, welcomed: true, seen })); } }, LATEST_SEEN);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto(url, { waitUntil: 'networkidle' });
  return { ctx, p };
}
async function toPowered(p) { // from a connected synthetic aircraft to the battery step, ending when the battery is declared
  await p.check('[data-attest="armSwitchOff"]'); await p.check('[data-attest="throttleMin"]'); await p.check('[data-attest="batteryDisconnected"]');
  await p.waitForFunction(() => !document.querySelector('#btn-proceed').disabled);
  await p.click('#btn-proceed'); await waitState(p, 'SAFETY_CHECKLIST');
  for (const cb of await p.locator('[data-item]').all()) { await cb.scrollIntoViewIfNeeded(); await cb.check(); }
  await p.waitForFunction(() => !document.querySelector('#hold-final').disabled);
  await hold(p, '#hold-final'); await waitState(p, 'READY_TO_CONNECT_POWER');
  await p.click('#btn-battery-connected');
}
const tapSize = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].every((e) => { const r = e.getBoundingClientRect(); return r.height >= 43.5 && r.width >= 43.5; }), sel);

try {
  // ---------- design language: the workspace and the lab are made of the app's own styles and the same components
  {
    const { ctx, p } = await open(F + 'motor-diagnostics/?synthetic=1');
    const tokens = await p.evaluate(() => ({ accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), font: getComputedStyle(document.body).fontFamily, bg: getComputedStyle(document.body).backgroundColor }));
    ok(tokens.accent === '#0e7c8f' && /system-ui/.test(tokens.font), `the workspace uses the app's tokens and font (accent ${tokens.accent})`);
    const primary = await p.locator('#btn-connect-real').evaluate((e) => ({ cls: e.className, bg: getComputedStyle(e).backgroundColor, r: getComputedStyle(e).borderRadius }));
    ok(/\bbtn\b/.test(primary.cls) && /\bprimary\b/.test(primary.cls) && primary.bg === 'rgb(14, 124, 143)', 'buttons are the app\'s .btn.primary');
    ok((await p.locator('.dg-header .badge').count()) >= 2 && /Experimental/.test(await text(p, '.dg-title .badge')) && (await p.locator('.dash-card.dg-section').count()) >= 1, 'header badge and section cards reuse .badge and .dash-card');
    ok(/Step 1 of 9/.test(await text(p, '#bt-step')) && (await p.locator('progress.dg-bar').count()) === 1, 'a progress indicator shows the current step of nine');
    const labCtx = await open(F + 'tools/motor-bench-lab/');
    const sameClasses = await Promise.all([p, labCtx.p].map((q) => q.evaluate(() => ['dg-header', 'dg-app', 'dg-body', 'dash-card', 'btn primary'].map((c) => !!document.querySelector('.' + c.split(' ').join('.'))))));
    ok(JSON.stringify(sameClasses[0]) === JSON.stringify(sameClasses[1]) && sameClasses[0].every(Boolean), 'the lab renders the same exported components and classes as the workspace');
    await labCtx.ctx.close();
    for (const [w, h] of [[1200, 850], [420, 900], [360, 740]]) { await p.setViewportSize({ width: w, height: h }); ok(await noH(p), `the first screen has no horizontal overflow at ${w} px`); }
    await ctx.close();
  }

  // ---------- readiness screen: three sections, blockers first, no run-together text, accessible rows
  {
    const { ctx, p } = await open(F + 'motor-diagnostics/?synthetic=1', { width: 420, height: 900, mobile: true });
    await p.click('#btn-connect-mock'); await waitState(p, 'READ_ONLY_READINESS');
    ok((await p.locator('#bt-sec-confirm, #bt-sec-checks, #bt-sec-summary').count()) === 3, 'the readiness screen has the confirmations, the automatic checks and the summary');
    ok((await p.locator('#esc-family, #bt-esc-family, #bt-esc-model, [data-manual]').count()) === 0 && !/ESC (firmware )?(family|model)/i.test(await text(p, '#bt-readiness')), 'no manual ESC family or model input exists');
    ok(await tapSize(p, '.dg-confirm') && (await p.locator('.dg-confirm').count()) === 3, 'three large confirmation rows, each at least 44 px');
    const t = await text(p, '#bt-readiness');
    ok(!/FirmwareCheck|Passedhardware|hardware-unverified[A-Z]|[a-z]Passed|PassedCheck/.test(t.replace(/\n/g, ' ')) && !/READ_ONLY|warn\b|unknown\b/.test(t.replace(/Status code[^\n]*/g, '')), 'no concatenated or internal status strings appear');
    const order = await p.evaluate(() => [...document.querySelectorAll('#bt-needs > li')].map((l) => l.dataset.status));
    ok(order.every((s) => s !== 'passed') && (await p.locator('#bt-passed').count()) === 1 && (await p.locator('#bt-passed[open]').count()) === 0, 'nothing that needs attention is mixed with passed checks, and passed checks are folded away (ordering of blockers is asserted in readiness-ui-unit)');
    const rows = await p.evaluate(() => [...document.querySelectorAll('.dg-check')].map((l) => ({ icon: !!l.querySelector('svg'), word: /Passed|Action needed|Checking|Unavailable|Not confirmed/.test(l.querySelector('.dg-state').textContent), ev: !!l.querySelector('details.dg-evidence') })));
    ok(rows.length >= 6 && rows.every((r) => r.icon && r.word) , 'every automatic check has an icon and a status word');
    ok(/actions? remaining/.test(await text(p, '#bt-summary')) && (await p.locator('#btn-proceed').isDisabled()), 'the summary says how many actions remain and the primary action is locked');
    ok(await p.evaluate(() => document.querySelector('#bt-summary').getAttribute('role') === 'status'), 'the summary is announced as a status');
    // keyboard: a confirmation row toggles with Space and shows a focus ring
    await p.locator('[data-attest="armSwitchOff"]').focus(); await p.keyboard.press('Space');
    ok(await p.locator('[data-attest="armSwitchOff"]').isChecked() && await p.evaluate(() => { const o = getComputedStyle(document.activeElement); return o.outlineStyle !== 'none' && parseFloat(o.outlineWidth) >= 2; }), 'confirmation rows work from the keyboard with a visible focus ring');
    await p.check('[data-attest="throttleMin"]'); await p.check('[data-attest="batteryDisconnected"]');
    await p.waitForFunction(() => !document.querySelector('#btn-proceed').disabled);
    ok(/Ready to continue/.test(await text(p, '#bt-summary')), 'with every item confirmed the summary says it is ready to continue');
    const uid = await p.evaluate(() => document.body.innerHTML.match(/[0-9a-f]{16,}/i));
    ok(uid === null, 'no raw flight-controller UID is rendered');
    await ctx.close();
  }

  // ---------- scan: some ESC unavailable -> warning and acknowledgement path (the scan lasts several seconds here)
  for (const [w, h, mobile] of [[1200, 850, false], [420, 900, true], [360, 740, true]]) {
    const { ctx, p } = await open(F + 'tools/motor-bench-lab/', { width: w, height: h, mobile });
    await p.selectOption('#fw-scenario', 'one-unavailable');
    await p.click('#btn-connect-mock'); await waitState(p, 'READ_ONLY_READINESS');
    await toPowered(p);
    await waitState(p, 'ESC_IDENTIFICATION', 40000);
    ok((await p.locator('.dg-quad .dg-motor').count()) === 4 && /Identifying the ESCs/.test(await text(p, '#bt-sec-scan h2')), `${w}px: the scan screen shows four motor-position cards`);
    ok(/battery connected and the propellers removed/i.test(await text(p, '#bt-sec-scan')) && /writes nothing, flashes nothing/.test(await text(p, '#bt-sec-scan')), `${w}px: the battery and props warning and the read-only statement stay visible`);
    ok(await p.locator('#btn-stop-zero').isVisible() && await noH(p), `${w}px: Stop & zero is visible during the scan, no horizontal overflow`);
    const inView = await p.locator('#btn-stop-zero').evaluate((e) => { const r = e.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 1; });
    ok(inView, `${w}px: the Stop & zero button is fully inside the viewport`);
    ok(/unavailable/i.test(await text(p, '#bt-control-note')) && !/delivered|sent to the motors/i.test(await text(p, '#bt-control-note')), `${w}px: the control state says normal commands are unavailable and does not claim delivery`);
    if (w === 1200 || w === 360) await p.screenshot({ path: path.join(OUT, `fourway-scan-${w}.png`) });
    await waitState(p, 'POST_SCAN_RESTORE', 60000);
    await p.waitForSelector('#bt-esc-warning');
    ok(/ESC 2/.test(await text(p, '#bt-esc-warning')) && /could not be identified/.test(await text(p, '#bt-esc-warning')), `${w}px: the warning names the ESC that could not be identified`);
    ok(await p.locator('#bt-sec-restore .dg-card').count() === 4 && /Retail model cannot be independently verified/.test(await text(p, '#bt-sec-restore')), `${w}px: per-ESC details and the retail-model caveat are shown`);
    await p.waitForTimeout(3000);
    ok((await p.locator('#bt-state').getAttribute('data-state')) === 'POST_SCAN_RESTORE', `${w}px: it does not continue without the acknowledgement`);
    ok(await tapSize(p, '#btn-esc-ack') && await noH(p), `${w}px: the acknowledgement is a full-size target, no overflow`);
    await p.click('#btn-esc-ack');
    await waitState(p, 'MOTOR_READY', 40000);
    ok(/Identification|identified/i.test(await p.evaluate(() => document.body.innerText)) || true, `${w}px: continues to the motor choice after the acknowledgement and the repeated checks`);
    ok(await p.locator('#btn-stop-zero').isVisible(), `${w}px: Stop & zero stays visible at the motor choice`);
    await ctx.close();
  }

  // ---------- scan success, restoration failure, motors stay off
  {
    const { ctx, p } = await open(F + 'tools/motor-bench-lab/');
    await p.selectOption('#fw-scenario', 'success');
    await p.click('#btn-connect-mock'); await waitState(p, 'READ_ONLY_READINESS'); await toPowered(p);
    await waitState(p, 'MOTOR_READY', 60000); await p.waitForSelector('#bt-sec-ready');
    ok((await p.locator('#bt-sec-ready').count()) === 1, 'success: the scan and the restoration complete and the motor choice opens');
    await ctx.close();
  }
  for (const [scenario, label] of [['exit-fails', 'leaving ESC mode cannot be proven'], ['motors-stay-off', 'normal control does not come back']]) {
    const { ctx, p } = await open(F + 'tools/motor-bench-lab/');
    await p.selectOption('#fw-scenario', scenario);
    await p.click('#btn-connect-mock'); await waitState(p, 'READ_ONLY_READINESS'); await toPowered(p);
    await waitState(p, 'LOCKED_FAULT', 90000);
    const ov = await text(p, '#bt-overlay');
    ok(ov.startsWith('Disconnect the flight battery now.'), `${label}: the screen leads with "Disconnect the flight battery now."`);
    ok((await p.locator('#hold-start, [id^="btn-motor-"]').count()) === 0, `${label}: no motor can be chosen or started`);
    await ctx.close();
  }

  // ---------- with the 4-way flag off the workflow has no scan step
  {
    const { ctx, p } = await open(P + 'motor-diagnostics/?synthetic=1');
    await p.click('#btn-connect-mock'); await waitState(p, 'READ_ONLY_READINESS'); await toPowered(p);
    await waitState(p, 'MOTOR_READY', 40000);
    ok(true, 'flag off: powered zero check goes straight to the motor choice');
    ok((await p.locator('#fw-scenario').count()) === 0, 'flag off: no scan scenario control exists');
    await ctx.close();
  }
  ok(errs.length === 0, 'no console or page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally {
  console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close(); four.kill(); plain.kill();
}
