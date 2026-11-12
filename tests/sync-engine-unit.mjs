// The sync engine against an in-memory cloud: several simulated devices, no browser, no network.
import { createSync } from '../src/sync/engine.js';
import { makeCloud, memStorage } from './lib-sync.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const { createStore } = await import('../src/poi.js');
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const M = (id, name = id) => ({ id, name, lat: 30 + id.length / 10, lon: 114 });

/** A simulated device: its own storage, store and engine, all talking to the shared cloud. */
function device(cloud, name, { user, signedIn = true, opts = {} } = {}) {
  const storage = memStorage();
  globalThis.localStorage = storage; // the store reads it when created
  const store = createStore();
  const backups = [];
  const adapter = cloud.adapter(user, { signedIn });
  const sync = createSync({ store, adapter, storage, device: name, debounceMs: 10, backup: async (side, doc) => { backups.push({ side, n: doc.items.length }); }, ...opts });
  return { storage, store, sync, backups, adapter, name, restart() { globalThis.localStorage = storage; const s2 = createStore(); return createSync({ store: s2, adapter, storage, device: name, debounceMs: 10 }); } };
}
const names = (d) => d.store.items().map((i) => i.name).sort().join();
const byName = (d, n) => d.store.items().find((i) => i.name === n);
const cloudNames = (c, u) => c.rows.get(u).doc.items.map((i) => i.name);

// ---------- not signed in: nothing happens
{
  const cloud = makeCloud(), d = device(cloud, 'laptop', { signedIn: false });
  d.store.add(M('a'));
  await d.sync.start();
  ok(d.sync.status().status === 'off' && cloud.rows.size === 0 && !cloud.calls.includes('save'), 'signed out: no sync, nothing is sent');
}
// ---------- no adapter at all (backend not configured)
{
  globalThis.localStorage = memStorage();
  const store = createStore(), s = createSync({ store, adapter: null });
  store.add(M('a')); await s.start(); await s.sync();
  ok(s.status().status === 'off', 'no backend configured: the engine stays off and does not fail');
}

// ---------- first sign-in with data, cloud empty: uploaded
const cloud = makeCloud();
const A = { email: 'a@example.test' };
const laptop = device(cloud, 'laptop', { user: A });
laptop.store.add(M('a')); laptop.store.add(M('b')); laptop.store.addTrip({ name: 'Trip' });
await laptop.sync.start();
ok(laptop.sync.status().status === 'synced' && cloud.rows.get(A.email).rev === 1 && cloud.rows.get(A.email).doc.items.length === 2, 'first sign-in uploads this device (revision 1)');
ok(laptop.sync.status().baseRev === 1 && !laptop.sync.status().dirty, 'and the device remembers the revision and that it is clean');

// ---------- editing pushes after a pause, once
for (const x of ['c', 'd', 'e']) laptop.store.add(M(x));
ok(laptop.sync.status().dirty, 'an edit marks the device as changed');
await tick(80);
ok(cloud.rows.get(A.email).rev === 2 && cloud.rows.get(A.email).doc.items.length === 5, 'three quick edits become one upload (revision 2)');
ok(!laptop.sync.status().dirty && laptop.sync.status().baseRev === 2, 'and the device is clean again');

// ---------- a second, empty device takes the cloud copy
const phone = device(cloud, 'phone', { user: A });
await phone.sync.start();
ok(phone.sync.status().status === 'synced' && names(phone) === 'a,b,c,d,e' && phone.store.trips().length === 1, 'an empty device pulls the cloud copy');
ok(cloud.rows.get(A.email).rev === 2, 'without uploading anything');
phone.store.remove(byName(phone, 'a').id); await tick(80);
ok(cloud.rows.get(A.email).rev === 3 && cloud.rows.get(A.email).doc.items.length === 4, 'a change on the phone is uploaded (revision 3)');

