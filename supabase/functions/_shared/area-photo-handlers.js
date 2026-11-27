// Community flying areas, optional location photo: the three Edge Function handlers, free of Deno and Supabase so Node tests run them against the real database functions (PGlite) and an in-memory
// object store (tests/areas-photo-fn-unit.mjs). `deps` supplies everything that touches the outside world:
//   getUser(authorization) -> { id } | null          verifies a session
//   rpc(fn, args)          -> data (throws Error with the database's message) as the SERVICE ROLE
//   storage.put(key, bytes, mime) / get(key) -> { bytes } | null / remove([keys])   the PRIVATE bucket 'area-photos'
//   env.cleanupSecret      the shared secret of the scheduled cleanup (absent = the secret path is off)
// Answers never carry database or platform error text. Objects are never listed or addressed by anything but the random photo id; the object key stays inside these handlers.
import { inspectImage, LIMITS, TYPES } from './area-photo.js';
import { logEvent, classify } from './log.js';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, x-caption, x-cleanup-secret, if-none-match', 'access-control-expose-headers': 'etag', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bearer = (req) => { const a = req.headers.get('authorization') || ''; return /^Bearer\s+\S+/i.test(a) ? a : ''; };
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function who(req, deps) { const a = bearer(req); if (!a) return null; try { const u = await deps.getUser(a); return u?.id ? u : null; } catch { return null; } }

/** POST: the processed photo as the request body (Content-Type image/jpeg|png|webp), caption in X-Caption (URL-encoded). -> 201 { photo_id, width, height, caption }. */
export async function handleUpload(req, deps) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'use POST' });
  const user = await who(req, deps);
  if (!user) return json(401, { error: 'not signed in' });
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[type]) return json(415, { error: 'Only JPEG, PNG and WebP photos are accepted.', code: 'type' });
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LIMITS.maxBytes) return json(413, { error: 'The photo is larger than 1 MB after processing.', code: 'size' });
  let bytes;
  try { bytes = new Uint8Array(await req.arrayBuffer()); } catch { return json(400, { error: 'The photo could not be read.', code: 'corrupt' }); }
  if (bytes.length > LIMITS.maxBytes) return json(413, { error: 'The photo is larger than 1 MB after processing.', code: 'size' });
  const seen = inspectImage(bytes, type);
  if (!seen.ok) return json(seen.code === 'size' ? 413 : 400, { error: seen.message, code: seen.code });
  let caption = '';
  try { caption = decodeURIComponent(req.headers.get('x-caption') || ''); } catch { return json(400, { error: 'The caption is not valid.', code: 'caption' }); }
  if (Array.from(caption).length > LIMITS.maxCaption) return json(400, { error: `The caption can be at most ${LIMITS.maxCaption} characters.`, code: 'caption' });
  if (seen.data) bytes = seen.data; // a JPEG that carried metadata is stored without it
  if (bytes.length > LIMITS.maxBytes) return json(413, { error: 'The photo is larger than 1 MB after processing.', code: 'size' });
  const key = `staged/${crypto.randomUUID()}.${seen.ext}`;
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
  let staged;
  try { staged = await deps.rpc('stage_area_photo', { p_owner: user.id, p_object_key: key, p_mime: seen.mime, p_bytes: bytes.length, p_sha256: sha, p_width: seen.width, p_height: seen.height, p_caption: caption }); }
  catch (e) {
    const m = String(e?.message ?? e);
    if (/too_many_staged/.test(m)) return json(429, { error: 'You already have three photos waiting. Submit or wait a day, then try again.', code: 'too_many_staged' });
    if (/daily_limit/.test(m)) return json(429, { error: 'You have uploaded the most photos allowed in one day. Try again tomorrow.', code: 'daily_limit' });
    if (/invalid_photo/.test(m)) return json(400, { error: 'The photo or caption is not valid.', code: 'invalid' });
    logEvent('error', 'area-photo-upload', 'stage_failed', { code: classify(e) }, deps.logOut);
    return json(500, { error: 'The photo could not be saved. Try again.', code: 'stage_failed' });
  }
  try { await deps.storage.put(key, bytes, seen.mime); }
  catch (e) {
    logEvent('error', 'area-photo-upload', 'store_failed', { code: classify(e) }, deps.logOut);
    try { await deps.rpc('discard_staged_photo', { p_owner: user.id, p_photo_id: staged.photo_id }); } catch { /* the 24-hour cleanup closes it */ }
    return json(502, { error: 'The photo could not be saved. Try again.', code: 'store_failed' });
  }
  try { await runCleanup(deps, { limit: 10 }); } catch { /* opportunistic: never blocks an upload */ }
  return json(201, { photo_id: staged.photo_id, width: staged.width, height: staged.height, caption: staged.caption });
}

