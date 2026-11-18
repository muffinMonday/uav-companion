// Motor diagnostics: the versioned "aircraft electronics" block of a result (flight-controller profile + ESC profiles).
// Pure. The FC part comes from src/preflight/fc-profile.js; the ESC part is a normalized view of the read-only 4-way scan result
// (src/fourway/scan-result.js). Nothing here carries a raw FC UID, an ESC serial number or any other stable unique hardware identifier.
// A firmware target is what the ESC reports about its own firmware: it is NOT the retail model, and no model is ever guessed.
import { buildFcProfile, sanitizeFcProfile } from '../preflight/fc-profile.js';

export const ELECTRONICS_SCHEMA_VERSION = 1;
export const RETAIL_MODEL_TEXT = 'Retail model not independently verifiable';
export const ESC_EVIDENCE = '4-way interface read (identification and settings block), read-only';
export const NOT_RECORDED = Object.freeze({ fc: 'FC profile not recorded', esc: 'ESC identification not recorded' });

const BOOTLOADER = Object.freeze({ silabs: 'SiLabs bootloader', atmel: 'Atmel bootloader', stk500: 'STK500 bootloader', arm: 'ARM bootloader' });
const REASONS = Object.freeze({
  'not-scanned': 'This channel was not scanned.', 'no-data': 'No data was returned.', 'short-read': 'The ESC returned too little data.', 'settings-blank': 'The settings area is blank.',
  'family-not-recognised': 'The firmware family was not recognised.', 'unsupported-interface': 'This ESC interface is not supported for identification.', 'parse-error': 'The data could not be read.',
  'no-init': 'The ESC did not answer.', aborted: 'The scan was stopped.', 'overall-timeout': 'The scan ran out of time.', 'differs-from-other-channels': 'Differs from the other channels.',
});
const ARM_NOTE = 'ARM bootloader detected. The firmware family and version are not decoded for this ESC type (the BLHeli_32 settings layout is not verified, so nothing is guessed).';
const clip = (v, n = 24) => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, '').trim().slice(0, n) || null : null);

function channelProfile(c, i) {
  const idx = Number.isInteger(c && c.channel) ? c.channel - 1 : i;
  const identified = c && (c.state === 'identified' || c.state === 'mismatch');
  const arm = c && c.mode === 'arm';
  let status;
  if (identified) status = 'identified';
  else if (!c || c.state === 'waiting') status = 'not-recorded';
  else if (c.reason === 'family-not-recognised' || c.reason === 'unsupported-interface') status = 'unsupported';
  else status = 'unavailable';
  let failureReason = null;
  if (!identified && status !== 'not-recorded') failureReason = arm && c.reason === 'family-not-recognised' ? ARM_NOTE : REASONS[c.reason] || clip(c.reason, 60);
  return {
    motorIndex: idx >= 0 && idx < 4 ? idx : i, status,
    firmwareFamily: identified ? clip(c.family) : null, firmwareVersion: identified ? clip(c.version) : null, firmwareTarget: identified ? clip(c.target) : null,
    mcuFamily: c ? clip(c.mcu) : null, mcuSignature: c ? clip(c.signature, 8) : null, bootloader: c && c.mode ? BOOTLOADER[c.mode] || 'Unknown' : null,
    evidenceSource: identified || (c && c.mode) ? ESC_EVIDENCE : null, failureReason,
  };
}

// scan: a scan result (or sanitized observation) or null when no scan ran.
export function buildEscProfile(scan) {
  if (!scan || typeof scan !== 'object' || scan.status === 'not-run' || !Array.isArray(scan.channels)) return { scanStatus: 'not-run', consistency: 'unknown', channels: [], retailModel: RETAIL_MODEL_TEXT };
  const channels = [0, 1, 2, 3].map((i) => channelProfile(scan.channels.find((c) => c && c.channel === i + 1) || null, i));
  const ident = channels.filter((c) => c.status === 'identified');
  const mixed = scan.channels.some((x) => x && x.state === 'mismatch') || (ident.length === 4 && scan.consistent === false);
  return { scanStatus: ['identified', 'partial', 'unavailable'].includes(scan.status) ? scan.status : 'unavailable', consistency: mixed ? 'mixed' : ident.length === 4 && scan.consistent === true ? 'matching' : 'unknown', channels, retailModel: RETAIL_MODEL_TEXT };
}

export function sanitizeEscProfile(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const st = ['identified', 'unavailable', 'unsupported', 'not-recorded'];
  const channels = (Array.isArray(x.channels) ? x.channels : []).slice(0, 4).map((c, i) => {
    const o = c && typeof c === 'object' ? c : {};
    return {
      motorIndex: Number.isInteger(o.motorIndex) && o.motorIndex >= 0 && o.motorIndex < 4 ? o.motorIndex : i, status: st.includes(o.status) ? o.status : 'unavailable',
      firmwareFamily: clip(o.firmwareFamily), firmwareVersion: clip(o.firmwareVersion), firmwareTarget: clip(o.firmwareTarget), mcuFamily: clip(o.mcuFamily), mcuSignature: clip(o.mcuSignature, 8),
      bootloader: clip(o.bootloader), evidenceSource: clip(o.evidenceSource, 100), failureReason: clip(o.failureReason, 240),
    };
  });
  return { scanStatus: ['identified', 'partial', 'unavailable', 'not-run'].includes(x.scanStatus) ? x.scanStatus : 'not-run', consistency: ['matching', 'mixed', 'unknown'].includes(x.consistency) ? x.consistency : 'unknown', channels, retailModel: RETAIL_MODEL_TEXT };
}

export function buildAircraftElectronics({ snapshot, scan }) {
  return { schemaVersion: ELECTRONICS_SCHEMA_VERSION, flightController: buildFcProfile(snapshot), escs: buildEscProfile(scan) };
}

// Stored or exported data is untrusted: returns null when nothing usable is there (an older record), otherwise a whitelisted copy.
export function sanitizeElectronics(x) {
  try {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const flightController = sanitizeFcProfile(x.flightController);
    const escs = sanitizeEscProfile(x.escs);
    if (!flightController && !escs) return null;
    return { schemaVersion: ELECTRONICS_SCHEMA_VERSION, flightController, escs };
  } catch { return null; }
}
