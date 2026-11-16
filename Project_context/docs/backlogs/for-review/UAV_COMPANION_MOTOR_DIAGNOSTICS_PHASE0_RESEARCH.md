# Motor Diagnostics: Phase 0 Research

**Status:** Research complete; awaiting owner review. No application code, motor control, deployment or dashboard entry was touched.
**Date:** 2026-11-16
**Related:** [Backlog](UAV_COMPANION_AUTOMATED_MOTOR_DIAGNOSTICS_BACKLOG.md), [Addendum 1](UAV_COMPANION_MOTOR_DIAGNOSTICS_ADDENDUM_1.md)

## 0. Method and evidence labels

- Betaflight: primary source read from `github.com/betaflight/betaflight`, `master` at `09b90997` (2026-11-15) plus tags `4.3.2`, `4.4.3`, `4.5.5`, `2025.12.5`, `2026.6.2`. Files: `src/main/msp/msp.c`, `msp_protocol.h`, `blackbox/blackbox.c`, `blackbox.h`, `blackbox_fielddefs.h`, `flight/mixer.c`, `flight/mixer_init.c`, `drivers/dshot.c`, `drivers/motor.c`, `cli/settings.c`, `fc/runtime_config.h`, `build/debug.h`, `target/common_post.h`.
- Chromium / Android: primary documentation and issue trackers (a subagent collected and cited; its claims are carried here with its labels).
- **V** = a primary source states it. **I** = inferred from sources. **U** = unknown, needs a hardware test or a further source. Betaflight claims marked V were read in code, not run on hardware.
- No hardware test was run. Every value marked *provisional* needs a supervised measurement before it is final.

## 1. Source-backed findings

