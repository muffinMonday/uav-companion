// Motor bench test (Phase 3 prototype): frozen constants. Backlog sections 4, 5, 17.2, 22.
// EVERY value here is PROVISIONAL: approved only as a value to measure on supervised hardware, never measured yet.
// Developer-only. Nothing here is a statement that any value is safe for any aircraft.
// Timings shared with the read-only phases (acknowledgement timeout, poll cadence, stale limit, stop cadence and count,
// reconnect grace, ESC-ready wait, powered-zero observation) come from ../preflight/constants.js so there is one source.
import { TIMINGS, STOP_EXTERNAL_VALUE } from '../preflight/constants.js';

const deepFreeze = (o) => { Object.values(o).forEach((v) => typeof v === 'object' && v !== null && deepFreeze(v)); return Object.freeze(o); };

export const BENCH_PROVISIONAL = true;

// External motor values for non-3D DShot. "Zero" is external 1000, never 0.
export const MOTOR = deepFreeze({
  stopValue: STOP_EXTERNAL_VALUE, // 1000
  startValue: 1020, // first candidate output
  step: 5,
  dwellMs: 400, // searching dwell; must stay inside dwellMinMs..dwellMaxMs
  dwellMinMs: 300,
  dwellMaxMs: 500,
  cap: 1100, // absolute output cap; no code path may command above it
  candidateValidationMs: 1000, // continuous valid RPM that confirms rotation
  plateauOffset: 15, // start threshold + 15..20, capped
  plateauOffsetMin: 15,
  plateauOffsetMax: 20,
  plateauMaxMs: 2000, // plateau duration; never longer than 2 s
  plateauMs: 2000,
  slots: 8, // MSP motor frame carries eight values; only the selected one may leave 1000
  enabledMotors: 4,
});

export const BENCH_TIMINGS = deepFreeze({
  ...TIMINGS, // ack 150 ms, two failures fault, 25 Hz poll, 200 ms stale, stop every 50 ms x >= 10, grace 15 s, ESC wait 5 s, zero 3 s
  holdFinalConfirmMs: 1000, // press-and-hold final safety confirmation
  holdStartMs: TIMINGS.holdToStartPointerMs,
  stopProofZeroRpmMs: 1000, // continuous valid zero RPM after stop
  stopProofTimeoutMs: 10000, // proof not complete by then: fail closed, battery instruction
  runTimeoutMs: 60000, // a whole sweep (ramp, validation, plateau) may not run longer
  minSweepGapMs: 5000, // settle period between sweeps (originally the Blackbox MOTOR_TEST shutdown period; kept unchanged as an extra safety interval)
  statusPollMs: 250, // arming state and FC-side read-back
  statusStaleMs: 750, // arming state older than this in a powered state is a fault
  analogPollMs: 500,
  readbackStaleMs: 1000,
  readbackToleranceNonzero: 2, // external units; the stop value must read back exactly
  rpmCeiling: 12000, // selected-motor RPM above this during a bench run is a fault (provisional plausibility bound)
  escTempFaultC: 85, // 0 means "not reported"
  voltageSagFault_cV: 300, // drop from the powered-zero baseline that is a fault
});

// DShot error statistics (`invalidPct` in MSP_MOTOR_TELEMETRY, hundredths of a percent). Fail-closed policy for the first
// hardware release (owner decision): real nonzero testing needs LIVE statistics after the ESCs are powered.
// The sentinel 10000 (100.00 %) is what a build without DShot statistics reports; it means "unavailable", never "100 % errors".
// Statistics are ignored while the ESCs are unpowered (USB-only states). All three numbers are provisional and unmeasured.
export const DSHOT_STATS = deepFreeze({
  unavailableSentinel_centi: 10000,
  excessiveErrors_centi: 100, // 1.00 %: at or above this the statistics are "excessive" (the one place to change it)
  usableForMs: 1000, // continuous usable, low-error readings on every motor before a nonzero test may start
});

export const CHECKLIST_ITEMS = Object.freeze([
  ['propsRemoved', 'Every propeller is physically removed from every motor.'],
  ['benchSecured', 'The aircraft is secured on a clear, nonconductive bench.'],
  ['wiresClear', 'Loose wires and objects are clear of the motors.'],
  ['batteryReachable', 'The battery plug is unobstructed and within immediate reach.'],
  ['smokeStopper', 'A smoke stopper or current limiter is installed between the battery and the aircraft.'],
  ['armSwitchOff', 'The transmitter arm switch is off and the throttle is at minimum.'],
].map(([key, text]) => Object.freeze({ key, text })));

// Motor order as Betaflight numbers it with the default quad-X mixer. The mixer is NOT read from the flight controller,
// so this is an expectation the user must check by eye. A mismatch locks the workflow; the app never relabels.
export const EXPECTED_POSITIONS = Object.freeze(['rear right', 'front right', 'rear left', 'front left']);
export const POSITION_NONE = 'none';

export const UNLOCK_PHRASE = 'UNLOCK BENCH TEST';

export const RECOVERY_KEY = 'uavzones.benchtest.unclean.v1';

export const BATTERY_INSTRUCTION = 'Disconnect the flight battery now.';
