// Community flying areas, Phase 3: the client side of the moderation functions (supabase/migrations/20261127130000_community_area_moderation.sql).
// Presentation only: every function re-checks has_role(auth.uid(), 'admin') on the server, so hiding the screen from non-administrators is a convenience, not the
// protection. Nothing here names a reviewer, contributor or XP recipient: the server derives all three.
import { validateArea } from './core.js';
import { isUuid, STATUSES } from './api.js';

export const XP_AMOUNTS = [100, 200, 300, 400, 500];
export const XP_DEFAULT = 100;
export const MAX_REASON = 500;
export const PAGE = 20;

const iso = (v) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

/** One moderation item from list_pending_community_areas / list_published_community_areas, or null when it is not a well-formed item. */
export function cleanItem(r) {
  if (!r || typeof r !== 'object' || !isUuid(r.revision_id) || !isUuid(r.area_id) || !STATUSES.includes(r.status)) return null;
  const submittedAt = iso(r.submitted_at);
  if (!submittedAt || typeof r.name !== 'string') return null;
  const v = validateArea({ name: r.name, description: typeof r.description === 'string' ? r.description : '', geometry: r.geometry, spots: Array.isArray(r.spots) ? r.spots : [], drawKind: r.draw_kind === 'rectangle' ? 'rectangle' : 'polygon' });
  const code = typeof r.contributor_code === 'string' && /^[0-9a-f]{10}$/.test(r.contributor_code) ? r.contributor_code : '';
  return {
    revisionId: r.revision_id, areaId: r.area_id, revisionNo: Number.isInteger(r.revision_no) && r.revision_no >= 1 ? r.revision_no : 1, status: r.status,
    name: r.name.slice(0, 80), description: typeof r.description === 'string' ? r.description.slice(0, 500) : '',
    ring: v.ok ? v.area.geometry.coordinates[0] : null, spots: v.ok ? v.area.spots : [], valid: v.ok, drawKind: r.draw_kind === 'rectangle' ? 'rectangle' : 'polygon',
    areaM2: Number.isFinite(r.area_m2) ? r.area_m2 : (v.ok ? v.area.areaM2 : 0), submittedAt,
    contributorName: typeof r.contributor_name === 'string' ? Array.from(r.contributor_name).slice(0, 40).join('') : '', contributorCode: code,
    own: r.own === true, hasPublished: r.has_published === true,
  };
}

/** { items, next } from a page; `next` is the cursor to pass back, or null at the end. */
export function cleanPage(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.slice(0, 50).map(cleanItem).filter(Boolean) : [];
  const c = raw?.next_cursor;
  const next = c && typeof c === 'object' && iso(c.at) && isUuid(c.id) ? { at: c.at, id: c.id } : null;
  return { items, next };
}

/** The reason as the server will store it: trimmed; { ok, text, message }. A rejection and an unpublish need one; an approval note is optional. */
export function checkReason(text, required) {
  const t = String(text ?? '').trim();
  if (required && !t) return { ok: false, text: t, message: 'Give a reason: the contributor will see it.' };
  if (t.length > MAX_REASON) return { ok: false, text: t, message: `The reason can be at most ${MAX_REASON} characters (now ${t.length}).` };
  return { ok: true, text: t, message: '' };
}

/** The reward as sent: { award, amount }. Only 100 to 500 in steps of 100 is a valid reward; an own submission never carries one. */
export function checkReward(award, amount, own) {
  if (!award) return { ok: true, award: false, amount: null };
  if (own) return { ok: false, award: false, amount: null, message: 'You cannot award yourself XP.' };
  const n = Number(amount);
  return XP_AMOUNTS.includes(n) ? { ok: true, award: true, amount: n } : { ok: false, award: false, amount: null, message: 'Choose 100, 200, 300, 400 or 500 XP.' };
}

const FAILS = {
  'not allowed': 'Only administrators can do this.', not_pending: 'Someone has already decided this submission. The list has been refreshed.',
  not_found: 'That submission no longer exists.', not_published: 'That area is not published.', reason_required: 'A reason is required (at most 500 characters).',
  invalid_xp_amount: 'Choose 100, 200, 300, 400 or 500 XP.', self_award_not_allowed: 'You cannot award yourself XP.', no_recipient: 'This contributor no longer has an account, so no XP can be awarded.',
  invalid_decision: 'That decision is not valid.', already_awarded: 'XP for this revision was already awarded.',
};
export function describeAdminError(e) {
  const raw = String(e?.message ?? e ?? '');
  for (const [k, m] of Object.entries(FAILS)) if (raw.includes(k)) return { code: k.replace(/\s/g, '_'), message: m, retryable: false };
  if (/not signed in|JWT|28000|401/.test(raw)) return { code: 'signed-out', message: 'Your session has ended. Sign in again.', retryable: false };
  if (/permission denied|42501/.test(raw)) return { code: 'not_allowed', message: FAILS['not allowed'], retryable: false };
  return { code: 'network', message: 'Could not reach the server. Nothing was changed that you can see; refresh the list and check.', retryable: true };
}

/** `backend`: the same object api.js createCloudBackend returns. */
export function createAdminApi(backend) {
  async function call(fn, args) {
    let res;
    try { res = await backend.rpc(fn, args); } catch (e) { throw describeAdminError(e); }
    if (res?.error) throw describeAdminError(res.error);
    return res?.data;
  }
  return {
    /** True only for an administrator (presentation: the server decides each call). Any failure is "not an administrator". */
    async isAdmin() { try { return (await call('my_roles', {}))?.admin === true; } catch { return false; } },
    async listPending(cursor = null, limit = PAGE) { return cleanPage(await call('list_pending_community_areas', { p_cursor: cursor, p_limit: limit })); },
    async listPublished(cursor = null, limit = PAGE) { return cleanPage(await call('list_published_community_areas', { p_cursor: cursor, p_limit: limit })); },
    /** decision 'approve' | 'reject'. Validates like the server before sending. */
    async review(item, decision, { reason = '', award = false, amount = null } = {}) {
      const r = checkReason(reason, decision === 'reject'); if (!r.ok) throw { code: 'reason_required', message: r.message, retryable: false };
      const w = decision === 'approve' ? checkReward(award, amount, item.own) : { ok: true, award: false, amount: null };
      if (!w.ok) throw { code: 'invalid_xp_amount', message: w.message, retryable: false };
      const d = await call('review_community_area', { p_revision_id: item.revisionId, p_decision: decision, p_reason: r.text || null, p_award_xp: w.award, p_xp_amount: w.amount });
      if (!d || !['approved', 'rejected'].includes(d.status)) throw { code: 'bad-response', message: 'The server answered in an unexpected way. Refresh the list.', retryable: true };
      return { status: d.status, changed: d.changed === true, xpAwarded: d.xp_awarded === true, xp: Number.isFinite(d.xp) ? d.xp : 0 };
    },
    async unpublish(item, reason) {
      const r = checkReason(reason, true); if (!r.ok) throw { code: 'reason_required', message: r.message, retryable: false };
      const d = await call('unpublish_community_area', { p_area_id: item.areaId, p_reason: r.text });
      if (!d || d.status !== 'unpublished') throw { code: 'bad-response', message: 'The server answered in an unexpected way. Refresh the list.', retryable: true };
      return { status: 'unpublished' };
    },
  };
}
