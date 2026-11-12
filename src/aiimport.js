// Turning an AI's answer (or a share link) into a list of places to preview. No map or storage code here.
//
// What is accepted, because chat assistants are not consistent:
//   - a GeoJSON FeatureCollection or Feature (the format in public/ai/prompt.md), possibly wrapped in prose or a ```json fence
//   - a bare JSON array of { name, type, lat, lon, note, day, order, query } objects
// What is never trusted: everything is passed through poi.js sanitize before it can become a marker, names and notes are only
// ever shown as text, and nothing is added until the person confirms the preview.
import { TYPES, NOT_SUB, posInt, isoDate, tripFields } from './poi.js';
import { compactShare, expandShare } from './sharecompact.js';

const MAX_CHARS = 2e6;
const MAX_ROWS = 200;
export const MAX_LOOKUPS = 30;
const FENCE = /```(?:json|geojson)?\s*([\s\S]*?)```/i;
const typeIds = new Set(TYPES.map((t) => t.id));

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

/** Finds the JSON in pasted text: a fenced block if there is one, else the outermost {...} or [...]. */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Nothing to read yet. Paste the AI\'s answer first.');
  if (text.length > MAX_CHARS) throw new Error('That is too long (limit 2 MB).');
  const tries = [];
  const fenced = text.match(FENCE);
  if (fenced) tries.push(fenced[1]);
  tries.push(text);
  for (const t of tries) {
    const s = t.trim();
    try { return JSON.parse(s); } catch { /* look for the JSON inside prose */ }
    for (const [open, close] of [['{', '}'], ['[', ']']]) {
      const a = s.indexOf(open), b = s.lastIndexOf(close);
      if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* try the next shape */ } }
    }
  }
  throw new Error('Could not find valid JSON in that text. Ask the AI for the JSON only, in a code block.');
}

/** [lon, lat] from a GeoJSON geometry or flat fields. Returns { lat, lon, swapped } or null. (0, 0) counts as missing. */
function coordsOf(feature, props) {
  const g = feature.geometry;
  let lon = NaN, lat = NaN;
  if (g && g.type === 'Point' && Array.isArray(g.coordinates)) { lon = num(g.coordinates[0]); lat = num(g.coordinates[1]); }
  else if (!g) { lat = num(props.lat ?? props.latitude); lon = num(props.lon ?? props.lng ?? props.longitude); }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let swapped = false;
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) { [lat, lon] = [lon, lat]; swapped = true; } // an impossible latitude: [lat, lon] given the wrong way round
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null; // "null island": what a model emits when it has no idea
  return { lat, lon, swapped };
}

/**
 * Parses an AI answer. Returns { rows, trips, skipped, notes, appExport }.
 * Each row: { name, type, note, day, order, date, endDate, tripRef, query, lat?, lon?, status: 'ok' | 'lookup', unverified, isSub?, near?, srcId?, parentSrc? }.
 *   isSub   a Side Quest: an AI's properties.sideQuest = true, or this app's own isSub. `near` is the name of the main stop an AI says it is near;
 *           `srcId` and `parentSrc` are this app's own ids (a file or share link), so a Side Quest can find its parent again. See linkSideQuests.
 *   ok      has usable coordinates
 *   lookup  no coordinates, but a name or address that can be searched
 * trips: the trips the reply describes, [{ ref, name, country?, startDate?, endDate?, description }], from an optional top-level
 * `trip` object (an AI's one-itinerary-one-trip reply, ref '@trip') or this app's own `trips` array (ref = the trip's id).
 * A row's tripRef names the trip it belongs to. A Home (residence) row never has one.
 */
