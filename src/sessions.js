// Flight sessions, the plain part: the database functions (supabase/migrations/20261114130000_flight_sessions.sql and the 202611181* Sessions 2.0 migrations), validation of what they
// return, and the rules for which button to show when. The database enforces every rule; these only decide what the screen offers. Hosting a session and RSVP give no XP:
// attendance XP comes only from an organiser who hosts the session (or an administrator) marking someone present (`canVerify`).

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const time = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const id = (v) => (typeof v === 'string' && v ? v.slice(0, 64) : null);
const coord = (v, max) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : null);
const capacity = (v) => (Number.isInteger(v) && v >= 1 && v <= 500 ? v : null);
const zone = (v) => (typeof v === 'string' && /^[A-Za-z0-9_+\-/]{1,64}$/.test(v) ? v : 'UTC');
const avatar = (v) => text(v, 40);
/** XP a session can pay, as the database states it (xp_reward): a positive whole number, or null for "no XP possible" (and for an old database that has no such column). */
const xp = (v) => (Number.isInteger(v) && v > 0 && v <= 100000 ? v : null);
const series = (r) => ({ seriesId: id(r.series_id), seriesOrdinal: Number.isInteger(r.series_ordinal) && r.series_ordinal > 0 ? r.series_ordinal : null, seriesCount: Number.isInteger(r.series_count) && r.series_count > 0 ? r.series_count : null });

/** A list_sessions row made safe to draw, or null. */
export function cleanSession(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  const startsAt = time(r.starts_at), endsAt = time(r.ends_at);
  if (!startsAt || !endsAt) return null;
  return {
    id: r.id.slice(0, 64), title: text(r.title, 80) || 'Flight session', description: text(r.description, 500), location: text(r.location, 120), startsAt, endsAt,
    lat: coord(r.latitude, 90), lng: coord(r.longitude, 180), timezone: zone(r.timezone), visibility: r.visibility === 'public' ? 'public' : 'private', capacity: capacity(r.capacity),
    status: ['scheduled', 'closed', 'cancelled'].includes(r.status) ? r.status : 'closed', rsvpCount: count(r.rsvp_count),
    iRsvped: r.i_rsvped === true, myAttended: r.my_attended === true, canManage: r.can_manage === true, canVerify: r.can_verify === true, isHost: r.is_host === true, invited: r.invited === true,
    hostName: text(r.host_name, 40) || 'Someone', hostAvatar: avatar(r.host_avatar), xpReward: xp(r.xp_reward), ...series(r),
  };
}

/** A list_public_sessions / get_public_session row (what a guest may see), or null. */
export function cleanPublic(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  const startsAt = time(r.starts_at), endsAt = time(r.ends_at), lat = coord(r.latitude, 90), lng = coord(r.longitude, 180);
  if (!startsAt || !endsAt || lat === null || lng === null) return null;
  return {
    id: r.id.slice(0, 64), title: text(r.title, 80) || 'Flight session', description: text(r.description, 500), location: text(r.location, 120), startsAt, endsAt, lat, lng,
    timezone: zone(r.timezone), capacity: capacity(r.capacity), rsvpCount: count(r.rsvp_count), hostName: text(r.host_name, 40) || 'Someone', hostAvatar: avatar(r.host_avatar),
    distanceKm: typeof r.distance_km === 'number' && Number.isFinite(r.distance_km) && r.distance_km >= 0 ? r.distance_km : null, xpReward: xp(r.xp_reward), ...series(r),
  };
}

/**
 * One person of a session's attendee list (list_session_participants), or null. `handle` is the session-scoped opaque name, never a user id;
 * `relation` is self | friend | pending | none; `friendshipId` is the viewer's own friendship row (friends only).
 */
export function cleanParticipant(r) {
  if (!r || typeof r !== 'object' || typeof r.handle !== 'string' || !r.handle) return null;
  return { handle: r.handle.slice(0, 64), name: text(r.display_name, 40) || 'Someone', avatar: avatar(r.avatar), relation: ['self', 'friend', 'pending'].includes(r.relation) ? r.relation : 'none', isHost: r.is_host === true, friendshipId: r.relation === 'friend' ? id(r.friendship_id) : null, total: count(r.total) };
}

/** The answer of submit_session_arrival: { status, xp, count } with a status from the fixed set, anything else read as unavailable. */
const ARRIVAL_STATUS = ['unavailable', 'no_consent', 'not_eligible', 'too_early', 'ended', 'poor_accuracy', 'too_far', 'tracking', 'waiting', 'capped', 'already_attended', 'revoked', 'awarded', 'attended'];
export function cleanArrival(r) {
  const status = r && ARRIVAL_STATUS.includes(r.status) ? r.status : 'unavailable';
  return { status, xp: Number.isInteger(r?.xp) && r.xp >= 0 && r.xp <= 100000 ? r.xp : 0, count: count(r?.count) };
}

