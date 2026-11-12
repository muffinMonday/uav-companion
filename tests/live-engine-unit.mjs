// The live-location engine (src/live.js) against the real database rules on PGlite, with a fake position source and a fake clock. No browser, no network.
import { createLive, meters, endedMoreThanADay } from '../src/live.js';
import { dbApi } from './lib-trips.mjs';
import { makeDb, as, A, B } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const TRIP = '5a1c0000-0000-4000-8000-0000000000ee';
const J = JSON.stringify;

// ---------- the pure parts
ok(Math.round(meters(30, 114, 30, 114)) === 0 && Math.abs(meters(30, 114, 30.001, 114) - 111) < 2 && Math.abs(meters(0, 0, 0, 1) - 111195) < 200, 'meters measures short and long distances');
const now0 = Date.parse('2026-12-10T12:00:00Z');
ok(!endedMoreThanADay('2026-12-09', now0) && !endedMoreThanADay('2026-12-10', now0) && endedMoreThanADay('2026-12-08', now0) && !endedMoreThanADay(undefined, now0) && !endedMoreThanADay('soon', now0), 'a trip is over for sharing from two days after its end date (the same rule as the server)');

// ---------- a trip with Alex (owner) and Bea (party member)
for (const [u, n] of [[A, 'Alex'], [B, 'Bea']]) await one(u, 'public.ensure_profile($1)', [n]);
const fr = await one(A, 'public.request_friend($1)', [(await one(B, 'public.ensure_profile()')).friend_code]); await one(B, 'public.respond_friend($1, true)', [fr.id]);
const docOf = (end) => ({ v: 1, trip: { id: TRIP, name: 'Hubei', ...(end && { startDate: end, endDate: end }) }, items: [] });
await one(A, 'public.share_trip($1::jsonb)', [J(docOf())]);
await one(A, 'public.invite_to_trip($1, $2)', [TRIP, (await as(db, A, 'select * from public.list_friends()'))[0].id]); await one(B, 'public.respond_trip_invite($1, true)', [TRIP]);
const age = (uid, s) => db.exec(`update public.live_locations set updated_at = now() - interval '${s} seconds' where user_id = '${uid}'`);
const rowOf = async (uid) => (await db.query(`select * from public.live_locations where user_id = '${uid}'`)).rows[0];

/** A device: its engine, a fake position source and a fake clock. */
function device(uid, trip = { id: TRIP }, devId = null) {
  let t = Date.now();
  const watchers = [];
  const geo = { watchPosition: (ok2, err) => { watchers.push({ ok2, err }); return watchers.length; }, clearWatch: () => { watchers.length = 0; } };
  const api = dbApi(db, uid, { device: devId });
  const eng = createLive({ api, geo, getTrip: () => trip, now: () => t, pollMs: 100000 });
  const pos = (lat, lon, acc = 10) => { for (const w of watchers) w.ok2({ coords: { latitude: lat, longitude: lon, accuracy: acc } }); };
  const fail = (code) => { for (const w of watchers) w.err({ code }); };
  return { eng, api, geo, pos, fail, watchers, advance: (ms) => { t += ms; }, trip };
}

// ---------- sharing starts off, and begins with the first position
const alex = device(A), bea = device(B);
ok(!alex.eng.isSharing(TRIP) && alex.watchers.length === 0, 'nothing is shared and no position is asked for until the switch is turned on');
ok(alex.eng.start(TRIP).ok && alex.eng.isSharing(TRIP) && alex.watchers.length === 1, 'turning sharing on asks for positions');
ok(alex.eng.snapshot().sharing[TRIP].status === 'waiting', 'and waits for the first one');
alex.pos(30.5, 114.3, 12); await tick(150);
let row = await rowOf(A);
ok(row && row.lat === 30.5 && row.lon === 114.3 && row.accuracy === 12, 'the first position is sent at once');
ok(alex.eng.snapshot().sharing[TRIP].status === 'ok' && alex.eng.snapshot().sharing[TRIP].accuracy === 12, 'the status is ok with the accuracy');

