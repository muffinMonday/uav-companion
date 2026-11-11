// The shared-trip engine with several simulated devices, against the real database rules on PGlite. No browser, no network.
import { createSharedTrips } from '../src/sharedtrip/engine.js';
import { dbApi, memStorage } from './lib-trips.mjs';
import { makeDb, as, A, B, C } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const { createStore } = await import('../src/poi.js');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await one(u, 'public.ensure_profile($1)', [n]);
for (const other of [B, C]) { const r = await one(A, 'public.request_friend($1)', [(await one(other, 'public.ensure_profile()')).friend_code]); await one(other, 'public.respond_friend($1, true)', [r.id]); }
const friendId = async (uid, name) => (await rows(uid, 'select * from public.list_friends()')).find((f) => f.display_name === name).id;

/** A simulated device: its own storage, store and engine, signed in as `uid`. */
function device(uid, hooks = {}) {
  const storage = memStorage();
  globalThis.localStorage = storage; // the store reads it when created
  const store = createStore();
  const api = dbApi(db, uid, hooks);
  const eng = createSharedTrips({ store, api, storage, debounceMs: 25, pollMs: 100000 });
  return { uid, storage, store, api, eng, hooks };
}
const names = (d, tripId) => d.store.items().filter((i) => i.tripId === tripId).map((i) => i.name).sort().join();
const server = async (uid, tripId) => (await one(uid, 'public.get_shared_trip($1)', [tripId]));
const serverNames = async (tripId) => (await server(A, tripId)).doc.items.map((i) => i.name).sort().join();

// ---------- the owner shares a trip
const alex = device(A);
const trip = alex.store.addTrip({ name: 'Hubei spring', startDate: '2026-12-01', endDate: '2026-12-03' }).trip;
const TID = trip.id;
for (const n of ['Tower', 'Lake']) alex.store.add({ type: 'photo', name: n, lat: 30.5, lon: 114.3, tripId: TID });
const home = alex.store.add({ type: 'residence', name: 'Home', lat: 30.4, lon: 114.1 }).item;
alex.store.add({ type: 'photo', name: 'Private spot', lat: 30.6, lon: 114.2 });
const r = await alex.eng.share(TID);
ok(r.rev === 1 && alex.store.getTrip(TID).shared.owner === true, 'the owner shares a trip: it is linked and at revision 1');
ok(await serverNames(TID) === 'Lake,Tower', 'the shared document holds the trip\'s own markers only (not Home, not the untagged marker)');
ok(alex.eng.snapshot().trips[TID].status === 'synced', 'its status is synced');

// ---------- inviting and joining
await alex.eng.invite(TID, await friendId(A, 'Bea'));
const bea = device(B);
await bea.eng.poll();
let inv = bea.eng.snapshot().invitations;
ok(inv.length === 1 && inv[0].name === 'Hubei spring' && inv[0].ownerName === 'Alex' && inv[0].startDate === '2026-12-01', 'the invited friend sees the invitation with the trip, the owner and the dates');
ok(!bea.store.getTrip(TID), 'and nothing is on their device yet');
await bea.eng.respond(TID, true);
ok(bea.eng.snapshot().invitations.length === 0 && bea.store.getTrip(TID)?.shared.owner === false && bea.store.getTrip(TID).shared.ownerName === 'Alex' && names(bea, TID) === 'Lake,Tower', 'accepting brings the trip and its markers onto their device, linked to the owner');
ok(bea.store.items().length === 2, 'and only those');
const mem = await bea.eng.members(TID);
ok(mem.length === 2 && mem.find((m) => m.is_me).display_name === 'Bea', 'they can see who is in the party');

