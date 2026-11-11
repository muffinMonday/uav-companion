import 'leaflet/dist/leaflet.css';
import './styles.css';
import L from 'leaflet';
import { createMap, createZones } from './map.js';
import { initSearch } from './search.js';
import { initPointCheck, checkPoint, describeCheck, zoneSummary } from './pointcheck.js';
import { addLocateControl, addCompassControl } from './locate.js';
import { createRotation } from './maprotate.js';
import { initWeather, weatherButton, getWindLimit, setWindLimit } from './weather.js';
import { initPanel } from './panel.js';
import { initControls } from './controls.js';
import { initHoldCheck, HOLD_MS } from './holdcheck.js';
import { initDashboard } from './dashboard.js';
import { initSplash } from './splash.js';
import { initCrosshair } from './crosshair.js';
import { mapLinkIcons } from './maplinks-ui.js';
import { MODES } from './maplinks.js';
import { toolBar } from './cards.js';
import { centreOn, popupMaxHeight } from './view.js';
import { initPOI } from './poi-ui.js';
import { initPrivacyUI } from './privacy-ui.js';
import { initSyncUI } from './sync-ui.js';
import { initFriendsUI } from './friends-ui.js';
import { initPartyUI } from './party-ui.js';
import { initPresence } from './presence.js';
import { initAI, loadPrompt } from './ai-ui.js';
import { initTripsUI } from './trips-ui.js';
import { getPrivacy } from './privacy.js';
import { onDistanceSettings } from './units.js';
import { lookupElevation } from './elevation.js';
import { tile, statsGrid } from './cards.js';
import { dataUrl, localUrl, mayHaveLocalData } from './config.js';
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
{ const q = $('q'), full = q.placeholder, narrow = matchMedia('(max-width:520px)'); const set = () => { q.placeholder = narrow.matches ? 'Search places or coordinates' : full; }; set(); narrow.addEventListener('change', set); }

const applyPopOpacity = (v) => document.documentElement.style.setProperty('--pop-alpha', String(v));
$('pop-op').value = prefs.popupOpacity ?? 0.8;
applyPopOpacity(+$('pop-op').value); // marker windows are frosted glass: this is how see-through they are
$('pop-op').addEventListener('input', (e) => applyPopOpacity(+e.target.value));
$('pop-op').addEventListener('change', (e) => savePrefs({ popupOpacity: +e.target.value }));
$('op').value = prefs.opacity ?? 0.45; // applied to the zones once they are loaded, below
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

// Weather (opt-in): a button in each result popup loads a forecast card for that point
const weather = initWeather();
// Maps card: which app the Open / Navigate buttons use, and the usual way of travelling
{
  const app = $('map-app'), mode = $('map-mode');
  for (const m of MODES) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; mode.append(o); }
  const p = loadPrefs();
  app.value = p.mapApp ?? 'auto'; mode.value = p.mapMode ?? MODES[0].id;
  app.addEventListener('change', () => savePrefs({ mapApp: app.value === 'auto' ? null : app.value }));
  mode.addEventListener('change', () => savePrefs({ mapMode: mode.value === MODES[0].id ? null : mode.value }));
}
const windInput = $('wlimit');
windInput.value = getWindLimit() ?? '';
windInput.addEventListener('change', () => { setWindLimit(parseFloat(windInput.value)); weather.refresh(); });

