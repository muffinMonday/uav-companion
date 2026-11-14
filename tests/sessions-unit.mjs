// The plain side of flight sessions (src/sessions.js): validation of what the database returns, which controls to offer when, and the database wrapper. No browser, no network.
import { cleanSession, cleanPerson, sessionState, whenText, createSessions, cleanPublic, cleanInvitation, cleanNotice, cleanTakedown, cleanInviteList, capacityText, roleText, seriesText, linkUrl, tokenFromHash, metres } from '../src/sessions.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const H = 3600_000, now = Date.UTC(2026, 10, 14, 12, 0, 0);
const iso = (h) => new Date(now + h * H).toISOString();
const raw = (o = {}) => ({ id: 's1', title: 'Field day', description: 'Bring batteries', location: 'East Lake', starts_at: iso(-1), ends_at: iso(2), status: 'scheduled', rsvp_count: 3, i_rsvped: false, my_attended: false, can_manage: false, ...o });

// ---------- cleaning
let s = cleanSession(raw());
ok(s && s.id === 's1' && s.title === 'Field day' && s.rsvpCount === 3 && s.status === 'scheduled' && s.iRsvped === false && s.canManage === false, 'a good row is read');
for (const bad of [null, undefined, 5, {}, raw({ id: '' }), raw({ id: 5 }), raw({ starts_at: 'later' }), raw({ ends_at: null })]) ok(cleanSession(bad) === null, 'refused: ' + JSON.stringify(bad)?.slice(0, 40));
s = cleanSession(raw({ title: 'x'.repeat(200), description: 'd'.repeat(900), status: 'weird', rsvp_count: -4, can_manage: 'yes', i_rsvped: 1 }));
ok(s.title.length === 80 && s.description.length === 500 && s.status === 'closed' && s.rsvpCount === 0 && s.canManage === false && s.iRsvped === false, 'text is capped, an unknown status is treated as closed, and only true means true');
ok(cleanSession(raw({ title: '' })).title === 'Flight session', 'an empty title gets a default');
let p = cleanPerson({ rsvp_id: 'r1', attendance_id: null, display_name: 'Cam', rsvped: true, attended: false, revoked: false, source: null });
ok(p.rsvpId === 'r1' && p.attendanceId === null && p.name === 'Cam' && p.rsvped && !p.attended && p.source === 'rsvp', 'a person with an RSVP');
p = cleanPerson({ rsvp_id: null, attendance_id: 'a1', display_name: '', attended: true, source: 'walk_in' });
ok(p.attendanceId === 'a1' && p.name === 'Someone' && p.attended && p.source === 'walk_in', 'a walk-in with no name shown');
ok(cleanPerson({ display_name: 'x' }) === null && cleanPerson(null) === null && cleanPerson({ rsvp_id: 5 }) === null, 'a person with no handle is dropped');

// ---------- which controls
const st = (o, at) => sessionState(cleanSession(raw(o)), at ?? now);
let t = st({ starts_at: iso(24), ends_at: iso(27) });
ok(t.canRsvp && !t.canWithdraw && !t.canMark && !t.started && !t.over, 'before it starts: RSVP is offered, marking is not');
t = st({ starts_at: iso(24), ends_at: iso(27), i_rsvped: true, can_manage: true });
ok(!t.canRsvp && t.canWithdraw && !t.canMark, 'after RSVP: withdraw is offered; a manager still cannot mark before the start');
t = st({ i_rsvped: true, can_manage: true, can_verify: true });
ok(t.started && !t.over && !t.canRsvp && !t.canWithdraw && t.canMark, 'under way: no withdrawing, and a manager can mark');
t = st({ can_manage: false });
ok(t.canRsvp && !t.canMark, 'under way: a late RSVP is still possible, an ordinary person cannot mark');
t = st({ starts_at: iso(-5), ends_at: iso(-3), can_manage: true, can_verify: true });
ok(t.over && !t.canRsvp && t.canMark, 'once over but not closed, a manager can still mark and nobody can RSVP');
t = st({ status: 'closed', can_manage: true, i_rsvped: true });
ok(!t.open && !t.canRsvp && !t.canWithdraw && !t.canMark, 'a closed session offers nothing');
t = st({ status: 'cancelled' });
ok(!t.open && !t.canRsvp, 'neither does a cancelled one');
ok(st({ starts_at: iso(0), ends_at: iso(1) }).started === true, 'it has started at the very start time');

