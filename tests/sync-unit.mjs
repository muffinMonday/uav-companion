// The sync rules (src/sync/core.js) and the store's replaceAll, with no browser or network.
import { buildDoc, counts, sameContent, decide, diffDocs, keepLocalCheckins, deviceName, describeWhen } from '../src/sync/core.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

// ---------- decide(): every row of the table
const L = (hasData, dirty, baseRev) => ({ hasData, dirty, baseRev });
const cases = [
  [L(true, false, null), null, 'push-first', 'no cloud copy, data here'],
  [L(true, true, 3), null, 'push-first', 'no cloud copy (reset), data here'],
  [L(false, false, null), null, 'nothing', 'no cloud copy, nothing here'],
  [L(false, false, null), { rev: 4 }, 'pull', 'never synced, nothing here'],
  [L(true, true, null), { rev: 4 }, 'ask', 'never synced, both have data'],
  [L(true, false, null), { rev: 4 }, 'ask', 'never synced, data here (not marked changed)'],
  [L(true, true, 4), { rev: 4 }, 'push', 'cloud unchanged, changed here'],
  [L(true, false, 4), { rev: 4 }, 'in-sync', 'cloud unchanged, unchanged here'],
  [L(true, false, 4), { rev: 6 }, 'pull', 'cloud moved on, unchanged here'],
  [L(true, true, 4), { rev: 6 }, 'ask', 'cloud moved on, changed here (true conflict)'],
  [L(true, false, 6), { rev: 4 }, 'ask', 'cloud older than what we synced'],
  [L(true, true, 6), { rev: 4 }, 'ask', 'cloud older and changed here'],
  [L(false, true, 4), { rev: 6 }, 'ask', 'emptied here on purpose, cloud moved on'],
  [L(false, true, 4), { rev: 4 }, 'push', 'emptied here on purpose, cloud unchanged'],
];
for (const [l, c, want, name] of cases) ok(decide(l, c) === want, `decide: ${name} → ${want}`);

// ---------- buildDoc
const items = [{ id: 'a', name: 'A', checkin: { lat: 1, lng: 2 } }, { id: 'b', name: 'B' }];
let d = buildDoc({ items, trips: [{ id: 't' }] });
ok(d.v === 1 && d.items.length === 2 && d.trips.length === 1, 'buildDoc: version, markers and trips');
ok(!('checkin' in d.items[0]) && 'checkin' in items[0], 'check-ins are left out by default, and the caller\'s list is not changed');
ok('checkin' in buildDoc({ items, includeCheckins: true }).items[0], 'check-ins go along when the user opted in');
ok(buildDoc({}).items.length === 0 && buildDoc({}).trips.length === 0, 'an empty store gives an empty document');
ok(JSON.stringify(counts(d)) === '{"markers":2,"trips":1}' && counts(null).markers === 0, 'counts');

// ---------- sameContent
ok(sameContent({ items: [{ id: 'a', x: 1, y: 2 }, { id: 'b' }], trips: [] }, { items: [{ id: 'b' }, { y: 2, id: 'a', x: 1 }], trips: [] }), 'same content ignores list order and key order');
ok(!sameContent({ items: [{ id: 'a', x: 1 }] }, { items: [{ id: 'a', x: 2 }] }), 'a changed field is a difference');
ok(!sameContent({ items: [{ id: 'a' }] }, { items: [] }), 'a missing marker is a difference');
ok(sameContent(null, { items: [], trips: [] }), 'nothing equals empty');

// ---------- diffDocs
const df = diffDocs({ items: [{ id: 'a' }, { id: 'b', n: 1 }, { id: 'c' }], trips: [{ id: 't1' }] }, { items: [{ id: 'b', n: 2 }, { id: 'c' }, { id: 'd' }], trips: [] });
ok(JSON.stringify(df.markers) === '{"onlyLocal":1,"onlyCloud":1,"differ":1,"same":1}' && df.trips.onlyLocal === 1, 'diffDocs counts: ' + JSON.stringify(df));
ok(diffDocs(null, null).markers.same === 0, 'diffDocs tolerates missing documents');

// ---------- keepLocalCheckins
const kept = keepLocalCheckins([{ id: 'a' }, { id: 'b', checkin: { lat: 9 } }, { id: 'c' }], [{ id: 'a', checkin: { lat: 1 } }, { id: 'b', checkin: { lat: 2 } }]);
ok(kept[0].checkin.lat === 1 && kept[1].checkin.lat === 9 && !kept[2].checkin, 'local check-ins are put back, a cloud check-in is not overwritten');
const same = [{ id: 'a' }];
ok(keepLocalCheckins(same, [{ id: 'a' }]) === same, 'nothing to put back returns the list as is');

// ---------- deviceName
ok(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36') === 'Chrome on Windows', 'Chrome on Windows');
ok(deviceName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120') === 'Edge on Windows', 'Edge on Windows');
ok(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile Safari/604') === 'Safari on iOS', 'Safari on iOS');
ok(deviceName('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36') === 'Chrome on Android', 'Chrome on Android');
ok(deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0') === 'Firefox on Linux', 'Firefox on Linux');
ok(deviceName('') === 'Browser' && deviceName().length > 0, 'unknown agent still gives a name');

// ---------- describeWhen
const now = Date.parse('2026-11-11T12:00:00Z');
const w = (s) => describeWhen(new Date(now - s * 1000).toISOString(), now);
ok(w(5) === 'just now' && w(60) === 'a minute ago' && w(600) === '10 minutes ago', 'describeWhen: seconds and minutes');
ok(w(3600) === '1 hour ago' && w(3 * 3600) === '3 hours ago' && w(30 * 3600) === 'yesterday', 'describeWhen: hours and yesterday');
ok(/2026|2025/.test(w(10 * 86400)) && describeWhen('nonsense', now) === 'at an unknown time', 'describeWhen: older dates and bad input');

// ---------- the store's replaceAll
globalThis.localStorage = { _s: {}, getItem(k) { return k in this._s ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
const { createStore } = await import('../src/poi.js');
const store = createStore();
let fired = 0;
store.onChange(() => fired++);
const res = store.replaceAll([{ id: 'x1', name: 'One', lat: 30.5, lon: 114.3 }, { id: 'x1', name: 'Dup', lat: 1, lon: 1 }, { nope: true }], [{ id: 't1', name: 'Trip' }]);
ok(res.ok && res.items === 1 && res.trips === 1, 'replaceAll drops duplicates and junk: ' + JSON.stringify(res));
ok(store.items().length === 1 && store.items()[0].name === 'One', 'and the store holds exactly the incoming markers');
store.replaceAll([], []);
ok(store.items().length === 0 && store.trips().length === 0, 'replaceAll with nothing empties the store');
ok(store.replaceAll('x', null).items === 0, 'replaceAll tolerates garbage');
ok(fired >= 3, 'and every replacement tells the listeners (' + fired + ')');