export function parseItinerary(text) {
  const data = extractJson(text);
  let feats;
  if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) feats = data.features;
  else if (data && data.type === 'Feature') feats = [data];
  else if (Array.isArray(data)) feats = data.map((d) => ({ type: 'Feature', properties: d, geometry: null }));
  else throw new Error('That JSON is not a list of places. It should be a GeoJSON FeatureCollection.');
  if (!feats.length) throw new Error('That JSON has no places in it.');

  const appExport = !!(data && !Array.isArray(data) && data.uavzones === 1); // our own export or share link: trust its unverified flags
  const trips = [];
  if (data && !Array.isArray(data)) {
    const one = tripFields(data.trip);
    if (one) trips.push({ ref: '@trip', ...one });
    if (Array.isArray(data.trips)) {
      for (const t of data.trips.slice(0, 50)) {
        const f = tripFields(t);
        if (f && typeof t.id === 'string' && !trips.some((x) => x.ref === t.id)) trips.push({ ref: t.id, ...f });
      }
    }
  }
  const rows = [], notes = [];
  let skipped = 0, swappedCount = 0;
  for (const f of feats.slice(0, MAX_ROWS)) {
    if (!f || typeof f !== 'object') { skipped++; continue; }
    const p = f.properties && typeof f.properties === 'object' ? f.properties : (f.geometry ? {} : f);
    const name = str(p.name ?? p.title, 80);
    const query = str(p.query ?? p.address, 200);
    const date = isoDate(p.date);
    const endDate = date ? isoDate(p.endDate) : null; // an end date only means something after a start date
    const type = typeIds.has(p.type) ? p.type : 'other';
    // this app's own files say which trip each place is in; an AI's single `trip` covers every place. Home belongs to none.
    const ownRef = appExport && typeof p.tripId === 'string' && trips.some((t) => t.ref === p.tripId) ? p.tripId : null;
    const tripRef = type === 'residence' ? null : ownRef ?? (!appExport && trips.some((t) => t.ref === '@trip') ? '@trip' : null);
    const sub = !NOT_SUB.has(type) && (appExport ? p.isSub === true : p.sideQuest === true || p.isSub === true);
    const base = {
      tripRef,
      name, type, note: str(p.note ?? p.description, 500),
      day: posInt(p.day), order: posInt(p.order), date, endDate: endDate && endDate > date ? endDate : null, query,
      unverified: appExport ? p.unverified === true : true, // anything an AI made counts as unchecked
      ...(sub && { isSub: true }),
      ...(sub && !appExport && str(p.near, 80) && { near: str(p.near, 80).trim() }),
      ...(appExport && typeof p.id === 'string' && p.id.length <= 64 && { srcId: p.id }),
      ...(sub && appExport && typeof p.parentId === 'string' && p.parentId.length <= 64 && { parentSrc: p.parentId }),
    };
    const c = coordsOf(f, p);
    if (c) { if (c.swapped) swappedCount++; rows.push({ ...base, lat: c.lat, lon: c.lon, status: 'ok' }); }
    else if (query || name) rows.push({ ...base, query: query || name, status: 'lookup' });
    else skipped++;
  }
  if (feats.length > MAX_ROWS) { skipped += feats.length - MAX_ROWS; notes.push(`Only the first ${MAX_ROWS} places are read.`); }
  if (swappedCount) notes.push(`${swappedCount} place${swappedCount === 1 ? ' had' : 's had'} latitude and longitude the wrong way round, and ${swappedCount === 1 ? 'was' : 'were'} corrected.`);
  if (!rows.length) throw new Error('No usable places found: each needs coordinates, or a name or address to look up.');
  return { rows, trips, skipped, notes, appExport };
}

/**
 * Which main stop each imported Side Quest hangs from. `rows` are the rows that were added and `added[i]` is the marker made from `rows[i]` (null
 * or missing when that row was not added). A row from this app's own file or link finds its parent by id; an AI's `near` is matched by name against the
 * main stops of the same trip (the added ones and `existing` markers), preferring one on the same date. Returns [{ id, parentId }] for the ones found;
 * the others are left for parentOf (trips.js) to place by distance.
 */
export function linkSideQuests(rows, added, existing = []) {
  const bySrc = new Map();
  rows.forEach((r, i) => { if (r.srcId && added[i]) bySrc.set(r.srcId, added[i]); });
  const pool = [...added.filter(Boolean), ...existing];
  const out = [];
  rows.forEach((r, i) => {
    const me = added[i];
    if (!me || !r.isSub) return;
    const trip = me.tripId ?? null;
    const mains = pool.filter((m) => m.id !== me.id && m.isSub !== true && m.type !== 'residence' && (m.tripId ?? null) === trip);
    let parent = r.parentSrc ? bySrc.get(r.parentSrc) : null;
    if (!parent && r.near) {
      const n = r.near.toLowerCase();
      const named = mains.filter((m) => m.name.toLowerCase() === n);
      parent = named.find((m) => m.date && me.date && m.date <= (m.endDate ?? m.date) && me.date >= m.date && me.date <= (m.endDate ?? m.date)) ?? named[0];
    }
    if (parent && parent.id !== me.id && parent.isSub !== true && (parent.tripId ?? null) === trip) out.push({ id: me.id, parentId: parent.id });
  });
  return out;
}

