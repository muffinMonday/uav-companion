// Motor diagnostics Phase 1: the scripted tag comparison. Offline synthetic C snippets test the extractor;
// set MOTOR_COMPARE_CACHE=<dir with downloaded sources> (or run `node scripts/motor-msp-compare.mjs --cache <dir>` first) to also
// check src/preflight/versions.js against the real tagged sources. Without a cache that second part prints SKIP, never PASS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { apiVersion, caseBlock, collect, compare, enumValues, layout, messageId, TAGS } from '../scripts/motor-msp-compare.mjs';
import { VERSION_TABLE } from '../src/preflight/versions.js';

const pass = (t) => console.log('PASS  ' + t);

assert.equal(apiVersion('#define API_VERSION_MAJOR 1\n#define API_VERSION_MINOR 47\n'), '1.47');
assert.equal(apiVersion('nothing'), null);
assert.equal(messageId('#define MSP_MOTOR 104\n#define MSP_SET_MOTOR 214', 'MSP_MOTOR'), 104);
assert.equal(messageId('#define MSP_MOTOR 104', 'MSP_UID'), null);
pass('API version and message ids are extracted; a missing item is null, not a default');

const C = `
    case MSP_FOO:
        sbufWriteU8(dst, a);
        sbufWriteU16(dst, b); // note
        // Added in MSP API 1.45
        sbufWriteU32(dst, c);
#ifdef USE_X
        sbufWriteU8(dst, enabledBranch);
#else
        sbufWriteU8(dst, 0);
        sbufWriteU8(dst, 0);
#endif
        for (unsigned i = 0; i < 4; i++) {
            sbufWriteU16(dst, d);
        }
        break;
    case MSP_BAR :
        sbufWriteU8(dst, z);
        break;
`;
const b = caseBlock(C, 'MSP_FOO');
const L = layout(b.text);
assert.deepEqual(L.map((x) => x.type), ['U8', 'U16', 'U32', 'U8', 'LOOP', 'U16']);
assert.equal(L[3].expr, 'enabledBranch');
assert.equal(L[2].gate, '1.45');
assert.equal(L[1].note, 'note');
pass('a case block is cut at the next case; #else branches are dropped; API gates and loops are recorded');
assert.deepEqual(layout(caseBlock(C, 'MSP_BAR').text).map((x) => x.expr), ['z']);
assert.equal(caseBlock(C, 'MSP_NOPE'), null);
assert.equal(layout(null), null);
pass('"case NAME :" (space before the colon) is found; an absent case is null');

const E = `typedef enum {
    FIELD_A = 0,
    FIELD_B,
    FIELD_C = 5, // comment
    FIELD_D,
    FIELD_COUNT
} thing_e;
typedef enum { OTHER_X = 0 } other_e;`;
assert.deepEqual(enumValues(E, /^\s*FIELD_A\b/m, null).map((x) => [x.name, x.value]), [['FIELD_A', 0], ['FIELD_B', 1], ['FIELD_C', 5], ['FIELD_D', 6], ['FIELD_COUNT', 7]]);
assert.equal(enumValues(E, /^\s*NOPE\b/m, null), null);
pass('enum values follow explicit assignments and stop at the closing brace');

const mk = (tag, expr) => ({ tag, layouts: { MSP_FC_VERSION: [{ type: 'U8', expr }], MSP_MOTOR_CONFIG: [], MSP_ADVANCED_CONFIG: [], MSP_ANALOG: [], MSP_BLACKBOX_CONFIG: [], MSP_MOTOR_TELEMETRY: [], MSP_MOTOR: [] } });
assert.equal(compare([mk('a', 'x'), mk('b', 'x')]).length, 0);
assert.equal(compare([mk('a', 'x'), mk('b', 'y')]).length, 1);
pass('compare reports a layout difference only when expressions differ');

assert.deepEqual([...TAGS], ['4.3.2', '4.4.3', '4.5.5', '2025.12.5', '2026.6.2']);
pass('the compared tags are the three candidates plus the two unsupported references');

// ---- optional: the real sources
const cache = process.env.MOTOR_COMPARE_CACHE;
if (cache && fs.existsSync(cache)) {
  for (const tag of TAGS) {
    const r = await collect(tag, cache);
    const row = VERSION_TABLE.find((x) => x.firmware === tag);
    assert.ok(row, `versions.js has a row for ${tag}`);
    assert.equal(r.api, row.api, `${tag} API`);
    assert.equal(r.motorTestMode, true, `${tag} MOTOR_TEST`);
    assert.equal(r.gyroUnfilt, row.hasGyroUnfilt, `${tag} gyroUnfilt`);
    assert.equal(r.fieldsDisabledMaskInMsp, !!row.maskBits || tag === '4.4.3', `${tag} mask in MSP reply`);
    assert.equal(r.bbModeCli, '"NORMAL", "MOTOR_TEST", "ALWAYS"', `${tag} CLI tokens`);
    if (row.maskBits) {
      const bit = (n) => r.fieldMask.find((x) => x.name === `FLIGHT_LOG_FIELD_SELECT_${n}`).value;
      for (const [n, v] of Object.entries(row.maskBits)) assert.equal(bit(n), v, `${tag} mask bit ${n}`);
    }
    assert.equal(r.maskIsShift, true, `${tag} mask semantics`);
    assert.equal(r.ids.MSP_SET_MOTOR, 214);
    const dshot = (r.motorProtocol || []).filter((x) => /DSHOT(150|300|600)$/.test(x.name)).map((x) => x.value).sort();
    assert.deepEqual(dshot, [5, 6, 7], `${tag} DShot enum values`);
  }
  pass('versions.js matches the real tagged sources: API, gyroUnfilt, mask presence, per-tag mask bits, CLI tokens, DShot enum');
} else console.log('SKIP  real-source check (set MOTOR_COMPARE_CACHE to a cache directory)');

console.log('ALL OK');