// ---------- the time text
const sameDay = whenText('2026-11-14T06:00:00Z', '2026-11-14T08:30:00Z', 'en-GB');
ok(/to/.test(sameDay) && sameDay.split(' to ').length === 2, 'a same-day session reads "date, start to end": ' + sameDay);
ok(whenText('2026-11-14T06:00:00Z', '2026-11-16T06:00:00Z', 'en-GB').split(' to ').length === 2 && /Nov/.test(whenText('2026-11-14T06:00:00Z', '2026-11-16T06:00:00Z', 'en-GB')), 'a longer one gives both dates');

// ---------- the wrapper
const calls = []; let reply = null;
const api = createSessions({ rpc: async (fn, args) => { calls.push([fn, args]); if (reply instanceof Error) return { data: null, error: { message: reply.message } }; return { data: reply, error: null }; } });
reply = [raw(), { junk: true }, raw({ id: 's2' })];
let l = await api.list();
ok(l.length === 2 && l[1].id === 's2' && calls.at(-1)[0] === 'list_sessions', 'list drops junk rows');
reply = 'nope'; ok((await api.list()).length === 0, 'a reply that is not a list is an empty list');
reply = { admin: true, organiser: 'yes' }; const r = await api.roles();
ok(r.admin === true && r.organiser === false, 'roles only count a real true');
reply = { status: 'x' };
await api.rsvp('s1'); await api.withdraw('s1'); await api.close('s1'); await api.cancel('s1');
ok(calls.slice(-4).map((c) => c[0]).join() === 'rsvp_session,withdraw_rsvp,close_session,cancel_session' && calls.slice(-4).every((c) => c[1].p_id === 's1'), 'the simple calls pass the session id');
await api.create({ title: 'T', description: '', location: '', startsAt: 'a', endsAt: 'b' });
ok(calls.at(-1)[0] === 'create_session' && calls.at(-1)[1].p_description === null && calls.at(-1)[1].p_location === null && calls.at(-1)[1].p_starts_at === 'a', 'create sends empty optional fields as null');
await api.mark('s1', 'rsvp', 'r1'); await api.mark('s1', 'code', 'ABCDE-12345');
ok(calls.at(-2)[1].p_kind === 'rsvp' && calls.at(-1)[1].p_kind === 'code' && calls.at(-1)[1].p_ref === 'ABCDE-12345' && !('p_user' in calls.at(-1)[1]), 'marking names the person only by an RSVP handle or a friend code');
await api.revoke('s1', 'a1', 'Wrong person');
ok(calls.at(-1)[0] === 'revoke_attendance' && calls.at(-1)[1].p_attendance === 'a1' && calls.at(-1)[1].p_reason === 'Wrong person', 'revoke passes the mark and the reason');
reply = [{ rsvp_id: 'r1', display_name: 'Cam', rsvped: true }, { nothing: 1 }];
ok((await api.people('s1')).length === 1, 'people drops junk rows');
reply = new Error('not allowed');
let err = null; try { await api.rsvp('s1'); } catch (e) { err = e.message; }
ok(err === 'not allowed', 'a database error is thrown with its message');