| ID | Finding | Evidence | Label | Impact |
| --- | --- | --- | --- | --- |
| F1 | `MSP_SET_MOTOR` only writes `motor_disarmed[i] = motorConvertFromExternal(u16)` for each motor. Size check only (`dataSize >= motorCount*2`). No timeout, no arming check, no cap. | `msp.c` `case MSP_SET_MOTOR` | V | Confirms the backlog's residual risk (4.2). The FC holds the last value until changed or reboot. |
| F2 | While disarmed, `motor[i] = motor_disarmed[i]` every mixer cycle. | `mixer.c` ("Disarmed mode") | V | Same. A held value persists after the host disappears. |
| F3 | `MSP_MOTOR` returns `motorConvertToExternal(motor[i])` for 8 slots, 0 for disabled motors. | `msp.c` `case MSP_MOTOR` | V | The app can read back the FC-side command and verify it equals what was sent, independent of ACK. Interlock input. |
| F4 | External values are constrained to 1000..2000; non-3D DShot maps external `1000` to `DSHOT_CMD_MOTOR_STOP`. | `dshot.c` `dshotConvertFromExternal` | V | "Zero" is external **1000**, not 0. The backlog says "zero" without a number. |
| F5 | `BLACKBOX_MODE_MOTOR_TEST` logging starts when `!ARMED && areMotorsRunning()` (any `motor_disarmed[i] != disarmMotorOutput`), and stops 5 s after all motors return to minimum. Each run is a separate log if the gap exceeds 5 s. | `blackbox.c` `inMotorTestMode`, `blackboxUpdate` | V | Works with MSP motor testing as required. Logging starts only if the device is not full. Pauses over 5 s between sweeps create separate logs. |
| F6 | Modes: `NORMAL=0`, `MOTOR_TEST=1`, `ALWAYS_ON=2`. `MOTOR_TEST` code is present in 4.3.2, 4.4.3, 4.5.5, 2025.12.5, 2026.6.2 and master. CLI `blackbox_mode` exists from 4.4.3 in `settings.c` (4.3.2 `settings.c` not checked). | `blackbox.h`; tag blackbox.c; `settings.c` | V | `MOTOR_TEST` or `ALWAYS_ON` are the compatible disarmed modes. `NORMAL` logs only while armed, so it fails the bench gate. |
| F7 | `MSP_BLACKBOX_CONFIG` does **not** carry `blackbox_mode`. It returns: supported, device, rate numerator (fixed 1), rate denominator, P ratio (u16), `sample_rate`, and (API 1.45+) `fields_disabled_mask`. | `msp.c` `case MSP_BLACKBOX_CONFIG`; write counts 12 (4.3.2) vs 13 (4.4.3 onward) | V | `blackbox_mode` is CLI-only. See the read-only fallback proposal (RQ-1). |
| F8 | From 4.5.5 on, a dedicated `gyroUnfilt` field set (`gyro.gyroADC`, pre-software-filter) is logged when `GYROUNFILT` is not disabled in `fields_disabled_mask`. In 4.3.2 and 4.4.3 there is no such field; unfiltered gyro appears only via `debug_mode = GYRO_SCALED` in the `debug[]` fields (`DEBUG_GYRO_SCALED` exists in 4.4.3 `debug.h`). | `blackbox.c` field table per tag; `debug.h` | V | 4.5.x and newer need no debug mode for unfiltered gyro. 4.3/4.4 do, and the debug field has only 4 slots. |
| F9 | `debug_mode` is readable over MSP (`MSP_ADVANCED_CONFIG`, API 1.42+, byte plus `DEBUG_COUNT`). | `msp.c` | V | The gate can validate it without CLI. |
| F10 | eRPM is logged as int16 `eRPM / 100` (comment "eRPM / 100" in the field table), only if `useDshotTelemetry` and `RPM` is not disabled. Mechanical RPM = `eRPM*100 / (motor_poles/2)`; log headers include `motor_poles`. | `blackbox.c` field table, header lines | V (formula I; confirm on a fixture) | Decoder conversion needs the header pole count. |
| F11 | Each logged gyro value is a single sample at that loop iteration: `lrintf(gyro.gyroADC[i] * scale)`. No averaging or anti-alias filter in the logger. P frames are delta/predictor encoded only. | `blackbox.c` line ~1299 | V | Content above the logged Nyquist folds into the band. The resolvability policy must treat aliasing as a risk, not only as a limit. |
| F12 | `MSP_MOTOR_TELEMETRY` (API 1.42+) returns per motor: RPM (u32), `invalidPct` (u16, 0.01%), temp (u8 °C), voltage (u16), current (u16), consumption (u16). `invalidPct` starts at 10000 (100%) and is only replaced when `USE_DSHOT_TELEMETRY_STATS` is compiled in and the motor is active. | `msp.c` | V | DShot error evidence is available over MSP on builds with stats. On builds without stats `invalidPct` reads 100% regardless of health. A parser must not read that as errors. Build support: `common_post.h` has `#undef USE_DSHOT_TELEMETRY_STATS` (2 places in master). Which targets are affected: **U**. |
| F13 | DShot error evidence over MSP does not need a debug mode. `DEBUG_DSHOT_RPM_ERRORS` is a separate debug mode. | `debug.h`, F12 | V | The MSP path avoids the debug-mode conflict with `GYRO_SCALED` on 4.3/4.4. |
| F14 | Readable configuration: `MSP_API_VERSION` (1), `MSP_FC_VARIANT`, `MSP_FC_VERSION`, `MSP_UID` (3 x u32), `MSP_FEATURE_CONFIG` (u32; `FEATURE_3D = 1<<12`, `FEATURE_ESC_SENSOR = 1<<27`), `MSP_MOTOR_CONFIG` (motor count, pole count, DShot telemetry flag, ESC-sensor flag; API 1.42/1.49 additions), `MSP_ADVANCED_CONFIG` (PID denominator, motor protocol, PWM rate, idle, inversion, debug mode), `MSP_MOTOR_3D_CONFIG`, `MSP_ANALOG`, `MSP_DATAFLASH_SUMMARY`, `MSP_SDCARD_SUMMARY`. | `msp.c`, `msp_protocol.h`, `feature.h` | V | See the matrix in section 3. |
| F15 | Arming-disable flags are exposed in `MSP_STATUS_EX` and include `ARM_SWITCH` (bit 29), "always set if any other flag is set when arming". | `runtime_config.h`, `msp.c` | V | `ARM_SWITCH` alone cannot show that the arm switch is off. A separate source for switch state is needed (box flags in the status flight-mode bits, **U** which bit). |
| F16 | Dataflash: `MSP_DATAFLASH_SUMMARY` (flags ready/supported, sector count, total size, used offset). `MSP_DATAFLASH_READ`: u32 address, optional u16 length and compression flag. `MSP_DATAFLASH_ERASE` exists and must be excluded from the allowlist. SD card: only `MSP_SDCARD_SUMMARY`, no read message. | `msp.c` | V | Confirms the owner's retrieval decision. SD files need manual import. |
| F17 | API versions at release tags: 4.3.2 = 1.44, 4.4.3 = 1.45, 4.5.5 = 1.46, 2025.12.5 = 1.47, 2026.6.2 = 1.48, master = 1.49. Latest stable 2026.6.2 (2026-09-16). | `msp_protocol.h` per tag; GitHub releases | V | Version table in section 6. A build may report a different minor than its tag if the constant was bumped later; confirm on hardware. |
| F18 | Native Web Serial on Chrome for Android ships in Chrome 148 (stable about May 2026), wired devices only; Bluetooth RFCOMM is a separate feature. Only devices "configured to expose wired serial ports" return ports; the minimum Android version is unclear. | chromestatus 6043992171085824; Chrome 148 release notes; blink-dev intent thread | V; device coverage **U** | The decisive Android unknown is device coverage, not API existence. |
| F19 | `web-serial-polyfill` is archived (2025-01-23), latest 1.0.15 (2023-11), with open claim failures ("Device or resource busy") on several phones. | npm registry; GitHub issues #54, #60 | V | The polyfill route is a no-go for a launch requirement. |
| F20 | WebUSB protected interface classes exclude CDC (0x02, 0x0A). | WICG WebUSB spec | V | Claiming CDC is permitted by the spec; on Android the OS must not have bound a driver (the polyfill failure mode). |
| F21 | Android USB permission is granted by the OS "only until the device is disconnected"; users can set a default app. | Android `UsbManager` docs | V | Expect a permission step on each attach. Whether Chrome adds its own grant: **U**. |
| F22 | Hidden pages: frozen pages run no JS or timers. Basic throttling 1 Hz hidden; intensive throttling after 5 min. `pagehide`/`unload` are not fired on mobile app close. | Page Lifecycle docs; Chrome 88 timer throttling | V | A host-side watchdog cannot rely on timers once hidden. The only dependable safeguard is the FC state plus the battery. Whether the USB handle survives shade, lock, app switch or swipe: **U**. |
| F23 | Screen Wake Lock needs a secure context and is released when the page is hidden; it keeps the screen on, not the page alive. | MDN, W3C spec | V | Mitigates screen timeout only. |
| F24 | The Betaflight App uses Capacitor with a custom serial plugin over `mik3y/usb-serial-for-android` (MIT; CDC-ACM detection since 3.5.0). It has a known issue: after accepting the permission dialog the port does not appear until a replug or a manual find. | betaflight-configurator PR #4698, #4706 | V | Precedent for the bridge. The permission and discovery issue is a design input. |
| F25 | OTG power limits and phone battery effect: no primary source found. | | U | Needs measurement. |