/** One list_my_session_invitations row, or null. */
export function cleanInvitation(r) {
  const s = cleanSession(r && { ...r, id: r.session_id, status: 'scheduled' });
  const invitationId = id(r?.invitation_id);
  if (!s || !invitationId) return null;
  return { ...s, invitationId, scope: r.scope === 'series' ? 'series' : 'occurrence', via: r.via === 'link' ? 'link' : 'name', invitedAt: time(r.invited_at), iRsvped: r.i_rsvped === true, seriesOrdinal: s.seriesOrdinal ?? (Number.isInteger(r.series_ordinal) ? r.series_ordinal : null) };
}

/** One person of a session as its manager sees them (list_session_rsvps), or null. */
export function cleanPerson(r) {
  if (!r || typeof r !== 'object') return null;
  const rsvpId = typeof r.rsvp_id === 'string' ? r.rsvp_id.slice(0, 64) : null, attendanceId = typeof r.attendance_id === 'string' ? r.attendance_id.slice(0, 64) : null;
  if (!rsvpId && !attendanceId) return null;
  return { rsvpId, attendanceId, name: text(r.display_name, 40) || 'Someone', rsvped: r.rsvped === true, attended: r.attended === true, revoked: r.revoked === true, source: r.source === 'walk_in' ? 'walk_in' : 'rsvp' };
}

const NOTICE_TEXT = {
  cancelled: 'was cancelled.', changed: 'changed (time or place).', unpublished: 'was taken down by a moderator.', removed: 'The host removed you from',
  visibility: 'changed who can see it.',
};
/** One list_my_session_notices row, or null. `message` is built here from fixed text; the title is the only user text and is shown as text. */
export function cleanNotice(r) {
  if (!r || typeof r !== 'object' || !(r.kind in NOTICE_TEXT)) return null;
  const title = text(r.session_title, 80) || 'A flight session', unread = !r.read_at;
  return { id: id(r.id), sessionId: id(r.session_id), kind: r.kind, title, createdAt: time(r.created_at), unread, message: r.kind === 'removed' ? `${NOTICE_TEXT.removed} “${title}”.` : `“${title}” ${NOTICE_TEXT[r.kind]}` };
}

/** One my_session_moderation row (a session of mine a moderator took down), or null. */
export function cleanTakedown(r) {
  if (!r || typeof r !== 'object' || !id(r.session_id)) return null;
  return { id: id(r.session_id), title: text(r.title, 80) || 'Flight session', at: time(r.unpublished_at) };
}

/** list_session_invites: the host's view of invitations and links (never a link's token). */
export function cleanInviteList(r) {
  const inv = Array.isArray(r?.invitations) ? r.invitations : [], links = Array.isArray(r?.links) ? r.links : [];
  return {
    invitations: inv.filter((i) => id(i?.id)).map((i) => ({ id: id(i.id), name: text(i.name, 40) || 'Someone', scope: i.scope === 'series' ? 'series' : 'occurrence', via: i.via === 'link' ? 'link' : 'name', revoked: i.revoked === true })),
    links: links.filter((k) => id(k?.id)).map((k) => ({ id: id(k.id), scope: k.scope === 'series' ? 'series' : 'occurrence', expiresAt: time(k.expires_at), maxUses: count(k.max_uses), uses: count(k.uses), revoked: k.revoked === true })),
  };
}

const ms = (iso) => Date.parse(iso);
const full = (s) => s.capacity !== null && s.rsvpCount >= s.capacity;
/** Which controls make sense now. `now` is a Date or a number of milliseconds. */
export function sessionState(s, now = Date.now()) {
  const t = +now, open = s.status === 'scheduled';
  return {
    open, started: t >= ms(s.startsAt), over: t > ms(s.endsAt), full: full(s),
    canRsvp: open && !s.iRsvped && t <= ms(s.endsAt) && !full(s),
    canWithdraw: open && s.iRsvped && t < ms(s.startsAt),
    canMark: open && s.canVerify !== false && s.canManage && t >= ms(s.startsAt),
  };
}

/** How many places: "3 of 10 places taken" or "3 people are coming" (no limit). */
export function capacityText(s) {
  const n = s.rsvpCount;
  if (s.capacity !== null) return `${n} of ${s.capacity} ${s.capacity === 1 ? 'place' : 'places'} taken`;
  return n === 1 ? '1 person is coming' : `${n} people are coming`;
}

