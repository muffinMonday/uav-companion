# Motor Diagnostics Backlog: Addendum 1 (proposed)

**Status:** **Superseded 2026-11-16.** Owner approved this addendum with corrections; it is merged into [the consolidated backlog](UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md), which is the sole authoritative specification. This file is kept only as decision history. Where it differs from the backlog, the backlog wins.
**Date:** 2026-11-16
**Amends:** [UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md](UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md)
**Evidence:** [Phase 0 research](UAV_COMPANION_MOTOR_DIAGNOSTICS_PHASE0_RESEARCH.md) (finding IDs F1 to F25, items M1 to M8)
**Scope:** Requirements only. No implementation, motor control, commit-to-origin, migration, push or deployment is authorized by this addendum.

## Tags used

- **[SRC]** correction supported by a primary source (finding ID given).
- **[DEC]** proposed decision, new or restating an owner instruction from the Phase 0 brief.
- **[PROV]** provisional value, needs measurement before release.
- **[RES]** contradiction in the backlog, resolved here.
- **[AC]** acceptance-criteria change.

Settled product decisions in backlog section 2 are unchanged. Where this addendum narrows or clarifies one, the clause says so.

## 1. Threshold framework

### 1.1 Category 1: deterministic safety and validity stops [DEC]

Conditions: communication loss, invalid or stale telemetry, unexpected peer-motor rotation, arming-state change, command-cap violation, failure to confirm zero, MSP error or invalid frame, incompatible logging configuration, visibility or focus loss in a powered state, voltage fault, over-temperature, unexpected RPM.

- Non-overridable within the active diagnostic session.
- Recovery only through: battery removal, FC reconnection, safe-state initialization, powered-zero verification.
- A Stop result cannot continue the same powered session. The user may end the session and start a fresh diagnostic after the full recovery sequence.
- Values come from one centralized, frozen constants module with deterministic tests (section 6).

### 1.2 Category 2: empirical diagnostic classifications [DEC][PROV]

Covers RPM instability, vibration differences, start-threshold differences, acceleration differences, historical degradation.

- All criteria are provisional and conservative until the evidence bar in the research doc section 8.3 is met. The product must not claim validated fault sensitivity.
- Drafted from: peer-motor comparison; within-session repeatability; healthy-aircraft observations across the five available aircraft; synthetic fixtures; the aircraft's own history after more than one session.
- A single provisional criterion is capped at **Monitor**. **Inspection recommended** needs at least two independent observations (for example peer deviation plus a within-session repeat) and carries a "provisional criteria" statement until validation is complete.
- A provisional empirical criterion never produces a definitive component diagnosis (consistent with backlog section 6).
- In the first release only Category 1 conditions produce **Stop**. An empirical anomaly alone never does. [DEC]
- First run: peer comparison and data-quality checks only. The result must state "no historical baseline exists" and reduce confidence. Missing baseline or insufficient evidence lowers confidence and is reported as unavailable, never as a pass.

## 2. Supported-environment gate changes (amends backlog section 3)

1. **Zero is external value 1000.** [SRC F4][RES] The backlog's "zero" means the `MSP_SET_MOTOR` external value 1000 for non-3D DShot. **Read-back semantics:** `MSP_MOTOR` read-back (F3) verifies only the FC-side commanded motor value. It does not verify delivery to the ESC, physical motor stoppage or electrical de-energisation. A successful stop requires all of: repeated external-1000 commands; FC-side read-back of 1000 for every enabled motor; valid RPM telemetry reporting zero for the required observation period; and user-visible confirmation that no motor is rotating. When RPM telemetry is unavailable or stale during a powered session, fail closed and require battery disconnection.
2. **Logging mode gate.** [SRC F5, F6] Blackbox mode must be `MOTOR_TEST` (preferred for the bench) or `ALWAYS`. These are the CLI-compatible values `NORMAL`, `MOTOR_TEST` and `ALWAYS`; `BLACKBOX_MODE_ALWAYS_ON` is the internal Betaflight enum name and appears in no user-facing text or parser. `NORMAL` logs only while armed and fails the bench gate. Under `MOTOR_TEST`, logging starts when any motor value leaves minimum while disarmed and stops 5 s after all return to minimum.
   - **Segmentation [DEC]:** the workflow never requires or encourages the next sweep to begin within five seconds; safety confirmation and deliberate initiation take priority. Every bench session accepts multiple Blackbox log segments, associated by session metadata, order, timestamps and detected motor activity. A gap that creates another log neither reduces safety nor invalidates the session when all required segments are present. A missing or unmatched segment makes that sweep's analysis unavailable and is never guessed (research doc 8.4).