// ---------- a clean device that is behind pulls without asking
await laptop.sync.sync();
ok(laptop.sync.status().status === 'synced' && names(laptop) === 'b,c,d,e', 'a device with no changes of its own just takes the newer cloud copy');
ok(!laptop.sync.status().dirty, 'and applying it does not count as an edit');

// ---------- a true conflict asks; nothing is overwritten meanwhile
phone.store.add(M('ph1')); phone.store.add(M('ph2'));
await tick(80); // the phone's push goes through first
laptop.store.add(M('lap1')); // the laptop syncs at once, before its own pause is over
ok(cloud.rows.get(A.email).rev === 4, 'the phone gets there first (revision 4)');
await laptop.sync.sync();
const q = laptop.sync.status();
ok(q.status === 'ask' && q.pending && q.pending.cloud.rev === 4 && q.pending.cloud.device === 'phone', 'the laptop is asked, and told which device changed the cloud copy: ' + JSON.stringify(q.pending?.cloud));
ok(q.pending.diff.markers.onlyLocal === 1 && q.pending.diff.markers.onlyCloud === 2, 'with a count of what only each side has');
ok(cloud.rows.get(A.email).rev === 4 && names(laptop).includes('lap1'), 'nothing was overwritten on either side');
await laptop.sync.sync(); await tick(40);
ok(laptop.sync.status().status === 'ask', 'it keeps waiting for the answer instead of trying again');

// ---------- the answer: use the cloud copy, backing this device up first
await laptop.sync.resolve('cloud');
ok(laptop.sync.status().status === 'synced' && names(laptop) === 'b,c,d,e,ph1,ph2', 'use the cloud copy: this device now matches it');
ok(laptop.backups.length === 1 && laptop.backups[0].side === 'device' && laptop.backups[0].n === 5, 'and the data it replaced was handed to the backup first');

// ---------- the answer: keep this device
phone.store.add(M('ph3'));
await tick(80);
laptop.store.add(M('lap2'));
await laptop.sync.sync();
ok(laptop.sync.status().status === 'ask', 'a second conflict');
await laptop.sync.resolve('device');
const cur = cloud.rows.get(A.email);
ok(laptop.sync.status().status === 'synced' && cur.doc.items.some((i) => i.name === 'lap2') && !cur.doc.items.some((i) => i.name === 'ph3'), 'keep this device: the cloud copy becomes this device\'s');
ok(laptop.backups[1]?.side === 'cloud', 'and the cloud copy was handed to the backup first');
ok((await laptop.adapter.listVersions()).length >= 1, 'the replaced cloud copy is also kept as an earlier version');

// ---------- choosing without a backup
phone.store.add(M('ph4')); await tick(80); laptop.store.add(M('lap3'));
await laptop.sync.sync();
const before = laptop.backups.length;
await laptop.sync.resolve('cloud', { backup: false });
ok(laptop.backups.length === before && laptop.sync.status().status === 'synced', 'the backup can be skipped');

// ---------- never synced here, data on both sides: asks
const tablet = device(cloud, 'tablet', { user: A });
tablet.store.add(M('t1'));
await tablet.sync.start();
ok(tablet.sync.status().status === 'ask' && tablet.sync.status().pending.neverSynced, 'a device that never synced, with data of its own and a cloud copy, asks first');
ok(names(tablet) === 't1' && cloud.rows.get(A.email).doc.items.every((i) => i.name !== 't1'), 'and nothing moved');

// ---------- the cloud copy was reset (older revision than we synced from)
if (phone.sync.status().status === 'ask') await phone.sync.resolve('cloud'); // it had its own conflict pending from the laptop's overwrite
await phone.sync.sync();
cloud.rows.get(A.email).rev = 1;
await phone.sync.sync();
ok(phone.sync.status().status === 'ask' && phone.sync.status().pending.cloudReset, 'a cloud copy older than what the device synced from is a question, not a silent overwrite');

