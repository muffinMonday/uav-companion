import 'leaflet/dist/leaflet.css';
import './styles.css';
import L from 'leaflet';
import { createMap, createZones } from './map.js';
import { initSearch } from './search.js';
import { initPointCheck, checkPoint, describeCheck, zoneSummary } from './pointcheck.js';
import { addLocateControl } from './locate.js';
import { initWeather, weatherButton, getWindLimit, setWindLimit } from './weather.js';
import { initPanel } from './panel.js';
import { initControls } from './controls.js';
import { initPOI } from './poi-ui.js';
import { initPrivacyUI } from './privacy-ui.js';
import { initAI } from './ai-ui.js';
import { initTripsUI } from './trips-ui.js';
import { getPrivacy } from './privacy.js';
import { onDistanceSettings } from './units.js';
import { lookupElevation } from './elevation.js';
import { tile, statsGrid } from './cards.js';
import { dataUrl } from './config.js';
import { loadPrefs, savePrefs } from './prefs.js';

const $ = (id) => document.getElementById(id);

/** A short message at the top of the map. `action` ({ label, run }) adds one button, e.g. Undo; pressing it closes the message. */
function toast(text, ms = 5000, action = null) {
  const el = $('toast');
  el.textContent = text; el.hidden = false;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-action'; b.textContent = action.label;
    b.addEventListener('click', () => { el.hidden = true; clearTimeout(toast.t); action.run(); });
    el.append(' ', b);
  }
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

