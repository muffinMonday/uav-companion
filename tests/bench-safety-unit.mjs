// Phase 3 bench test: static safety scan. This replaces the Phase 1/2 blanket ban on motor-command code with a STRICTER rule:
// the motor-command message exists in exactly one reviewed module and nowhere else, and nothing outside the controller may call it.
// tests/preflight-safety-unit.mjs still proves the read-only lab and src/preflight contain no motor-command code at all.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_APPROVED, SYNTHETIC_ALLOWLIST } from '../src/benchtest/allowlist.js';
import { BENCH_TIMINGS, MOTOR } from '../src/benchtest/constants.js';
import { DISCLAIMER } from '../src/benchtest/result.js';
import { benchEnabled, overrideBenchFlagForTests } from '../src/benchtest/flag.js';
import { STOP_EXTERNAL_VALUE, TIMINGS } from '../src/preflight/constants.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const pass = (t) => console.log('PASS  ' + t);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name === 'out' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)])) : []);
const code = (f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

const BENCH = walk(path.join(ROOT, 'src/benchtest')).filter((f) => f.endsWith('.js'));
const BOUNDARY = 'src/benchtest/motor-control.js';
const SOURCES = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'tools')), ...walk(path.join(ROOT, 'motor-diagnostics')), ...walk(path.join(ROOT, 'scripts')), path.join(ROOT, 'index.html'), path.join(ROOT, 'vite.config.js')]
  .filter((f) => /\.(js|mjs|html|css)$/.test(f));
assert.ok(BENCH.length >= 9, 'found the bench modules');
assert.ok(BENCH.map(rel).includes(BOUNDARY));

// 1. the motor-command message exists in exactly one module
// the bare number 214 is checked only where code could build a frame (src and tools); scripts contain unrelated numbers
const appCode = (f) => /^(src|tools)\//.test(rel(f));
const NAMES = /SET_MOTOR|setMotor|buildMotorFrame|MotorBoundary/;
const has = (re, f) => re.test(code(f)) || (appCode(f) && /\b214\b/.test(code(f)));
const hits = SOURCES.filter((f) => has(NAMES, f)).map(rel).sort();
// controller.js constructs the boundary object (MotorBoundary) but never the frame; the mock imports only receiving helpers.
// scripts/motor-msp-compare.mjs is the Phase 1 offline source-analysis script: it reads Betaflight source text, imports only fs and path, and sends nothing.
const ANALYSIS = 'scripts/motor-msp-compare.mjs';
assert.ok(!/^import .*(transport|session|serial)/m.test(fs.readFileSync(path.join(ROOT, ANALYSIS), 'utf8')) && /^import fs from 'node:fs';/m.test(fs.readFileSync(path.join(ROOT, ANALYSIS), 'utf8')), 'the analysis script imports no transport');
const allowedNames = new Set([BOUNDARY, 'src/benchtest/controller.js', ANALYSIS]);
for (const h of hits) assert.ok(allowedNames.has(h), `${h} names the motor-command message or the boundary class`);
const frameNames = /SET_MOTOR|setMotor|buildMotorFrame/;
assert.deepEqual(SOURCES.filter((f) => has(frameNames, f)).map(rel).sort(), [ANALYSIS, BOUNDARY].sort(), 'only motor-control.js can build, name or identify the motor-command message (the offline analysis script only names it in text)');
pass('MSP_SET_MOTOR, its id 214 and the frame builder appear only in src/benchtest/motor-control.js; the controller only constructs the boundary');

