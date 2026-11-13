import { MODES } from '../maplinks.js';
import { getWindLimit, setWindLimit } from '../weather.js';
import { loadPrefs, savePrefs } from '../prefs.js';
import { setTheme, currentPref, onThemePref } from '../theme.js';

const $ = (id) => document.getElementById(id);

/** Appearance card: System / Light / Dark (follows a choice made in another tab or synced from another device). Call after initTheme(). */
export function initAppearanceSettings() {
  const radios = [...document.querySelectorAll('#theme-radios input')];
  const show = (cur) => radios.forEach((r) => { r.checked = r.value === cur; });
  show(currentPref());
  radios.forEach((r) => r.addEventListener('change', () => { if (r.checked) setTheme(r.value); }));
  onThemePref(show);
}

/** Popup opacity, basemap, the remembered zone opacity (applied to the zones once they load) and the saved map position. */
export function initMapSettings({ map, switchBase, prefs }) {
  const applyPopOpacity = (v) => document.documentElement.style.setProperty('--pop-alpha', String(v));
  $('pop-op').value = prefs.popupOpacity ?? 0.8;
  applyPopOpacity(+$('pop-op').value); // marker windows are frosted glass: this is how see-through they are
  $('pop-op').addEventListener('input', (e) => applyPopOpacity(+e.target.value));
  $('pop-op').addEventListener('change', (e) => savePrefs({ popupOpacity: +e.target.value }));
  $('op').value = prefs.opacity ?? 0.45; // applied to the zones once they are loaded
  $('base').value = prefs.basemap ?? 'osm';
  $('base').addEventListener('change', (e) => { switchBase(e.target.value); savePrefs({ basemap: e.target.value }); });

  let viewTimer = null;
  function saveView() {
    clearTimeout(viewTimer);
    const c = map.getCenter().wrap();
    savePrefs({ view: { lat: Math.round(c.lat * 1e5) / 1e5, lon: Math.round(c.lng * 1e5) / 1e5, zoom: map.getZoom() } });
  }
  map.on('moveend', () => { clearTimeout(viewTimer); viewTimer = setTimeout(saveView, 400); });
  window.addEventListener('pagehide', saveView); // a reload straight after panning must not lose the last move
}

/** Maps card (which app the Open / Navigate buttons use, the usual way of travelling) and the wind limit. Call after initWeather(). */
export function initWeatherSettings({ weather }) {
  const app = $('map-app'), mode = $('map-mode');
  for (const m of MODES) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; mode.append(o); }
  const p = loadPrefs();
  app.value = p.mapApp ?? 'auto'; mode.value = p.mapMode ?? MODES[0].id;
  app.addEventListener('change', () => savePrefs({ mapApp: app.value === 'auto' ? null : app.value }));
  mode.addEventListener('change', () => savePrefs({ mapMode: mode.value === MODES[0].id ? null : mode.value }));
  const windInput = $('wlimit');
  windInput.value = getWindLimit() ?? '';
  windInput.addEventListener('change', () => { setWindLimit(parseFloat(windInput.value)); weather.refresh(); });
}
