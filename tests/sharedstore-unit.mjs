// How the marker and trip store treats a shared trip: stamps, the link to the shared record, applying a shared document, and who may delete. No browser.
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
globalThis.localStorage = { _s: {}, getItem(k) { return k in this._s ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
const { createStore, sanitize, sanitizeTrip, toGeoJSON } = await import('../src/poi.js');
const store = createStore();
const mk = (extra = {}) => ({ type: 'photo', name: 'M', lat: 30.5, lon: 114.3, ...extra });

// ---------- a private trip is exactly as before
const priv = store.addTrip({ name: 'Private' }).trip;
const pi = store.add(mk({ tripId: priv.id })).item;
ok(!('updated' in pi) && !('shared' in priv) && !('updated' in priv), 'markers and trips of a private trip carry no extra fields');
store.update(pi.id, { name: 'Renamed' }); store.updateTrip(priv.id, { description: 'x' });
ok(!('updated' in store.get(pi.id)) && !('updated' in store.getTrip(priv.id)), 'and are not stamped when edited');

// ---------- sanitize keeps what a shared trip needs
ok(sanitize({ ...mk(), id: 'a', updated: '2026-11-02T10:00:00Z' }).updated === '2026-11-02T10:00:00.000Z' && !('updated' in sanitize({ ...mk(), id: 'a', updated: 'nonsense' })), 'a marker keeps a valid updated time and drops an invalid one');
const st = sanitizeTrip({ id: 't', name: 'T', shared: { owner: true, ownerName: 'Al'.repeat(40) } });
ok(st.shared.owner === true && st.shared.ownerName.length === 40 && sanitizeTrip({ id: 't', name: 'T', shared: 'x' }).shared === undefined && sanitizeTrip({ id: 't', name: 'T', shared: { ownerName: 'x' } }).shared.owner === false, 'a trip keeps its link to a shared trip, cut to size; anything else is dropped; owner is true only when it says true');

// ---------- linking
const t = store.addTrip({ name: 'Hubei' }).trip;
const a = store.add(mk({ name: 'A', tripId: t.id })).item;
ok(store.setTripShared(t.id, { owner: true, ownerName: 'You' }).ok && store.getTrip(t.id).shared.owner === true, 'a trip is linked to a shared trip');
const b = store.add(mk({ name: 'B', tripId: t.id })).item;
ok(typeof b.updated === 'string' && Math.abs(Date.parse(b.updated) - Date.now()) < 5000, 'a marker added to a shared trip is stamped');
const t1 = store.get(a.id).updated;
store.update(a.id, { name: 'A2' });
ok(store.get(a.id).updated && store.get(a.id).updated !== undefined && (t1 === undefined || store.get(a.id).updated >= t1), 'an edited marker of a shared trip is stamped');
store.updateTrip(t.id, { description: 'new' });
ok(typeof store.getTrip(t.id).updated === 'string' && store.getTrip(t.id).shared.owner === true, 'an edited shared trip is stamped and keeps its link');
store.setMany([{ ...store.get(b.id), name: 'B2' }]);
ok(typeof store.get(b.id).updated === 'string', 'a bulk change stamps too');
const other = store.add(mk({ name: 'Free' })).item;
ok(!('updated' in other), 'a marker outside any shared trip is not stamped');
store.update(other.id, { tripId: t.id });
ok(typeof store.get(other.id).updated === 'string', 'moving a marker into a shared trip stamps it');
store.update(other.id, { tripId: priv.id });

// ---------- exports leave the link out
const gj = toGeoJSON(store.items(), store.trips());
ok(!JSON.stringify(gj).includes('"shared"') && !JSON.stringify(gj).includes('"updated"'), 'an exported file has neither the link to a shared trip nor the stamps');

// ---------- who may delete
store.setTripShared(t.id, { owner: false, ownerName: 'Alex' });
let r = store.removeTrip(t.id);
ok(r.ok === false && r.reason === 'shared' && store.getTrip(t.id), 'a party member cannot delete a shared trip from this device');
ok(store.items().filter((i) => i.tripId === t.id).length >= 2, 'and its markers are untouched');
store.setTripShared(t.id, { owner: true, ownerName: 'You' });
ok(store.removeTrip(t.id).ok && !store.getTrip(t.id), 'the owner can delete it');

// ---------- applying a shared document
const T = '5a1c0000-0000-4000-8000-000000000001';
const doc = (items, trip = {}) => ({ v: 1, trip: { id: T, name: 'Shared', created: '2026-10-01T00:00:00.000Z', color: '#3949ab', ...trip }, items });
const mi = (id, extra = {}) => ({ id, type: 'hotel', name: 'M' + id, note: '', lat: 30.1, lon: 114.1, created: '2026-11-01T00:00:0' + id.length + '.000Z', ...extra });
let ad = store.adoptShared(doc([mi('x1', { updated: '2026-11-02T10:00:01.000Z' }), mi('x2')], { notes: 'hello' }), { owner: false, ownerName: 'Alex' });
const tr = store.getTrip(T);
ok(ad.ok && ad.added === 2 && tr.name === 'Shared' && tr.notes === 'hello' && tr.color === '#3949ab' && tr.shared.owner === false && tr.shared.ownerName === 'Alex', 'adopting a shared trip adds the trip and its markers, linked to its owner');
ok(store.items().filter((i) => i.tripId === T).length === 2 && store.get('x1').updated === '2026-11-02T10:00:01.000Z' && store.get('x1').tripId === T, 'the markers are tagged with the trip and keep the document\'s times');
// a local check-in survives an update from the document
store.update('x1', { checkin: { at: '2026-11-02T09:00:00.000Z', lat: 30.1, lon: 114.1, acc: 10 } });
ad = store.applyShared(T, doc([mi('x1', { name: 'Changed' }), mi('x3')], { name: 'Shared 2' }));
ok(ad.added === 1 && ad.removed === 1 && ad.changed === 1, 'applying counts what was added, removed and changed: ' + JSON.stringify(ad));
ok(store.get('x1').name === 'Changed' && store.get('x1').checkin && !store.get('x2') && store.get('x3') && store.getTrip(T).name === 'Shared 2' && store.getTrip(T).shared.ownerName === 'Alex', 'markers follow the document; this device\'s own check-in stays; the link stays');
// a marker that is elsewhere moves in
const free = store.add(mk({ name: 'Elsewhere' })).item;
store.applyShared(T, doc([mi(free.id, { name: 'Now shared' })]));
ok(store.get(free.id).tripId === T && store.get(free.id).name === 'Now shared' && store.items().filter((i) => i.id === free.id).length === 1, 'a marker with the same id that was untagged moves into the trip, once');
// other trips and untagged markers are never touched
ok(store.get(pi.id) && store.get(pi.id).tripId === priv.id, 'markers of other trips are untouched');
// linking an existing trip
store.setTripShared(T, null);
ok(!('shared' in store.getTrip(T)) && store.getTrip(T).name === 'Shared', 'unlinking makes it a private trip again, with everything on it');
ad = store.adoptShared(doc([mi('y1')], { name: 'Shared 3' }), { owner: false, ownerName: 'Alex' });
ok(ad.ok && store.trips().filter((x) => x.id === T).length === 1 && store.getTrip(T).shared && store.getTrip(T).name === 'Shared 3' && store.get('y1'), 'adopting a trip that is already here links it instead of adding a second one');
ok(store.applyShared('nope', doc([])).ok === false && store.adoptShared({}, {}).ok === false, 'applying to a trip that is not here, or a broken document, does nothing');

// ---------- the store tells its listeners once per change
let fired = 0; store.onChange(() => fired++);
store.applyShared(T, doc([mi('z1')])); store.setTripShared(T, { owner: true, ownerName: 'You' });
ok(fired === 2, 'applying and linking each tell the listeners once (' + fired + ')');
