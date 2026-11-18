// Motor diagnostics: the "Aircraft electronics" section (flight-controller profile and ESC identification) of a live or saved result.
// Built with el() and textContent only, from the shared production parts. Data is untrusted (a saved record): it is whitelisted by
// sanitizeElectronics() before it gets here, and every string is clipped again by el(). Wording rules: the receiver line names the
// configured wire protocol only (never a brand or model), compiled support is its own line, and an ESC firmware target is never called
// the retail model.
import { el, statusEl } from '../preflight/ui-parts.js';
import { NOT_RECORDED, RETAIL_MODEL_TEXT } from './electronics.js';
import { COMPILED_NOT_REPORTED_TEXT, RECEIVER_HARDWARE_TEXT } from '../preflight/fc-profile.js';
import { EXPECTED_POSITIONS } from './constants.js';

const val = (v) => (v === null || v === undefined || v === '' ? 'Not reported' : String(v));
const row = (dl, k, v) => dl.append(el('dt', '', k), el('dd', '', val(v)));
const STATUS_WORD = Object.freeze({ identified: 'Identified', unavailable: 'Unavailable', unsupported: 'Unsupported', 'not-recorded': 'Not recorded' });
const SCAN_WORD = Object.freeze({ identified: 'All four ESCs identified', partial: 'Some ESCs identified', unavailable: 'ESC identification unavailable', 'not-run': 'ESC identification did not run in this session' });

function fcBlock(fc) {
  const box = el('div', 'dg-fc'); box.dataset.part = 'fc';
  box.append(el('h4', 'dg-sub-title', 'Flight controller'));
  if (!fc) { box.append(el('p', 'hint', NOT_RECORDED.fc)); return box; }
  const r = fc.receiver || {};
  const dl = el('dl', 'dg-readout');
  row(dl, fc.firmwareVariantName || fc.firmwareVariant || 'Firmware', fc.firmwareVersion);
  row(dl, 'Board / target', [fc.boardIdentifier, fc.targetName].filter(Boolean).join(' / ') || null);
  row(dl, 'MCU', fc.mcu);
  row(dl, 'Motor protocol', fc.motorProtocol);
  row(dl, 'Configured receiver protocol', r.configuredProtocol || (r.configuredMode ? `None (receiver mode: ${r.configuredMode})` : null));
  box.append(dl);
  const d = el('details', 'dg-details'); d.dataset.part = 'fc-details';
  d.append(el('summary', '', 'More flight controller details'));
  const dd = el('dl', 'dg-readout');
  row(dd, 'MSP API version', fc.mspApiVersion === null ? null : `${fc.mspApiVersion}${fc.mspProtocolVersion === null ? '' : ` (MSP protocol ${fc.mspProtocolVersion})`}`);
  row(dd, 'Build date and time', [fc.buildDate, fc.buildTime].filter(Boolean).join(' ') || null);
  row(dd, 'Git revision', fc.gitRevision);
  row(dd, 'Board identifier', fc.boardIdentifier);
  row(dd, 'Board name', fc.boardName);
  row(dd, 'Manufacturer', fc.manufacturer);
  row(dd, 'Hardware revision', fc.hardwareRevision);
  row(dd, 'Bidirectional DShot', fc.bidirectionalDshot === null ? null : fc.bidirectionalDshot ? 'On' : 'Off');
  row(dd, 'Motor count / poles', fc.motorCount === null && fc.motorPoles === null ? null : `${val(fc.motorCount)} motors / ${val(fc.motorPoles)} poles`);
  row(dd, 'Receiver mode', r.configuredMode);
  row(dd, 'Receiver UART', r.configuredUart || 'Not reported');
  d.append(dd);
  const rx = el('div', 'dg-receiver'); rx.dataset.part = 'receiver';
  rx.append(el('p', '', `Configured receiver protocol: ${r.configuredProtocol || 'Not reported'}${r.configuredProtocol && r.configuredProtocolKind ? ` (${r.configuredProtocolKind})` : ''}`));
  rx.append(el('p', '', r.compiledProtocolsStatus === 'reported' ? `Firmware includes receiver support for: ${(r.compiledProtocols || []).join(', ') || 'none listed'}` : (r.compiledProtocolsNote || COMPILED_NOT_REPORTED_TEXT)));
  rx.append(el('p', '', `Receiver hardware: Not independently identified` /* ${RECEIVER_HARDWARE_TEXT} */));
  rx.append(el('p', 'hint', 'A wire protocol such as CRSF does not identify the receiver brand or model.'));
  d.append(rx);
  box.append(d);
  return box;
}

