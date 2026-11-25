// Privacy defaults version 2 (src/privacy.js, src/prefs.js): useful features on for new browsers, existing choices kept, consent-gated features still off.
// No browser, no network: a fake localStorage, and privacy.js is imported again (cache-busting query) for each starting state.
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const KEY = 'uavzones.v1.prefs';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
let n = 0;
async function boot(initial) {
  store.clear();
  if (initial !== undefined) store.set(KEY, JSON.stringify(initial));
  const m = await import('../src/privacy.js?case=' + (n++));
  return m;
}
const stored = () => JSON.parse(store.get(KEY) || 'null');
const { loadPrefs } = await import('../src/prefs.js');

// ---------- a new browser (nothing stored)
{
  const { getPrivacy } = await boot();
  const p = getPrivacy();
  ok(p.autoWeather && p.fetchAltitude && p.lookupNames && p.checkIn, 'new browser: weather, elevation, name lookup and check-in are on');
  ok(p.weatherPrecision === 'estimated', 'new browser: weather uses estimated (rounded) coordinates');
  ok(p.locateOnLaunch === true, 'new browser: locate on launch stays on');
  ok(p.autoShare === 'unset' && p.autoSessionAttendance === false, 'new browser: automatic sharing is unanswered and automatic attendance is off');
  ok(loadPrefs().sessionsNearby !== false, 'new browser: nearby public sessions are on');
  ok(stored().privacyDefaults === 2 && stored().sessionsNearby === undefined, 'the version is recorded; no choice is invented');
}

// ---------- an existing browser with settings but no privacy choices: nothing is switched on for it
{
  const { getPrivacy } = await boot({ basemap: 'osm', view: { lat: 1, lon: 2, zoom: 5 } });
  const p = getPrivacy();
  ok(!p.autoWeather && !p.fetchAltitude && !p.lookupNames && !p.checkIn, 'existing browser, nothing chosen: the four features stay off');
  ok(loadPrefs().sessionsNearby === false, 'existing browser: nearby sessions stay off');
  ok(stored().autoWeather === false && stored().checkIn === false && stored().privacyDefaults === 2, 'the old reading is written down as explicit false');
  ok(stored().basemap === 'osm', 'other settings are untouched');
}

// ---------- explicit choices survive
{
  const { getPrivacy } = await boot({ autoWeather: true, fetchAltitude: false, checkIn: true, lookupNames: false, sessionsNearby: true, autoShare: 'on', autoSessionAttendance: true, locateOnLaunch: false });
  const p = getPrivacy();
  ok(p.autoWeather === true && p.fetchAltitude === false && p.checkIn === true && p.lookupNames === false, 'existing explicit on/off choices are kept');
  ok(loadPrefs().sessionsNearby === true, 'an explicit nearby choice is kept');
  ok(p.autoShare === 'on' && p.autoSessionAttendance === true && p.locateOnLaunch === false, 'sharing consent, attendance and locate-on-launch decisions are kept');
}
{
  const { getPrivacy } = await boot({ privacyDefaults: 2, autoShare: 'off' });
  ok(getPrivacy().autoShare === 'off' && getPrivacy().autoWeather === true, 'a "keep off" sharing decision is kept and defaults are on after the version is set');
}

// ---------- turning a feature off sticks, in this and the next page load
{
  const { getPrivacy, setPrivacy } = await boot();
  setPrivacy({ autoWeather: false, checkIn: false });
  ok(stored().autoWeather === false && stored().checkIn === false, 'turned off: saved as explicit false, not removed');
  const again = (await import('../src/privacy.js?case=' + (n++))).getPrivacy();
  ok(again.autoWeather === false && again.checkIn === false && again.fetchAltitude === true, 'a reload keeps the off choices and the untouched defaults');
  setPrivacy({ autoWeather: true });
  ok(stored().autoWeather === true, 'turned back on: saved as true');
  ok(getPrivacy().autoShare === 'unset' && stored().autoShare === undefined, 'changing other switches never records a sharing decision');
}

// ---------- blocked storage: defaults apply in memory, nothing throws
{
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  let p = null, threw = false;
  try { p = (await import('../src/privacy.js?case=' + (n++))).getPrivacy(); } catch { threw = true; }
  ok(!threw && p.autoWeather && p.autoShare === 'unset' && p.autoSessionAttendance === false, 'storage blocked: new-user defaults in memory, sharing and attendance off, no error');
  globalThis.localStorage = real;
}

// ---------- a damaged entry falls back to defaults safely
{
  store.clear(); store.set(KEY, '{not json');
  const p = (await import('../src/privacy.js?case=' + (n++))).getPrivacy();
  ok(p.autoShare === 'unset' && p.autoSessionAttendance === false, 'damaged entry: consent-gated features stay off');
}
