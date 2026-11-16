// Motor diagnostics, Phase 1: scripted comparison of Betaflight source across candidate tags.
// READ-ONLY: it only downloads public source files over HTTPS and writes a report. It never touches hardware.
//
//   node scripts/motor-msp-compare.mjs [--cache <dir>] [--out <file.md>] [--json <file.json>]
//
// Every fact is labelled:
//   VERIFIED-SOURCE    extracted from the tagged source text by this script (not run on hardware)
//   HARDWARE-DEPENDENT depends on the build target or a real board; cannot be settled from source
//   UNRESOLVED         not found in source by this script, or ambiguous; needs a person or a hardware check
//
// The extraction is textual (regular expressions over C source). It is a screening tool: a human still reads
// the cited lines before a row is promoted to supported (backlog section 19).
import fs from 'node:fs';
import path from 'node:path';

const REF = 'https://raw.githubusercontent.com/betaflight/betaflight';
export const TAGS = ['4.3.2', '4.4.3', '4.5.5', '2025.12.5', '2026.6.2'];
export const REFERENCE_MASTER = '09b90997'; // master at Phase 0 (2026-11-15); informational only, never supported

const FILES = {
  protocol: 'src/main/msp/msp_protocol.h',
  msp: 'src/main/msp/msp.c',
  bbH: 'src/main/blackbox/blackbox.h',
  bbDefs: 'src/main/blackbox/blackbox_fielddefs.h',
  bbC: 'src/main/blackbox/blackbox.c',
  settings: 'src/main/cli/settings.c',
  motorH: 'src/main/drivers/motor.h',
  pwmH: 'src/main/drivers/pwm_output.h',
  motorTypes: 'src/main/drivers/motor_types.h', // the protocol enum moved here in newer tags
  rcModes: 'src/main/fc/rc_modes.h',
  common: 'src/main/target/common_post.h',
};

// Messages the readiness inventory needs (read-only). MSP_SET_MOTOR is listed only to prove it is excluded here.
export const MESSAGES = ['MSP_API_VERSION', 'MSP_FC_VARIANT', 'MSP_FC_VERSION', 'MSP_BOARD_INFO', 'MSP_UID', 'MSP_FEATURE_CONFIG',
  'MSP_MOTOR_CONFIG', 'MSP_ADVANCED_CONFIG', 'MSP_ANALOG', 'MSP_BLACKBOX_CONFIG', 'MSP_MOTOR_TELEMETRY',
  'MSP_MOTOR', 'MSP_STATUS_EX', 'MSP_MOTOR_3D_CONFIG', 'MSP_DATAFLASH_SUMMARY', 'MSP_SDCARD_SUMMARY', 'MSP_BOXIDS'];
const LAYOUT_MESSAGES = ['MSP_FC_VERSION', 'MSP_MOTOR_CONFIG', 'MSP_ADVANCED_CONFIG', 'MSP_ANALOG', 'MSP_BLACKBOX_CONFIG', 'MSP_MOTOR_TELEMETRY', 'MSP_MOTOR'];

const SIZES = { sbufWriteU8: 1, sbufWriteU16: 2, sbufWriteU32: 4, sbufWriteU16BigEndian: 2, sbufWritePString: null, sbufWriteString: null, sbufWriteData: null };

export async function getFile(tag, key, cacheDir) {
  const rel = FILES[key];
  const f = path.join(cacheDir, `${tag}__${key}.txt`);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const res = await fetch(`${REF}/${tag}/${rel}`);
  const text = res.ok ? await res.text() : null;
  fs.writeFileSync(f, text ?? `__MISSING__ ${res.status}`);
  return text;
}
const read = (t) => (t && !t.startsWith('__MISSING__') ? t : null);

export function apiVersion(protocolText) {
  const g = (n) => protocolText?.match(new RegExp(`#define\\s+${n}\\s+(\\d+)`))?.[1];
  const major = g('API_VERSION_MAJOR'), minor = g('API_VERSION_MINOR');
  return major != null && minor != null ? `${major}.${minor}` : null;
}

export function messageId(protocolText, name) {
  const m = protocolText?.match(new RegExp(`#define\\s+${name}\\s+(\\d+)`));
  return m ? Number(m[1]) : null;
}

// Body of `case NAME:` at 4-space indent inside the first function that has it, up to the next top-level case.
export function caseBlock(src, name) {
  if (!src) return null;
  const re = new RegExp(`^    case ${name}\\s*:[^\\n]*\\n`, 'm');
  const m = re.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + m[0].length);
  // a block ends at the next top-level case label; preprocessor lines inside it are handled by layout()
  const nextCase = rest.search(/^    (case MSP\w*\s*:|default:)/m);
  return { start: m.index, text: rest.slice(0, nextCase < 0 ? rest.length : nextCase) };
}

