// Flight sessions, the plain part: the database functions (supabase/migrations/20261114130000_flight_sessions.sql), validation of what they return, and the rules for which
// button to show when. The database enforces every rule; these only decide what the screen offers. RSVP gives no XP: attendance XP comes only from an organiser marking someone present.

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const time = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** A list_sessions row made safe to draw, or null. */
export function cleanSession(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  const startsAt = time(r.starts_at), endsAt = time(r.ends_at);
  if (!startsAt || !endsAt) return null;
  return {
    id: r.id.slice(0, 64), title: text(r.title, 80) || 'Flight session', description: text(r.description, 500), location: text(r.location, 120), startsAt, endsAt,
    status: ['scheduled', 'closed', 'cancelled'].includes(r.status) ? r.status : 'closed', rsvpCount: count(r.rsvp_count),
    iRsvped: r.i_rsvped === true, myAttended: r.my_attended === true, canManage: r.can_manage === true,
  };
}

/** One person of a session as its manager sees them (list_session_rsvps), or null. */
export function cleanPerson(r) {
  if (!r || typeof r !== 'object') return null;
  const rsvpId = typeof r.rsvp_id === 'string' ? r.rsvp_id.slice(0, 64) : null, attendanceId = typeof r.attendance_id === 'string' ? r.attendance_id.slice(0, 64) : null;
  if (!rsvpId && !attendanceId) return null;
  return { rsvpId, attendanceId, name: text(r.display_name, 40) || 'Someone', rsvped: r.rsvped === true, attended: r.attended === true, revoked: r.revoked === true, source: r.source === 'walk_in' ? 'walk_in' : 'rsvp' };
}

const ms = (iso) => Date.parse(iso);
/** Which controls make sense now. `now` is a Date or a number of milliseconds. */
export function sessionState(s, now = Date.now()) {
  const t = +now, open = s.status === 'scheduled';
  return {
    open, started: t >= ms(s.startsAt), over: t > ms(s.endsAt),
    canRsvp: open && !s.iRsvped && t <= ms(s.endsAt),
    canWithdraw: open && s.iRsvped && t < ms(s.startsAt),
    canMark: open && s.canManage && t >= ms(s.startsAt),
  };
}

/** "Sat 15 Nov, 14:00 to 17:00" (or with both dates when the session crosses midnight), in the viewer's time zone. */
export function whenText(startsAt, endsAt, locale = 'en-GB') {
  const a = new Date(startsAt), b = new Date(endsAt);
  const d = (x) => x.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const h = (x) => x.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return a.toDateString() === b.toDateString() ? `${d(a)}, ${h(a)} to ${h(b)}` : `${d(a)} ${h(a)} to ${d(b)} ${h(b)}`;
}

export function createSessions(client) {
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    /** [session] as cleanSession gives them, in the database's order (soonest first). */
    async list() { const rows = await rpc('list_sessions'); return Array.isArray(rows) ? rows.map(cleanSession).filter(Boolean) : []; },
    /** { admin, organiser } for the caller. */
    async roles() { const r = await rpc('my_roles'); return { admin: r?.admin === true, organiser: r?.organiser === true }; },
    rsvp: (id) => rpc('rsvp_session', { p_id: id }),
    withdraw: (id) => rpc('withdraw_rsvp', { p_id: id }),
    create: (f) => rpc('create_session', { p_title: f.title, p_description: f.description || null, p_location: f.location || null, p_starts_at: f.startsAt, p_ends_at: f.endsAt }),
    close: (id) => rpc('close_session', { p_id: id }),
    cancel: (id) => rpc('cancel_session', { p_id: id }),
    /** The people of a session (managers only). */
    async people(id) { const rows = await rpc('list_session_rsvps', { p_id: id }); return Array.isArray(rows) ? rows.map(cleanPerson).filter(Boolean) : []; },
    /** Marks someone present: kind 'rsvp' with a person's rsvpId, or 'code' with a friend code. Resolves { status: 'marked' | 'already_attended', display_name, xp? }. */
    mark: (id, kind, ref) => rpc('mark_attended', { p_session: id, p_kind: kind, p_ref: ref }),
    revoke: (id, attendanceId, reason) => rpc('revoke_attendance', { p_session: id, p_attendance: attendanceId, p_reason: reason }),
  };
}
