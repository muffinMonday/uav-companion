// Motor bench test: the workspace UI, mounted by BOTH the user-facing page (/motor-diagnostics/) and the engineering lab. It owns NO
// safety rule. Every control's availability comes from controller.view().caps (derived by the state machine); every click calls
// one controller method. DOM is built with the shared production parts (ui-parts.js) and el()/textContent only.
// `user: false` (the lab) adds the developer-only extras (raw state, trace, fault injection, stop-validation procedures) to the
// same screens; it does not define any screen of its own.
// Wording rule: never "safe to fly", airworthy, certified, fault free, or a guaranteed result, and never a motor-health verdict.
import { renderReadiness, viewState } from '../preflight/readiness-ui.js';
import { BATTERY_INSTRUCTION, BENCH_PROVISIONAL, BENCH_TIMINGS, CHECKLIST_ITEMS, EXPECTED_POSITIONS, MOTOR, POSITION_NONE, UNLOCK_PHRASE } from './constants.js';
import { STATE } from './state-machine.js';
import { drawResult } from './result-ui.js';
import { drawHistory } from './history-ui.js';
import { canLeaveNow } from './lifecycle.js';
import { DISCLAIMER } from './result.js';
import { escQuad, escSummary, RETAIL_NOTE } from './esc-ui.js';
import { button, confirmRow, el, icon, plural, quadPicker, section, statusEl, stopBar, workspaceHeader } from '../preflight/ui-parts.js';

const BATTERY_STATE_TEXT = Object.freeze({
  'attested-disconnected': 'you confirmed the flight battery is disconnected',
  'declared-connected': 'you declared the flight battery connected',
  unknown: 'unknown: treat the battery as connected',
  'removed-confirmed': 'you confirmed the flight battery is disconnected again',
});
const DSHOT_TEXT = Object.freeze({
  unknown: 'not observed yet',
  usable: 'available and below the provisional error limit',
  unavailable: 'unavailable (this firmware build may not report them, or telemetry is not active)',
  excessive: 'at or above the provisional error limit',
});

// The nine steps of the user's journey. Several machine states share a step; a stop or recovery pauses the progress bar.
function stepOf(c) {
  switch (c.state) {
    case STATE.DISCONNECTED: return { step: 1, label: 'Connect the flight controller' };
    case STATE.READ_ONLY_READINESS: case STATE.STOP_VALIDATION_ONLY: return { step: 2, label: 'Readiness checks' };
    case STATE.SAFE_STATE_INIT: case STATE.SAFETY_CHECKLIST: return { step: 3, label: 'Safety checklist' };
    case STATE.READY_TO_CONNECT_POWER: case STATE.POWER_CONNECT_RECONNECT: case STATE.POWERED_ZERO_VERIFICATION: case STATE.POWERED_STOP_VALIDATION:
      return c.esc && c.esc.scanned ? { step: 6, label: 'Re-checking that every motor is at zero' } : { step: 4, label: 'Battery and zero check' };
    case STATE.ESC_IDENTIFICATION: return { step: 5, label: 'Identifying the ESCs (read only)' };
    case STATE.POST_SCAN_RESTORE: return { step: 6, label: 'Restoring normal control' };
    case STATE.MOTOR_READY: case STATE.RUNNING: return { step: 7, label: 'Motor tests, one at a time' };
    case STATE.VERIFYING_STOP: return { step: 8, label: 'Confirming the motor stopped' };
    case STATE.BENCH_COMPLETE: return { step: 9, label: 'Finish and review the result' };
    default: return { step: 0, label: 'Stopped: recovery', paused: true };
  }
}

const REASON_TEXT = Object.freeze({
  'user-stop': 'You pressed Stop & zero.',
  'transport-lost': 'The USB connection to the flight controller was lost.',
  'telemetry-stale-or-unavailable': 'RPM telemetry became stale or unavailable.',
  'peer-motor-rpm': 'A motor other than the selected one reported rotation.',
  'rpm-above-plausibility-ceiling': 'The selected motor reported an implausibly high RPM.',
  'rotation-during-zero-verification': 'A motor reported rotation during powered-zero verification.',
  'unexpected-rotation': 'A motor reported rotation while idle.',
  'arming-state-changed': 'The aircraft armed.',
  'arming-state-unavailable': 'The arming state could not be read.',
  'voltage-fault': 'Battery voltage dropped more than the provisional limit.',
  'temperature-fault': 'An ESC reported a temperature above the provisional limit.',
  'readback-mismatch': 'The flight controller read-back differs from the commanded value.',
  'readback-unavailable': 'The flight controller read-back is not available.',
  'acknowledgement-failure': 'Two motor commands in a row were not acknowledged.',
  'reconnect-grace-expired': 'The flight controller did not reconnect within 15 seconds.',
  'reconnect-outside-grace': 'A reconnection happened outside the allowed power-connect window.',
  'motor-position-mismatch': 'The motor that moved is not the one expected. The motor mapping or order needs checking in the Betaflight App.',
  'no-stable-rotation-by-cap': 'The motor did not start rotating reliably by the output cap.',
  'run-timeout': 'The run took longer than the provisional limit.',
  'stop-proof-incomplete': 'The stop could not be confirmed within the time limit.',
  'safe-state-incomplete': 'The safe-state initialization did not complete.',
  'uncaught-command-path-error': 'An internal error occurred in the command path.',
  'handler-exception': 'An internal error occurred.',
  'different-flight-controller-after-reconnect': 'A different flight controller reconnected.',
  'different-flight-controller-after-scan': 'The flight controller that answered after the ESC scan is not the one that was scanned.',
  'fourway-exit-unproven': 'The app could not prove that the flight controller left ESC-reading mode and answers normal commands again.',
  'restore-incomplete': 'After the ESC scan, normal control and zero RPM could not be confirmed in time.',
  'unclean-exit': 'A previous bench session may have ended with the battery connected.',
  'dshot-statistics-unavailable': 'DShot error statistics became unavailable during the run.',
  'dshot-errors-excessive': 'The DShot error percentage reached the provisional limit during the run.',
});
const reasonText = (r) => REASON_TEXT[r] || (String(r).startsWith('visibility-or-focus-lost') ? 'The page was hidden or lost focus while powered.' : String(r).startsWith('invalid-transition') || String(r).startsWith('guard:') ? 'An unexpected action occurred.' : String(r));