3. **Gyro evidence.** [SRC F8, F9] Firmware 4.5 and newer need `gyroUnfilt` not disabled in the Blackbox field mask. 4.3/4.4 would need `debug_mode = GYRO_SCALED`; those versions are unsupported initially (section 5).
4. **RPM and motor fields.** The field mask must not disable `MOTOR` or `RPM`; the log header must list the pole count.
5. **Logged rate.** [RES] The fixed "at least 1 kHz" is replaced by: configured rate is a sanity floor of 1 kHz for the bench gate, and the effective rate is computed per valid window from reconstructed frame times and drives resolvability (section 4). A rate that cannot resolve any order for a window makes that window's orders unavailable.
6. **DShot error evidence.** [SRC F12, F13] Use `MSP_MOTOR_TELEMETRY` `invalidPct`; no debug mode is needed. Because `invalidPct` reads 100% on builds without stats, the parser treats "RPM present and 100% invalid" as **error data unavailable**, not as a failing channel. Without error data the bench may continue only if RPM data is valid, and confidence is lowered. If this proves unacceptable on hardware, the gate becomes blocking (open decision; research doc section 9).
7. **Arm-switch state.** [SRC F15] The `ARM_SWITCH` arming-disable flag cannot prove the switch is off. The gate needs `ARMED` false and the flight-mode box state for ARM (source bit **U**, to confirm in Phase 1), plus the user's acknowledgement.
8. The app validates settings only and shows manual Betaflight steps. It never changes Blackbox, debug or any other configuration. [DEC, unchanged]

## 3. Read-only configuration access [DEC]

- "No CLI access" means: no user-facing CLI, no arbitrary command entry, no write commands, no configuration changes.
- The fixed read-only query proposal **RQ-1** (`get blackbox_mode`) is documented in the research doc section 3 with its expected response, firmware range, timeout, parser rule and fail-closed behaviour. It is **not implemented** until the owner approves it after reviewing the findings and a hardware check shows CLI entry and exit are side-effect-free on all supported families.
- **Owner decision 2026-11-16:** user attestation of `blackbox_mode` is acceptable only for the initial read-only and mock implementation. Production gating remains unresolved pending the supervised RQ-1 hardware experiment.
- Accepted values are `NORMAL`, `MOTOR_TEST` and `ALWAYS`; `ALWAYS_ON` is not a parser or user-facing token.
- Unknown or unexpected responses fail closed.

## 4. Blackbox resolvability policy [DEC][PROV] (replaces any fixed-rate claim)

- `order_frequency_hz = k * r / 60`.
- Analysis validity is **not** derived from median frame spacing. Required: timestamp reconstruction from every main frame; detection of missing frames, gaps, duplicates and excessive jitter; contiguous valid windows for spectral and order analysis; explicit rejection or segmentation around gaps; documented resampling rules where resampling is used; tests proving resampling cannot turn missing data into a normal result (research doc 4.6).
- Effective sample rate is computed **per valid window** from that window's reconstructed frame times.
- Usable band is `u * fs / 2` with **`u = 0.8` (provisional)**; validate against recorded logs before release.
- An order is resolvable for a window only if its frequency at the window's maximum RPM (plus spread) lies inside the usable band.
- Reports state, for each analysed RPM range, which of 1x, 2x and 3x were resolvable. An unresolved order is **unavailable**, never normal.
- Aliasing risk: the logger takes unfiltered point samples (F11). Confidence carries an aliasing note when folded energy cannot be excluded.
- Recommended rates (provisional): preferred for useful 1x analysis, 2 kHz or higher; 2x and 3x at flight RPM need 4 kHz or more and are often unavailable; separate bench and flight requirements, with bench RPM to be measured (M1). Flight analysis reports coverage and never blocks.
- Android and log-size budgets: streaming decode in a Web Worker, bounded chunks, features and decimated series rather than raw sample arrays in memory, provisional import caps (64 MB Android, 256 MB desktop), clear over-limit messages (research doc 4.5).

