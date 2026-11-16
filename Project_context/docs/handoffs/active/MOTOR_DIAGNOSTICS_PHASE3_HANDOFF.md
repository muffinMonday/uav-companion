# Handoff: Motor Diagnostics Phase 3 (developer bench prototype)

**Status:** Active, 2026-11-17. The Phase 3 prototype is **implemented, mock-tested and deployed only as an isolated developer lab**. It is **not hardware-validated**, **no real motor command has ever been issued**, **no FC/ESC combination is approved for nonzero testing**, and **Phase 4 has not started**. Passing mock tests and deployment checks do not make Phase 3 complete for release.
**Backlog (authoritative):** [UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md](../../backlogs/in-progress/UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md)
**Hazard analysis:** [MOTOR_DIAGNOSTICS_HAZARD_ANALYSIS.md](../../MOTOR_DIAGNOSTICS_HAZARD_ANALYSIS.md) · **Fault-injection matrix:** [MOTOR_DIAGNOSTICS_FAULT_INJECTION_MATRIX.md](../../MOTOR_DIAGNOSTICS_FAULT_INJECTION_MATRIX.md)
**Earlier handoff:** [MOTOR_DIAGNOSTICS_PHASE1_2_HANDOFF.md](MOTOR_DIAGNOSTICS_PHASE1_2_HANDOFF.md) (read-only phases, still accurate for them)

## 1. What exists

| Piece | Where | Notes |
| --- | --- | --- |
| Safety state machine (the single authority) | `src/benchtest/state-machine.js` | Pure, no I/O. States, transitions, fault detection, motor permission, marker-clear rules, `capabilities()` for the UI |
| Guarded motor-command boundary | `src/benchtest/motor-control.js` | The only module that builds or names the motor-command message |
| Controller | `src/benchtest/controller.js` | Reports facts to the machine, executes its effects (stop, sweep, clear marker). Decides nothing |
| Interlock rules | `src/benchtest/interlocks.js` | Phase 3 readiness policy and the start interlocks (pure) |
| Allowlist | `src/benchtest/allowlist.js` | `OWNER_APPROVED` is **empty**. `SYNTHETIC_ALLOWLIST` works only for the mock transport |
| Recovery marker | `src/benchtest/recovery-marker.js` | Only module touching browser storage (`uavzones.benchtest.unclean.v1`) |
| Constants | `src/benchtest/constants.js` | All provisional values, frozen. Shared timings come from `src/preflight/constants.js` |
| Flag | `src/benchtest/flag.js` | `VITE_BENCH_PHASE3=1`, default off, not a stored preference |
| Synthetic FC with fault injection | `src/benchtest/mock-bench-fc.js` | Accepts motor frames; models RPM; `fc.inject` flags |
| UI | `src/benchtest/bench-ui.js`, `tools/motor-bench-lab/{index.html,lab.js}` | Reads `capabilities()` only |
| Stale-message fix | `src/preflight/session-status.js`, `tools/preflight-spike/spike.js` | Read-only lab: a new read clears the old transport message; a late close of an old transport is ignored |

Reused unchanged: `src/preflight/{transport,msp-codec,session,readiness,versions,inventory}.js`. `transport.write()` still refuses every non-read frame; the boundary uses the transport's protected `_write` and is the only caller (static test).

## 2. State machine

States: `DISCONNECTED`, `READ_ONLY_READINESS`, `STOP_VALIDATION_ONLY`, `SAFE_STATE_INIT`, `SAFETY_CHECKLIST`, `READY_TO_CONNECT_POWER`, `POWER_CONNECT_RECONNECT`, `POWERED_ZERO_VERIFICATION`, `MOTOR_READY`, `RUNNING`, `VERIFYING_STOP`, `LOCKED_FAULT`, `BATTERY_REMOVAL_RECOVERY`, `UNCLEAN_EXIT_RECOVERY`, `BENCH_COMPLETE`.