## 2. Corrections to the backlog supported by primary sources

1. "Zero" must be defined as external 1000 (F4).
2. The Blackbox gate needs a **mode** check (`MOTOR_TEST` or `ALWAYS_ON`) (F5, F6).
3. "Unfiltered gyro" differs by firmware: a dedicated field in 4.5+, a debug mode in 4.3/4.4 (F8).
4. A fixed 1 kHz requirement is not an adequate basis for 1x to 3x order analysis (F11, section 4).
5. `blackbox_mode` is not exposed over MSP (F7); a gate that reads it needs a read-only CLI query or attestation.
6. DShot errors are available over MSP only on builds with stats (F12).
7. Disarmed motor values persist until changed (F1, F2), consistent with the existing residual risk.
8. The arm-switch state cannot be read from the `ARM_SWITCH` flag alone (F15).

## 3. MSP / CLI readability matrix

Proposed allowlist is read-only in every row. `MSP_SET_MOTOR` is the only write and is confined to the state machine.

| Required value | Source | Available | From API / firmware | Notes |
| --- | --- | --- | --- | --- |
| Firmware variant and version | `MSP_FC_VARIANT`, `MSP_FC_VERSION` | Yes | all | Expect `BTFL`. Anything else fails closed. |
| MSP API version | `MSP_API_VERSION` | Yes | all | Compare with the table in section 6. |
| Stable aircraft identity | `MSP_UID` | Yes | all | 96-bit device ID; keep local only; documented as a device identifier. |
| Motor count = 4 | `MSP_MOTOR_CONFIG` | Yes | 1.42+ | Also check mixer type; mixer read message not yet confirmed (**U**). |
| Motor protocol is DShot | `MSP_ADVANCED_CONFIG` (`motorProtocol`) | Yes | all tested | Enum value mapping to confirm per tag in Phase 1. |
| Bidirectional DShot on | `MSP_MOTOR_CONFIG` (`useDshotTelemetry`) | Yes | 1.42+ | This flag reflects telemetry use; working RPM is proven by live RPM, not by the flag. |
| 3D / reversible off | `MSP_FEATURE_CONFIG` bit 12 | Yes | all | Also `MSP_MOTOR_3D_CONFIG` for detail. |
| Motor pole count | `MSP_MOTOR_CONFIG` | Yes | 1.42+ | Plausibility range proposed 6..28, provisional. |
| Disarmed and arm state | `MSP_STATUS_EX` | Partly | all | `ARMED` and arming-disable flags yes; arm-switch state needs the box flags (**U**). |
| Blackbox supported, device, rate, disabled-field mask | `MSP_BLACKBOX_CONFIG` | Yes | mask 1.45+ | Mask bit positions: `GYRO` 7, `MOTOR` 11, `RPM` 13, `GYROUNFILT` 14 (set = disabled). Confirm per tag. |
| **Blackbox mode** | none | **No (CLI `get blackbox_mode`)** | CLI 4.4.3+ | Fallback query RQ-1 or user attestation. |
| `debug_mode` | `MSP_ADVANCED_CONFIG` | Yes | 1.42+ | Needed only for 4.3/4.4. |
| Logged rate | `MSP_BLACKBOX_CONFIG` rate fields + PID denominator + gyro/loop time | Derivable | | Authoritative value comes from the log itself (section 4). |
| Dataflash free space | `MSP_DATAFLASH_SUMMARY` | Yes | all | SD capacity: `MSP_SDCARD_SUMMARY` gives a summary only. |
| Battery presence | `MSP_ANALOG` | Yes | all | Voltage scale and sensor presence vary by board (section 7). |
| Commanded motor values | `MSP_MOTOR` | Yes | all | Read-back interlock (F3). |
| Per-motor RPM, DShot error %, temp, volt, current | `MSP_MOTOR_TELEMETRY` | Yes | 1.42+ | Error % build-dependent (F12). Extended telemetry optional. |

