# Handoff: Motor Diagnostics Phase 1 and Phase 2 (read-only)

**Status:** Active, 2026-11-16.
**Backlog (authoritative):** [UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md](../../backlogs/in-progress/UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md)
**Hazard analysis:** [MOTOR_DIAGNOSTICS_HAZARD_ANALYSIS.md](../../MOTOR_DIAGNOSTICS_HAZARD_ANALYSIS.md)

## Authorized

Documentation, Phase 1 and Phase 2 read-only code, tests, commit and push to `main`.

## Not authorized (stop if a task needs any of these)

Motor commands (`MSP_SET_MOTOR` or any nonzero motor value), CLI mode or queries, FC, ESC or Blackbox configuration writes, log erase or rewrite, the 4-way interface, reflashing, active-test simulation, Phase 3, deployment.

## Phase 1 scope

1. `scripts/motor-msp-compare.mjs`: scripted comparison across candidate tags (API/version identifiers, `MSP_MOTOR_CONFIG`, `MSP_ADVANCED_CONFIG`, `MSP_ANALOG`, Blackbox config handlers, motor-telemetry layouts, field-mask bit positions); output labels facts as automatically verified or hardware-dependent/unresolved. Result: `docs/MOTOR_DIAGNOSTICS_MSP_COMPARISON.md`.
2. `src/preflight/constants.js` (frozen provisional values), `msp-codec.js` (read-only allowlist, fail-closed parser), `transport.js` (desktop Web Serial and mock), `inventory.js` (report with manual ESC-firmware family, UID export warning).
3. Android spike harness as a separate non-shipping page; transport-only Capacitor prototype notes. No wrapper adoption.

## Phase 2 scope

`readiness.js` gates and UI states behind a build-time flag (default off, explicit non-persistent test override, no stored preference, no dashboard entry). Blackbox mode attestation is mock/read-only only. Hardware-unverified behaviour is labelled.

## Rules

Synthetic fixtures and mocked transports only. No raw logs committed. Do not weaken a safety gate to pass a test. Record unverifiable hardware results as unresolved. Run `npm run test:unit` and affected suites; update `CURRENT_STATUS.md`.

## Phase 3 blockers

Hazard analysis owner review; owner authorization; five-aircraft inventory; Android path decision; supervised hardware checks (M1 to M8, external-1000 stop per ESC family); RQ-1 decision; DShot-error-statistics decision; jitter limit.