/** GET ?id=<photo id>. The database decides (public / owner / administrator); everything else is 404, with the same body whether the photo exists or not. Revalidated on every request (no-cache + ETag),
 *  so an unpublication or removal takes effect on the next request and never waits for a cache lifetime. */
export async function handleView(req, deps) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'use GET' });
  const id = new URL(req.url).searchParams.get('id') || '';
  const gone = () => json(404, { error: 'not found' });
  if (!UUID.test(id)) return gone();
  const user = await who(req, deps);
  let acc = null;
  try { acc = await deps.rpc('area_photo_access', { p_photo_id: id, p_viewer: user?.id ?? null }); } catch (e) { logEvent('error', 'area-photo', 'access_failed', { code: classify(e) }, deps.logOut); return json(500, { error: 'try again' }); }
  if (!acc) return gone();
  const etag = `"${acc.sha256}"`;
  const headers = { ...CORS, 'content-type': acc.mime, etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'cross-origin', 'content-disposition': 'inline', 'referrer-policy': 'no-referrer' };
  if ((req.headers.get('if-none-match') || '').split(',').map((s) => s.trim()).includes(etag)) return new Response(null, { status: 304, headers });
  let obj = null;
  try { obj = await deps.storage.get(acc.object_key); } catch { obj = null; }
  if (!obj) return gone();
  return new Response(req.method === 'HEAD' ? null : obj.bytes, { status: 200, headers: { ...headers, 'content-length': String(obj.bytes.length) } });
}

/** Deletes the objects of photos that are due (staged for 24 hours, past delete_after, removed) and closes their rows. An object another live row still uses is kept. -> { deleted, shared, failed } */
export async function runCleanup(deps, { limit = 20, ids = null, admin = null } = {}) {
  const due = await deps.rpc('photos_due_for_deletion', { p_limit: limit, p_ids: ids, p_admin: admin });
  let deleted = 0, shared = 0, failed = 0;
  for (const d of Array.isArray(due) ? due : []) {
    try {
      if (!d.in_use) { await deps.storage.remove([d.object_key]); deleted++; } else shared++;
      await deps.rpc('mark_photo_deleted', { p_photo_id: d.id });
    } catch (e) { failed++; logEvent('error', 'area-photo-cleanup', 'delete_failed', { code: classify(e) }, deps.logOut); }
  }
  return { deleted, shared, failed };
}

function sameSecret(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/** POST. Either the scheduled run (header x-cleanup-secret equal to the secret; a bounded batch) or an administrator's urgent purge (Bearer token of an administrator and { photo_ids: [..] }). */
export async function handleCleanup(req, deps) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'use POST' });
  const secret = deps.env?.cleanupSecret;
  if (secret && sameSecret(req.headers.get('x-cleanup-secret') || '', secret)) {
    try { return json(200, await runCleanup(deps, { limit: 100 })); } catch (e) { logEvent('error', 'area-photo-cleanup', 'run_failed', { code: classify(e) }, deps.logOut); return json(500, { error: 'cleanup failed' }); }
  }
  const user = await who(req, deps);
  if (!user) return json(401, { error: 'not allowed' });
  let body = null; try { body = await req.json(); } catch { body = null; }
  const ids = Array.isArray(body?.photo_ids) ? body.photo_ids.filter((x) => typeof x === 'string' && UUID.test(x)).slice(0, 20) : [];
  if (!ids.length) return json(400, { error: 'send { "photo_ids": [...] }' });
  try { return json(200, await runCleanup(deps, { limit: 20, ids, admin: user.id })); }
  catch (e) { if (/not allowed|42501/.test(String(e?.message ?? e))) return json(403, { error: 'not allowed' }); logEvent('error', 'area-photo-cleanup', 'purge_failed', { code: classify(e) }, deps.logOut); return json(500, { error: 'purge failed' }); }
}
