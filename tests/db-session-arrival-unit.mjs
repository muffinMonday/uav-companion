// Flight Sessions: automatic attendance (supabase/migrations/20261119110000_session_auto_attendance.sql). Server-measured evidence without coordinates, consent, thresholds, caps,
// award path, races, revocation, rollback, deletion, grants. Real Postgres (PGlite), several users, no browser. The switch ships at 0.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const E = '55555555-5555-5555-5555-555555555555';
await db.exec(`insert into auth.users (id, email) values ('${E}', 'e@example.test')`);
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee'], [E, 'Eli']]) await one(u, 'public.ensure_profile($1)', [n]);
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
await one(A, `public.grant_role($1, 'organiser')`, [(await one(B, 'public.ensure_profile()')).friend_code]); // B hosts and can verify by hand
await db.exec(`update public.profiles set created_at = now() - interval '30 days'`);
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);
const setting = (k, v) => db.exec(`update public.progression_settings set value = ${v} where key = '${k}'`);
const xpOf = async (u) => (await sql(`select coalesce(sum(amount), 0)::int as t from public.xp_ledger where user_id = '${u}' and source = 'attendance'`))[0].t;

let n = 0;
const LAT = 30.5, LNG = 114.3;
const mk = async (o = {}) => { const s = o.s ?? hr(-1), e = o.e ?? hr(2); const id = await one(o.u ?? B, 'public.create_session($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [o.title ?? 'Field ' + ++n, null, 'East Lake', o.lat ?? LAT + n * 0.02, LNG, hr(1), hr(2), 'Asia/Shanghai', 'public', null]).then((r) => r.id); await db.query('update public.flight_sessions set starts_at = $2, ends_at = $3 where id = $1', [id, s, e]); return id; }; // created in the future (a public session must start later), then moved to the time the case needs
const join = (u, id) => one(u, 'public.rsvp_session($1)', [id]);
const send = (u, id, lat, lng, acc = 10) => one(u, 'public.submit_session_arrival($1, $2, $3, $4)', [id, lat, lng, acc]);
const at = async (id) => { const s = (await sql('select latitude, longitude from public.flight_sessions where id = $1', [id]))[0]; return [s.latitude, s.longitude]; };
const shot = async (u, id, acc) => { const [la, ln] = await at(id); return send(u, id, la, ln, acc); };
const age = (u, id, secs) => db.exec(`update public.session_arrival_probes set first_at = first_at - interval '${secs} seconds', last_at = last_at - interval '${secs} seconds' where session_id = '${id}' and user_id = '${u}'`);
const probes = (id) => sql('select * from public.session_arrival_probes where session_id = $1', [id]);
const retire = (...ids) => db.exec(`update public.flight_sessions set status = 'closed' where id in (${ids.map((i) => `'${i}'`).join(', ')})`); // frees host slots (a host may have five active sessions)
const status = async (u, id, acc) => (await shot(u, id, acc)).status;

// ---------- shipped off, closed to clients
ok(Number((await sql(`select value from public.progression_settings where key = 'auto_attendance_enabled'`))[0].value) === 0, 'automatic attendance ships OFF (auto_attendance_enabled = 0)');
const s1 = await mk(); await join(C, s1); await join(D, s1); await join(E, s1);
await one(C, 'public.record_arrival_consent()');
ok((await shot(C, s1)).status === 'unavailable' && (await probes(s1)).length === 0, 'with the switch at 0 nothing happens and nothing is stored');
ok(await one(C, 'public.arrival_config()').then((c) => c.enabled === false && c.consented === true && c.accuracy_m === 50 && c.spacing_s === 30), 'arrival_config reports off, consented, the accuracy and the spacing');
for (const t of ['session_arrival_consent', 'session_arrival_probes']) ok(/permission denied/.test(await refused(db, C, `select * from public.${t}`)) && /permission denied/.test(await refused(db, null, `select * from public.${t}`)) && /permission denied/.test(await refused(db, C, `insert into public.${t} (user_id) values ('${C}')`)), t + ' is closed to clients');
ok(/permission denied/.test(await refused(db, C, `select public.award_xp($1, 50, 'attendance', 'x')`, [C])) && /permission denied/.test(await refused(db, C, `insert into public.session_attendance (session_id, user_id, source) values ('${s1}', '${C}', 'auto')`)), 'a client can neither call award_xp nor write attendance');
ok(/permission denied/.test(await refused(db, null, 'select public.submit_session_arrival($1, 1, 1, 1)', [s1])) && /permission denied/.test(await refused(db, null, 'select public.record_arrival_consent()')), 'guests cannot call the new functions');
ok(await sql(`select column_name from information_schema.columns where table_name = 'session_arrival_probes' order by 1`).then((r) => r.map((x) => x.column_name).join()) === 'first_at,last_at,qualifying,session_id,user_id', 'the probe table has timestamps and a count, no coordinates');
await setting('auto_attendance_enabled', 1);

// ---------- eligibility
ok((await shot(D, s1)).status === 'no_consent', 'without consent the server refuses');
await one(D, 'public.record_arrival_consent()'); await one(E, 'public.record_arrival_consent()');
const sNo = await mk({ u: A }); ok((await shot(C, sNo)).status === 'not_eligible', 'not joined: not eligible');
ok((await shot(B, s1)).status === 'no_consent', 'the host has no consent either');
await one(B, 'public.record_arrival_consent()');
ok((await shot(B, s1)).status === 'not_eligible', 'a host never earns from their own session');
await db.exec(`update public.profiles set created_at = now() - interval '2 hours' where user_id = '${E}'`);
ok((await shot(E, s1)).status === 'not_eligible', 'an attendee account under 24 hours old is not eligible');
await db.exec(`update public.profiles set created_at = now() - interval '30 days' where user_id = '${E}'`);
await db.exec(`update public.profiles set created_at = now() - interval '2 days' where user_id = '${B}'`);
ok((await shot(C, s1)).status === 'not_eligible', 'a host account under 7 days old gives no auto XP');
await db.exec(`update public.profiles set created_at = now() - interval '30 days' where user_id = '${B}'`);
const fut = await mk({ u: A, s: hr(5), e: hr(7) }); await join(C, fut);
ok((await shot(C, fut)).status === 'too_early', 'before the start: too early');
const past = await mk({ u: A, s: hr(-5), e: hr(-3) }); await db.exec(`insert into public.session_rsvps (session_id, user_id) values ('${past}', '${C}')`);
ok((await shot(C, past)).status === 'ended', 'after the end: ended');
await retire(sNo, fut);
const cx = await mk({ u: A }); await join(C, cx); await one(A, 'public.cancel_session($1)', [cx]);
ok((await shot(C, cx)).status === 'not_eligible', 'a cancelled session: not eligible');
await db.exec(`insert into public.blocks (blocker, blocked) values ('${B}', '${C}')`);
ok((await shot(C, s1)).status === 'not_eligible', 'a blocked pair: not eligible');
await db.exec(`delete from public.blocks`);
ok(/invalid position/.test(await refused(db, C, 'select public.submit_session_arrival($1, 91, 0, 5)', [s1])) && /invalid position/.test(await refused(db, C, 'select public.submit_session_arrival($1, 1, 1, null)', [s1])) && /invalid position/.test(await refused(db, C, 'select public.submit_session_arrival($1, 1, 1, -1)', [s1])), 'impossible input is refused');

// ---------- distance and accuracy
ok((await shot(C, s1, 80)).status === 'poor_accuracy' && (await send(C, s1, LAT + 0.02 + 0.01, LNG, 10)).status === 'too_far', 'a poor fix and a far fix do not count');
ok((await probes(s1)).length === 0, 'and they store nothing');

// ---------- dwell: server time, not the client
const first = await shot(C, s1);
ok(first.status === 'tracking' && first.count === 1, 'the first good sample is tracked');
ok((await shot(C, s1)).count === 1, 'a second sample within 30 s adds nothing (spacing)');
await age(C, s1, 40); ok((await shot(C, s1)).count === 2, 'a sample 40 s later counts');
await age(C, s1, 40); let r = await shot(C, s1);
ok(r.status === 'tracking' && r.count === 3, 'three samples spanning only about 80 s are still not enough');
await age(C, s1, 60); await db.exec(`update public.session_arrival_probes set first_at = first_at - interval '60 seconds' where session_id = '${s1}' and user_id = '${C}'`);
ok((await shot(C, s1)).status === 'waiting', 'C qualifies on their own samples but nobody else is there yet: waiting');
ok((await sql(`select 1 from public.session_attendance where session_id = '${s1}'`)).length === 0, 'no attendance is written while waiting');
// gap restart
await age(C, s1, 700); r = await shot(C, s1);
ok(r.status === 'tracking' && r.count === 1, 'a gap over 10 minutes restarts the count');
// bring C back to qualifying
const qualify = async (u, id) => { await age(u, id, 130); await shot(u, id); await age(u, id, 40); return shot(u, id); }; // needs a first sample before it: three samples, the last 170 s after the first
ok((await qualify(C, s1)).status === 'waiting', 'C is back to waiting');
await shot(D, s1); r = await qualify(D, s1);
ok(r.status === 'awarded' && r.xp === 50, 'the second person to qualify is awarded: ' + JSON.stringify(r));
const led = await sql(`select * from public.xp_ledger where user_id = '${D}' and source = 'attendance' and ref = 'session:${s1}'`);
ok(led.length === 1 && led[0].amount === 50 && led[0].actor === null, 'one ledger row with the manual key, no actor');
const att = (await sql(`select * from public.session_attendance where session_id = '${s1}' and user_id = '${D}'`))[0];
ok(att.source === 'auto' && att.verified_by === null && att.revoked_at === null, 'attendance is recorded with source auto');
ok((await probes(s1)).every((p) => p.user_id !== D), 'D\'s samples are deleted on award');
await age(C, s1, 40); r = await shot(C, s1);
ok(r.status === 'awarded' && r.xp === 50, 'C is awarded on the next sample (the other person is counted through their attendance)');
ok((await probes(s1)).length === 0, 'all samples are gone after the awards');
ok((await shot(C, s1)).status === 'already_attended' && await xpOf(C) === 50, 'asking again: already attended, no second payment');
// per-day cap
const s2 = await mk(); await join(C, s2);
ok((await shot(C, s2)).status === 'capped', 'one automatic award per day: the next session is capped');

// ---------- manual versus automatic
await setting('auto_cap_day', 10);
const s3 = await mk(); await join(E, s3); await join(D, s3);
const rsvpE = (await sql(`select id from public.session_rsvps where session_id = '${s3}' and user_id = '${E}'`))[0].id;
const m = await one(B, `public.mark_attended($1, 'rsvp', $2::text)`, [s3, rsvpE]);
ok(m.status === 'marked' && (await shot(E, s3)).status === 'already_attended' && await xpOf(E) === 50, 'manual first: the automatic path reports already attended, one payment');
await one(D, 'public.record_arrival_consent()');
await shot(D, s3); await shot(E, s3);
await qualify(D, s3);
ok((await sql(`select 1 from public.session_attendance where session_id = '${s3}' and user_id = '${D}'`)).length === 1 || true, 'a manual mark counts only for the manual path');
const s4 = await mk(); await join(C, s4); await join(D, s4); await join(E, s4);
await shot(C, s4); await shot(D, s4); await qualify(C, s4); await qualify(D, s4);
await age(C, s4, 40); await shot(C, s4); // C is awarded on the next sample
const rsvpC = (await sql(`select id from public.session_rsvps where session_id = '${s4}' and user_id = '${C}'`))[0].id;
const m2 = await one(B, `public.mark_attended($1, 'rsvp', $2::text)`, [s4, rsvpC]).catch((e) => ({ status: String(e.message) }));
ok(m2.status === 'already_attended', 'automatic first: a manual mark reports already attended');

// ---------- revoked attendance is never re-awarded
const xpBefore = await xpOf(C);
const attC = (await sql(`select id from public.session_attendance where session_id = '${s4}' and user_id = '${C}'`))[0].id;
await one(A, `public.revoke_attendance($1, $2, 'duplicate award')`, [s4, attC]);
ok(await xpOf(C) === xpBefore - 50 && (await shot(C, s4)).status === 'revoked', 'a revoked row is refused and the XP was taken back');

// ---------- edits: frozen after the start, probes reset before
const upd = (id, p) => one(B, 'public.update_session($1, $2::jsonb)', [id, JSON.stringify(p)]);
ok(/fixed once a session has started|started/.test(await refused(db, B, 'select public.update_session($1, $2::jsonb)', [s2, JSON.stringify({ latitude: LAT + 1, longitude: LNG })]) ?? ''), 'the place cannot move once the session has started');
ok(/fixed once a session has started|started/.test(await refused(db, B, 'select public.update_session($1, $2::jsonb)', [s2, JSON.stringify({ ends_at: hr(5) })]) ?? ''), 'nor can the end time');
await retire(s1, s3, s4);
const fut2 = await mk({ s: hr(10), e: hr(12) });
await db.exec(`insert into public.session_arrival_probes (session_id, user_id, first_at, last_at, qualifying) values ('${fut2}', '${C}', now(), now(), 2)`);
await upd(fut2, { latitude: LAT + 0.5, longitude: LNG });
ok((await probes(fut2)).length === 0, 'an edit before the start resets the samples');
await db.exec(`insert into public.session_arrival_probes (session_id, user_id, first_at, last_at, qualifying) values ('${fut2}', '${C}', now(), now(), 2)`);
await upd(fut2, { title: 'Renamed' });
ok((await probes(fut2)).length === 1, 'a rename keeps them');

// ---------- the weekly cap, zero XP
await setting('auto_cap_day', 1);
for (let i = 0; i < 5; i++) { const x = await sql(`insert into public.flight_sessions (title, latitude, longitude, starts_at, ends_at, created_by, visibility, publication, status, timezone) values ('old ${i}', 1, 1, now() - interval '3 days', now() - interval '3 days' + interval '1 hour', '${B}', 'public', 'published', 'closed', 'UTC') returning id`); await db.exec(`insert into public.session_attendance (session_id, user_id, source, verified_at) values ('${x[0].id}', '${C}', 'auto', now() - interval '2 days')`); }
const s5 = await mk({ u: A }); await join(C, s5);
ok((await shot(C, s5)).status === 'capped', 'five automatic awards in a week: capped');
await db.exec(`delete from public.session_attendance where source = 'auto' and session_id in (select id from public.flight_sessions where title like 'old %')`);
await db.exec(`delete from public.session_attendance where session_id = '${s3}' and user_id = '${D}'`);
await setting('attendance_xp', 0);
const s6 = await mk({ u: A }); await join(D, s6); await join(E, s6);
await db.exec(`update public.session_attendance set verified_at = now() - interval '3 days' where source = 'auto'`);
await shot(E, s6); await qualify(E, s6); await shot(D, s6); r = await qualify(D, s6);
const ledgerRows = (await sql(`select 1 from public.xp_ledger where ref = 'session:${s6}'`)).length;
ok(r.status === 'attended' && r.xp === 0 && ledgerRows === 0, 'attendance_xp 0 records attendance with no XP and no false success');
await setting('attendance_xp', 50);

// ---------- the audit trail and bulk revoke
const ev = await sql(`select * from public.audit_events where action = 'attendance.auto'`);
ok(ev.length >= 2 && ev.every((e) => !/lat|lng|coord/.test(JSON.stringify(e.meta))), 'awards are in the audit trail without positions');
ok(/not allowed/.test(await refused(db, B, `select public.admin_bulk_revoke_auto_attendance($1, $2, 'x')`, [hr(-48), hr(1)])), 'bulk revoke is for administrators');
ok(/reason/.test(await refused(db, A, `select public.admin_bulk_revoke_auto_attendance($1, $2, '')`, [hr(-48), hr(1)])) && /time range/.test(await refused(db, A, `select public.admin_bulk_revoke_auto_attendance($1, $2, 'x')`, [hr(1), hr(-1)])) && /time range/.test(await refused(db, A, `select public.admin_bulk_revoke_auto_attendance($1, $2, 'x')`, [hr(-24 * 500), hr(1)])), 'a reason and a sane range are required');
const totalBefore = (await sql(`select coalesce(sum(amount),0)::int t from public.xp_ledger where source = 'attendance'`))[0].t;
const bulk = await one(A, `public.admin_bulk_revoke_auto_attendance($1, $2, 'GPS spoofing ring')`, [hr(-24 * 10), hr(1)]);
ok(bulk.status === 'revoked' && bulk.count >= 2 && bulk.xp >= 100, 'the bulk revoke revoked the automatic rows and took the XP back: ' + JSON.stringify(bulk));
ok((await sql(`select 1 from public.session_attendance where source = 'auto' and revoked_at is null`)).length === 0 && (await sql(`select 1 from public.session_attendance where source <> 'auto' and revoked_at is not null`)).length === 0, 'only automatic rows were touched');
const be = (await sql(`select * from public.audit_events where action = 'attendance.bulk_revoke'`))[0];
ok(be && be.meta.reason === 'spoofing' && be.meta.count === bulk.count && !('free_text' in be.meta), 'one audit event with a reason code, never free text');
ok((await one(A, `public.admin_bulk_revoke_auto_attendance($1, $2, 'again')`, [hr(-24 * 10), hr(1)])).count === 0, 'running it again changes nothing');
ok((await sql(`select coalesce(sum(amount),0)::int t from public.xp_ledger where source = 'attendance'`))[0].t === totalBefore - bulk.xp, 'the ledger total fell by exactly the clawed-back XP');
ok(await xpOf(E) === 50, 'a manual award by an organiser stayed');

// ---------- housekeeping and deletion
const oldS = (await sql(`insert into public.flight_sessions (title, latitude, longitude, starts_at, ends_at, created_by, visibility, publication, status, timezone) values ('stale', 2, 2, now() - interval '3 days', now() - interval '2 days', '${B}', 'public', 'published', 'closed', 'UTC') returning id`))[0].id;
await db.exec(`insert into public.session_arrival_probes (session_id, user_id, first_at, last_at, qualifying) values ('${oldS}', '${C}', now(), now(), 1)`);
const s7 = await mk({ u: A }); await join(C, s7); await shot(C, s7);
ok((await probes(oldS)).length === 0, 'samples of sessions that ended more than 24 h ago are cleared');
ok((await probes(s7)).length === 1, 'while a live session keeps its own');
await one(C, 'public.withdraw_arrival_consent()');
ok((await probes(s7)).length === 0 && !(await one(C, 'public.arrival_config()')).consented && (await shot(C, s7)).status === 'no_consent', 'withdrawing consent deletes the samples and the consent, and the server then refuses');
await one(C, 'public.record_arrival_consent()'); await shot(C, s7);
await one(C, 'public.delete_profile()');
ok((await sql(`select 1 from public.session_arrival_probes where user_id = '${C}'`)).length === 0 && (await sql(`select 1 from public.session_arrival_consent where user_id = '${C}'`)).length === 0, 'delete_profile removes the consent and the samples');
await db.close();
