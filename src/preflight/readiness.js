// Motor diagnostics: read-only readiness gates (Phase 2). Backlog sections 3, 19, 20.
//
// Evaluates a read-only snapshot plus user attestations. It sends nothing and cannot enable any motor control:
// `eligibleForActiveTest` is ALWAYS false in this phase (no active test exists; no firmware row is "supported" yet).
// Statuses: pass | warn | fail | unknown. Unknown means "could not be established" and is treated as blocking, never as a pass.
// Hardware-unverified items say so in `hardwareUnverified`.
import { armedFromStatus, BLACKBOX_DEVICE } from './msp-codec.js';
import { READINESS, RESOLVABILITY } from './constants.js';
import { BLACKBOX_MODES_ALLOWED_FOR_BENCH, DSHOT_PROTOCOLS, PROTOCOL_NAMES, STATUS, lookupVersion, parseBlackboxModeToken } from './versions.js';

const val = (snap, n) => (snap && snap.reads && snap.reads[n] && snap.reads[n].ok ? snap.reads[n].value : null);
const gate = (id, title, status, detected, required, why, manual, extra = {}) => ({ id, title, status, detected, required, why, manual, ...extra });

export function evaluateReadiness({ snapshot, attestations = {}, transportKind = 'unknown' } = {}) {
  const gates = [];
  const api = val(snapshot, 'MSP_API_VERSION'), fv = val(snapshot, 'MSP_FC_VERSION'), variant = val(snapshot, 'MSP_FC_VARIANT');
  const mc = val(snapshot, 'MSP_MOTOR_CONFIG'), adv = val(snapshot, 'MSP_ADVANCED_CONFIG'), feat = val(snapshot, 'MSP_FEATURE_CONFIG');
  const bb = val(snapshot, 'MSP_BLACKBOX_CONFIG'), df = val(snapshot, 'MSP_DATAFLASH_SUMMARY'), sd = val(snapshot, 'MSP_SDCARD_SUMMARY');
  const st = val(snapshot, 'MSP_STATUS_EX'), boxes = val(snapshot, 'MSP_BOXIDS'), tel = val(snapshot, 'MSP_MOTOR_TELEMETRY');
  const row = fv && api ? lookupVersion(fv.text, api.text) : null;

  // 1 transport
  gates.push(gate('transport', 'Connection', transportKind === 'web-serial' ? 'pass' : transportKind === 'mock' ? 'warn' : 'unknown',
    transportKind, 'web-serial (desktop or Android Chrome) or an approved bridge', 'A supported transport must be granted by a user action.',
    transportKind === 'mock' ? 'Synthetic data: not a real aircraft.' : 'Connect over USB with a supported browser.'));

  // 2 firmware identity and allowlist
  if (!variant || !fv || !api) {
    gates.push(gate('firmware', 'Firmware', 'unknown', 'not read', 'BTFL with an allowlisted version and API', 'Unknown firmware fails closed.', 'Check the USB connection and retry.'));
  } else if (variant.variant !== 'BTFL') {
    gates.push(gate('firmware', 'Firmware', 'fail', `${variant.variant} ${fv.text} (API ${api.text})`, 'BTFL (Betaflight)', 'Only Betaflight is in scope.', 'This flight controller is not supported.'));
  } else if (row.status === STATUS.SUPPORTED) {
    gates.push(gate('firmware', 'Firmware', 'pass', `BTFL ${fv.text} (API ${api.text})`, 'allowlisted version and API pair', '', ''));
  } else if (row.status === STATUS.CANDIDATE) {
    gates.push(gate('firmware', 'Firmware', 'warn', `BTFL ${fv.text} (API ${api.text})`, 'a version marked supported', 'This version is a candidate only: no hardware check has promoted it to supported.', 'No action. This is expected until hardware checks are done.', { hardwareUnverified: true }));
  } else {
    gates.push(gate('firmware', 'Firmware', 'fail', `BTFL ${fv.text} (API ${api.text})`, 'a version on the allowlist (4.5.5, 2025.12.5, 2026.6.2 are candidates)', row.note, 'Update firmware in the Betaflight App yourself if you want this aircraft checked. UAV Companion never changes firmware.'));
  }

  // 3 motor count
  gates.push(!mc ? gate('motor-count', 'Four motors', 'unknown', 'not read', String(READINESS.requiredMotorCount), 'Only four-motor aircraft are in scope.', '')
    : gate('motor-count', 'Four motors', mc.motorCount === READINESS.requiredMotorCount ? 'pass' : 'fail', String(mc.motorCount), String(READINESS.requiredMotorCount), 'Only four-motor aircraft are in scope.', 'Use an aircraft with exactly four motors.'));

  // 4 protocol
  gates.push(!adv ? gate('protocol', 'DShot protocol', 'unknown', 'not read', 'DSHOT150, DSHOT300 or DSHOT600', 'Active testing needs DShot.', '')
    : gate('protocol', 'DShot protocol', DSHOT_PROTOCOLS[adv.motorProtocol] ? 'pass' : 'fail', PROTOCOL_NAMES[adv.motorProtocol] || `unknown (${adv.motorProtocol})`, 'DSHOT150, DSHOT300 or DSHOT600', 'Active testing needs DShot.', 'In the Betaflight App, Configuration tab, set the ESC/motor protocol to a DShot value.'));

  // 5 bidirectional DShot (flag is a hint; working RPM is proven only live)
  gates.push(!mc ? gate('bidir', 'Bidirectional DShot', 'unknown', 'not read', 'enabled, with live RPM', '', '')
    : mc.dshotTelemetry ? gate('bidir', 'Bidirectional DShot', 'warn', 'flag on', 'enabled, with live RPM', 'The flag is on. Working RPM telemetry is proven only with powered motors, which this phase never does.', 'No action in this phase.', { hardwareUnverified: true })
      : gate('bidir', 'Bidirectional DShot', 'fail', 'flag off', 'enabled, with live RPM', 'RPM telemetry is required for the active test.', 'In the Betaflight App, Configuration tab, enable Bidirectional DShot (needs compatible ESC firmware).'));

  // 6 3D off
  gates.push(!feat ? gate('3d', '3D mode off', 'unknown', 'not read', 'off', '', '')
    : gate('3d', '3D mode off', feat.threeD ? 'fail' : 'pass', feat.threeD ? 'on' : 'off', 'off', 'Reversible motors are out of scope.', 'Turn 3D mode off in the Betaflight App.'));

  // 7 arming state (read-only); the switch position cannot be read, so it is attested
  const armed = armedFromStatus(st, boxes);
  const switchOff = attestations.armSwitchOff === true;
  if (armed === null) gates.push(gate('arming', 'Disarmed', 'unknown', 'not established', 'disarmed and arm switch off', 'The armed state could not be read. Unknown fails closed.', 'Check the connection and retry.'));
  else if (armed) gates.push(gate('arming', 'Disarmed', 'fail', 'armed', 'disarmed and arm switch off', 'The aircraft is armed.', 'Switch the transmitter arm switch off.'));
  else if (!switchOff) gates.push(gate('arming', 'Disarmed', 'unknown', 'disarmed; switch not confirmed', 'disarmed and arm switch off', 'The arm switch position cannot be read from the flight controller.', 'Confirm the transmitter arm switch is off and throttle is at minimum.', { needsAttestation: 'armSwitchOff' }));
  else gates.push(gate('arming', 'Disarmed', 'warn', 'disarmed; switch off (confirmed by you)', 'disarmed and arm switch off', 'The switch position is your confirmation, not a reading.', '', { hardwareUnverified: true }));

  // 8 blackbox enabled
  if (!bb) gates.push(gate('blackbox', 'Blackbox logging', 'unknown', 'not read', 'enabled on usable storage', '', ''));
  else if (!bb.supported || bb.device === 0) gates.push(gate('blackbox', 'Blackbox logging', 'fail', !bb.supported ? 'not supported' : `device ${BLACKBOX_DEVICE[bb.device]}`, 'a logging device selected', 'The bench test is analysed from the Blackbox log.', 'In the Betaflight App, Blackbox tab, choose a logging device.'));
  else gates.push(gate('blackbox', 'Blackbox logging', 'pass', `device ${BLACKBOX_DEVICE[bb.device] || bb.device}`, 'a logging device selected', '', ''));

  // 9 blackbox mode: attestation only (not readable over MSP); ALWAYS_ON is never a token
  const rawMode = attestations.blackboxMode;
  const mode = rawMode == null ? null : parseBlackboxModeToken(rawMode);
  if (rawMode == null) gates.push(gate('bb-mode', 'Blackbox mode', 'unknown', 'not attested', 'MOTOR_TEST or ALWAYS', 'The mode cannot be read over MSP. In this phase you attest it.', 'In the Betaflight App CLI tab (not here) check blackbox_mode, or Blackbox tab on newer apps.', { needsAttestation: 'blackboxMode' }));
  else if (mode === null) gates.push(gate('bb-mode', 'Blackbox mode', 'fail', String(rawMode).slice(0, 40), 'NORMAL, MOTOR_TEST or ALWAYS (exact)', 'This is not a recognised mode token. Unknown values fail closed.', 'Use the exact values NORMAL, MOTOR_TEST or ALWAYS.'));
  else if (!BLACKBOX_MODES_ALLOWED_FOR_BENCH.includes(mode)) gates.push(gate('bb-mode', 'Blackbox mode', 'fail', mode, 'MOTOR_TEST or ALWAYS', 'NORMAL logs only while armed, so the bench test would not be recorded.', 'In the Betaflight App, set blackbox_mode to MOTOR_TEST (preferred) or ALWAYS, then save.'));
  else gates.push(gate('bb-mode', 'Blackbox mode', 'warn', `${mode} (attested)`, 'MOTOR_TEST or ALWAYS, verified', 'Attested by you, not verified by the app. Verification needs a hardware-checked read, which is not approved yet.', '', { hardwareUnverified: true }));

  // 10 field mask, per version
  if (!bb || !row) gates.push(gate('bb-fields', 'Logged signals', 'unknown', 'not read', 'gyro, motor, RPM and unfiltered gyro enabled', '', ''));
  else if (!row.maskBits) gates.push(gate('bb-fields', 'Logged signals', 'fail', `firmware ${row.firmware}`, 'a version that logs unfiltered gyro natively', 'This firmware has no dedicated unfiltered-gyro field.', 'Use a newer allowlisted firmware.'));
  else if (!bb.maskPresent || bb.fieldsDisabledMask === null) gates.push(gate('bb-fields', 'Logged signals', 'unknown', 'mask not reported', 'gyro, motor, RPM and unfiltered gyro enabled', '', ''));
  else {
    const disabled = ['GYRO', 'MOTOR', 'RPM', 'GYROUNFILT'].filter((n) => ((bb.fieldsDisabledMask >>> row.maskBits[n]) & 1) === 1);
    gates.push(disabled.length
      ? gate('bb-fields', 'Logged signals', 'fail', `disabled: ${disabled.join(', ')}`, 'GYRO, MOTOR, RPM, GYROUNFILT all enabled', 'The bench analysis needs these signals.', 'In the Betaflight App, Blackbox tab (or CLI "blackbox" list), enable them.')
      : gate('bb-fields', 'Logged signals', row.status === STATUS.SUPPORTED ? 'pass' : 'warn', 'none of the four disabled', 'GYRO, MOTOR, RPM, GYROUNFILT all enabled', 'Bit positions are per firmware version, from source, not hardware.', '', { hardwareUnverified: row.status !== STATUS.SUPPORTED }));
  }

  // 11 logged rate (estimate only; the log header is authoritative)
  if (!bb || !st || !st.cycleTimeUs) gates.push(gate('bb-rate', 'Logging rate', 'unknown', 'not established', `at least ${RESOLVABILITY.sanityFloorHz} Hz`, 'Sanity floor only. Real analysis validity is decided per window from the log.', ''));
  else {
    const hz = Math.round(1e6 / st.cycleTimeUs / Math.max(1, bb.rateDenom));
    gates.push(gate('bb-rate', 'Logging rate', hz >= RESOLVABILITY.sanityFloorHz ? 'warn' : 'fail', `about ${hz} Hz (estimate)`, `at least ${RESOLVABILITY.sanityFloorHz} Hz`, 'Estimated from the PID loop time and the Blackbox rate divider. The log header is the authority. Floor and usable-band fraction 0.8 are provisional.', 'In the Betaflight App, Blackbox tab, raise the logging rate.', { hardwareUnverified: true }));
  }

  // 12 pole count
  gates.push(!mc ? gate('poles', 'Motor poles', 'unknown', 'not read', `${READINESS.poleCountMin} to ${READINESS.poleCountMax}`, '', '')
    : gate('poles', 'Motor poles', mc.poleCount >= READINESS.poleCountMin && mc.poleCount <= READINESS.poleCountMax ? 'pass' : 'fail', String(mc.poleCount), `${READINESS.poleCountMin} to ${READINESS.poleCountMax} (provisional)`, 'RPM is converted using the pole count.', 'Set the motor pole count in the Betaflight App, Configuration tab.'));

  // 13 storage
  if (!df && !sd) gates.push(gate('storage', 'Log storage', 'unknown', 'not read', 'ready storage with free space', '', ''));
  else {
    const bbDev = bb ? bb.device : null;
    if (bbDev === 1 && df) {
      const free = df.totalBytes - df.usedBytes;
      gates.push(df.supported && df.ready && free > 0
        ? gate('storage', 'Log storage', 'warn', `dataflash ${free} of ${df.totalBytes} bytes free`, 'free space for the session', 'The space a session needs is not defined yet (measurement M6, M7).', 'If it is nearly full, download the logs and erase them in the Betaflight App yourself.', { hardwareUnverified: true })
        : gate('storage', 'Log storage', 'fail', df.supported ? (df.ready ? 'full' : 'not ready') : 'no dataflash', 'ready storage with free space', 'Blackbox cannot record without space.', 'Download the logs and erase the flash in the Betaflight App.'));
    } else if (bbDev === 2 && sd) {
      gates.push(sd.supported && sd.state === 4 && sd.freeKB > 0
        ? gate('storage', 'Log storage', 'warn', `SD card ${sd.freeKB} of ${sd.totalKB} KB free`, 'free space for the session', 'The space a session needs is not defined yet.', '', { hardwareUnverified: true })
        : gate('storage', 'Log storage', 'fail', `SD card state ${sd.state}`, 'a ready SD card with free space', 'Blackbox cannot record without a ready card.', 'Insert or fix the SD card.'));
    } else gates.push(gate('storage', 'Log storage', 'unknown', 'device and storage do not match', 'ready storage with free space', '', ''));
  }

  // 14 battery state: not provable from MSP; attested
  const an = val(snapshot, 'MSP_ANALOG');
  gates.push(attestations.batteryDisconnected === true
    ? gate('battery', 'Flight battery disconnected', 'warn', `you confirm it is disconnected (reads ${an ? (an.voltage_cV / 100).toFixed(2) : '?'} V)`, 'disconnected during setup', 'Voltage is not a reliable indicator (USB back-feed, divider scale, smoke stopper): measurement M3 is pending.', '', { hardwareUnverified: true })
    : gate('battery', 'Flight battery disconnected', 'unknown', an ? `reads ${(an.voltage_cV / 100).toFixed(2)} V` : 'not read', 'disconnected during setup', 'The battery state cannot be proven from the voltage reading.', 'Disconnect the flight battery and confirm.', { needsAttestation: 'batteryDisconnected' }));

  // 15 telemetry shape
  if (!tel || !mc) gates.push(gate('telemetry', 'Motor telemetry', 'unknown', 'not read', 'one entry per motor', '', ''));
  else if (tel.count !== mc.motorCount) gates.push(gate('telemetry', 'Motor telemetry', 'fail', `${tel.count} reported for ${mc.motorCount} motors`, 'one entry per motor', 'The telemetry shape does not match the motor count.', ''));
  else {
    const allHundred = tel.motors.length > 0 && tel.motors.every((m) => m.invalidPct_centi === 10000);
    gates.push(gate('telemetry', 'Motor telemetry', allHundred ? 'warn' : 'pass', allHundred ? 'invalidPct reads 100% on every motor' : 'invalidPct readable', 'DShot error data usable',
      allHundred ? 'This is normal at rest and on builds without DShot statistics. The app treats it as error data unavailable, not as a failing channel. Whether that is acceptable is an open owner decision.' : '', '', { hardwareUnverified: allHundred }));
  }

  const failed = gates.filter((g) => g.status === 'fail'), unknown = gates.filter((g) => g.status === 'unknown');
  const overall = failed.length ? 'blocked' : unknown.length ? 'incomplete' : 'conditional';
  return Object.freeze({
    phase: 2,
    gates,
    overall, // blocked | incomplete | conditional  (there is no "ready" in this phase)
    eligibleForActiveTest: false, // always, by design: no active test is built and no firmware row is supported
    eligibleReason: 'Active testing does not exist in this phase, and no firmware row is promoted to supported.',
    counts: { pass: gates.filter((g) => g.status === 'pass').length, warn: gates.filter((g) => g.status === 'warn').length, fail: failed.length, unknown: unknown.length },
    hardwareUnverified: gates.filter((g) => g.hardwareUnverified).map((g) => g.id),
  });
}