### RQ-1: proposed read-only CLI query (not to be implemented before review)

| Field | Proposal |
| --- | --- |
| Query | Exactly `get blackbox_mode`, sent after entering CLI mode and followed by an immediate `exit`. No other command. |
| Why | `blackbox_mode` is the only gate value that has no MSP source (F7). |
| Expected response | A text line of the form `blackbox_mode = <NORMAL|MOTOR_TEST|ALWAYS_ON>` plus the allowed-values line; parser accepts only those three tokens. |
| Firmware range | 4.4.3 and later (confirmed); 4.3.x unconfirmed. |
| Timeout | 2 s provisional, measure. |
| Failure | Unknown or malformed response, timeout, or an FC that does not leave CLI mode: fail closed and show the attestation path. |
| Risks to resolve first | Entering CLI sets `ARMING_DISABLED_CLI` and on some firmware leaving CLI can trigger a reboot or settings side effects; some boards re-enumerate. This must be proven harmless on the five aircraft before adoption. |
| Alternative with no CLI | The user attests the mode after the app shows the manual steps, and the log header confirms the actual mode indirectly (a non-empty motor-test log appears). This weakens the gate to "attested". |

Recommendation: start with the attestation path in the first implementation; adopt RQ-1 only after a hardware check shows entering and leaving CLI is side-effect-free on every supported family.

## 4. Blackbox rate and resolvability

### 4.1 Rule

For order `k` and RPM `r`: `order_frequency_hz = k * r / 60`.

The effective rate `fs` is derived from the log itself (median inter-frame time delta of main frames), never from the configured value. The usable band is `f_use = u * fs / 2` with usable fraction `u`.

