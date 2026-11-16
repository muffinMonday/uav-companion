// Motor bench test (Phase 3): the developer UI. It owns NO safety rule. Every control's availability comes from
// controller.view().caps (derived by the state machine); every click calls one controller method.
// DOM is built with el() and textContent only. Wording rule: never "safe to fly", airworthy, certified, fault free, or a
// guaranteed result, and never a motor-health verdict (Phase 4 owns analysis).
import { el } from '../cards.js';
import { renderReadiness, viewState } from '../preflight/readiness-ui.js';
import { ESC_FIRMWARE_FAMILIES } from '../preflight/versions.js';
import { BATTERY_INSTRUCTION, BENCH_PROVISIONAL, BENCH_TIMINGS, CHECKLIST_ITEMS, EXPECTED_POSITIONS, MOTOR, POSITION_NONE, UNLOCK_PHRASE } from './constants.js';
import { STATE } from './state-machine.js';

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
  'unclean-exit': 'A previous bench session may have ended with the battery connected.',
});
const reasonText = (r) => REASON_TEXT[r] || (String(r).startsWith('visibility-or-focus-lost') ? 'The page was hidden or lost focus while powered.' : String(r).startsWith('invalid-transition') || String(r).startsWith('guard:') ? 'An unexpected action occurred.' : String(r));

const traceText = (v) => v.trace.slice(-80).map((e) => `${String(e.seq).padStart(4)} ${e.from} -> ${e.to}  ${e.event}${e.ok ? '' : '  REJECTED: ' + e.reason}${e.ok && e.reason ? '  (' + e.reason + ')' : ''}`).join('\n');

const btn = (text, onClick, { id, cls = '', disabled = false } = {}) => {
  const b = el('button', cls, text); b.type = 'button'; if (id) b.id = id; b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
};

// Press-and-hold with keyboard and switch-accessible equivalents. onComplete(holdMs) runs only after an uninterrupted hold.
function holdControl({ label, ms, onComplete, id, disabled }) {
  const wrap = el('div', 'bt-hold');
  const b = el('button', 'bt-holdbtn', label); b.type = 'button'; b.id = id; b.disabled = !!disabled;
  const bar = el('span', 'bt-holdbar'); b.append(bar);
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
  const alt = el('button', 'bt-altbtn', `Timed confirm (switch or single-button access): ${ms / 1000} s countdown`); alt.type = 'button'; alt.id = id + '-timed'; alt.disabled = !!disabled;
  const status = el('span', 'bt-holdstatus'); status.setAttribute('role', 'status');
  let altTimer = null;
  alt.addEventListener('click', () => {
    if (altTimer !== null) { clearTimeout(altTimer); altTimer = null; status.textContent = 'Cancelled.'; return; }
    status.textContent = `Confirming in ${ms / 1000} s. Activate again to cancel.`;
    altTimer = setTimeout(() => { altTimer = null; status.textContent = ''; onComplete(ms); }, ms);
  });
  wrap.append(b, alt, status);
  return wrap;
}

