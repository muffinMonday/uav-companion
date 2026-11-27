// Community flying areas, Phase 2: the client side of the submission functions (supabase/migrations/20261127110000_community_area_api.sql).
// Nothing here is called until a signed-in person chooses "Submit for review". The server re-validates everything; these checks only keep a bad
// response from reaching the screen. No owner or contributor identity is ever sent: the server derives it from the session.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
export const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'];
export const MAX_PENDING = 5;

const isoOrNull = (v) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
/** A photo reference from the server -> { id, width, height, caption } or null. The storage key never reaches the client. */
export function cleanPhoto(p) {
  if (!p || typeof p !== 'object' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(p.id))) return null;
  const n = (v) => (Number.isInteger(v) && v >= 1 && v <= 4000 ? v : null);
  return { id: p.id, width: n(p.width), height: n(p.height), caption: typeof p.caption === 'string' ? Array.from(p.caption.trim()).slice(0, 120).join('') : '', state: typeof p.state === 'string' ? p.state : null, sha: typeof p.sha256 === 'string' && /^[0-9a-f]{64}$/.test(p.sha256) ? p.sha256 : null };
}
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
export const isKey = (v) => typeof v === 'string' && KEY.test(v);

/** A fresh idempotency key: 36 characters of a random UUID. */
export function newKey() {
  const u = globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  return 'k-' + u;
}

/** The payload the server accepts for a validated local area (core.js record). Contains nothing about the person. */
/** `photo`: { mode: 'new', id } (a staged photo), { mode: 'keep' } (a revision keeps the published photo) or null/{ mode: 'none' } (no photo: a revision then removes the published one). */
export function buildPayload(area, key, photo = null) {
  const p = {
    idempotency_key: key, name: area.name, description: area.description ?? '', draw_kind: area.drawKind,
    geometry: { type: 'Polygon', coordinates: [area.geometry.coordinates[0].map((p) => [p[0], p[1]])] },
    spots: (area.spots ?? []).map((s) => ({ type: s.type, note: s.note ?? '', coordinates: [s.coordinates[0], s.coordinates[1]] })),
  };
  if (area.attributes && Object.keys(area.attributes).length) p.attributes = JSON.parse(JSON.stringify(area.attributes)); // left out when empty, so the fingerprint of an area without site details is unchanged
  if (photo?.mode === 'new' && isUuid(photo.id)) p.photo_id = photo.id; else if (photo?.mode === 'keep') p.keep_photo = true;
  return p;
}

