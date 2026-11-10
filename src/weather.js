// Point forecasts from Open-Meteo (https://open-meteo.com, CC BY 4.0, free for non-commercial use).
// Nothing is requested unless the user presses "Show weather here" or turns on automatic weather for markers
// (see markerweather.js). Either way the point's coordinates go to open-meteo.com. By default they are rounded to
// about 1 km: the forecast grid is 10 to 25 km, so that changes nothing in the result and discloses less.
// The visitor can choose precise (about 10 m) coordinates instead in the privacy settings (privacy.js).
import { getPrivacy } from './privacy.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const HOURLY = 'temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_speed_120m,visibility';
const HOURS = 12;
const SUMMARY_HOURS = 5;
const LIMIT_KEY = 'uavzones.windLimit';

const num = (v) => (Number.isFinite(v) ? v : null);
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180; // the map can be panned past the date line
const coord = (v) => {
  const d = getPrivacy().weatherPrecision === 'precise' ? 4 : 2; // decimals: 4 is about 10 m, 2 is about 1 km
  const f = 10 ** d;
  return (Math.round(v * f) / f).toFixed(d);
};

/** Mean of the non-null values, or null if there are none. */
const mean = (xs) => { const v = xs.filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const maxOf = (xs) => { const v = xs.filter((x) => x !== null); return v.length ? Math.max(...v) : null; };

/**
 * One request for many points (Open-Meteo accepts comma-separated coordinate lists; each point counts toward the rate limit).
 * For each point, summarises the SUMMARY_HOURS hourly values starting at the current local hour there.
 * Returns [{ id, temp, wind, gust, n, start, tz }] in the order given; temp/wind/gust are null if the model gave no values.
 */
export async function fetchSummaries(points, signal) {
  const url = `${API}?latitude=${points.map((p) => coord(p.lat)).join(',')}&longitude=${points.map((p) => coord(wrapLon(p.lon))).join(',')}`
    + '&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=auto&forecast_days=2';
  const res = await fetch(url, { signal });
  if (res.status === 429) throw new Error('busy');
  if (!res.ok) throw new Error(`http ${res.status}`);
  const j = await res.json();
  const list = Array.isArray(j) ? j : [j]; // a single point comes back as an object, several as an array
  if (list.length !== points.length) throw new Error('unexpected response');
  return list.map((r, i) => {
    const nowLocal = new Date(Date.now() + r.utc_offset_seconds * 1000).toISOString().slice(0, 13) + ':00';
    const from = r.hourly.time.findIndex((t) => t >= nowLocal);
    if (from < 0) throw new Error('unexpected response');
    const win = (key) => r.hourly[key].slice(from, from + SUMMARY_HOURS).map(num);
    return {
      id: points[i].id, temp: mean(win('temperature_2m')), wind: mean(win('wind_speed_10m')), gust: maxOf(win('wind_gusts_10m')),
      n: Math.min(SUMMARY_HOURS, r.hourly.time.length - from), start: r.hourly.time[from].slice(11, 16), tz: r.timezone_abbreviation || '',
    };
  });
}

async function fetchForecast(lat, lon, signal) {
  const url = `${API}?latitude=${coord(lat)}&longitude=${coord(wrapLon(lon))}&hourly=${HOURLY}&daily=sunrise,sunset`
    + '&wind_speed_unit=ms&timezone=auto&forecast_days=2';
  const res = await fetch(url, { signal });
  if (res.status === 429) throw new Error('busy');
  if (!res.ok) throw new Error(`http ${res.status}`);
  const j = await res.json();

  // Hourly times are local to the point (timezone=auto). Start at the current local hour.
  const nowLocal = new Date(Date.now() + j.utc_offset_seconds * 1000).toISOString().slice(0, 13) + ':00';
  const start = Math.max(0, j.hourly.time.findIndex((t) => t >= nowLocal));
  const h = j.hourly;
  const rows = [];
  for (let i = start; i < Math.min(start + HOURS, h.time.length); i++) {
    rows.push({
      time: h.time[i].slice(11, 16), temp: num(h.temperature_2m[i]), rain: num(h.precipitation[i]),
      wind10: num(h.wind_speed_10m[i]), gust: num(h.wind_gusts_10m[i]), wind120: num(h.wind_speed_120m[i]),
      vis: num(h.visibility[i]),
    });
  }
  const today = nowLocal.slice(0, 10);
  const di = Math.max(0, j.daily.time.indexOf(today));
  return { rows, sunrise: j.daily.sunrise[di]?.slice(11, 16), sunset: j.daily.sunset[di]?.slice(11, 16), tz: j.timezone_abbreviation };
}

export function getWindLimit() {
  try { const v = parseFloat(localStorage.getItem(LIMIT_KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}
export function setWindLimit(v) {
  try { if (v) localStorage.setItem(LIMIT_KEY, String(v)); else localStorage.removeItem(LIMIT_KEY); } catch { /* storage unavailable */ }
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Controls the #weather card. show(lat, lon, label) loads and renders; refresh() re-renders (e.g. after the wind limit changes). */
export function initWeather() {
  const card = document.getElementById('weather');
  let controller = null;
  let last = null; // { lat, lon, label, data }

  function render() {
    card.replaceChildren();
    if (!last) { card.hidden = true; return; }
    card.hidden = false;
    const limit = getWindLimit();

    const head = el('div', 'wx-head');
    head.append(el('strong', '', 'Weather'), el('span', 'wx-where', last.label));
    const close = el('button', 'wx-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close weather');
    close.addEventListener('click', () => { controller?.abort(); last = null; render(); });
    head.append(close);
    card.append(head);

    if (!last.data) { card.append(el('div', 'wx-msg', last.error || 'Loading forecast…')); return; }
    const d = last.data;

    card.append(el('div', 'wx-sub',
      `Next ${d.rows.length} hours, local time${d.tz ? ` (${d.tz})` : ''}. Regional model, roughly 10 to 25 km: valleys, hills and coasts can differ a lot.`
      + (d.sunrise ? ` Sunrise ${d.sunrise}, sunset ${d.sunset}.` : '')));

    const cols = [['Time'], ['Wind 10 m', 'm/s'], ['Gust', 'm/s'], ['Wind 120 m', 'm/s'], ['Rain', 'mm'], ['Vis.', 'km'], ['Temp', '°C']];
    const table = el('table', 'wx-table');
    const trh = el('tr');
    for (const [name, unit] of cols) { const th = el('th', '', name); if (unit) th.append(el('small', '', unit)); trh.append(th); }
    const thead = el('thead');
    thead.append(trh);
    table.append(thead);
    const body = el('tbody');
    const f = (v, dp = 1) => (v === null ? '–' : v.toFixed(dp));
    for (const r of d.rows) {
      const tr = el('tr');
      tr.append(el('td', '', r.time));
      for (const key of ['wind10', 'gust', 'wind120']) {
        const td = el('td', limit !== null && r[key] !== null && r[key] > limit ? 'over' : '', f(r[key]));
        tr.append(td);
      }
      tr.append(el('td', r.rain > 0 ? 'wet' : '', f(r.rain)), el('td', '', r.vis === null ? '–' : f(r.vis / 1000, 0)), el('td', '', f(r.temp, 0)));
      body.append(tr);
    }
    table.append(body);
    const wrap = el('div', 'wx-scroll');
    wrap.append(table);
    card.append(wrap);

    card.append(el('div', 'wx-sub', limit !== null
      ? `Red = above your ${limit} m/s wind limit (set in the menu).`
      : 'Set a wind limit in the menu to highlight hours above it.'));
    const credit = el('div', 'wx-credit');
    const a = el('a', '', 'Weather data by Open-Meteo.com');
    a.href = 'https://open-meteo.com/'; a.target = '_blank'; a.rel = 'noopener noreferrer';
    credit.append(a, ' (CC BY 4.0). A forecast, not a flight clearance.');
    card.append(credit);
  }

  async function show(lat, lon, label) {
    controller?.abort();
    controller = new AbortController();
    last = { lat, lon, label, data: null, error: null };
    render();
    try {
      last.data = await fetchForecast(lat, lon, controller.signal);
    } catch (e) {
      if (e.name === 'AbortError') return;
      last.error = e.message === 'busy'
        ? 'The weather service is busy. Try again in a minute.'
        : 'Weather unavailable (no connection, or the service is down).';
    }
    render();
  }

  return { show, refresh: render };
}

/** The opt-in button that goes into popups. */
export function weatherButton(onPress) {
  const wrap = el('div', 'wx-opt');
  const b = el('button', 'wx-btn', 'Show weather here');
  b.type = 'button';
  b.addEventListener('click', onPress);
  const exact = getPrivacy().weatherPrecision === 'precise';
  wrap.append(b, el('small', '', exact ? 'Sends the exact location to Open-Meteo.com' : 'Sends this location, rounded to about 1 km, to Open-Meteo.com'));
  return wrap;
}
