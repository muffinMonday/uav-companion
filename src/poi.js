// Points of interest: types, icons, local storage and GeoJSON import/export. No map code here.
// Stored only in this browser (localStorage). Nothing is ever sent anywhere.

import { addDays, daysBetween } from './dates.js';
import { countryCode } from './countries.js';
import { sanitizeCheckin } from './checkin.js';

export const KEY = 'uavzones.v1.pois';
export const TRIPS_KEY = 'uavzones.v1.trips';
const BACKUP_KEY = 'uavzones.v1.lastBackup';
const MAX_TRIPS = 200;
const MAX_ITEMS = 5000;       // import ceiling
const MAX_IMPORT_BYTES = 2e6; // import file ceiling

// Each type differs in glyph as well as colour, so the markers stay distinguishable without colour vision.
const G = 'stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"';
// `home` is the drone's home point (where flights start and return to), drawn as an "H". `residence` is labelled "Home":
// the traveller's actual residence, drawn as a house. The ids are what is stored and exchanged, so they never change.
export const TYPES = [
  { id: 'home', label: 'Home point', hint: 'The drone\'s home point: where flights start and return to', color: '#2e7d32', glyph: `<path d="M8.6 6v10M15.4 6v10M8.6 11h6.8" ${G}/>` },
  { id: 'hotel', label: 'Hotel', hint: 'Where you are staying', color: '#6a4fb3', glyph: `<path d="M6.5 6.5v9M6.5 12.8h11v2.7M17.5 12.8v-2.2a1.6 1.6 0 0 0-1.6-1.6h-4.4v3.8" ${G}/><circle cx="9" cy="10.3" r="1.3" fill="#fff"/>` },
  { id: 'takeoff', label: 'Takeoff spot', hint: 'A good place to launch the drone', color: '#1565c0', glyph: `<path d="M12 15.4V6.2M8.2 9.8 12 6l3.8 3.8M7.5 17.6h9" ${G}/>` },
  { id: 'landing', label: 'Landing spot', hint: 'A good place to land or recover it', color: '#8d6e63', glyph: `<path d="M12 6.2v9.2M8.2 11.8 12 15.6l3.8-3.8M7.5 17.6h9" ${G}/>` },
  { id: 'photo', label: 'Photo spot', hint: 'A scenic spot to fly or film at', color: '#c2185b', glyph: `<rect x="6.2" y="8.2" width="11.6" height="7.6" rx="1.8" ${G}/><circle cx="12" cy="12" r="2.2" ${G}/><path d="M9.6 8.2l.9-1.4h3l.9 1.4" ${G}/>` },
  { id: 'train', label: 'Train station', hint: 'A train or metro station you will use', color: '#00796b', glyph: `<rect x="7.6" y="5.8" width="8.8" height="9" rx="2" ${G}/><path d="M7.6 11h8.8M9.6 17.4l1.2-2.6M14.4 17.4l-1.2-2.6" ${G}/>` },
  { id: 'airport', label: 'Airport', hint: 'An airport you fly in or out of. Also check its no-fly zone before launching nearby', color: '#039be5', glyph: `<path d="M12 5.8v10.6M12 9.2l-4.6 3v1.3l4.6-1.5 4.6 1.5v-1.3l-4.6-3M10 16.4h4" ${G}/>` },
  { id: 'hazard', label: 'Hazard', hint: 'Something to avoid: crowds, cables, a restricted site', color: '#e65100', glyph: `<path d="M12 5.8 18 16.2H6z" ${G}/><path d="M12 9.8v3.2" ${G}/><circle cx="12" cy="14.7" r=".7" fill="#fff"/>` },
  { id: 'residence', label: 'Home', hint: 'Your actual residence (not the drone\'s home point)', color: '#827717', glyph: '<path d="M12 5.2 6.2 10.2h1.6v5.3h3v-3.6h2.4v3.6h3v-5.3h1.6z" fill="#fff"/>' },
  { id: 'other', label: 'Other', hint: 'Anything else', color: '#546e7a', glyph: '<circle cx="12" cy="11.3" r="3" fill="#fff"/>' },
];
export const typeOf = (id) => TYPES.find((t) => t.id === id) || TYPES[TYPES.length - 1];