## 5. Version support [DEC]

The initial allowlist is by exact tested version and API minor, not a range:

| Firmware | API | Initial status |
| --- | --- | --- |
| 4.5.5 | 1.46 | Candidate pending hardware |
| 2025.12.5 | 1.47 | Candidate pending hardware |
| 2026.6.2 | 1.48 | Candidate pending hardware |
| 4.3.x, 4.4.x, other 4.5.x, pre-releases, master | | Unsupported (fail closed) |

4.5.5, 2025.12.5 and 2026.6.2 are **candidate versions only** (owner decision 2026-11-16). The actual five-aircraft firmware, MSP API and storage matrix is inventoried first, without requiring any reflashing (section 21). A row becomes supported only after source verification, that inventory, and a supervised hardware check on at least one FC family. "Supported Betaflight" is never used without the table.

## 6. Safety timings [DEC][PROV]

Recommended values with justification are in research doc section 7: press-and-hold, MSP and motor-ACK timeouts, telemetry cadence, stale-telemetry limit, zero cadence and count, reconnect grace, ESC-ready wait, powered-zero observation, battery detection and removal. All are provisional. They are stored in one frozen module, covered by deterministic tests, and each gets a recorded hardware measurement before release.

## 7. Log retrieval [DEC]

For the initial release:

- onboard dataflash through the read-only path (`MSP_DATAFLASH_SUMMARY`, `MSP_DATAFLASH_READ`); `MSP_DATAFLASH_ERASE` is excluded from the allowlist;
- local import of previously downloaded Blackbox files;
- SD-card logs by manual file import after the user retrieves the file;
- no automation of USB mass-storage mode in the browser;
- no automatic Blackbox erase.

If storage is insufficient, block capture and guide the user to back up and erase manually in the Betaflight App, then recheck storage when the user returns.

## 8. Android transport [DEC]

- Desktop and Android remain joint public-launch requirements. Desktop development may continue internally; the feature stays behind its flag and does not ship desktop-only without a new owner decision.
- Findings: the polyfill route is a no-go (F19); native Web Serial on Chrome Android 148+ is conditional on device coverage (F18); a narrow Capacitor bridge over an MIT USB-serial library is the recommended fallback (F24). See research doc section 5.
- Phase 1 runs a two-track spike on real phones (list M8); the two-track spike is approved. The Android path is chosen by the owner after the spike.
- A transport-only Capacitor / `usb-serial-for-android` prototype is within the Phase 1 spike boundary. Adopting a native wrapper, build pipeline or distribution path requires a separate architecture and owner decision.
- Whatever the transport: a hidden page cannot be relied upon to execute commands or timers within the required safety deadlines; a frozen or terminated page executes no JavaScript (F22). A visibility change to hidden during a powered state remains a fault. Attempt zero immediately where execution is still available, but never represent that attempt as guaranteed.

## 9. Exit, recovery and reconnect states [RES][DEC]

### 9.1 Wording change [RES]

Replace "normal exit is forbidden" with "intercepted where the platform permits". The backlog and UI must not imply a browser can prevent tab closure, OS termination or a crash.

### 9.2 New state: `UNCLEAN_EXIT_RECOVERY`

