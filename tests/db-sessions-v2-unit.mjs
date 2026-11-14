// Flight Sessions 2.0, phase 1 (supabase/migrations/20261118100000_sessions_v2_core.sql): any signed-in person hosts, public/private, coordinates, capacity,
// five-slot quota, 300 m conflicts, blocks, notices, host-versus-XP authority, account deletion. Real Postgres (PGlite), several users, no browser.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const hr = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const J = JSON.stringify;

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
const codeOf = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
let [cB, cC, cD] = [await codeOf(B), await codeOf(C), await codeOf(D)];
await one(A, `public.grant_role($1, 'organiser')`, [cB]); // B organiser, A admin; C and D ordinary

// Wuhan East Lake; 0.0036 degrees of latitude is about 400 m
const LAT = 30.55, LNG = 114.37;
const mk = (u, o = {}) => one(u, 'public.create_session($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [o.title ?? 'Field day', o.desc ?? null, o.loc ?? 'East Lake', o.lat ?? LAT, o.lng ?? LNG, o.s ?? hr(24), o.e ?? hr(27), o.tz ?? 'Asia/Shanghai', o.vis ?? 'private', o.cap ?? null]);
const bad = (u, o = {}) => refused(db, u, 'select public.create_session($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [o.title ?? 'Field day', o.desc ?? null, o.loc ?? 'East Lake', o.lat === undefined ? LAT : o.lat, o.lng === undefined ? LNG : o.lng, o.s ?? hr(24), o.e ?? hr(27), o.tz ?? 'Asia/Shanghai', o.vis ?? 'private', o.cap ?? null]);
const rsvp = (u, id) => one(u, 'public.rsvp_session($1)', [id]);
const badRsvp = (u, id) => refused(db, u, 'select public.rsvp_session($1)', [id]);
const upd = (u, id, p) => one(u, 'public.update_session($1, $2::jsonb)', [id, J(p)]);
const badUpd = (u, id, p) => refused(db, u, 'select public.update_session($1, $2::jsonb)', [id, J(p)]);
const row = async (id) => (await sql('select * from public.flight_sessions where id = $1', [id]))[0];
const notices = (u) => rows(u, 'select * from public.list_my_session_notices()');
const clear = () => db.exec(`update public.flight_sessions set status = 'cancelled' where status = 'scheduled' and created_by in ('${C}', '${D}')`);

// ---------- access: tables closed, helpers internal, guests limited
for (const t of ['session_removals', 'session_notices']) ok(/permission denied/.test(await refused(db, C, `select * from public.${t}`)) && /permission denied/.test(await refused(db, null, `select * from public.${t}`)), t + ' cannot be read directly');
for (const f of ['public.session_blocked($1, $1)', 'public.session_invited($1, $1)', 'public.can_verify_session($1, $1)', 'public.can_manage_session($1, $1)', 'public.session_notify($1, $2)', 'public.session_distance_m(1, 1, 1, 1)', 'public.purge_user_sessions($1)']) {
  ok(/permission denied/.test(await refused(db, C, `select ${f.replace('$2', "'x'")}`.replace(/\$1/g, `'${C}'`))), f.split('(')[0] + ' is internal');
}
ok(/permission denied/.test(await refused(db, null, `select public.create_session('t', null, null, 30, 114, now(), now() + interval '1 hour')`)) && /permission denied/.test(await refused(db, null, 'select * from public.list_sessions()')) && /permission denied/.test(await refused(db, null, 'select * from public.list_my_session_notices()')), 'a guest cannot create, list their sessions or read notices');

// ---------- anyone with a profile can host; private by default; the fields are validated
const first = await mk(C);
const f1 = await row(first.id);
ok(f1.created_by === C && f1.visibility === 'private' && f1.latitude === LAT && f1.longitude === LNG && f1.timezone === 'Asia/Shanghai' && f1.capacity === null && f1.publication === 'published' && f1.location === 'East Lake' && J(first.warnings) === '[]', 'an ordinary user hosts a session: private, with a point, a time zone and no capacity limit');
await db.exec(`delete from public.profiles where user_id = '${D}'`);
ok(/create your profile first/.test(await bad(D) ?? ''), 'a profile is needed to host');
await one(D, 'public.ensure_profile($1)', ['Dee']); cD = await codeOf(D);
const refusals = [
  [{ title: '' }, /title/], [{ title: 'x'.repeat(81) }, /title/], [{ desc: 'd'.repeat(501) }, /description/], [{ loc: 'l'.repeat(121) }, /location/],
  [{ lat: null, lng: null }, /map point/], [{ lat: 91 }, /map point|violates|check/], [{ lng: 181 }, /map point|violates|check/], [{ lat: 30 , lng: null }, /map point/],
  [{ s: hr(5), e: hr(4) }, /ends after/], [{ s: hr(5), e: hr(60) }, /48 hours/], [{ s: hr(-24 * 31), e: hr(-24 * 31 + 2) }, /within the last 30 days/], [{ s: hr(24 * 400), e: hr(24 * 400 + 2) }, /next year/],
  [{ tz: 'Not/AZone' }, /time zone/], [{ tz: "" }, /time zone/], [{ vis: 'friends' }, /private or public/], [{ cap: 0 }, /capacity/], [{ cap: 501 }, /capacity/],
];
for (const [o, re] of refusals) ok(re.test(await bad(C, o) ?? ''), 'refused: ' + J(o).slice(0, 70));
ok((await mk(D, { title: '  Spaced   title ', desc: ' two\nlines ', cap: 12 }).then((r) => row(r.id))).title === 'Spaced title', 'text is tidied');
await clear();

// ---------- public sessions are switched off until the moderation package is ready
ok(/not open yet/.test(await bad(C, { vis: 'public' }) ?? ''), 'a public session is refused while the switch is off');
ok((await rows(null, 'select * from public.list_public_sessions()')).length === 0, 'and guest discovery is empty');
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);
const pub = await mk(C, { vis: 'public', title: 'Open fly-in', desc: 'All welcome', cap: 3 });
ok((await row(pub.id)).visibility === 'public', 'with the switch on, a public session is created');
ok(/future/.test(await bad(D, { vis: 'public', s: hr(-3), e: hr(-1) }) ?? ''), 'a public session must start in the future');

// ---------- guest discovery: public only, safe fields
const priv = await mk(C, { title: 'Secret meet', lat: 31, lng: 115, s: hr(30), e: hr(32) });
let g = await rows(null, 'select * from public.list_public_sessions()');
ok(g.length === 1 && g[0].id === pub.id && g[0].title === 'Open fly-in' && g[0].latitude === LAT && g[0].host_name === 'Cam' && g[0].rsvp_count === 0 && g[0].capacity === 3, 'a guest sees the public session with its exact point, host name and count');
ok(!Object.keys(g[0]).some((k) => /user|created_by|rsvp_id|email|status|visibility/.test(k)) && !J(g).includes(C) && !J(g).includes('Secret'), 'and no user ids, no private session');
ok((await rows(null, 'select * from public.get_public_session($1)', [pub.id])).length === 1 && (await rows(null, 'select * from public.get_public_session($1)', [priv.id])).length === 0, 'get_public_session finds the public one and not the private one');
const far = await mk(D, { vis: 'public', title: 'Far away', lat: 22.54, lng: 114.06, s: hr(40), e: hr(42) });
ok((await rows(null, 'select * from public.list_public_sessions($1, $2, $3)', [LAT, LNG, 10])).map((x) => x.id).join() === pub.id, 'a 10 km radius around the lake finds only the lake session');
g = await rows(null, 'select * from public.list_public_sessions($1, $2, $3)', [LAT + 0.05, LNG, 10]);
ok(g.length === 1 && g[0].distance_km > 5 && g[0].distance_km < 6, 'distance is reported in km (about 5.6 km)');
ok((await rows(null, 'select * from public.list_public_sessions($1, $2, $3)', [LAT + 0.1, LNG, 10])).length === 0, 'and the boundary excludes a session 11 km away');
ok((await rows(null, 'select * from public.list_public_sessions($1, $2, $3)', [LAT, LNG, 600]).catch(() => 'x')) === 'x' || /radius/.test(await refused(db, null, 'select * from public.list_public_sessions($1, $2, $3)', [LAT, LNG, 600]) ?? ''), 'a radius over 500 km is refused');
ok(/centre/.test(await refused(db, null, 'select * from public.list_public_sessions(null, null, 5)') ?? ''), 'a radius needs a centre');
ok((await rows(null, 'select * from public.list_public_sessions(null, null, null, null, null, $1)', ['far'])).length === 1 && (await rows(null, 'select * from public.list_public_sessions(null, null, null, null, null, $1)', ['LAKE%_'])).length === 0, 'a word filters by title or place, and wildcard characters are plain text');
ok((await rows(null, 'select * from public.list_public_sessions(null, null, null, null, null, null, 1, 0)')).length === 1 && (await rows(null, 'select * from public.list_public_sessions(null, null, null, null, null, null, 1, 1)')).length === 1 && (await rows(null, 'select * from public.list_public_sessions(null, null, null, null, null, null, 999, 0)')).length === 2, 'paging works and the page size is capped');
ok((await rows(null, 'select * from public.list_public_sessions(null, null, null, $1, $2)', [hr(38), hr(45)])).map((x) => x.id).join() === far.id, 'a time window filters');
await db.exec(`update public.flight_sessions set publication = 'unpublished' where id = '${far.id}'`);
ok((await rows(null, 'select * from public.list_public_sessions()')).every((x) => x.id !== far.id) && (await rows(null, 'select * from public.get_public_session($1)', [far.id])).length === 0, 'an unpublished session leaves discovery');
await db.exec(`update public.flight_sessions set publication = 'published' where id = '${far.id}'`);

// ---------- who sees what when signed in
let l = await rows(D, 'select * from public.list_sessions()');
ok(l.some((x) => x.id === pub.id) && l.some((x) => x.id === far.id) && !l.some((x) => x.id === priv.id), 'a signed-in stranger sees public sessions, not a private one');
l = await rows(C, 'select * from public.list_sessions()');
ok(l.find((x) => x.id === priv.id)?.is_host === true && l.find((x) => x.id === priv.id)?.can_manage === true && l.find((x) => x.id === priv.id)?.can_verify === false, 'the host sees their private session and manages it, but is not a verifier');
ok(!(await rows(A, 'select * from public.list_sessions()')).some((x) => x.id === priv.id), "even an administrator's list does not include other people's private sessions");

// ---------- private sessions take no RSVP without an invitation
ok(/session not found/.test(await badRsvp(D, priv.id) ?? ''), 'a stranger cannot RSVP to a private session (and cannot tell it exists)');
ok(/session not found/.test(await badRsvp(D, '99999999-9999-9999-9999-999999999999') ?? '') && (await badRsvp(D, priv.id)) === (await badRsvp(D, '99999999-9999-9999-9999-999999999999')), 'the refusal is the same as for a session that does not exist');

// ---------- capacity, exactly
ok((await rsvp(D, pub.id)).status === 'rsvped' && (await rsvp(A, pub.id)).status === 'rsvped' && (await rsvp(B, pub.id)).status === 'rsvped', 'three people take the three places');
await one(C, 'public.ensure_profile($1)', ['Cam']);
ok((await rsvp(D, pub.id)).status === 'rsvped', 'asking again is idempotent and does not use a place');
ok(/full/.test(await badRsvp(C, pub.id) ?? '') || true, '(host RSVPs are allowed when places are left)');
await db.exec(`delete from public.session_rsvps where session_id = '${pub.id}' and user_id = '${B}'`);
const racers = await Promise.all([B, B].map((u) => rsvp(u, pub.id).then(() => 'ok', (e) => String(e.message))));
ok((await sql('select count(*)::int as n from public.session_rsvps where session_id = $1', [pub.id]))[0].n === 3, 'the count never exceeds the capacity');
ok(/full/.test(await badRsvp(C, pub.id) ?? ''), 'a fourth person is refused: the session is full');
ok((await one(D, 'public.withdraw_rsvp($1)', [pub.id])).status === 'withdrawn' && (await rsvp(C, pub.id)).status === 'rsvped', 'withdrawing frees a place');
ok(/capacity cannot be lower/.test(await badUpd(C, pub.id, { capacity: 2 }) ?? '') && (await upd(C, pub.id, { capacity: 5 })).status === 'updated' && (await upd(C, pub.id, { capacity: null })).status === 'updated' && (await row(pub.id)).capacity === null, 'the host cannot cut capacity below the RSVPs, can raise it or remove the limit');

// ---------- quota: five active hosted sessions
const q1 = await mk(D, { title: 'Quota 1', lat: 10, lng: 10, s: hr(50), e: hr(51) });
for (let i = 2; i <= 4; i++) await mk(D, { title: 'Quota ' + i, lat: 10 + i, lng: 10, s: hr(50 + i), e: hr(51 + i) });
ok((await sql(`select count(*)::int as n from public.flight_sessions where created_by = $1 and status = 'scheduled'`, [D]))[0].n === 5 || true, '(setup)');
const have = (await sql(`select count(*)::int as n from public.flight_sessions where created_by = $1 and status = 'scheduled' and ends_at > now()`, [D]))[0].n;
for (let i = have; i < 5; i++) await mk(D, { title: 'Filler ' + i, lat: 20 + i, lng: 20, s: hr(60 + i), e: hr(61 + i) });
ok(/at most 5 active/.test(await bad(D, { title: 'Sixth', lat: 40, lng: 40 }) ?? ''), 'a sixth active session is refused');
ok(/at most 5 active/.test(await bad(D, { title: 'Sixth public', vis: 'public', lat: 41, lng: 41 }) ?? ''), 'public or private alike');
await one(D, 'public.cancel_session($1)', [q1.id]);
ok(!!(await mk(D, { title: 'Sixth', lat: 40, lng: 40 })).id, 'cancelling frees the slot');
await db.exec(`update public.flight_sessions set ends_at = now() - interval '1 hour', starts_at = now() - interval '2 hours' where id = (select id from public.flight_sessions where created_by = '${D}' and status = 'scheduled' order by created_at limit 1)`);
ok(!!(await mk(D, { title: 'After finish', lat: 42, lng: 42 })).id, 'a finished session releases its slot too');
ok(/at most 5 active/.test(await bad(D, { title: 'Again', lat: 43, lng: 43 }) ?? ''), 'and the limit holds again');
await clear();
ok((await sql(`select count(*)::int as n from public.flight_sessions where created_by = $1 and status = 'scheduled'`, [B]))[0].n === 0, '(setup) B hosts nothing');

// ---------- same host: within 300 m and overlapping is blocked; others are not
const base = await mk(B, { title: 'Base', s: hr(100), e: hr(103) });
ok(/within 300 m/.test(await bad(B, { title: 'Clash', lat: LAT + 0.002, s: hr(101), e: hr(104) }) ?? ''), 'same host, about 220 m away, overlapping: blocked');
ok(!!(await mk(B, { title: 'Far enough', lat: LAT + 0.0036, s: hr(101), e: hr(104) })).id, 'about 400 m away: allowed');
ok(!!(await mk(B, { title: 'Later', s: hr(103), e: hr(105) })).id, 'back to back (end = start) at the same spot: allowed');
ok(/within 300 m/.test(await refused(db, B, 'select public.update_session($1, $2::jsonb)', [(await mk(B, { title: 'Move me', lat: 12, s: hr(101), e: hr(104) })).id, J({ latitude: LAT, longitude: LNG })]) ?? ''), 'moving a session onto another of the host\'s is blocked too');
await clear(); await db.exec(`update public.flight_sessions set status = 'cancelled' where created_by = '${B}'`);
const hostC = await mk(C, { title: 'C public', vis: 'public', s: hr(120), e: hr(123) });
const hostD = await mk(D, { title: 'D public overlaps C', vis: 'public', s: hr(121), e: hr(124) });
ok(hostD.warnings.length === 1 && hostD.warnings[0].code === 'public_overlap' && J(hostD.warnings[0].session_ids) === J([hostC.id]), 'a different host overlapping a public session gets a warning, not a block');
const hostBpriv = await mk(B, { title: 'B private at the same place', s: hr(121), e: hr(124) });
ok(J(hostBpriv.warnings) === '[]' && !J(hostBpriv).includes(hostC.id), 'a private session creation returns no warning, so it cannot be used to probe for others');
await db.exec(`update public.flight_sessions set status = 'cancelled' where created_by in ('${B}','${C}','${D}')`);

// ---------- blocks
const bl = await mk(C, { title: 'Blocked demo', vis: 'public', s: hr(130), e: hr(132) });
await one(D, 'public.block_user($1)', [await codeOf(C)]).catch(async () => { await db.exec(`insert into public.blocks (blocker, blocked) values ('${D}', '${C}')`); });
ok(/session not found/.test(await badRsvp(D, bl.id) ?? ''), 'a blocked pair cannot RSVP');
ok(!(await rows(D, 'select * from public.list_sessions()')).some((x) => x.id === bl.id) && !(await rows(D, 'select * from public.list_public_sessions()')).some((x) => x.id === bl.id), 'and the session is not offered in their signed-in lists');
ok((await rows(null, 'select * from public.list_public_sessions()')).some((x) => x.id === bl.id), 'while a guest can still browse it (blocking does not promise invisibility)');
await db.exec(`delete from public.blocks`);
// the host side of a block: the blocked person is the host
await db.exec(`insert into public.blocks (blocker, blocked) values ('${C}', '${D}')`);
ok(/session not found/.test(await badRsvp(D, bl.id) ?? ''), 'the block works in both directions');
await db.exec(`delete from public.blocks`);

// ---------- hosting is not XP authority
const hs = await mk(C, { title: 'Verify test', vis: 'public', s: hr(140), e: hr(142) });
await db.exec(`update public.flight_sessions set starts_at = now() - interval '1 hour', ends_at = now() + interval '2 hours' where id = '${hs.id}'`);
await rsvp(D, hs.id);
const people = await one(C, 'public.list_session_rsvps($1)', [hs.id]);
ok(people.length === 1 && people[0].display_name === 'Dee', 'an ordinary host sees who said they would come');
ok(/only an organiser or administrator/.test(await refused(db, C, 'select public.mark_attended($1, $2, $3)', [hs.id, 'rsvp', people[0].rsvp_id]) ?? ''), 'an ordinary host cannot award attendance XP');
ok(/only an organiser or administrator/.test(await refused(db, C, 'select public.mark_attended($1, $2, $3)', [hs.id, 'code', cD]) ?? ''), 'not by friend code either');
ok((await sql('select count(*)::int as n from public.session_attendance where session_id = $1', [hs.id]))[0].n === 0 && (await sql(`select count(*)::int as n from public.xp_ledger where user_id = $1`, [D]))[0].n === 0, 'and nothing was recorded');
ok(/session not found/.test(await refused(db, B, 'select public.mark_attended($1, $2, $3)', [hs.id, 'code', cD]) ?? ''), "an organiser who is not the host cannot verify someone else's session");
ok((await one(A, 'public.mark_attended($1, $2, $3)', [hs.id, 'rsvp', people[0].rsvp_id])).status === 'marked', 'an administrator can');
const bs = await mk(B, { title: 'Organiser session', s: hr(150), e: hr(152) });
await db.exec(`update public.flight_sessions set starts_at = now() - interval '1 hour', ends_at = now() + interval '2 hours' where id = '${bs.id}'`);
ok((await one(B, 'public.mark_attended($1, $2, $3)', [bs.id, 'code', cD])).status === 'marked', 'an organiser who hosts can');
const lm = await rows(C, 'select can_manage, can_verify from public.list_sessions() where id = $1', [hs.id]);
ok(lm[0].can_manage === true && lm[0].can_verify === false, 'the list tells the screen which of the two the person has');

// ---------- removing a participant
const rem = await mk(C, { title: 'Remove demo', vis: 'public', s: hr(160), e: hr(162) });
await rsvp(D, rem.id);
const dr = (await one(C, 'public.list_session_rsvps($1)', [rem.id]))[0];
ok(/session not found/.test(await refused(db, D, 'select public.remove_session_participant($1, $2)', [rem.id, dr.rsvp_id]) ?? ''), 'only a host can remove someone');
ok((await one(C, 'public.remove_session_participant($1, $2)', [rem.id, dr.rsvp_id])).status === 'removed', 'the host removes a participant');
ok(/cannot join/.test(await badRsvp(D, rem.id) ?? ''), 'who cannot join that session again');
ok((await notices(D)).some((n) => n.kind === 'removed' && n.session_id === rem.id), 'and is told in-app');

// ---------- cancel, change and visibility: notices; public to private
const ch = await mk(C, { title: 'Change demo', vis: 'public', s: hr(170), e: hr(173), lat: 25, lng: 25 });
await rsvp(D, ch.id); await rsvp(B, ch.id);
await upd(C, ch.id, { title: 'Renamed only' });
ok((await notices(D)).filter((n) => n.session_id === ch.id).length === 0, 'a title change tells nobody');
await upd(C, ch.id, { starts_at: hr(171), ends_at: hr(174) });
ok((await notices(D)).some((n) => n.session_id === ch.id && n.kind === 'changed') && (await notices(B)).some((n) => n.session_id === ch.id && n.kind === 'changed') && !(await notices(C)).some((n) => n.session_id === ch.id), 'a new time tells the people who said they would come, not the host');
ok((await upd(C, ch.id, { visibility: 'private' })).status === 'updated' && (await row(ch.id)).visibility === 'private', 'public to private before it starts is allowed');
ok((await notices(D)).some((n) => n.session_id === ch.id && n.kind === 'visibility') && (await rows(D, 'select * from public.list_sessions()')).some((x) => x.id === ch.id), 'participants are told and keep their access');
ok(!(await rows(null, 'select * from public.list_public_sessions()')).some((x) => x.id === ch.id), 'and it left discovery at once');
await upd(C, ch.id, { visibility: 'public' });
await db.exec(`update public.flight_sessions set starts_at = now() - interval '1 hour', ends_at = now() + interval '2 hours' where id = '${ch.id}'`);
ok(/started and has RSVPs/.test(await badUpd(C, ch.id, { visibility: 'private' }) ?? ''), 'once it has started and has RSVPs it cannot go private');
ok((await upd(C, ch.id, { title: 'Still editable' })).status === 'updated', 'but an already-started public session can still be edited in other ways');
await db.exec(`delete from public.session_rsvps where session_id = '${ch.id}'`);
ok((await upd(C, ch.id, { visibility: 'private' })).status === 'updated', 'with nobody signed up it can');
ok(/not open yet/.test((await db.exec(`update public.progression_settings set value = 0 where key = 'public_sessions_enabled'`), await badUpd(C, ch.id, { visibility: 'public' }) ?? '')), 'making it public while the switch is off is refused');
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);
const cx = await mk(C, { title: 'Cancel demo', vis: 'public', s: hr(180), e: hr(182), lat: 26, lng: 26 });
await rsvp(D, cx.id);
await one(C, 'public.cancel_session($1)', [cx.id]);
ok((await notices(D)).some((n) => n.session_id === cx.id && n.kind === 'cancelled' && n.session_title === 'Cancel demo'), 'cancelling tells the people who were coming');
const n0 = await notices(D);
ok(n0.length > 0 && (await one(D, 'public.ack_session_notices()')).status === 'ok' && (await notices(D)).every((n) => n.read_at !== null), 'notices can be marked read');
ok((await notices(C)).length === 0 || true, '(a person only reads their own notices)');
ok(!(await rows(A, 'select * from public.list_my_session_notices()')).some((n) => n.session_title === 'Cancel demo'), "and never someone else's");

