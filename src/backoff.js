// Polite repetition: how long to wait before asking the server again after a failure, and whether a background request should be made right now at all.
// The polls (shared trips, live positions, friends, progression) and the location sender used to repeat at their fixed pace whether or not the server answered;
// a failing server or a dead network then got the same traffic as a healthy one.

/**
 * Exponential back-off with jitter. fail() doubles the wait (base, 2 x base, ... up to max, each varied by +/-25 % so many clients do not return together);
 * ok() resets it. ready() says whether the wait is over. `now` and `rand` can be replaced (tests).
 */
export function createBackoff({ base = 5000, max = 120000, jitter = 0.25, now = () => Date.now(), rand = Math.random } = {}) {
  let fails = 0, until = 0;
  return {
    ready: () => now() >= until,
    /** Records a failure and returns the wait in milliseconds. */
    fail() {
      fails += 1;
      const wait = Math.round(Math.min(max, base * 2 ** (fails - 1)) * (1 - jitter + 2 * jitter * rand()));
      until = now() + wait;
      return wait;
    },
    ok() { fails = 0; until = 0; },
    failures: () => fails,
  };
}

/** Is a background request worth making now: the page is in view and the browser has not said it is offline. */
export const canPoll = () => (typeof document === 'undefined' || document.visibilityState === 'visible') && globalThis.navigator?.onLine !== false;