Main path: `DISCONNECTED` -> (CONNECT) `READ_ONLY_READINESS` -> (READINESS_OK: gates + allowlist + unlock) `SAFE_STATE_INIT` -> (SAFE_STATE_DONE: external 1000 acknowledged and read back) `SAFETY_CHECKLIST` -> (CHECKLIST_COMPLETE: all items, final hold, marker written and verified) `READY_TO_CONNECT_POWER` -> (BATTERY_DECLARED then ESC_READY after 5 s) `POWERED_ZERO_VERIFICATION` -> (3 s and 60 samples of zero RPM) `MOTOR_READY` -> (START_HOLD_COMPLETE: every interlock) `RUNNING` -> (RUN_COMPLETE) `VERIFYING_STOP` -> (stop proof, user confirmation, position match) `MOTOR_READY`; FINISH_BENCH goes through `VERIFYING_STOP` to `BENCH_COMPLETE`, where battery-removal confirmation clears the marker.

Side paths: `READ_ONLY_READINESS` -> `STOP_VALIDATION_ONLY` (needs readiness, no allowlist entry; can send external 1000 only; permission ceiling 1000). A USB reset after the battery was declared goes to `POWER_CONNECT_RECONNECT` (15 s, no nonzero output, repeat safe state). Any fault enters `LOCKED_FAULT`, then `BATTERY_REMOVAL_RECOVERY` (battery removal, fresh FC session, full stop proof) then `DISCONNECTED`. A retained marker at load starts in `UNCLEAN_EXIT_RECOVERY`.

Fail closed: unknown state, unknown event, invalid transition (501 pairs tested), guard failure in an energised-capable state, and any handler exception lock the session. Unknown or corrupt state grants nothing, not even a stop.

## 3. Guarded motor-command boundary

`MSP_SET_MOTOR` (id 214), its frame builder and the boundary class are named only in `src/benchtest/motor-control.js` (the offline Phase 1 analysis script `scripts/motor-msp-compare.mjs` names it in text only and imports no transport). `tests/bench-safety-unit.mjs` fails if the name, the number 214 in `src/` or `tools/`, a raw `._write(` call, a `sendOutput`/`sendStop` call or an import of the module appears anywhere else. `tests/preflight-safety-unit.mjs` is unchanged in force for `src/preflight` and `tools/preflight-spike` (no motor-command code there at all); two scoping edits were needed: its "no app file references the diagnostics" scan now skips `src/benchtest` (which imports `../preflight` by design; the new static test covers it with stricter rules), and its vite-input assertion lists both lab pages.

Every frame passes: (1) the machine's permission, (2) the boundary's own limits (integers; exactly 1000 or 1020 to 1100), (3) one motor (all other slots 1000), (4) the permission's ceiling.

## 4. Safety constants (all provisional, frozen, unmeasured)

External stop 1000; start 1020; step 5; dwell 400 ms (allowed 300 to 500); cap 1100; candidate validation 1 s; plateau threshold + 15 (allowed 15 to 20), at most 2 s; one motor; telemetry 25 Hz (40 ms); stale 200 ms; ack timeout 150 ms, two consecutive failures fault; stop 1000 every 50 ms, at least 10 attempts; reconnect grace 15 s; ESC-ready wait 5 s; powered-zero 3 s and 60 samples. Added here and also provisional: hold 1 s; stop-proof zero RPM 1 s; stop-proof timeout 10 s; run timeout 60 s; minimum gap between sweeps 5 s (Blackbox shutdown); arming status poll 250 ms and stale after 750 ms; read-back tolerance 2 on nonzero values (stop must read back exactly 1000); RPM plausibility ceiling 12000; ESC temperature limit 85 C; voltage sag limit 3.00 V from the powered-zero baseline.

## 5. Interlocks (all must hold before any nonzero output)

Exact allowlist entry; readiness gates with no "Blocked" or "Not confirmed"; exactly four motors; non-3D DShot; bidirectional DShot flag on; telemetry shape; Blackbox gates and attestations; disarmed (explicit false) with the arm switch attested off; fresh checklist and final hold; marker verified; USB-only safe state done; powered-zero done; one motor selected; physical motor confirmed; fresh valid telemetry; every RPM zero; 5 s since the last sweep; transport available; no fault; for real hardware the session unlock. A refused start is not a fault and sends nothing.

## 6. Abort and recovery