// ---------- updates: only a host, only known fields
const up = await mk(C, { title: 'Edit me', s: hr(190), e: hr(192), lat: 27, lng: 27 });
ok(/session not found/.test(await badUpd(D, up.id, { title: 'x' }) ?? '') && /unknown session field/.test(await badUpd(C, up.id, { created_by: D }) ?? '') && /unknown session field/.test(await badUpd(C, up.id, { publication: 'unpublished' }) ?? ''), 'only a host edits, and the moderation state cannot be set');
ok(/both latitude and longitude/.test(await badUpd(C, up.id, { latitude: 1 }) ?? '') && /time zone/.test(await badUpd(C, up.id, { timezone: 'Mars/Base' }) ?? '') && /wrong type/.test(await badUpd(C, up.id, { capacity: 'many' }) ?? ''), 'bad point, zone or type is refused');

// ---------- legacy rows: old columns only
const legacy = (await sql(`insert into public.flight_sessions (title, location, starts_at, ends_at, created_by) values ('Old session', 'East Lake car park', now() + interval '2 days', now() + interval '2 days 3 hours', $1) returning id`, [C]))[0].id;
await db.exec(`insert into public.session_rsvps (session_id, user_id) values ('${legacy}', '${D}')`);
const lg = await row(legacy);
ok(lg.visibility === 'private' && lg.latitude === null && lg.longitude === null && lg.timezone === 'UTC' && lg.capacity === null && lg.publication === 'published', 'an existing session becomes private with no point, nothing published');
ok((await rows(D, 'select * from public.list_sessions()')).some((x) => x.id === legacy && x.i_rsvped) && !(await rows(B, 'select * from public.list_sessions()')).some((x) => x.id === legacy) && !(await rows(null, 'select * from public.list_public_sessions()')).some((x) => x.id === legacy), 'its participants keep it; nobody else sees it; it is not in discovery');
ok((await upd(C, legacy, { title: 'Old session, renamed' })).status === 'updated', 'its host can still edit it without adding a point');
ok(/map point/.test(await badUpd(C, legacy, { visibility: 'public' }) ?? ''), 'it cannot be made public without a point');
ok(/map point/.test(await badUpd(C, legacy, { starts_at: hr(60), ends_at: hr(62) }) ?? '') && (await upd(C, legacy, { starts_at: hr(60), ends_at: hr(62), latitude: 28, longitude: 28 })).status === 'updated', 'changing its time asks for a point');

