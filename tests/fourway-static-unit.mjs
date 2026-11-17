// 4-way ESC identification: static guards over the source tree (prohibited commands, the single write path, importers, forbidden APIs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pass = (t) => console.log('PASS  ' + t);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const files = walk(path.join(root, 'src')).map((f) => ({ rel: rel(f), src: fs.readFileSync(f, 'utf8') }));
const code = files.map((f) => ({ ...f, code: stripComments(f.src) }));
const fourway = code.filter((f) => f.rel.startsWith('src/fourway/'));
assert.ok(fourway.length >= 6, 'src/fourway modules exist');

// ---- prohibited commands appear only in codec.js
{
  const names = /erase_?all|page_?erase|device_?write|write_?e?eprom|interface_?set_?mode|c2ck|device_?verify|read_?eeprom|PROHIBITED_CMD/i;
  const hits = code.filter((f) => f.rel !== 'src/fourway/codec.js' && names.test(f.code)).map((f) => f.rel);
  assert.deepEqual(hits, [], 'prohibited command names outside codec.js');
  const hex = /\b0x(38|39|3b|3c|3d|3e|3f|40)\b/i;
  assert.deepEqual(fourway.filter((f) => f.rel !== 'src/fourway/codec.js' && hex.test(f.code)).map((f) => f.rel), [], 'prohibited command values outside codec.js');
  const used = new Set(fourway.flatMap((f) => [...f.code.matchAll(/FOURWAY_CMD\.([A-Z_0-9]+)/g)].map((m) => m[1])));
  const allowedNames = new Set(['TEST_ALIVE', 'PROTOCOL_GET_VERSION', 'INTERFACE_GET_NAME', 'INTERFACE_GET_VERSION', 'INTERFACE_EXIT', 'DEVICE_RESET', 'DEVICE_INIT_FLASH', 'DEVICE_READ']);
  assert.deepEqual([...used].filter((n) => !allowedNames.has(n)), []);
  const codec = code.find((f) => f.rel === 'src/fourway/codec.js').code;
  assert.ok(/PROHIBITED_CMD/.test(codec) && /0x3b/i.test(codec), 'the prohibited map lives in codec.js');
  pass('prohibited 4-way command names and values appear only in codec.js');
}

// ---- raw writes
{
  const EXPECTED_WRITERS = ['src/benchtest/mock-bench-fc.js', 'src/benchtest/motor-control.js', 'src/fourway/boundary.js', 'src/fourway/mock-fourway-fc.js', 'src/preflight/transport.js'];
  const found = code.filter((f) => /\._write\b/.test(f.code)).map((f) => f.rel).sort();
  assert.deepEqual(found, EXPECTED_WRITERS);
  const b = code.find((f) => f.rel === 'src/fourway/boundary.js').code;
  assert.equal((b.match(/\._write\(/g) || []).length, 1, 'boundary has exactly one transport write');
  assert.ok(/buildRequest\(/.test(b));
  assert.ok(!/encodeResponse|attachFourWay|mock/i.test(b));
  pass('._write is referenced only by the boundary, the motor boundary, the transport and the two synthetic mocks; the boundary has one write site');
}

// ---- importers
{
  const ALLOWED_IMPORTERS = ['src/benchtest/controller.js']; // may import any src/fourway module
  const PURE_IMPORTERS = ['src/benchtest/controller.js', 'src/benchtest/history.js', 'src/benchtest/history-ui.js', 'src/benchtest/esc-ui.js']; // scan-result.js, identify.js and constants.js only
  const pure = /fourway\/(scan-result|identify|constants)\.js/;
  const importers = [];
  for (const f of code) {
    if (f.rel.startsWith('src/fourway/')) continue;
    for (const m of f.code.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]*fourway\/[^'"]*)['"]/g)) importers.push({ file: f.rel, spec: m[1] });
  }
  for (const i of importers) {
    const ok = ALLOWED_IMPORTERS.includes(i.file) || (PURE_IMPORTERS.includes(i.file) && pure.test(i.spec));
    assert.ok(ok, `${i.file} must not import ${i.spec}`);
  }
  // inside src/fourway only relative imports of sibling modules or the two shared synthetic helpers
  for (const f of fourway) for (const m of f.code.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) assert.ok(/^\.\/[a-z-]+\.js$/.test(m[1]), `${f.rel} imports ${m[1]}`);
  pass(`src/fourway is imported only by the allowed modules (${importers.length} importers found)`);
}

// ---- forbidden APIs
{
  const bad = /\b(fetch|XMLHttpRequest|WebSocket|setInterval|localStorage|sessionStorage|indexedDB|navigator|document|window)\b/;
  for (const f of fourway) assert.ok(!bad.test(f.code), `${f.rel} uses a forbidden API: ${(f.code.match(bad) || [])[0]}`);
  for (const f of fourway) assert.ok(!/\bsetTimeout\(/.test(f.code.replace(/clock\.setTimeout\(/g, '')), `${f.rel} must use the injected clock`);
  pass('no network, storage, DOM or setInterval in src/fourway; timers use the injected clock');
}

// ---- no unawaited sends
{
  const b = code.find((f) => f.rel === 'src/fourway/boundary.js').code;
  assert.deepEqual([...b.matchAll(/(.{0,6})this\._xfer\(/g)].filter((m) => !/await $/.test(m[1])).map((m) => m[0]), [], 'every _xfer call is awaited');
  assert.deepEqual([...b.matchAll(/this\._xfer\(.*/g)].filter((m) => /\.(forEach|map)\(|setTimeout|Promise\.all/.test(m[0])).map((m) => m[0]), []);
  assert.equal((b.match(/this\._emit\(/g) || []).length, 2, 'only enter() and _xfer() emit');
  assert.ok(!/\.forEach\(|\.map\(|Promise\.all/.test(b.replace(/[^\n]*String\.fromCharCode[^\n]*/g, '')), 'no unawaited iteration helpers in the boundary');
  // every loop that reaches _xfer does so through an await
  for (const m of b.matchAll(/\b(for|while)\s*\(/g)) {
    const open = b.indexOf('{', m.index);
    let depth = 0, i = open;
    for (; i < b.length; i++) { if (b[i] === '{') depth++; else if (b[i] === '}' && --depth === 0) break; }
    const body = b.slice(open, i);
    for (const c of body.matchAll(/(.{0,6})this\.(_xfer|_identifyChannel|_emit)\(/g)) assert.ok(/await $/.test(c[1]), `loop sends without await: ${c[0]}`);
  }
  pass('boundary.js has no loop or callback that sends without awaiting');
}
