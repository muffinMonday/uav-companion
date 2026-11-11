// A day-by-day forecast for the places of a trip (opt-in: it only runs while automatic weather is on in the privacy settings).
// One request per trip: Open-Meteo's daily forecast for the place of each day (the first stop that is not a hotel, else the first stop),
// up to 16 days ahead. Coordinates are rounded as the privacy settings say (about 1 km by default). Results are kept in this browser,
// apart from the markers, so they are never exported, and are forgotten when automatic weather is switched off.
import { getPrivacy, onPrivacyChange } from './privacy.js';
import { coord, wrapLon } from './weather.js';
import { daysBetween } from './dates.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const KEY = 'uavzones.v1.tripwx';
export const HORIZON_DAYS = 16;
const FRESH_MS = 3 * 60 * 60 * 1000;   // a forecast this young is reused
const RETRY_MS = 10 * 60 * 1000;       // after a failure, wait before asking again
const num = (v) => (Number.isFinite(v) ? v : null);

/** WMO weather code to a symbol and words. */
export function weatherInfo(code) {
  const c = Number(code);
  if (c === 0) return { icon: '☀️', label: 'Clear' };
  if (c === 1 || c === 2) return { icon: '🌤️', label: 'Partly cloudy' };
  if (c === 3) return { icon: '☁️', label: 'Overcast' };
  if (c === 45 || c === 48) return { icon: '🌫️', label: 'Fog' };
  if (c >= 51 && c <= 57) return { icon: '🌦️', label: 'Drizzle' };
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return { icon: '🌧️', label: 'Rain' };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { icon: '❄️', label: 'Snow' };
  if (c >= 95) return { icon: '⛈️', label: 'Thunderstorm' };
  return { icon: '·', label: 'No forecast' };
}

/** The days of a trip that have a place and are close enough to forecast: [{ date, lat, lon }]. `days` comes from planDays. */
export function forecastSpots(days, today) {
  const out = [];
  for (const d of days) {
    const offset = daysBetween(today, d.date);
    if (offset < 0 || offset >= HORIZON_DAYS) continue;
    const stop = d.stops.find((s) => s.type !== 'hotel' && s.type !== 'residence') ?? d.stops.find((s) => s.type !== 'residence');
    if (stop) out.push({ date: d.date, lat: stop.lat, lon: stop.lon });
  }
  return out;
}

/**
 * Daily forecasts for places. `spots`: [{ date, lat, lon }]. Returns { [date]: { code, max, min, rain, wind } } (numbers or null).
 * Places that round to the same coordinates are asked for once.
 */
export async function fetchDaily(spots, signal) {
  const keyOf = (s) => `${coord(s.lat)},${coord(wrapLon(s.lon))}`;
  const unique = [], index = new Map();
  for (const s of spots) { const k = keyOf(s); if (!index.has(k)) { index.set(k, unique.length); unique.push(s); } }
  const url = `${API}?latitude=${unique.map((p) => coord(p.lat)).join(',')}&longitude=${unique.map((p) => coord(wrapLon(p.lon))).join(',')}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max'
    + `&wind_speed_unit=ms&timezone=auto&forecast_days=${HORIZON_DAYS}`;
  const res = await fetch(url, { signal });
  if (res.status === 429) throw new Error('busy');
  if (!res.ok) throw new Error(`http ${res.status}`);
  const j = await res.json();
  const list = Array.isArray(j) ? j : [j]; // one place comes back as an object, several as an array
  if (list.length !== unique.length) throw new Error('unexpected response');
  const out = {};
  for (const s of spots) {
    const r = list[index.get(keyOf(s))];
    const i = Array.isArray(r?.daily?.time) ? r.daily.time.indexOf(s.date) : -1;
    if (i < 0) continue;
    const d = r.daily;
    out[s.date] = { code: num(d.weather_code?.[i]), max: num(d.temperature_2m_max?.[i]), min: num(d.temperature_2m_min?.[i]), rain: num(d.precipitation_probability_max?.[i]), wind: num(d.wind_speed_10m_max?.[i]) };
  }
  return out;
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!d || typeof d.trips !== 'object' || !d.trips) return {};
    const out = {};
    for (const [id, e] of Object.entries(d.trips)) if (e && Number.isFinite(e.t) && typeof e.sig === 'string' && e.days && typeof e.days === 'object') out[id] = { t: e.t, sig: e.sig, days: e.days };
    return out;
  } catch { return {}; }
}

export function createTripWeather({ onChange }) {
  let cache = load();
  const busy = new Set(), failedAt = new Map();
  const isOn = () => getPrivacy().autoWeather;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, trips: cache })); } catch { /* storage blocked: kept for this page only */ } };
  onPrivacyChange(() => { if (!isOn()) { cache = {}; failedAt.clear(); save(); onChange?.(); } }); // switching weather off forgets what was fetched

  return {
    /** The days with a forecast for this trip, or null. */
    get(tripId) { return isOn() ? cache[tripId]?.days ?? null : null; },
    /** Fetches the trip's forecast unless one is fresh for the same places. Does nothing while weather is off. */
    async ensure(tripId, spots) {
      if (!isOn() || !spots.length || busy.has(tripId)) return;
      const sig = spots.map((s) => `${s.date}@${coord(s.lat)},${coord(wrapLon(s.lon))}`).join('|');
      const have = cache[tripId];
      if (have && have.sig === sig && Date.now() - have.t < FRESH_MS) return;
      if (Date.now() - (failedAt.get(tripId) ?? 0) < RETRY_MS) return;
      busy.add(tripId);
      try {
        const days = await fetchDaily(spots);
        if (isOn()) { cache[tripId] = { t: Date.now(), sig, days }; save(); }
      } catch { failedAt.set(tripId, Date.now()); } finally { busy.delete(tripId); }
      onChange?.();
    },
    /** Drops the forecasts of trips that no longer exist. */
    prune(ids) { const keep = new Set(ids); let changed = false; for (const id of Object.keys(cache)) if (!keep.has(id)) { delete cache[id]; changed = true; } if (changed) save(); },
  };
}

