// Remembered map visibility (prefs.js): validation, bounds, corrupt storage, and that none of it travels with a trip. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
const P = await load('src/prefs.js');
const KEY = 'uavzones.v1.prefs';
const put = (o) => store.set(KEY, typeof o === 'string' ? o : JSON.stringify(o));

ok(P.loadPrefs().tripHidden === undefined && P.loadPrefs().unassignedHidden === undefined, 'nothing saved: every trip and Unassigned are shown');
P.savePrefs({ tripHidden: ['t1', 't2'], unassignedHidden: true });
ok(JSON.stringify(P.loadPrefs().tripHidden) === '["t1","t2"]' && P.loadPrefs().unassignedHidden === true, 'hidden trips and Unassigned are saved and read back');
P.savePrefs({ tripHidden: null, unassignedHidden: null });
ok(P.loadPrefs().tripHidden === undefined && P.loadPrefs().unassignedHidden === undefined && !store.get(KEY).includes('tripHidden'), 'clearing them removes the keys');
P.savePrefs({ basemap: 'osm', tripHidden: ['t1'] });
P.savePrefs({ opacity: 0.5 });
ok(JSON.stringify(P.loadPrefs().tripHidden) === '["t1"]' && P.loadPrefs().basemap === 'osm', 'other settings are kept when one changes');

put({ tripHidden: 'nope', unassignedHidden: 'yes' });
ok(P.loadPrefs().tripHidden === undefined && P.loadPrefs().unassignedHidden === undefined, 'wrong types are dropped');
put({ tripHidden: ['ok', 5, '', null, 'x'.repeat(65), { a: 1 }, 'ok', 'fine'] });
ok(JSON.stringify(P.loadPrefs().tripHidden) === '["ok","fine"]', 'only real ids of up to 64 characters are kept, once each');
put({ tripHidden: Array.from({ length: 500 }, (_, i) => 'id' + i) });
ok(P.loadPrefs().tripHidden.length === 200 && P.loadPrefs().tripHidden.at(-1) === 'id499', 'the list is capped at 200 (the newest are kept)');
put({ tripHidden: [], unassignedHidden: false });
ok(P.loadPrefs().tripHidden === undefined && P.loadPrefs().unassignedHidden === undefined, 'an empty list and false are the defaults');
put('{ not json');
ok(Object.keys(P.loadPrefs()).length === 0, 'corrupt storage falls back to the defaults');
put({ basemap: 'osm', tripHidden: ['t9'], junk: 1 });
ok(P.loadPrefs().basemap === 'osm' && JSON.stringify(P.loadPrefs().tripHidden) === '["t9"]' && !('junk' in P.loadPrefs()), 'a damaged neighbour does not disturb valid settings; unknown keys are dropped');

// storage that throws: loading gives defaults, saving is silent (the page keeps its own state in memory)
const real = globalThis.localStorage;
globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
let threw = false;
try { P.loadPrefs(); P.savePrefs({ tripHidden: ['t1'] }); } catch { threw = true; }
ok(!threw && Object.keys(P.loadPrefs()).length === 0, 'blocked storage neither throws nor shows anything as hidden');
globalThis.localStorage = real;

// the setting is never part of what a shared trip carries
const core = await load('src/sharedtrip/core.js');
const poi = await load('src/poi.js');
P.savePrefs({ tripHidden: ['t1'], unassignedHidden: true });
const trip = poi.sanitizeTrip({ id: 't1', name: 'Shared', startDate: '2026-11-12', endDate: '2026-11-13' });
const doc = core.buildSharedDoc(trip, [poi.sanitize({ id: 'a', type: 'food', name: 'A', lat: 1, lon: 2, tripId: 't1' })]);
ok(!/hidden|unassigned|prefs/i.test(JSON.stringify(doc)), 'a shared trip document carries no visibility setting');
const gj = poi.toGeoJSON([poi.sanitize({ id: 'a', type: 'food', name: 'A', lat: 1, lon: 2, tripId: 't1' })], [trip]);
ok(!/tripHidden|unassignedHidden/.test(JSON.stringify(gj)) && !('hidden' in gj.features[0].properties), 'nor does a GeoJSON export, and no marker or trip record gains a field');

// the POI layer is only switched on by an explicit action: creating a marker, entering place or edit mode, flying to a marker. Never by an import, a sync or a rebuild.
import fs from 'node:fs';
const src = fs.readFileSync(path.join(ROOT, 'src/poi-ui.js'), 'utf8').split(String.fromCharCode(13)).join('');
const fnBody = (name) => { const i = src.indexOf(`function ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n  }\n', i)); };
const calls = (name) => /ensureVisible\(\)/.test(fnBody(name));
ok(calls('addAt') && calls('setMode') && calls('flyToItem'), 'creating one marker, place or edit mode and flying to a marker still reveal the POI layer');
ok(!calls('addMany') && !calls('rebuildMarkers') && !calls('applyMarkerVisibility') && !calls('setTripShown') && !calls('setHideTrips'), 'an import, a rebuild, a trip switch and the global switch never do');
ok((src.match(/ensureVisible\(\)/g) ?? []).length === 3, 'and there is no other caller (only the three above): ' + (src.match(/ensureVisible\(\)/g) ?? []).length);

// the completed-trips switch
P.savePrefs({ showCompleted: true });
ok(P.loadPrefs().showCompleted === true, 'show completed trips is saved and read back');
P.savePrefs({ showCompleted: null });
ok(P.loadPrefs().showCompleted === undefined && !store.get(KEY).includes('showCompleted'), 'clearing it removes the key (completed trips are hidden by default)');
put({ showCompleted: 'yes' }); ok(P.loadPrefs().showCompleted === undefined, 'a wrong type is dropped');
