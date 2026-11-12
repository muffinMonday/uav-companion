// The plain side of flight sessions (src/sessions.js): validation of what the database returns, which controls to offer when, and the database wrapper. No browser, no network.
import { cleanSession, cleanPerson, sessionState, whenText, createSessions } from '../src/sessions.js';
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
t = st({ i_rsvped: true, can_manage: true });
ok(t.started && !t.over && !t.canRsvp && !t.canWithdraw && t.canMark, 'under way: no withdrawing, and a manager can mark');
t = st({ can_manage: false });
ok(t.canRsvp && !t.canMark, 'under way: a late RSVP is still possible, an ordinary person cannot mark');
t = st({ starts_at: iso(-5), ends_at: iso(-3), can_manage: true });
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
