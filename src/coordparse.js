// Reads coordinates typed or pasted into the search box. Pure: no DOM, importable from Node tests.
//
// parseCoordinates(text) returns
//   null                         the text is not coordinates (so it is an ordinary place search)
//   { ok: false, error }         it looks like coordinates (or a map link) but cannot be used: the error says why
//   { ok: true, candidates }     one or more places it could mean: [{ lat, lon, label, sub }]
// Inside China two candidates are returned for typed coordinates: as typed (GPS, WGS-84) and converted from GCJ-02, which is what Amap and
// other Chinese map apps show, so a pair copied from one of them can be used too.
import { gcj02ToWgs84, inChina } from './coords.js';

const fmt = (v) => v.toFixed(5);
const SHORT = /^https?:\/\/(?:[\w-]+\.)*(?:goo\.gl|maps\.app\.goo\.gl|surl\.amap\.com|a\.amap\.com|url\.cn|t\.cn|dwz\.cn|j\.map\.baidu\.com)\//i;
const NUM = '-?\\d+(?:\\.\\d+)?';

function candidates(lat, lon, { source = 'typed' } = {}) {
  const gps = { lat, lon, label: `${fmt(lat)}, ${fmt(lon)}`, sub: source === 'typed' ? 'Coordinates (GPS, WGS-84)' : 'Coordinates from the link (GPS, WGS-84)' };
  if (!inChina(lat, lon)) return [gps];
  const c = gcj02ToWgs84({ lat, lon });
  return [gps, { lat: c.lat, lon: c.lon, label: `${fmt(c.lat)}, ${fmt(c.lon)}`, sub: `Coordinates from Amap or a Chinese map app (converted from ${fmt(lat)}, ${fmt(lon)})` }];
}
function checked(lat, lon, swapped) {
  if (!(Math.abs(lat) <= 90)) return { ok: false, error: 'Latitude must be between −90 and 90.' };
  if (!(Math.abs(lon) <= 180)) return { ok: false, error: 'Longitude must be between −180 and 180.' };
  return { ok: true, lat, lon, swapped };
}

/** One component, "N30°35'34\"", "114.3055E", "-30.5": degrees, minutes, seconds and a hemisphere letter. Returns { value, letter } or null. */
function component(seg) {
  const letter = (seg.match(/[NSEW]/i) || [''])[0].toUpperCase();
  const nums = seg.replace(/[NSEW]/gi, ' ').match(new RegExp(NUM, 'g'));
  if (!nums || nums.length > 3) return null;
  const neg = nums[0].startsWith('-');
  const [d, m = 0, s = 0] = nums.map((x) => Math.abs(parseFloat(x)));
  if (m >= 60 || s >= 60) return null;
  let value = d + m / 60 + s / 3600;
  if (neg || letter === 'S' || letter === 'W') value = -value;
  return { value, letter };
}

