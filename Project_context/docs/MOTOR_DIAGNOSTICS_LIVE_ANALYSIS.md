# Motor Diagnostics: Live MSP/DShot Bench Analysis

**Status:** Implemented 2026-11-17 behind the existing flag `VITE_BENCH_PHASE3` (default off); synthetic and mocked tests only; **not hardware-validated**. Part of the [consolidated backlog](backlogs/in-progress/UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md) (section 0, Phase 4). The Blackbox plan it replaces is deferred, not deleted.
**Question it answers:** *What did UAV Companion directly observe during the controlled low-output sweep?*
**What it never claims:** that the aircraft is safe to fly; that a motor is mechanically healthy; that a bell, shaft or bearing is fault-free; that the battery is healthy; that motor direction is known from DShot telemetry; that subtle vibration faults are ruled out. The one sentence that states these limits is `DISCLAIMER` in `src/benchtest/result.js`; tests forbid those words everywhere else.

## 1. Architecture

```
loop tick (25 Hz)  ->  pollOnce -> observe() -> machine OBSERVE   (safety path, unchanged)
                                   collectSample()                (passive, after observe, before advanceSweep, own try/catch)
dispatch(event)    ->  machine.dispatch -> effects (stop first)   (safety path, unchanged)
                                   analysisAfterDispatch()        (passive, after every effect, own try/catch)
```

| Module | Role |
| --- | --- |
| `src/benchtest/live-collector.js` | Passive, bounded sample store. Cannot reference the machine, the boundary or the transport. |
| `src/benchtest/metrics.js` | Pure per-sweep metrics from samples. |
| `src/benchtest/result.js` | Pure combined result: categories, peer comparison, wording. |
| `src/benchtest/result-ui.js` | Result screen (DOM through `el()` and `textContent`). |
| `src/benchtest/history.js` | Builds derived records and the evidence export (no storage access, no UID). |
| `src/benchtest/analysis-constants.js` | Every provisional number of this layer, in one frozen module. |
| `src/aircraft-diag-data.js` | The only module that knows the storage keys; used by the controller and by the Privacy panel. Knows nothing about motors. |

Safety properties (each has a test in `tests/bench-analysis-controller-unit.mjs`): a collector that throws neither blocks nor delays the sweep or Stop & zero; the state machine holds no analysis data and never reads any; the collector is called after the machine has observed and after every effect has run; analysis cannot send, and `motor-control.js` stays the only module that names the motor-command message (`tests/bench-safety-unit.mjs`).

## 2. Live measurements captured (per sample)

One sample per **new** fresh telemetry frame. Nothing is interpolated, resampled or carried forward. A frame older than 200 ms (`staleTelemetryFaultMs`), a repeated frame or a missing frame produces no sample; the stretch is listed in `unavailable`, and frames further apart than `METRIC_RULES.gapMs` (120 ms) are listed in `gaps`.

| Field | Meaning and unit |
| --- | --- |
| `t` | Monotonic milliseconds since the sweep started (`performance.now()` in the browser). |
| `phase` | `ramp`, `validate`, `plateau`, `stop` (stop samples are kept for at most 6 s). |
| `cmd`, `cmds` | Commanded external output for the selected motor, and all four, as last sent through the boundary. 1000 is stop. |
| `rb`, `rbCurrent`, `rbAgeMs` | FC-side `MSP_MOTOR` read-back, whether it was requested after the last command, and its age. |
| `rpm[4]` | Mechanical RPM for all four motors, as reported by the FC. |
| `inv[4]` | DShot invalid, hundredths of a percent; `null` for the 10000 sentinel (statistics unavailable). |
| `temp[4]` | ESC temperature in °C; `null` when 0 (not reported). |
| `v_cV`, `vAt` | Battery voltage in centivolts and the time it was read (it is polled about every 500 ms, so it repeats across frames). |
| `armed`, `armedAgeMs` | Arming state and its age (`null` = unknown). |
| `telAgeMs`, `fresh` | Telemetry age and the freshness flag. |
| `ack` | `ok`, `failed` or `none` for the last motor-command acknowledgement. |

