// Scan result assembly: pure. Turns raw per-channel boundary results into the four-entry summary shown to the user and stored with an approval.
import { EXPECTED_CHANNELS } from './constants.js';
import { parseIdentity } from './identify.js';

export const SCAN_STATUS = Object.freeze({ IDENTIFIED: 'identified', PARTIAL: 'partial', UNAVAILABLE: 'unavailable', NOT_RUN: 'not-run' });
export const SCAN_NOTE = 'Retail model cannot be independently verified';
const STATES = ['identified', 'unavailable', 'mismatch', 'waiting'];
const FAMILIES = ['BLHeli_S', 'Bluejay', 'AM32'];
const key = (c) => `${c.family}|${c.version}|${c.target}`;
const blankSlot = (n) => ({ channel: n, state: 'unavailable', family: null, version: null, target: null, mcu: null, signature: null, mode: null, reason: 'not-scanned' });

// channels: raw boundary results [{channel (0-based), init, blocks, error}] (missing channels are 'not-scanned', or 'waiting' while a scan is in progress).
export function buildScanResult({ reportedCount = null, channels = null, entered = false, exit = null, error = null, now = null } = {}) {
  const raw = Array.isArray(channels) ? channels : [];
  const inProgress = !!entered && !exit && !error;
  const slots = [];
  for (let i = 0; i < EXPECTED_CHANNELS; i++) {
    const r = raw.find((x) => x && x.channel === i);
    const ch = blankSlot(i + 1);
    if (r && r.error) {
      const id = r.init && r.init.ok ? parseIdentity(r.init, {}) : null;
      Object.assign(ch, id ? { mcu: id.mcu, signature: id.signature, mode: id.mode } : {}, { reason: String(r.error).slice(0, 48) });
    } else if (r) {
      const id = parseIdentity(r.init, r.blocks || {});
      Object.assign(ch, id, { channel: i + 1 });
    } else if (inProgress) { ch.state = 'waiting'; ch.reason = null; }
    slots.push(ch);
  }
  const ident = slots.filter((c) => c.state === 'identified');
  const warnings = [];
  let consistent = null;
  if (ident.length) {
    const counts = new Map();
    for (const c of ident) counts.set(key(c), (counts.get(key(c)) || 0) + 1);
    let best = null;
    for (const c of ident) if (best === null || counts.get(key(c)) > counts.get(best)) best = key(c);
    for (const c of ident) if (key(c) !== best) { c.state = 'mismatch'; c.reason = 'differs-from-other-channels'; }
    if (counts.size > 1) {
      const fam = new Set(ident.map((c) => c.family)), ver = new Set(ident.map((c) => c.version)), tgt = new Set(ident.map((c) => c.target));
      if (fam.size > 1) warnings.push(`Motors report different ESC firmware families (${[...fam].join(', ')}).`);
      if (ver.size > 1) warnings.push(`Motors report different ESC firmware versions (${[...ver].join(', ')}).`);
      if (tgt.size > 1) warnings.push(`Motors report different ESC targets (${[...tgt].map((x) => x || 'unknown').join(', ')}).`);
    }
    consistent = ident.length === EXPECTED_CHANNELS && counts.size === 1;
  }
  const missing = slots.filter((c) => c.state === 'unavailable').map((c) => c.channel);
  if (missing.length && entered) warnings.push(`Could not read ESC identity for motor channel${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.`);
  if (Number.isInteger(reportedCount) && reportedCount !== EXPECTED_CHANNELS && entered) warnings.push(`The flight controller reported ${reportedCount} ESC channels; ${EXPECTED_CHANNELS} were expected.`);
  const ex = exit && typeof exit === 'object' ? { ok: exit.ok === true ? true : exit.ok === false ? false : null, reason: exit.reason == null ? null : String(exit.reason) } : { ok: null, reason: 'not-attempted' };
  if (ex.ok === false) warnings.push('The ESC pass-through did not confirm that it exited; the flight controller may need a power cycle.');
  const okCount = slots.filter((c) => c.state === 'identified').length;
  const mismatchCount = slots.filter((c) => c.state === 'mismatch').length;
  let status;
  if (!entered && !error && !raw.length) status = SCAN_STATUS.NOT_RUN;
  else if (okCount === EXPECTED_CHANNELS) status = SCAN_STATUS.IDENTIFIED;
  else if (okCount + mismatchCount > 0) status = SCAN_STATUS.PARTIAL;
  else status = SCAN_STATUS.UNAVAILABLE;
  return { status, expected: EXPECTED_CHANNELS, reportedCount: Number.isInteger(reportedCount) ? reportedCount : null, channels: slots, consistent, warnings, exit: ex, error: error ? String(error).slice(0, 48) : null, at: now, note: SCAN_NOTE };
}

export function compareToReference(result, referenceFamily) {
  const out = [];
  if (!result || !Array.isArray(result.channels) || !referenceFamily) return out;
  for (const c of result.channels) if (c && (c.state === 'identified' || c.state === 'mismatch') && c.family && c.family !== referenceFamily) out.push(`Motor ${c.channel} reports ${c.family}; the approval was recorded with ${referenceFamily}.`);
  return out;
}

const clip = (v, n = 24) => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, '').trim().slice(0, n) : null);
const intOr = (v) => (Number.isInteger(v) && v >= 0 && v < 1e15 ? v : null);

// Stored data is untrusted: whitelist fields, clip strings (channel fields to 24 chars, warnings to 120), at most 4 channels, no UID.
export function sanitizeEscObservation(x) {
  try {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    if (!Object.values(SCAN_STATUS).includes(x.status)) return null;
    const channels = (Array.isArray(x.channels) ? x.channels : []).slice(0, EXPECTED_CHANNELS).map((c, i) => {
      const o = c && typeof c === 'object' ? c : {};
      return {
        channel: Number.isInteger(o.channel) && o.channel >= 1 && o.channel <= EXPECTED_CHANNELS ? o.channel : i + 1,
        state: STATES.includes(o.state) ? o.state : 'unavailable',
        family: FAMILIES.includes(o.family) ? o.family : null,
        version: clip(o.version), target: clip(o.target), mcu: clip(o.mcu), signature: clip(o.signature), mode: clip(o.mode), reason: clip(o.reason),
      };
    });
    const exit = x.exit && typeof x.exit === 'object' ? { ok: x.exit.ok === true ? true : x.exit.ok === false ? false : null, reason: clip(x.exit.reason) } : { ok: null, reason: null };
    return {
      status: x.status, expected: EXPECTED_CHANNELS, reportedCount: intOr(x.reportedCount), channels,
      consistent: x.consistent === true ? true : x.consistent === false ? false : null,
      warnings: (Array.isArray(x.warnings) ? x.warnings : []).filter((w) => typeof w === 'string').slice(0, 8).map((w) => clip(w, 120)),
      exit, at: intOr(x.at), note: SCAN_NOTE,
    };
  } catch { return null; }
}