/** Pin SVG for a type. Built only from the constants above, never from user text, so it is safe as innerHTML. */
export function pinSvg(typeId) {
  const t = typeOf(typeId);
  return `<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 1C6.2 1 1.5 5.6 1.5 11.3c0 7.7 10.5 19.2 10.5 19.2s10.5-11.5 10.5-19.2C22.5 5.6 17.8 1 12 1z" fill="${t.color}" stroke="#fff" stroke-width="1.4"/>${t.glyph}</svg>`;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** A whole number from 1 to 999 (itinerary day or stop number), or null. Accepts "3" as well as 3. */
export function posInt(v) {
  const n = typeof v === 'string' && /^\s*\d{1,3}\s*$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}

/**
 * A real calendar date as "YYYY-MM-DD" (years 2000 to 2100), or null. A longer ISO date-time keeps its date part.
 * "2026-02-30" is not a date, and neither is "12 Nov": nothing is guessed.
 */
export function isoDate(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 2000 || y > 2100) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Validates one raw item (from storage or an import). Returns a clean item or null.
 * `day`, `order` (position within the day), `date` and `endDate` (the trip dates; an end only makes sense after a start)
 * and `unverified` are optional and left out of the record when not set, so a marker without them is exactly as it was
 * before they existed.
 */
export function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat), lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const type = TYPES.some((t) => t.id === raw.type) ? raw.type : 'other';
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const created = Number.isFinite(Date.parse(raw.created)) ? new Date(raw.created).toISOString() : new Date().toISOString();
  const item = {
    id: typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : newId(),
    type, name: str(raw.name, 80).trim() || typeOf(type).label, note: str(raw.note, 500),
    lat: r6(lat), lon: r6(lon), created,
  };
  const day = posInt(raw.day), order = posInt(raw.order);
  if (day !== null) item.day = day;
  if (order !== null) item.order = order;
  const date = isoDate(raw.date), endDate = isoDate(raw.endDate);
  if (date) {
    item.date = date;
    if (endDate && endDate > date) item.endDate = endDate; // an end on or before the start is just a single day
  }
  const checkin = type !== 'residence' ? sanitizeCheckin(raw.checkin) : null; // where and when you were there; the Home marker cannot have one
  if (checkin) item.checkin = checkin;
  if (raw.unverified === true) item.unverified = true; // location came from an AI or a name lookup and has not been checked yet
  // A trip tag. The Home marker (a residence) does not belong to a trip, so it never keeps one.
  if (typeof raw.tripId === 'string' && raw.tripId.length > 0 && raw.tripId.length <= 64 && type !== 'residence') item.tripId = raw.tripId;
  return item;
}

// ---------- trips ----------
// Eight colours for trips; a trip's colour is the dot on its markers' pins. Chosen to stay apart from each other, and each
// is shown with a white edge on the pin, so none depends on telling hues apart.
export const MAX_NOTES = 2000, MAX_CHECKLIST = 30;
export const TRIP_COLORS = ['#e91e63', '#3949ab', '#00897b', '#fb8c00', '#6d4c41', '#546e7a', '#7cb342', '#8e24aa'];

/**
 * The editable fields of a trip, validated, or null if there is no usable name.
 * name (required, up to 80); country (a known country, stored as its ISO code, else dropped); startDate and endDate
 * (real dates; the end only with a start and not before it, one day is start = end); description (up to 500);
 * notes (free text, up to 2000); checklist (up to 30 items of { text up to 80, done }).
 */
export function tripFields(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '';
  if (!name) return null;
  const out = { name, description: typeof raw.description === 'string' ? raw.description.slice(0, 500) : '' };
  if (typeof raw.notes === 'string' && raw.notes.trim()) out.notes = raw.notes.slice(0, MAX_NOTES);
  const checklist = Array.isArray(raw.checklist)
    ? raw.checklist.map((c) => ({ text: typeof c?.text === 'string' ? c.text.trim().slice(0, 80) : '', done: c?.done === true })).filter((c) => c.text).slice(0, MAX_CHECKLIST)
    : [];
  if (checklist.length) out.checklist = checklist;
  const country = countryCode(raw.country);
  if (country) out.country = country;
  const startDate = isoDate(raw.startDate);
  if (startDate) {
    out.startDate = startDate;
    const endDate = isoDate(raw.endDate);
    if (endDate && endDate >= startDate) out.endDate = endDate;
  }
  return out;
}