const traceText = (v) => v.trace.slice(-80).map((e) => `${String(e.seq).padStart(4)} ${e.from} -> ${e.to}  ${e.event}${e.ok ? '' : '  REJECTED: ' + e.reason}${e.ok && e.reason ? '  (' + e.reason + ')' : ''}`).join('\n');

// Press-and-hold with keyboard and switch-accessible equivalents. onComplete(holdMs) runs only after an uninterrupted hold.
function holdControl({ label, ms, onComplete, id, disabled }) {
  const wrap = el('div', 'dg-hold');
  const b = el('button', 'btn primary dg-holdbtn', label); b.type = 'button'; b.id = id; b.disabled = !!disabled;
  const bar = el('span', 'dg-holdbar'); b.append(bar);
  let timer = null;
  const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } bar.style.transition = 'none'; bar.style.width = '0'; };
  const begin = () => {
    if (b.disabled || timer !== null) return;
    bar.style.transition = `width ${ms}ms linear`; bar.style.width = '100%';
    timer = setTimeout(() => { timer = null; cancel(); onComplete(ms); }, ms);
  };
  b.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.pointerType === 'touch') begin(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) b.addEventListener(ev, cancel);
  b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); } });
  b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') cancel(); });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  // switch or one-button access: activate once to start the countdown, activate again to cancel
  const alt = el('button', 'btn dg-alt', `Timed confirm (switch or single-button access): ${ms / 1000} s countdown`); alt.type = 'button'; alt.id = id + '-timed'; alt.disabled = !!disabled;
  const status = el('span', 'dg-holdstatus'); status.setAttribute('role', 'status');
  let altTimer = null;
  alt.addEventListener('click', () => {
    if (altTimer !== null) { clearTimeout(altTimer); altTimer = null; status.textContent = 'Cancelled.'; return; }
    status.textContent = `Confirming in ${ms / 1000} s. Activate again to cancel.`;
    altTimer = setTimeout(() => { altTimer = null; status.textContent = ''; onComplete(ms); }, ms);
  });
  wrap.append(b, alt, status);
  return wrap;
}