// ---------- an edit goes to the other person
bea.store.add({ type: 'hotel', name: 'Bea hotel', lat: 30.55, lon: 114.35, tripId: TID });
ok(bea.eng.snapshot().trips[TID].status === 'pending', 'an edit marks the trip as waiting to be saved');
await tick(150);
ok((await server(B, TID)).rev === 2 && await serverNames(TID) === 'Bea hotel,Lake,Tower', 'it is saved to the server a moment later (revision 2)');
await alex.eng.poll();
ok(names(alex, TID) === 'Bea hotel,Lake,Tower', 'and the owner receives it on the next check');
ok((await server(A, TID)).rev === 2, 'receiving it saves nothing back');
ok(alex.store.items().length === 5, 'and the owner\'s own other markers are untouched (' + alex.store.items().length + ' markers)');

// ---------- a burst of edits is one save
for (const n of ['b1', 'b2', 'b3']) bea.store.add({ type: 'photo', name: n, lat: 30.5, lon: 114.3, tripId: TID });
await tick(150);
ok((await server(B, TID)).rev === 3, 'three quick edits become one save (revision 3)');
await alex.eng.poll();

// ---------- both edit at once: merged, nothing lost, both converge
const alexTower = alex.store.items().find((i) => i.name === 'Tower'), beaLake = bea.store.items().find((i) => i.name === 'Lake');
alex.store.update(alexTower.id, { name: 'Tower (Alex)' });
bea.store.update(beaLake.id, { name: 'Lake (Bea)' });
await tick(200);
await alex.eng.poll(); await bea.eng.poll(); await alex.eng.poll();
const sn = await serverNames(TID);
ok(/Tower \(Alex\)/.test(sn) && /Lake \(Bea\)/.test(sn), 'edits to different markers made at the same time are both kept on the server');
ok(names(alex, TID) === sn && names(bea, TID) === sn, 'and both devices hold the same markers');

// ---------- both change the same field: the later one wins on both devices
const bt = alex.store.items().find((i) => i.name.startsWith('b1'));
alex.hooks.beforeSave = async () => { await tick(5); };
alex.store.update(bt.id, { note: 'from Alex' });
await tick(5);
bea.store.update(bea.store.items().find((i) => i.name === 'b1').id, { note: 'from Bea' });
await tick(250);
await alex.eng.poll(); await bea.eng.poll(); await alex.eng.poll();
const note = (d) => d.store.items().find((i) => i.name === 'b1').note;
ok(note(alex) === note(bea) && /^from /.test(note(alex)), 'the same field changed on both devices ends the same on both: "' + note(alex) + '"');

// ---------- a deletion by one person reaches the other
const doomed = bea.store.items().find((i) => i.name === 'b3');
bea.store.remove(doomed.id);
await tick(150); await alex.eng.poll();
ok(!alex.store.items().some((i) => i.name === 'b3'), 'a marker removed by a party member is removed for the owner too');
ok((await server(A, TID)).doc.items.length === alex.store.items().filter((i) => i.tripId === TID).length, 'and the server agrees');

// ---------- trip details travel too
bea.store.updateTrip(TID, { notes: 'Bring spare batteries', name: 'Hubei spring (final)' });
await tick(150); await alex.eng.poll();
ok(alex.store.getTrip(TID).notes === 'Bring spare batteries' && alex.store.getTrip(TID).name === 'Hubei spring (final)' && alex.store.getTrip(TID).shared.owner === true, 'the trip\'s own fields (name, notes) reach the other person; the link stays');

// ---------- a party member cannot delete the trip
ok(bea.store.removeTrip(TID).ok === false && bea.store.getTrip(TID), 'a party member cannot delete a shared trip on their device');

// ---------- earlier versions and restore
const vs = await alex.eng.versions(TID);
ok(vs.length >= 5 && vs[0].updated_by_name, 'earlier versions are listed with who saved them (' + vs.length + ')');
const v2 = vs.find((v) => v.rev === 2);
await alex.eng.restore(TID, v2.rev);
ok(names(alex, TID) === 'Bea hotel,Lake,Tower', 'restoring version 2 puts the owner\'s device back to it');
await bea.eng.poll();
ok(names(bea, TID) === 'Bea hotel,Lake,Tower', 'and the party member receives it');