/** What the person can do here, said plainly: hosting (edit, cancel, people) is not the same as being able to verify attendance for XP. '' when neither applies. */
export function roleText(s) {
  if (s.isHost && s.canVerify) return 'You host this session and can verify attendance for XP.';
  if (s.isHost) return 'You host this session: you can edit it, cancel it and manage who comes. Only an organiser who hosts a session, or an administrator, can verify attendance for XP, so you cannot.';
  if (s.canVerify) return 'As an administrator you can verify attendance for XP here.';
  return '';
}

/** "Session 2 of 4" for one occurrence of a series, else ''. */
export const seriesText = (s) => (s.seriesOrdinal && s.seriesCount ? `Session ${s.seriesOrdinal} of ${s.seriesCount}` : '');

/** "Sat 15 Nov, 14:00 to 17:00" (or with both dates when the session crosses midnight), in the viewer's time zone. */
export function whenText(startsAt, endsAt, locale = 'en-GB') {
  const a = new Date(startsAt), b = new Date(endsAt);
  const d = (x) => x.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const h = (x) => x.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return a.toDateString() === b.toDateString() ? `${d(a)}, ${h(a)} to ${h(b)}` : `${d(a)} ${h(a)} to ${d(b)} ${h(b)}`;
}

/** The viewer-local "Today" window for the Discover filter: from now until the next local midnight minus 1 ms (DST-safe: calendar arithmetic, never +24 h). */
export function todayRange(now = Date.now()) {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return { from: new Date(now).toISOString(), until: new Date(next.getTime() - 1).toISOString() };
}

/** Rows that have not ended yet (a cached list can outlive a session). */
export const stillOn = (list, now = Date.now()) => list.filter((s) => Date.parse(s.endsAt) > now);

/** The earliest end time among sessions that are still on, as epoch ms, or null (when to look at the list again). */
export function nextExpiry(list, now = Date.now()) {
  let min = null;
  for (const s of list) { const t = Date.parse(s.endsAt); if (t > now && (min === null || t < min)) min = t; }
  return min;
}

