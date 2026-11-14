// Flight Sessions 2.0, phase 3 backend (supabase/migrations/20261118110000_sessions_v2_series_invites.sql): recurrence, occurrence overrides, series edits and
// cancellation, named invitations and private links. Real Postgres (PGlite); times are checked in UTC against the event's own time zone.
import { makeDb, as, refused, A, B, C, D } from './lib-db.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const db = await makeDb();
const one = async (uid, sql, params = []) => (await as(db, uid, `select ${sql} as r`, params))[0].r;
const rows = (uid, sql, params = []) => as(db, uid, sql, params);
const sql = async (q, params = []) => (await db.query(q, params)).rows;
const J = JSON.stringify;
const iso = (d) => new Date(d).toISOString().replace('.000Z', 'Z');

for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
await db.exec(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);
const codeOf = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
let [cA, cB, cD] = [await codeOf(A), await codeOf(B), await codeOf(D)];
await db.exec(`update public.progression_settings set value = 1 where key = 'public_sessions_enabled'`);

const LAT = 30.55, LNG = 114.37;
// next Saturday-ish local date far enough ahead; dates here are fixed in 2027 so DST cases are exact (the harness clock is in 2026)
const ser = (u, o = {}) => one(u, 'public.create_session_series($1, $2, $3, $4, $5, $6::timestamp, $7, $8, $9, $10, $11, $12)',
  [o.title ?? 'Saturday fly', o.desc ?? null, o.loc ?? 'East Lake', o.lat ?? LAT, o.lng ?? LNG, o.at ?? '2027-03-06 14:00', o.mins ?? 120, o.tz ?? 'America/New_York', o.vis ?? 'private', o.cap ?? null, o.freq ?? 'weekly', o.n ?? 4]);
const badSer = (u, o = {}) => refused(db, u, 'select public.create_session_series($1, $2, $3, $4, $5, $6::timestamp, $7, $8, $9, $10, $11, $12)',
  [o.title ?? 'Saturday fly', o.desc ?? null, o.loc ?? 'East Lake', o.lat ?? LAT, o.lng ?? LNG, o.at ?? '2027-03-06 14:00', o.mins ?? 120, o.tz ?? 'America/New_York', o.vis ?? 'private', o.cap ?? null, o.freq ?? 'weekly', o.n ?? 4]);
const occ = async (sid) => (await sql('select id, series_ordinal as n, starts_at, ends_at, status, overridden, title, capacity from public.flight_sessions where series_id = $1 order by series_ordinal', [sid]));
const starts = (o) => o.map((x) => iso(x.starts_at));
const clear = () => db.exec(`update public.flight_sessions set status = 'cancelled' where status = 'scheduled'; update public.flight_sessions set created_at = now() - interval '2 days'`);
const rsvp = (u, id) => one(u, 'public.rsvp_session($1)', [id]);
const badRsvp = (u, id) => refused(db, u, 'select public.rsvp_session($1)', [id]);
const notices = (u) => rows(u, 'select * from public.list_my_session_notices()');

// ---------- access
for (const f of ['public.session_local_instant(now()::timestamp, $$UTC$$)', 'public.session_occurrence_date(current_date, $$weekly$$, 1)', `public.session_invite_target('${A}', $$series$$)`]) ok(/permission denied/.test(await refused(db, C, `select * from ${f}`)), f.split('(')[0] + ' is internal');
for (const t of ['flight_session_series', 'session_invitations', 'session_links']) ok(/permission denied/.test(await refused(db, C, `select * from public.${t}`)) && /permission denied/.test(await refused(db, null, `select * from public.${t}`)), t + ' cannot be read directly');
ok(/permission denied/.test(await refused(db, null, `select public.redeem_session_link('${'a'.repeat(40)}')`)) && /permission denied/.test(await refused(db, null, `select public.create_session_series('t', null, null, 1, 1, now()::timestamp, 60, 'UTC', 'private', null, 'weekly', 4)`)), 'a guest cannot redeem a link or create a series');

