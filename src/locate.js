import L from 'leaflet';
import { createHeading, chooseHeading, arrowAngle, pointName } from './heading.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>';
const COMPASS = '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="needle"><path d="M12 3l4 9h-8z" fill="#d64545"/><path d="M12 21l-4-9h8z" fill="currentColor" opacity=".55"/></g><circle cx="12" cy="12" r="1.6" fill="#fff" stroke="currentColor" stroke-width=".8"/></svg>';
// the arrow on the location marker: points up, then is turned by the way the user faces (as seen on the screen)
const DOT = '<div class="you-wrap"><svg class="you-arrow" viewBox="0 0 44 44" aria-hidden="true"><path d="M22 3l7.5 15.5L22 14.5 14.5 18.5z" fill="#1a73e8" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="you-dot" style="width:14px;height:14px"></div></div>';

/**
 * "My location" control, in three steps:
 *   1. press: ask for permission, show where you are and which way you face, centre on it (nothing is requested until the button is pressed, except the one launch fix below);
 *   2. press: follow you as you move, and, where the phone has a compass, turn the map so the way it points is up;
 *   3. press: back to a normal north-up map (your position stays on it).
 * A small compass button (see addCompassControl) turns the map north again. Pulling the map with one finger, or anything else that moves it away, ends following.
 * Turning the map by hand while following pauses the compass turning (the map keeps following you at the angle you chose).
 * `rotation` is the map turner (maprotate.js); `onNotice(text)` carries things worth telling the user; `onFollow()` is called when following starts.
 */