// ---------- a failure is shown and the next check recovers; data is never lost
alex.hooks.failNext = 'network down';
await alex.eng.poll();
ok(alex.eng.snapshot().error === 'network down' && alex.store.items().filter((i) => i.tripId === TID).length === 3, 'a failed check shows the error and leaves the data alone');
await alex.eng.poll();
ok(alex.eng.snapshot().error === null, 'the next check recovers');

// ---------- an edit made while a save is in flight is not lost
const dee = device(A);
dee.store.adoptShared((await server(A, TID)).doc, { owner: true, ownerName: 'You' }); // a second device of the owner, no record of the last sync
await dee.eng.poll();
ok(names(dee, TID) === 'Bea hotel,Lake,Tower' && dee.eng.snapshot().trips[TID].status === 'synced', 'a second device of the same person that has no record of the last sync joins up without changing anything');
let once = true;
dee.hooks.beforeSave = async () => { if (once) { once = false; dee.store.add({ type: 'photo', name: 'During save', lat: 30.5, lon: 114.3, tripId: TID }); } };
dee.store.add({ type: 'photo', name: 'First', lat: 30.5, lon: 114.3, tripId: TID });
await tick(250); await tick(150);
ok(/During save/.test(await serverNames(TID)) && /First/.test(await serverNames(TID)), 'an edit made while a save is under way is saved too');
dee.hooks.beforeSave = null;

// ---------- leaving keeps a private copy
await bea.eng.poll();
await bea.eng.leave(TID);
ok(!bea.store.getTrip(TID).shared && names(bea, TID).includes('Tower'), 'a party member who leaves keeps the trip and its markers as a private trip');
bea.store.add({ type: 'photo', name: 'After leaving', lat: 30.5, lon: 114.3, tripId: TID });
await tick(150);
ok(!/After leaving/.test(await serverNames(TID)), 'and their later edits no longer go to the shared trip');
ok(bea.store.removeTrip(TID).ok, 'now that the trip is private again they can delete it');
await alex.eng.poll();
ok((await alex.eng.members(TID)).length === 1, 'the owner sees that they left');

// ---------- the owner removes someone: they keep a private copy and are told
await alex.eng.invite(TID, await friendId(A, 'Cam'));
const cam = device(C);
await cam.eng.poll(); await cam.eng.respond(TID, true);
ok(cam.store.getTrip(TID)?.shared, 'a second friend joins');
const camMember = (await alex.eng.members(TID)).find((m) => m.display_name === 'Cam').member_id;
await alex.eng.removeMember(TID, camMember);
await cam.eng.poll();
const notices = cam.eng.takeNotices();
ok(!cam.store.getTrip(TID).shared && cam.store.items().some((i) => i.tripId === TID) && notices.length === 1 && /no longer shared with you/.test(notices[0]), 'someone the owner removed keeps a private copy and gets a notice: ' + notices[0]);
ok(cam.eng.takeNotices().length === 0, 'the notice is given once');

// ---------- the owner deletes the shared trip: everyone keeps a private copy
await alex.eng.invite(TID, await friendId(A, 'Bea'));
const bea2 = device(B); await bea2.eng.poll(); await bea2.eng.respond(TID, true);
await alex.eng.deleteShared(TID);
ok(!alex.store.getTrip(TID).shared && alex.store.items().some((i) => i.tripId === TID), 'the owner deletes the shared trip: it stays on their device as a private trip');
await bea2.eng.poll();
ok(!bea2.store.getTrip(TID).shared && bea2.eng.takeNotices().length === 1 && (await rows(A, 'select * from public.list_my_trips()')).length === 0, 'the others keep a private copy and are told; the server holds nothing');

// ---------- stopping
await alex.eng.stop(); await bea.eng.stop(); await bea2.eng.stop(); await cam.eng.stop(); await dee.eng.stop();
await db.close();
