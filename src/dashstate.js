// What the dashboard remembers, and the rules for how it starts. Pure apart from the storage helpers, so Node tests can use it.
//
//   showOnStart  start with the dashboard open (default on); off starts it hidden, with the ^ tab to bring it back
//   hideUntil    "Do not show for today": the day (YYYY-MM-DD, the visitor's own) up to which it starts as the peek strip
//   seen         the id of the newest What's new entry the visitor has seen
//   welcomed     the first-run guide has been shown (a first visit starts open with the guide)
export const KEY = 'uavzones.v1.dash';
export const MAX_NEW = 3;           // What's new entries shown at once
export const BACKUP_DAYS = 30;      // a backup older than this is worth a reminder

const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    showOnStart: r.showOnStart !== false,
    hideUntil: day(r.hideUntil),
    seen: typeof r.seen === 'string' && r.seen.length <= 40 ? r.seen : null,
    welcomed: r.welcomed === true,
  };
}
export function load() { try { return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return sanitize(null); } }
export function save(patch) { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, ...load(), ...patch })); } catch { /* storage blocked: it simply starts the same way next time */ } }

/** The entries (newest first) that come before the last one seen, at most MAX_NEW. Everything is new to a first-time visitor. */
export function unseenEntries(entries, seen) {
  const at = seen ? entries.findIndex((e) => e.id === seen) : -1;
  return (at >= 0 ? entries.slice(0, at) : entries).slice(0, MAX_NEW);
}

/**
 * How the dashboard starts: 'expanded', 'peek' (the one-line strip) or 'hidden' (just the ^ tab).
 * A first visit and a waiting What's new entry open it fully (a first visit even on a phone); a share link has the visitor's attention,
 * so it starts as the strip; then the visitor's own choices, and otherwise open on a desktop and the strip on a phone.
 */
export function startState({ firstRun = false, unseen = 0, showOnStart = true, hideUntil = null, today, phone = false, shared = false }) {
  if (firstRun) return 'expanded';
  if (shared) return 'peek';
  if (unseen > 0) return 'expanded';
  if (!showOnStart) return 'hidden';
  if (hideUntil && hideUntil === today) return 'peek';
  return phone ? 'peek' : 'expanded';
}

export const STORAGE_QUOTA = 5_000_000; // characters a browser typically allows one site in localStorage (about 5 MB)
export const STORAGE_WARN = 0.8;

/** How much of this site's browser storage the app's own keys use: { chars, quota, pct, warn }. `storage` is a localStorage-like object. */
export function storageUse(storage, quota = STORAGE_QUOTA) {
  let chars = 0;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith('uavzones.v1.')) chars += k.length + (storage.getItem(k) || '').length;
    }
  } catch { return null; }
  const pct = chars / quota;
  return { chars, quota, pct, warn: pct >= STORAGE_WARN };
}

/** "62 KB" / "1.4 MB" for the readout. */
export function sizeLabel(chars) {
  return chars < 1_000_000 ? Math.max(1, Math.round(chars / 1000)) + ' KB' : (chars / 1_000_000).toFixed(1) + ' MB';
}

/** Is a backup worth asking for? null if not; { never: true } or { days } when there are markers and the last backup is old or missing. */
export function backupDue(lastBackup, markers, now = Date.now()) {
  if (!markers) return null;
  const t = lastBackup ? Date.parse(lastBackup) : NaN;
  if (!Number.isFinite(t)) return { never: true };
  const days = Math.floor((now - t) / 86400000);
  return days > BACKUP_DAYS ? { days } : null;
}
