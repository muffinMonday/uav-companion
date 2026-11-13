// The audit trail and the delete-account function against the HOSTED project, with two throwaway users (created and deleted here). NOT part of the default run: it needs
// the Supabase CLI login and network. Run: node tests/audit-live.mjs
// It leaves a few permanent audit rows on purpose (the table is append-only): one grant, one revoke and two profile.delete tombstones, none naming a person afterwards.
// The service key is fetched through the CLI into memory for the user admin calls and one read-back; it is never printed or written to a file.
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
const fresh = () => createClient(url, key, { auth: { persistSession: false } });

const made = [];
async function user(label) {
  const email = `audit-test-${label}-${Date.now()}@example.test`, password = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('could not create ' + label + ': ' + error.message);
  const c = fresh();
  const { error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw new Error('could not sign in ' + label + ': ' + e2.message);
  const u = { id: data.user.id, c, label };
  made.push(u);
  const { data: p, error: e3 } = await c.rpc('ensure_profile', { p_display_name: 'Audit ' + label });
  if (e3) throw new Error('ensure_profile ' + label + ': ' + e3.message);
  u.code = p.friend_code;
  return u;
}
const tombstones = async () => (await admin.from('audit_events').select('id', { count: 'exact', head: true }).eq('action', 'profile.delete')).count;

let A, B;
try {
  A = await user('a'); B = await user('b');
  const t0 = await tombstones();
  const { error: eRole } = await admin.from('app_roles').insert({ user_id: A.id, role: 'admin' });
  ok(!eRole, 'the first user is made an administrator (service role, for this test only)');

  // a non-administrator is refused
  let r = await B.c.rpc('admin_audit_events', { p_limit: 5 });
  ok(r.error && /not allowed/.test(r.error.message), 'an ordinary user cannot read the audit trail: ' + (r.error?.message ?? 'no error'));
  r = await B.c.from('audit_events').select('id');
  ok(r.error || (r.data ?? []).length === 0, 'and cannot read the table directly');

  // grant and revoke by the administrator, read back through the admin function
  r = await A.c.rpc('grant_role', { p_friend_code: B.code, p_role: 'organiser' });
  ok(!r.error && r.data.status === 'granted', 'the administrator grants the organiser role');
  r = await A.c.rpc('grant_role', { p_friend_code: B.code, p_role: 'organiser' });
  r = await A.c.rpc('revoke_role', { p_friend_code: B.code, p_role: 'organiser' });
  ok(!r.error && r.data.status === 'revoked', 'and revokes it');
  r = await A.c.rpc('admin_audit_events', { p_limit: 20 });
  const mine = (r.data ?? []).filter((e) => e.actor_code === A.code);
  const g = mine.filter((e) => e.action === 'role.grant'), v = mine.filter((e) => e.action === 'role.revoke');
  ok(!r.error && g.length === 1 && g[0].subject_code === B.code && g[0].ref === 'organiser', 'the grant is recorded once (the repeated grant changed nothing), with actor and subject by friend code');
  ok(v.length === 1 && v[0].subject_code === B.code && v[0].meta.role === 'organiser', 'the revoke is recorded');
  ok(!JSON.stringify(r.data).match(new RegExp(A.id + '|' + B.id)), 'the read shows friend codes, no user ids');
  r = await A.c.rpc('admin_audit_events', { p_limit: 5, p_action: 'role.revoke' });
  ok(!r.error && r.data.length >= 1 && r.data.every((e) => e.action === 'role.revoke'), 'the action filter works');

  // the deployed delete-account function: wrong word, then the real deletion of the second user
  let f = await B.c.functions.invoke('delete-account', { body: { confirm: 'nope' } });
  ok(f.error && f.response?.status === 400, 'delete-account refuses a wrong confirmation (400)');
  f = await B.c.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
  ok(!f.error && f.data?.status === 'deleted', 'delete-account deletes the second user');
  const bGone = (await admin.auth.admin.getUserById(B.id)).data?.user ?? null;
  ok(bGone === null, 'the sign-in record of the second user is gone');
  ok((await tombstones()) === t0 + 1, 'one profile.delete tombstone was added');
  r = await A.c.rpc('admin_audit_events', { p_limit: 20 });
  const afterB = (r.data ?? []).filter((e) => e.actor_code === A.code);
  ok(afterB.length === 2 && afterB.every((e) => e.subject_code === null), 'the grant and revoke remain, and the deleted person now shows as empty');
  const raw = (await admin.from('audit_events').select('*').or(`actor.eq.${B.id},subject.eq.${B.id}`)).data ?? [];
  ok(raw.length === 0, 'no audit row references the deleted user any more (service-role read-back)');
  const tomb = (await admin.from('audit_events').select('*').eq('action', 'profile.delete').order('id', { ascending: false }).limit(1)).data?.[0];
  ok(tomb && tomb.actor === null && tomb.subject === null && tomb.ref === null && JSON.stringify(tomb.meta) === '{}', 'the tombstone holds no actor, subject, reference or data');

  // the administrator leaves too: roles go with the account, references are forgotten
  f = await A.c.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
  ok(!f.error && f.data?.status === 'deleted', 'delete-account deletes the administrator');
  const rawA = (await admin.from('audit_events').select('id').or(`actor.eq.${A.id},subject.eq.${A.id}`)).data ?? [];
  ok(rawA.length === 0 && (await tombstones()) === t0 + 2, 'nothing names the administrator, and a second tombstone was added');
  const left = (await admin.from('audit_events').select('id,action').in('action', ['role.grant', 'role.revoke']).is('actor', null).is('subject', null).order('id', { ascending: false }).limit(2)).data ?? [];
  ok(left.length === 2, 'the grant and the revoke remain in the table, anonymised');
} catch (e) {
  console.log('FAIL  ' + e.message);
} finally {
  for (const u of made) { try { await admin.auth.admin.deleteUser(u.id); } catch { /* already gone */ } }
  for (const u of made) { try { await admin.from('app_roles').delete().eq('user_id', u.id); } catch { /* cascaded */ } }
  const gone = [];
  for (const u of made) gone.push((await admin.auth.admin.getUserById(u.id)).data?.user ? 'still there' : 'gone');
  console.log('cleanup: throwaway users ' + gone.join(', '));
}