/** A stored trip: its fields plus id, creation time and a colour from TRIP_COLORS. */
export function sanitizeTrip(raw) {
  const f = tripFields(raw);
  if (!f) return null;
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64 ? raw.id : newId(),
    created: Number.isFinite(Date.parse(raw.created)) ? new Date(raw.created).toISOString() : new Date().toISOString(),
    color: TRIP_COLORS.includes(raw.color) ? raw.color : TRIP_COLORS[0],
    ...f,
  };
}

/** Two sets of trip fields describe the same trip: same name (any case), country and dates. */
export const sameTrip = (a, b) => a.name.toLowerCase() === b.name.toLowerCase() && (a.country ?? '') === (b.country ?? '')
  && (a.startDate ?? '') === (b.startDate ?? '') && (a.endDate ?? '') === (b.endDate ?? '');

/**
 * Day numbers follow from dates (the trip's start date is day 1), so a stored day only matters for a marker that has no date.
 * For markers in a trip with a start date: a stored day on a dated marker is dropped (the day is worked out), and a stored day on an
 * undated marker becomes a date (start + day − 1). Returns { items, corrected, converted }: corrected counts dated markers whose stored
 * day disagreed with their date, converted those whose day became a date. Markers it does not touch are returned as they are.
 */
export function migrateDays(items, trips) {
  const byId = new Map(trips.map((t) => [t.id, t]));
  let corrected = 0, converted = 0, changed = false;
  const out = items.map((it) => {
    const trip = it.tripId ? byId.get(it.tripId) : null;
    if (!trip?.startDate || it.day === undefined) return it;
    const { day, ...rest } = it;
    changed = true;
    if (it.date) { if (daysBetween(trip.startDate, it.date) + 1 !== day) corrected++; return rest; }
    converted++;
    return { ...rest, date: addDays(trip.startDate, day - 1) };
  });
  return { items: changed ? out : items, corrected, converted };
}

/** How the list is organised: by date when any marker has a date, else by day, else a plain newest-first list. */
export function listMode(items) {
  if (items.some((i) => i.date !== undefined)) return 'date';
  if (items.some((i) => i.day !== undefined)) return 'day';
  return 'plain';
}

/** Display order for the mode above (worked out from the items unless given); undated or unnumbered markers come last, and ties fall back to newest first. */
export function sortForList(items, mode = listMode(items)) {
  const byNewest = (a, b) => b.created.localeCompare(a.created);
  if (mode === 'plain') return items.slice().sort(byNewest);
  const big = Number.POSITIVE_INFINITY;
  const num = (a, b, k) => (a[k] ?? big) - (b[k] ?? big);
  if (mode === 'day') return items.slice().sort((a, b) => num(a, b, 'day') || num(a, b, 'order') || byNewest(a, b));
  const dkey = (i) => i.date ?? '9999-99-99';
  return items.slice().sort((a, b) => dkey(a).localeCompare(dkey(b)) || num(a, b, 'day') || num(a, b, 'order') || byNewest(a, b));
}

/** "Thu 12 Nov", with the year when it is not this year (or the range crosses years). Dates are calendar dates, so no time zone applies. */
export function formatDate(iso, withYear) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(withYear && { year: 'numeric' }), timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "" when the marker has no date, "Thu 12 Nov", or "Thu 12 Nov – Sat 14 Nov". */
export function dateLabel(item) {
  if (!item.date) return '';
  const thisYear = String(new Date().getUTCFullYear());
  const end = item.endDate;
  const withYear = item.date.slice(0, 4) !== thisYear || (end && end.slice(0, 4) !== item.date.slice(0, 4));
  return end ? `${formatDate(item.date, withYear)} – ${formatDate(end, withYear)}` : formatDate(item.date, withYear);
}

/** The heading a marker is listed under: its date, its day, or "No date set" / "No day set". '' in a plain list. */
export function groupLabel(item, mode) {
  if (mode === 'date') return item.date ? formatDate(item.date, item.date.slice(0, 4) !== String(new Date().getUTCFullYear())) : 'No date set';
  if (mode === 'day') return item.day !== undefined ? `Day ${item.day}` : 'No day set';
  return '';
}

