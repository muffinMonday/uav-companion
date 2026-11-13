// Polite repetition: how long to wait before asking the server again after a failure, and whether a background request should be made right now at all.
// The polls (shared trips, live positions, friends, progression) and the location sender used to repeat at their fixed pace whether or not the server answered;
// a failing server or a dead network then got the same traffic as a healthy one.
import { log } from './log.js';

/**
 * Exponential back-off with jitter. fail() doubles the wait (base, 2 x base, ... up to max, each varied by +/-25 % so many clients do not return together);
 * ok() resets it. ready() says whether the wait is over. `now` and `rand` can be replaced (tests).
 * With a `name`, a streak of failures leaves a few notes in the local log (log.js) instead of one per tick: the first failure, the 5th and the 20th, and the
 * recovery after a streak of 3 or more. fail(err) may pass the error so its type is noted.
 */
export function createBackoff({ base = 5000, max = 120000, jitter = 0.25, now = () => Date.now(), rand = Math.random, name = '' } = {}) {
  let fails = 0, until = 0;
  const note = (level, msg, data) => { if (name) log[level]('backoff', name + ' ' + msg, data); };
  return {
    ready: () => now() >= until,
    /** Records a failure and returns the wait in milliseconds. */
    fail(err) {
      fails += 1;
      const wait = Math.round(Math.min(max, base * 2 ** (fails - 1)) * (1 - jitter + 2 * jitter * rand()));
      until = now() + wait;
      if (fails === 1 || fails === 5 || fails === 20) note('warn', fails === 1 ? 'is failing' : 'is still failing', { attempt: fails, ms: wait, error_name: err instanceof Error ? err.name : undefined });
      return wait;
    },
    ok() { if (fails >= 3) note('warn', 'recovered', { attempt: fails }); fails = 0; until = 0; },
    failures: () => fails,
  };
}

/** Is a background request worth making now: the page is in view and the browser has not said it is offline. */
export const canPoll = () => (typeof document === 'undefined' || document.visibilityState === 'visible') && globalThis.navigator?.onLine !== false;
