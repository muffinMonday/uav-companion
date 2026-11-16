# Motor Diagnostics: Phase 3 Fault-Injection Matrix

**Status:** 2026-11-17. Maps every hazard in [MOTOR_DIAGNOSTICS_HAZARD_ANALYSIS.md](MOTOR_DIAGNOSTICS_HAZARD_ANALYSIS.md) and every abort trigger of the Phase 3 task to the automated test that exercises it and to the hardware-only check that is still missing.
**Scope:** *mock* means the synthetic flight controller (`src/benchtest/mock-bench-fc.js`) on a mocked transport with a deterministic clock. Nothing here was run against real hardware. *HW* items are unverified and are the owner's supervised checks (handoff section 8).
**Test files:** `tests/bench-machine-unit.mjs` (M), `tests/bench-boundary-unit.mjs` (B), `tests/bench-controller-unit.mjs` (C), `tests/bench-safety-unit.mjs` (S), `tests/bench-lab.mjs` (browser, L), `tests/preflight-status-unit.mjs` (N). Injection flags live in `fc.inject` of the synthetic FC.

## Hazard rows

| ID | Hazard | Injected fault (mock) | Expected result | Automated test | Remaining HW-only test |
| --- | --- | --- | --- | --- | --- |
| H1 | Unexpected rotation | Another motor reports RPM while one runs (`extraRpm`); RPM above the ceiling; RPM during zero verification; RPM while idle | Immediate fault, external 1000, lock | C "unexpected RPM"; M permission matrix | Wrong-order mixer on a bench rig; noise on the signal line |
| H1 | Wrong motor spins | User reports another position or "none" after a stop | Lock, no relabelling | C "motor position"; L position mismatch | Real mapping versus the default quad-X order |
| H1 | Nonzero outside RUNNING | Every state asked for a nonzero value | Refused in all states but RUNNING; only the selected motor; 1020 to 1100 | M "permission matrix"; B hard limits; S static rule | none |
| H2 | Propellers fitted | Checklist incomplete, short hold, untick, reload, reconnect, fault, visibility loss | Final confirmation unavailable or cleared; marker not written | C "checklist expiry"; L checklist and short press | Loaded versus unloaded RPM and current (M1) |
| H3 | Battery or smoke-stopper fault | Voltage sag on nonzero output; temperature above limit | Fault and lock | C "arming, voltage, temperature, read-back" | Smoke-stopper behaviour under a controlled load; timed physical disconnect drill |
| H4 | USB or serial loss | `disconnect()` in POWERED_ZERO_VERIFICATION, MOTOR_READY, RUNNING (nonzero), VERIFYING_STOP | LOCKED_FAULT, leading instruction **Disconnect the flight battery now.**, nothing sent, no stop claimed | C "disconnect at every powered state"; L USB loss screen | USB removal during every bench state on real boards (M5) |
| H4 | Reset when the battery connects | Disconnect after the battery is declared connected; reconnect inside and outside 15 s; wrong FC; loss before declaring; loss during grace | POWER_CONNECT_RECONNECT then re-init and zero verification, or LOCKED_FAULT | C "power-connect reconnect grace" | Real re-enumeration time per FC (M5) |
| H5 | Browser loss, suspension, frozen page | Visibility, blur, pagehide while powered | Stop attempted at once, LOCKED_FAULT; never claimed guaranteed | C "page visibility and focus" | Swipe-away, lock, shade, app switch, process kill (M8); page freeze runs no code |
| H5 | Unclean exit | Reload with the marker present; marker write failure; unverifiable write; blocked storage | UNCLEAN_EXIT_RECOVERY leads with the battery instruction; powered testing blocked when the marker cannot be verified | C "durable recovery marker"; B marker; L reload with marker | Behaviour of site-data clearing and private windows on each browser |
| H6 | Stale or absent telemetry | `telemetrySilent`, `telemetryError` in three powered states; silence during a stop | Fault within about 200 ms; stale RPM never accepted as zero; stop proof fails closed | C "stale or unavailable telemetry"; C "stop proof" | Achieved poll rate and dropout (M4) |
| H7 | Retained nonzero command | Read-back stuck; RPM frozen; stop acknowledged but ignored | Proof never completes; battery instruction; user confirmation not offered | C "acknowledgement alone is not stop proof"; C "stop semantics" | External 1000 on each ESC family on the five aircraft |
| H7 | Acknowledgement | No ack or MSP error on motor frames | One failure tolerated; two consecutive lock | B "acknowledgement"; B "two consecutive" | ACK latency on hardware (M4) |
| H8 | Arming changes | `armed` true in three powered states; unreadable or unknown arming state | Fault | C "arming..."; C "unreadable arming state" | ARM bit identification per tag |
| H9 | Unsupported or misidentified firmware | No allowlist entry; other firmware; unsupported firmware; synthetic entry on a real transport; malformed entry | No nonzero path | C "unapproved hardware"; B allowlist; C stop-validation-only | Real API minor per aircraft |
| H10 | Logging configuration | NORMAL mode, disabled fields, no device, missing attestations | Readiness policy blocks | C "unapproved hardware"; Phase 2 readiness suite | Mode gating (RQ-1) is still open |