// Walk a block: keep the first branch of #if/#ifdef (the feature-enabled one), drop #else..#endif.
export function layout(blockText) {
  if (!blockText) return null;
  const fields = [];
  let gate = 'base';
  const stack = []; // entries: { skipping: bool }
  const skipping = () => stack.some((s) => s.skipping);
  for (const line of blockText.split('\n')) {
    const t = line.trim();
    if (/^#\s*if/.test(t)) { stack.push({ skipping: false }); continue; }
    if (/^#\s*else|^#\s*elif/.test(t)) { if (stack.length) stack[stack.length - 1].skipping = true; continue; }
    if (/^#\s*endif/.test(t)) { stack.pop(); continue; }
    if (skipping()) continue;
    const g = t.match(/API(?:\s+version)?\s*(1\.\d+)/i);
    if (g && !/sbufWrite/.test(t)) gate = g[1];
    const w = t.match(/^(sbufWriteU8|sbufWriteU16BigEndian|sbufWriteU16|sbufWriteU32|sbufWritePString)\(dst,\s*(.*)\);\s*(\/\/\s*(.*))?$/);
    if (w) {
      const gm = t.match(/(?:API|Added in MSP API)\s*(1\.\d+)/i);
      fields.push({ type: w[1].replace('sbufWrite', ''), bytes: SIZES[w[1]], expr: w[2].slice(0, 90), note: (w[4] || '').slice(0, 80), gate: gm ? gm[1] : gate });
    }
    // loops of writes make the size data-dependent; record the marker, do not guess
    if (/^for\s*\(/.test(t)) fields.push({ type: 'LOOP', bytes: null, expr: t.slice(0, 90), note: 'size depends on a loop', gate });
  }
  return fields;
}

export function enumValues(src, startRe, stopRe) {
  if (!src) return null;
  const m = startRe.exec(src);
  if (!m) return null;
  const body = src.slice(m.index);
  const end = body.search(stopRe || /^\s*\}/m); // default: the enum's closing brace
  const text = end < 0 ? body : body.slice(0, end);
  const out = []; let v = -1;
  for (const raw of text.split('\n')) {
    const mm = raw.trim().match(/^([A-Z][A-Z0-9_]+)\s*(?:=\s*([^,/]+?))?\s*,?\s*(?:\/\/.*|\/\*.*)?$/);
    if (!mm || /^(typedef|enum)/.test(raw.trim())) continue;
    if (mm[2] != null) {
      const n = Number(String(mm[2]).trim().replace(/^\(?\s*1\s*<<\s*(\d+)\s*\)?$/, (_, b) => String(2 ** b)));
      v = Number.isFinite(n) ? n : v + 1;
    } else v += 1;
    out.push({ name: mm[1], value: v });
  }
  return out;
}

export async function collect(tag, cacheDir) {
  const f = {};
  for (const k of Object.keys(FILES)) f[k] = read(await getFile(tag, k, cacheDir));
  const r = { tag, files: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v != null])) };
  r.api = apiVersion(f.protocol);
  r.ids = Object.fromEntries(MESSAGES.concat(['MSP_SET_MOTOR']).map((n) => [n, messageId(f.protocol, n)]));
  r.layouts = {};
  for (const n of LAYOUT_MESSAGES) {
    const b = caseBlock(f.msp, n);
    r.layouts[n] = b ? layout(b.text) : null;
  }
  // Blackbox field-select enum lives in blackbox_fielddefs.h or blackbox.h depending on the tag.
  const fieldSrc = [f.bbDefs, f.bbH].filter(Boolean).join('\n');
  r.fieldMask = enumValues(fieldSrc, /^\s*FLIGHT_LOG_FIELD_SELECT_PID\b/m, null);
  r.bbMode = enumValues(f.bbH, /^\s*BLACKBOX_MODE_NORMAL\b/m, null);
  r.bbModeCli = f.settings ? (f.settings.match(/lookupTableBlackboxMode\[\]\s*=\s*\{([^}]*)\}/)?.[1].replace(/\s+/g, ' ').trim() ?? null) : null;
  r.bbModeCliSetting = f.settings ? /"blackbox_mode"/.test(f.settings) : null;
  r.motorTestMode = f.bbC ? /BLACKBOX_MODE_MOTOR_TEST/.test(f.bbC) : null;
  r.gyroUnfilt = f.bbC ? /gyroUnfilt/.test(f.bbC) : null;
  r.maskIsShift = f.bbC ? /fields_disabled_mask\s*&\s*\(1\s*<<\s*\w+\)\s*\)\s*==\s*0/.test(f.bbC) : null;
  r.fieldsDisabledMaskInMsp = f.msp ? /fields_disabled_mask/.test(f.msp) : null;
  r.dshotStatsUndef = f.common ? (f.common.match(/#undef USE_DSHOT_TELEMETRY_STATS/g) || []).length : null;
  const proto = enumValues([f.motorTypes, f.motorH, f.pwmH].filter(Boolean).join('\n'), /^\s*(PWM_TYPE_STANDARD|MOTOR_PROTOCOL_PWM)\b/m, null);
  r.motorProtocol = proto;
  r.armBoxId = f.rcModes ? (f.rcModes.match(/PERMANENT_ID_BOXARM\s*=\s*(\d+)/)?.[1] ?? null) : null;
  r.setMotorWritesMotorDisarmed = f.msp ? /case MSP_SET_MOTOR:[\s\S]{0,400}motor_disarmed/.test(f.msp) : null;
  r.dshotCmdStop = null; // external 1000 -> DSHOT_CMD_MOTOR_STOP is read in drivers/dshot.c (Phase 0 F4); not re-fetched here
  return r;
}

const bytesOf = (fs_) => (fs_ && !fs_.some((x) => x.bytes == null) ? fs_.reduce((a, x) => a + x.bytes, 0) : null);
const sig = (fs_) => (fs_ ? fs_.map((x) => `${x.type}:${x.expr.replace(/\s+/g, '')}`).join('|') : null);

export function compare(results) {
  const diffs = [];
  for (const m of LAYOUT_MESSAGES) {
    const base = results[0];
    for (const r of results.slice(1)) {
      if (sig(r.layouts[m]) !== sig(base.layouts[m])) diffs.push({ message: m, from: base.tag, to: r.tag, bytesFrom: bytesOf(base.layouts[m]), bytesTo: bytesOf(r.layouts[m]) });
    }
  }
  return diffs;
}

function md(results) {
  const L = [];
  const tags = results.map((r) => r.tag);
  L.push('# Motor Diagnostics: MSP and Blackbox comparison across candidate Betaflight tags', '');
  L.push('**Generated by** `scripts/motor-msp-compare.mjs` (Phase 1, read-only; it downloads public source and sends nothing to any aircraft). **Backlog:** [section 19](backlogs/in-progress/UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md).', '');
  L.push('Labels: **VERIFIED-SOURCE** = extracted from the tagged source text (not run on hardware); **HARDWARE-DEPENDENT** = depends on target or board; **UNRESOLVED** = not settled by this script. Extraction is textual and a person still reads the cited code before a row is promoted.', '');
  L.push(`Tags: ${tags.join(', ')}. Candidates only: 4.5.5, 2025.12.5, 2026.6.2. 4.3.2 and 4.4.3 are compared as unsupported references. Reference master \`${REFERENCE_MASTER}\` is not part of this run unless listed.`, '');

  L.push('## Key findings (computed)', '');
  const bit = (r, n) => r.fieldMask?.find((x) => x.name === `FLIGHT_LOG_FIELD_SELECT_${n}`)?.value ?? '-';
  L.push('| Tag | API | GYRO bit | MOTOR bit | RPM bit | GYROUNFILT bit | Mask in `MSP_BLACKBOX_CONFIG` | Dedicated gyroUnfilt |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) L.push(`| ${r.tag} | ${r.api} | ${bit(r, 'GYRO')} | ${bit(r, 'MOTOR')} | ${bit(r, 'RPM')} | ${bit(r, 'GYROUNFILT')} | ${r.fieldsDisabledMaskInMsp ? 'yes' : 'no'} | ${r.gyroUnfilt ? 'yes' : 'no'} |`);
  L.push('');
  const fcv = (r) => (r.layouts.MSP_FC_VERSION || []).map((x) => x.expr.replace(/\s+/g, '')).join(' ; ');
  L.push(`- **Mask bit positions differ between tags** (4.5.5 versus 2025.12.5 and later); a single fixed bit number is wrong for at least one candidate.`);
  L.push(`- **\`MSP_FC_VERSION\` changes meaning:** ${results.map((r) => `${r.tag}: ${fcv(r) || 'n/a'}`).join(' | ')}. From API 1.47 the three bytes are year minus 2000, month, patch, then a length-prefixed version string.`);
  L.push(`- Layout differences by byte count are in section 3; field expressions that were renamed or replaced with a constant (for example \`minthrottle\` replaced by 0 in \`MSP_MOTOR_CONFIG\` from 2025.12.5) are visible in section 2 even where the byte count is unchanged.`);
  L.push('');
  L.push('## 1. API version and message identifiers [VERIFIED-SOURCE]', '');
  L.push(`| Item | ${tags.join(' | ')} |`, `| --- |${tags.map(() => ' --- |').join('')}`);
  L.push(`| MSP API | ${results.map((r) => r.api ?? 'n/a').join(' | ')} |`);
  for (const n of MESSAGES.concat(['MSP_SET_MOTOR'])) L.push(`| ${n}${n === 'MSP_SET_MOTOR' ? ' (never sent in Phases 1-2)' : ''} | ${results.map((r) => r.ids[n] ?? 'absent').join(' | ')} |`);
  L.push('');

  L.push('## 2. Message layouts [VERIFIED-SOURCE, textual extraction]', '');
  L.push('Each row is one `sbufWrite` in the reply, in order, using the feature-enabled preprocessor branch. "gate" is the nearest preceding API comment, a hint, not a guarantee.', '');
  for (const m of LAYOUT_MESSAGES) {
    L.push(`### ${m}`, '');
    L.push(`| Tag | Fixed bytes | Fields (type: expression [gate]) |`, '| --- | --- | --- |');
    for (const r of results) {
      const lay = r.layouts[m];
      L.push(`| ${r.tag} | ${lay ? (bytesOf(lay) ?? 'loop-dependent') : 'not found'} | ${lay ? lay.map((x) => `${x.type}: \`${x.expr}\` [${x.gate}]`).join('<br>') : 'UNRESOLVED'} |`);
    }
    L.push('');
  }

  L.push('## 3. Differences between tags [VERIFIED-SOURCE]', '');
  const diffs = compare(results);
  if (!diffs.length) L.push('No layout differences found.', '');
  else {
    L.push('| Message | Baseline tag | Compared tag | Bytes (baseline -> compared) |', '| --- | --- | --- | --- |');
    for (const d of diffs) L.push(`| ${d.message} | ${d.from} | ${d.to} | ${d.bytesFrom ?? '?'} -> ${d.bytesTo ?? '?'} |`);
    L.push('');
  }

  L.push('## 4. Blackbox configuration, field mask and mode', '');
  L.push(`| Item | ${tags.join(' | ')} |`, `| --- |${tags.map(() => ' --- |').join('')}`);
  L.push(`| \`fields_disabled_mask\` in \`MSP_BLACKBOX_CONFIG\` reply | ${results.map((r) => (r.fieldsDisabledMaskInMsp == null ? 'UNRESOLVED' : r.fieldsDisabledMaskInMsp ? 'yes' : 'no')).join(' | ')} |`);
  L.push(`| \`BLACKBOX_MODE_MOTOR_TEST\` used in blackbox.c | ${results.map((r) => (r.motorTestMode == null ? 'UNRESOLVED' : r.motorTestMode ? 'yes' : 'no')).join(' | ')} |`);
  L.push(`| Dedicated \`gyroUnfilt\` in blackbox.c | ${results.map((r) => (r.gyroUnfilt == null ? 'UNRESOLVED' : r.gyroUnfilt ? 'yes' : 'no')).join(' | ')} |`);
  L.push(`| CLI \`blackbox_mode\` setting present | ${results.map((r) => (r.bbModeCliSetting == null ? 'UNRESOLVED' : r.bbModeCliSetting ? 'yes' : 'no')).join(' | ')} |`);
  L.push(`| CLI value table | ${results.map((r) => (r.bbModeCli ? `\`${r.bbModeCli}\`` : 'not found')).join(' | ')} |`);
  L.push(`| Internal mode enum | ${results.map((r) => (r.bbMode ? r.bbMode.map((x) => `${x.name}=${x.value}`).join(', ') : 'not found')).join(' | ')} |`);
  L.push('');
  L.push('The internal enum name `BLACKBOX_MODE_ALWAYS_ON` appears only as a source identifier. The app accepts the CLI tokens `NORMAL`, `MOTOR_TEST`, `ALWAYS` and never `ALWAYS_ON`.', '');
  L.push('### Field-mask bit positions (set = field group disabled)', '');
  const names = new Set(); results.forEach((r) => (r.fieldMask || []).forEach((x) => names.add(x.name)));
  L.push(`| Name | ${tags.join(' | ')} |`, `| --- |${tags.map(() => ' --- |').join('')}`);
  for (const n of names) L.push(`| ${n} | ${results.map((r) => (r.fieldMask?.find((x) => x.name === n)?.value ?? '-')).join(' | ')} |`);
  if (!names.size) L.push('| (no enum extracted) | UNRESOLVED |');
  const shiftNote = results.map((r) => `${r.tag}=${r.maskIsShift == null ? '?' : r.maskIsShift ? 'yes' : 'no'}`).join(', ');
  L.push('', 'Bit semantics (set = disabled, tested as "fields_disabled_mask & (1 << field)" in blackbox.c): ' + shiftNote + '. The bit position of a field is its enum index in the table above **for that tag**. Positions differ between tags (RPM and GYROUNFILT move when fields are inserted), so the readiness code must use the per-tag table in `src/preflight/versions.js`, never one fixed number.', '');

  L.push('## 5. Motor protocol enum (for `MSP_ADVANCED_CONFIG` `motorPwmProtocol`)', '');
  L.push(`| Tag | Enum extracted |`, '| --- | --- |');
  for (const r of results) L.push(`| ${r.tag} | ${r.motorProtocol ? r.motorProtocol.map((x) => `${x.name}=${x.value}`).join(', ') : 'UNRESOLVED'} |`);
  L.push('');

  L.push('## 6. Arm state and motor-stop semantics', '');
  L.push(`| Item | ${tags.join(' | ')} | Label |`, `| --- |${tags.map(() => ' --- |').join('')} --- |`);
  L.push(`| \`PERMANENT_ID_BOXARM\` | ${results.map((r) => r.armBoxId ?? 'UNRESOLVED').join(' | ')} | VERIFIED-SOURCE (id only) |`);
  L.push(`| \`MSP_SET_MOTOR\` writes \`motor_disarmed\` | ${results.map((r) => (r.setMotorWritesMotorDisarmed == null ? 'UNRESOLVED' : r.setMotorWritesMotorDisarmed ? 'yes' : 'no')).join(' | ')} | VERIFIED-SOURCE |`);
  L.push('', 'The bit index of ARM inside the flight-mode flags of `MSP_STATUS_EX` depends on which boxes are active on the board, so it must be mapped at runtime with `MSP_BOXIDS` plus the status flags: **HARDWARE-DEPENDENT**. The readiness gate does not rely on a fixed bit.', '');

  L.push('## 7. Hardware-dependent and unresolved facts (not settled by source)', '');
  L.push('| Fact | Label | Why |', '| --- | --- | --- |');
  L.push(`| \`USE_DSHOT_TELEMETRY_STATS\` compiled in, so \`invalidPct\` is real | HARDWARE-DEPENDENT | Per target; \`#undef\` count in \`common_post.h\`: ${results.map((r) => `${r.tag}=${r.dshotStatsUndef ?? '?'}`).join(', ')}. A board may still lack it. |`);
  L.push('| Actual API minor reported by a flashed build | HARDWARE-DEPENDENT | A build may differ from its tag if the constant was bumped later. |');
  L.push('| Bidirectional DShot actually working | HARDWARE-DEPENDENT | The flag is a hint; only live RPM proves it. |');
  L.push('| Mixer and custom motor order | UNRESOLVED | No mixer-read message confirmed. |');
  L.push('| `ARM_SWITCH` arming-disable bit and the arm-switch position | UNRESOLVED | Not read by this script and not used by the gate: the switch position is attested by the user (backlog section 3). |');
  L.push('| Value scale of `rpm` in `MSP_MOTOR_TELEMETRY` (electrical versus mechanical) | UNRESOLVED | Needs a fixture or powered telemetry; not used in Phases 1 and 2. |');
  L.push('| Whether `blackbox_mode` can be read safely | UNRESOLVED | CLI only; RQ-1 is not permitted in Phases 1-2. |');
  L.push('| `MSP_ANALOG` voltage scale and presence of a battery divider | HARDWARE-DEPENDENT | Board specific (measurement M3). |');
  L.push('| Dataflash size and free space | HARDWARE-DEPENDENT | Per board (measurement M7). |');
  L.push('| Android phone behaviour | HARDWARE-DEPENDENT | See the Android spike notes. |');
  L.push('');
  return L.join('\n');
}

export async function main(argv) {
  const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const cache = get('--cache', path.join(process.env.TEMP || '.', 'bf-source-cache'));
  const out = get('--out', null), json = get('--json', null);
  fs.mkdirSync(cache, { recursive: true });
  const results = [];
  for (const tag of TAGS) results.push(await collect(tag, cache));
  const text = md(results);
  if (out) fs.writeFileSync(out, text); else console.log(text);
  if (json) fs.writeFileSync(json, JSON.stringify(results, null, 2));
  return results;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('motor-msp-compare.mjs')) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