- Persist only the minimum local marker that a powered session may have ended abnormally (a boolean and a timestamp under a `uavzones.` key; no telemetry).
- **Marker lifecycle [DEC]:** the marker is set durably **before** battery connection is allowed, and cleared only after all of: nonzero output is no longer permitted; FC command read-back is 1000 for every enabled motor; RPM zero is verified; battery removal is confirmed.
- **Fail closed:** if durable browser storage is unavailable, or a marker write cannot be verified (written, then read back), active powered testing is not allowed.
- **Defence in depth, not a substitute:** the software still sends zero on every new or reconnected FC session, regardless of the marker. Safe startup does not depend on the marker.
- On the next load or FC reconnection: treat battery state as unknown; do not restore an active motor state; prohibit nonzero commands; lead with "Disconnect the flight battery now"; require battery removal, reconnection, safe-state initialization and powered-zero verification before a new test.

### 9.3 New state: `POWER_CONNECT_RECONNECT`

Entered from `READY_TO_POWER` when an expected USB reset happens while the battery is connected.

- Nonzero output stays prohibited. Battery state is unknown until re-established.
- May attempt a controlled reconnection; on success it repeats software zero initialization and the compatibility conditions affected by reboot, then performs powered-zero verification before continuing.
- If reconnection does not complete within the grace period (provisional 15 s), instruct battery disconnection.
- Any communication loss **after** a nonzero command has been permitted is a locked fault, not a normal reset.

### 9.4 Updated state table

Adds two rows to backlog 11.7:

| State | Nonzero output allowed | Normal exit | Primary UI |
| --- | ---: | --- | --- |
| `POWER_CONNECT_RECONNECT` | No | No | Reconnection progress, battery instructions, timeout action |
| `UNCLEAN_EXIT_RECOVERY` | No | After confirmed battery removal and recovery sequence | Full-screen "Disconnect the flight battery now" and recovery steps |

### 9.5 Ordering clarification [RES]

Backlog section 5 places the physical-preparation acknowledgement before the safe state; section 11.7 places it after. Resolution: USB-only safe-state initialization (`SAFE_IDLE`) comes first, then the fresh acknowledgement (`READY_TO_POWER`), then battery connection. The acknowledgement expires on reload, reconnect or fault.

## 10. Battery removal [DEC][PROV]

- Removal stays an explicit user confirmation.
- Where a trustworthy voltage or battery-state reading exists, also require electrical evidence consistent with removal.
- No numeric threshold until measured on the five aircraft (M3), accounting for smoke stoppers, capacitors, USB power and AIO sensing. Voltage alone is never sufficient.

## 11. Motor start threshold and plateau [RES][DEC]

- The **start threshold** is the first command value at which continuous valid rotation is sustained for the required observation window (1 s).
- The ramp pauses at a candidate value while establishing the window. It must not keep rising and then attribute a later observation to an earlier value.
- The plateau for a motor derives from that motor's own confirmed start threshold plus 15 to 20, capped at 1100. For later motors, no other motor's value is used unless Phase 0 or later work justifies an adaptive rule (none proposed now).
- Reliable-rotation declaration, other-motor-stationary and error-rate conditions are unchanged from backlog 5.

## 12. Motor identity [DEC]

- During the first low-output test of each output, show the expected position on the quad diagram and ask the user to select which motor physically spun.
- A mismatch returns to zero immediately, locks further testing, reports a motor mapping or configuration issue, and does not silently relabel or continue.
- Research item for Phase 1: how custom motor output reordering and mixer versions affect the mapping (mixer-read message still **U**).

## 13. Accessibility [DEC]

- Pointer press-and-hold remains. Add a keyboard and switch-control equivalent that preserves deliberate activation (hold a dedicated key or button for the same duration, with a visible progress indicator; releasing early cancels).
- **Stop & zero** has an immediate keyboard command. The visible control is the primary path. The binding must avoid common browser and assistive-technology shortcuts; the selected key and the reason are documented when chosen (candidate to evaluate: a single focusable control activated with Enter or Space plus a documented dedicated key, tested with screen readers; to be settled in Phase 6 testing).
- All other 11.8 requirements stand.

## 14. Propeller-presence plausibility [DEC]

