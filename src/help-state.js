// Which contextual hints have been shown, kept in this browser only (key uavzones.v1.help, separate from the preferences).
// Only a version and a list of hint ids are stored: no account, position or other personal data. If storage is blocked or holds rubbish, the
// set lives in memory for this page and nothing throws. Pure apart from the storage it is given, so Node tests can pass a fake.
export const KEY = 'uavzones.v1.help';
const ID = /^[a-z0-9-]{1,40}$/;
const MAX = 64;

/** The ids in a stored value; anything that is not a list of well-formed ids is dropped (an unknown newer version is still read, never reset). */
export function sanitize(raw) {
  const list = raw && typeof raw === 'object' && Array.isArray(raw.seen) ? raw.seen : [];
  return [...new Set(list.filter((s) => typeof s === 'string' && ID.test(s)))].slice(0, MAX);
}

export function createHelpState(storage = (() => { try { return globalThis.localStorage; } catch { return null; } })(), key = KEY) {
  let seen;
  try { seen = new Set(sanitize(JSON.parse(storage?.getItem(key) ?? 'null'))); } catch { seen = new Set(); }
  const persist = () => { try { storage?.setItem(key, JSON.stringify({ v: 1, seen: [...seen] })); } catch { /* blocked: memory only for this page */ } };
  return {
    has: (id) => seen.has(id),
    /** Marks a hint as seen (the one automatic presentation has happened, or the visitor dismissed it). */
    mark(id) { if (!ID.test(id) || seen.has(id)) return; seen.add(id); persist(); },
    list: () => [...seen],
  };
}
