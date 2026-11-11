// Links that open a place or a route in Google Maps or Amap. Pure: no DOM, importable from Node tests.
//
// Formats come from the apps' own documentation:
//   Google  https://developers.google.com/maps/documentation/urls/guide   (needs api=1; lat,lng with the comma encoded; waypoints joined with |;
//           at most 3 waypoints in a mobile browser and 9 elsewhere)
//   Amap    https://lbs.amap.com/api/uri-api/guide/mobile-web/point  and  .../guide/travel/route  (lon,lat order; marker takes coordinate=wgs84;
//           the navigation link has no coordinate setting, so GCJ-02 is sent; at most one "via", driving only; an empty start means the user's location)
// Inside China Amap comes first and Google Maps second; anywhere else, Google Maps only.
import { wgs84ToGcj02, inChina } from './coords.js';

export const SRC = 'uav-companion';
export const APP_LABEL = { amap: 'Amap', google: 'Google Maps' };
export const MODES = [
  { id: 'drive', label: 'Drive', google: 'driving', amap: 'car' },
  { id: 'transit', label: 'Public transport', google: 'transit', amap: 'bus' },
  { id: 'walk', label: 'Walk', google: 'walking', amap: 'walk' },
  { id: 'bike', label: 'Bike', google: 'bicycling', amap: 'ride' },
];
export const GOOGLE_MAX_WAYPOINTS = { mobile: 3, desktop: 9 };
export const MAX_STOPS = 30;

const mode = (id) => MODES.find((m) => m.id === id) ?? MODES[0];
const fix = (v) => v.toFixed(6);
const gll = (p) => `${fix(p.lat)}%2C${fix(p.lon)}`;
const clean = (name) => String(name ?? '').replace(/[\u0000-\u001f,|;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
const enc = (name) => encodeURIComponent(clean(name));

/** Which apps to offer for these places: Amap first and Google Maps when every one is in China, otherwise Google Maps only. */
export function appsFor(points) {
  return points.length && points.every((p) => inChina(p.lat, p.lon)) ? ['amap', 'google'] : ['google'];
}

/**
 * The one app the buttons use. 'auto' (the default): Amap when every place is in China, Google Maps otherwise. A chosen app wins,
 * except that Amap only covers China: anywhere else Google Maps is used whatever was chosen.
 */
export function resolveApp(points, pref = 'auto') {
  if (pref === 'google') return 'google';
  return appsFor(points)[0];
}

/** A link that shows one place. */
export function placeUrl(app, p) {
  if (app === 'amap') {
    const name = clean(p.name);
    return `https://uri.amap.com/marker?position=${fix(p.lon)},${fix(p.lat)}${name ? `&name=${enc(name)}` : ''}&coordinate=wgs84&src=${SRC}&callnative=1`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${gll(p)}`;
}

/** A link for directions to a place from wherever the user is (the start is left out, so both apps use the device location). */
export function hereUrl(app, p, modeId = 'drive') {
  const m = mode(modeId);
  if (app === 'amap') {
    const g = wgs84ToGcj02(p);
    const name = clean(p.name);
    return `https://uri.amap.com/navigation?to=${fix(g.lon)},${fix(g.lat)}${name ? `,${enc(name)}` : ''}&mode=${m.amap}&src=${SRC}&callnative=1`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${gll(p)}&travelmode=${m.google}`;
}

/** Stops cut into pieces of at most `size` stops, each piece starting at the previous one's last stop. */
export function chunk(stops, size) {
  const out = [];
  for (let i = 0; ; i += size - 1) {
    out.push(stops.slice(i, i + size));
    if (i + size >= stops.length) break;
  }
  return out;
}

const short = (p, i) => clean(p.name).slice(0, 22) || `stop ${i + 1}`;

/**
 * Links for a route through `stops` ([{ lat, lon, name }], two or more, in order). One link when the app can take the whole route,
 * otherwise several that each cover a piece. Returns { parts: [{ label, url }], note }.
 * Pass { mobile: true } on a phone (Google Maps takes fewer stops there).
 */
export function routeUrls(app, stops, modeId = 'drive', { mobile = false } = {}) {
  const m = mode(modeId);
  const cap = app === 'google' ? (mobile ? GOOGLE_MAX_WAYPOINTS.mobile : GOOGLE_MAX_WAYPOINTS.desktop) + 2 : (m.id === 'drive' ? 3 : 2);
  const pieces = chunk(stops, cap);
  let index = 0;
  const parts = pieces.map((piece) => {
    const first = piece[0], last = piece[piece.length - 1], mid = piece.slice(1, -1);
    let url;
    if (app === 'google') {
      url = `https://www.google.com/maps/dir/?api=1&origin=${gll(first)}&destination=${gll(last)}&travelmode=${m.google}`
        + (mid.length ? `&waypoints=${mid.map(gll).join('%7C')}` : '');
    } else {
      const pt = (p) => { const g = wgs84ToGcj02(p); const n = clean(p.name); return `${fix(g.lon)},${fix(g.lat)}${n ? `,${enc(n)}` : ''}`; };
      url = `https://uri.amap.com/navigation?from=${pt(first)}&to=${pt(last)}${mid.length ? `&via=${pt(mid[0])}` : ''}&mode=${m.amap}&src=${SRC}&callnative=1`;
    }
    const label = pieces.length === 1 ? `Open in ${APP_LABEL[app]}` : `${APP_LABEL[app]}, part ${++index}: ${short(first, stops.indexOf(first))} → ${short(last, stops.indexOf(last))}`;
    return { label, url };
  });
  let note = '';
  if (pieces.length > 1) {
    note = app === 'google'
      ? `Google Maps takes ${cap - 2} stops between the start and end${mobile ? ' on a phone' : ''}, so this route opens in ${pieces.length} parts.`
      : m.id === 'drive'
        ? `Amap takes one stop between the start and end, so this route opens in ${pieces.length} parts.`
        : `Amap plans ${m.label.toLowerCase()} routes between two places, so each leg opens separately (${pieces.length} legs).`;
  }
  if (app === 'amap' && m.id === 'bike') note = (note ? `${note} ` : '') + 'Amap opens bike routes in its phone app only.';
  return { parts, note };
}
