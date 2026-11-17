// Motor bench test: page lifecycle for the lab and the user-facing workspace. A hidden page may still attempt a stop, but this is
// never relied on: a frozen or terminated page runs no code, and the durable recovery marker covers that case.
import { STATE } from './state-machine.js';

// States in which leaving the page is harmless: nothing is powered and no output path is armed.
export const UNPOWERED = new Set([STATE.DISCONNECTED, STATE.READ_ONLY_READINESS]);
export const canLeaveNow = (caps) => UNPOWERED.has(caps.state) || (caps.state === STATE.BENCH_COMPLETE && caps.canReset === true);

export function installLifecycle(controller, { guardHistory = false, onBlockedNavigation = () => {} } = {}) {
  const lose = (kind) => controller.notifyVisibilityLoss(kind);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lose('hidden'); });
  window.addEventListener('pagehide', () => lose('pagehide'));
  window.addEventListener('blur', () => lose('blur'));
  document.addEventListener('freeze', () => lose('freeze'));
  // A page restored from the back/forward cache would keep its in-memory unlock: start fresh instead.
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  window.addEventListener('beforeunload', (e) => {
    const s = controller.view().caps;
    if (s.stopButton && !UNPOWERED.has(s.state)) { controller.stopAndZero(); e.preventDefault(); e.returnValue = ''; }
  });
  if (guardHistory) {
    // The browser's Back button leaves the page too. While anything is powered, absorb it and say why; it cannot be guaranteed
    // (a closed tab or a forced close is uncontrollable), so the recovery marker still applies.
    history.pushState({ motorDiag: true }, '');
    window.addEventListener('popstate', () => {
      const s = controller.view().caps;
      if (canLeaveNow(s)) return;
      history.pushState({ motorDiag: true }, '');
      onBlockedNavigation();
    });
  }
}
