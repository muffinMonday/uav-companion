// Motor diagnostics Phases 1 and 2: static safety scan. These checks fail if any code path could send a motor command,
// enter the CLI, write configuration, erase logs, use the 4-way interface, store data, use the network or add an entry point.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMINGS, STOP_EXTERNAL_VALUE, RESOLVABILITY } from '../src/preflight/constants.js';
import { overrideFlagForTests, preflightEnabled } from '../src/preflight/flag.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const pass = (t) => console.log('PASS  ' + t);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const code = (f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

const preflightFiles = walk(path.join(ROOT, 'src/preflight')).filter((f) => f.endsWith('.js'));
const toolFiles = walk(path.join(ROOT, 'tools/preflight-spike')).filter((f) => /\.(js|html)$/.test(f));
assert.ok(preflightFiles.length >= 8, 'found the preflight modules');

// 1. nothing can name or send a write
const FORBIDDEN = [
  [/SET_MOTOR|setMotor|\b214\b/, 'MSP_SET_MOTOR'],
  [/4WAY|4way|fourWay|passthrough/i, '4-way / passthrough'],
  [/DATAFLASH_ERASE|DATAFLASH_READ|\berase\w*\(/i, 'log erase / read'],
  [/MSP_SET_|MSP_EEPROM|MSP_REBOOT|MSP_RESET/, 'MSP write / reboot'],
  [/\bexit\b\\r|\\r\\n|'#'|"#"|get blackbox_mode|cliMode|enterCli/i, 'CLI'],
  [/reflash|flashFirmware|bootloader|dfu/i, 'reflash'],
];
for (const f of preflightFiles) {
  const c = code(f).replace(/^import .*$/gm, '').replace(/\bflashfs\b/gi, '');
  for (const [re, name] of FORBIDDEN) {
    // MSP_DATAFLASH_SUMMARY (a read) is the only dataflash message allowed
    const text = c.replace(/MSP_DATAFLASH_SUMMARY/g, '');
    assert.ok(!re.test(text), `${path.relative(ROOT, f)} mentions ${name}: ${re}`);
  }
}
pass(`no code in src/preflight (${preflightFiles.length} files) names a motor write, 4-way, erase, MSP write, CLI or reflash path`);

// 2. no nonzero motor value exists in the constants
const nums = JSON.stringify({ TIMINGS, RESOLVABILITY });
assert.equal(STOP_EXTERNAL_VALUE, 1000);
for (const bad of ['1020', '1100', 'MAX_TEST', 'MOTOR_CAP']) assert.ok(!code(path.join(ROOT, 'src/preflight/constants.js')).includes(bad), `constants.js mentions ${bad}`);
assert.ok(!nums.includes('1100'));
pass('the constants module holds the stop value (external 1000) and timings only; no test output or cap value exists yet');

// 3. nothing stored, nothing sent over the network, no timers that could drive output
for (const f of [...preflightFiles, ...toolFiles.filter((x) => x.endsWith('.js'))]) {
  const c = code(f);
  for (const re of [/localStorage|sessionStorage|indexedDB|document\.cookie|caches\./, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.bluetooth/, /\bsetInterval\s*\(/]) {
    assert.ok(!re.test(c), `${path.relative(ROOT, f)} matches ${re}`);
  }
}
pass('no storage, no network call and no repeating timer in src/preflight or the lab page');

// 4. the app has no entry point: nothing outside src/preflight and tools/ references it; the build input is index.html only
const refs = [];
for (const f of [...walk(path.join(ROOT, 'src')).filter((x) => !x.includes(path.join('src', 'preflight'))), path.join(ROOT, 'index.html'), ...walk(path.join(ROOT, 'src/components'))]) {
  if (!/\.(js|html|css)$/.test(f)) continue;
  if (/preflight|motor-diagnostics|Check aircraft/i.test(fs.readFileSync(f, 'utf8'))) refs.push(path.relative(ROOT, f));
}
assert.deepEqual(refs, [], 'no app file references the motor diagnostics modules');
const vite = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
assert.deepEqual(vite.match(/tools\/[\w/-]+(?:\.html)?/g), ['tools/preflight-spike/index.html'],'the only build input for tools/ is the lab page');
assert.ok(!/src\/preflight/.test(vite), 'vite.config.js does not import the diagnostics modules');
pass('no app source, component or index.html references the diagnostics; the lab page is the only extra Vite input');

// 5. the feature flag defaults off, an override is explicit and in memory only
assert.equal(preflightEnabled(), false);
const off = overrideFlagForTests(true);
assert.equal(preflightEnabled(), true);
off();
assert.equal(preflightEnabled(), false);
overrideFlagForTests(false); assert.equal(preflightEnabled(), false); overrideFlagForTests(null);
assert.equal(preflightEnabled(), false);
const flagSrc = code(path.join(ROOT, 'src/preflight/flag.js'));
assert.ok(!/localStorage|sessionStorage|cookie|location\.|URLSearchParams/.test(flagSrc));
pass('the build-time flag defaults off; the test override is an explicit call, is removed by its returned function, and nothing is persisted or read from the URL');

// 6. user-facing text never makes a safety claim (negations in rules and comments are code-stripped above)
const CLAIM = /safe to fly|airworth(?!iness)|certified|guarantee/i;
for (const f of [...preflightFiles, ...toolFiles]) {
  const text = f.endsWith('.js') ? code(f) : fs.readFileSync(f, 'utf8').replace(/<!--[sS]*?-->/g, '');
  const strings = [...text.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).filter((s) => s.length > 3);
  for (const s of strings) assert.ok(!CLAIM.test(s), `${path.relative(ROOT, f)} has claim wording: ${s.slice(0, 80)}`);
}
pass('no string in the diagnostics code claims safe to fly, airworthiness, certification or a guarantee');

// 7. the token ALWAYS_ON is never parsed or shown
for (const f of [...preflightFiles, ...toolFiles]) assert.ok(!/ALWAYS_ON/.test(code(f)), `${path.relative(ROOT, f)} uses ALWAYS_ON`);
pass('ALWAYS_ON appears nowhere in diagnostics code (the CLI token is ALWAYS)');

console.log('ALL OK');
