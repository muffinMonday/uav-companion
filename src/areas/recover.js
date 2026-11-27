// Community flying areas, Stage 3: recovering the contributor's OWN submissions on this device (a cleared browser, a new phone). No DOM.
//   - Read-only on the server: list_my_community_areas (summary rows) and get_my_community_revision (one full revision, owner only). Nothing is ever sent from this device and nothing
//     on the server changes. A private draft that was never submitted is not on the server and is never uploaded by this module.
//   - What is rebuilt is the NEWEST revision the person submitted for an area, as an ordinary private local draft linked to that area and revision (the same `submission`
//     reference a normal submission leaves), so editing it and pressing Submit changes goes through the usual flow: a new pending revision, the published version untouched.
//   - Never a second local record for the same server area. If one exists, the person must explicitly choose to replace its content.
import { validateArea } from './core.js';
import { contentHash, createAreasApi } from './api.js';

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

/** list rows -> one entry per area, newest first: { areaId, name, latest, live, everApproved, revisions }. `name` is the newest revision's. */
export function groupRows(rows) {
  const by = new Map();
  for (const r of rows) { const l = by.get(r.areaId) ?? []; l.push(r); by.set(r.areaId, l); }
  const out = [];
  for (const [areaId, list] of by) {
    list.sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt) || b.revisionNo - a.revisionNo);
    out.push({ areaId, name: list[0].name || 'Flying area', latest: list[0], live: list.some((r) => r.published), everApproved: list.some((r) => r.status === 'approved'), revisions: list.length });
  }
  return out.sort((a, b) => Date.parse(b.latest.submittedAt) - Date.parse(a.latest.submittedAt));
}

/** The plain-language state of an entry, for the list. */
export function entryLine(e) {
  const l = e.latest, on = l.submittedAt ? ` · submitted ${when(l.submittedAt)}` : '';
  const pub = e.live ? ' The published version is live.' : e.everApproved ? ' It is not currently published.' : '';
  switch (l.status) {
    case 'approved': return e.live ? `Approved and published${on}.` : `Approved${on}. It is not currently published.`;
    case 'pending': return `${l.revisionNo > 1 ? 'Change pending review' : 'Pending review'}${on}.${pub}`;
    case 'rejected': return `${l.revisionNo > 1 ? 'Change not approved' : 'Not approved'}${on}.${pub}${l.reason ? ' Reason: ' + l.reason : ''}`;
    case 'withdrawn': return `${l.revisionNo > 1 ? 'Change withdrawn' : 'Withdrawn'}${on}.${pub}`;
    default: return '';
  }
}

/** The local submission reference for a recovered revision (server row `rev`, local content hash `hash`). A revision numbered above 1 was always a change to a published area. */
export function submissionFor(rev, hash) {
  const s = { status: rev.status, key: null, contentHash: hash, areaId: rev.area_id, revisionId: rev.revision_id, revisionNo: Number.isInteger(rev.revision_no) && rev.revision_no >= 1 ? rev.revision_no : 1 };
  if (typeof rev.submitted_at === 'string') s.submittedAt = rev.submitted_at;
  if (typeof rev.review_reason === 'string' && rev.review_reason) s.reason = rev.review_reason;
  if (s.revisionNo > 1) s.revision = true;
  return s;
}

/** `store`: the local area store; `backend`: createCloudBackend's. */
export function createRecovery({ store, backend }) {
  const api = createAreasApi(backend);
  const busy = new Set();
  /** The account's areas with what is already on this device: [{ ...entry, local: { id, name, changed } | null }]. Throws { code, message } when signed out or offline. */
  async function list() {
    if (!backend.available()) throw { code: 'unavailable', message: 'This version of the app has no account.' };
    if (!backend.signedIn()) throw { code: 'signed-out', message: 'Sign in to see your submissions.' };
    const entries = groupRows(await api.list());
    const locals = store.list();
    return entries.map((e) => {
      const l = locals.find((a) => a.submission?.areaId === e.areaId);
      return { ...e, local: l ? { id: l.id, name: l.name, changed: !l.submission?.contentHash || l.submission.contentHash !== contentHash(l) } : null };
    });
  }
  /**
   * Rebuilds the newest revision of `areaId` as a local draft. `replace` must be true to overwrite an existing local copy of that area (the screen asks first).
   * -> { ok, area, replaced } or { ok: false, code, message, existingId? } with code 'exists' | 'not-found' | 'invalid' | 'busy' | 'signed-out' | 'duplicate' | 'too-many-areas' | 'network'.
   */
  async function recover(areaId, { replace = false } = {}) {
    if (busy.has(areaId)) return { ok: false, code: 'busy', message: 'Already working on this area.' };
    if (!backend.available() || !backend.signedIn()) return { ok: false, code: 'signed-out', message: 'Sign in to recover your areas.' };
    busy.add(areaId);
    try {
      const entry = groupRows(await api.list()).find((e) => e.areaId === areaId);
      if (!entry) return { ok: false, code: 'not-found', message: 'This submission was not found for the account you are signed in with.' };
      const existing = store.list().find((a) => a.submission?.areaId === areaId) ?? null;
      if (existing && !replace) return { ok: false, code: 'exists', existingId: existing.id, message: 'This area is already on this device.' };
      const rev = await api.myRevision(entry.latest.revisionId);
      if (!rev) return { ok: false, code: 'not-found', message: 'This submission was not found for the account you are signed in with.' };
      const v = validateArea({ name: rev.name, description: typeof rev.description === 'string' ? rev.description : '', geometry: rev.geometry, spots: Array.isArray(rev.spots) ? rev.spots : [], drawKind: rev.draw_kind === 'rectangle' ? 'rectangle' : 'polygon' });
      if (!v.ok) return { ok: false, code: 'invalid', message: 'The server copy did not pass the local checks, so it was not restored.' };
      const r = store.restore(v.area, submissionFor(rev, contentHash(v.area)), { replaceId: existing && replace ? existing.id : null });
      if (!r.ok) return { ok: false, code: r.code ?? 'invalid', existingId: r.existingId, message: r.errors?.[0]?.message ?? 'It could not be restored.' };
      return { ok: true, area: r.area, replaced: !!existing };
    } catch (e) {
      return { ok: false, code: e?.code === 'signed-out' ? 'signed-out' : 'network', message: e?.message ?? 'Could not reach the server.' };
    } finally { busy.delete(areaId); }
  }
  return { list, recover, isBusy: (id) => busy.has(id) };
}