export function addLocateControl(map, { onError, onNotice = onError, onFollow, rotation = null, headingSensor = null, wakeLock = () => globalThis.navigator?.wakeLock }) {
  let dot = null, ring = null, last = null, active = false, watching = false; // watching: map.locate is running (the launch fix draws the blip without it)
  let mode = 'off', manual = false, ownMove = 0, zooming = false, compass = false, compassFailed = false, compassTold = false, lock = null, btn = null;
  let compassHeading = null, travel = { heading: null, speed: null };

  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'locate-btn', bar);
      a.href = '#';
      a.role = 'button';
      L.DomUtil.create('span', 'locate-icon', a).innerHTML = ICON;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); press(); });
      this._a = btn = a;
      label();
      return bar;
    },
  });
  const control = new Control().addTo(map);

  function startWatch() { if (watching) return; watching = true; map.locate({ watch: true, enableHighAccuracy: true, setView: false, maximumAge: 10000, timeout: 20000 }); }
  /** Draws (or moves) the blip and its accuracy ring. */
  function drawBlip(latlng, accuracy) {
    if (dot) { dot.setLatLng(latlng); ring.setLatLng(latlng).setRadius(accuracy); return; }
    ring = L.circle(latlng, { radius: accuracy, weight: 1, color: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(map);
    dot = L.marker(latlng, {
      icon: L.divIcon({ className: '', html: DOT, iconSize: [14, 14] }),
      zIndexOffset: 1000, title: 'You are here',
    }).addTo(map);
  }

  /** The button's name says what pressing it does now. */
  function label() {
    const a = btn; if (!a) return;
    const text = mode === 'following' ? 'Stop following and turn the map back to north' : mode === 'located' ? (rotation ? 'Follow me and turn the map with the way the phone points' : 'Follow me') : 'Show my location';
    a.title = text; a.setAttribute('aria-label', text);
    a.classList.toggle('following', mode === 'following');
    a.setAttribute('aria-pressed', String(mode === 'following'));
  }

  // ---------- which way you face
  const shown = () => chooseHeading({ compass: compassHeading, travel: travel.heading, speed: travel.speed });
  function showArrow() {
    const el = dot?.getElement()?.querySelector('.you-wrap');
    if (!el) return;
    const h = shown(), deg = arrowAngle(h, rotation ? rotation.bearing() : 0);
    el.classList.toggle('has-heading', deg !== null);
    if (deg !== null) el.style.setProperty('--ya', deg + 'deg');
    dot.getElement().title = h === null ? 'You are here' : 'You are here, facing ' + pointName(h);
  }
  const sensor = headingSensor ?? createHeading({
    onHeading: (deg) => {
      compassHeading = deg; compass = true;
      if (mode === 'following' && !manual && rotation) rotation.set(deg, 'compass');
      showArrow();
    },
    onUnavailable: () => { compass = false; compassFailed = true; compassHeading = null; showArrow(); if (mode === 'following') tellNoCompass(); },
    onDenied: () => { compass = false; compassFailed = true; compassHeading = null; onNotice('Compass permission was refused, so the map will not turn with the phone. Allow motion and orientation for this site to use it.'); },
  });
  function tellNoCompass() { if (!compassTold) { compassTold = true; onNotice('This phone has no usable compass, so the map follows you but stays north-up.'); } }
  rotation?.onChange(() => showArrow());

  // ---------- following
  async function takeLock() {
    try { const wl = wakeLock(); if (wl && !lock) { lock = await wl.request('screen'); lock.addEventListener?.('release', () => { lock = null; }); } } catch { /* not allowed or not supported: the screen may dim */ }
  }
  function dropLock() { try { lock?.release?.(); } catch { /* ignore */ } lock = null; }
  const own = (fn) => { ownMove++; try { fn(); } finally { setTimeout(() => { ownMove = Math.max(0, ownMove - 1); }, 700); } };

  function enterFollow() {
    if (!last) return;
    mode = 'following'; manual = false; label();
    onFollow?.();
    dot?.closePopup(); // an open popup on your own marker would pan the map to keep itself in view each time you move
    own(() => map.setView(last, Math.max(map.getZoom(), 16), { animate: false }));
    takeLock();
    if (rotation && compass && compassHeading !== null) rotation.set(compassHeading, 'compass');
    else if (!rotation || compassFailed) tellNoCompass(); // (if the sensor is still waiting for its first reading, the answer comes with it)
  }
  /** Back to a normal map: not following, north up (the position stays). */
  function exitFollow({ north = true } = {}) {
    if (mode !== 'following') return;
    mode = 'located'; manual = false; label(); dropLock();
    if (north) rotation?.animateTo(0, 280, 'reset');
  }
  // anything that moves the map away from you ends following: a drag, a recentre elsewhere; zooming does not
  map.on('zoomstart', () => { zooming = true; });
  map.on('zoomend', () => { zooming = false; });
  map.on('dragstart', () => exitFollow());
  map.on('movestart', () => { if (mode === 'following' && !ownMove && !zooming) exitFollow(); });
  rotation?.onHandTurn(() => { if (mode === 'following') { manual = true; } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { sensor.stop(); }
    else { if (mode !== 'off') sensor.start(); if (mode === 'following') takeLock(); } // the screen lock is released by the browser when the page is hidden
  });

  /** Returns false if location cannot be used at all (the user has been told why). */
  function press({ recentre = true } = {}) {
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      onError('Location needs a secure page (https). It will not work from a file or plain http.');
      return false;
    }
    if (!recentre) { // asked for by something else ("check my spot", "place at my location"): get a position, change nothing else
      if (last) return true;
      if (!navigator.geolocation) { onError('This browser does not support location.'); return false; }
      startWatch();
      return true;
    }
    if (mode === 'following') { exitFollow(); return true; }
    if (mode === 'located') { enterFollow(); return true; }
    // the first press: also starts the compass here, inside the tap, because iOS asks for permission then
    sensor.start();
    if (!last && !navigator.geolocation) { onError('This browser does not support location.'); return false; }
    mode = 'located'; label();
    if (last) own(() => map.setView(last, Math.max(map.getZoom(), 15)));
    startWatch();
    return true;
  }

  /** Resolves with the latest position, starting location tracking first if needed. Rejects if it cannot be had. */
  function request() {
    return new Promise((resolve, reject) => {
      if (last) { resolve(last); return; }
      const done = () => { map.off('locationfound', ok); map.off('locationerror', fail); };
      const ok = (e) => { done(); resolve(e.latlng); };
      const fail = () => { done(); reject(new Error('location unavailable')); };
      map.on('locationfound', ok);
      map.on('locationerror', fail);
      if (!press({ recentre: false })) { done(); reject(new Error('location unavailable')); }
    });
  }

  map.on('locationfound', (e) => {
    const first = !last;
    last = e.latlng;
    travel = { heading: Number.isFinite(e.heading) ? e.heading : null, speed: Number.isFinite(e.speed) ? e.speed : null };
    own(() => drawBlip(e.latlng, e.accuracy)); // (a popup bound to the marker re-pans when it moves: that is not the user moving the map)
    if (!active) { active = true; control._a.classList.add('active'); }
    showArrow();
    if (first) own(() => map.setView(e.latlng, Math.max(map.getZoom(), 15)));
    else if (mode === 'following') own(() => map.panTo(e.latlng, { animate: true, duration: 0.4, easeLinearity: 1, noMoveStart: true }));
  });

  map.on('locationerror', (e) => {
    if (active && last) return; // keep the last fix on a transient error
    map.stopLocate(); watching = false;
    mode = 'off'; label(); sensor.stop();
    const denied = e.code === 1;
    onError(denied ? 'Location permission was denied. Allow it in the browser settings and try again.' : 'Could not get your location. Check that location services are on.');
  });

  return {
    control, request,
    /** The map turned back to north-up and following stopped; used by the compass button. */
    northUp() { exitFollow({ north: false }); rotation?.animateTo(0, 280, 'reset'); },
    /** Like the first press of the button (permission, marker, arrow, centre on you; no zone check, no popup), or a recentre if already located. Resolves true when there is a position, false when there is none (the button's error has said why). */
    show() {
      return new Promise((resolve) => {
        const done = () => { map.off('locationfound', ok); map.off('locationerror', fail); };
        const ok = () => { done(); resolve(true); };
        const fail = () => { done(); resolve(false); };
        if (last && dot && watching) { own(() => map.setView(last, Math.max(map.getZoom(), 15))); resolve(true); return; }
        map.on('locationfound', ok); map.on('locationerror', fail);
        if (mode === 'off' && !press()) { done(); resolve(false); }
      });
    },
    /** The one fix taken at launch: draws the blip and its accuracy ring and remembers the position, without tracking. The first press of the button starts tracking. */
    showFix({ lat, lon, accuracy }) {
      if (dot) return;
      last = L.latLng(lat, lon); drawBlip(last, Number.isFinite(accuracy) ? accuracy : 50); showArrow();
    },
    mode: () => mode,
    isManual: () => manual,
    heading: shown,
  };
}