export function mountBench(root, { controller, onConnectMock, onConnectReal, realAvailable, inject, user = false, backHref = null, notice = () => '' }) {
  const form = { phrase: '', ack: false, retain: false };
  const refs = {};
  let lastSig = '';
  let overlay = null;

  const shell = el('div', 'dg-app'); shell.id = 'bt-shell';
  const headerHost = el('div'); headerHost.id = 'bt-header';
  const body = el('div', 'dg-body');
  const traceBox = el('details', 'dg-section dash-card'); traceBox.id = 'bt-tracebox';
  const stopHost = el('div'); stopHost.id = 'bt-stophost';
  root.replaceChildren(shell);
  shell.append(headerHost, body, traceBox, stopHost);
  document.documentElement.classList.add('dg-page');

  function connectionOf(v) {
    const c = v.caps;
    if (c.mode === 'mock') return { text: 'Practice mode · simulated', mode: 'mock', icon: 'chip', kind: '' };
    if (c.mode !== 'real') return { text: 'Not connected', mode: 'none', icon: 'usb', kind: '' };
    const powered = c.batteryState === 'declared-connected';
    const unknown = c.batteryState === 'unknown';
    return { text: powered ? 'Connected · battery connected' : unknown ? 'Connected · battery state unknown' : 'Connected · USB power only', mode: 'real', icon: powered || unknown ? 'alert' : 'usb', kind: powered || unknown ? 'no' : 'ok' };
  }

  function drawHeader(v) {
    const c = v.caps;
    const prog = stepOf(c);
    headerHost.replaceChildren(workspaceHeader({
      backHref, canLeave: !user || canLeaveNow(c), title: user ? 'Motor diagnostics' : 'Motor bench (engineering lab)', badgeText: user ? 'Experimental beta' : 'Lab',
      connection: connectionOf(v), prog, notice: user ? notice() : '',
    }));
    if (!user) headerHost.append(el('p', 'hint', 'Engineering lab: the same screens as the Motor diagnostics workspace, plus a raw state line, the transition trace and (synthetic mode only) fault injection. Unlinked, not access control; real-hardware controls stay locked until unlocked in this session.'));
  }

  function drawFault(v) {
    const c = v.caps;
    if (!c.showBatteryInstruction) { if (overlay) { overlay.remove(); overlay = null; } return; }
    if (!overlay) { overlay = el('div', 'dg-overlay'); overlay.id = 'bt-overlay'; overlay.setAttribute('role', 'alertdialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'bt-fault-title'); shell.append(overlay); }
    overlay.replaceChildren();
    const inner = el('div', 'dg-overlay-in'); overlay.append(inner);
    const h = el('h2', '', BATTERY_INSTRUCTION); h.id = 'bt-fault-title';
    inner.append(h);
    inner.append(el('p', '', 'Physical battery disconnection is the only reliable emergency action. Do it first, then read the rest.'));
    if (c.fault) inner.append(el('p', '', `Why: ${reasonText(c.fault.reason)}`));
    if (c.state === STATE.UNCLEAN_EXIT_RECOVERY) inner.append(el('p', '', reasonText('unclean-exit') + ' Treat the battery state as unknown.'));
    if (c.state === STATE.LOCKED_FAULT) {
      if (!c.transportAvailable) inner.append(el('p', '', 'The app cannot stop or verify the motors over this connection. Do not reconnect the battery until the aircraft has been inspected. The recovery marker stays until a fresh connection completes recovery.'));
      else {
        inner.append(el('p', '', 'The app is sending external 1000 and verifying the stop. This does not replace disconnecting the battery.'));
        inner.append(proofList(c.proof));
        if (v.notes.proofFailed) inner.append(el('p', '', 'The stop could not be confirmed. Treat the motors as possibly running.'));
        if (c.canConfirmNoRotation) inner.append(button('No motor is rotating (I am looking at the motors)', () => controller.confirmNoRotation(), { id: 'btn-no-rotation' }));
      }
      inner.append(button('I have disconnected the battery: continue to recovery', () => controller.beginBatteryRemoval(), { id: 'btn-begin-removal' }));
    }
    if (c.state === STATE.BATTERY_REMOVAL_RECOVERY || c.state === STATE.UNCLEAN_EXIT_RECOVERY) {
      const ol = el('ol', 'dg-ol');
      const step = (text, done) => { const li = el('li', done ? 'done' : '', (done ? 'Done: ' : '') + text); ol.append(li); };
      step('Disconnect the flight battery and confirm below.', c.batteryRemoved);
      step('Connect the flight controller by USB only (a fresh connection and a full safe-state start).', c.transportAvailable);
      step('The app sends external 1000, reads it back from the flight controller and checks for zero RPM.', c.proof.partsDone);
      step('Confirm that no motor is rotating.', c.proof.userNoRotation);
      inner.append(ol);
      if (!c.batteryRemoved) inner.append(button('The flight battery is disconnected', () => controller.confirmBatteryRemoved(), { id: 'btn-battery-removed' }));
      if (!c.transportAvailable) inner.append(connectButtons(true));
      else inner.append(proofList(c.proof));
      if (c.canConfirmNoRotation) inner.append(button('No motor is rotating (I am looking at the motors)', () => controller.confirmNoRotation(), { id: 'btn-no-rotation' }));
      if (c.canCompleteRecovery) inner.append(button('Complete recovery and clear the marker', () => controller.completeRecovery(), { id: 'btn-complete-recovery' }));
      if (v.notes.markerError) inner.append(el('p', '', v.notes.markerError));
      if (c.canRetryMarkerClear) inner.append(button('Retry deleting the recovery marker', () => controller.retryMarkerClear(), { id: 'btn-retry-marker' }));
    }
    if (!user) { const td = el('details'); td.append(el('summary', '', 'State and transition trace')); const tp = el('pre'); tp.id = 'bt-trace-fault'; tp.textContent = traceText(v); td.append(tp); inner.append(td); }
  }

  function proofList(p) {
    const ul = el('ul', 'dg-proof'); ul.id = 'bt-proof';
    const row = (ok, text) => { const li = el('li', ok ? 'done' : ''); li.append(icon(ok ? 'check' : 'clock'), el('span', '', (ok ? 'Done: ' : 'Waiting: ') + text)); ul.append(li); };
    row(p.attempts >= BENCH_TIMINGS.stopMinAttempts, `External 1000 sent ${p.attempts} times (at least ${BENCH_TIMINGS.stopMinAttempts}, every ${BENCH_TIMINGS.stopCadenceMs} ms)`);
    row(p.readbackOk, 'Flight controller read-back is 1000 for all four motors (this is not proof the motors stopped)');
    row(p.zeroOk, 'Valid RPM reads zero for 1 s');
    row(p.userNoRotation, 'You confirm no motor is rotating');
    return ul;
  }

  function connectButtons(recovery = false) {
    const d = el('div', 'dg-actions'); d.id = 'bt-connect-actions';
    if (onConnectMock) d.append(button(recovery ? 'Reconnect the synthetic flight controller' : 'Start synthetic bench (simulated flight controller)', onConnectMock, { id: 'btn-connect-mock', primary: true }));
    d.append(button(recovery ? 'Reconnect the flight controller (USB)' : user ? 'Connect the flight controller (USB)' : 'Connect a real flight controller (USB, read-only first)', onConnectReal, { id: 'btn-connect-real', primary: !!user, disabled: !realAvailable }));
    if (!realAvailable) d.append(el('p', 'hint', user ? 'This browser cannot talk to a USB flight controller (Web Serial is needed: Chrome or Edge on desktop, or a recent Chrome on Android).' : 'Web Serial is not available in this browser, so only the synthetic mode can be used.'));
    return d;
  }

  function note(text, kind = 'unk', title) { const b = statusEl({ cls: kind, title: title || text, detail: title ? text : '' }); return b; }

  function drawBody(v) {
    const c = v.caps;
    body.replaceChildren();
    refs.live = {};
    if (c.showBatteryInstruction && c.state !== STATE.LOCKED_FAULT && c.state !== STATE.BATTERY_REMOVAL_RECOVERY && c.state !== STATE.UNCLEAN_EXIT_RECOVERY) return;
    const st = c.state;
    body.dataset.state = st;
    const stateLine = el('p', 'dg-stateline'); stateLine.id = 'bt-state'; stateLine.textContent = st; stateLine.dataset.state = st;
    if (!user) stateLine.className = 'dg-small'; else stateLine.hidden = true;
    body.append(stateLine);
    if (v.notes.error || v.notes.message) { const m = el('p', 'form-error', v.notes.error || v.notes.message); m.setAttribute('role', 'status'); body.append(m); }
    if (!(user && st === STATE.DISCONNECTED)) { const bs = el('p', 'hint'); bs.id = 'bt-battery-state'; bs.dataset.battery = c.batteryState; bs.textContent = `Battery state: ${BATTERY_STATE_TEXT[c.batteryState] || c.batteryState}.`; body.append(bs); }
    if (c.flow === 'powered-stopval') body.append(note('This workflow sends external 1000 and nothing else. No motor can be started.', 'unk', 'Powered stop validation'));

    if (st === STATE.DISCONNECTED) {
      const s = section('Connect the flight controller', 'bt-sec-connect');
      if (user) {
        s.append(el('p', '', 'This check spins each motor briefly at a low output, one at a time, with the propellers removed, and records what the flight controller reports (RPM, DShot errors, voltage, temperature). It then shows what was observed.'));
        s.append(el('p', 'hint', DISCLAIMER));
        const ul = el('ul');
        for (const t of ['A compatible Betaflight flight controller, four motors, DShot with bidirectional DShot (RPM telemetry).', 'A supported USB browser: Chrome or Edge on desktop, or a recent Chrome on Android.', 'The propellers removed, the aircraft clamped on a bench, a smoke stopper on the battery lead, and the battery plug within reach.', 'Nothing here changes any flight-controller or ESC setting.']) ul.append(el('li', '', t));
        s.append(ul);
      } else s.append(el('p', '', 'The synthetic mode is the default. Real hardware is read-only until it is unlocked in this session and every readiness gate and the owner allowlist pass.'));
      s.append(connectButtons());
      body.append(s);
      drawResult(body, { controller, form }); // the last session's observations stay readable until the next connection
      if (user) drawHistory(body);
    } else if (st === STATE.READ_ONLY_READINESS) drawReadiness(v);
    else if (st === STATE.STOP_VALIDATION_ONLY) {
      const s = section('USB-only stop validation (flight battery disconnected)', 'bt-sec-stopval');
      s.append(el('p', '', 'The flight battery must be disconnected. This state sends external 1000 and nothing else and reads it back from the flight controller. It is an FC command and read-back check: with the ESCs unpowered it cannot show that a motor stopped. The powered stop validation, with the safety checklist, is a separate step.'));
      s.append(proofList(c.proof));
      const a = el('div', 'dg-actions');
      if (c.canConfirmNoRotation) a.append(button('No motor is rotating (I am looking at the motors)', () => controller.confirmNoRotation(), { id: 'btn-no-rotation' }));
      a.append(button('Record the USB-only stop validation and return', () => controller.finishStopValidation(), { id: 'btn-stopval-done', primary: true, disabled: !c.proof.complete }));
      a.append(button('Leave without recording', () => controller.leaveStopValidation(), { id: 'btn-stopval-leave' }));
      s.append(a); body.append(s);
    } else if (st === STATE.SAFE_STATE_INIT) {
      const s = section('Zero-output initialization (USB power only)', 'bt-sec-safe');
      s.append(el('p', '', 'Sending external 1000 to all motors and reading it back from the flight controller. With USB power only this does not show that a motor is stopped.'));
      s.append(proofList(c.proof));
      body.append(s);
    } else if (st === STATE.SAFETY_CHECKLIST) drawChecklist(v);
    else if (st === STATE.READY_TO_CONNECT_POWER) {
      const s = section('Connect the flight battery', 'bt-sec-power');
      s.append(el('p', '', 'The recovery marker is set. Connect the smoke stopper, then the flight battery. Keep the battery plug within reach.'));
      if (!c.batteryDeclared) { const a = el('div', 'dg-actions'); a.append(button('I have connected the battery', () => controller.declareBatteryConnected(), { id: 'btn-battery-connected', primary: true, disabled: !c.canDeclareBattery })); s.append(a); }
      else s.append(el('p', '', `Waiting ${BENCH_TIMINGS.escReadyWaitMs / 1000} s for the ESCs to start. A USB reset during this wait is expected.`));
      body.append(s);
    } else if (st === STATE.POWER_CONNECT_RECONNECT) {
      const s = section('Reconnecting after power', 'bt-sec-reconnect');
      s.append(el('p', '', `The flight controller may reset when the battery connects. Reconnect within ${BENCH_TIMINGS.reconnectGraceMs / 1000} s. No nonzero output is possible here.`));
      refs.live.grace = el('p', 'hint', ''); s.append(refs.live.grace);
      if (!c.transportAvailable) s.append(connectButtons(true));
      else s.append(proofList(c.proof));
      body.append(s);
    } else if (st === STATE.POWERED_ZERO_VERIFICATION) {
      const s = section(c.esc && c.esc.scanned ? 'Zero check after the ESC scan' : 'Powered zero check', 'bt-sec-zero');
      s.append(el('p', '', `Observing all four motors for ${BENCH_TIMINGS.poweredZeroObservationMs / 1000} s of continuous zero RPM (at least ${BENCH_TIMINGS.poweredZeroMinSamples} samples).`));
      const dl = el('p', 'hint', `DShot error statistics with the ESCs powered: ${DSHOT_TEXT[c.dshot.status]}.`); dl.id = 'bt-dshot'; s.append(dl);
      body.append(s);
    } else if (st === STATE.ESC_IDENTIFICATION) drawScan(v);
    else if (st === STATE.POST_SCAN_RESTORE) drawRestore(v);
    else if (st === STATE.POWERED_STOP_VALIDATION) {
      const s = section('Powered stop validation (flight battery connected)', 'bt-sec-powered-stopval');
      s.append(el('p', '', 'The app sends external 1000 repeatedly, reads it back from the flight controller and checks for zero RPM. Look at all four motors. If anything moves, press Stop & zero and disconnect the battery.'));
      const dl = el('p', 'hint', `DShot error statistics with the ESCs powered: ${DSHOT_TEXT[c.dshot.status]}. This is recorded for your review and does not block this validation.`); dl.id = 'bt-dshot'; s.append(dl);
      s.append(proofList(c.proof));
      const a = el('div', 'dg-actions');
      if (c.canConfirmNoRotation) a.append(button('No motor is rotating (I am looking at the motors)', () => controller.confirmNoRotation(), { id: 'btn-no-rotation' }));
      a.append(button('Finish the powered stop validation', () => controller.finishPoweredStopValidation(), { id: 'btn-powered-stopval-done', primary: true, disabled: !c.canFinishPoweredStopValidation }));
      s.append(a); body.append(s);
    } else if (st === STATE.MOTOR_READY) drawMotorReady(v);
    else if (st === STATE.RUNNING) drawRunning(v);
    else if (st === STATE.VERIFYING_STOP) {
      const s = section('Confirming the motor stopped', 'bt-sec-verify', 'sweep');
      s.append(proofList(c.proof));
      const a = el('div', 'dg-actions');
      if (c.canConfirmNoRotation) a.append(button('No motor is rotating (I am looking at the motors)', () => controller.confirmNoRotation(), { id: 'btn-no-rotation', primary: true }));
      s.append(a);
      if (c.needsPosition) {
        s.append(el('p', '', `Which motor did you see spin? Expected for motor ${c.selectedMotor + 1}: ${EXPECTED_POSITIONS[c.selectedMotor]}.`));
        const row = el('div', 'dg-positions');
        for (const p of [...EXPECTED_POSITIONS, POSITION_NONE]) row.append(button(p === POSITION_NONE ? 'None / unsure' : p, () => controller.reportPosition(p), { id: 'btn-pos-' + p.replace(' ', '-') }));
        s.append(row);
      }
      if (c.canFinishStop) { const a2 = el('div', 'dg-actions'); a2.append(button('Finish the stop check', () => controller.completeFinish(), { id: 'btn-finish-stop', primary: true })); s.append(a2); }
      body.append(s);
    } else if (st === STATE.BENCH_COMPLETE) {
      const s = section('Bench session finished', 'bt-sec-complete', 'result');
      s.append(el('p', '', c.poweredStopValidated ? 'The powered stop validation is complete. Disconnect the flight battery and confirm. Download the session record below for review; nothing here is a result about the aircraft.' : 'The stop proof is complete. Disconnect the flight battery and confirm. The observed result is shown below.'));
      const a = el('div', 'dg-actions');
      if (!c.batteryRemoved) a.append(button('The flight battery is disconnected', () => controller.confirmBatteryRemoved(), { id: 'btn-battery-removed', primary: true, disabled: !c.canConfirmBatteryRemoved }));
      else {
        if (c.markerClearFailed) {
          s.append(el('p', 'form-error', v.notes.markerError || 'The recovery marker could not be deleted. Keep the flight battery disconnected: ordinary testing cannot resume until it is removed.'));
          a.append(button('Retry deleting the recovery marker', () => controller.retryMarkerClear(), { id: 'btn-retry-marker' }));
        }
        a.append(button('Start over', () => controller.reset(), { id: 'btn-reset', primary: true, disabled: !c.canReset }));
      }
      s.append(a); body.append(s);
      drawResult(body, { controller, form });
    }
    if (!user && v.transportKind === 'mock' && inject && st !== STATE.DISCONNECTED) body.append(injectPanel());
  }

  // ---- readiness: confirmations, automatic checks, summary (src/preflight/readiness-ui.js builds the three sections)
  function drawReadiness(v) {
    const c = v.caps;
    const holder = el('div'); holder.id = 'bt-readiness';
    body.append(holder);
    const report = v.readiness;
    const pol = c.policy;
    const i = v.identity || {};
    const extraChecks = [];
    if (pol) {
      const ok = !!(pol.nonzeroOk || (pol.gatesOk && !pol.comboReason));
      const matched = !pol.comboReason;
      extraChecks.push({
        id: 'approved-aircraft', title: 'Approved aircraft', status: matched ? 'passed' : 'action',
        text: matched ? 'This flight controller configuration is on the owner-approved list for motor tests.' : `This flight controller configuration is not on the owner-approved list for motor tests. ${pol.comboReason}`,
        evidence: [['Aircraft detected', [i.variant, i.firmware, i.targetName && `${i.targetName}${i.boardId ? ' / ' + i.boardId : ''}`, i.motorProtocol].filter(Boolean).join(' · ') || 'not read'], ['Approval covers', 'Betaflight variant, firmware, API, target, board and DShot protocol. The ESCs are identified automatically later and are not part of the match.'], ['Match', ok ? 'yes' : 'no']],
      });
    }
    const aircraft = el('p', 'hint'); aircraft.id = 'bt-identity';
    aircraft.append(el('b', '', 'Aircraft detected: '), document.createTextNode([i.variant, i.firmware, i.targetName && `${i.targetName}${i.boardId ? ' / ' + i.boardId : ''}`, i.motorProtocol].filter(Boolean).join(' · ') || 'not read'));
    aircraft.append(document.createTextNode('. Check this is the aircraft in front of you. The ESCs are identified automatically after the battery is connected.'));

    const below = [aircraft];
    if (c.mode === 'real' && !c.unlocked) {
      const u = el('div', 'dg-keep'); u.id = 'bt-sec-unlock';
      u.append(el('h3', 'section-title', 'Unlock real-hardware controls (this session only)'));
      u.append(el('p', 'hint', 'The unlock lasts only until you reload, reconnect, hide the page or a fault occurs. It is never stored.'));
      u.append(confirmRow({ id: 'bt-unlock-ack', label: 'I understand that motors can start', help: 'Propellers are removed. The battery plug is within reach.', checked: form.ack, onChange: (val) => { form.ack = val; } }));
      const ph = el('input'); ph.type = 'text'; ph.id = 'bt-unlock-phrase'; ph.value = form.phrase; ph.autocomplete = 'off'; ph.addEventListener('input', () => { form.phrase = ph.value; });
      const lp = el('label', 'dg-field'); lp.append(el('span', '', `Type ${UNLOCK_PHRASE}`), ph);
      u.append(lp, button('Unlock for this session', () => controller.unlock(form.phrase, form.ack), { id: 'btn-unlock' }));
      below.push(u);
    }
    if (c.mode === 'real' && c.unlocked) below.push(el('p', 'hint dg-unlocked', 'Real-hardware controls are unlocked for this session only.'));

    const act = el('div', 'dg-actions'); act.id = 'bt-actions';
    act.append(button('Continue to the safety checklist', () => controller.proceed(), { id: 'btn-proceed', primary: true, disabled: !c.canProceed }));
    act.append(el('p', 'hint', 'Zero-output initialization happens first: the app sends external 1000 to all motors and reads it back, with USB power only. No motor can start until the safety checklist, the battery step and the zero check are done.'));
    if (!user) {
      act.append(button('USB-only stop validation (battery disconnected, external 1000 only)', () => controller.startStopValidation(), { id: 'btn-stopval', disabled: !c.canStopValidation }));
      act.append(button('Powered stop validation (full safety checklist, battery connected, external 1000 only)', () => controller.startPoweredStopValidation(), { id: 'btn-powered-stopval', disabled: !c.canPoweredStopValidation }));
      act.append(el('p', 'hint', c.usbStopValidated ? 'USB-only stop validation recorded for this connection.' : 'The powered stop validation needs the USB-only stop validation to be recorded first in this connection.'));
    }
    act.append(button('Disconnect', () => controller.disconnect(), { id: 'btn-disconnect' }));
    below.push(act);

    const trouble = [el('p', 'hint', 'Read the flight controller again after fixing something in the Betaflight App, or after reconnecting the USB cable.'), button('Read again', () => controller.reread(), { id: 'btn-reread' })];
    renderReadiness(holder, {
      state: viewState({ connected: !!v.snapshot, reading: false, error: null, report }), report, attestations: v.attestations, message: '',
      onAttest: (p) => controller.setAttestation(p), extraChecks, below, troubleshooting: trouble,
    });
    if (!document.getElementById('btn-reread')) { // when nothing is left to troubleshoot the section is hidden; the lab and tests still need a way to read again
      const r = button('Read again', () => controller.reread(), { id: 'btn-reread' }); r.hidden = true; act.append(r);
    }
  }

  function drawChecklist(v) {
    const c = v.caps; const items = controller.machine.ctx.checklist.items;
    const s = section('Physical safety checklist', 'bt-sec-checklist');
    s.append(el('p', '', 'Every item must be confirmed now. The confirmation expires if you reload, reconnect, hide the page, or anything faults.'));
    const list = el('div', 'dg-confirms');
    for (const it of CHECKLIST_ITEMS) {
      const row = confirmRow({ attest: undefined, label: it.text, checked: items[it.key] === true, onChange: (val) => controller.setChecklistItem(it.key, val) });
      row.querySelector('input').dataset.item = it.key;
      list.append(row);
    }
    s.append(list);
    s.append(statusEl({ cls: 'unk', title: 'Disconnecting the battery is the only reliable emergency action', detail: 'Stock firmware has no dependable motor-output timeout. If the browser, the USB link or this page fails while a motor runs, the output can stay on.' }));
    s.append(holdControl({ label: 'Hold to confirm the checklist', ms: BENCH_TIMINGS.holdFinalConfirmMs, id: 'hold-final', disabled: !c.canFinalHold, onComplete: (ms) => controller.confirmChecklist(ms) }));
    if (v.notes.markerError) s.append(el('p', 'form-error', v.notes.markerError));
    if (!c.markerAvailable) s.append(el('p', 'form-error', 'Browser storage is not available, so the recovery marker cannot be written. Powered testing is not allowed.'));
    body.append(s);
  }

  // ---- ESC identification (read only)
  function drawScan(v) {
    const s = section('Identifying the ESCs', 'bt-sec-scan', 'scan');
    s.append(statusEl({ cls: 'unk', title: 'Keep the battery connected and the propellers removed', detail: 'The app is reading each ESC’s own firmware information. It writes nothing, flashes nothing and changes no setting. Motors cannot be commanded during this step.' }));
    s.append(escQuad(v.escScan.channels, EXPECTED_POSITIONS));
    const live = el('p', 'hint', v.escScan.phase === 'leaving' ? 'Leaving ESC mode and restoring normal control…' : v.escScan.phase === 'preparing' ? 'Preparing…' : 'Reading the ESCs one at a time…'); live.id = 'bt-scan-phase'; live.setAttribute('role', 'status'); s.append(live);
    s.append(statusEl({ cls: 'no', title: 'Control state: normal motor commands are unavailable', detail: 'While ESCs are being read the flight controller does not accept the ordinary zero command, so Stop & zero cannot reach the motors. It stops the scan and tries to leave ESC mode. Disconnecting the battery is the only cutoff that always works.' }));
    body.append(s);
  }
  function drawRestore(v) {
    const c = v.caps; const e = c.esc;
    const s = section('Scan finished: restoring normal control', 'bt-sec-restore', 'scan');
    s.append(escSummary(e.result));
    if (e.ackRequired) {
      const w = el('div', 'dg-warnbox'); w.id = 'bt-esc-warning';
      w.append(statusEl({ cls: 'unk', title: 'ESC identification is not complete', detail: `${(e.result && e.result.channels ? e.result.channels.filter((x) => x && x.state !== 'identified').map((x) => 'ESC ' + x.channel).join(', ') : 'Some ESCs')} could not be identified. The motor test can still continue, because normal control is restored and every other safety check still has to pass. This will be recorded with the result. ${RETAIL_NOTE}` }));
      w.append(button(e.acknowledged ? 'Acknowledged' : 'I understand: continue without full identification', () => controller.acknowledgeEscWarning(), { id: 'btn-esc-ack', primary: true, disabled: !c.esc.canAcknowledge }));
      s.append(w);
    }
    const ul = el('ul', 'dg-proof'); ul.id = 'bt-restore-proof';
    const row = (ok, text) => { const li = el('li', ok ? 'done' : ''); li.append(icon(ok ? 'check' : 'clock'), el('span', '', (ok ? 'Done: ' : 'Waiting: ') + text)); ul.append(li); };
    row(true, 'ESC mode left: the flight controller answers normal commands again');
    row(e.identityOk, 'Flight controller identity read again and matches');
    row(c.proof.attempts >= BENCH_TIMINGS.stopMinAttempts, `External 1000 sent ${c.proof.attempts} times (at least ${BENCH_TIMINGS.stopMinAttempts})`);
    row(c.proof.readbackOk, 'Flight controller read-back is 1000 for all four motors');
    row(c.proof.zeroOk, 'Fresh RPM telemetry reads zero for 1 s');
    s.append(el('h3', 'section-title', 'Restoring normal control'), ul, el('p', 'hint', 'When all of this is proven' + (e.ackRequired ? ' and you have acknowledged the warning' : '') + ', the zero check runs again before any motor can be chosen.'));
    body.append(s);
  }

  function motorCells(c) {
    return [0, 1, 2, 3].map((m) => ({ motor: m, position: EXPECTED_POSITIONS[m], state: c.completedMotors.includes(m) ? 'passed' : 'waiting', text: c.completedMotors.includes(m) ? 'Tested' : 'Not tested' }));
  }

  function drawMotorReady(v) {
    const c = v.caps;
    const s = section('Choose a motor to test', 'bt-sec-ready', 'sweep');
    s.append(el('p', '', `Tested motors: ${c.completedMotors.length ? c.completedMotors.map((m) => m + 1).join(', ') : 'none yet'}. Outputs stay at 1000 until you start a sweep. The positions shown are the default quad-X order; the mixer is not read from the flight controller, so confirm the motor by eye.`));
    s.append(quadPicker({ cells: motorCells(c), selected: c.selectedMotor, onPick: (m) => controller.selectMotor(m) }));
    if (c.selectedMotor !== null) {
      s.append(el('p', '', `You are about to test motor ${c.selectedMotor + 1} (${EXPECTED_POSITIONS[c.selectedMotor]}).`));
      const a = el('div', 'dg-actions');
      a.append(button(`I am watching the ${EXPECTED_POSITIONS[c.selectedMotor]} motor`, () => controller.confirmTarget(c.selectedMotor), { id: 'btn-confirm-target', disabled: !c.canConfirmTarget }));
      s.append(a);
      const bad = c.interlocks.filter((i) => !i.ok);
      if (bad.length) {
        const ul = el('ul'); ul.id = 'bt-interlocks';
        for (const i of bad) ul.append(el('li', '', i.why));
        s.append(el('p', '', 'Start is locked because:'), ul);
      }
      s.append(holdControl({ label: 'Hold to start this sweep', ms: BENCH_TIMINGS.holdStartMs, id: 'hold-start', disabled: !c.canStart, onComplete: (ms) => controller.startMotor(ms) }));
    }
    const f = el('div', 'dg-actions'); f.append(button('Finish the bench session', () => controller.finishBench(), { id: 'btn-finish', disabled: !c.canFinish })); s.append(f);
    body.append(s);
    drawResult(body, { controller, form });
  }

  function drawRunning(v) {
    const c = v.caps;
    const s = section(`Motor ${c.selectedMotor + 1} running (${EXPECTED_POSITIONS[c.selectedMotor]})`, 'bt-sec-run', 'sweep');
    const big = el('p', 'dg-bigread'); big.id = 'rd-big'; big.setAttribute('role', 'status'); big.setAttribute('aria-live', 'off'); refs.live['rd-big'] = big; s.append(big);
    const prog = el('progress', 'dg-live-bar'); prog.id = 'rd-progress'; prog.max = MOTOR.cap - MOTOR.stopValue; prog.value = 0; prog.setAttribute('aria-label', 'Output command between stop and the cap'); refs.live['rd-progress'] = prog; s.append(prog);
    s.append(quadPicker({ cells: motorCells(c).map((x, m) => (m === c.selectedMotor ? { ...x, state: 'checking', text: 'Running' } : x)), selected: c.selectedMotor, onPick: null }));
    const dl = el('dl', 'dg-readout');
    for (const [k, id] of [['Phase', 'rd-phase'], ['Output command', 'rd-output'], ['RPM (this motor)', 'rd-rpm'], ['Telemetry age', 'rd-age'], ['Elapsed', 'rd-elapsed']]) {
      const dt = el('dt', '', k); const dd = el('dd', '', '-'); dd.id = id; refs.live[id] = dd; dl.append(dt, dd);
    }
    s.append(dl);
    const adv = el('details', 'dg-details'); adv.append(el('summary', '', 'Advanced readings'));
    const pre = el('pre'); pre.id = 'rd-adv'; refs.live['rd-adv'] = pre; adv.append(pre); s.append(adv);
    s.append(el('p', 'hint', `Provisional limits: output ${MOTOR.startValue} to ${MOTOR.cap} (cap), steps of ${MOTOR.step}, plateau at most ${MOTOR.plateauMaxMs / 1000} s. Press Stop & zero at any time.`));
    body.append(s);
  }

  function injectPanel() {
    const f = el('section', 'dash-card dg-section'); f.id = 'bt-inject';
    f.append(el('h2', 'section-title', 'Synthetic fault injection (simulated flight controller only)'));
    const a = el('div', 'dg-actions');
    for (const [label, key] of [['Simulate USB loss', 'disconnect'], ['Another motor reports rotation', 'peerRpm'], ['Silence telemetry', 'telemetry'], ['Report armed', 'armed']]) a.append(button(label, () => inject(key), { id: 'inj-' + key }));
    f.append(a);
    return f;
  }

  function drawTrace(v) {
    const wasOpen = traceBox.open;
    traceBox.replaceChildren();
    traceBox.append(el('summary', 'section-title', user ? 'Session record' : 'State and transition trace'));
    if (!user) { const pre = el('pre'); pre.id = 'bt-trace'; pre.textContent = traceText(v); traceBox.append(pre); } else traceBox.append(el('p', 'hint', 'A technical record of this session’s steps, for support or review.'));
    traceBox.append(button(user ? 'Download the session record (JSON)' : 'Download trace (JSON)', () => {
      const a = el('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ provisional: BENCH_PROVISIONAL, mode: v.caps.mode, externalStopValue: MOTOR.stopValue, usbStopValidated: v.caps.usbStopValidated, poweredStopValidated: v.caps.poweredStopValidated, dshotStatistics: v.caps.dshot.status, escIdentification: v.caps.esc && v.caps.esc.scanned ? v.caps.esc.result : null, trace: v.trace }, null, 2)], { type: 'application/json' })); a.download = 'bench-trace.json'; document.body.append(a); a.click(); a.remove();
    }, { id: 'btn-trace-download' }));
    traceBox.open = wasOpen;
  }

  // Stop & zero: one tap, no confirmation, in every powered state. The line under it says what is true right now.
  function drawStop(v) {
    stopHost.replaceChildren();
    const c = v.caps;
    if (!c.stopButton) return;
    const scanning = c.state === STATE.ESC_IDENTIFICATION;
    const control = scanning ? 'Normal motor commands are unavailable while the ESCs are read. Stop & zero ends the scan and tries to leave ESC mode; it cannot be shown to reach the motors.'
      : !c.transportAvailable ? 'The connection is lost: a stop cannot be sent. Disconnect the battery.' : '';
    stopHost.append(stopBar({ onStop: () => controller.stopAndZero(), controlText: control }));
  }

  function liveUpdate(v) {
    const L = refs.live || {};
    const c = v.caps;
    if (L['rd-phase'] && v.sweep) {
      const m = v.sweep.motor;
      const tel = v.telemetry && v.telemetry.motors[m];
      L['rd-phase'].textContent = v.sweep.phase === 'ramp' ? 'searching' : v.sweep.phase === 'validate' ? 'confirming rotation' : v.sweep.phase;
      L['rd-output'].textContent = String(v.sweep.output);
      if (L['rd-big']) L['rd-big'].textContent = `Motor ${m + 1}: command ${v.sweep.output}, ${tel ? tel.rpm + ' RPM' : 'RPM unavailable'}`;
      if (L['rd-progress']) L['rd-progress'].value = Math.max(0, v.sweep.output - MOTOR.stopValue);
      L['rd-rpm'].textContent = tel ? String(tel.rpm) : 'unavailable';
      L['rd-age'].textContent = v.telemetryAgeMs === null ? 'none' : `${v.telemetryAgeMs} ms`;
      L['rd-elapsed'].textContent = `${(v.sweep.elapsedMs / 1000).toFixed(1)} s`;
      L['rd-adv'].textContent = JSON.stringify({ rpmAll: v.telemetry ? v.telemetry.motors.map((x) => x.rpm) : null, dshotInvalidPct_centi: v.telemetry ? v.telemetry.motors.map((x) => x.invalidPct_centi) : null, tempsC: v.telemetry ? v.telemetry.motors.map((x) => x.temperatureC) : null, voltage_cV: v.voltage_cV, armed: v.armed, commanded: v.commanded, startThreshold: v.sweep.threshold }, null, 1);
    }
    if (L.grace && c.graceStartedAt !== null) L.grace.textContent = `Waiting for reconnection. Grace period ${BENCH_TIMINGS.reconnectGraceMs / 1000} s.`;
    for (const id of ['bt-trace', 'bt-trace-fault']) { const tr = document.getElementById(id); if (tr) tr.textContent = traceText(v); }
  }

  function signature(v) {
    const c = v.caps;
    return JSON.stringify([c.state, c.mode, c.unlocked, c.selectedMotor, c.targetConfirmed, c.canStart, c.interlocks.map((i) => i.ok), controller.machine.ctx.checklist, c.proof.partsDone, c.proof.complete, c.proof.userNoRotation, c.proof.readbackOk, c.proof.zeroOk,
      c.proof.attempts >= BENCH_TIMINGS.stopMinAttempts, c.batteryDeclared, c.batteryRemoved, c.transportAvailable, c.fault && c.fault.reason, v.notes.markerError, v.notes.proofFailed, v.notes.error, v.notes.message, c.completedMotors, v.analysis && [v.analysis.sweeps, v.analysis.collecting],
      c.policy && [c.policy.nonzeroOk, c.policy.stopValidationOk, c.policy.blockers.length], v.readiness && v.readiness.counts, v.attestations, c.canConfirmNoRotation, c.needsPosition, c.canReset, c.canCompleteRecovery, c.markerAvailable, !!v.snapshot,
      c.flow, canLeaveNow(c), notice(), c.batteryState, c.dshot.status, c.usbStopValidated, c.poweredStopValidated, c.canPoweredStopValidation, c.canFinishPoweredStopValidation, c.markerClearFailed, c.markerClearPending, c.canRetryMarkerClear,
      c.esc && [c.esc.phase, c.esc.scanned, c.esc.acknowledged, c.esc.identityOk, c.esc.canAcknowledge], v.escScan && [v.escScan.phase, v.escScan.channels.map((x) => x.state)]]);
  }

  function render() {
    const v = controller.view();
    const sig = signature(v);
    if (sig !== lastSig) {
      lastSig = sig;
      const y = window.scrollY;
      // a redraw replaces the elements: keep the keyboard user where they were (the same control, found again by its id or its data key)
      const a = document.activeElement;
      const keySel = a && shell.contains(a) ? (a.id ? `#${a.id}` : a.dataset && a.dataset.attest ? `[data-attest="${a.dataset.attest}"]` : a.dataset && a.dataset.item ? `[data-item="${a.dataset.item}"]` : '') : '';
      drawHeader(v); drawBody(v); drawFault(v); drawStop(v); drawTrace(v);
      if (y > 0) window.scrollTo(0, y);
      if (keySel) { const again = shell.querySelector(keySel); if (again && again !== document.activeElement) try { again.focus({ preventScroll: true }); } catch { /* focus is a convenience */ } }
    }
    liveUpdate(v);
  }

  const unsub = controller.subscribe(render);
  render();
  return { render, unsubscribe: unsub };
}