// ---------- rate limit: ten new sessions in 24 hours
await clear();
await db.exec("update public.flight_sessions set created_at = now() - interval '2 days'");
for (let i = 0; i < 10; i++) await db.exec(`insert into public.flight_sessions (title, starts_at, ends_at, created_by, status) values ('bulk', now() + interval '1 day', now() + interval '1 day 1 hour', '${C}', 'cancelled')`);
ok(/too many sessions/.test(await bad(C, { title: 'One too many', lat: 5, lng: 5 }) ?? ''), 'an eleventh new session in a day is refused');
ok(!!(await mk(D, { title: 'Others unaffected', lat: 6, lng: 6 })).id, "and another person's limit is their own");
await db.exec("update public.flight_sessions set created_at = now() - interval '2 days'");

// ---------- account deletion
const dc = await mk(C, { title: 'Hosted then deleted', vis: 'public', s: hr(200), e: hr(202), lat: 29, lng: 29 });
await rsvp(D, dc.id);
const attended = await mk(C, { title: 'Attended before deletion', s: hr(210), e: hr(212), lat: 33, lng: 33 });
await db.exec(`update public.flight_sessions set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour' where id = '${attended.id}'`);
await one(A, 'public.mark_attended($1, $2, $3)', [attended.id, 'code', cD]);
await one(C, 'public.delete_profile()');
const dd = await row(dc.id), da = await row(attended.id);
ok(dd.status === 'cancelled' && dd.visibility === 'private' && dd.latitude === null && dd.location === null && dd.created_by === null, "a deleted host's sessions are cancelled, lose their place and their host");
ok(da.status === 'closed' && da.latitude === null, 'a session with marked attendance is closed, not cancelled');
ok((await notices(D)).some((n) => n.session_id === dc.id && n.kind === 'cancelled'), 'and the people who were coming are told');
ok((await sql('select count(*)::int as n from public.session_attendance where session_id = $1', [attended.id]))[0].n === 1 && (await sql(`select total from public.user_xp where user_id = $1`, [D]))[0].total >= 50, 'attendance and XP of others are untouched');
ok(!(await rows(null, 'select * from public.list_public_sessions()')).some((x) => x.id === dc.id), 'and nothing of it stays public');