/** Straight-line distance in metres (for ordering and for "near here" text only; the database does the real checks). */
export function metres(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The invitation link for a token (the token lives in the part after #, which is never sent to a server). */
export const linkUrl = (token, base) => `${base}#session=${token}`;
/** The token of a `#session=` hash, or null. */
export const tokenFromHash = (hash) => { const m = /^#session=([A-Za-z0-9]{32,100})$/.exec(hash || ''); return m ? m[1] : null; };

const list = (rows, clean) => (Array.isArray(rows) ? rows.map(clean).filter(Boolean) : []);

export function createSessions(client) {
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  return {
    /** [session] as cleanSession gives them, in the database's order (soonest first). */
    async list() { return list(await rpc('list_sessions'), cleanSession); },
    /** The attendee list of a session: { people: [cleanParticipant], total }. The database decides who may see it (public sessions anyone, private ones people who joined). */
    async participants(sessionId, { limit = 30, offset = 0 } = {}) { const people = list(await rpc('list_session_participants', { p_session: sessionId, p_limit: limit, p_offset: offset }), cleanParticipant); return { people, total: people[0]?.total ?? 0 }; },
    /** Add friend from a session's list: 'friends' or 'pending' (one answer whatever the other person's settings). */
    async requestFriendFrom(sessionId, handle) { const r = await rpc('request_friend_from_session', { p_session: sessionId, p_handle: handle }); return r?.status === 'friends' ? 'friends' : 'pending'; },
    /** The caller's friends as the database returns them (for a friend's full profile in the popover). */
    async friendRows() { const r = await rpc('list_friends'); return Array.isArray(r) ? r : []; },
    async showInLists() { return (await rpc('get_show_in_attendee_lists')) !== false; },
    async setShowInLists(show) { return (await rpc('set_show_in_attendee_lists', { p_show: show === true })) !== false; },
    /** Automatic attendance: { enabled, consented, accuracy_m, spacing_s } (the database switch, this person's consent, the sampling facts). */
    async arrivalConfig() { const r = await rpc('arrival_config'); return { enabled: r?.enabled === true, consented: r?.consented === true, accuracy_m: Number.isInteger(r?.accuracy_m) ? r.accuracy_m : 50, spacing_s: Number.isInteger(r?.spacing_s) ? r.spacing_s : 30 }; },
    async recordConsent() { await rpc('record_arrival_consent', { p_version: 1 }); },
    async withdrawConsent() { await rpc('withdraw_arrival_consent'); },
    /** One position sample for a session: the server measures the distance and keeps no coordinates. Returns cleanArrival(). */
    async submitArrival(sessionId, lat, lng, accuracy) { return cleanArrival(await rpc('submit_session_arrival', { p_session: sessionId, p_lat: lat, p_lng: lng, p_accuracy: accuracy })); },
    /** { admin, organiser } for the caller. */
    async roles() { const r = await rpc('my_roles'); return { admin: r?.admin === true, organiser: r?.organiser === true }; },
    /** Public sessions (guests too): { lat, lng, radiusKm } for a place, `query`, `from`/`until` ISO times, `limit` (max 50), `offset`. */
    async listPublic(f = {}) {
      const args = { p_limit: f.limit ?? 30, p_offset: f.offset ?? 0 };
      if (Number.isFinite(f.lat) && Number.isFinite(f.lng)) { args.p_lat = f.lat; args.p_lng = f.lng; if (Number.isFinite(f.radiusKm)) args.p_radius_km = f.radiusKm; }
      if (f.query) args.p_query = f.query;
      if (f.from) args.p_from = f.from;
      if (f.until) args.p_until = f.until;
      return list(await rpc('list_public_sessions', args), cleanPublic);
    },
    async invitations() { return list(await rpc('list_my_session_invitations'), cleanInvitation); },
    async notices() { return list(await rpc('list_my_session_notices'), cleanNotice); },
    ackNotices: () => rpc('ack_session_notices'),
    async takedowns() { return list(await rpc('my_session_moderation'), cleanTakedown); },
    rsvp: (sid) => rpc('rsvp_session', { p_id: sid }),
    withdraw: (sid) => rpc('withdraw_rsvp', { p_id: sid }),
    /** One session. f: { title, description, location, lat, lng, startsAt, endsAt, timezone, visibility, capacity }. Resolves { id?, warnings }. */
    create: (f) => rpc('create_session', { p_title: f.title, p_description: f.description || null, p_location: f.location || null, p_lat: f.lat, p_lng: f.lng, p_starts_at: f.startsAt, p_ends_at: f.endsAt, p_timezone: f.timezone || 'UTC', p_visibility: f.visibility || 'private', p_capacity: num(f.capacity) }),
    /** A series. f adds localStart ('YYYY-MM-DDTHH:MM:SS', the wall time in `timezone`), durationMinutes, frequency ('weekly' | 'biweekly' | 'monthly') and count (2 to 12). */
    createSeries: (f) => rpc('create_session_series', { p_title: f.title, p_description: f.description || null, p_location: f.location || null, p_lat: f.lat, p_lng: f.lng, p_local_start: f.localStart, p_duration_minutes: f.durationMinutes, p_timezone: f.timezone || 'UTC', p_visibility: f.visibility || 'private', p_capacity: num(f.capacity), p_frequency: f.frequency, p_count: f.count }),
    /** Changes one session; `patch` uses the database's field names (title, description, location, latitude, longitude, starts_at, ends_at, timezone, capacity, visibility). */
    update: (sid, patch) => rpc('update_session', { p_id: sid, p_patch: patch }),
    /** This and the later, not individually edited, sessions of a series (title, description, location, latitude + longitude, capacity, start_time 'HH:MM', duration_minutes). */
    updateSeries: (sid, patch) => rpc('update_session_series', { p_id: sid, p_patch: patch }),
    close: (sid) => rpc('close_session', { p_id: sid }),
    cancel: (sid) => rpc('cancel_session', { p_id: sid }),
    cancelSeries: (sid) => rpc('cancel_session_series', { p_id: sid }),
    /** The people of a session (managers only). */
    async people(sid) { return list(await rpc('list_session_rsvps', { p_id: sid }), cleanPerson); },
    removePerson: (sid, rsvpId) => rpc('remove_session_participant', { p_session: sid, p_rsvp: rsvpId }),
    /** Marks someone present: kind 'rsvp' with a person's rsvpId, or 'code' with a friend code. Resolves { status: 'marked' | 'already_attended', display_name, xp? }. */
    mark: (sid, kind, ref) => rpc('mark_attended', { p_session: sid, p_kind: kind, p_ref: ref }),
    revoke: (sid, attendanceId, reason) => rpc('revoke_attendance', { p_session: sid, p_attendance: attendanceId, p_reason: reason }),
    invite: (sid, code, scope = 'occurrence') => rpc('invite_to_session', { p_session: sid, p_code: code, p_scope: scope }),
    revokeInvitation: (invId) => rpc('revoke_session_invitation', { p_id: invId }),
    async inviteList(sid) { return cleanInviteList(await rpc('list_session_invites', { p_session: sid })); },
    /** Resolves { id, token }: the only time the token exists in readable form. */
    createLink: (sid, { scope = 'occurrence', hours = 168, maxUses = 25 } = {}) => rpc('create_session_link', { p_session: sid, p_scope: scope, p_expires_hours: hours, p_max_uses: maxUses }),
    revokeLink: (linkId) => rpc('revoke_session_link', { p_id: linkId }),
    redeemLink: (token) => rpc('redeem_session_link', { p_token: token }),
    report: (sid, reason, note) => rpc('report_session', { p_session: sid, p_reason: reason, p_note: note || null }),
  };
}