export function mountBench(root, { controller, onConnectMock, onConnectReal, realAvailable, inject }) {
  const form = { phrase: '', ack: false };
  const refs = {};
  let lastSig = '';
  let overlay = null;

  const shell = el('div', 'bt-shell');
  const banner = el('section', 'bt-banner');
  const body = el('div', 'bt-body');
  const traceBox = el('details', 'bt-trace');
  const stopWrap = el('div', 'bt-stopwrap');
  root.replaceChildren(shell);
  shell.append(banner, body, traceBox, stopWrap);

  function drawBanner(v) {
    banner.replaceChildren();
    banner.append(el('h1', '', 'Motor bench test (Phase 3 developer prototype)'));
    const mode = el('p', `bt-mode ${v.caps.mode === 'real' ? 'bt-real' : 'bt-mock'}`);
    mode.id = 'bt-mode'; mode.dataset.mode = v.caps.mode || 'none';
    mode.textContent = v.caps.mode === 'real' ? 'REAL HARDWARE MODE: motor outputs are possible when every interlock passes. Propellers must be removed.' : v.caps.mode === 'mock' ? 'SYNTHETIC MODE: a simulated flight controller. No real hardware is connected or commanded.' : 'No flight controller connected. Default mode is synthetic and read-only.';
    banner.append(mode);
    banner.append(el('p', '', 'Experimental developer bench tool for propeller-free testing. It is not part of the app, not hardware-validated and not a statement about any aircraft. All numeric limits are provisional and unmeasured.'));
    banner.append(el('p', 'bt-small', 'This page is an unlinked static route. Being unlinked is not access control: anyone with the address can open it. Real-hardware controls stay locked until they are unlocked in this session.'));
  }

  function drawFault(v) {
    const c = v.caps;
    const show = c.showBatteryInstruction;
    if (!show) { if (overlay) { overlay.remove(); overlay = null; } return; }
    if (!overlay) { overlay = el('div', 'bt-overlay'); overlay.setAttribute('role', 'alertdialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'bt-fault-title'); shell.append(overlay); }
    overlay.replaceChildren();
    const h = el('h2', 'bt-fault-title', BATTERY_INSTRUCTION); h.id = 'bt-fault-title';
    overlay.append(h);
    overlay.append(el('p', 'bt-fault-lead', 'Physical battery disconnection is the only reliable emergency action. Do it first, then read the rest.'));
    if (c.fault) overlay.append(el('p', 'bt-reason', `Why: ${reasonText(c.fault.reason)}`));
    if (c.state === STATE.UNCLEAN_EXIT_RECOVERY) overlay.append(el('p', '', reasonText('unclean-exit') + ' Treat the battery state as unknown.'));
    if (c.state === STATE.LOCKED_FAULT) {
      if (!c.transportAvailable) overlay.append(el('p', 'bt-warn', 'The connection to the flight controller is lost. The app cannot stop or verify the motors. Do not reconnect the battery until the aircraft has been inspected.'));
      else {
        overlay.append(el('p', '', 'The app is sending external 1000 and verifying the stop. This does not replace disconnecting the battery.'));
        overlay.append(proofList(c.proof));
        if (v.notes.proofFailed) overlay.append(el('p', 'bt-warn', 'The stop could not be confirmed. Treat the motors as possibly running.'));
        if (c.canConfirmNoRotation) overlay.append(btn('No motor is rotating (I am looking at the motors)', () => controller.confirmNoRotation(), { id: 'btn-no-rotation' }));
      }
      overlay.append(btn('I have disconnected the battery: continue to recovery', () => controller.beginBatteryRemoval(), { id: 'btn-begin-removal' }));
    }
    if (c.state === STATE.BATTERY_REMOVAL_RECOVERY || c.state === STATE.UNCLEAN_EXIT_RECOVERY) {
      const ol = el('ol');
      const step = (text, done) => { const li = el('li', done ? 'bt-done' : '', (done ? 'Done: ' : '') + text); ol.append(li); };
      step('Disconnect the flight battery and confirm below.', c.batteryRemoved);
      step('Connect the flight controller by USB only.', c.transportAvailable);
      step('The app sends external 1000, reads it back from the flight controller and checks for zero RPM.', c.proof.partsDone);
      step('Confirm that no motor is rotating.', c.proof.userNoRotation);
      overlay.append(ol);
      if (!c.batteryRemoved) overlay.append(btn('The flight battery is disconnected', () => controller.confirmBatteryRemoved(), { id: 'btn-battery-removed' }));
      if (!c.transportAvailable) overlay.append(connectButtons(true));
      else overlay.append(proofList(c.proof));
      if (c.canConfirmNoRotation) overlay.append(btn('No motor is rotating (I am looking at the motors)', () => controller.confirmNoRotation(), { id: 'btn-no-rotation' }));
      if (c.canCompleteRecovery) overlay.append(btn('Complete recovery and clear the marker', () => controller.completeRecovery(), { id: 'btn-complete-recovery' }));
      if (v.notes.markerError) overlay.append(el('p', 'bt-warn', v.notes.markerError));
    }
    const td = el('details', 'bt-trace-fault'); td.append(el('summary', '', 'State and transition trace'));
    const tp = el('pre'); tp.id = 'bt-trace-fault'; tp.textContent = traceText(v); td.append(tp); overlay.append(td);
  }

  function proofList(p) {
    const ul = el('ul', 'bt-proof'); ul.id = 'bt-proof';
    const row = (ok, text) => { const li = el('li', ok ? 'bt-done' : ''); li.textContent = (ok ? '✓ ' : '… ') + text; ul.append(li); };
    row(p.attempts >= BENCH_TIMINGS.stopMinAttempts, `External 1000 sent ${p.attempts} times (at least ${BENCH_TIMINGS.stopMinAttempts}, every ${BENCH_TIMINGS.stopCadenceMs} ms)`);
    row(p.readbackOk, 'Flight controller read-back is 1000 for all four motors (this is not proof the motors stopped)');
    row(p.zeroOk, 'Valid RPM reads zero for 1 s');
    row(p.userNoRotation, 'You confirm no motor is rotating');
    return ul;
  }

  function connectButtons(recovery = false) {
    const d = el('div', 'bt-connect');
    d.append(btn(recovery ? 'Reconnect the synthetic flight controller' : 'Start synthetic bench (simulated flight controller)', onConnectMock, { id: 'btn-connect-mock', cls: 'bt-primary' }));
    d.append(btn(recovery ? 'Reconnect a real flight controller (USB)' : 'Connect a real flight controller (USB, read-only first)', onConnectReal, { id: 'btn-connect-real', disabled: !realAvailable }));
    if (!realAvailable) d.append(el('p', 'bt-small', 'Web Serial is not available in this browser, so only the synthetic mode can be used.'));
    return d;
  }

  function section(title, id) { const s = el('section', 'bt-section'); s.id = id; s.append(el('h2', '', title)); return s; }

  function drawBody(v) {
    const c = v.caps;
    body.replaceChildren();
    refs.live = {};
    if (c.showBatteryInstruction && c.state !== STATE.LOCKED_FAULT && c.state !== STATE.BATTERY_REMOVAL_RECOVERY && c.state !== STATE.UNCLEAN_EXIT_RECOVERY) return;
    const st = c.state;
    body.dataset.state = st;
    const stateLine = el('p', 'bt-stateline'); stateLine.id = 'bt-state'; stateLine.textContent = st; stateLine.dataset.state = st;
    body.append(stateLine);
    if (v.notes.error || v.notes.message) { const m = el('p', 'bt-note', v.notes.error || v.notes.message); m.setAttribute('role', 'status'); body.append(m); }

    if (st === STATE.DISCONNECTED) {
      const s = section('Connect', 'bt-sec-connect');
      s.append(el('p', '', 'The synthetic mode is the default. Real hardware is read-only until it is unlocked in this session and every readiness gate and the owner allowlist pass.'));
      s.append(connectButtons());
      body.append(s);
    } else if (st === STATE.READ_ONLY_READINESS) drawReadiness(v);
    else if (st === STATE.STOP_VALIDATION_ONLY) {
      const s = section('Stop validation only', 'bt-sec-stopval');
      s.append(el('p', '', 'This state can send external 1000 and nothing else. It checks the stop proof for this combination without any nonzero output.'));
      s.append(proofList(c.proof));
      if (c.canConfirmNoRotation) s.append(btn('No motor is rotating (I am looking at the motors)', () => controller.confirmNoRotation(), { id: 'btn-no-rotation' }));
      s.append(btn('Record the stop validation and return', () => controller.finishStopValidation(), { id: 'btn-stopval-done', disabled: !c.proof.complete }));
      s.append(btn('Leave without recording', () => controller.leaveStopValidation(), { id: 'btn-stopval-leave' }));
      body.append(s);
    } else if (st === STATE.SAFE_STATE_INIT) {
      const s = section('Safe-state initialization (USB power only)', 'bt-sec-safe');
      s.append(el('p', '', 'Sending external 1000 to all motors and reading it back from the flight controller. With USB power only this does not show that a motor is stopped.'));
      s.append(proofList(c.proof));
      body.append(s);
    } else if (st === STATE.SAFETY_CHECKLIST) drawChecklist(v);
    else if (st === STATE.READY_TO_CONNECT_POWER) {
      const s = section('Ready to connect power', 'bt-sec-power');
      s.append(el('p', '', 'The recovery marker is set. Connect the smoke stopper, then the flight battery. Keep the battery plug within reach.'));
      if (!c.batteryDeclared) s.append(btn('I have connected the battery', () => controller.declareBatteryConnected(), { id: 'btn-battery-connected', disabled: !c.canDeclareBattery }));
      else s.append(el('p', '', `Waiting ${BENCH_TIMINGS.escReadyWaitMs / 1000} s for the ESCs to start. A USB reset during this wait is expected.`));
      body.append(s);
    } else if (st === STATE.POWER_CONNECT_RECONNECT) {
      const s = section('Reconnecting after power', 'bt-sec-reconnect');
      s.append(el('p', '', `The flight controller may reset when the battery connects. Reconnect within ${BENCH_TIMINGS.reconnectGraceMs / 1000} s. No nonzero output is possible here.`));
      refs.live.grace = el('p', 'bt-live', ''); s.append(refs.live.grace);
      if (!c.transportAvailable) s.append(connectButtons(true));
      else s.append(proofList(c.proof));
      body.append(s);
    } else if (st === STATE.POWERED_ZERO_VERIFICATION) {
      const s = section('Powered-zero verification', 'bt-sec-zero');
      s.append(el('p', '', `Observing all four motors for ${BENCH_TIMINGS.poweredZeroObservationMs / 1000} s continuous zero RPM (at least ${BENCH_TIMINGS.poweredZeroMinSamples} samples).`));
      body.append(s);
    } else if (st === STATE.MOTOR_READY) drawMotorReady(v);
    else if (st === STATE.RUNNING) drawRunning(v);
    else if (st === STATE.VERIFYING_STOP) {
      const s = section('Verifying the stop', 'bt-sec-verify');
      s.append(proofList(c.proof));
      if (c.canConfirmNoRotation) s.append(btn('No motor is rotating (I am looking at the motors)', () => controller.confirmNoRotation(), { id: 'btn-no-rotation' }));
      if (c.needsPosition) {
        s.append(el('p', 'bt-q', `Which motor did you see spin? Expected for motor ${c.selectedMotor + 1}: ${EXPECTED_POSITIONS[c.selectedMotor]}.`));
        const row = el('div', 'bt-positions');
        for (const p of [...EXPECTED_POSITIONS, POSITION_NONE]) row.append(btn(p === POSITION_NONE ? 'None / unsure' : p, () => controller.reportPosition(p), { cls: 'bt-pos', id: 'btn-pos-' + p.replace(' ', '-') }));
        s.append(row);
      }
      if (c.canFinishStop) s.append(btn('Finish the stop check', () => controller.completeFinish(), { id: 'btn-finish-stop' }));
      body.append(s);
    } else if (st === STATE.BENCH_COMPLETE) {
      const s = section('Bench session finished', 'bt-sec-complete');
      s.append(el('p', '', 'The stop proof is complete. Disconnect the flight battery and confirm. No result or health judgement is produced here.'));
      if (!c.batteryRemoved) s.append(btn('The flight battery is disconnected', () => controller.confirmBatteryRemoved(), { id: 'btn-battery-removed', disabled: !c.canConfirmBatteryRemoved }));
      else s.append(btn('Start over', () => controller.reset(), { id: 'btn-reset', disabled: !c.canReset }));
      body.append(s);
    }
    if (v.transportKind === 'mock' && inject && st !== STATE.DISCONNECTED) body.append(injectPanel());
  }

  function drawReadiness(v) {
    const c = v.caps;
    const holder = el('div'); holder.id = 'bt-readiness';
    body.append(holder);
    const report = v.readiness;
    renderReadiness(holder, {
      state: viewState({ connected: !!v.snapshot, reading: false, error: null, report }), report, attestations: v.attestations, message: '',
      onAttest: (p) => controller.setAttestation(p),
    });
    const esc = el('fieldset', 'bt-esc');
    esc.append(el('legend', '', 'ESC identity (entered by you; not readable from the flight controller)'));
    const fam = el('select'); fam.id = 'bt-esc-family'; for (const f of ['', ...ESC_FIRMWARE_FAMILIES]) { const o = el('option', '', f || 'not entered'); o.value = f; fam.append(o); }
    fam.value = v.manual.escFamily || ''; fam.addEventListener('change', () => controller.setManual({ escFamily: fam.value }));
    const model = el('input'); model.type = 'text'; model.id = 'bt-esc-model'; model.value = v.manual.escModel || ''; model.placeholder = 'ESC model and firmware version';
    model.addEventListener('change', () => controller.setManual({ escModel: model.value.trim() }));
    const l1 = el('label'); l1.append('ESC firmware family: ', fam); const l2 = el('label'); l2.append('ESC model / version: ', model);
    esc.append(l1, l2); body.append(esc);

    const pol = section('Phase 3 policy', 'bt-sec-policy');
    pol.append(el('p', '', 'Nonzero output needs: every readiness gate free of "Blocked" and "Not confirmed", an exact match on the owner-approved test allowlist, and for real hardware the session unlock.'));
    const pl = el('ul', 'bt-blockers'); pl.id = 'bt-blockers';
    const pol3 = c.policy;
    if (pol3) { for (const b of pol3.blockers) pl.append(el('li', '', b.reason)); if (!pol3.nonzeroOk) pl.append(el('li', 'bt-allow', 'Allowlist: ' + pol3.comboReason)); }
    else pl.append(el('li', '', 'No policy result yet.'));
    pol.append(pl);
    body.append(pol);

    if (c.mode === 'real' && !c.unlocked) {
      const u = section('Unlock real-hardware controls (this session only)', 'bt-sec-unlock');
      u.append(el('p', '', 'The unlock lasts only until you reload, reconnect, hide the page or a fault occurs. It is never stored.'));
      const ack = el('input'); ack.type = 'checkbox'; ack.id = 'bt-unlock-ack'; ack.checked = form.ack; ack.addEventListener('change', () => { form.ack = ack.checked; });
      const la = el('label'); la.append(ack, ' I understand that motors can start. Propellers are removed. The battery plug is within reach.');
      const ph = el('input'); ph.type = 'text'; ph.id = 'bt-unlock-phrase'; ph.value = form.phrase; ph.autocomplete = 'off'; ph.addEventListener('input', () => { form.phrase = ph.value; });
      const lp = el('label'); lp.append(`Type ${UNLOCK_PHRASE}: `, ph);
      u.append(la, lp, btn('Unlock for this session', () => controller.unlock(form.phrase, form.ack), { id: 'btn-unlock' }));
      body.append(u);
    }
    if (c.mode === 'real' && c.unlocked) body.append(el('p', 'bt-unlocked', 'Real-hardware controls are unlocked for this session only.'));

    const act = el('div', 'bt-actions');
    act.append(btn('Continue to safe-state initialization', () => controller.proceed(), { id: 'btn-proceed', cls: 'bt-primary', disabled: !c.canProceed }));
    act.append(btn('Stop validation only (external 1000, no nonzero output)', () => controller.startStopValidation(), { id: 'btn-stopval', disabled: !c.canStopValidation }));
    act.append(btn('Read again', () => controller.reread(), { id: 'btn-reread' }));
    act.append(btn('Disconnect', () => controller.disconnect(), { id: 'btn-disconnect' }));
    body.append(act);
  }

  function drawChecklist(v) {
    const c = v.caps; const items = controller.machine.ctx.checklist.items;
    const s = section('Physical safety checklist', 'bt-sec-checklist');
    s.append(el('p', '', 'Every item must be confirmed now. The confirmation expires if you reload, reconnect, hide the page, or anything faults.'));
    const ul = el('ul', 'bt-checklist');
    for (const it of CHECKLIST_ITEMS) {
      const li = el('li'); const l = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = items[it.key] === true; cb.dataset.item = it.key;
      cb.addEventListener('change', () => controller.setChecklistItem(it.key, cb.checked));
      l.append(cb, ' ' + it.text); li.append(l); ul.append(li);
    }
    s.append(ul);
    s.append(el('p', 'bt-warn', 'Stock firmware has no dependable motor-output timeout. If the browser, the USB link or this page fails while a motor runs, the output can stay on. Disconnecting the battery is the only reliable emergency action.'));
    s.append(holdControl({ label: 'Hold to confirm the checklist', ms: BENCH_TIMINGS.holdFinalConfirmMs, id: 'hold-final', disabled: !c.canFinalHold, onComplete: (ms) => controller.confirmChecklist(ms) }));
    if (v.notes.markerError) s.append(el('p', 'bt-warn', v.notes.markerError));
    if (!c.markerAvailable) s.append(el('p', 'bt-warn', 'Browser storage is not available, so the recovery marker cannot be written. Powered testing is not allowed.'));
    body.append(s);
  }

  function quad(selected, onPick) {
    const g = el('div', 'bt-quad'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Motor positions, front at the top');
    for (const m of [3, 1, 2, 0]) { // front left, front right, rear left, rear right
      const b = btn(`Motor ${m + 1}: ${EXPECTED_POSITIONS[m]}`, () => onPick(m), { cls: 'bt-cell' + (selected === m ? ' bt-selected' : ''), id: 'btn-motor-' + (m + 1), disabled: !onPick });
      b.dataset.motor = String(m); b.setAttribute('aria-pressed', String(selected === m)); g.append(b);
    }
    return g;
  }

  function drawMotorReady(v) {
    const c = v.caps;
    const s = section('Motor ready (outputs stay at 1000 until you start a sweep)', 'bt-sec-ready');
    s.append(el('p', '', `Completed motors: ${c.completedMotors.length ? c.completedMotors.map((m) => m + 1).join(', ') : 'none'}. The order shown is the default quad-X order; the mixer is not read from the flight controller.`));
    s.append(quad(c.selectedMotor, (m) => controller.selectMotor(m)));
    if (c.selectedMotor !== null) {
      s.append(el('p', 'bt-q', `You are about to test motor ${c.selectedMotor + 1} (${EXPECTED_POSITIONS[c.selectedMotor]}).`));
      s.append(btn(`I am watching the ${EXPECTED_POSITIONS[c.selectedMotor]} motor`, () => controller.confirmTarget(c.selectedMotor), { id: 'btn-confirm-target', disabled: !c.canConfirmTarget }));
      const bad = c.interlocks.filter((i) => !i.ok);
      const ul = el('ul', 'bt-interlocks'); ul.id = 'bt-interlocks';
      for (const i of bad) ul.append(el('li', '', i.why));
      if (bad.length) s.append(el('p', '', 'Start is locked because:'), ul);
      s.append(holdControl({ label: 'Hold to start this sweep', ms: BENCH_TIMINGS.holdStartMs, id: 'hold-start', disabled: !c.canStart, onComplete: (ms) => controller.startMotor(ms) }));
    }
    s.append(btn('Finish the bench session', () => controller.finishBench(), { id: 'btn-finish', disabled: !c.canFinish }));
    body.append(s);
  }

  function drawRunning(v) {
    const c = v.caps;
    const s = section(`Motor ${c.selectedMotor + 1} running (${EXPECTED_POSITIONS[c.selectedMotor]})`, 'bt-sec-run');
    s.append(quad(c.selectedMotor, null));
    const dl = el('dl', 'bt-readout');
    for (const [k, id] of [['Phase', 'rd-phase'], ['Output command', 'rd-output'], ['RPM (this motor)', 'rd-rpm'], ['Telemetry age', 'rd-age'], ['Elapsed', 'rd-elapsed']]) {
      const dt = el('dt', '', k); const dd = el('dd', '', '-'); dd.id = id; refs.live[id] = dd; dl.append(dt, dd);
    }
    s.append(dl);
    const adv = el('details', 'bt-adv'); adv.append(el('summary', '', 'Advanced readings'));
    const pre = el('pre'); pre.id = 'rd-adv'; refs.live['rd-adv'] = pre; adv.append(pre); s.append(adv);
    s.append(el('p', 'bt-small', `Provisional limits: output ${MOTOR.startValue} to ${MOTOR.cap} (cap), steps of ${MOTOR.step}, plateau at most ${MOTOR.plateauMaxMs / 1000} s. Press Stop & zero at any time.`));
    body.append(s);
  }

  function injectPanel() {
    const f = el('fieldset', 'bt-inject'); f.id = 'bt-inject';
    f.append(el('legend', '', 'Synthetic fault injection (simulated flight controller only)'));
    for (const [label, key] of [['Simulate USB loss', 'disconnect'], ['Another motor reports rotation', 'peerRpm'], ['Silence telemetry', 'telemetry'], ['Report armed', 'armed']]) {
      f.append(btn(label, () => inject(key), { id: 'inj-' + key }));
    }
    return f;
  }

  function drawTrace(v) {
    const wasOpen = traceBox.open;
    traceBox.replaceChildren();
    traceBox.append(el('summary', '', 'State and transition trace'));
    const pre = el('pre'); pre.id = 'bt-trace';
    pre.textContent = traceText(v);
    traceBox.append(pre);
    traceBox.append(btn('Download trace (JSON)', () => {
      const a = el('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ provisional: BENCH_PROVISIONAL, mode: v.caps.mode, trace: v.trace }, null, 2)], { type: 'application/json' })); a.download = 'bench-trace.json'; document.body.append(a); a.click(); a.remove();
    }, { id: 'btn-trace-download' }));
    traceBox.open = wasOpen;
  }

  function drawStop(v) {
    stopWrap.replaceChildren();
    if (!v.caps.stopButton) return;
    const b = btn('Stop & zero', () => controller.stopAndZero(), { id: 'btn-stop-zero', cls: 'bt-stop' });
    b.setAttribute('aria-label', 'Stop and zero: send external 1000 to all motors now');
    stopWrap.append(b);
  }

  function liveUpdate(v) {
    const L = refs.live || {};
    const c = v.caps;
    if (L['rd-phase'] && v.sweep) {
      const m = v.sweep.motor;
      const tel = v.telemetry && v.telemetry.motors[m];
      L['rd-phase'].textContent = v.sweep.phase === 'ramp' ? 'searching' : v.sweep.phase === 'validate' ? 'confirming rotation' : v.sweep.phase;
      L['rd-output'].textContent = String(v.sweep.output);
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
      c.proof.attempts >= BENCH_TIMINGS.stopMinAttempts, c.batteryDeclared, c.batteryRemoved, c.transportAvailable, c.fault && c.fault.reason, v.notes.markerError, v.notes.proofFailed, v.notes.error, v.notes.message, c.completedMotors,
      c.policy && [c.policy.nonzeroOk, c.policy.stopValidationOk, c.policy.blockers.length], v.readiness && v.readiness.counts, v.attestations, v.manual, c.canConfirmNoRotation, c.needsPosition, c.canReset, c.canCompleteRecovery, c.markerAvailable, !!v.snapshot]);
  }

  function render() {
    const v = controller.view();
    const sig = signature(v);
    if (sig !== lastSig) {
      lastSig = sig;
      drawBanner(v); drawBody(v); drawFault(v); drawStop(v); drawTrace(v);
    }
    liveUpdate(v);
  }

  const unsub = controller.subscribe(render);
  render();
  return { render, unsubscribe: unsub };
}