// ---------- errors are shown, and a later pass recovers
const e1 = makeCloud(), d1 = device(e1, 'x', { user: { email: 'e@example.test' } });
d1.store.add(M('z'));
e1.failNext = 'network down';
await d1.sync.start();
ok(d1.sync.status().status === 'error' && /network down/.test(d1.sync.status().error), 'a failed pass shows the error');
ok(d1.store.items().length === 1, 'and the data on the device is untouched');
await d1.sync.sync();
ok(d1.sync.status().status === 'synced' && e1.rows.size === 1, 'the next pass recovers and uploads');

// ---------- an edit made while the upload is in flight is not lost
{
  const c = makeCloud(), d = device(c, 'x', { user: { email: 'f@example.test' } });
  d.store.add(M('p'));
  const real = d.adapter.save; d.adapter.save = async (...a) => { d.store.add(M('q')); return real(...a); };
  await d.sync.start();
  ok(d.sync.status().dirty, 'an edit made during an upload leaves the device marked as changed');
  d.adapter.save = real; await tick(80);
  ok(c.rows.get('f@example.test').doc.items.length === 2 && !d.sync.status().dirty, 'and it goes up on the next pass');
}

// ---------- the device's memory survives a restart
{
  const c = makeCloud(), d = device(c, 'x', { user: { email: 'g@example.test' } });
  d.store.add(M('p')); await d.sync.start();
  d.store.add(M('q')); // dirty, not yet uploaded
  const s2 = d.restart();
  ok(s2.status().baseRev === 1 && s2.status().dirty, 'after a restart the device still knows its revision and that it has unsent changes');
  await s2.start();
  ok(c.rows.get('g@example.test').rev === 2, 'and the unsent change is uploaded');
}

// ---------- check-ins stay on the device unless the user opts in
{
  const c = makeCloud(), d = device(c, 'x', { user: { email: 'h@example.test' } });
  d.store.add({ ...M('v'), checkin: { at: '2026-11-11T10:00:00.000Z', lat: 30, lon: 114, accuracy: 10 } });
  await d.sync.start();
  const stored = c.rows.get('h@example.test').doc.items[0];
  ok(!('checkin' in stored), 'a check-in is not uploaded by default');
  const other = device(c, 'y', { user: { email: 'h@example.test' } });
  await other.sync.start();
  ok(other.store.items().length === 1 && !other.store.items()[0].checkin, 'and a second device does not receive one');
  c.rows.get('h@example.test').doc.items[0].name = 'renamed'; c.rows.get('h@example.test').rev++;
  await d.sync.sync();
  ok(byName(d, 'renamed')?.checkin, 'pulling a newer copy keeps this device\'s own check-in');
}

// ---------- sign out forgets the device's sync memory, not its data
await laptop.sync.signOut();
ok(laptop.sync.status().status === 'off' && laptop.sync.status().baseRev === null && laptop.store.items().length > 0, 'sign-out keeps the data and forgets the revision');
await laptop.sync.stop(); await phone.sync.stop(); await tablet.sync.stop();

// ---------- an upload that reached the server but whose answer was lost: the retry does not ask, and nothing is duplicated
{
  const c = makeCloud(), u = { email: 'r@example.test' }, d = device(c, 'laptop', { user: u });
  d.store.add(M('one')); d.store.add(M('two'));
  const real = d.adapter.save;
  d.adapter.save = async (...a) => { await real(...a); throw new Error('network dropped'); }; // saved, but the device never hears
  await d.sync.start();
  ok(d.sync.status().status === 'error' && c.rows.get(u.email).rev === 1 && d.sync.status().baseRev === null, 'lost answer: the device shows an error and does not think it synced');
  d.adapter.save = real;
  await d.sync.sync();
  ok(d.sync.status().status === 'synced' && d.sync.status().baseRev === 1 && c.rows.get(u.email).doc.items.length === 2 && c.rows.get(u.email).rev === 1, 'the retry recognises its own upload: no question, no duplicate, no new revision');
  await d.sync.stop();
}
// ---------- the same data on a second device (never synced): no question either; different data still asks
{
  const c = makeCloud(), u = { email: 's@example.test' };
  const a = device(c, 'laptop', { user: u }); a.store.add(M('one')); await a.sync.start();
  const b = device(c, 'phone', { user: u }); b.store.replaceAll(a.store.items(), a.store.trips()); await b.sync.start();
  ok(b.sync.status().status === 'synced' && c.rows.get(u.email).rev === 1, 'identical data on a second device syncs without asking');
  const e = device(c, 'tablet', { user: u }); e.store.add(M('other')); await e.sync.start();
  ok(e.sync.status().status === 'ask', 'different data on a second device still asks');
  await a.sync.stop(); await b.sync.stop(); await e.sync.stop();
}

