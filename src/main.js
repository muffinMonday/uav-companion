import 'leaflet/dist/leaflet.css';
import './styles.css';
import L from 'leaflet';
import { createMap, createZones } from './map.js';
import { initSearch } from './search.js';
import { initPointCheck, checkPoint, zoneSummary } from './pointcheck.js';
import { addLocateControl, addCompassControl, launchFix } from './locate.js';
import { createRotation } from './maprotate.js';
import { initWeather, weatherButton } from './weather.js';
import { createPointCheckUI } from './app/point-check.js';
import { loadRegionData } from './app/region-loader.js';
import { initRegionUI, renderRegionInfo } from './app/region-ui.js';
import { initAppearanceSettings, initMapSettings, initWeatherSettings } from './app/map-settings.js';
import { initPanel } from './panel.js';
import { initControls } from './controls.js';
import { initHoldCheck, HOLD_MS } from './holdcheck.js';
import { initDashboard } from './dashboard.js';
import { initSplash } from './splash.js';
import { initMapToolbarHelp } from './map-toolbar-help.js';
import { initHelp } from './help-wire.js';
import { initCrosshair } from './crosshair.js';
import { initPOI } from './poi-ui.js';
import { initPrivacyUI } from './privacy-ui.js';
import { initSyncUI } from './sync-ui.js';
import { initFriendsUI } from './friends-ui.js';
import { initSessionsHub } from './sessions-hub.js';
import { initAccountUI } from './account-ui.js';
import { initPartyUI } from './party-ui.js';
import { initPresence } from './presence.js';
import { initAI, loadPrompt } from './ai-ui.js';
import { initTripsUI } from './trips-ui.js';
import { getPrivacy } from './privacy.js';
import { onDistanceSettings } from './units.js';
import { dataUrl, localUrl, mayHaveLocalData } from './config.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { initTheme } from './theme.js';
import { log, applyDebugParam } from './log.js';
import { installErrorHandlers } from './errors.js';

applyDebugParam(location.search); // ?debug=1 keeps DEBUG notes in the local log, ?debug=0 stops (log.js)
installErrorHandlers({ log }); // uncaught errors and rejected promises leave a note in the local log; the browser still reports them as before

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

// Remembered from the last visit: basemap, country choice, map position (all kept in this browser only)
const prefs = loadPrefs();
initTheme();
initAppearanceSettings();
const { map, switchBase, setScaleUnits } = createMap(prefs);
onDistanceSettings((s) => setScaleUnits(s.units)); // the scale bar follows the distance units chosen in Points of Interest
const panel = initPanel();
initControls(); // modern number and date fields, also for markers' windows built later
// the search box is narrow on a phone: a shorter hint there
{ const q = $('q'), full = q.placeholder, narrow = matchMedia('(max-width:520px)'); const set = () => { q.placeholder = narrow.matches ? 'Search places or coordinates' : full; }; set(); narrow.addEventListener('change', set); }

initMapSettings({ map, switchBase, prefs });
// Weather (opt-in): a button in each result popup loads a forecast card for that point
const weather = initWeather();
initWeatherSettings({ weather });

// Point check popup (map clicks, searches, pins, the location button); markers are saved through the POI module created below
const { showCheck, showWeather } = createPointCheckUI({ map, panel, weather, addAt: (...a) => poi.addAt(...a) });

const rotation = createRotation(map); // turning the map (the locate button's compass mode, and two fingers by hand)
rotation.enableTouchTurn();
const locate = addLocateControl(map, {
  rotation,
  onFollow: () => panel.closeIfPhone(), // the bottom sheet would hide the map that is following you
  onError: (m) => toast(m, 7000),
});

// On launch: ask for the position and, if the browser allows it, open the map on the visitor. Otherwise the map stays where it was left (prefs.view).
let launchCentred = false, userMoved = false;
if (getPrivacy().locateOnLaunch) {
  for (const ev of ['mousedown', 'touchstart', 'wheel']) map.getContainer().addEventListener(ev, () => { userMoved = true; }, { once: true, passive: true });
  launchFix().then((f) => {
    if (!f) return; // no position
    locate.showFix(f); // the blip, whether or not the map is centred on it
    if (userMoved) return; // the visitor already took the map somewhere
    launchCentred = true;
    map.setView([f.lat, f.lon], Math.max(map.getZoom(), 15), { animate: false });
  });
}