Triggers (all tested in mock): user Stop; stale, invalid or unavailable RPM while powered; RPM on another motor; rotation during zero verification or idle; two acknowledgement failures; read-back mismatch or missing; arming change or unreadable; voltage or temperature; USB loss; reconnect outside the grace state; visibility, blur, pagehide or freeze while powered; invalid transition; timeouts; uncaught errors. On abort with transport: first external 1000 is sent synchronously in the Stop action, then every 50 ms (at least 10); FC read-back 1000 on all four; valid RPM zero for 1 s; user confirmation. Read-back and acknowledgement never count as stop proof by themselves. Without transport the screen leads with **Disconnect the flight battery now.** and never claims a stop. The marker clears only when the full proof and battery-removal confirmation are done.

## 7. Tests

Run `npm run test:unit` (new: `preflight-status-unit`, `bench-machine-unit`, `bench-boundary-unit`, `bench-controller-unit`, `bench-safety-unit`) and `node tests/run.mjs bench-lab preflight-lab` (browser; each starts its own Vite servers; `bench-lab` takes about 2 minutes because the synthetic run uses real timers). The matrix mapping hazards to tests is in the fault-injection matrix document. Build checks: `vite build` without the flag has no bench page and no bench code in `dist`; with `VITE_BENCH_PHASE3=1` the page and one chunk appear.

## 8. Proposed supervised hardware procedure (for the owner; none of this has been done)

Not authorized to the assistant. Run only by the owner, with every step recorded. Stop at the first surprise and keep the trace (`Download trace` button).

**Stage 0: identity (read-only, no battery).** With the existing read-only lab, read the FC and note: variant, firmware version text, API version, board target name, board id, motor count, protocol, bidirectional flag, pole count. Read the ESC family and version in the ESC configurator (manual entry).

**Stage 1: stop validation only (no allowlist entry needed).** Propellers removed. On the live bench lab: connect the real FC, set the three confirmations and ESC fields, unlock, press "Stop validation only".
1. USB only, battery disconnected. Record whether the FC read-back is exactly 1000 and whether the proof completes (this checks that `MSP_MOTOR` reports external values, which is unverified). Record RPM telemetry shape with unpowered ESCs.
2. Repeat with the smoke stopper and battery connected, arm switch off, hands off the sticks. Record whether the FC resets at battery connection and how long it takes to re-enumerate (M5). If the lab locks, that is information, not a failure of the test.
3. Report back: trace JSON, whether each of the four proof parts completed, poll rate impression, anything that moved.

**Stage 2: approve the first combination.** The owner gives the identity fields in section 9; a reviewed commit adds one frozen entry to `OWNER_APPROVED`; the lab is redeployed. Until then no nonzero path exists.

**Stage 3: first supervised nonzero test (separate owner decision).** Conditions: propellers removed (count them), aircraft clamped on a nonconductive bench, smoke stopper installed, battery plug within reach of the owner's hand, a second person within earshot, nothing loose near the motors. Order: (a) one motor; watch the highlighted position; hold-to-start; let the ramp run to rotation and the plateau; check the position confirmation; (b) press Stop & zero during the ramp once and confirm the stop proof; (c) a timed physical battery disconnection drill at the lowest rotating step; (d) USB removal at the lowest rotating step with a hand on the battery plug (highest risk; last, one motor only); (e) repeat for each motor once after a pause; (f) finish the bench session. Record start threshold per motor (M2), RPM per step (M1), achieved telemetry rate and `invalidPct` (M4), re-enumeration time (M5), Blackbox segments (M6). Never raise the cap.

## 9. Identity needed for the first allowlist entry

All ten fields of `REQUIRED_FIELDS` in `src/benchtest/allowlist.js`: `variant` (e.g. BTFL), `firmware` (as the lab shows it, e.g. 2025.12.5), `api` (e.g. 1.47), `targetName` and `boardId` (from `MSP_BOARD_INFO`; the read-only lab inventory shows them), `escFamily` (BLHeli_S, Bluejay, BLHeli_32, AM32, ...), `escModel` (ESC model and firmware version string), `motorProtocol` (DSHOT150, DSHOT300 or DSHOT600), `approvedBy`, `approvedOn` (YYYY-MM-DD). Matching is exact on the first eight. Also record the aircraft (motor count 4, bidirectional DShot on, Blackbox device and mode) so the readiness gates can pass. A candidate firmware stays "candidate" in `versions.js`; the entry authorizes one tested combination only.

## 10. Deployment and rollback