## Abort triggers of the Phase 3 task

| Trigger | Test |
| --- | --- |
| User Stop (ramp, validation, plateau) | C "cancellation during ramp, validation and plateau"; L Stop & zero |
| Stale, invalid or unavailable RPM while powered | C "stale or unavailable telemetry" |
| Unexpected RPM from another motor | C "unexpected RPM" |
| Unexpected rotation during zero verification | C "unexpected RPM" |
| Acknowledgement failure | B "two consecutive acknowledgement failures" |
| FC-side read-back mismatch | C "arming, voltage, temperature, read-back" |
| Arming-state change | C "arming, voltage, temperature, read-back" |
| Voltage or temperature fault | C "arming, voltage, temperature, read-back" |
| USB or serial loss | C "disconnect at every powered state" |
| Reconnect outside the grace state | C "power-connect reconnect grace" |
| Visibility or focus loss while powered | C "page visibility and focus" |
| Invalid state transition | M "invalid transitions" (501 pairs); M "unknown or corrupt state" |
| Timeout | C "run-timeout" and "stop-proof timeout"; C "reconnect-grace-expired" |
| Uncaught command-path error | C "command-path exception" and "handler exception" |
| Software abort stop sequence (1000 repeated, read-back, zero RPM, user confirmation) | C "stop semantics, cadence and count"; C "stop proof" |

## Other required checks

| Requirement | Test |
| --- | --- |
| Every permitted transition | M "every permitted transition" (52 table entries driven by scenarios) |
| Rejection of every invalid transition | M "invalid transitions" |
| No command above 1100; one motor only; external 1000 semantics | B "hard limits"; B "one motor at a time"; B "exact external-1000" |
| No nonzero before all interlocks | M "single-condition failures" (21 cases) |
| Stop cadence 50 ms, at least 10 attempts | C "stop semantics, cadence and count" |
| Stop-validation-only cannot send nonzero | C "stop-validation-only"; B "stop-only permission" |
| Session unlock expires on reload, reconnect, fault | C "session unlock"; L reload removes the unlock |
| Recovery needs battery-removal confirmation | C "recovery needs battery-removal confirmation"; L recovery flow |
| No production or app entry exposes active controls | S "no entry point"; L flag-off and app pages |
| Existing read-only lab free of motor-command code | `tests/preflight-safety-unit.mjs` (unchanged rules for `src/preflight` and `tools/preflight-spike`); S "read-only lab does not reference the bench"; L read-only lab has no control |
| One module may name or build the motor message | S "MSP_SET_MOTOR ... only in motor-control.js" (three mutation checks were run by hand: a stray name, a raw `_write`, a stray send call each fail the test) |
| Successful reconnect clears an earlier `NetworkError` | N (`tests/preflight-status-unit.mjs`) |

## Not covered by software (unchanged)

The battery plug is the only guaranteed emergency action. A frozen, crashed or terminated page runs no JavaScript. An operator who ignores the screen, a mechanical motor failure and ESC or battery thermal events remain physical hazards.
