// The diagnostic logger: one place for "something went wrong" notes, kept in this browser only (logstore.js), never sent anywhere.
//
//   log.warn('live', 'position send failed', err)           an Error as third argument gives error_name and a trimmed stack
//   log.error('sync', 'could not apply settings', { status: 503 })   only allow-listed data keys are kept (logscrub.js)
//   const l = log.child('live'); l.info('started')
//
// Levels are debug < info < warn < error. The threshold is WARN, or DEBUG when the visitor opened the app once with ?debug=1 (?debug=0 turns it off again). The flag
// is stored under its own localStorage key, not in the preferences, so it is never synced to another device.
// The logger never throws, never waits for storage, and repeats of the same message within a minute raise a count instead of adding entries.
import { scrubEntry, scrubText } from './logscrub.js';
import { createLogStore } from './logstore.js';

export const DEBUG_KEY = 'uavzones.v1.debug';
const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
const DEDUPE_MS = 60 * 1000;
const DEDUPE_MAX = 100;

/** Reads and applies a `?debug=1|0` in a query string; returns whether debug is now on. Storage failures (even reaching localStorage throws when it is blocked) leave it as it was. */
export function applyDebugParam(search, storage) {
  try {
    const st = storage || globalThis.localStorage;
    const v = new URLSearchParams(search || '').get('debug');
    if (v === '1') st.setItem(DEBUG_KEY, '1');
    else if (v === '0') st.removeItem(DEBUG_KEY);
  } catch { /* blocked storage */ }
  return readDebug(storage);
}
export function readDebug(storage) {
  try { return (storage || globalThis.localStorage).getItem(DEBUG_KEY) === '1'; } catch { return false; }
}

/**
 * createLog({ sink, debug, now, console }) -> the logger. `sink` needs put(entry) (a log store). `debug` is a function returning whether debug is on.
 * Errors that were logged are remembered (weakly) so the global handlers do not log the same error again; see seen().
 */
export function createLog({ sink = null, debug = () => false, now = () => Date.now(), mirror = globalThis.console } = {}) {
  let seq = 0, busy = false;
  const recent = new Map(); // fingerprint -> entry (for repeat counting)
  const logged = new WeakSet();

  function record(level, src, msg, extra, opts = {}) {
    if (busy) return null; // logging while logging (a failing sink or console): drop, never recurse
    busy = true;
    try {
      if (ORDER[level] < (debug() ? ORDER.debug : ORDER.warn)) return null;
      const t = now();
      let text = msg, data = null, stack;
      if (extra instanceof Error) {
        logged.add(extra);
        data = { error_name: extra.name };
        stack = extra.stack;
        text = String(msg) + (extra.message ? ': ' + extra.message : '');
      } else if (extra && typeof extra === 'object') data = extra;
      const entry = scrubEntry({ id: t * 1000 + (seq++ % 1000), t, level, src, msg: text, data, stack });
      const fp = level + '|' + entry.src + '|' + entry.msg;
      const prev = recent.get(fp);
      if (prev && t - (prev.last || prev.t) < DEDUPE_MS) {
        prev.count += 1; prev.last = t;
        try { sink?.put(prev); } catch { /* ignore */ }
        return prev;
      }
      for (const [k, e] of recent) if (t - (e.last || e.t) >= DEDUPE_MS) recent.delete(k);
      if (recent.size >= DEDUPE_MAX) recent.delete(recent.keys().next().value);
      recent.set(fp, entry);
      try { sink?.put(entry); } catch { /* ignore */ }
      // Errors keep reaching the browser console as before (the console calls this replaces), the rest only while debugging. The global handlers pass mirror:false: the browser has reported those itself.
      if (opts.mirror !== false && mirror && (level === 'error' || debug())) {
        try { (mirror[level] || mirror.log).call(mirror, '[' + entry.src + '] ' + entry.msg, ...(extra instanceof Error ? [extra] : [])); } catch { /* ignore */ }
      }
      return entry;
    } catch { return null; } finally { busy = false; }
  }

  const make = (level) => (src, msg, extra, opts) => record(level, src, msg, extra, opts);
  const api = {
    debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error'),
    child: (src) => ({
      debug: (m, x) => record('debug', src, m, x), info: (m, x) => record('info', src, m, x),
      warn: (m, x) => record('warn', src, m, x), error: (m, x) => record('error', src, m, x),
    }),
    /** Has this exact Error object been logged already (it was caught, logged and rethrown)? */
    seen: (err) => { try { return !!err && typeof err === 'object' && logged.has(err); } catch { return false; } },
    text: scrubText,
  };
  return api;
}

// ---- the app's logger and its store
const store = createLogStore();
export const log = createLog({ sink: store, debug: () => readDebug() });

/** What the Privacy panel needs: how much is stored, a JSON export, and a way to clear it. */
export const diagnostics = {
  stats: () => store.stats(),
  exportJson: () => store.exportJson(),
  clear: () => store.clear(),
  flush: () => store.flush(),
};

if (typeof document !== 'undefined') {
  // Save what is queued when the page goes to the background or closes.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
  globalThis.addEventListener?.('pagehide', () => { store.flush(); });
}
