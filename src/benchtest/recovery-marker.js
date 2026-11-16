// Motor bench test (Phase 3): the durable "powered session may have ended abnormally" marker. Backlog section 22.
// The ONLY module in src/benchtest that touches browser storage. It stores a boolean-like record and a timestamp under one
// `uavzones.` key: no telemetry, no identifiers.
//
// Fail closed: a marker write counts only if it reads back identically. If storage is unavailable or the read-back differs,
// set() returns false and the state machine refuses to leave the checklist (no battery connection is permitted).
import { RECOVERY_KEY } from './constants.js';

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; } // the property getter itself can throw when site data is blocked
}

export function createMarkerStore(storage) {
  const get = () => { try { return storage === undefined ? defaultStorage() : storage; } catch { return null; } };
  return {
    // 'present' | 'absent' | 'unavailable'
    status() {
      const s = get();
      if (!s) return 'unavailable';
      try { return s.getItem(RECOVERY_KEY) === null ? 'absent' : 'present'; } catch { return 'unavailable'; }
    },
    // Writes, then reads back. True only when the stored text is exactly what was written.
    set(now = Date.now()) {
      const s = get();
      if (!s) return false;
      const text = JSON.stringify({ v: 1, unclean: true, at: now });
      try { s.setItem(RECOVERY_KEY, text); return s.getItem(RECOVERY_KEY) === text; } catch { return false; }
    },
    // True when the marker is gone afterwards.
    clear() {
      const s = get();
      if (!s) return false;
      try { s.removeItem(RECOVERY_KEY); return s.getItem(RECOVERY_KEY) === null; } catch { return false; }
    },
  };
}
