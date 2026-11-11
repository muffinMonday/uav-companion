// Check-in rules: the 300 m radius, the accuracy limit, the stored record, export and import. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const C = await load('src/checkin.js');
const poi = await load('src/poi.js');
const marker = { id: 'm', type: 'photo', name: 'Tower', lat: 30.5928, lon: 114.3055 };
const at = (dLat, accuracy = 20) => ({ lat: marker.lat + dLat, lon: marker.lon, accuracy });

// ---------- the rule
ok(C.checkinState(null, marker).reason === 'waiting' && !C.checkinState(null, marker).can, 'no position yet: waiting');
ok(C.checkinState(at(0), marker).can && C.checkinState(at(0), marker).distanceM < 1, 'standing on the marker: can check in');
ok(C.checkinState(at(0.0026), marker).can, 'about 290 m away: can check in (' + Math.round(C.checkinState(at(0.0026), marker).distanceM) + ' m)');
const far = C.checkinState(at(0.0035), marker);
ok(!far.can && far.reason === 'far' && far.distanceM > 300 && far.distanceM < 450, 'about 390 m away: too far (' + Math.round(far.distanceM) + ' m)');
const rough = C.checkinState(at(0, 400), marker);
ok(!rough.can && rough.reason === 'rough' && rough.accuracy === 400, 'a rough fix (400 m) cannot check in even when it looks close');
ok(C.checkinState(at(0, 150), marker).can && !C.checkinState(at(0, 151), marker).can, 'the accuracy limit is 150 m');
ok(!C.checkinState({ lat: marker.lat, lon: marker.lon, accuracy: NaN }, marker).can, 'a fix with no accuracy is not trusted');

// ---------- the words
ok(/1\.2 km away/.test(C.checkinTitle({ reason: 'far', distanceM: 1200 }, 'metric')) && /within 300 m/.test(C.checkinTitle({ reason: 'far', distanceM: 1200 })), 'tooltip when far: how far, and the radius');
ok(/accurate to about 400 m/.test(C.checkinTitle({ reason: 'rough', accuracy: 400 })) && /150 m/.test(C.checkinTitle({ reason: 'rough', accuracy: 400 })), 'tooltip for a rough fix');
ok(/blocked/.test(C.checkinTitle({}, 'metric', 'denied')) && /cannot give a location/.test(C.checkinTitle({}, 'metric', 'unavailable')) && /Waiting/.test(C.checkinTitle({ reason: 'waiting' })), 'tooltips for blocked, unsupported and waiting');
ok(/mi|ft/.test(C.checkinTitle({ reason: 'far', distanceM: 1200 }, 'imperial')), 'distances follow the units setting');

// ---------- the record
const rec = C.sanitizeCheckin({ at: '2026-11-12T06:32:10.000Z', lat: 30.5928123456, lon: 114.30551, acc: 12.6 });
ok(rec && rec.at === '2026-11-12T06:32:10.000Z' && rec.lat === 30.592812 && rec.acc === 13, 'a check-in keeps the time, the position to 6 decimals and the rounded accuracy');
ok(C.sanitizeCheckin(null) === null && C.sanitizeCheckin({ at: 'x', lat: 1, lon: 1 }) === null && C.sanitizeCheckin({ at: '2026-01-01', lat: 95, lon: 1 }) === null && C.sanitizeCheckin({ at: '2026-01-01', lat: 1 }) === null, 'a record without a real time or position is dropped');
ok(C.sanitizeCheckin({ at: '2026-01-01', lat: 1, lon: 1, acc: -5 }).acc === undefined, 'a nonsense accuracy is left out');
ok(/Thu|Fri|Wed|Sat|Sun|Mon|Tue/.test(C.checkinLabel(rec)) && /\d{2}:\d{2}/.test(C.checkinLabel(rec)), 'the label has the day and the time: ' + C.checkinLabel(rec));

// ---------- on the marker, in the export, and not on the Home marker
const store = poi.createStore();
const m = store.add({ type: 'photo', name: 'Tower', lat: 30.5928, lon: 114.3055 }).item;
const home = store.add({ type: 'residence', name: 'Flat', lat: 30.4, lon: 114.1 }).item;
store.update(m.id, { checkin: { at: '2026-11-12T06:32:10.000Z', lat: 30.5929, lon: 114.3056, acc: 10 } });
ok(store.get(m.id).checkin?.lat === 30.5929, 'a marker keeps its check-in');
store.update(m.id, { name: 'Tower 2' });
ok(store.get(m.id).checkin?.at === '2026-11-12T06:32:10.000Z', 'editing the marker keeps it');
store.update(home.id, { checkin: { at: '2026-11-12T06:32:10.000Z', lat: 30.4, lon: 114.1 } });
ok(!store.get(home.id).checkin, 'the Home marker cannot be checked in');
const gj = poi.toGeoJSON(store.items(), []);
ok(gj.features.find((f) => f.properties.name === 'Tower 2').properties.checkin?.acc === 10, 'the export carries the check-in');
const back = poi.parseGeoJSON(JSON.stringify(gj));
ok(back.items.find((i) => i.name === 'Tower 2').checkin?.lat === 30.5929, 'and a restore brings it back');
store.update(m.id, { checkin: null });
ok(!store.get(m.id).checkin, 'clearing removes it');
const V = C.visitedCount([{ type: 'photo', checkin: {} }, { type: 'photo' }, { type: 'residence', checkin: {} }]);
ok(V.done === 1 && V.total === 2, 'visited counts ignore the Home marker: ' + V.done + ' of ' + V.total);