RPM- or current-based detection is a research item and at most a secondary warning. It never replaces the physical props-removed confirmation unless validation shows adequate reliability across the hardware matrix.

## 15. Repo fit [DEC]

- Raw logs and larger analysis data in IndexedDB; small metadata under `uavzones.` keys; any shape change gets a version bump and a `DATABASE.md` note.
- Exclude aircraft diagnostic data from sync, sharing and trip export.
- **Privacy terminology [DEC]:** the existing Privacy panel already uses "Diagnostics" for the application's technical event log. The new data lives in a separate section named **"Aircraft diagnostic data"**, holding its derived history, retained raw Blackbox files, export and deletion controls. These stay separate from the existing application Diagnostics log. Privacy delete-all clears both datasets, but the UI never implies they are the same data.
- Web Worker with a streaming decoder; Android log-size and memory budget as in section 4.
- Clean-room decoder from documentation and our own fixtures.
- **Fixtures [DEC]:** complete raw logs are never committed and stay outside Git. Committed fixtures are minimal, trimmed, and scrubbed of GPS and home position, identifying metadata and unrelated fields, with a manifest recording source, consent, transformation, retained signals and checksum.
- **Feature flag [DEC]:** a build-time flag that defaults off. Test overrides are explicit and non-persistent. It is not a normal stored user preference. All user-visible entry points stay behind it until the final release gate; no dashboard entry before then.

## 16. Verification additions [AC]

Additions to backlog section 13:

- deterministic tests for the constants module and every timing;
- tests that `MSP_SET_MOTOR` can be reached only from the state machine and only in `RUNNING`;
- tests that zero means external 1000 and that read-back is required;
- state tests for `UNCLEAN_EXIT_RECOVERY` and `POWER_CONNECT_RECONNECT`, including reload, USB loss and timeout;
- parser fail-closed tests for unknown firmware, API, response and for `invalidPct` handling;
- resolvability tests: orders near, at and above the usable band, aliasing fixtures, unavailable never reported as normal;
- classification tests: a single provisional criterion cannot exceed Monitor; first-run result states no baseline;
- accessibility tests for the keyboard hold equivalent and Stop & zero binding;
- hardware matrix: add the five named aircraft, the M1 to M8 measurements and the Android phone tests;
- stop verification: a stop is not accepted on read-back alone; unavailable or stale RPM in a powered session fails closed;
- Blackbox mode tokens: parser and UI accept `NORMAL`, `MOTOR_TEST`, `ALWAYS` only;
- multi-segment bench sessions: a gap that creates another log neither invalidates the session nor shortens a safety step; a missing segment makes that sweep unavailable;
- timing quality: gaps, duplicates and jitter reject or segment windows; resampling never converts missing data into a normal result; `fs` is per valid window;
- unclean-exit marker: set durably before battery connection is allowed; cleared only after the four conditions in 9.2; an unverifiable write or unavailable storage blocks powered testing; zero is still sent on every new FC session;
- privacy: "Aircraft diagnostic data" is a separate section from the existing Diagnostics log; delete-all clears both without implying they are the same data;
- feature flag: defaults off, non-persistent override only, no stored preference.

## 17. Acceptance-criteria changes [AC]

Replace or add in backlog section 15:

1. "disconnect limitations and physical cutoff actions are prominent and tested" gains: unclean exit and USB reset during power connection are tested on hardware.
2. "no unsupported configuration can reach a nonzero motor command" gains: unknown firmware or API versions and an unverified logging mode fail closed.
3. New: every analysis states which orders were resolvable for each RPM range, and unresolved orders appear as unavailable.
4. New: the "Inspection recommended" level is not enabled for users until the evidence bar in the research doc section 8.3 is met, or it ships with an explicit provisional-criteria statement.
5. New: the Android launch path is chosen from the Phase 1 spike results and approved by the owner.
6. New: no public release as desktop-only without a new owner decision.
7. New: motor stop is accepted only with repeated external-1000 commands, FC read-back of 1000, valid RPM zero and user-visible confirmation; stale or unavailable RPM in a powered session ends in required battery disconnection.
8. New: no feature entry point is reachable unless the build-time flag is on; the flag is not a stored preference.
9. New: no complete raw log is committed to the repository.

