// Motor bench test (Phase 3): the explicit owner-approved test allowlist.
// A flight controller + ESC combination may receive a NONZERO motor output only if it matches an entry exactly.
// OWNER_APPROVED is EMPTY. No real combination is approved by default and a candidate firmware is never promoted by code.
// To approve the first combination the owner supplies the identity fields in REQUIRED_FIELDS and the reviewed evidence in
// EVIDENCE_FIELDS (see the Phase 3 handoff), and a reviewed commit adds one frozen entry below. Nothing else can add an entry
// at run time.
//
// Every REAL entry carries the reviewed stop-validation evidence: proof that external 1000 was validated with the ESCs
// powered, a stable SHA-256 of the trace file that shows it, who reviewed it and when. An entry without valid evidence
// never matches. No raw flight-controller UID is stored: the digest identifies the trace file only.
//
// Synthetic entries exist only for the mock transport: they are rejected for any other transport kind, and they carry no
// evidence, so they can never satisfy the real-hardware evidence requirement.
import { STOP_EXTERNAL_VALUE } from '../preflight/constants.js';

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

// Reviewed evidence of the powered stop validation. Required on every real entry, never on a synthetic one.
export const EVIDENCE_FIELDS = Object.freeze([
  'stopValidatedOn', // calendar date (YYYY-MM-DD) the owner reviewed the evidence; not after approvedOn
  'stopValidatedBy', // owner name or handle who reviewed it
  'stopValidationTraceSha256', // 64 lowercase hex characters: SHA-256 of the exact downloaded trace file
  'externalStopValue', // number; must equal the external stop constant (1000)
  'poweredStopValidated', // boolean true: the validation included the powered ESC state (battery connected)
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
const IDENTITY_FIELDS = Object.freeze(['variant', 'firmware', 'api', 'targetName', 'boardId', 'escFamily', 'escModel', 'motorProtocol']);

// A real calendar date in YYYY-MM-DD form (2026-02-30 and 2026-13-01 are rejected).
export function isCalendarDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Returns null when valid, else the reason. A synthetic entry (synthetic: true) is identity-only and mock-only; any other
// entry is a real-hardware entry and needs the identity, the approval and every evidence field.
export function validateEntry(e) {
  if (!e || typeof e !== 'object') return 'entry is not an object';
  for (const f of REQUIRED_FIELDS) if (!nonEmpty(e[f])) return `missing ${f}`;
  if (!isCalendarDate(e.approvedOn)) return 'approvedOn must be a calendar date, YYYY-MM-DD';
  if (e.synthetic === true) return null;
  if (e.synthetic !== undefined && e.synthetic !== false) return 'synthetic must be absent, false or true';
  for (const f of EVIDENCE_FIELDS) if (e[f] === undefined || e[f] === null || e[f] === '') return `missing ${f}`;
  if (!nonEmpty(e.stopValidatedBy)) return 'stopValidatedBy must name the reviewer';
  if (!isCalendarDate(e.stopValidatedOn)) return 'stopValidatedOn must be a calendar date, YYYY-MM-DD';
  if (e.stopValidatedOn > e.approvedOn) return 'the evidence must be reviewed on or before the approval date';
  if (typeof e.stopValidationTraceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.stopValidationTraceSha256)) return 'stopValidationTraceSha256 must be 64 lowercase hex characters';
  if (e.externalStopValue !== STOP_EXTERNAL_VALUE) return `externalStopValue must be ${STOP_EXTERNAL_VALUE}`;
  if (e.poweredStopValidated !== true) return 'poweredStopValidated must be true';
  return null;
}

// identity: { variant, firmware, api, targetName, boardId, motorProtocol } read from the FC, plus { escFamily, escModel } entered by the user.
// Returns { entry } on an exact match, else { entry: null, reason }.
export function matchAllowlist(identity, transportKind, list = OWNER_APPROVED) {
  if (!identity) return { entry: null, reason: 'no identity' };
  for (const f of IDENTITY_FIELDS) {
    if (!nonEmpty(identity[f])) return { entry: null, reason: `${f} is not known` };
  }
  for (const e of list) {
    if (validateEntry(e)) continue; // a malformed entry, or a real entry without valid evidence, never matches
    if (e.synthetic === true && transportKind !== 'mock') continue; // synthetic entries are mock-only
    if (e.synthetic !== true && transportKind === 'mock') continue; // a real entry never authorizes the mock either (keeps the two worlds apart)
    if (IDENTITY_FIELDS.every((f) => e[f] === identity[f])) return { entry: e };
  }
  return { entry: null, reason: 'this combination is not on the owner-approved test allowlist (or its entry lacks valid reviewed stop-validation evidence)' };
}
