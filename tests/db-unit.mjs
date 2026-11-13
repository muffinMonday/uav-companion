// The cloud tables and their access rules, tested on a real Postgres (PGlite) with the roles Supabase uses. No browser, no network, no Docker.
import { makeDb, as, refused, save, doc, A, B, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();

// ---------- nobody signed in
ok(/permission denied/.test(await refused(db, null, 'select * from public.user_data')), 'a visitor who is not signed in cannot read the table');
ok(/permission denied/.test(await refused(db, null, 'select public.save_user_data($1::jsonb)', [JSON.stringify(doc())])), 'nor save through the function');
ok(/permission denied/.test(await refused(db, null, 'select * from public.list_user_data_versions()')), 'nor list versions');
ok(/permission denied/.test(await refused(db, null, 'select * from public.user_data_versions')), 'nor read the versions table');

// ---------- what the API roles may reach
const priv = (await db.query(`select has_function_privilege('anon','public.save_user_data(jsonb,bigint,text,boolean)','execute') as anon_save, has_function_privilege('authenticated','public.save_user_data(jsonb,bigint,text,boolean)','execute') as user_save, has_function_privilege('anon','public.rls_auto_enable()','execute') as anon_auto, has_function_privilege('authenticated','public.rls_auto_enable()','execute') as user_auto, has_table_privilege('authenticated','public.user_data','select') as user_read, has_table_privilege('authenticated','public.user_data','update') as user_write`)).rows[0];
ok(!priv.anon_save && priv.user_save, 'only signed-in users may execute the save function');
ok(priv.user_read && !priv.user_write, 'a signed-in user may read the table and not write to it');
ok(!priv.anon_auto && !priv.user_auto, 'the rls_auto_enable function that "Automatic RLS" adds is not reachable through the API roles');

// ---------- the first save, and who sees it
let r = await save(db, A, doc(3, 1), null, 'Chrome on Windows');
ok(r.status === 'ok' && r.rev === 1 && r.markers === 3 && r.trips === 1 && r.device === 'Chrome on Windows', 'the first save creates revision 1 with the counts: ' + JSON.stringify(r));
ok((await as(db, A, 'select rev, markers from public.user_data')).length === 1, 'the user reads their own row');
ok((await as(db, B, 'select * from public.user_data')).length === 0, 'another user sees no rows at all');
ok((await as(db, A, 'select doc from public.user_data'))[0].doc.items.length === 3, 'and the document comes back intact');

// ---------- the direct route is closed
for (const [what, sql] of [['insert', `insert into public.user_data (user_id, doc) values ('${B}', '{"v":1}')`], ['update', `update public.user_data set rev = 99 where user_id = '${A}'`], ['delete', `delete from public.user_data where user_id = '${A}'`], ['insert into versions', `insert into public.user_data_versions (user_id, rev, doc, updated_at) values ('${A}', 7, '{"v":1}', now())`]]) {
  ok(/permission denied/.test(await refused(db, A, sql)), 'a signed-in user cannot ' + what + ' directly');
}
ok((await as(db, A, 'select rev from public.user_data'))[0].rev === 1, 'the row is untouched by those attempts');

// ---------- revisions and conflicts
r = await save(db, A, doc(4, 1), 1, 'phone');
ok(r.status === 'ok' && r.rev === 2 && r.markers === 4, 'a save from the current revision becomes revision 2');
r = await save(db, A, doc(9, 9), 1, 'laptop');
ok(r.status === 'conflict' && r.rev === 2 && r.markers === 4 && r.device === 'phone' && typeof r.updated_at === 'string', 'a save from an older revision is refused and says what the cloud holds: ' + JSON.stringify(r));
ok((await as(db, A, 'select markers from public.user_data'))[0].markers === 4, 'and the cloud copy is unchanged');
r = await save(db, A, doc(9, 9), null, 'laptop');
ok(r.status === 'conflict', 'a device that never synced (no base revision) also hits the conflict when a cloud copy exists');
r = await save(db, A, doc(7, 2), 1, 'laptop', true);
ok(r.status === 'ok' && r.rev === 3 && r.markers === 7, 'overwriting on purpose works and becomes revision 3');
let versions = await as(db, A, 'select * from public.list_user_data_versions()');
ok(versions.map((v) => Number(v.rev)).join() === '2,1' && versions[0].device === 'phone', 'the earlier versions are kept, newest first: ' + versions.map((v) => '#' + v.rev + ' ' + v.device).join(', '));
ok((await as(db, B, 'select * from public.list_user_data_versions()')).length === 0, 'another user sees none of them');

// ---------- restoring
r = (await as(db, A, 'select public.restore_user_data_version(1) as r'))[0].r;
ok(r.status === 'ok' && r.rev === 4 && r.markers === 3 && /restored from version 1/.test(r.device), 'restoring version 1 makes its document the current one, as revision 4');
ok((await as(db, A, 'select * from public.list_user_data_versions()')).length === 3, 'and the restore can itself be undone (the replaced version is kept)');
ok(/no longer exists/.test(await refused(db, A, 'select public.restore_user_data_version(999)')), 'restoring a version that is not there is refused');
ok(/no longer exists/.test(await refused(db, B, 'select public.restore_user_data_version(1)')), 'and one user cannot restore another user\'s version');

// ---------- what a document may be
ok(/must be an object/.test(await refused(db, A, `select public.save_user_data('[1,2]'::jsonb, 4, 'x', true)`)), 'a document that is not an object is refused');
ok(/unsupported document version/.test(await refused(db, A, `select public.save_user_data('{"items":[]}'::jsonb, 4, 'x', true)`)), 'a document without the version marker is refused');
ok(/unsupported document version/.test(await refused(db, A, `select public.save_user_data('{"v":2}'::jsonb, 4, 'x', true)`)), 'and a version this database does not know');
const big = { v: 1, items: [], pad: 'x'.repeat(2100000) };
ok(/too large/.test(await refused(db, A, 'select public.save_user_data($1::jsonb, 4, $2, true)', [JSON.stringify(big), 'x'])), 'a document over about 2 MB is refused');
r = await save(db, A, doc(1), 4, 'd'.repeat(200));
ok(r.status === 'ok' && r.device.length === 80, 'a long device name is cut to 80 characters');
ok((await as(db, A, 'select markers, trips from public.user_data'))[0].markers === 1, 'the counts follow the document');
r = await save(db, A, { v: 1, items: 'not a list', trips: { a: 1 } }, 5);
ok(r.status === 'ok' && r.markers === 0 && r.trips === 0, 'items or trips that are not lists count as none');

// ---------- how many versions are kept, and for how long
for (let i = 0; i < 25; i++) await save(db, A, doc(2, 0, { n: i }), (await as(db, A, 'select rev from public.user_data'))[0].rev, 'loop');
versions = await as(db, A, 'select * from public.list_user_data_versions()');
const cur = Number((await as(db, A, 'select rev from public.user_data'))[0].rev);
ok(versions.length <= 20 && Number(versions[0].rev) === cur - 1 && versions.every((v) => Number(v.rev) > cur - 20), 'at most 20 versions are kept, the newest ones (' + versions.length + ' of them, up to #' + versions[0].rev + ')');
await db.exec(`update public.user_data_versions set updated_at = now() - interval '31 days' where user_id = '${A}' and rev < ${cur - 2}`);
await save(db, A, doc(2, 0, { n: 'again' }), cur, 'loop');
versions = await as(db, A, 'select * from public.list_user_data_versions()');
ok(versions.length === 3, 'versions older than 30 days are dropped at the next save (' + versions.length + ' left)');

// ---------- two users, side by side
r = await save(db, B, doc(5), null, 'B laptop');
ok(r.status === 'ok' && r.rev === 1, 'a second user has their own revision numbering');
ok((await as(db, B, 'select markers from public.user_data')).length === 1 && (await as(db, B, 'select markers from public.user_data'))[0].markers === 5, 'and sees only their own document');
ok((await as(db, A, 'select markers from public.user_data')).length === 1 && (await as(db, A, 'select markers from public.user_data'))[0].markers === 2, 'while the first user\'s is unaffected');

// ---------- deleting my data, and deleting the account
await as(db, A, 'select public.delete_user_data()');
ok((await as(db, A, 'select * from public.user_data')).length === 0 && (await as(db, A, 'select * from public.list_user_data_versions()')).length === 0, 'delete_user_data removes the document and every version');
ok((await as(db, B, 'select * from public.user_data')).length === 1, 'and leaves other users alone');
// ---------- a burst of saves from one device keeps one version, not one per save (version_coalesce)
{
  const vcount = async () => (await as(db, D, 'select * from public.list_user_data_versions()')).length;
  const s1 = await save(db, D, doc(1, 0), null, 'laptop', false, true);
  const s2 = await save(db, D, doc(2, 0), s1.rev, 'laptop', false, true);
  const s3 = await save(db, D, doc(3, 0), s2.rev, 'laptop', false, true);
  ok(s3.status === 'ok' && s3.rev === 3 && await vcount() === 0, 'saves seconds apart from one device keep no version between them (revision 3, no versions)');
  const s4 = await save(db, D, doc(4, 0), s3.rev, 'phone', false, true);
  ok(s4.rev === 4 && await vcount() === 1, 'a save from another device keeps what it replaces');
  const s5 = await save(db, D, doc(5, 0), s4.rev, 'phone', false);
  ok(s5.rev === 5 && await vcount() === 2, 'a save two minutes or more after the last one keeps it');
  const s6 = await save(db, D, doc(6, 0), s5.rev, 'phone', true, true);
  ok(s6.status === 'ok' && await vcount() === 3, 'a forced overwrite always keeps what it replaces');
  await as(db, D, 'select public.delete_user_data()');
}
await db.exec(`delete from auth.users where id = '${B}'`);
ok((await db.query('select count(*)::int as n from public.user_data')).rows[0].n === 0 && (await db.query('select count(*)::int as n from public.user_data_versions')).rows[0].n === 0, 'deleting an account deletes its data too');
await db.close();