const sameSpot = (row, e) => {
  const m = 30 / 111320;
  return e.name.toLowerCase() === row.name.toLowerCase() && Math.abs(e.lat - row.lat) < m && Math.abs(e.lon - row.lon) < m / Math.max(0.2, Math.cos(row.lat * Math.PI / 180));
};
/** Both are dated and the dates differ: the same place visited again on another day. */
const otherDate = (row, e) => Boolean(row.date) && Boolean(e.date) && (row.date !== e.date || (row.endDate || '') !== (e.endDate || ''));

/**
 * The same place pasted twice: same name within about 30 m of an existing marker, unless both have dates and the dates differ
 * (that is a second visit, see isRevisit). A row with no date, or an existing marker with none, still counts as a duplicate.
 */
export function isDuplicate(row, existing) {
  if (row.status !== 'ok') return false;
  return existing.some((e) => sameSpot(row, e) && !otherDate(row, e));
}
/** A row for a place already saved, but on a different date: it is added as another visit. */
export function isRevisit(row, existing) {
  if (row.status !== 'ok') return false;
  return existing.some((e) => sameSpot(row, e) && otherDate(row, e)) && !isDuplicate(row, existing);
}

// ---------- place lookup (opt-in, see privacy.js) ----------
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/**
 * Looks a place up by name or address: Photon first, then Nominatim. Returns { lat, lon, label } or null. Throws only on abort.
 * `bias` is where the map is looking ({ lat, lng } from Leaflet, or { lat, lon }); Photon prefers results near it.
 */
export async function geocode(query, bias, signal) {
  try {
    const bl = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng ?? bias.lon) ? bias : null;
    const near = bl ? `&lat=${bl.lat.toFixed(2)}&lon=${(bl.lng ?? bl.lon).toFixed(2)}` : '';
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1${near}`, { signal });
    if (r.ok) {
      const f = (await r.json()).features?.[0];
      if (f) { const [lon, lat] = f.geometry.coordinates; if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, label: f.properties?.name || query }; }
    }
  } catch (e) { if (e.name === 'AbortError') throw e; }
  try {
    await sleep(1100, signal); // Nominatim allows one request a second
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=${encodeURIComponent(query)}`, { signal });
    if (r.ok) {
      const x = (await r.json())[0];
      if (x && Number.isFinite(+x.lat) && Number.isFinite(+x.lon)) return { lat: +x.lat, lon: +x.lon, label: x.name || query };
    }
  } catch (e) { if (e.name === 'AbortError') throw e; }
  return null;
}
export const pause = sleep;

// ---------- share links: #import=z.<deflated, base64url JSON> ----------
const bytesToB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64ToBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

/**
 * The fragment value for a list of GeoJSON text. An app export (places and trips) is written in the compact form (z2.) and compressed, which keeps
 * the link short; anything else is compressed as it is (z.), or left as plain text when the browser cannot compress.
 */
export async function encodeShare(jsonText) {
  if (typeof CompressionStream === 'undefined') return encodeURIComponent(jsonText);
  let prefix = 'z.', text = jsonText;
  try {
    const gj = JSON.parse(jsonText);
    if (gj?.uavzones === 1 && Array.isArray(gj.features) && gj.features.every((f) => f?.geometry?.type === 'Point')) { text = JSON.stringify(compactShare(gj)); prefix = 'z2.'; }
  } catch { /* not JSON we know: send it as it is */ }
  return `${prefix}${bytesToB64(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw')))}`;
}

/** Back to JSON text, from either the compressed form or plain percent-encoded JSON. Throws a readable error. */
export async function decodeShare(value) {
  try {
    if (value.length > 400000) throw new Error('long');
    const compact = value.startsWith('z2.');
    if (!compact && !value.startsWith('z.')) return decodeURIComponent(value);
    const out = await pipe(b64ToBytes(value.slice(compact ? 3 : 2)), new DecompressionStream('deflate-raw'));
    if (out.length > MAX_CHARS) throw new Error('long');
    const text = new TextDecoder().decode(out);
    return compact ? JSON.stringify(expandShare(JSON.parse(text))) : text;
  } catch { throw new Error('That link could not be read. It may have been cut short when it was copied.'); }
}