**Proposed `u = 0.8` (provisional).** Reasoning: (a) the logger takes single samples with no anti-alias filter (F11), so energy near Nyquist is contaminated by folded content; (b) RPM varies inside a window, so the order frequency drifts across the window edge; (c) windowing and spectral peak width need margin; (d) a margin of about 20% below Nyquist is a conservative engineering choice, not a measured value. To be validated against recorded logs (section 8).

An order is resolvable for a window only if `k * r_max(window) / 60 <= f_use`, with `r_max` taken as the window maximum plus its measured spread. Otherwise that order is **unavailable** for that window, and the report says so. It is never "normal".

Aliasing caveat: even resolvable orders can be contaminated by folded motor noise above the log's Nyquist. Reports carry an "aliasing risk" confidence note whenever `fs` is below the value needed to place the strongest expected out-of-band energy (unknown). This lowers confidence, never converts to a pass.

### 4.2 Highest RPM at which each order is resolvable (`u = 0.8`)

`r_max = 60 * f_use / k = 24 * fs / k`.

| Logged rate | 1x | 2x | 3x |
| --- | --- | --- | --- |
| 1 kHz | 24,000 | 12,000 | 8,000 |
| 2 kHz | 48,000 | 24,000 | 16,000 |
| 4 kHz | 96,000 | 48,000 | 32,000 |
| 8 kHz | 192,000 | 96,000 | 64,000 |

### 4.3 Realistic RPM ranges (engineering estimates, not measured; need data from the five aircraft)

| Aircraft class | Typical flight RPM | 1x Hz | Smallest `fs` for 1x | Smallest `fs` for 2x | Smallest `fs` for 3x |
| --- | --- | --- | --- | --- | --- |
| 5-inch (F4/F7/H7) | 20,000 to 35,000 | 333 to 583 | 1.5 kHz | 3 kHz | 4.4 kHz |
| 2.5-inch AIO | 25,000 to 45,000 | 417 to 750 | 1.9 kHz | 3.8 kHz | 5.6 kHz |
| 1S whoop | 30,000 to 60,000 | 500 to 1000 | 2.5 kHz | 5 kHz | 7.5 kHz |

(`fs_min = k * f_1x / (0.4)` for `u = 0.8`.)

### 4.4 Recommendations (all provisional)

- **Minimum to accept any motor-order analysis:** a window-level rule, not a global gate: at least one order passes the resolvability test for that window. A global floor of 1 kHz still applies as a sanity floor for the bench gate.
- **Preferred for useful 1x analysis:** 2 kHz or higher (covers 1x to 48,000 RPM, enough for 5-inch and 2.5-inch flight; a 1S whoop at peak RPM needs about 2.5 kHz).
- **2x and 3x over realistic flight ranges:** 4 kHz or more for 5-inch 2x, higher still for 3x. These rates are likely impractical on small flash. The product should expect 2x/3x to be "unavailable" at high RPM on most logs and say so. 2x/3x is realistic mainly at low RPM and during the bench plateau.
- **Separate bench and flight requirements: yes.** The bench runs at capped low output, so low orders resolve at lower rates; bench RPM at the 1100 cap is **unmeasured** and must be recorded on each aircraft (item M1). The flight requirement is a coverage report, not a launch blocker.
- **Gate behaviour:** the readiness gate compares the configured logged rate against the bench minimum; the flight analysis never blocks, it reports resolvability per window.

### 4.5 Log size and Android memory (estimates; measure from fixtures)

