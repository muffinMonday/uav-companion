// The rules of cloud sync, with no network, storage or DOM, so they can be tested exhaustively. See sync/engine.js for the part that acts on them.
//
// A device remembers the revision of the cloud copy it last synced from (baseRev) and whether anything changed here since (dirty). Compared with
// what the cloud holds now, that says what to do:
//
//   no cloud copy, data here          upload this device ('push-first')
//   no cloud copy, nothing here       nothing to do
//   never synced, nothing here        take the cloud copy ('pull')
//   never synced, data here           both have data: ask ('ask')
//   cloud unchanged, changed here     upload ('push')
//   cloud unchanged, unchanged here   nothing to do ('in-sync')
//   cloud moved on, unchanged here    take the cloud copy ('pull')
//   cloud moved on, changed here      a true conflict: ask ('ask')
//   cloud older than what we synced   the cloud copy was reset: ask ('ask')
//
// Nothing is ever overwritten without the user's choice, except taking the cloud copy onto a device that has nothing of its own to lose.

export const DOC_VERSION = 1;
const MAX_DEVICE = 80;

/** The document that goes to the cloud: the markers and trips (check-in positions only if the user chose to include them). */
export function buildDoc({ items = [], trips = [], includeCheckins = false }) {
  return {
    v: DOC_VERSION,
    items: items.map((i) => { if (includeCheckins || !i.checkin) return i; const { checkin, ...rest } = i; return rest; }), // eslint-disable-line no-unused-vars
    trips: trips.slice(),
  };
}

export const counts = (doc) => ({ markers: Array.isArray(doc?.items) ? doc.items.length : 0, trips: Array.isArray(doc?.trips) ? doc.trips.length : 0 });

const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
};
/** Do two documents hold the same markers and trips (the order of the lists does not matter)? */
export function sameContent(a, b) {
  const norm = (d) => JSON.stringify(canon({ items: [...(d?.items ?? [])].sort((x, y) => String(x.id).localeCompare(String(y.id))), trips: [...(d?.trips ?? [])].sort((x, y) => String(x.id).localeCompare(String(y.id))) }));
  return norm(a) === norm(b);
}

/** What to do. `local`: { hasData, dirty, baseRev }; `cloud`: the cloud copy's info ({ rev, ... }) or null. */
export function decide(local, cloud) {
  const { hasData, dirty, baseRev } = local;
  if (!cloud) return hasData ? 'push-first' : 'nothing';
  if (baseRev == null) return hasData ? 'ask' : 'pull';
  if (cloud.rev === baseRev) return dirty ? 'push' : 'in-sync';
  return dirty || cloud.rev < baseRev ? 'ask' : 'pull';
}

/** How two documents differ, by marker and trip ids: { markers: { onlyLocal, onlyCloud, differ, same }, trips: { ... } }. */
export function diffDocs(local, cloud) {
  const part = (a = [], b = []) => {
    const mb = new Map(b.map((x) => [x.id, x])), ma = new Map(a.map((x) => [x.id, x]));
    let onlyLocal = 0, onlyCloud = 0, differ = 0, same = 0;
    for (const [id, x] of ma) { if (!mb.has(id)) onlyLocal++; else if (JSON.stringify(canon(x)) === JSON.stringify(canon(mb.get(id)))) same++; else differ++; }
    for (const id of mb.keys()) if (!ma.has(id)) onlyCloud++;
    return { onlyLocal, onlyCloud, differ, same };
  };
  return { markers: part(local?.items, cloud?.items), trips: part(local?.trips, cloud?.trips) };
}

/** The cloud copy's markers with this device's own check-ins put back (when check-ins are not part of the cloud copy). */
export function keepLocalCheckins(docItems = [], localItems = []) {
  const mine = new Map(localItems.filter((i) => i.checkin).map((i) => [i.id, i.checkin]));
  if (!mine.size) return docItems;
  return docItems.map((i) => (!i.checkin && mine.has(i.id) ? { ...i, checkin: mine.get(i.id) } : i));
}

/** "Chrome on Windows" from a user-agent string, for the conflict prompt ("changed on Chrome on Windows"). */
export function deviceName(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return (os ? `${browser} on ${os}` : browser).slice(0, MAX_DEVICE);
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", or the date, for the status line and the prompt. */
export function describeWhen(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'at an unknown time';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  if (s < 172800) return 'yesterday';
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