function storage() {
  try {
    const k = '__uavzones_test__';
    localStorage.setItem(k, '1'); localStorage.removeItem(k);
    return localStorage;
  } catch { return null; }
}

/** The marker store. Falls back to memory when browser storage is unavailable (private mode, blocked). */
export function createStore() {
  const ls = storage();
  let items = [];
  let trips = [];
  const listeners = new Set();
  let migration = null; // what the start-up fix of day numbers changed, until it has been reported

  const withoutTrip = ({ tripId, ...rest }) => rest; // eslint-disable-line no-unused-vars
  /** A dated marker in a trip with a start date has no stored day: it is worked out. */
  const settle = (item) => {
    const t = item.tripId ? trips.find((x) => x.id === item.tripId) : null;
    if (item.day !== undefined && item.date && t?.startDate) delete item.day;
    return item;
  };
  /** After a trip's dates change: its markers' stored days are fixed the same way as at start-up. */
  const settleTrip = (tripId) => {
    const mine = items.filter((i) => i.tripId === tripId);
    const m = migrateDays(mine, trips);
    if (m.items === mine) return;
    const fixed = new Map(m.items.map((i) => [i.id, i]));
    items = items.map((i) => fixed.get(i.id) ?? i);
  };
  /** A marker can only point at a trip that exists. */
  const tripsExist = () => new Set(trips.map((t) => t.id));
  const dropDangling = () => { const ids = tripsExist(); items = items.map((i) => (i.tripId && !ids.has(i.tripId) ? withoutTrip(i) : i)); };

  function load() {
    items = []; trips = [];
    if (!ls) return;
    try {
      const data = JSON.parse(ls.getItem(TRIPS_KEY) || 'null');
      if (data && Array.isArray(data.trips)) {
        const seen = new Set();
        trips = data.trips.map(sanitizeTrip).filter((t) => t && !seen.has(t.id) && seen.add(t.id)).slice(0, MAX_TRIPS);
      }
    } catch { trips = []; }
    try {
      const data = JSON.parse(ls.getItem(KEY) || 'null');
      if (data && Array.isArray(data.items)) items = data.items.map(sanitize).filter(Boolean);
    } catch { items = []; }
    dropDangling();
    // days now follow from dates: fix the markers saved with a day typed in, and keep what was changed to report once
    const m = migrateDays(items, trips);
    if (m.items !== items) { items = m.items; migration = m.corrected || m.converted ? { corrected: m.corrected, converted: m.converted } : null; save(); }
  }
  function save() {
    if (!ls) return true; // memory only
    try { ls.setItem(KEY, JSON.stringify({ v: 1, items })); return true; } catch { return false; } // quota or blocked
  }
  function saveTrips() {
    if (!ls) return true;
    try { ls.setItem(TRIPS_KEY, JSON.stringify({ v: 1, trips })); return true; } catch { return false; }
  }
  const emit = () => listeners.forEach((fn) => fn());
  const nextColor = () => TRIP_COLORS.find((c) => !trips.some((t) => t.color === c)) ?? TRIP_COLORS[trips.length % TRIP_COLORS.length];
  load();

  return {
    persistent: !!ls,
    items: () => items.slice(),
    get: (id) => items.find((i) => i.id === id),
    trips: () => trips.slice(),
    getTrip: (id) => trips.find((t) => t.id === id),
    onChange: (fn) => listeners.add(fn),
    reload() { load(); emit(); },
    add(partial) {
      const item = sanitize({ ...partial, id: newId(), created: new Date().toISOString() });
      if (!item) return { ok: false };
      if (item.tripId && !tripsExist().has(item.tripId)) delete item.tripId;
      settle(item);
      items.unshift(item);
      const ok = save(); emit();
      if (ok && ls && navigator.storage?.persist) navigator.storage.persist().catch(() => {}); // ask the browser not to evict it
      return { ok, item };
    },
    update(id, patch) {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) return { ok: false };
      const next = sanitize({ ...items[i], ...patch, id });
      if (!next) return { ok: false };
      if (next.tripId && !tripsExist().has(next.tripId)) delete next.tripId;
      settle(next);
      items[i] = next;
      const ok = save(); emit();
      return { ok, item: next };
    },
    remove(id) {
      items = items.filter((x) => x.id !== id);
      const ok = save(); emit();
      return { ok };
    },

    /** Replaces several markers in one go (each is checked like any marker, the list order is kept). Returns { ok, previous } with the markers as they were, which setMany() takes to undo it. */
    setMany(list) {
      const previous = [];
      for (const next of list) {
        const i = items.findIndex((x) => x.id === next.id);
        if (i < 0) continue;
        const clean = sanitize({ ...next, id: next.id });
        if (!clean) continue;
        if (clean.tripId && !tripsExist().has(clean.tripId)) delete clean.tripId;
        settle(clean);
        previous.push(items[i]);
        items[i] = clean;
      }
      const ok = save(); emit();
      return { ok, previous };
    },
    /** Deletes several markers at once. Returns { ok, removed: [{ item, index }] }, which restore() takes to undo it. */
    removeMany(ids) {
      const set = new Set(ids);
      const removed = [];
      items.forEach((item, index) => { if (set.has(item.id)) removed.push({ item, index }); });
      if (!removed.length) return { ok: true, removed };
      items = items.filter((x) => !set.has(x.id));
      const ok = save(); emit();
      return { ok, removed };
    },
    /** Puts markers from removeMany back where they were. A trip tag is kept only if that trip still exists. Returns { ok, restored }. */
    restore(entries) {
      const have = new Set(items.map((x) => x.id));
      const ids = tripsExist();
      let restored = 0;
      for (const { item, index } of [...entries].sort((a, b) => a.index - b.index)) {
        if (have.has(item.id)) continue;
        items.splice(Math.min(index, items.length), 0, item.tripId && !ids.has(item.tripId) ? withoutTrip(item) : item);
        have.add(item.id); restored++;
      }
      const ok = save(); emit();
      return { ok, restored };
    },

    // ----- trips -----
    addTrip(partial) {
      if (trips.length >= MAX_TRIPS) return { ok: false, reason: 'limit' };
      const t = sanitizeTrip({ ...partial, id: newId(), created: new Date().toISOString(), color: TRIP_COLORS.includes(partial?.color) ? partial.color : nextColor() });
      if (!t) return { ok: false };
      trips.push(t);
      const ok = saveTrips(); emit();
      return { ok, trip: t };
    },
    updateTrip(id, patch) {
      const i = trips.findIndex((t) => t.id === id);
      if (i < 0) return { ok: false };
      const next = sanitizeTrip({ ...trips[i], ...patch, id });
      if (!next) return { ok: false };
      trips[i] = next;
      settleTrip(id); // new dates can make stored day numbers redundant
      const ok = saveTrips() && save(); emit();
      return { ok, trip: next };
    },
    /** Deletes a trip. Its markers are kept, just without the tag. Returns how many were untagged. */
    removeTrip(id) {
      trips = trips.filter((t) => t.id !== id);
      let untagged = 0;
      items = items.map((i) => (i.tripId === id ? (untagged++, withoutTrip(i)) : i));
      const ok = saveTrips() && save(); emit();
      return { ok, untagged };
    },
    /** The saved trip that matches these fields (same name, country and dates), or a new one. */
    ensureTrip(fields) {
      const f = tripFields(fields);
      if (!f) return { ok: false };
      const same = trips.find((t) => sameTrip(t, f));
      return same ? { ok: true, trip: same, created: false } : { ...this.addTrip(f), created: true };
    },

    /** Adds imported items whose id is not present yet, and imported trips whose id is not present. Returns { added, skipped, addedTrips }. */
    merge(incoming, incomingTrips = []) {
      const haveTrip = new Set(trips.map((t) => t.id));
      let addedTrips = 0;
      for (const t of incomingTrips) {
        if (haveTrip.has(t.id) || trips.length >= MAX_TRIPS) continue;
        trips.push(t); haveTrip.add(t.id); addedTrips++;
      }
      const have = new Set(items.map((i) => i.id));
      let added = 0, skipped = 0;
      for (const it of incoming) {
        if (have.has(it.id)) { skipped++; continue; }
        items.push(settle(it.tripId && !haveTrip.has(it.tripId) ? withoutTrip(it) : it)); have.add(it.id); added++;
      }
      items.sort((a, b) => b.created.localeCompare(a.created));
      const ok = save() && (addedTrips ? saveTrips() : true); emit();
      return { ok, added, skipped, addedTrips };
    },
    /**
     * Replaces everything with these markers and trips (the cloud copy, when the user chooses it). Each is checked like any stored one, ids stay unique,
     * a marker whose trip is not in the list loses its tag, and the day numbers are settled. Returns { ok, items, trips }.
     */
    replaceAll(incomingItems, incomingTrips = []) {
      const seenTrip = new Set(), seenItem = new Set();
      trips = (Array.isArray(incomingTrips) ? incomingTrips : []).map(sanitizeTrip).filter((t) => t && !seenTrip.has(t.id) && seenTrip.add(t.id)).slice(0, MAX_TRIPS);
      items = (Array.isArray(incomingItems) ? incomingItems : []).map(sanitize).filter((i) => i && !seenItem.has(i.id) && seenItem.add(i.id)).slice(0, MAX_ITEMS);
      dropDangling();
      const m = migrateDays(items, trips);
      if (m.items !== items) items = m.items;
      const ok = save() && saveTrips(); emit();
      return { ok, items: items.length, trips: trips.length };
    },
    /** What the start-up fix of day numbers changed ({ corrected, converted }), once; null if nothing, or already reported. */
    takeMigration() { const m = migration; migration = null; return m; },
    lastBackup() { try { return ls?.getItem(BACKUP_KEY) || null; } catch { return null; } },
    markBackup() { try { ls?.setItem(BACKUP_KEY, new Date().toISOString()); } catch { /* ignore */ } },
  };
}