function escBlock(escs) {
  const box = el('div', 'dg-escprofile'); box.dataset.part = 'escs';
  box.append(el('h4', 'dg-sub-title', 'ESCs'));
  if (!escs) { box.append(el('p', 'hint', NOT_RECORDED.esc)); return box; }
  if (escs.scanStatus === 'not-run') { box.append(el('p', 'hint', `${SCAN_WORD['not-run']}. ${NOT_RECORDED.esc}.`)); return box; }
  const same = escs.consistency === 'matching' ? 'Matching firmware on all four ESCs' : escs.consistency === 'mixed' ? 'Mixed firmware between ESCs' : 'Profile match not established';
  box.append(statusEl({ cls: escs.consistency === 'matching' ? 'ok' : escs.consistency === 'mixed' ? 'no' : 'unk', title: SCAN_WORD[escs.scanStatus] || 'ESC identification unavailable', detail: same }));
  const list = el('div', 'dg-esc-list');
  for (const c of escs.channels) {
    const d = el('details', 'dg-card'); d.dataset.escProfile = String(c.motorIndex + 1);
    const sum = el('summary');
    const fw = c.status === 'identified' ? `Firmware family: ${val(c.firmwareFamily)} · Firmware version: ${val(c.firmwareVersion)}` : `${STATUS_WORD[c.status] || 'Unavailable'}`;
    sum.append(el('strong', '', `ESC ${c.motorIndex + 1} (${EXPECTED_POSITIONS[c.motorIndex] || 'position unknown'})`), document.createTextNode(` · ${fw}`)); d.append(sum);
    const dl = el('dl', 'dg-readout');
    row(dl, 'Firmware family', c.firmwareFamily || (c.status === 'identified' ? null : STATUS_WORD[c.status]));
    row(dl, 'Firmware version', c.firmwareVersion || (c.status === 'identified' ? null : STATUS_WORD[c.status]));
    row(dl, 'Firmware target', c.firmwareTarget || 'Unavailable');
    row(dl, 'MCU/bootloader', [c.mcuFamily, c.bootloader].filter(Boolean).join(' / ') || 'Unavailable');
    if (c.evidenceSource) row(dl, 'Evidence', c.evidenceSource);
    if (c.failureReason) row(dl, 'Why not identified', c.failureReason);
    d.append(dl); list.append(d);
  }
  box.append(list);
  box.append(el('p', 'hint', `${RETAIL_MODEL_TEXT}: a firmware target is what the ESC reports about its own firmware and does not necessarily equal the retail ESC model.`));
  return box;
}

// electronics: sanitizeElectronics() output or null (a record saved before the profile existed).
export function electronicsSection(electronics, { live = true } = {}) {
  const s = el('section', 'dash-card dg-section dg-electronics'); if (live) s.id = 'bt-sec-electronics'; s.dataset.kind = 'electronics';
  s.append(el('h3', 'section-title dg-block-title', 'Aircraft electronics'));
  s.append(fcBlock(electronics ? electronics.flightController : null), escBlock(electronics ? electronics.escs : null));
  s.append(el('p', 'hint', 'Read-only: gathered from messages the flight controller answers and, when it ran, the ESC identification scan. Nothing was written, flashed or configured. No flight-controller UID or ESC serial number is read or kept.'));
  return s;
}