## 18. Phase changes

- **Phase 0 (new, done):** research and this addendum.
- **Phase 1:** two-track Android spike, read-only desktop transport, no motor commands in the shipped code. Supervised hardware checkpoints for the measurement list M1 to M8 on the five aircraft. Any powered motor test needs a separate owner authorization.
- Phases 2 to 7 are unchanged apart from the sections above. The motor-command state machine remains Phase 3.

## 19. Status history

| Date | Event |
| --- | --- |
| 2026-11-16 | Addendum drafted from the owner's Phase 0 brief and the research pass (commit `fc88b470`, pushed to `main`). Proposed, not approved. |
| 2026-11-16 | Owner approved with corrections; merged into the consolidated backlog; superseded. |
| 2026-11-16 | Owner review: Phase 0 direction approved, Addendum 1 not yet approved. Revisions applied: (1) `ALWAYS` token, (2) multi-segment bench logs, (3) stop verification semantics, (4) page-lifecycle wording, (5) Blackbox timing quality, (6) durable unclean-exit marker, (7) "Aircraft diagnostic data" Privacy section, (8) status correction. Owner decisions recorded in section 20; Phase 1 inventory in section 21. |

## 20. Owner decisions recorded 2026-11-16

1. **External 1000 is motor stop**, verified by FC read-back plus RPM telemetry and user confirmation (section 2, item 1). Read-back alone is not sufficient.
2. **`blackbox_mode` attestation** is acceptable only for the initial read-only and mock implementation. Production gating is unresolved pending the supervised RQ-1 hardware experiment.
3. **4.5.5, 2025.12.5 and 2026.6.2 are candidate versions only.** Inventory the actual five-aircraft firmware, API and storage matrix before promoting any row to supported. No reflashing is required for the inventory.
4. **`u = 0.8` and the timing table** are approved as provisional measurement values only.
5. **Two-track Android spike** approved.
6. **A transport-only Capacitor / `usb-serial-for-android` prototype** is within the Phase 1 spike boundary. Adopting a native wrapper, build pipeline or distribution path requires a separate architecture and owner decision.
7. **"Inspection recommended" evidence bar** approved as provisional. Controlled fault collection is limited to contained, non-flying fixtures or naturally failed or retired components. Never modify a flyable aircraft to create damage.
8. **Empirical anomalies never produce Stop** in the first release.
9. **Feature flag:** build-time, defaults off. Test overrides are explicit and non-persistent. Not a stored user preference.
10. **No complete raw logs in Git.** Committed fixtures are minimal, trimmed and scrubbed of GPS and home position, identifying metadata and unrelated fields, with a manifest recording source, consent, transformation, retained signals and checksum.

Remaining open items are listed in research doc section 9.2.

## 21. Phase 1 inventory report [DEC]

The read-only Phase 1 harness displays and exports a local inventory report for each connected aircraft, so the five-aircraft matrix is collected without manual guessing:

| Group | Fields |
| --- | --- |
| Identity | FC identifier (variant, UID kept local) and MCU/target |
| Firmware | Firmware version and MSP API version |
| Motors | Motor count, protocol, bidirectional DShot flag, pole count |
| Blackbox | Device, configured rate fields, field mask (decoded names), capacity |
| Storage | Dataflash or SD, total size and used size |
| Telemetry | The `MSP_MOTOR_TELEMETRY` fields actually returned, including whether `invalidPct` is usable (F12) |
| Client | Android phone model, OS version, browser and version, transport used (native Web Serial or bridge), desktop equivalents |

Constraints: read-only messages only; no CLI; no write; no reflashing required; export is a local file the user chooses to save; nothing is uploaded or stored by the app beyond the session. The report may include the UID, so the export screen warns that it identifies the board and the user decides whether to share it.
