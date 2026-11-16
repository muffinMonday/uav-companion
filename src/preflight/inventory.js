// Motor diagnostics: read-only inventory report (Phase 1). Backlog section 18.
// Built from a read-only snapshot plus MANUAL fields. The ESC firmware family is typed by the user; it is never read
// from the ESC (the 4-way interface is not used). Nothing here is stored or uploaded; export is a file the user saves.
import { BLACKBOX_DEVICE, SD_STATE } from './msp-codec.js';
import { ESC_FIRMWARE_FAMILIES, PROTOCOL_NAMES, lookupVersion } from './versions.js';

export const INVENTORY_SCHEMA = 'uavc.motor-inventory.v1';
export const UID_WARNING = 'The board UID identifies this flight controller. Include it only if you are comfortable sharing it.';

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

export function sanitizeManual(m = {}) {
  const aircraftClass = ['5-inch', '2.5-inch', 'whoop', 'other', ''].includes(m.aircraftClass) ? m.aircraftClass : '';
  const family = ESC_FIRMWARE_FAMILIES.includes(m.escFirmwareFamily) ? m.escFirmwareFamily : 'Unknown';
  return {
    aircraftLabel: clean(m.aircraftLabel, 80),
    aircraftClass,
    notes: clean(m.notes, 500),
    escFirmwareFamily: family, // manual entry only; never read from the ESC
    escNote: clean(m.escNote, 200),
    clientPhoneModel: clean(m.clientPhoneModel, 80), // user agents hide the model; the user may type it
    clientOsVersion: clean(m.clientOsVersion, 40),
  };
}

export function collectClientInfo(nav = globalThis.navigator, transportKind = 'unknown') {
  const uad = nav && nav.userAgentData;
  return {
    userAgent: nav && typeof nav.userAgent === 'string' ? nav.userAgent.slice(0, 300) : '',
    platform: (uad && uad.platform) || (nav && nav.platform) || '',
    brands: uad && Array.isArray(uad.brands) ? uad.brands.map((b) => `${b.brand} ${b.version}`) : [],
    mobile: uad ? !!uad.mobile : null,
    webSerial: !!(nav && 'serial' in nav),
    transport: transportKind,
  };
}

const val = (snap, n) => (snap && snap.reads && snap.reads[n] && snap.reads[n].ok ? snap.reads[n].value : null);
const maskNames = (mask, bits) => (bits && mask != null ? Object.entries(bits).filter(([, b]) => ((mask >>> b) & 1) === 1).map(([n]) => n) : null);