Sweep record: `status` (`completed` or `incomplete`), `end.reason` (the state machine's fault reason, or `user-stop`, `transport-lost`, ...), `end.stopProofComplete`, `end.reportedPosition`, `meta.expectedPosition`, `meta.voltageBefore_cV`, `meta.controllerThreshold`, `truncated`, `droppedSamples`. A cancelled, faulted or interrupted sweep is always `incomplete`.

Bounds (`SAMPLE_LIMITS`): 2000 samples per sweep (the 60 s run timeout allows about 1500), 12 sweeps per session, 200 gaps per sweep. Anything dropped sets `truncated`, which makes that motor "incomplete".

## 3. Derived metrics, formulas and units

All times are ms, commands are external units, RPM is RPM, DShot errors are percent (centi-percent / 100), voltage is volts (cV / 100), temperature is °C.

| Metric | Definition |
| --- | --- |
| Start threshold | The command level of the last `ramp`/`validate` sample before the first `plateau` sample, **confirmed** only if the longest contiguous run (gaps ≤ 120 ms) of fresh samples with RPM > 0 at that level spans at least `candidateValidationMs - gapMs` (880 ms). Otherwise unavailable. `thresholdAgreesWithController` cross-checks the controller's own value. |
| Time to stable rotation | First `plateau` sample time minus first sample with a nonzero command. |
| Plateau command / duration | Most common command in the plateau; last minus first plateau sample time. |
| Plateau window | Plateau samples after `plateauSettleMs` (500 ms), fresh, valid RPM, at the plateau command; the **longest contiguous** run. Fewer than 8 samples: no plateau statistics (listed as unavailable). |
| Plateau RPM | Median, P10 and P90 (linear interpolation), range = P90 - P10, MAD (median absolute deviation), min, max over the window. |
| Usable / missing | Window size; plateau samples not in the window; gaps overlapping the plateau; gaps in the whole sweep. |
| DShot errors | Maximum and median percent of the selected motor over fresh samples with a usable reading; fraction of readings at or above the provisional limit (`DSHOT_STATS.excessiveErrors_centi`, 1.00 %); maximum over all four motors. |
| Voltage | Before = reading at sweep start; minimum over **distinct reads** (de-duplicated by read time); drop = before - minimum. Labelled a bench-load observation, not a battery assessment. |
| Temperature | Maximum reported for the selected motor and for any motor; unavailable when not reported. |
| RPM by command | Median RPM per command level (ignoring the first 200 ms of the level, at least 3 samples, RPM > 0), used only for comparing motors at a shared command. |
| Direct evidence counters | Samples with a current read-back differing from the commanded value (tolerance 0 at stop, 2 otherwise); samples with another motor above 0 RPM; samples with the aircraft armed. The state machine already faults on these; they are recorded as evidence. |

## 4. Result categories

Priority order: Inspection recommended, Test incomplete, Difference observed, Completed. There is no safe, healthy, passed or airworthy state.

| Category | Condition | Headline |
| --- | --- | --- |
| Inspection recommended | **Direct evidence** on any attempted motor: no stable rotation by the cap; wrong motor moved or none reported; unexpected peer rotation; persistent excessive DShot errors; command/read-back mismatch; stop proof not completed; telemetry, read-back or arming state became unavailable; arming, temperature, voltage or RPM-ceiling fault. The exact reason is stated. | Inspection recommended |
| Test incomplete | A motor missing, a sweep cancelled or interrupted (user stop, connection lost, page hidden, timeout), required telemetry unavailable (no plateau window, no usable DShot reading), a truncated buffer, or an unknown fault reason. | Test incomplete |
| Difference observed | All four sweeps complete and a motor differs from its peers by more than a provisional threshold (section 5). | Difference observed — inspect and monitor |
| Completed | All four complete, no hard or telemetry failure, no difference above a provisional threshold. | Completed — no issue observed in the live checks |

A peer outlier alone never produces Inspection recommended or a critical stop in this release. A later cancelled attempt never hides an earlier completed one; a completed retry replaces a failed attempt.

## 5. Provisional thresholds (every one, all in `analysis-constants.js`)

No validated faulty-motor fixture exists. These are observational comparison limits, shown as provisional in the UI.

| Constant | Value | Use |
| --- | --- | --- |
| `PEER_COMPARISON.minMotors` | 3 | Complete sweeps needed before any comparison; fewer: measurements shown, nothing classified. |
| `PEER_COMPARISON.startThresholdDifference` | 10 command units | Start threshold vs the median of the other motors. |
| `PEER_COMPARISON.rpmRelativeDifference` | 20 % | RPM vs the median of the other motors **at one shared command level** (the highest level with valid samples on at least 3 motors). Without one, plateau RPM is not compared. |
| `PEER_COMPARISON.dshotDifference_centi` | 25 (0.25 percentage points) | Maximum DShot error vs the median of the other motors. |
| `METRIC_RULES.gapMs` | 120 ms | Larger spacing between frames is a gap; windows never span it. |
| `METRIC_RULES.plateauSettleMs` | 500 ms | Plateau samples ignored after the step. |
| `METRIC_RULES.minPlateauSamples` | 8 | Minimum contiguous usable plateau samples. |
| `METRIC_RULES.levelSettleMs`, `minLevelSamples` | 200 ms, 3 | Per-command comparison. |
| `METRIC_RULES.dshotExcessiveFractionPersistent` | 0.2 | Fraction of usable readings at or above 1.00 % that counts as persistent. |
| Existing, unchanged | `DSHOT_STATS.excessiveErrors_centi` 100, `BENCH_TIMINGS` fault limits | Physical and safety limits stay in `constants.js`; this layer cannot change them. |

## 6. Storage and privacy

Keys (also in [DATABASE.md](DATABASE.md)): `uavzones.aircraftdiag.v1` (derived records, newest last, at most 20) and `uavzones.aircraftdiag.samples.v1` (opt-in live samples, at most 2 sets). Both are separate from the Diagnostics log, never read by trip export, sharing or sync, and deleted by the Privacy panel's **Delete aircraft diagnostic data** (the card appears only while data is stored, with the approximate size).

- Nothing is stored until the user presses **Save this result in this browser**. Keeping live samples is a separate checkbox, **off by default**, with the approximate size shown first.
- A record holds the date, firmware and ESC identity used by the allowlist, per-motor derived metrics, the overall observational result, the constants used, and `schemaVersion`. The aircraft-profile association is the FC/ESC identity (`association.kind: "fc-esc-identity"`), a clean adapter point in `history.js`; no wider identity system was invented.
- The raw FC UID is never included in a record or in the exported evidence file.
- The evidence export (`format: uav-companion.motor-bench-evidence`, `schemaVersion: 1`) includes units, the constants of the run, every sweep with its `complete` flag, gaps and samples.
- Stored data is untrusted on read: unknown versions and malformed records are ignored (never trusted, never a crash) and can still be deleted.

## 7. What changed for the Blackbox decision

See the backlog section 0 for the decision record. In code: `evaluateReadiness` no longer produces the gates `blackbox`, `bb-mode`, `bb-fields`, `bb-rate` and `storage` unless called with `includeBlackbox: true` (kept for a future owner decision, covered by the unchanged readiness tests); the bench policy ignores them even then; the lab has no Blackbox mode control; the bench test never enters CLI and never changes configuration. `interSweepSettleMs` (5000, formerly `minSweepGapMs`) is a provisional zero-output interval between motors, counted from the previous motor's complete stop proof; it never delays the first motor and applies only to starting a sweep, never to stopping. It is not a validated cooling period.

## 8. Tests

`tests/bench-analysis-unit.mjs` (collector, metrics, result, history, store), `tests/bench-analysis-controller-unit.mjs` (collection through the controller, passivity, cancellation, faults, four-motor sessions, Blackbox removal), plus the updated `tests/bench-safety-unit.mjs`, `tests/preflight-readiness-unit.mjs`, browser `tests/bench-lab.mjs` and `tests/preflight-lab.mjs`. None needs hardware.

## 9. User-facing beta (2026-11-17)

**Kill switch.** `VITE_BENCH_PHASE3=1` at build time. Off: no dashboard card (`src/motor-diag-entry.js` is a constant-false no-op that tree-shakes away together with what it imports), no `/motor-diagnostics/` page (a Vite input only when the flag is set), no bench chunk in the main bundle. On: the card and the page exist. Checked on the built output (flag off: no entry strings in any JS, no page directory).

| Piece | Where |
| --- | --- |
| Dashboard card (title, Experimental badge, description, **Open diagnostics**, requirement note; latest saved date and headline with **View history** when local history exists) | `src/motor-diag-entry.js`, one line in `src/dashboard.js` |
| Workspace (user-facing, `/motor-diagnostics/`) | `motor-diagnostics/index.html`, `user.js`; presentation mode `user: true` of `src/benchtest/bench-ui.js`; shared styles `src/preflight/ui-parts.css (arrangement only; imports the app stylesheet)` |
| Saved results, grouped by FC/ESC identity | `src/benchtest/history-ui.js` (`#history`) |
| Page lifecycle and navigation limits | `src/benchtest/lifecycle.js` (shared with the lab) |
| Developer harness (synthetic FC, fault injection, trace, stop-validation procedures) | `/tools/motor-bench-lab/` |

**Navigation.** The way back to the dashboard exists only while unpowered (before the flow starts, and after the battery is confirmed disconnected). While anything may be powered it is removed, the Back button is absorbed with an explanation, and leaving or closing asks for confirmation and sends the stop first where the browser runs the handler. A forced close, a crash or a frozen page cannot be controlled and recovers through the durable marker.

**User view.** No synthetic connection, fault injection, raw state names (kept in the DOM, hidden, for tests), traces, build notes or phase wording. The simulated flight controller is reachable only with `?synthetic=1` on a non-production build (tests and local development); a production build ignores it. Readiness shows the detected aircraft to confirm and the ESC entry; the stop-validation procedures (used to approve allowlist entries) are not offered.

**Tests.** `tests/motor-diagnostics-ui.mjs` (dashboard card on and off, navigation in and out, developer controls absent, the complete synthetic journey from the workspace to a saved result and back at 412 px with 360 px and desktop checks, Back and close while powered, recovery through the user route, history, deletion through Privacy), `tests/bench-safety-unit.mjs` (the entry is the only app file that mentions the flag and may import only the result store).


## 10. Aircraft electronics profile and combined motor confirmation (2026-11-19)

**Aircraft electronics** (`aircraftElectronics`, versioned `schemaVersion` 1; `src/preflight/fc-profile.js`, `src/benchtest/electronics.js`, UI `electronics-ui.js`). Built only from reads the session already makes, plus two new allowlisted read-only requests, `MSP_BUILD_INFO` (5) and `MSP_RX_CONFIG` (44). Present in the live result, the saved record (`aircraftElectronics`), the evidence export and the saved-history view. Records saved earlier have no such field and show "FC profile not recorded" and "ESC identification not recorded".
- **Flight controller:** firmware variant and version, MSP protocol and API version, build date and time, git revision (`MSP_BUILD_INFO`, first 26 bytes: 11 + 8 + 7 fixed ASCII), board identifier, target, board name, manufacturer, hardware revision (0 is shown as not reported), MCU (name from the board-info MCU id; ids outside the table stay "Unknown"), motor protocol, motor count, bidirectional DShot, motor poles. Never read or kept: the UID, any serial number, the SPI receiver id (byte 17 of `MSP_RX_CONFIG` is skipped).
- **Receiver, three separate concepts.** (1) *Configured receiver protocol*: receiver mode from the feature bits (PPM 0, Serial 3, Parallel PWM 13, MSP 14, SPI 25) plus the serial provider (byte 0) or SPI protocol (byte 16) of `MSP_RX_CONFIG`, only for the matching mode; the raw code is kept next to the label; codes outside the table, or below the API a code is valid from (FPORT 1.41, SRXL2 and GHST 1.43, SPI protocols 1.43), stay "Unknown". (2) *Compiled receiver support*: decoded from build-option flags only through a version-gated mapping table. **No verified mapping exists** (the build-option layout of `MSP_BUILD_INFO` was not established from the firmware source; nothing after the 26 date, time and revision bytes is interpreted), so the table is empty and the app shows "Compiled receiver support not reported by this firmware." The decoder and its gating are tested with an injected table. (3) *Receiver hardware*: always "Receiver hardware not independently identified"; CRSF is a wire protocol and is never turned into ELRS, Crossfire or Tracer. The configured UART is not shown (no stable read-only message exposes it; MSP_CF_SERIAL_CONFIG was not added).
- **ESCs:** the default 4-way scan result, normalised: per channel status (identified, unavailable, unsupported, not recorded), firmware family, version, target, MCU family, bootloader, evidence source and failure reason; scan status; matching or mixed. A firmware target is not the retail model ("Retail model not independently verifiable"). No serial number is read or kept.
- **Why ESC data was missing.** (a) The 4-way step runs only on the simulated aircraft (`VITE_BENCH_FOURWAY` default off for USB, see the 4-way document): on real hardware there is no scan to show. (b) For an ARM-bootloader ESC (the BLHeli_32 case) the identification bytes (MCU signature, bootloader mode) were read but the settings block was deliberately not, because `readPlan` only plans a read for AM32. The 4-way layer therefore proves a channel responds and names its MCU, and reports the family as not recognised. **BLHeli_32 family and version are not decoded: the BLHeli_32 settings layout is not documented in anything the project can verify, and guessing bytes would violate "no guessed values".** Those channels read "Unsupported" with the reason; the 4-way boundary, allowlist and read plan are unchanged (the only change there is a per-channel progress callback, no new byte).

**Combined motor confirmation** (`src/benchtest/combined.js`, `combined-ui.js`; machine event `START_COMBINED_HOLD_COMPLETE` from `MOTOR_READY`, `COMBINED_STOP_DONE` back to `MOTOR_READY`). A fifth test inside Motor tests, a full-width card directly under the 2x2 grid.
- **Eligibility (offer):** all four individual sweeps completed; every motor completed with a stop proof, a confirmed start threshold, a plateau RPM and a matching position; no inspection, incomplete or fault; no RPM or DShot peer difference (a start-threshold difference alone does not block); not yet run in this session. **Start interlocks** (the machine's, all required): every existing interlock except the single-motor ones, plus all four individual checks done, every command and a fresh read-back proven at external 1000, no fresh over-temperature reading, fresh RPM telemetry, all RPM zero, disarmed, settle interval, a fresh press-and-hold. Temperature is optional: 0 means "not reported" and never blocks; only a fresh reading at or above 85 C blocks or aborts. Old values are never carried forward.
- **Run:** identical command to motors 1 to 4 (slots 5 to 8 stay 1000), same step cadence from 1020 up to the highest individual plateau command (never above external 1100), settle 1 s with every motor required to turn, plateau 2 s, then external 1000 and the full stop proof (user no-rotation confirmation included). The cap, the identical-value rule and the permission are enforced by the machine (`output-all` permission), the boundary (`sendOutputAll`) and the frame builder. Aborts through the existing fail-closed path: transport loss, visibility loss, arming change, stale or missing telemetry, read-back fault, a motor that was turning and stopped (`combined-motor-stopped`), not every motor turning at the common command (`combined-not-rotating`), the existing DShot, voltage, temperature and ceiling limits, Stop & zero, internal error.
- **Result** (`combinedConfirmation`, saved and exported): median RPM per motor, RPM peer difference, DShot invalid-packet maximum, usable and missing samples, voltage before and minimum (a bench-load observation, not a battery assessment), temperature per motor or "Not reported by this ESC", stop proof. An anomaly gives *Inspection recommended*, "All motors passed individually, but their behaviour differed when operated together.", and raises the overall result to Inspection recommended; no motor, ESC or battery is named.