// ---------- the party sees it
await bea.eng.poll();
const seen = bea.eng.snapshot().others;
ok(seen.length === 1 && seen[0].display_name === 'Alex' && seen[0].lat === 30.5 && seen[0].age_seconds >= 0 && !Object.keys(seen[0]).some((k) => /user/.test(k)), 'a party member who looks sees Alex\'s position, with no user id');
await alex.eng.poll();
ok(alex.eng.snapshot().others.length === 0, 'and Alex does not see himself');

// ---------- how often, and when
alex.advance(1000); alex.pos(30.5, 114.3);
alex.advance(1000); alex.pos(30.6, 114.4); await tick(100);
ok(alex.api.calls.filter((c) => c === 'shareLocation').length === 1, 'positions within 5 seconds of the last one are not sent');
alex.advance(4000); alex.pos(30.5000001, 114.3); await tick(100);
ok(alex.api.calls.filter((c) => c === 'shareLocation').length === 1, 'after 5 seconds a position that has not moved is still not sent');
await age(A, 5);
alex.pos(30.6, 114.4, 8); await tick(150);
row = await rowOf(A);
ok(alex.api.calls.filter((c) => c === 'shareLocation').length === 2 && row.lat === 30.6, 'after 5 seconds a position that has moved is sent');
alex.advance(16000); await age(A, 5); alex.pos(30.6, 114.4, 8); await tick(150);
ok(alex.api.calls.filter((c) => c === 'shareLocation').length === 3, 'and one that has not moved is sent anyway after 15 seconds, so the party knows the app is still open');

// ---------- the other way
bea.eng.start(TRIP); bea.pos(30.7, 114.5); await tick(150);
await alex.eng.poll();
ok(alex.eng.snapshot().others.length === 1 && alex.eng.snapshot().others[0].display_name === 'Bea', 'Bea\'s position shows to Alex');

// ---------- stopping
await alex.eng.stop(TRIP);
ok(!alex.eng.isSharing(TRIP) && alex.watchers.length === 0 && await rowOf(A) === undefined, 'stopping removes the position and ends the position source');
await bea.eng.poll();
ok(bea.eng.snapshot().others.length === 0, 'and Bea no longer sees it');
ok(bea.eng.isSharing(TRIP) && bea.watchers.length === 1, 'Bea is still sharing; the sources are per device');
await bea.eng.stopAll();
ok(bea.watchers.length === 0 && await rowOf(B) === undefined && bea.api.calls.includes('stopAll'), 'stopping everything does the same');

// ---------- a refused permission
const cam = device(A);
cam.eng.start(TRIP); cam.fail(1); await tick(100);
ok(!cam.eng.isSharing(TRIP) && cam.watchers.length === 0 && cam.eng.takeNotices().some((n) => /permission was refused/.test(n)), 'when location permission is refused, sharing stops and says why');
cam.eng.start(TRIP); cam.fail(2); await tick(50);
ok(cam.eng.isSharing(TRIP) && cam.eng.snapshot().sharing[TRIP].status === 'waiting', 'a position that is just not available yet keeps waiting');
await cam.eng.stopAll();
ok(createLive({ api: dbApi(db, A), geo: null }).start(TRIP).ok === false, 'a browser that cannot give a position says so');

// ---------- a trip that is over stops by itself
const old = device(A, { id: TRIP, endDate: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) });
old.eng.start(TRIP); old.pos(30.5, 114.3); await tick(150);
ok(!old.eng.isSharing(TRIP) && await rowOf(A) === undefined && old.eng.takeNotices().some((n) => /trip has ended/.test(n)), 'sharing stops by itself more than a day after the trip ends, and nothing is sent');
// the server agrees even if the device does not
const stale = device(A, { id: TRIP });
await one(A, 'public.save_shared_trip($1, $2::jsonb, 1)', [TRIP, J(docOf(new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)))]);
stale.eng.start(TRIP); stale.pos(30.5, 114.3); await tick(150);
ok(!stale.eng.isSharing(TRIP) && await rowOf(A) === undefined, 'and the server refuses it too');
await one(A, 'public.save_shared_trip($1, $2::jsonb, 2)', [TRIP, J(docOf())]);