export function buildInventory({ snapshot, manual, client, now = new Date() } = {}) {
  const api = val(snapshot, 'MSP_API_VERSION'), fv = val(snapshot, 'MSP_FC_VERSION'), variant = val(snapshot, 'MSP_FC_VARIANT');
  const board = val(snapshot, 'MSP_BOARD_INFO'), uid = val(snapshot, 'MSP_UID');
  const mc = val(snapshot, 'MSP_MOTOR_CONFIG'), adv = val(snapshot, 'MSP_ADVANCED_CONFIG');
  const bb = val(snapshot, 'MSP_BLACKBOX_CONFIG'), df = val(snapshot, 'MSP_DATAFLASH_SUMMARY'), sd = val(snapshot, 'MSP_SDCARD_SUMMARY');
  const tel = val(snapshot, 'MSP_MOTOR_TELEMETRY'), st = val(snapshot, 'MSP_STATUS_EX');
  const row = fv && api ? lookupVersion(fv.text, api.text) : null;
  const unresolved = [];
  const note = (cond, text) => { if (cond) unresolved.push(text); };
  note(!api || !fv, 'Firmware version and MSP API were not read.');
  note(!bb, 'Blackbox configuration was not read.');
  note(!tel, 'Motor telemetry was not read.');
  note(true, 'Blackbox mode (NORMAL, MOTOR_TEST, ALWAYS) is not readable over MSP; attest it manually.');
  note(true, 'Whether bidirectional DShot actually produces RPM, and whether invalidPct is usable, is proven only with powered telemetry (not in this phase).');
  note(true, 'ESC firmware family is a manual entry.');
  const invalidAll = tel && tel.motors.length ? tel.motors.every((m) => m.invalidPct_centi === 10000) : null;
  return {
    schema: INVENTORY_SCHEMA,
    createdAt: now.toISOString(),
    readOnly: true,
    identity: {
      fcVariant: variant ? variant.variant : null,
      boardId: board ? board.boardId : null,
      targetName: board ? board.targetName : null,
      mcuTypeId: board ? board.mcuTypeId : null,
      uidHex: uid ? uid.hex : null, // local only unless the user opts in at export
    },
    firmware: { version: fv ? fv.text : null, api: api ? api.text : null, allowlistStatus: row ? row.status : null, allowlistNote: row ? row.note : null },
    motors: {
      count: mc ? mc.motorCount : null,
      protocolValue: adv ? adv.motorProtocol : null,
      protocol: adv ? PROTOCOL_NAMES[adv.motorProtocol] || 'unknown' : null,
      bidirectionalDshotFlag: mc ? mc.dshotTelemetry : null,
      poleCount: mc ? mc.poleCount : null,
    },
    esc: { firmwareFamily: sanitizeManual(manual).escFirmwareFamily, note: sanitizeManual(manual).escNote, source: 'manual entry' },
    blackbox: bb ? {
      supported: bb.supported, device: BLACKBOX_DEVICE[bb.device] || `unknown(${bb.device})`, rateDenom: bb.rateDenom, pRatio: bb.pRatio, sampleRate: bb.sampleRate,
      pidLoopHzEstimate: st && st.cycleTimeUs ? Math.round(1e6 / st.cycleTimeUs) : null,
      fieldsDisabledMask: bb.fieldsDisabledMask, maskPresent: bb.maskPresent,
      fieldsDisabledNames: row ? maskNames(bb.fieldsDisabledMask, row.maskBits) : null, // null when the firmware is not on the table
    } : null,
    storage: {
      dataflash: df ? { supported: df.supported, ready: df.ready, totalBytes: df.totalBytes, usedBytes: df.usedBytes } : null,
      sdcard: sd ? { supported: sd.supported, state: SD_STATE[sd.state] || `unknown(${sd.state})`, freeKB: sd.freeKB, totalKB: sd.totalKB } : null,
    },
    telemetry: tel ? {
      motorsReported: tel.count,
      fields: ['rpm', 'invalidPct', 'temperatureC', 'voltage', 'current', 'consumption'],
      invalidPctAllHundred: invalidAll,
      invalidPctUsable: invalidAll === null ? null : !invalidAll, // false/null means "cannot tell at rest"; see unresolved
    } : null,
    aircraft: { label: sanitizeManual(manual).aircraftLabel, class: sanitizeManual(manual).aircraftClass, notes: sanitizeManual(manual).notes },
    client: { ...(client || {}), phoneModel: sanitizeManual(manual).clientPhoneModel, osVersion: sanitizeManual(manual).clientOsVersion },
    unresolved,
  };
}

// Export is explicit. UID is omitted unless the caller passes includeUid:true (the UI shows UID_WARNING first).
export function exportInventoryJson(report, { includeUid = false } = {}) {
  const r = JSON.parse(JSON.stringify(report));
  if (!includeUid) { r.identity.uidHex = null; r.identity.uidOmitted = true; } else r.identity.uidWarning = UID_WARNING;
  return JSON.stringify(r, null, 2);
}