// ---------- Sessions 2.0: new fields, public rows, invitations, notices, wording
const v2 = raw({ latitude: 30.5, longitude: 114.25, timezone: 'Asia/Shanghai', visibility: 'public', capacity: 10, can_manage: true, can_verify: false, is_host: true, host_name: 'Bea', host_avatar: 'owl', series_id: 'sr1', series_ordinal: 2, series_count: 4, invited: true });
s = cleanSession(v2);
ok(s.lat === 30.5 && s.lng === 114.25 && s.visibility === 'public' && s.capacity === 10 && s.isHost && !s.canVerify && s.hostName === 'Bea' && s.seriesOrdinal === 2 && s.seriesCount === 4 && s.invited && s.timezone === 'Asia/Shanghai', 'the new fields are read');
s = cleanSession(raw({ latitude: 91, longitude: 'x', visibility: 'secret', capacity: 0, timezone: '<script>' }));
ok(s.lat === null && s.lng === null && s.visibility === 'private' && s.capacity === null && s.timezone === 'UTC', 'bad coordinates, visibility, capacity and zone fall back safely (private is the default)');
const pubRow = { id: 'p1', title: 'Open field', description: '', location: 'Lake', latitude: 1, longitude: 2, starts_at: iso(5), ends_at: iso(8), timezone: 'UTC', capacity: null, rsvp_count: 2, host_name: 'Bea', host_avatar: null, distance_km: 3.4, series_ordinal: null, series_count: null };
const q = cleanPublic(pubRow);
ok(q.lat === 1 && q.lng === 2 && q.distanceKm === 3.4 && q.capacity === null && q.hostName === 'Bea', 'a public row is read');
ok(cleanPublic({ ...pubRow, latitude: null }) === null && cleanPublic({ ...pubRow, starts_at: 'x' }) === null && cleanPublic(null) === null, 'a public row without a point or a time is dropped');
const inv = cleanInvitation({ invitation_id: 'i1', session_id: 's9', scope: 'series', via: 'link', invited_at: iso(-1), title: 'Series', starts_at: iso(5), ends_at: iso(8), location: 'x', latitude: 1, longitude: 2, timezone: 'UTC', host_name: 'Bea', series_ordinal: 1, i_rsvped: false });
ok(inv.id === 's9' && inv.invitationId === 'i1' && inv.scope === 'series' && inv.via === 'link' && inv.hostName === 'Bea' && inv.status === 'scheduled', 'an invitation is a session with its invitation handle');
ok(cleanInvitation({ session_id: 's9' }) === null, 'an invitation without a handle or times is dropped');
const nt = cleanNotice({ id: 'n1', session_id: 's1', kind: 'removed', session_title: 'Field day', created_at: iso(-1), read_at: null });
ok(nt.unread && /removed you from/.test(nt.message) && /Field day/.test(nt.message), 'a notice reads from fixed text plus the title');
ok(cleanNotice({ kind: 'hack', session_title: 'x' }) === null && /cancelled/.test(cleanNotice({ kind: 'cancelled', session_title: 'T' }).message), 'an unknown notice kind is dropped');
ok(cleanTakedown({ session_id: 's1', title: 'T', unpublished_at: iso(-1) }).title === 'T' && cleanTakedown({}) === null, 'a takedown notice');
const il = cleanInviteList({ invitations: [{ id: 'a', name: 'Cam', scope: 'series', via: 'name', revoked: false }, { nope: 1 }], links: [{ id: 'l', scope: 'occurrence', expires_at: iso(5), max_uses: 25, uses: 3, revoked: false, token: 'SECRET' }] });
ok(il.invitations.length === 1 && il.links.length === 1 && il.links[0].uses === 3 && !('token' in il.links[0]) && !JSON.stringify(il).includes('SECRET'), 'the invite list never carries a token');
ok(capacityText({ rsvpCount: 3, capacity: 10 }) === '3 of 10 places taken' && capacityText({ rsvpCount: 1, capacity: null }) === '1 person is coming' && capacityText({ rsvpCount: 4, capacity: null }) === '4 people are coming', 'capacity wording');
ok(seriesText({ seriesOrdinal: 2, seriesCount: 4 }) === 'Session 2 of 4' && seriesText({ seriesOrdinal: null, seriesCount: null }) === '', 'series wording');
ok(/host this session and can verify/.test(roleText({ isHost: true, canVerify: true })) && /cannot/.test(roleText({ isHost: true, canVerify: false })) && /verify attendance for XP/.test(roleText({ isHost: true, canVerify: false })) && /administrator/.test(roleText({ isHost: false, canVerify: true })) && roleText({ isHost: false, canVerify: false }) === '', 'hosting and verifying XP are worded apart');
let u = sessionState(cleanSession(raw({ capacity: 3, rsvp_count: 3 })), now);
ok(u.full && !u.canRsvp, 'a full session offers no RSVP');
u = sessionState(cleanSession(raw({ capacity: 3, rsvp_count: 3, i_rsvped: true, starts_at: iso(24), ends_at: iso(27) })), now);
ok(u.full && u.canWithdraw, 'a full session still lets someone who joined withdraw');
u = sessionState(cleanSession(raw({ can_manage: true, can_verify: false })), now);
ok(!u.canMark, 'a host who cannot verify has no Mark present');
ok(tokenFromHash('#session=' + 'a'.repeat(64)) === 'a'.repeat(64) && tokenFromHash('#session=short') === null && tokenFromHash('#import=abc') === null && tokenFromHash('') === null, 'the link token is read only from #session=');
ok(linkUrl('T', 'https://x.test/app/') === 'https://x.test/app/#session=T', 'a link keeps the token after #, which no server receives');
ok(Math.abs(metres(0, 0, 0, 0.1) - 11119) < 30, 'distance in metres');
const calls2 = []; const api2 = createSessions({ rpc: async (fn, args) => { calls2.push([fn, args]); return { data: fn === 'list_public_sessions' ? [pubRow, { junk: 1 }] : { ok: true }, error: null }; } });
const lp = await api2.listPublic({ lat: 1, lng: 2, radiusKm: 10, query: 'lake', limit: 20, offset: 40 });
ok(lp.length === 1 && calls2.at(-1)[1].p_radius_km === 10 && calls2.at(-1)[1].p_lat === 1 && calls2.at(-1)[1].p_query === 'lake' && calls2.at(-1)[1].p_offset === 40, 'listPublic passes the place, radius, query and page');
await api2.listPublic({}); ok(!('p_lat' in calls2.at(-1)[1]) && !('p_radius_km' in calls2.at(-1)[1]) && calls2.at(-1)[1].p_limit === 30, 'a public list without a place sends no centre');
await api2.listPublic({ radiusKm: 10 }); ok(!('p_radius_km' in calls2.at(-1)[1]), 'a radius without a centre is not sent');
await api2.create({ title: 'T', lat: 1, lng: 2, startsAt: 'a', endsAt: 'b', timezone: 'Asia/Shanghai', visibility: 'public', capacity: '12' });
ok(calls2.at(-1)[0] === 'create_session' && calls2.at(-1)[1].p_lat === 1 && calls2.at(-1)[1].p_visibility === 'public' && calls2.at(-1)[1].p_capacity === 12 && calls2.at(-1)[1].p_timezone === 'Asia/Shanghai', 'create sends the point, zone, visibility and capacity');
await api2.create({ title: 'T', lat: 1, lng: 2, startsAt: 'a', endsAt: 'b' });
ok(calls2.at(-1)[1].p_visibility === 'private' && calls2.at(-1)[1].p_capacity === null, 'create defaults to private with no limit');
await api2.createSeries({ title: 'T', lat: 1, lng: 2, localStart: '2026-11-14T10:00:00', durationMinutes: 180, timezone: 'Asia/Shanghai', frequency: 'weekly', count: 4 });
ok(calls2.at(-1)[0] === 'create_session_series' && calls2.at(-1)[1].p_local_start === '2026-11-14T10:00:00' && calls2.at(-1)[1].p_count === 4 && calls2.at(-1)[1].p_frequency === 'weekly', 'createSeries sends the wall time, duration, repeat and count');
await api2.invite('s1', 'ABCDE-12345', 'series'); await api2.createLink('s1', { scope: 'series', hours: 24, maxUses: 5 }); await api2.redeemLink('tok'); await api2.report('s1', 'spam', 'n'); await api2.removePerson('s1', 'r1');
ok(calls2.slice(-5).map((c) => c[0]).join() === 'invite_to_session,create_session_link,redeem_session_link,report_session,remove_session_participant' && calls2.at(-4)[1].p_expires_hours === 24 && calls2.at(-4)[1].p_max_uses === 5 && calls2.at(-3)[1].p_token === 'tok' && calls2.at(-2)[1].p_reason === 'spam', 'invitations, links, reports and removals call the right functions');