function parseLink(text) {
  if (SHORT.test(text)) return { ok: false, error: 'That is a short link, which cannot be read here. Open it in your browser, then paste the long address (or just the coordinates).' };
  let u;
  try { u = new URL(text); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const pair = (v) => { const m = String(v ?? '').match(new RegExp(`^\\s*(${NUM})\\s*,\\s*(${NUM})`)); return m ? [parseFloat(m[1]), parseFloat(m[2])] : null; };
  const bad = (lat, lon) => !(Math.abs(lat) <= 90 && Math.abs(lon) <= 180);

  if (/(^|\.)amap\.com$/.test(host)) {
    // Amap links carry lon,lat in GCJ-02 unless the link says coordinate=wgs84
    const raw = u.searchParams.get('position') ?? u.searchParams.get('to') ?? u.searchParams.get('from');
    const p = pair(raw);
    if (!p) return { ok: false, error: 'No coordinates found in that Amap link.' };
    const [lon, lat] = p;
    if (bad(lat, lon)) return { ok: false, error: 'The coordinates in that link are out of range.' };
    if (u.searchParams.get('coordinate') === 'wgs84') return { ok: true, candidates: [{ lat, lon, label: `${fmt(lat)}, ${fmt(lon)}`, sub: 'From an Amap link (GPS, WGS-84)' }] };
    const c = gcj02ToWgs84({ lat, lon });
    return { ok: true, candidates: [{ lat: c.lat, lon: c.lon, label: `${fmt(c.lat)}, ${fmt(c.lon)}`, sub: `From an Amap link (converted from GCJ-02: ${fmt(lat)}, ${fmt(lon)})` }] };
  }

  // Google Maps and most others: !3d..!4d.. is the pin itself, @lat,lon is where the map is looking, then the usual parameters
  let m = text.match(new RegExp(`!3d(${NUM})!4d(${NUM})`));
  let p = m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  if (!p) { m = text.match(new RegExp(`@(${NUM}),(${NUM})`)); p = m ? [parseFloat(m[1]), parseFloat(m[2])] : null; }
  if (!p) for (const k of ['q', 'query', 'll', 'destination', 'daddr', 'center', 'sll']) { p = pair(u.searchParams.get(k)); if (p) break; }
  if (!p) return { ok: false, error: 'No coordinates found in that link.' };
  if (bad(p[0], p[1])) return { ok: false, error: 'The coordinates in that link are out of range.' };
  return { ok: true, candidates: candidates(p[0], p[1], { source: 'link' }) };
}

export function parseCoordinates(input) {
  if (typeof input !== 'string') return null;
  let t = input.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return parseLink(t);

  t = t.replace(/[′’ʹ‘]/g, "'").replace(/[″”“ʺ]/g, '"').replace(/[º˚度]/g, '°').replace(/[−–—]/g, '-').replace(/[，、；]/g, ',');
  if (!/\d/.test(t)) return null;
  // only digits, signs, separators, degree marks and the letters N S E W: anything else is a name
  if (/[^\d\s.,;/°'"+\-NSEWnsew]/.test(t)) return null;
  const hasLetters = /[NSEW]/i.test(t), hasMarks = /[°'"]/.test(t);
  const cleaned = t.replace(/[,;/]/g, ' ').replace(/\s+/g, ' ').trim();

  let comps;
  if (hasLetters) {
    // "N30.59 E114.30" (letters first) or "30.59N 114.30E" (letters last)
    const segs = /^[NSEW]/i.test(cleaned) ? cleaned.split(/(?=[NSEW])/i) : cleaned.split(/(?<=[NSEW])\s/i);
    const parts = segs.map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 2) return /\d\s*[NSEW]\b|^[NSEW]\s*\d/i.test(t) ? { ok: false, error: 'Give one latitude and one longitude, for example 30.5928 N, 114.3055 E.' } : null;
    comps = parts.map(component);
  } else if (hasMarks) {
    const parts = cleaned.match(new RegExp(`${NUM}\\s*°(?:\\s*\\d+(?:\\.\\d+)?\\s*')?(?:\\s*\\d+(?:\\.\\d+)?\\s*")?`, 'g'));
    if (!parts || parts.length !== 2) return null;
    comps = parts.map(component);
  } else {
    const nums = cleaned.match(new RegExp(NUM, 'g'));
    if (!nums || nums.length !== 2) return null;
    // two plain numbers: they must look like coordinates, not a quantity or a date (dates have hyphens between digits)
    if (/\d-\d/.test(cleaned)) return null;
    comps = nums.map((x) => ({ value: parseFloat(x), letter: '' }));
  }
  if (comps.some((c) => !c)) return { ok: false, error: 'Minutes and seconds must be below 60.' };

  let lat, lon, swapped = false;
  if (comps[0].letter || comps[1].letter) {
    const lats = comps.filter((c) => c.letter === 'N' || c.letter === 'S'), lons = comps.filter((c) => c.letter === 'E' || c.letter === 'W');
    if (lats.length !== 1 || lons.length !== 1) return { ok: false, error: 'Give one latitude (N or S) and one longitude (E or W).' };
    lat = lats[0].value; lon = lons[0].value;
    swapped = comps[0].letter === 'E' || comps[0].letter === 'W';
  } else {
    [lat, lon] = [comps[0].value, comps[1].value];
    if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) { [lat, lon] = [lon, lat]; swapped = true; } // longitude first, as in Amap and Baidu
  }
  const r = checked(lat, lon, swapped);
  if (!r.ok) return r;
  return { ok: true, swapped, candidates: candidates(lat, lon) };
}