/**
 * One position fix for the moment the app opens: asks the browser (this is what shows the permission question) and resolves { lat, lon, accuracy } or null
 * (denied, dismissed, not supported, no secure page, timed out). Nothing is tracked; the caller decides what to do with it (main.js draws the blip with showFix and centres the map).
 * A page cannot tell "always allow" from "allow this time": a permission kept by the browser answers at once on later launches, a one-time one asks again.
 */
export async function launchFix({ geo = globalThis.navigator?.geolocation, perms = globalThis.navigator?.permissions, secure = globalThis.isSecureContext || globalThis.location?.hostname === 'localhost' } = {}) {
  if (!geo || !secure) return null;
  try { const st = await perms?.query?.({ name: 'geolocation' }); if (st?.state === 'denied') return null; } catch { /* no Permissions API: just ask */ }
  return new Promise((resolve) => {
    try {
      geo.getCurrentPosition(
        (p) => resolve(Number.isFinite(p?.coords?.latitude) && Number.isFinite(p?.coords?.longitude) ? { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy } : null),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
      );
    } catch { resolve(null); }
  });
}

/**
 * The compass button: shown whenever the map is turned (by the compass or by hand), with a needle that points to north; pressing it turns the map north-up and
 * stops following. Added last, so the other buttons above it keep their places.
 */
export function addCompassControl(map, { rotation, onPress }) {
  const Control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control compass-bar');
      const a = L.DomUtil.create('a', 'compass-btn', bar);
      a.href = '#'; a.role = 'button'; a.title = 'Turn the map back to north'; a.setAttribute('aria-label', 'Turn the map back to north');
      a.innerHTML = COMPASS;
      bar.hidden = true;
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); onPress(); });
      this._bar = bar; this._a = a;
      return bar;
    },
  });
  const control = new Control().addTo(map);
  rotation.onChange((b) => {
    control._bar.hidden = Math.abs(b) < 0.5;
    control._a.style.setProperty('--needle', b + 'deg'); // the needle points to north: the map is turned by -bearing, so the needle turns by the same
  });
  return control;
}