// ---------- leaving ends it
const bea2 = device(B);
bea2.eng.start(TRIP); bea2.pos(30.7, 114.5); await tick(150);
ok(await rowOf(B) !== undefined, 'sharing again');
await one(B, 'public.leave_trip($1)', [TRIP]);
bea2.advance(6000); bea2.pos(30.71, 114.5); await tick(150);
ok(!bea2.eng.isSharing(TRIP) && bea2.eng.takeNotices().some((n) => /no longer in this trip/.test(n)), 'a person who is no longer in the trip stops sharing at their next position');

// ---------- an error is shown and the next position tries again
const erra = device(A);
erra.api.live = async () => { throw new Error('network down'); };
await erra.eng.poll();
ok(erra.eng.snapshot().error === 'network down', 'a failed look for the others is reported');
let fails = 1; const real = erra.api.shareLocation;
erra.api.shareLocation = async (...a) => { if (fails-- > 0) throw new Error('network down'); return real(...a); };
erra.eng.start(TRIP); erra.pos(30.5, 114.3); await tick(150);
ok(erra.eng.isSharing(TRIP) && erra.eng.snapshot().sharing[TRIP].status === 'error', 'a failed send keeps sharing on and shows the error');
erra.advance(6000); await age(A, 5); erra.pos(30.51, 114.31); await tick(150);
ok(erra.eng.snapshot().sharing[TRIP].status === 'ok', 'the next position recovers');
await erra.eng.stopAll();

// ---------- a position that arrives after stopping does not stay on the server
const late = device(A);
late.hooks = null;
let release; const gate = new Promise((r) => { release = r; });
late.api.shareLocation = (async (real2) => async (...a) => { await gate; return real2(...a); })(late.api.shareLocation);
late.eng.start(TRIP); late.pos(30.5, 114.3);
await tick(30);
const stopping = late.eng.stop(TRIP);
release(); await stopping; await tick(200);
ok(await rowOf(A) === undefined, 'a position that was on its way when sharing was stopped does not remain on the server');

// ---------- two devices of one account: the newest to start sharing takes over, the other stops
{
  await db.exec(`delete from public.live_locations`);
  const phone = device(A, { id: TRIP }, 'phone'), laptop = device(A, { id: TRIP }, 'laptop');
  phone.eng.start(TRIP); phone.pos(10, 10); await tick(150);
  ok((await rowOf(A)).device === 'phone' && (await rowOf(A)).lat === 10, 'the first device holds the position');
  laptop.eng.start(TRIP); laptop.pos(20, 20); await tick(150);
  ok((await rowOf(A)).device === 'laptop' && (await rowOf(A)).lat === 20 && laptop.eng.isSharing(TRIP), 'the second device takes over when it starts sharing');
  await age(A, 5); phone.advance(6000); phone.pos(11, 11); await tick(150);
  ok(!phone.eng.isSharing(TRIP) && phone.watchers.length === 0 && phone.eng.takeNotices().some((n) => /moved to your other device/.test(n)) && (await rowOf(A)).lat === 20, 'the first device is told on its next position, stops and says so; it does not overwrite');
  await phone.eng.stopAll();
  ok((await rowOf(A)).device === 'laptop', 'and its stop does not remove the other device position');
  await age(A, 5); laptop.advance(6000); laptop.pos(21, 21); await tick(150);
  ok(laptop.eng.isSharing(TRIP) && (await rowOf(A)).lat === 21, 'the holder keeps sharing');
  await laptop.eng.stopAll();
  ok(await rowOf(A) === undefined, 'the holder stop removes it');
}
await db.close();