**Deployed 2026-11-17 (isolated lab only):** https://uavcompanion.com/tools/motor-bench-lab/ . Source commit `96b9187` on `main`. Published with both flags on so the existing read-only lab stays live: `VITE_PREFLIGHT_DIAGNOSTICS=1 VITE_BENCH_PHASE3=1 node scripts/deploy-live.js` (PowerShell: set both with `$env:`, run, then remove them). gh-pages `3b6d919` -> `933dd9e`. `CNAME` (`uavcompanion.com`) kept; the main app, data regions (preflight: 8 regions, none added or removed) and custom domain are unchanged.

**Rollback revision:** gh-pages `3b6d91987986d1b8905b37aa9ca29f4703b24a70` (the previous live site: read-only lab only, no bench route).
- Preferred rollback: redeploy from `main` **without** the Phase 3 flag: `VITE_PREFLIGHT_DIAGNOSTICS=1 node scripts/deploy-live.js`. The build then has no bench page at all (the page is a Vite input only when `VITE_BENCH_PHASE3=1`), so `/tools/motor-bench-lab/` returns 404. No code change needed.
- Hard rollback to the exact previous site: `git push --force origin 3b6d91987986d1b8905b37aa9ca29f4703b24a70:gh-pages` (overwrites the publish branch; owner decision).
- If publishing fails with "Permission denied" on `data/places/`, delete `node_modules/.cache/gh-pages` (a disposable clone) and retry (see the Phase 1 and 2 handoff).

**Live verification (synthetic only, headless; a canned in-page fake serial port stood in for a device, so no real hardware was touched):** main app 200 and renders, no Phase 3 control, text or link; read-only lab 200, 15 gate rows, no motor control; bench route 200, `noindex`, synthetic and read-only by default, no active control before a connection; a full synthetic workflow (checklist, power, zero verification, one motor with stop proof and position confirmation, USB-loss fault screen) ran; real mode starts locked, the unlock disappears on reload, no nonzero path exists after the unlock, and no motor frame was written; no console errors. The script was a one-off outside the repo; `tests/bench-lab.mjs` covers the same checks against local servers.

**Build facts:** without the flag a production build has no `tools/motor-bench-lab` and no bench code anywhere in `dist` (checked by searching the built files); with the flag the page and its own chunks appear and the main bundle holds none of the bench text.

**Tests before deploy:** `npm run test:unit` all pass; the full `npm test` (157 suites: 80 unit, 77 browser) passed in 816 s with the app on :5173, including `preflight-lab` (31) and `bench-lab` (61 checks in that run). Six keyboard and switch-access checks were added to `bench-lab` afterwards; it was re-run alone (67 pass, no console errors).

## 11. Known limitations and open decisions

- Everything is synthetic-tested. Real `MSP_MOTOR` read-back semantics (external versus internal values), the scale of `rpm` in `MSP_MOTOR_TELEMETRY`, USB behaviour at battery connection and the real ESC response to external 1000 are unverified.
- Arming is polled every 250 ms and counts as unreadable after 750 ms; detection is not instantaneous. The 12000 RPM ceiling, the temperature and voltage limits and the 2-unit read-back tolerance are placeholders.
- Real reconnect uses `WebSerialTransport.request`, which needs a user gesture and shows a port chooser; this has to happen inside the 15 s window. Silent reconnect with `getPorts()` is not implemented (owner decision).
- Recovery after a reload or lost connection needs a valid zero-RPM telemetry frame with unpowered ESCs to complete the proof. If a real FC reports no usable frame in that state the marker cannot be cleared by the app; clearing it by hand (delete `uavzones.benchtest.unclean.v1`) is an owner decision.
- The marker lives in browser storage: cleared site data or a private window loses it. Stale-state protection is as good as the browser's storage.
- Window blur is treated as focus loss: clicking the browser's developer tools or another window while powered faults the session by design.
- Motor acknowledgements are matched first-in first-out; a very late acknowledgement could pair with the next command (two consecutive failures still lock).
- The expected motor positions are the default quad-X order; the mixer is not read. Custom mixers will mismatch and lock the workflow.
- Android and phone behaviour, background throttling of timers and a frozen page are not tested; a frozen or terminated page runs no code, so only the battery plug is guaranteed.
- No motor-health result exists (Phase 4). The recorded start threshold is only the ramp's confirmation value.
- Open owner decisions from the backlog (RQ-1, DShot error statistics, jitter limit, Android path, five-aircraft inventory) are unchanged.