- Rough logged size: 30 to 100 bytes per main frame depending on enabled fields. At 1 kHz about 2 to 6 MB per minute; at 2 kHz about double; at 4 kHz about 8 to 24 MB per minute. Dataflash on small AIO boards is commonly 8 to 16 MB (**U**: the five boards' flash sizes). So 4 kHz on a 16 MB flash holds under a few minutes.
- Proposed budgets (provisional): decode streaming in a Web Worker with a bounded chunk (for example 1 MB), keep per-window features and a decimated series rather than all samples, cap an imported file at 64 MB for Android and 256 MB desktop until measured, and show a clear "file too large" message rather than failing.
- Raw logs and large derived arrays live in IndexedDB; only small metadata in `uavzones.` keys.

## 5. Android transport go / no-go

| Option | Finding | Verdict |
| --- | --- | --- |
| Native Web Serial on Chrome Android 148+ | API exists; coverage limited to devices that expose wired serial ports; Android OS/Chrome interplay uncertain (F18). | **Conditional: test on hardware.** Not enough evidence to assume it works on arbitrary phones. |
| WebUSB + `web-serial-polyfill` | Archived; claim failures on several phones (F19). | **No-go** for a launch requirement. |
| Capacitor bridge on `usb-serial-for-android` (MIT) | Betaflight App precedent (F24); needs permission/discovery handling. | **Fallback; recommended to prepare in Phase 1** if the native test fails. Narrow scope: serial open/read/write/close only. |

Unmeasured items needed from a phone test (M-list in section 9): `getPorts()` / `requestPort()` listing the FC on at least two phone brands and two Android versions; OS and Chrome permission dialogs per attach; grant persistence after reload and re-attach; behaviour on `disconnect`, on FC reboot re-enumeration and DFU; whether the connection survives notification shade, screen lock (with and without wake lock), app switch and swipe-away; timer drift and MSP latency while hidden; battery drain and whether USB-C to USB-C cables power the FC; throughput at 115,200 baud and above.

Lifecycle implication regardless of transport (F22): a hidden or frozen page cannot send zeros. The design must therefore treat any `visibilitychange` to hidden during a powered state as a fault, show the battery instruction on return, and rely on F1/F2 plus the physical cutoff. The unclean-exit recovery state in the addendum covers swipe-away.

**Recommendation:** Phase 1 runs a two-track spike: native Web Serial on at least two phones, and a minimal Capacitor serial bridge prototype if native fails or covers fewer than the target devices. A go for public launch needs the owner to approve the chosen Android path after the spike.

## 6. Proposed version-support matrix

Fail closed on anything not in the table. A row becomes "supported" only after source verification (done for the tags below) **and** a supervised hardware check on at least one FC family per row.

| Firmware | API | Source-verified items | Initial status | Notes |
| --- | --- | --- | --- | --- |
| 4.3.x | 1.44 | `MOTOR_TEST` logging present; no `gyroUnfilt` field | **Unsupported** | Needs the debug-mode path, no `fields_disabled_mask` (1.45), CLI `blackbox_mode` unconfirmed. |
| 4.4.x | 1.45 | `MOTOR_TEST`, CLI `blackbox_mode` (4.4.3), mask; no `gyroUnfilt` field | **Unsupported initially** | Could be added later through `GYRO_SCALED` (F8), with the 4-slot debug limit. |
| 4.5.5 | 1.46 | All required items | **Candidate, hardware pending** | Only 4.5.5 was read; add other 4.5.x only after checking each tag. |
| 2025.12.5 | 1.47 | All required items | **Candidate, hardware pending** | |
| 2026.6.2 | 1.48 | All required items | **Candidate, hardware pending** | Latest stable at the time of writing. |
| master / pre-release / RC | 1.49 | | **Unsupported** | |

The allowlist is by exact tested version string and API pair, not by range. Message layouts are additive across these versions; each addition is gated by the reported API minor (for example the `kv` field at 1.49 must never be required).

## 7. Safety timings

All values are **provisional** unless noted. None is measured. They live in one frozen constants module covered by deterministic unit tests, with a recorded hardware measurement per value before release.

| Parameter | Proposed value | Justification | Status |
| --- | --- | --- | --- |
| Press-and-hold to start a sweep | 1.0 s pointer; 1.0 s keyboard/switch hold equivalent | Long enough to prevent accidental taps, short enough not to be a burden; matches common hold-to-confirm patterns. | Provisional; usability check on desktop and phone |
| MSP request timeout (reads) | 250 ms, one retry | USB CDC round trips are normally a few ms; 250 ms leaves margin without delaying faults. | Provisional; measure p99 on five aircraft |
| Motor command acknowledgement | 150 ms; failure to ACK twice in a row is a fault | A shorter limit than reads because motor state matters. | Provisional |
| Telemetry poll cadence | 25 Hz (40 ms) | Gives several samples per 300 to 500 ms ramp step. | Provisional |
| Stale-telemetry fault | No valid telemetry for 200 ms (5 missed polls) | Must be shorter than the 300 to 500 ms dwell per step. | Provisional |
| Zero command cadence and count | Resend zero every 50 ms, at least 10 attempts (500 ms), then read back `MSP_MOTOR` equals 1000 for all motors and RPM zero for 1 s | Repetition covers a dropped frame; read-back (F3) verifies FC state independent of the ACK. | Provisional |
| Reconnect grace after battery connect (`POWER_CONNECT_RECONNECT`) | 15 s | Allows ESC init and USB re-enumeration; instruct battery removal after expiry. | Provisional; measure re-enumeration time per FC |
| ESC-ready wait before zero verification | 5 s | ESC boot tones; adjust per measured time. | Provisional |
| Powered-zero observation | 3 s continuous, all RPM zero, at least 60 telemetry samples | Short enough to be practical, long enough to catch a creeping motor. | Provisional |
| Hold at candidate for start-threshold window | 1 s continuous valid RPM (as in the backlog) | Already specified. | Specified in the backlog |
| Battery detection | Voltage rise relative to the USB-only baseline, sustained 1 s; no numeric absolute threshold selected | Boards differ in divider scale and USB back-feed. | **Needs measurement (M3)** |
| Battery removal evidence | Voltage falls and stays below an evidence-based level for N seconds, plus explicit user confirmation | Capacitors, smoke stoppers and USB power keep voltage nonzero after removal. Do not rely on voltage alone. | **Needs measurement (M3)** |

Battery-voltage background (I, not verified): a smoke stopper sits in series with the battery lead, so the FC can read a lower voltage under load and a slow decay after removal because of bulk capacitors; some AIOs read a small voltage from USB back-feed; some boards have no battery divider. These effects must be measured on the five aircraft before any threshold is chosen.

## 8. Fixture and threshold-validation plan

### 8.1 Fixtures

| Fixture | Source | Purpose |
| --- | --- | --- |
| Synthetic MSP frames | Generated | Framing, parsing, CRC, corruption, truncation, timeouts. |
| Synthetic Blackbox streams | Generated by our own encoder from the documented format | Decoder correctness for all frame types and encodings, predictors, corruption and truncation. |
| Synthetic spectra | Generated sine / swept orders with known aliasing | Resolvability rule, order tracking, confidence. |
| Healthy bench logs | Recorded by the owner during a supervised checkpoint on the five aircraft | Healthy distributions (see 8.2). |
| Healthy flight logs | The owner's existing healthy logs | Segmentation and window classification. |
| Known-fault logs | **None available** | Not required for Phase 0; see 8.3. |

Clean-room rule: decoder written from the format documentation and our own fixtures. No Betaflight App or Blackbox Viewer source is copied. Recorded logs are the owner's data; check that none contain personal data (GPS home position) before committing a fixture, and prefer stripping or synthesising.

### 8.2 Measurements to take at supervised checkpoints (M-list)

- M1: bench RPM at each commanded step to the 1100 cap, per motor, per aircraft (unloaded).
- M2: start thresholds per motor, repeatability across repeats and across power cycles.
- M3: battery voltage readings: USB-only, battery connected with and without smoke stopper, after removal over 60 s.
- M4: telemetry poll rate achieved, ACK latency distribution, `invalidPct` behaviour with and without stats.
- M5: USB behaviour when the battery connects: reset or not, re-enumeration time.
- M6: Blackbox behaviour in `MOTOR_TEST`: start latency, log count per run, free space use, logged rate, field presence.
- M7: dataflash read throughput; storage size per board.
- M8: Android phone tests listed in section 5.

### 8.3 Threshold validation

- **Category 1: deterministic safety and validity stops.** Verified by unit and state-machine tests plus mocked-transport scenarios. No empirical data needed. Non-overridable inside the powered session.
- **Category 2: empirical classifications.** Provisional and conservative until evidence exists. Drafted from peer comparison, within-session repeatability, healthy-aircraft distributions from the five aircraft, synthetic fixtures, and the aircraft's own history after more than one session. No claim of fault sensitivity.
- **Evidence needed before "Inspection recommended" is production-ready:**
  1. at least N healthy sessions per aircraft class to set false-positive rates (N to be proposed after M2; for example 10 sessions across at least 3 airframes per class is a starting suggestion, not a validated number);
  2. a set of controlled-fault recordings made on **non-flyable bench fixtures only** (for example a motor with a deliberately unbalanced bell on a test mount), approved by the owner, and never created on a flyable aircraft;
  3. documented sensitivity and specificity against that set, reviewed by the owner;
  4. an independent reviewer (ideally an experienced builder) confirming the plain-language wording.
  Until all four are met, the "Inspection recommended" level ships only with a "provisional criteria" statement, or is withheld behind the flag.
- A provisional empirical threshold alone must never yield a component diagnosis. A finding needs: two or more independent observations (for example peer deviation plus within-session repeat) before it can reach "Inspection recommended". A single provisional criterion is capped at "Monitor".
- First run: peer comparison and data-quality checks only. The result states "no historical baseline exists" and lowers confidence. Missing data is reported as unavailable, never as a pass.
- Stop level (empirical): reserved. Only deterministic safety conditions produce "Stop" in the first release; an empirical anomaly never produces "Stop" unless it also trips a deterministic rule. A Stop cannot be overridden in the same powered session.

## 9. Unresolved decisions requiring the owner

1. Approve the **zero = external 1000** definition and the read-back interlock (F3, F4).
2. Choose between `blackbox_mode` attestation only (recommended first) and the read-only CLI query RQ-1 after a hardware check.
3. Confirm 4.5.5, 2025.12.5 and 2026.6.2 as the initial candidates, and 4.3/4.4 unsupported.
4. Approve `u = 0.8` and the sample-rate recommendations as provisional.
5. Android: approve a two-track spike (native Web Serial first, Capacitor bridge prototype as fallback), and say whether a bridge changes the "no wider application rewrite" boundary, since a Capacitor shell packages the whole app as a native wrapper.
6. Approve the starting provisional timing table, to be refined by measurement.
7. Confirm the provisional "Inspection recommended" evidence bar in 8.3, including controlled bench-fixture faults only.
8. Confirm that empirical findings never reach "Stop" in the first release.
9. Tell me which firmware version each of the five aircraft runs, and the board flash type and size (dataflash or SD).
10. Agree how recorded logs are scrubbed and stored as fixtures (location, personal data such as GPS home).
11. The `Check aircraft` flag name and whether it is a build-time constant or a stored preference.

## 10. Recommended next implementation prompt

> Implement Phase 1 and Phase 2 of the Automated Motor Diagnostics backlog (plus Addendum 1) **without any motor command capability**. Scope: (a) `src/preflight/msp-codec.js` with only read-only messages from the Phase 0 allowlist and a unit-tested frame parser (corruption, truncation, timeouts), (b) `src/preflight/transport.js` with a desktop Web Serial adapter and a mock transport, behind a disabled feature flag with no dashboard entry, (c) `src/preflight/readiness.js` evaluating the gates in Addendum 1 section 3 against a mock FC and reporting exact detected and required values, (d) the version table in section 6 as data, (e) the timing constants module from section 7 with deterministic tests, (f) the Android spike harness as a separate non-shipping page for the supervised phone tests. Do not implement `MSP_SET_MOTOR`, any CLI query, the bench state machine, Blackbox decoding, UI or storage. Before committing, run `npm run test:unit` and the affected browser suites; update `CURRENT_STATUS.md`; ask before commit, push or deploy.

## 11. Source index

- Betaflight repository (`master` 09b90997, tags 4.3.2, 4.4.3, 4.5.5, 2025.12.5, 2026.6.2): `src/main/{msp,blackbox,flight,drivers,cli,fc,build,target}/`.
- Chromium and Android: chromestatus.com/feature/6043992171085824; developer.chrome.com/release-notes/148; developer.chrome.com/docs/web-platform/page-lifecycle-api; developer.chrome.com/blog/timer-throttling-in-chrome-88; wicg.github.io/webusb; github.com/google/web-serial-polyfill (issues 54, 60); developer.android.com `UsbManager`; developer.android.com/develop/connectivity/usb/host; developer.mozilla.org Screen Wake Lock API; github.com/betaflight/betaflight-configurator PRs 4698 and 4706; github.com/mik3y/usb-serial-for-android.
- Not used: the PDF BRD (not consulted in Phase 0, as instructed).