// ---------- recurrence dates and DST (America/New_York changes on 2027-03-14 and 2027-11-07)
let r = await ser(C);
let o = await occ(r.series_id);
ok(o.length === 4 && r.ids.length === 4 && o.every((x) => x.status === 'scheduled' && x.title === 'Saturday fly'), 'a weekly series makes four occurrences');
ok(J(starts(o)) === J(['2027-03-06T19:00:00Z', '2027-03-13T19:00:00Z', '2027-03-20T18:00:00Z', '2027-03-27T18:00:00Z']), 'local 14:00 is kept across the daylight-saving change (19:00Z before it, 18:00Z after)');
ok(o.every((x) => iso(x.ends_at) === iso(+x.starts_at + 2 * 3600_000)), 'each occurrence lasts the same two hours');
const se = (await sql('select * from public.flight_session_series where id = $1', [r.series_id]))[0];
ok(se.frequency === 'weekly' && se.occurrences === 4 && se.preferred_day === 6 && se.timezone === 'America/New_York' && se.created_by === C, 'the series row records the rule');
await clear();
o = await occ((await ser(C, { freq: 'biweekly', n: 3 })).series_id);
ok(J(starts(o).map((s) => s.slice(0, 10))) === J(['2027-03-06', '2027-03-20', '2027-04-03']), 'biweekly steps fourteen days');
await clear();
o = await occ((await ser(C, { freq: 'monthly', n: 4, at: '2027-01-31 10:00', tz: 'UTC' })).series_id);
ok(J(starts(o).map((s) => s.slice(0, 10))) === J(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']), 'monthly on the 31st clamps February and April only; March returns to the 31st');
await clear();
o = await occ((await ser(C, { freq: 'monthly', n: 3, at: '2027-01-30 10:00', tz: 'UTC' })).series_id);
ok(J(starts(o).map((s) => s.slice(0, 10))) === J(['2027-01-30', '2027-02-28', '2027-03-30']), 'the 30th clamps February to the 28th');
await clear();
o = await occ((await ser(C, { freq: 'weekly', n: 2, at: '2027-03-07 02:30' })).series_id);
ok(J(starts(o)) === J(['2027-03-07T07:30:00Z', '2027-03-14T07:30:00Z']), 'a time that does not exist (02:30 on 14 March) moves forward to 03:30 local');
await clear();
o = await occ((await ser(C, { freq: 'weekly', n: 2, at: '2027-10-31 01:30' })).series_id);
ok(J(starts(o)) === J(['2027-10-31T05:30:00Z', '2027-11-07T05:30:00Z']), 'an ambiguous time (01:30 on 7 November) takes the first occurrence');
await clear();
o = await occ((await ser(C, { n: 2, at: '2027-03-06 14:00', tz: 'Asia/Shanghai' })).series_id);
ok(J(starts(o)) === J(['2027-03-06T06:00:00Z', '2027-03-13T06:00:00Z']), 'a zone without daylight saving stays fixed');
await clear();

// ---------- validation
for (const [o2, re] of [[{ n: 1 }, /2 to 12/], [{ n: 13 }, /2 to 12/], [{ freq: 'daily' }, /repeat weekly/], [{ mins: 0 }, /48 hours/], [{ mins: 2881 }, /48 hours/], [{ tz: 'Nope/Zone' }, /time zone/], [{ title: '' }, /title/],
                        [{ lat: 999 }, /map point/], [{ cap: 0 }, /capacity/], [{ at: '2020-01-01 10:00' }, /within the last 30 days/], [{ vis: 'public', at: '2020-01-01 10:00' }, /within|future/]]) ok(re.test(await badSer(C, o2) ?? ''), 'refused: ' + J(o2));
ok(/create your profile first/.test(await (async () => { await db.exec(`delete from public.profiles where user_id = '${B}'`); const e = await badSer(B); await one(B, 'public.ensure_profile($1)', ['Bea']); return e; })() ?? ''), 'a series needs a profile');

cB = await codeOf(B);

// ---------- quota: a series is one slot; the sixth active commitment is refused
await clear();
const slotOne = await ser(C, { title: 'Series slot', n: 12, freq: 'weekly', at: '2027-03-06 14:00', tz: 'UTC' });
ok((await occ(slotOne.series_id)).length === 12, 'twelve occurrences make one series');
for (let i = 0; i < 4; i++) await one(C, 'public.create_session($1, null, null, $2, $3, $4, $5)', [`Single ${i}`, 10 + i, 10, new Date(Date.now() + (50 + i) * 3600_000).toISOString(), new Date(Date.now() + (51 + i) * 3600_000).toISOString()]);
ok(/at most 5 active/.test(await badSer(C, { title: 'Another series', at: '2027-06-05 14:00', lat: 1, lng: 1 }) ?? '') && /at most 5 active/.test(await refused(db, C, 'select public.create_session($1, null, null, 5, 5, $2, $3)', ['One more', new Date(Date.now() + 90 * 3600_000).toISOString(), new Date(Date.now() + 91 * 3600_000).toISOString()]) ?? ''), 'four singles and one series fill the five slots, however many occurrences the series has');
await one(C, 'public.cancel_session_series($1)', [(await occ(slotOne.series_id))[0].id]);
ok(!!(await one(C, 'public.create_session($1, null, null, 5, 5, $2, $3)', ['Freed', new Date(Date.now() + 90 * 3600_000).toISOString(), new Date(Date.now() + 91 * 3600_000).toISOString()])).id, 'cancelling the series frees its slot');
await clear();

// ---------- occurrences are independent: RSVP, capacity, edits, cancellation
r = await ser(C, { vis: 'public', cap: 1, at: '2027-03-06 14:00', tz: 'UTC', title: 'Public series' });
o = await occ(r.series_id);
await rsvp(D, o[0].id);
ok((await sql('select count(*)::int as n from public.session_rsvps where session_id = $1', [o[1].id]))[0].n === 0, 'an RSVP is for one occurrence only');
ok(/full/.test(await badRsvp(B, o[0].id) ?? '') && (await rsvp(B, o[1].id)).status === 'rsvped', 'capacity is per occurrence: the first is full, the second still has its place');
let pl = await rows(null, 'select * from public.list_public_sessions()');
ok(pl.filter((x) => x.series_count === 4).length === 4 && pl.find((x) => x.id === o[2].id).series_ordinal === 3, 'public discovery shows each occurrence with its place in the series');
// a one-occurrence edit marks it overridden
await one(C, 'public.update_session($1, $2::jsonb)', [o[1].id, J({ title: 'Second is special' })]);
o = await occ(r.series_id);
ok(o[1].overridden === true && o[0].overridden === false && o[1].title === 'Second is special', 'editing one occurrence marks it overridden');
const res = await one(C, 'public.update_session_series($1, $2::jsonb)', [o[0].id, J({ title: 'Renamed for all', location: 'West Lake' })]);
o = await occ(r.series_id);
ok(res.changed === 3 && o[0].title === 'Renamed for all' && o[2].title === 'Renamed for all' && o[3].title === 'Renamed for all' && o[1].title === 'Second is special', 'a this-and-following edit changes the rest and skips the overridden occurrence');
ok((await sql('select location from public.flight_sessions where id = $1', [o[2].id]))[0].location === 'West Lake', 'including the place');
ok((await notices(D)).some((n) => n.session_id === o[0].id && n.kind === 'changed') && !(await notices(B)).some((n) => n.session_id === o[0].id), 'people with an RSVP to a moved occurrence are told; others are not');
await one(C, 'public.update_session_series($1, $2::jsonb)', [o[2].id, J({ start_time: '16:30', duration_minutes: 90 })]);
o = await occ(r.series_id);
ok(iso(o[2].starts_at) === '2027-03-20T16:30:00Z' && iso(o[3].starts_at) === '2027-03-27T16:30:00Z' && iso(o[2].ends_at) === '2027-03-20T18:00:00Z' && iso(o[0].starts_at) === '2027-03-06T14:00:00Z', 'a time-of-day edit from the third occurrence moves the third and fourth only');
ok(/unknown series field/.test(await refused(db, C, 'select public.update_session_series($1, $2::jsonb)', [o[0].id, J({ visibility: 'private' })]) ?? '') && /session not found/.test(await refused(db, D, 'select public.update_session_series($1, $2::jsonb)', [o[0].id, J({ title: 'x' })]) ?? ''), 'unknown fields and non-hosts are refused');
ok(/capacity cannot be lower/.test(await refused(db, C, 'select public.update_session_series($1, $2::jsonb)', [o[0].id, J({ capacity: 0 })]) ?? '') || /capacity/.test(await refused(db, C, 'select public.update_session_series($1, $2::jsonb)', [o[0].id, J({ capacity: 0 })]) ?? ''), 'a capacity of zero is refused');
// attendance on an occurrence that started is preserved by a series cancellation
await db.exec(`update public.flight_sessions set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour' where id = '${o[0].id}'`);
await one(A, 'public.mark_attended($1, $2, $3)', [o[0].id, 'code', cD]);
await rsvp(D, o[3].id);
const cs = await one(C, 'public.cancel_session_series($1)', [o[0].id]);
o = await occ(r.series_id);
ok(cs.cancelled === 3 && o[0].status === 'scheduled' && o.slice(1).every((x) => x.status === 'cancelled'), 'cancelling the series leaves the occurrence that has attendance and cancels the later ones');
ok((await notices(D)).some((n) => n.session_id === o[3].id && n.kind === 'cancelled'), 'people with an RSVP are told');
ok((await sql('select count(*)::int as n from public.session_attendance where session_id = $1', [o[0].id]))[0].n === 1 && (await sql('select total from public.user_xp where user_id = $1', [D]))[0].total === 50, 'attendance and XP are untouched');
await clear();

// ---------- invitations: named, one occurrence or the whole series
r = await ser(C, { title: 'Private series', at: '2027-04-03 09:00', tz: 'UTC' });
o = await occ(r.series_id);
const lst = (u) => rows(u, 'select id, invited from public.list_sessions()');
ok(!(await lst(D)).some((x) => x.id === o[0].id) && /session not found/.test(await badRsvp(D, o[0].id) ?? ''), 'before an invitation a stranger sees nothing and cannot RSVP');
ok(/session not found/.test(await refused(db, D, 'select public.invite_to_session($1, $2, $3)', [o[0].id, cB, 'occurrence']) ?? ''), 'only a host can invite');
ok((await one(C, 'public.invite_to_session($1, $2, $3)', [o[1].id, cD, 'occurrence'])).status === 'invited', 'the host invites Dee to one occurrence');
ok((await lst(D)).filter((x) => x.invited).map((x) => x.id).join() === o[1].id && (await rsvp(D, o[1].id)).status === 'rsvped' && /session not found/.test(await badRsvp(D, o[0].id) ?? ''), 'she sees and can join that occurrence only');
ok((await one(C, 'public.invite_to_session($1, $2, $3)', [o[0].id, cB, 'series'])).status === 'invited', 'a series invitation for Bea');
ok((await lst(B)).filter((x) => x.invited).length === 4 && (await rsvp(B, o[3].id)).status === 'rsvped', 'covers every occurrence');
ok(/person not found/.test(await refused(db, C, 'select public.invite_to_session($1, $2, $3)', [o[0].id, 'zzzzzzzzzz', 'series']) ?? '') && /person not found/.test(await refused(db, C, 'select public.invite_to_session($1, $2, $3)', [o[0].id, await codeOf(C), 'series']) ?? ''), 'an unknown code or yourself is refused');
ok(/not part of a series/.test(await refused(db, C, 'select public.invite_to_session($1, $2, $3)', [(await one(C, 'public.create_session($1, null, null, 7, 7, $2, $3)', ['Solo', new Date(Date.now() + 5 * 3600_000).toISOString(), new Date(Date.now() + 6 * 3600_000).toISOString()])).id, cB, 'series']) ?? '') && /scope/.test(await refused(db, C, 'select public.invite_to_session($1, $2, $3)', [o[0].id, cB, 'all']) ?? ''), 'a series scope needs a series; the scope is checked');
await db.exec(`insert into public.blocks (blocker, blocked) values ('${D}', '${C}')`);
ok(/person not found/.test(await refused(db, C, 'select public.invite_to_session($1, $2, $3)', [o[2].id, cD, 'occurrence']) ?? '') && !(await rows(D, 'select * from public.list_my_session_invitations()')).length, 'a block hides invitations both ways');
await db.exec('delete from public.blocks');
const inv = (await rows(D, 'select * from public.list_my_session_invitations()'));
ok(inv.length === 1 && inv[0].session_id === o[1].id && inv[0].host_name === 'Cam' && inv[0].scope === 'occurrence' && inv[0].i_rsvped === true && !J(inv).includes(C), 'the received list shows the invitation with the host name and no ids of people');
const hv = await one(C, 'public.list_session_invites($1)', [o[0].id]);
ok(hv.invitations.length === 2 && hv.invitations.some((x) => x.name === 'Bea' && x.scope === 'series') && /session not found/.test(await refused(db, D, 'select public.list_session_invites($1)', [o[0].id]) ?? ''), "the host sees who was invited, and nobody else can");
await one(C, 'public.revoke_session_invitation($1)', [hv.invitations.find((x) => x.name === 'Dee').id]);
ok(/session not found/.test(await badRsvp(D, o[2].id) ?? '') && (await sql('select count(*)::int as n from public.session_rsvps where session_id = $1 and user_id = $2', [o[1].id, D]))[0].n === 1, 'a revoked invitation stops new access and leaves an existing RSVP');
ok(/not found/.test(await refused(db, D, 'select public.revoke_session_invitation($1)', [hv.invitations[0].id]) ?? ''), 'only a host revokes');
// removing a joined person also works for a private session
const rl = await one(C, 'public.list_session_rsvps($1)', [o[1].id]);
ok((await one(C, 'public.remove_session_participant($1, $2)', [o[1].id, rl[0].rsvp_id])).status === 'removed', 'the host can still remove a person who joined by invitation');

// ---------- links
await clear();
r = await ser(C, { title: 'Link series', at: '2027-05-01 09:00', tz: 'UTC', n: 3 });
o = await occ(r.series_id);
const lk = await one(C, 'public.create_session_link($1, $2, $3, $4)', [o[0].id, 'series', 24, 2]);
ok(typeof lk.token === 'string' && lk.token.length === 64 && /^[0-9a-f]+$/.test(lk.token) && !!lk.id, 'a link returns a 64-character token once');
ok((await sql('select token_hash from public.session_links')).every((x) => x.token_hash !== lk.token && x.token_hash.length === 64), 'only a hash is stored');
ok(!J(await one(C, 'public.list_session_invites($1)', [o[0].id])).includes(lk.token), 'and the host listing never shows the token');
ok(/not valid/.test(await refused(db, D, 'select public.redeem_session_link($1)', ['f'.repeat(64)]) ?? '') && /not valid/.test(await refused(db, D, 'select public.redeem_session_link($1)', ['short']) ?? '') && /not valid/.test(await refused(db, D, 'select public.redeem_session_link($1)', [null]) ?? ''), 'an unknown, malformed or missing token all give the same refusal');
const red = await one(D, 'public.redeem_session_link($1)', [lk.token]);
ok(red.status === 'invited' && !!red.session_id && (await lst(D)).filter((x) => x.invited).length === 3 && (await rsvp(D, o[2].id)).status === 'rsvped', 'redeeming gives the series invitation: she sees all three and can join');
ok((await one(D, 'public.redeem_session_link($1)', [lk.token])).status === 'already_invited' && (await sql('select uses from public.session_links where id = $1', [lk.id]))[0].uses === 1, 'redeeming again spends no use');
ok((await one(C, 'public.redeem_session_link($1)', [lk.token])).status === 'host', 'the host gets a plain answer');
ok((await one(B, 'public.redeem_session_link($1)', [lk.token])).status === 'invited' && /not valid/.test(await refused(db, A, 'select public.redeem_session_link($1)', [lk.token]) ?? ''), 'the use limit (2) ends the link');
const lk2 = await one(C, 'public.create_session_link($1)', [o[0].id]);
await db.exec(`update public.session_links set expires_at = now() - interval '1 minute' where id = '${lk2.id}'`);
ok(/not valid/.test(await refused(db, A, 'select public.redeem_session_link($1)', [lk2.token]) ?? ''), 'an expired link is refused');
const lk3 = await one(C, 'public.create_session_link($1, $2, $3, $4)', [o[1].id, 'occurrence', 1, 5]);
await one(C, 'public.revoke_session_link($1)', [lk3.id]);
ok(/not valid/.test(await refused(db, A, 'select public.redeem_session_link($1)', [lk3.token]) ?? '') && /not found/.test(await refused(db, D, 'select public.revoke_session_link($1)', [lk3.id]) ?? ''), 'a revoked link is refused, and only a host revokes');
const lk4 = await one(C, 'public.create_session_link($1, $2, $3, $4)', [o[1].id, 'occurrence', 2, 5]);
await db.exec(`insert into public.blocks (blocker, blocked) values ('${A}', '${C}')`);
ok(/not valid/.test(await refused(db, A, 'select public.redeem_session_link($1)', [lk4.token]) ?? ''), 'a blocked person gets the same refusal');
await db.exec('delete from public.blocks');
ok(/lasts 1 hour/.test(await refused(db, C, 'select public.create_session_link($1, $2, $3, $4)', [o[1].id, 'occurrence', 0, 5]) ?? '') && /1 to 500/.test(await refused(db, C, 'select public.create_session_link($1, $2, $3, $4)', [o[1].id, 'occurrence', 5, 501]) ?? '') && /session not found/.test(await refused(db, D, 'select public.create_session_link($1, $2, $3, $4)', [o[1].id, 'occurrence', 5, 5]) ?? ''), 'limits are checked and only a host makes links');
for (let i = 0; i < 8; i++) await one(C, 'public.create_session_link($1)', [o[1].id]).catch(() => null);
ok(/at most 10 active links/.test(await refused(db, C, 'select public.create_session_link($1)', [o[1].id]) ?? ''), 'a session has at most ten active links');
const stored = (await sql('select count(*)::int as n from public.session_invitations'))[0].n;

// ---------- account deletion removes invitations, links and the person's place
await one(C, 'public.delete_profile()');
ok((await sql('select count(*)::int as n from public.session_links'))[0].n === 0 && (await sql('select count(*)::int as n from public.session_invitations'))[0].n === 0 && stored > 0, "deleting the host's profile removes their links and invitations");
ok((await sql('select count(*)::int as n from public.flight_sessions where series_id = $1 and created_by is not null', [r.series_id]))[0].n === 0 && (await sql('select created_by from public.flight_session_series where id = $1', [r.series_id]))[0].created_by === null, 'and detaches the series from them');
