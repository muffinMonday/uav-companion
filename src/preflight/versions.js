// Motor diagnostics: firmware allowlist as data. Backlog section 19.
// The allowlist is by EXACT firmware version and MSP API pair. No row is "supported" yet:
// candidates need the five-aircraft inventory and a supervised hardware check first.
//
// Field-mask bit positions come from scripts/motor-msp-compare.mjs (docs/MOTOR_DIAGNOSTICS_MSP_COMPARISON.md),
// read from each tag's source, NOT from hardware. They differ between tags (4.5.5 vs 2025.12.5 and later),
// so the readiness code must always look them up by version and never use one fixed number.
export const STATUS = Object.freeze({ SUPPORTED: 'supported', CANDIDATE: 'candidate', UNSUPPORTED: 'unsupported' });

// bit = index into blackboxConfig.fields_disabled_mask; a SET bit means that field group is DISABLED.
const row = (fw, api, status, gyroUnfiltBit, bits, note) => Object.freeze({ firmware: fw, api, status, hasGyroUnfilt: gyroUnfiltBit != null, maskBits: bits ? Object.freeze(bits) : null, note });

export const VERSION_TABLE = Object.freeze([
  row('4.3.2', '1.44', STATUS.UNSUPPORTED, null, null, 'No fields_disabled_mask in MSP_BLACKBOX_CONFIG; no gyroUnfilt field (needs GYRO_SCALED debug).'),
  row('4.4.3', '1.45', STATUS.UNSUPPORTED, null, null, 'Mask present; no gyroUnfilt field (needs GYRO_SCALED debug).'),
  row('4.5.5', '1.46', STATUS.CANDIDATE, 13, { GYRO: 7, MOTOR: 10, RPM: 12, GYROUNFILT: 13 }, 'Candidate only; hardware pending.'),
  row('2025.12.5', '1.47', STATUS.CANDIDATE, 14, { GYRO: 7, MOTOR: 11, RPM: 13, GYROUNFILT: 14 }, 'Candidate only; hardware pending.'),
  row('2026.6.2', '1.48', STATUS.CANDIDATE, 14, { GYRO: 7, MOTOR: 11, RPM: 13, GYROUNFILT: 14 }, 'Candidate only; hardware pending.'),
]);

// Look up by exact pair. Anything else (other 4.5.x, pre-release, master, unknown API) is unsupported: fail closed.
export function lookupVersion(firmware, api) {
  const r = VERSION_TABLE.find((x) => x.firmware === firmware && x.api === api);
  if (r) return r;
  return Object.freeze({ firmware, api, status: STATUS.UNSUPPORTED, hasGyroUnfilt: false, maskBits: null, note: 'Not on the allowlist (exact version and API pair required).' });
}

// The CLI-compatible Blackbox mode tokens. ALWAYS_ON is the internal C enum name and is NEVER a token.
export const BLACKBOX_MODE_TOKENS = Object.freeze(['NORMAL', 'MOTOR_TEST', 'ALWAYS']);
export const BLACKBOX_MODES_ALLOWED_FOR_BENCH = Object.freeze(['MOTOR_TEST', 'ALWAYS']);

export function parseBlackboxModeToken(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  return BLACKBOX_MODE_TOKENS.includes(t) ? t : null; // case-sensitive on purpose; unknown fails closed
}

// motorProtocol values for DShot (identical across the candidate tags, per the comparison): 5, 6, 7.
export const DSHOT_PROTOCOLS = Object.freeze({ 5: 'DSHOT150', 6: 'DSHOT300', 7: 'DSHOT600' });
export const PROTOCOL_NAMES = Object.freeze({ 0: 'PWM', 1: 'ONESHOT125', 2: 'ONESHOT42', 3: 'MULTISHOT', 4: 'BRUSHED', 5: 'DSHOT150', 6: 'DSHOT300', 7: 'DSHOT600', 8: 'PROSHOT1000', 9: 'DISABLED' });

export const ESC_FIRMWARE_FAMILIES = Object.freeze(['BLHeli_S', 'Bluejay', 'BLHeli_32', 'AM32', 'BLHeli (other)', 'Other', 'Unknown']);