async function loadJson(path) {
  const r = await fetch(dataUrl(path));
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

// Remembered from the last visit: basemap, country choice, map position (all kept in this browser only)
const prefs = loadPrefs();
const { map, switchBase, setScaleUnits } = createMap(prefs);
onDistanceSettings((s) => setScaleUnits(s.units)); // the scale bar follows the distance units chosen in Points of Interest
const panel = initPanel();
initControls(); // modern number and date fields, also for markers' windows built later
// the search box is narrow on a phone: a shorter hint there
{ const q = $('q'), full = q.placeholder, narrow = matchMedia('(max-width:520px)'); const set = () => { q.placeholder = narrow.matches ? 'Search places' : full; }; set(); narrow.addEventListener('change', set); }

$('op').value = prefs.opacity ?? 0.45; // applied to the zones once they are loaded, below
$('base').value = prefs.basemap ?? 'esri';
$('base').addEventListener('change', (e) => { switchBase(e.target.value); savePrefs({ basemap: e.target.value }); });

let viewTimer = null;
function saveView() {
  clearTimeout(viewTimer);
  const c = map.getCenter().wrap();
  savePrefs({ view: { lat: Math.round(c.lat * 1e5) / 1e5, lon: Math.round(c.lng * 1e5) / 1e5, zoom: map.getZoom() } });
}
map.on('moveend', () => { clearTimeout(viewTimer); viewTimer = setTimeout(saveView, 400); });
window.addEventListener('pagehide', saveView); // a reload straight after panning must not lose the last move

// Weather (opt-in): a button in each result popup loads a forecast card for that point
const weather = initWeather();
const windInput = $('wlimit');
windInput.value = getWindLimit() ?? '';
windInput.addEventListener('change', () => { setWindLimit(parseFloat(windInput.value)); weather.refresh(); });

function showWeather(lat, lon, label) {
  panel.closeIfPhone(); // the bottom sheet would sit on top of the forecast card
  weather.show(lat, lon, label);
}
/** Adds what the privacy settings allow to a point-check popup: ground elevation, and the weather button. */
function decorate(content, latlng, label, onResize) {
  if (getPrivacy().fetchAltitude) {
    const t = tile('elev', 'Elevation', '…');
    const box = document.createElement('div');
    box.className = 'stats-wrap';
    box.append(statsGrid([t]));
    content.insertBefore(box, content.querySelector('.disclaimer'));
    const set = (text) => { t.querySelector('.v').textContent = text; onResize?.(); };
    lookupElevation(latlng.lat, latlng.lng).then((m) => set(m === null ? '–' : `${Math.round(m)} m`)).catch(() => set('–'));
  }
  content.append(weatherButton(() => { map.closePopup(); showWeather(latlng.lat, latlng.lng, label); }));
  return content;
}

// Point check popup shared by map clicks and the location pin
async function showCheck(latlng, title) {
  const res = await checkPoint(latlng.lat, latlng.lng);
  const popup = L.popup({ maxWidth: Math.min(320, window.innerWidth - 32), minWidth: Math.min(250, window.innerWidth - 40) }).setLatLng(latlng);
  popup.setContent(decorate(describeCheck(res, title), latlng, title, () => popup.update())).openOn(map);
}

let quietFix = false; // true while a marker is being placed at the user's location: its own popup must stay open
const locate = addLocateControl(map, {
  onError: (m) => toast(m, 7000),
  onFix: (() => {
    let first = true;
    return (dot, e) => {
      if (!first) return;
      first = false;
      if (quietFix) return;
      checkPoint(e.latlng.lat, e.latlng.lng)
        .then((res) => dot.bindPopup(decorate(describeCheck(res, 'Your location'), e.latlng, 'Your location', () => dot.getPopup()?.update()), { maxWidth: Math.min(320, window.innerWidth - 32), minWidth: Math.min(250, window.innerWidth - 40) }).openPopup())
        .catch(() => {});
    };
  })(),
});

// Points of interest (markers saved in this browser)
const poi = initPOI({ map, toast, checkPoint, zoneSummary, weatherButton, showWeather, panel,
  locateOnce: () => { quietFix = true; return locate.request().finally(() => { quietFix = false; }); },
});
initPrivacyUI({ mw: poi.mw, elev: poi.elev }); // the privacy settings own the weather and elevation switches
initTripsUI({ poi, panel, toast });             // the Trips tab: create and edit trips, tag markers with them
const ai = initAI({ map, toast, panel, poi });  // paste an AI's itinerary, or open a share link, then preview and add
ai.fromHash();

map.on('click', (e) => {
  if (poi.handleMapClick(e)) return; // placing or editing markers: no point check
  showCheck(e.latlng, `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`).catch(() => toast('Point check failed. Check your connection and try again.'));
});

// Data
try {
  const index = await loadJson('index.json');
  const [manifests, placeLists] = await Promise.all([
    Promise.all(index.countries.filter((c) => c.manifest).map((c) => loadJson(c.manifest))),
    Promise.all(index.countries.filter((c) => c.places).map((c) => loadJson(c.places))),
  ]);
  const regions = manifests.flatMap((m) => m.regions);
  const places = placeLists.flat();
  initPointCheck(regions);
  initSearch(map, places);

  // Country shortcut: re-centres on a country's view box, whether or not it has zone data yet
  const countrySel = $('country');
  for (const c of index.countries.filter((x) => x.view).sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.regions ? c.name : `${c.name} (no zone data yet)`;
    countrySel.append(o);
  }
  // keep what we fit clear of a docked side panel (phones use a bottom sheet that is closed while viewing)
  const clearOfPanel = () => (panel.isOpen() && window.innerWidth > 520 ? { paddingBottomRight: [$('panel').offsetWidth + 24, 0] } : undefined);
  const goToCountry = (id) => {
    const c = index.countries.find((x) => x.id === id && x.view);
    if (!c) return;
    map.fitBounds([[c.view[1], c.view[0]], [c.view[3], c.view[2]]], clearOfPanel());
    if (!c.regions) toast(`No zone data for ${c.name} yet. The map shows nothing about flying rules there.`, 7000);
  };
  // The choice stays shown in the menu and is remembered. Choosing it again after panning away: use the Centre button.
  countrySel.addEventListener('change', () => { savePrefs({ country: countrySel.value || null }); goToCountry(countrySel.value); });
  $('country-go').addEventListener('click', () => {
    if (!countrySel.value) { toast('Choose a country first.', 3000); return; }
    goToCountry(countrySel.value);
  });
  if (prefs.country && index.countries.some((c) => c.id === prefs.country && c.view)) countrySel.value = prefs.country; // position itself comes from the saved view

  const zones = createZones(map, regions);
  zones.setOpacity(+$('op').value); // the remembered opacity, before any zone layer is created
  if (!prefs.view) zones.fit(clearOfPanel()); // first visit: show all covered regions; later visits resume where the user left off
  zones.sync();
  $('show').addEventListener('change', (e) => zones.setVisible(e.target.checked));
  $('op').addEventListener('input', (e) => zones.setOpacity(+e.target.value));        // live while dragging
  $('op').addEventListener('change', (e) => savePrefs({ opacity: +e.target.value })); // saved when released

  const legend = $('legend');
  const meanings = {
    allow: ['#2aa6b8', 'Teal: suitable-flight airspace (flying permitted within the stated height); everything else is controlled.'],
    restrict: ['#d64545', 'Red: restricted area. Elsewhere there is no restriction in this data, which is not the same as permission to fly.'],
  };
  for (const sem of new Set(regions.map((r) => r.semantics))) {
    const row = document.createElement('div');
    const sw = document.createElement('i');
    sw.style.background = meanings[sem][0];
    row.append(sw, meanings[sem][1]);
    legend.append(row);
  }

  const note = $('regions-note');
  note.textContent = '';
  const b = document.createElement('b');
  const pending = index.countries.filter((c) => !c.regions).map((c) => c.name);
  b.textContent = `Coverage: ${regions.map((r) => r.name).join(', ') || 'none'}.${pending.length ? ` No data yet: ${pending.join(', ')}.` : ''} `;
  note.append(b, 'Official data: ' + [...new Set(regions.map((r) => `${r.source.authority} (effective ${r.source.effective})`))].join('; ') + '.');
} catch (err) {
  console.error(err);
  $('regions-note').textContent = 'Could not load zone data. Run "npm run build:data" first, then reload.';
}