export function exportInventoryMarkdown(report, { includeUid = false } = {}) {
  const r = JSON.parse(exportInventoryJson(report, { includeUid }));
  const line = (k, v) => `| ${k} | ${v === null || v === undefined || v === '' ? 'not read' : v} |`;
  return [
    `# Aircraft inventory (read-only)`, '',
    `Created ${r.createdAt}. Hardware-unverified until a supervised check. Nothing was written to the aircraft.`, '',
    includeUid ? `> ${UID_WARNING}` : '> The board UID was left out of this export.', '',
    '| Item | Value |', '| --- | --- |',
    line('Aircraft', r.aircraft.label), line('Class', r.aircraft.class),
    line('FC variant', r.identity.fcVariant), line('Board / target', [r.identity.boardId, r.identity.targetName].filter(Boolean).join(' / ')), line('MCU type id', r.identity.mcuTypeId),
    ...(includeUid ? [line('UID', r.identity.uidHex)] : []),
    line('Firmware', r.firmware.version), line('MSP API', r.firmware.api), line('Allowlist status', r.firmware.allowlistStatus),
    line('Motors', r.motors.count), line('Protocol', r.motors.protocol), line('Bidirectional DShot flag', r.motors.bidirectionalDshotFlag), line('Pole count', r.motors.poleCount),
    line('ESC firmware family (manual)', r.esc.firmwareFamily),
    line('Blackbox device', r.blackbox && r.blackbox.device), line('Blackbox rate denominator', r.blackbox && r.blackbox.rateDenom), line('Disabled field groups', r.blackbox && r.blackbox.fieldsDisabledNames && (r.blackbox.fieldsDisabledNames.join(', ') || 'none of the tracked groups')),
    line('Dataflash total / used (bytes)', r.storage.dataflash && `${r.storage.dataflash.totalBytes} / ${r.storage.dataflash.usedBytes}`),
    line('SD card', r.storage.sdcard && `${r.storage.sdcard.state}, ${r.storage.sdcard.totalKB} KB total`),
    line('Telemetry motors reported', r.telemetry && r.telemetry.motorsReported),
    line('invalidPct usable', r.telemetry && (r.telemetry.invalidPctUsable === null ? 'unknown' : r.telemetry.invalidPctUsable)),
    line('Client', [r.client.phoneModel, r.client.osVersion, r.client.platform, (r.client.brands || []).join(', '), r.client.transport].filter(Boolean).join(' | ')),
    '', '## Unresolved', '', ...r.unresolved.map((u) => `- ${u}`), '',
  ].join('\n');
}

// ---- five-aircraft inventory structure (backlog section 18). In memory only: the app stores nothing.
export const FLEET_SIZE = 5;

export function newFleet() {
  return { schema: 'uavc.motor-fleet.v1', slots: Array.from({ length: FLEET_SIZE }, (_, i) => ({ slot: i + 1, label: '', report: null })) };
}

export function setFleetSlot(fleet, slot, report) {
  if (!Number.isInteger(slot) || slot < 1 || slot > FLEET_SIZE) throw new RangeError(`slot must be 1 to ${FLEET_SIZE}`);
  if (!report || report.schema !== INVENTORY_SCHEMA) throw new TypeError('not an inventory report');
  const slots = fleet.slots.map((s) => (s.slot === slot ? { slot, label: report.aircraft.label || s.label, report } : s));
  return { ...fleet, slots };
}

// Hardware data still missing for a slot. Every entry is something only a real connection or a person can supply.
export function outstandingForSlot(s) {
  if (!s.report) return ['everything: aircraft not connected yet'];
  const r = s.report, miss = [];
  if (!r.firmware.version || !r.firmware.api) miss.push('firmware version and MSP API');
  if (!r.identity.targetName && !r.identity.boardId) miss.push('board / target');
  if (r.identity.mcuTypeId === null) miss.push('MCU type');
  if (!r.motors.count) miss.push('motor count, protocol, pole count');
  if (!r.blackbox) miss.push('Blackbox configuration');
  if (!(r.storage.dataflash || r.storage.sdcard)) miss.push('storage type and size');
  if (!r.telemetry) miss.push('motor telemetry fields');
  if (r.esc.firmwareFamily === 'Unknown') miss.push('ESC firmware family (manual)');
  if (!r.client.phoneModel && !(r.client.platform || '').match(/win|mac|linux|chrome/i)) miss.push('client device');
  return miss;
}

export function fleetSummary(fleet) {
  return fleet.slots.map((s) => ({ slot: s.slot, label: s.label || '(unnamed)', collected: !!s.report, firmware: s.report ? `${s.report.firmware.version || '?'} (API ${s.report.firmware.api || '?'})` : null, allowlist: s.report ? s.report.firmware.allowlistStatus : null, outstanding: outstandingForSlot(s) }));
}
