// Remembered settings (last basemap, country choice, map position, zone opacity, privacy choices), kept in this browser only.
// Everything read back is validated, so a damaged or hand-edited entry falls back to the defaults.
const KEY = 'uavzones.v1.prefs';

export const BASEMAPS = ['esri', 'sat', 'topo', 'osm'];
const MAX_ZOOM = 19;

function sanitize(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (BASEMAPS.includes(raw.basemap)) out.basemap = raw.basemap;
  if (typeof raw.country === 'string' && /^[a-z]{2,8}$/.test(raw.country)) out.country = raw.country;
  if (Number.isFinite(raw.opacity) && raw.opacity >= 0.1 && raw.opacity <= 0.9) out.opacity = Math.round(raw.opacity * 100) / 100; // the slider's own range
  if (raw.units === 'metric' || raw.units === 'imperial') out.units = raw.units;
  if (Number.isFinite(raw.maxRangeM) && raw.maxRangeM >= 100 && raw.maxRangeM <= 200000) out.maxRangeM = Math.round(raw.maxRangeM); // 100 m to 200 km
  if (Number.isFinite(raw.popupOpacity) && raw.popupOpacity >= 0.5 && raw.popupOpacity <= 1) out.popupOpacity = Math.round(raw.popupOpacity * 100) / 100; // the slider's own range
  if (typeof raw.currentTrip === 'string' && raw.currentTrip.length > 0 && raw.currentTrip.length <= 64) out.currentTrip = raw.currentTrip; // checked against the saved trips when used
  if (typeof raw.windowExpanded === 'boolean') out.windowExpanded = raw.windowExpanded;
  if (typeof raw.holdHint === 'boolean') out.holdHint = raw.holdHint;
  if (raw.markerDetails === false) out.markerDetails = false; // a click on a marker only selects it (no details window)
  if (typeof raw.panelRolled === 'boolean') out.panelRolled = raw.panelRolled; // the side panel is rolled up to its header
  if (typeof raw.autoWeather === 'boolean') out.autoWeather = raw.autoWeather;
  if (raw.weatherPrecision === 'precise' || raw.weatherPrecision === 'estimated') out.weatherPrecision = raw.weatherPrecision;
  if (typeof raw.fetchAltitude === 'boolean') out.fetchAltitude = raw.fetchAltitude;
  if (typeof raw.lookupNames === 'boolean') out.lookupNames = raw.lookupNames;
  if (typeof raw.checkIn === 'boolean') out.checkIn = raw.checkIn; // use the position to enable check-in at markers
  if (['auto', 'amap', 'google'].includes(raw.mapApp)) out.mapApp = raw.mapApp; // which map app the Open / Navigate buttons use
  if (['drive', 'transit', 'walk', 'bike'].includes(raw.mapMode)) out.mapMode = raw.mapMode; // the usual way of travelling
  const v = raw.view;
  if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom)
    && Math.abs(v.lat) <= 85 && Math.abs(v.lon) <= 180 && v.zoom >= 0 && v.zoom <= MAX_ZOOM) {
    out.view = { lat: v.lat, lon: v.lon, zoom: Math.round(v.zoom) };
  }
  return out;
}

export function loadPrefs() {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return {}; }
}

/** Merges a change into the stored settings. A value of null removes that setting. Silent if storage is unavailable. */
export function savePrefs(patch) {
  try {
    const next = { ...loadPrefs(), ...patch };
    for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined) delete next[k];
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage blocked or full: the app simply will not remember */ }
}