// Points of interest (markers saved in this browser)
const poi = initPOI({ map, toast, checkPoint, zoneSummary, weatherButton, showWeather, panel,
  locateOnce: () => locate.request(),
});
{ // day numbers now follow from dates: say once if saved markers were changed to match
  const mig = poi.store.takeMigration();
  if (mig) toast(`Day numbers now follow the dates: ${mig.corrected} corrected${mig.converted ? `, ${mig.converted} turned into dates` : ''}.`, 9000);
}
initPrivacyUI({ mw: poi.mw, elev: poi.elev, toast }); // the privacy settings own the weather and elevation switches
const trips = initTripsUI({ poi, panel, toast, checkPoint, zoneSummary });             // the Trips tab: create and edit trips, tag markers with them
const ai = initAI({ map, toast, panel, poi });  // paste an AI's itinerary, or open a share link, then preview and add
const opensShareLink = /^#import=/.test(location.hash); // read before fromHash() clears it
ai.fromHash();
const cross = initCrosshair(map); // a crosshair at the centre of the map (the button goes under the marker-details button)
// the zone verdict for where I am now (the position is read once, when the button is pressed)
const checkHere = () => locate.request().then((ll) => showCheck(ll, 'Your location', { zoom: 15 })).catch(() => { /* the location control has said why */ });
const cloud = { handle: null, refresh: null }; // the optional cloud copy: filled in once its code has loaded (only when this build has a project address)
addCompassControl(map, { rotation, onPress: () => locate.northUp() }); // after the other left-hand buttons, so their places do not move
const helpRef = { h: null }; // the contextual hints (help-wire.js), created just below; the toolbar reports to them
const toolbar = initMapToolbarHelp(map, { onExpand: () => helpRef.h?.labelsOpened(), onUse: () => helpRef.h?.mapToolUsed() }); // the tag button under the others: names each map button on request
helpRef.h = initHelp({ map, panel, sessions: () => cloud.sessions });
const dash = initDashboard({ poi, panel, trips, cloud, shared: opensShareLink, splash: !opensShareLink, actions: { checkHere, crosshair: cross, toast, help: helpRef.h } });
cloud.openData = () => dash.open(); // the account popover's export and import link
const splash = initSplash({ dash, panel, ai, locate, loadPrompt, toast, cloud, toolbar }); // the quick setup: greets a first visit, and "Quick setup" reopens it
dash.onQuickSetup(splash.open);
if (dash.splashFirst) splash.open();
initSyncUI({ store: poi.store, toast }).then((h) => { if (h) { cloud.handle = h; h.onChange(() => cloud.refresh?.()); initPresence({ handle: h }); initPartyUI({ handle: h, store: poi.store, panel, toast, cloud, map }); trips.setParty(cloud.party); cloud.sessions = initSessionsHub({ handle: h, map, toast, panel, onOpen: (tabs, opts) => helpRef.h.hubHint(tabs, opts), markers: () => poi.store.items().filter((i) => i.type !== 'home').map((i) => ({ name: i.name, lat: i.lat, lon: i.lon })) }); cloud.sessions.onSummary(() => cloud.refresh?.()); cloud.sessions.redeemFromHash(); cloud.sessions.refresh(); initFriendsUI({ panel, handle: h, toast, cloud }); initAccountUI({ handle: h, panel, toast, cloud }); splash.refresh(); cloud.refresh?.(); } }).catch((e) => log.warn('sync', 'cloud copy unavailable', e)); // What's new, the next trip, a backup reminder and the guide, along the bottom of the map

const checkAt = (latlng) => showCheck(latlng, `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`).catch((e) => { log.warn('map', 'point check failed', e); toast('Point check failed. Check your connection and try again.'); });
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
  const { index, regions, places } = await loadRegionData({ dataUrl, localUrl, mayHaveLocalData });
  initPointCheck(regions);
  initSearch(map, places, { show: showCheck });

  const { clearOfPanel } = initRegionUI({ map, panel, dash, prefs, index, toast });

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
    } catch (e) { log.warn('map', 'flying areas did not load', e); /* the zones still work */ }
  }
  $('show').addEventListener('change', (e) => (e.target.checked ? pinLayer.addTo(map) : map.removeLayer(pinLayer)));

  const zones = createZones(map, regions);
  zones.setOpacity(+$('op').value); // the remembered opacity, before any zone layer is created
  if (!prefs.view && !launchCentred) zones.fit(clearOfPanel()); // first visit: show all covered regions; later visits resume where the user left off
  zones.sync();
  $('show').addEventListener('change', (e) => zones.setVisible(e.target.checked));
  $('op').addEventListener('input', (e) => zones.setOpacity(+e.target.value));        // live while dragging
  $('op').addEventListener('change', (e) => savePrefs({ opacity: +e.target.value })); // saved when released

  renderRegionInfo({ index, regions });
} catch (err) {
  log.error('map', 'zone data did not load', err);
  $('regions-note').textContent = 'Could not load zone data. Run "npm run build:data" first, then reload.';
}