function showWeather(lat, lon, label) {
  panel.closeIfPhone(); // the bottom sheet would sit on top of the forecast card
  weather.show(lat, lon, label);
}
/** Adds what the privacy settings allow to a point-check popup: ground elevation, and the weather button. */
function decorate(content, latlng, label, onResize, extras = {}) {
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
  // the map-app icons sit right after the title (or, with no title, a line of coordinates)
  let sub = content.querySelector('.pop-sub');
  if (!sub) { sub = document.createElement('div'); sub.className = 'pop-sub'; sub.textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`; content.querySelector('.pop-bar')?.after(sub); }
  sub.classList.add('has-icons');
  sub.append(mapLinkIcons({ lat: latlng.lat, lon: latlng.lng, name: label }));
  if (extras.official) { // the region's own authoritative map (Singapore: OneMap), in a new tab
    const a = document.createElement('a');
    a.className = 'btn small maplink official-link'; a.href = extras.official.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = extras.official.label;
    content.append(a);
  }
  // save the spot as a marker (a searched spot also has a pin that can be removed): icons in the bar at the top
  const tools = [{ icon: 'pin', label: 'Add as marker', onClick: () => setTimeout(() => { map.closePopup(); extras.onAdded?.(); poi.addAt(latlng, label); }, 0) }];
  if (extras.onRemovePin) tools.push({ icon: 'unpin', label: 'Remove pin', onClick: () => setTimeout(() => { map.closePopup(); extras.onRemovePin(); }, 0) });
  content.prepend(toolBar({ caption: 'Point check', tools }));
  return content;
}

// Point check popup shared by map clicks and the location pin
// opts: offsetY (how far above the spot the window starts: a pin is in the way), zoom (to zoom to), onRemovePin, onAdded
async function showCheck(latlng, title, opts = {}) {
  const offsetY = opts.offsetY ?? 0;
  centreOn(map, latlng, { zoom: opts.zoom }); // the spot is centred at once, before the check has read its tile
  const res = await checkPoint(latlng.lat, latlng.lng);
  // a window too tall to fit above the spot scrolls inside instead of pushing the map around
  const popup = L.popup({ maxWidth: Math.min(320, window.innerWidth - 32), minWidth: Math.min(250, window.innerWidth - 40), offset: [0, offsetY], autoPan: false, closeOnClick: false, maxHeight: popupMaxHeight(map, offsetY) }).setLatLng(latlng);
  popup.setContent(decorate(describeCheck(res, title, opts.note), latlng, title, () => popup.update(), { ...opts, official: res.region?.officialMap })).openOn(map);
}

const rotation = createRotation(map); // turning the map (the locate button's compass mode, and two fingers by hand)
rotation.enableTouchTurn();
const locate = addLocateControl(map, {
  rotation,
  onFollow: () => panel.closeIfPhone(), // the bottom sheet would hide the map that is following you
  onError: (m) => toast(m, 7000),
});

// Points of interest (markers saved in this browser)
const poi = initPOI({ map, toast, checkPoint, zoneSummary, weatherButton, showWeather, panel,
  locateOnce: () => locate.request(),
});
{ // day numbers now follow from dates: say once if saved markers were changed to match
  const mig = poi.store.takeMigration();
  if (mig) toast(`Day numbers now follow the dates: ${mig.corrected} corrected${mig.converted ? `, ${mig.converted} turned into dates` : ''}.`, 9000);
}
initPrivacyUI({ mw: poi.mw, elev: poi.elev }); // the privacy settings own the weather and elevation switches
const trips = initTripsUI({ poi, panel, toast, checkPoint, zoneSummary });             // the Trips tab: create and edit trips, tag markers with them
const ai = initAI({ map, toast, panel, poi });  // paste an AI's itinerary, or open a share link, then preview and add
const opensShareLink = /^#import=/.test(location.hash); // read before fromHash() clears it
ai.fromHash();
const cross = initCrosshair(map); // a crosshair at the centre of the map (the button goes under the marker-details button)
// the zone verdict for where I am now (the position is read once, when the button is pressed)
const checkHere = () => locate.request().then((ll) => showCheck(ll, 'Your location', { zoom: 15 })).catch(() => { /* the location control has said why */ });
const cloud = { handle: null, refresh: null }; // the optional cloud copy: filled in once its code has loaded (only when this build has a project address)
addCompassControl(map, { rotation, onPress: () => locate.northUp() }); // after the other left-hand buttons, so their places do not move
const dash = initDashboard({ poi, panel, trips, cloud, shared: opensShareLink, splash: !opensShareLink, actions: { checkHere, crosshair: cross } });
const splash = initSplash({ dash, panel, ai, locate, loadPrompt, toast }); // the quick setup: greets a first visit, and "Quick setup" reopens it
dash.onQuickSetup(splash.open);
if (dash.splashFirst) splash.open();
initSyncUI({ store: poi.store, toast }).then((h) => { if (h) { cloud.handle = h; h.onChange(() => cloud.refresh?.()); initPresence({ handle: h }); initPartyUI({ handle: h, store: poi.store, panel, toast, cloud, map }); trips.setParty(cloud.party); initFriendsUI({ panel, handle: h, toast, cloud }); cloud.refresh?.(); } }).catch((e) => console.warn('cloud copy unavailable', e)); // What's new, the next trip, a backup reminder and the guide, along the bottom of the map

const checkAt = (latlng) => showCheck(latlng, `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`).catch(() => toast('Point check failed. Check your connection and try again.'));
// A quick click on blank map only closes windows. Holding still for 2 s, a right-click, or Enter on the focused map checks a spot.
const hold = initHoldCheck({ map, isBusy: () => poi.isBusy(), onCheck: checkAt, holdMs: HOLD_MS });
// (windows are opened with closeOnClick off: Leaflet would close them on the release that ends a hold, before this runs)
map.on('click', (e) => {
  if (hold.consumeClick()) return;   // the release after a hold is not a click
  map.closePopup();
  if (poi.handleMapClick(e)) return; // placing or editing markers: no point check
  if (!loadPrefs().holdHint) {
    savePrefs({ holdHint: true });
    toast('To check a spot, press and hold on the map for 2 seconds (or right-click).', 6000);
  }
});

// Data
try {
  const index = await loadJson('index.json');
  // Regions that are built locally only (publish: false) sit in ./data-local. They are looked for on localhost and private addresses only.
  const localManifests = [];
  if (mayHaveLocalData()) {
    try {
      const r = await fetch(localUrl('index.json'));
      const li = r.ok ? await r.json().catch(() => null) : null;
      for (const lc of li?.countries ?? []) {
        if (!lc.manifest) continue;
        const m = await (await fetch(localUrl(lc.manifest))).json();
        m.regions.forEach((x) => { x.local = true; });
        localManifests.push(m);
        const entry = index.countries.find((c) => c.id === lc.id);
        if (entry) entry.regions += m.regions.length; else index.countries.push({ ...lc, regions: m.regions.length, manifest: null, places: null });
      }
    } catch { /* no local data here: fine */ }
  }
  const [manifests, placeLists] = await Promise.all([
    Promise.all(index.countries.filter((c) => c.manifest).map((c) => loadJson(c.manifest))),
    Promise.all(index.countries.filter((c) => c.places).map((c) => loadJson(c.places))),
  ]);
  const regions = [...manifests, ...localManifests].flatMap((m) => m.regions);
  const places = placeLists.flat();
  initPointCheck(regions);
  initSearch(map, places, { show: showCheck });

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
  dash.setRegions(index.countries.filter((c) => c.regions && c.view).sort((x, y) => x.name.localeCompare(y.name)), goToCountry); // the dashboard's Fly in buttons
  if (prefs.country && index.countries.some((c) => c.id === prefs.country && c.view)) countrySel.value = prefs.country; // position itself comes from the saved view

  // Point features (flying areas): a green pin each, which opens the usual check window for that spot with a note
  const pinLayer = L.layerGroup().addTo(map);
  for (const r of regions.filter((x) => x.points)) {
    try {
      const pts = await (await fetch(r.local ? localUrl(r.points) : dataUrl(r.points))).json();
      const label = (id) => r.classes?.find((c) => c.id === id)?.label ?? 'Flying area';
      const summary = (id) => r.classes?.find((c) => c.id === id)?.summary ?? '';
      for (const p of pts) {
        const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'uafa-pin', html: '<span>UA</span>', iconSize: [28, 28], iconAnchor: [14, 14] }), title: p.name, alt: p.name, keyboard: true });
        m.on('click', () => showCheck(L.latLng(p.lat, p.lon), p.name, { offsetY: -16, note: `${label(p.class)}. ${summary(p.class)}` }));
        m.addTo(pinLayer);
      }
    } catch { /* the flying areas could not be loaded: the zones still work */ }
  }
  $('show').addEventListener('change', (e) => (e.target.checked ? pinLayer.addTo(map) : map.removeLayer(pinLayer)));

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
  const addLegend = (colour, text) => { const row = document.createElement('div'); const sw = document.createElement('i'); sw.style.background = colour; row.append(sw, text); legend.append(row); };
  for (const r of regions.filter((x) => x.classes)) {
    for (const c of r.classes) addLegend(c.color, c.points ? `${c.label}: where flying is allowed (a pin on the map).` : `${c.label}.`);
    const p = document.createElement('div'); p.className = 'legend-note'; p.textContent = `${r.name}: ${r.source.authority}, updated ${r.source.effective}. Approximate: not in a zone here does not mean flying is allowed. Check the official map.`; legend.append(p);
  }
  for (const sem of new Set(regions.filter((r) => !r.classes).map((r) => r.semantics))) {
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
