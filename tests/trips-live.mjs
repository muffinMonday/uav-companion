// Shared trips on the hosted dev project, as three throwaway users (created and deleted here). NOT part of the default run: it needs the Supabase CLI
// login and network. Run: node tests/trips-live.mjs
// The service key is fetched through the CLI into memory for the user admin calls only; it is never printed or written to a file.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createTripsApi } from '../src/sharedtrip/api.js';
import { createSocial } from '../src/social.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const url = /VITE_SUPABASE_URL=(\S+)/.exec(env)[1], key = /VITE_SUPABASE_PUBLISHABLE_KEY=(\S+)/.exec(env)[1];
const ref = new URL(url).hostname.split('.')[0];
const service = JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${ref} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()).find((k) => k.name === 'service_role').api_key;
const admin = createClient(url, service, { auth: { persistSession: false } });

const stamp = Date.now(), password = randomBytes(18).toString('base64url');
const made = [];
async function user(tag) {
  const email = `trips-test-${tag}-${stamp}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('could not create ' + tag + ': ' + error.message);
  made.push(data.user.id);
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const s = await sb.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error('could not sign in ' + tag);
  return { id: data.user.id, sb, trips: createTripsApi(sb), social: createSocial(sb) };
}
const mine = {}; // the id of this test's own trip, for the clean-up check (the project may hold real shared trips)
const refused = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
try {
  const a = await user('a'), b = await user('b'), c = await user('c');
  await a.social.profile('Live Alex'); const pb = await b.social.profile('Live Bea'); await c.social.profile('Live Cam');
  await a.social.request(pb.friend_code);
  await b.social.respond((await b.social.list())[0].id, true);

  const TRIP = (mine.trip = randomUUID());
  const mk = (id, name) => ({ id, type: 'photo', name, note: '', lat: 30.5, lon: 114.3, created: '2026-11-01T00:00:00.000Z', tripId: TRIP });
  const doc = (items, name = 'Live trip') => ({ v: 1, trip: { id: TRIP, name }, items });

  const r = await a.trips.share(doc([mk('m1', 'Tower')]));
  ok(r.id === TRIP && r.rev === 1, 'a trip is shared');
  ok(/trip not found|permission/.test(await refused(c.trips.get(TRIP)) ?? ''), 'a stranger cannot read it: ' + await refused(c.trips.get(TRIP)));
  const tbl = await a.sb.from('shared_trips').select('*');
  ok(!!tbl.error || (tbl.data ?? []).length === 0, 'the table cannot be read directly');
  const anon = createClient(url, key, { auth: { persistSession: false } });
  ok(!!(await anon.rpc('list_my_trips')).error, 'an anonymous visitor cannot list trips');

  const picker = await a.trips.invitable(TRIP);
  ok(picker.length === 1 && picker[0].display_name === 'Live Bea' && !JSON.stringify(picker).includes(b.id), 'the invite picker lists the friend, with no user id');
  ok(/only invite friends/.test(await refused(a.trips.invite(TRIP, '00000000-0000-0000-0000-000000000000')) ?? ''), 'inviting a non-friend is refused');
  await a.trips.invite(TRIP, picker[0].friendship_id);
  const inv = await b.trips.list();
  ok(inv.length === 1 && inv[0].status === 'invited' && inv[0].owner_name === 'Live Alex', 'the friend sees the invitation');
  ok(/trip not found/.test(await refused(b.trips.get(TRIP)) ?? ''), 'but cannot read the trip before accepting');
  await b.trips.respond(TRIP, true);
  const g = await b.trips.get(TRIP);
  ok(g.rev === 1 && g.doc.items.length === 1 && g.role === 'editor', 'after accepting they read it, as an editor');

  const s1 = await b.trips.save(TRIP, doc([mk('m1', 'Tower'), mk('m2', 'Added by Bea')]), 1);
  ok(s1.status === 'ok' && s1.rev === 2, 'a party member saves an edit');
  const conflict = await a.trips.save(TRIP, doc([mk('m1', 'Tower'), mk('m3', 'Alex too')]), 1);
  ok(conflict.status === 'conflict' && conflict.rev === 2, 'a stale save is a conflict');
  ok(/Home marker/.test(await refused(b.trips.save(TRIP, doc([{ ...mk('h', 'Home'), type: 'residence' }]), 2)) ?? ''), 'a Home marker is refused');
  ok(/check-ins are personal/.test(await refused(b.trips.save(TRIP, doc([{ ...mk('c', 'x'), checkin: { at: 'x' } }]), 2)) ?? ''), 'a check-in is refused');
  ok(/trip not found/.test(await refused(b.trips.deleteTrip(TRIP)) ?? '') && /trip not found/.test(await refused(b.trips.invite(TRIP, '00000000-0000-0000-0000-000000000000')) ?? ''), 'a party member cannot delete the trip or invite');
  const vs = await a.trips.versions(TRIP);
  ok(vs.length === 1 && vs[0].updated_by_name === 'Live Alex', 'the replaced version is kept');
  const rs = await b.trips.restore(TRIP, vs[0].rev);
  ok(rs.status === 'ok' && rs.rev === 3, 'restoring an earlier version works');
  ok((await b.trips.shareLocation(TRIP, 30.5, 114.3, 12)).status === 'ok', 'a party member sends a position');
  const lv = await a.trips.live();
  ok(lv.length === 1 && lv[0].display_name === 'Live Bea' && lv[0].lat === 30.5 && !JSON.stringify(lv).includes(b.id), 'the owner sees it, with no user id');
  ok((await c.trips.live()).length === 0 && /trip not found/.test(await refused(c.trips.shareLocation(TRIP, 1, 1, 1)) ?? ''), 'a stranger sees nothing and cannot send one');
  ok(/not a position/.test(await refused(b.trips.shareLocation(TRIP, 99, 1, 1)) ?? ''), 'a position that is not on Earth is refused');
  await b.trips.stopSharing(TRIP);
  ok((await a.trips.live()).length === 0, 'stopping sharing removes it');
  const mem = await a.trips.members(TRIP);
  ok(mem.length === 2 && !JSON.stringify(mem).includes(b.id), 'members are listed by name, without user ids');
  await b.trips.leave(TRIP);
  ok((await b.trips.list()).length === 0, 'a party member leaves');
  ok((await a.trips.deleteTrip(TRIP)).status === 'deleted' && (await a.trips.list()).length === 0, 'the owner deletes the trip');
} finally {
  for (const id of made) await admin.auth.admin.deleteUser(id);
  const { data: left } = await admin.from('profiles').select('user_id').in('user_id', made);
  const { data: trips } = await admin.from('shared_trips').select('id').eq('id', mine.trip ?? randomUUID());
  ok(!left?.length && !(trips ?? []).length, 'the test users, their profiles and their trip are gone');
}
