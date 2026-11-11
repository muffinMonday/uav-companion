// The real Supabase adapter against the hosted dev project, as a throwaway user (created and deleted here). NOT part of the default run: it needs the
// Supabase CLI login and network. Run: node tests/cloud-live.mjs
// The service key is fetched through the CLI into memory for the user admin calls only; it is never printed or written to a file.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdapter } from '../src/sync/supabase.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const url = /VITE_SUPABASE_URL=(\S+)/.exec(env)[1], key = /VITE_SUPABASE_PUBLISHABLE_KEY=(\S+)/.exec(env)[1];
const ref = new URL(url).hostname.split('.')[0];
const service = JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${ref} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()).find((k) => k.name === 'service_role').api_key;
const admin = createClient(url, service, { auth: { persistSession: false } });

const email = `sync-test-${Date.now()}@example.test`, password = randomBytes(18).toString('base64url');
const { data: made, error: e0 } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (e0) { console.log('FAIL  could not create the test user: ' + e0.message); process.exit(1); }
const uid = made.user.id;
try {
  const adapter = await createSupabaseAdapter({ url, key, redirectTo: 'http://localhost/' });
  ok((await adapter.getSession()) === null, 'no session before sign-in');
  const { data: s, error: e1 } = await adapter.client.auth.signInWithPassword({ email, password }); // the app signs in by email link; a test cannot read the mail
  ok(!e1 && s.session && (await adapter.getSession())?.email === email, 'the test user signs in and the adapter sees the session');
  const doc = (n) => ({ v: 1, items: Array.from({ length: n }, (_, i) => ({ id: 'i' + i, name: 'M' + i })), trips: [] });

  ok((await adapter.info()) === null && (await adapter.fetch()) === null, 'before the first save there is no cloud copy');
  let r = await adapter.save(doc(2), null, 'live test', false);
  ok(r.status === 'ok' && r.rev === 1 && r.markers === 2, 'first save: revision 1');
  r = await adapter.save(doc(3), 1, 'live test', false);
  ok(r.status === 'ok' && r.rev === 2, 'second save from revision 1: revision 2');
  r = await adapter.save(doc(9), 1, 'other', false);
  ok(r.status === 'conflict' && r.rev === 2 && r.device === 'live test', 'a stale save is a conflict that names the device');
  const info = await adapter.info();
  ok(info.rev === 2 && typeof info.rev === 'number' && info.markers === 3 && !('doc' in info), 'info reads the current revision (a number) and counts, not the document');
  const full = await adapter.fetch();
  ok(full.doc.items.length === 3 && full.rev === 2, 'fetch reads the document whole');
  const v = await adapter.listVersions();
  ok(v.length === 1 && v[0].rev === 1, 'the replaced revision is listed as a version');
  const rs = await adapter.restore(1);
  ok(rs.status === 'ok' && rs.rev === 3 && rs.markers === 2, 'restoring version 1 gives revision 3');
  // another signed-in user sees nothing of this one
  const { data: other } = await admin.auth.admin.createUser({ email: 'o' + email, password, email_confirm: true });
  const sb2 = createClient(url, key, { auth: { persistSession: false } });
  await sb2.auth.signInWithPassword({ email: 'o' + email, password });
  const seen = await sb2.from('user_data').select('rev');
  ok(!seen.error && seen.data.length === 0, 'a second user sees no rows');
  const direct = await sb2.from('user_data').insert({ user_id: other.user.id, doc: { v: 1 } });
  ok(!!direct.error, 'a direct insert is refused: ' + direct.error?.message);
  await admin.auth.admin.deleteUser(other.user.id);
  // an anonymous visitor
  const anon = createClient(url, key, { auth: { persistSession: false } });
  const an = await anon.from('user_data').select('rev');
  ok(!!an.error || an.data.length === 0, 'an anonymous visitor reads nothing');
  const an2 = await anon.rpc('save_user_data', { p_doc: doc(1) });
  ok(!!an2.error, 'and cannot save: ' + an2.error?.message);
  await adapter.remove();
  ok((await adapter.info()) === null, 'delete_user_data removes the cloud copy');
} finally {
  await admin.auth.admin.deleteUser(uid);
  const { data: left } = await admin.from('user_data').select('user_id').eq('user_id', uid);
  ok(!left?.length, 'the test user and its data are gone');
}
