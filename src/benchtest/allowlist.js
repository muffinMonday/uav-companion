// Motor bench test (Phase 3): the explicit owner-approved test allowlist.
// A flight controller + ESC combination may receive a NONZERO motor output only if it matches an entry exactly.
// OWNER_APPROVED is EMPTY. No real combination is approved by default and a candidate firmware is never promoted by code.
// To approve the first combination the owner supplies the identity fields in REQUIRED_FIELDS (see the Phase 3 handoff),
// and a reviewed commit adds one frozen entry below. Nothing else can add an entry at run time.
//
// Synthetic entries exist only for the mock transport: they are rejected for any other transport kind.

export const REQUIRED_FIELDS = Object.freeze([
  'variant', // MSP_FC_VARIANT, e.g. "BTFL"
  'firmware', // MSP_FC_VERSION text, e.g. "2025.12.5"
  'api', // MSP_API_VERSION text, e.g. "1.47"
  'targetName', // MSP_BOARD_INFO target name
  'boardId', // MSP_BOARD_INFO four-letter board id
  'escFamily', // manual entry: BLHeli_S, Bluejay, BLHeli_32, AM32, ...
  'escModel', // manual entry: ESC hardware/firmware version, as printed or read in a configurator
  'motorProtocol', // DSHOT150 | DSHOT300 | DSHOT600
  'approvedBy', // owner name or handle
  'approvedOn', // calendar date, YYYY-MM-DD
]);

export const OWNER_APPROVED = Object.freeze([]); // intentionally empty

// For the mock transport only (synthetic aircraft of src/preflight/mock-fc.js and src/benchtest/mock-bench-fc.js).
export const SYNTHETIC_ALLOWLIST = Object.freeze([
  Object.freeze({
    synthetic: true, variant: 'BTFL', firmware: '2025.12.5', api: '1.47', targetName: 'SYNTH', boardId: 'SYN1',
    escFamily: 'Bluejay', escModel: 'synthetic', motorProtocol: 'DSHOT600', approvedBy: 'synthetic fixture', approvedOn: '2026-11-16',
  }),
]);

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

// Returns null when valid, else the reason.
export function validateEntry(e) {
  if (!e || typeof e !== 'object') return 'entry is not an object';
  for (const f of REQUIRED_FIELDS) if (!nonEmpty(e[f])) return `missing ${f}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.approvedOn)) return 'approvedOn must be YYYY-MM-DD';
  return null;
}

// identity: { variant, firmware, api, targetName, boardId, motorProtocol } read from the FC, plus { escFamily, escModel } entered by the user.
// Returns { entry } on an exact match, else { entry: null, reason }.
export function matchAllowlist(identity, transportKind, list = OWNER_APPROVED) {
  if (!identity) return { entry: null, reason: 'no identity' };
  for (const f of ['variant', 'firmware', 'api', 'targetName', 'boardId', 'escFamily', 'escModel', 'motorProtocol']) {
    if (!nonEmpty(identity[f])) return { entry: null, reason: `${f} is not known` };
  }
  for (const e of list) {
    if (validateEntry(e)) continue; // a malformed entry never matches
    if (e.synthetic === true && transportKind !== 'mock') continue; // synthetic entries are mock-only
    if (e.synthetic !== true && transportKind === 'mock') continue; // a real entry never authorizes the mock either (keeps the two worlds apart)
    if (['variant', 'firmware', 'api', 'targetName', 'boardId', 'escFamily', 'escModel', 'motorProtocol'].every((f) => e[f] === identity[f])) return { entry: e };
  }
  return { entry: null, reason: 'this combination is not on the owner-approved test allowlist' };
}