/** A short fingerprint (FNV-1a) of what would be submitted: it only tells "changed since submitted" and "same content as the failed attempt"; the server decides. */
export function contentHash(area) {
  const { idempotency_key: _k, ...rest } = buildPayload(area, 'k');
  const s = JSON.stringify(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** { areaId, revisionId, revisionNo, status, submittedAt } from a submit_community_area result, or null. */
export function cleanSubmitResult(r) {
  if (!r || typeof r !== 'object' || !isUuid(r.area_id) || !isUuid(r.revision_id) || !STATUSES.includes(r.status)) return null;
  const submittedAt = isoOrNull(r.submitted_at);
  return submittedAt ? { areaId: r.area_id, revisionId: r.revision_id, revisionNo: Number.isInteger(r.revision_no) && r.revision_no >= 1 ? r.revision_no : 1, status: r.status, submittedAt, replayed: r.replayed === true } : null;
}

/** One list_my_community_areas row, or null. */
export function cleanListRow(r) {
  if (!r || typeof r !== 'object' || !isUuid(r.revision_id) || !isUuid(r.area_id) || !STATUSES.includes(r.status)) return null;
  const submittedAt = isoOrNull(r.submitted_at);
  if (!submittedAt) return null;
  return { areaId: r.area_id, revisionId: r.revision_id, name: typeof r.name === 'string' ? Array.from(r.name.trim()).slice(0, 80).join('') : '', revisionNo: Number.isInteger(r.revision_no) ? r.revision_no : 1, status: r.status, submittedAt, reviewedAt: isoOrNull(r.reviewed_at), reason: typeof r.review_reason === 'string' ? r.review_reason.slice(0, 500) : '', published: r.published === true };
}

const INVALID = {
  name: 'The name must be 1 to 80 characters.', description: 'The description can be at most 500 characters.', 'vertex-count': 'An area needs 3 to 100 points.',
  'bad-coordinate': 'A point has an invalid position.', 'duplicate-vertex': 'Two points are in the same place.', antimeridian: 'Areas that cross the 180° meridian are not supported.',
  'self-intersection': 'The outline crosses or touches itself.', degenerate: 'The points are in a line: the shape has no area.', 'too-large': 'The area is larger than 25 km².',
  holes: 'Polygons with holes are not supported.', geometry: 'The shape must be one polygon.', 'too-many-spots': 'An area can have at most 10 setup spots.',
  'bad-spot-type': 'A setup spot has an unknown type.', 'spot-outside': 'A setup spot is outside the area.', 'bad-note': 'A setup spot note is too long.', 'payload-size': 'The area is too large to submit.',
  photo: 'The photo choice is not valid.', attributes: 'The site details are not valid.', 'attributes-required': 'Choose the site environment and the access / permission status.',
};

/** Turns whatever failed into { code, message, retryable }. `retryable` means the request may or may not have reached the server, so the same key must be used again. */
export function describeError(e) {
  const raw = String(e?.message ?? e ?? '');
  const m = /invalid_area: ([a-z_-]+)/.exec(raw);
  if (m) return { code: 'invalid', detail: m[1], message: `The server did not accept this area: ${INVALID[m[1]] ?? 'it is not valid.'} Edit it and try again.`, retryable: false };
  if (/pending_limit_reached/.test(raw)) return { code: 'limit', message: `You already have ${MAX_PENDING} submissions waiting for review. Withdraw one or wait for a decision, then submit again.`, retryable: false };
  if (/idempotency_conflict/.test(raw)) return { code: 'conflict', message: 'This submission was changed after an earlier attempt. Press Submit again to send the current version.', retryable: false };
  if (/not_published/.test(raw)) return { code: 'not-published', message: 'This area is no longer published, so it cannot be changed. Your draft stays here.', retryable: false };
  if (/revision_pending/.test(raw)) return { code: 'revision-pending', message: 'A change to this area is already waiting for review. Wait for a decision or withdraw it first.', retryable: false };
  if (/photo_not_found/.test(raw)) return { code: 'photo-not-found', message: 'The photo is no longer available. Choose it again.', retryable: false, photoGone: true };
  if (/no_photo_to_keep/.test(raw)) return { code: 'no-photo-to-keep', message: 'This area has no published photo to keep. Choose a photo or none.', retryable: false };
  if (/identical_to_rejected/.test(raw)) return { code: 'identical-to-rejected', message: 'This is identical to a version an administrator already declined. Change something first, taking the reason you were given into account.', retryable: false };
  if (/no_change/.test(raw)) return { code: 'no-change', message: 'This is identical to the published version. Change something first.', retryable: false };
  if (/not_withdrawable/.test(raw)) return { code: 'not-withdrawable', message: 'This submission can no longer be withdrawn.', retryable: false };
  if (/not_found/.test(raw)) return { code: 'not-found', message: 'This submission was not found for the account you are signed in with.', retryable: false };
  if (/not signed in|JWT|28000|401/.test(raw)) return { code: 'signed-out', message: 'Your session has ended. Sign in again, then retry.', retryable: false };
  return { code: 'network', message: 'Could not reach the server. Your area is saved here; try again in a moment.', retryable: true };
}

/** What the screen needs from the account and the network. `getHandle` returns the sync UI handle (src/sync-ui.js) once the cloud code has loaded, else null. */
export function createCloudBackend(getHandle) {
  const h = () => getHandle?.() ?? null;
  const listeners = new Set();
  return {
    /** The app calls this whenever the account state may have changed (the cloud code loaded, signed in or out). */
    fire: () => { for (const f of listeners) { try { f(); } catch { /* ignore */ } } },
    available: () => !!h()?.adapter?.client,
    signedIn: () => !!h()?.sync?.status?.().session,
    signIn: () => h()?.open?.(),
    /** `opts.signal` (an AbortSignal) cancels the request where the client supports it (public viewport loading). */
    rpc: (fn, args, opts) => { const b = h().adapter.client.rpc(fn, args); return opts?.signal && typeof b.abortSignal === 'function' ? b.abortSignal(opts.signal) : b; },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    /** Optional location photos: the Edge Functions. photoUrl is the public address of one photo (an <img> cannot send a token); fetchPhoto reads one with the person's own session (owner or administrator preview). */
    functionsUrl: () => { const u = h()?.adapter?.client?.functions?.url; return u ? String(u).replace(/\/+$/, '') : null; },
    photoUrl(id) { const b = this.functionsUrl(); return b && isUuid(id) ? `${b}/area-photo?id=${encodeURIComponent(id)}` : null; },
    async upload(blob, mime, caption) { return fnCall(h(), 'area-photo-upload', { body: blob, headers: { 'Content-Type': mime, 'X-Caption': encodeURIComponent(caption || '') } }); },
    async fetchPhoto(id) { // not functions.invoke: it would read an image as text. A plain fetch with the person's own access token.
      const client = h()?.adapter?.client, url = this.photoUrl(id);
      if (!client || !url) return { error: { code: 'unavailable', message: 'Photos need an account.' } };
      try {
        const { data } = await client.auth.getSession(); const token = data?.session?.access_token;
        const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
        return r.ok ? { data: await r.blob() } : { error: { code: r.status === 404 ? 'not-found' : 'network', message: 'The photo is not available.' } };
      } catch { return { error: { code: 'network', message: 'Could not reach the server.' } }; }
    },
    async purgePhotos(ids) { return fnCall(h(), 'area-photo-cleanup', { body: { photo_ids: ids } }); },
  };
}

/** One Edge Function call through the signed-in client -> { data } or { error: { code, message } } (the answer's own code and message; never database text). */
async function fnCall(handle, name, opts) {
  const client = handle?.adapter?.client;
  if (!client?.functions) return { error: { code: 'unavailable', message: 'Photos need an account.' } };
  try {
    const { data, error } = await client.functions.invoke(name, opts);
    if (!error) return { data };
    let body = null; try { body = await error.context?.json?.(); } catch { body = null; }
    return { error: { code: body?.code ?? 'network', message: typeof body?.error === 'string' ? body.error : 'Could not reach the server. Try again.' } };
  } catch { return { error: { code: 'network', message: 'Could not reach the server. Try again.' } }; }
}

/** The three functions with validated results; failures throw { code, message, retryable }. */
export function createAreasApi(backend) {
  async function call(fn, args) {
    let res;
    try { res = await backend.rpc(fn, args); } catch (e) { throw describeError(e); }
    if (res?.error) throw describeError(res.error);
    return res?.data;
  }
  return {
    async submit(payload) {
      const r = cleanSubmitResult(await call('submit_community_area', { p_payload: payload }));
      if (!r) throw { code: 'bad-response', message: 'The server answered in an unexpected way. Try again.', retryable: true };
      return r;
    },
    /** A new revision of the contributor's own published area (submit_community_revision). The result has the same shape as submit(). */
    async submitRevision(areaId, payload) {
      if (!isUuid(areaId)) throw { code: 'not-found', message: 'This area was not found for the account you are signed in with.', retryable: false };
      const r = cleanSubmitResult(await call('submit_community_revision', { p_area_id: areaId, p_payload: payload }));
      if (!r || r.areaId !== areaId) throw { code: 'bad-response', message: 'The server answered in an unexpected way. Try again.', retryable: true };
      return r;
    },
    /** One of the caller's OWN revisions with its full content (get_my_community_revision), or null when it is not theirs or does not exist. */
    async myRevision(revisionId) {
      if (!isUuid(revisionId)) return null;
      const d = await call('get_my_community_revision', { p_revision_id: revisionId });
      if (d === null || d === undefined) return null;
      if (typeof d !== 'object' || !isUuid(d.area_id) || d.revision_id !== revisionId || !STATUSES.includes(d.status)) throw { code: 'bad-response', message: 'The server answered in an unexpected way. Try again.', retryable: true };
      return d;
    },
    /** Uploads one processed photo (Blob) -> { photoId, width, height, caption }; throws { code, message, retryable } (code is the server's: type, metadata, size, dimensions, caption, too_many_staged, daily_limit, network...). */
    async uploadPhoto(blob, mime, caption = '') {
      const r = await backend.upload(blob, mime, caption);
      if (r.error) throw { code: r.error.code, message: r.error.message, retryable: r.error.code === 'network' };
      const d = r.data;
      if (!d || !isUuid(d.photo_id)) throw { code: 'bad-response', message: 'The server answered in an unexpected way. Try again.', retryable: true };
      return { photoId: d.photo_id, width: d.width, height: d.height, caption: typeof d.caption === 'string' ? d.caption : '' };
    },
    /** The photo the contributor's published area shows (to keep it in a revision), or null. */
    async myAreaPhoto(areaId) { if (!isUuid(areaId)) return null; const d = await call('get_my_area_photo', { p_area_id: areaId }); return cleanPhoto(d); },
    async list() { const d = await call('list_my_community_areas', {}); return Array.isArray(d) ? d.map(cleanListRow).filter(Boolean) : []; },
    async withdraw(revisionId) {
      const d = await call('withdraw_community_revision', { p_revision_id: revisionId });
      if (!d || d.status !== 'withdrawn') throw { code: 'bad-response', message: 'The server answered in an unexpected way. Try again.', retryable: true };
      return { revisionId, status: 'withdrawn' };
    },
  };
}
