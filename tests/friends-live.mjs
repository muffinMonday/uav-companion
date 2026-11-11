// Friends on the hosted dev project, as two throwaway users (created and deleted here). NOT part of the default run: it needs the Supabase CLI
// login and network. Run: node tests/friends-live.mjs
// The service key is fetched through the CLI into memory for the user admin calls only; it is never printed or written to a file.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const url = /VITE_SUPABASE_URL=(\S+)/.exec(env)[1], key = /VITE_SUPABASE_PUBLISHABLE_KEY=(\S+)/.exec(env)[1];
const ref = new URL(url).hostname.split('.')[0];
const service = JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${ref} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()).find((k) => k.name === 'service_role').api_key;
const admin = createClient(url, service, { auth: { persistSession: false } });

const stamp = Date.now(), password = randomBytes(18).toString('base64url');
const made = [];
async function user(tag) {
  const email = `friends-test-${tag}-${stamp}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('could not create ' + tag + ': ' + error.message);
  made.push(data.user.id);
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const s = await sb.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error('could not sign in ' + tag);
  return { id: data.user.id, sb, rpc: async (fn, a) => { const { data: d, error: e } = await sb.rpc(fn, a); if (e) throw new Error(e.message); return d; } };
}
try {
  const a = await user('a'), b = await user('b'), c = await user('c');
  const pa = await a.rpc('ensure_profile', { p_display_name: 'Live Alex' }), pb = await b.rpc('ensure_profile', { p_display_name: 'Live Bea' });
  ok(/^[0-9a-f]{10}$/.test(pa.friend_code) && pa.display_name === 'Live Alex', 'a profile is created with a code');

  const tbl = await a.sb.from('profiles').select('*');
  ok(!!tbl.error || (tbl.data ?? []).length === 0, 'the profiles table cannot be read directly: ' + (tbl.error?.message ?? 'no rows'));
  const anon = createClient(url, key, { auth: { persistSession: false } });
  const an = await anon.rpc('list_friends');
  ok(!!an.error, 'an anonymous visitor cannot call list_friends: ' + an.error?.message);

  const r = await a.rpc('request_friend', { p_code: pb.friend_code.toUpperCase() });
  ok(r.status === 'pending', 'a request by code is pending');
  const lb = await b.rpc('list_friends');
  ok(lb.length === 1 && lb[0].status === 'incoming' && lb[0].display_name === 'Live Alex' && !JSON.stringify(lb).includes(a.id), 'the receiver sees it, with the name and no user id');
  ok((await c.rpc('list_friends')).length === 0, 'a third user sees nothing');
  const bad = await c.sb.rpc('request_friend', { p_code: 'ffffffffff' });
  ok(/that code was not found/.test(bad.error?.message ?? ''), 'an unknown code gives "that code was not found"');
  await b.rpc('respond_friend', { p_id: lb[0].id, p_accept: true });
  const la = await a.rpc('list_friends');
  ok(la[0].status === 'friends' && la[0].display_name === 'Live Bea', 'accepting makes them friends');
  await a.rpc('touch_presence'); await b.rpc('touch_presence');
  const lp = await a.rpc('list_friends');
  ok(lp[0].online === true && !!lp[0].last_seen && !JSON.stringify(lp).includes(b.id), 'a friend with the app open shows as online (and no user id comes back)');
  await b.rpc('set_show_online', { p_on: false });
  const lh = await a.rpc('list_friends');
  ok(lh[0].online === null && lh[0].last_seen === null, 'a friend who hides their status shows nothing');
  await b.rpc('set_show_online', { p_on: true });
  await a.rpc('block_user', { p_id: la[0].id });
  const again = await b.sb.rpc('request_friend', { p_code: pa.friend_code });
  ok(/that code was not found/.test(again.error?.message ?? '') && (await a.rpc('list_blocked')).length === 1, 'blocking ends it, and the blocked person cannot ask again');
  await a.rpc('delete_profile');
  ok((await a.rpc('list_friends')).length === 0, 'delete_profile removes the profile and friendships');
} finally {
  for (const id of made) await admin.auth.admin.deleteUser(id);
  const { data: left } = await admin.from('profiles').select('user_id').in('user_id', made);
  ok(!left?.length, 'the test users and their profiles are gone');
}