// ---------- sign-out with a wipe: the next person on this device does not inherit the data
{
  const c = makeCloud(), A = { email: 'a@example.test' }, B = { email: 'b@example.test' };
  const d = device(c, 'shared pc', { user: A });
  d.store.add(M('one')); d.store.add(M('two'));
  await d.sync.start();
  const r = await d.sync.signOut({ wipe: true });
  ok(r.ok && d.store.items().length === 0 && d.store.trips().length === 0 && d.backups.length === 0, 'wipe: in step with the cloud, so the device is cleared with no backup');
  ok(c.rows.get(A.email).doc.items.length === 2 && d.sync.status().status === 'off', 'wipe: the cloud copy is untouched');
  // another account signs in on the same browser with an empty cloud: nothing of A's reaches B
  const s2 = createSync({ store: d.store, adapter: c.adapter(B), storage: d.storage, device: 'shared pc', debounceMs: 10 });
  await s2.start();
  ok(!c.rows.has(B.email) && d.store.items().length === 0, 'two accounts on one browser: the second account\'s cloud stays empty');
  await s2.stop(); await d.sync.stop();
}
{
  const c = makeCloud(), A = { email: 'a@example.test' };
  const d = device(c, 'laptop', { user: A });
  d.store.add(M('one'));
  await d.sync.start();
  c.failNext = 'offline';
  d.store.add(M('late')); // a change the cloud cannot accept now
  await tick(40);
  c.failNext = 'offline';
  const r = await d.sync.signOut({ wipe: true });
  ok(!r.ok && r.reason === 'unsynced' && d.store.items().length === 2 && d.sync.status().session, 'wipe refused while a change is not in the cloud: data and session intact');
  c.failNext = 'offline';
  const r2 = await d.sync.signOut({ wipe: true, force: true });
  ok(r2.ok && d.store.items().length === 0 && d.backups.length === 1 && d.backups[0].side === 'device' && d.backups[0].n === 2, 'forced: the whole device is handed to the backup first, then cleared');
  await d.sync.stop();
}
{
  const c = makeCloud(), d = device(c, 'phone', { user: { email: 'a@example.test' } });
  d.store.add({ ...M('v'), checkin: { at: '2026-11-11T10:00:00.000Z', lat: 30, lon: 114, accuracy: 10 } });
  await d.sync.start();
  const r = await d.sync.signOut({ wipe: true });
  ok(!r.ok && r.reason === 'checkins' && d.store.items().length === 1, 'check-ins are never uploaded, so a wipe asks first');
  const r2 = await d.sync.signOut({ wipe: true, force: true });
  ok(r2.ok && d.backups.length === 1 && d.store.items().length === 0, 'and a forced wipe backs them up');
  await d.sync.stop();
}
{
  const c = makeCloud(), d = device(c, 'tablet', { user: { email: 'a@example.test' } });
  d.store.add(M('x')); await d.sync.start();
  const r = await d.sync.signOut();
  ok(r.ok && d.store.items().length === 1, 'without wipe, sign-out still only forgets the revision');
  await d.sync.stop();
}