/** GeoJSON for markers, plus the trips they belong to as a top-level `trips` array (a GeoJSON foreign member). */
export function toGeoJSON(items, trips = []) {
  return {
    type: 'FeatureCollection',
    uavzones: 1,
    ...(trips.length && { trips: trips.map(({ id, name, country, startDate, endDate, description, color, notes, checklist }) => ({ id, name, ...(country && { country }), ...(startDate && { startDate }), ...(endDate && { endDate }), description, color, ...(notes && { notes }), ...(checklist && { checklist }) })) }),
    features: items.map((i) => ({
      type: 'Feature',
      properties: {
        id: i.id, type: i.type, name: i.name, note: i.note, created: i.created,
        ...(i.day !== undefined && { day: i.day }), ...(i.order !== undefined && { order: i.order }),
        ...(i.date !== undefined && { date: i.date }), ...(i.endDate !== undefined && { endDate: i.endDate }), ...(i.unverified && { unverified: true }),
        ...(i.tripId !== undefined && { tripId: i.tripId }),
        ...(i.checkin && { checkin: i.checkin }),
      },
      geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
    })),
  };
}

/** Parses GeoJSON text (this app's export, or any file with Point features). Returns { items, trips, skipped } or throws a readable error. */
export function parseGeoJSON(text) {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('That file is too large (limit 2 MB).');
  let gj;
  try { gj = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  const feats = gj?.type === 'FeatureCollection' ? gj.features : gj?.type === 'Feature' ? [gj] : null;
  if (!Array.isArray(feats)) throw new Error('That file is not GeoJSON.');
  const seenTrip = new Set();
  const trips = Array.isArray(gj.trips) ? gj.trips.slice(0, MAX_TRIPS).map(sanitizeTrip).filter((t) => t && !seenTrip.has(t.id) && seenTrip.add(t.id)) : [];
  const items = [];
  let skipped = 0;
  for (const f of feats.slice(0, MAX_ITEMS)) {
    const g = f?.geometry;
    if (g?.type !== 'Point' || !Array.isArray(g.coordinates)) { skipped++; continue; }
    const p = f.properties || {};
    const item = sanitize({ id: p.id, type: p.type, name: p.name, note: p.note ?? p.description, created: p.created, day: p.day, order: p.order, date: p.date, endDate: p.endDate, unverified: p.unverified, checkin: p.checkin, tripId: p.tripId, lon: g.coordinates[0], lat: g.coordinates[1] });
    if (item) items.push(item); else skipped++;
  }
  if (feats.length > MAX_ITEMS) skipped += feats.length - MAX_ITEMS;
  return { items, trips, skipped };
}