// 2. raw transport writes: only the boundary and the transport layer itself
const RAW = /\._write\s*\(/;
const rawHits = SOURCES.filter((f) => RAW.test(code(f))).map(rel).sort();
assert.deepEqual(rawHits, [BOUNDARY, 'src/benchtest/mock-bench-fc.js', 'src/preflight/transport.js'].sort(), 'raw transport writes');
assert.ok(/super\._write/.test(code(path.join(ROOT, 'src/benchtest/mock-bench-fc.js'))), 'the synthetic FC only delegates to the base class');
assert.ok(/isAllowedRequestFrame/.test(code(path.join(ROOT, 'src/preflight/transport.js'))), 'transport.write() still enforces the read-only gate');
pass('the only raw write call sites are the guarded boundary, the transport base class and the synthetic FC override');

// 3. only the controller calls the boundary's send methods; only the controller and the synthetic FC import the module
const SEND = /\.(sendOutput|sendStop)\s*\(/;
const sendHits = SOURCES.filter((f) => SEND.test(code(f))).map(rel).sort();
assert.deepEqual(sendHits, ['src/benchtest/controller.js'], 'sendOutput and sendStop call sites');
const importers = SOURCES.filter((f) => /from\s+['"][^'"]*motor-control(\.js)?['"]/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
assert.deepEqual(importers, ['src/benchtest/controller.js', 'src/benchtest/mock-bench-fc.js'], 'importers of the boundary module');
pass('only the controller sends through the boundary; only the controller and the synthetic FC import it');

// 4. no other write, CLI, 4-way, erase, reflash, storage (except the marker), network or repeating timer in the bench code or its page
const pageFiles = [...walk(path.join(ROOT, 'tools/motor-bench-lab')), ...walk(path.join(ROOT, 'motor-diagnostics'))].filter((f) => /\.(js|html)$/.test(f));
const FORBIDDEN = [
  [/4WAY|4way|fourWay|passthrough/i, '4-way / passthrough'],
  [/DATAFLASH_ERASE|DATAFLASH_READ|\berase\w*\(/i, 'log erase / read'],
  [/MSP_SET_(?!MOTOR)|MSP_EEPROM|MSP_REBOOT|MSP_RESET/, 'MSP write / reboot'],
  [/\\r\\n|'#'|"#"|get blackbox_mode|cliMode|enterCli/i, 'CLI'],
  [/reflash|flashFirmware|bootloader|\bdfu\b/i, 'reflash'],
  [/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.bluetooth/, 'network'],
  [/\bsetInterval\s*\(/, 'repeating timer'],
  [/ALWAYS_ON/, 'ALWAYS_ON'],
];
for (const f of [...BENCH, ...pageFiles]) {
  const c = code(f).replace(/^import .*$/gm, '').replace(/MSP_DATAFLASH_SUMMARY/g, '');
  for (const [re, name] of FORBIDDEN) assert.ok(!re.test(c), `${rel(f)} matches ${name}`);
}
const storageHits = [...BENCH, ...pageFiles].filter((f) => /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./.test(code(f))).map(rel);
assert.deepEqual(storageHits, ['src/benchtest/recovery-marker.js'], 'only the recovery marker touches browser storage');
pass('no CLI, 4-way, erase, reflash, other MSP write, network call or repeating timer; browser storage only in recovery-marker.js');

// 5. constants: nonzero values live only in the Phase 3 constants module; the read-only constants stay free of them
const noNum = (f) => !/\b(1020|1100)\b/.test(code(f));
for (const f of BENCH) if (rel(f) !== 'src/benchtest/constants.js') assert.ok(noNum(f), `${rel(f)} hard-codes an output value`);
assert.ok(noNum(path.join(ROOT, 'src/preflight/constants.js')), 'src/preflight/constants.js stays free of output values');
assert.equal(STOP_EXTERNAL_VALUE, 1000);
assert.deepEqual([MOTOR.stopValue, MOTOR.startValue, MOTOR.step, MOTOR.cap, MOTOR.candidateValidationMs, MOTOR.plateauOffsetMin, MOTOR.plateauOffsetMax, MOTOR.plateauMaxMs, MOTOR.dwellMinMs, MOTOR.dwellMaxMs], [1000, 1020, 5, 1100, 1000, 15, 20, 2000, 300, 500]);
assert.ok(MOTOR.dwellMs >= MOTOR.dwellMinMs && MOTOR.dwellMs <= MOTOR.dwellMaxMs);
assert.ok(MOTOR.plateauOffset >= MOTOR.plateauOffsetMin && MOTOR.plateauOffset <= MOTOR.plateauOffsetMax && MOTOR.plateauMs <= MOTOR.plateauMaxMs);
assert.deepEqual([TIMINGS.telemetryPollMs, TIMINGS.staleTelemetryFaultMs, TIMINGS.motorAckTimeoutMs, TIMINGS.motorAckConsecutiveFailuresFault, TIMINGS.stopCadenceMs, TIMINGS.stopMinAttempts, TIMINGS.reconnectGraceMs, TIMINGS.escReadyWaitMs, TIMINGS.poweredZeroObservationMs], [40, 200, 150, 2, 50, 10, 15000, 5000, 3000]);
assert.equal(BENCH_TIMINGS.stopProofZeroRpmMs, 1000);
assert.ok(Object.isFrozen(MOTOR) && Object.isFrozen(BENCH_TIMINGS));
assert.ok(/PROVISIONAL/.test(fs.readFileSync(path.join(ROOT, 'src/benchtest/constants.js'), 'utf8')));
pass('the provisional values are frozen in one module, match the approved list, and are labelled provisional; the read-only constants hold no output value');

// 6. no entry point: nothing in the app, its components, index.html or scripts references the bench; the build input is flag-gated
const refs = [];
for (const f of [...walk(path.join(ROOT, 'src')).filter((x) => !rel(x).startsWith('src/benchtest/') && !rel(x).startsWith('src/preflight/')), path.join(ROOT, 'index.html'), ...walk(path.join(ROOT, 'src/components')), ...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'public')).filter((x) => /\.(html|js|json|webmanifest)$/.test(x))]) {
  if (!/\.(js|mjs|html|css|json|webmanifest)$/.test(f)) continue;
  if (/benchtest|motor-bench|bench-lab|VITE_BENCH_PHASE3/i.test(fs.readFileSync(f, 'utf8'))) refs.push(rel(f));
}
// The one allowed reference is the dashboard entry of the user-facing beta (owner decision 2026-11-17). It must stay build-flag gated, import only the local result store, and hold no motor, transport or bench code.
assert.deepEqual(refs, ['src/motor-diag-entry.js'], 'only the flag-gated dashboard entry references the bench flag');
const entry = fs.readFileSync(path.join(ROOT, 'src/motor-diag-entry.js'), 'utf8');
assert.ok(/export const motorDiagCard = import\.meta\.env\.VITE_BENCH_PHASE3 === '1' \? buildCard : \(\) => null;/.test(entry), 'the entry is a constant-false no-op without the flag');
assert.deepEqual([...entry.matchAll(/^import .* from '(.*)';/gm)].map((m) => m[1]), ['./aircraft-diag-data.js'], 'the entry imports only the local result store');
assert.ok(!/benchtest|MotorBoundary|transport|serial/i.test(entry.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')), 'the entry holds no bench, transport or serial code');
const vite = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
assert.ok(/process\.env\.VITE_BENCH_PHASE3 === '1' \? \{ motorBenchLab/.test(vite), 'the page is a build input only when the flag is set');
assert.ok(!/src\/benchtest/.test(vite), 'vite.config.js does not import the bench modules');
const labHtml = fs.readFileSync(path.join(ROOT, 'tools/motor-bench-lab/index.html'), 'utf8');
assert.ok(/<meta name="robots" content="noindex">/.test(labHtml));
assert.ok(!/<a\s/i.test(labHtml));
const preflightPages = [...walk(path.join(ROOT, 'src/preflight')), ...walk(path.join(ROOT, 'tools/preflight-spike'))].filter((f) => /\.(js|html|md)$/.test(f));
for (const f of preflightPages) assert.ok(!/benchtest|motor-bench/i.test(fs.readFileSync(f, 'utf8')), `${rel(f)} (the read-only lab) references the bench`);
pass('no dashboard, map, app, script or public entry references the bench; the read-only lab does not reference it; the page is noindex and flag-gated in the build');

// 7. the flag defaults off and is not a stored preference
assert.equal(benchEnabled(), false);
const off = overrideBenchFlagForTests(true); assert.equal(benchEnabled(), true); off(); assert.equal(benchEnabled(), false);
overrideBenchFlagForTests(false); assert.equal(benchEnabled(), false); overrideBenchFlagForTests(null); assert.equal(benchEnabled(), false);
assert.ok(!/localStorage|sessionStorage|cookie|location\.|URLSearchParams/.test(code(path.join(ROOT, 'src/benchtest/flag.js'))));
pass('the Phase 3 flag defaults off; the override is an explicit in-memory call; nothing is stored or read from the URL');

// 8. the allowlist: exactly one owner-approved real combination; the synthetic fixture stays mock-only
assert.equal(OWNER_APPROVED.length, 1);
assert.ok(SYNTHETIC_ALLOWLIST.every((e) => e.synthetic === true && e.targetName === 'SYNTH'));
pass('exactly one real FC/ESC combination is owner-approved; the synthetic fixture stays mock-only');

// 9. wording: no safety claim, no health verdict, in strings of the bench code or page
const CLAIM = /safe to fly|airworth|certified|fault[- ]free|guarantee/i;
const VERDICT = /\b(healthy|unhealthy|faulty motor|motor (passed|failed)|diagnosis|diagnos(e|ed)\b)/i;
for (const f of [...BENCH, ...pageFiles]) {
  const text = f.endsWith('.js') ? code(f) : fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const strings = [...text.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).filter((s) => s.length > 3);
  for (const s of strings) { if (s === DISCLAIMER && rel(f) === 'src/benchtest/result.js') continue; /* the one string that states what the result does NOT mean */ assert.ok(!CLAIM.test(s), `${rel(f)} has claim wording: ${s.slice(0, 80)}`); assert.ok(!VERDICT.test(s), `${rel(f)} has a verdict: ${s.slice(0, 80)}`); }
}
pass('no string in the bench code claims safe to fly, airworthiness, certification, fault-free or a guarantee, or gives a health verdict');

// 10. required wording is present
const ui = fs.readFileSync(path.join(ROOT, 'src/benchtest/bench-ui.js'), 'utf8');
for (const must of ['Disconnect the flight battery now.', 'Stop & zero', 'not access control', 'Experimental developer bench tool', 'REAL HARDWARE MODE', 'SYNTHETIC MODE']) assert.ok(ui.includes(must) || fs.readFileSync(path.join(ROOT, 'src/benchtest/constants.js'), 'utf8').includes(must), `missing wording: ${must}`);
pass('the battery instruction, Stop & zero, the access-control caveat and the mode labels are in the UI source');

console.log('ALL OK');
