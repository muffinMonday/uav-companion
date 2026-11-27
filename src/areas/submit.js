// Community flying areas, Phase 2: the submission workflow (no DOM). Save privately -> sign in -> acknowledge -> submit -> track.
// The local draft is never deleted or changed by any of this: only its `submission` reference is. A network failure leaves the draft and its idempotency key,
// so a retry cannot create a second submission; two presses of the button while one request is in flight are one request.
import { buildPayload, contentHash, newKey, createAreasApi } from './api.js';

export const INTENT_KEY = 'uavzones.v1.areas.intent';
const INTENT_MS = 30 * 60 * 1000;

/** `backend`: { available, signedIn, signIn, rpc, onChange } (api.js createCloudBackend, or a test double). */
export function createSubmitController({ store, backend, storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(), now = () => Date.now() }) {
  const api = createAreasApi(backend);
  const busy = new Set();
  const listeners = new Set();
  const notify = () => { for (const f of listeners) { try { f(); } catch { /* a listener must not break the workflow */ } } };
  let refreshing = false;

  /** 'none' | 'sending' | 'unsent' | 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'missing', and whether the draft changed since it was submitted. */
  function state(area) {
    const sub = area.submission;
    if (busy.has(area.id)) return { kind: 'sending', changed: false, sub };
    if (!sub) return { kind: 'none', changed: false, sub: null };
    return { kind: sub.status, changed: sub.status !== 'unsent' && !!sub.contentHash && sub.contentHash !== contentHash(area), sub };
  }
  /** A saved area can be submitted when it has no live submission (never sent, a failed attempt, withdrawn, rejected, or not found for this account). */
  /** The published area this submission would change, or null for a brand-new area. A revision is only ever proposed for an area the contributor got approved before (or a pending/rejected change to it). */
  const revisionTarget = (area) => { const s = area.submission; return s?.areaId && (s.revision || s.status === 'approved') ? s.areaId : null; };
  const isRevision = (area) => !!revisionTarget(area);
  /** A saved area can be submitted when it has no live submission (never sent, a failed attempt, withdrawn, rejected, or not found for this account), or, once approved, when the draft has changed since (a revision). */
  const eligible = (area) => {
    if (busy.has(area.id)) return false;
    const s = area.submission;
    if (!s) return true;
    if (['unsent', 'withdrawn', 'rejected', 'missing'].includes(s.status)) return true;
    return s.status === 'approved' && !!s.areaId && !!s.contentHash && s.contentHash !== contentHash(area);
  };

  async function submit(id) {
    if (busy.has(id)) return { ok: false, code: 'busy', message: 'Already sending.' };
    const area = store.get(id);
    if (!area) return { ok: false, code: 'not-found', message: 'That area no longer exists.' };
    if (!eligible(area)) return { ok: false, code: 'not-eligible', message: 'This area already has a submission waiting or approved.' };
    if (!backend.available()) return { ok: false, code: 'unavailable', message: 'Submitting needs an account, which this version of the app does not have.' };
    if (!backend.signedIn()) return { ok: false, code: 'signed-out', message: 'Sign in to submit.' };
    busy.add(id); notify();
    const previous = area.submission;
    const target = revisionTarget(area);
    const link = target ? { areaId: target, revision: true } : {};
    const hash = contentHash(area);
    const key = previous?.status === 'unsent' && previous.key && previous.contentHash === hash ? previous.key : newKey();
    store.setSubmission(id, { status: 'unsent', key, contentHash: hash, ...link }); // before the request: a reload or a dropped connection keeps the key for the retry
    try {
      const r = target ? await api.submitRevision(target, buildPayload(area, key)) : await api.submit(buildPayload(area, key));
      store.setSubmission(id, { status: r.status, key, contentHash: hash, areaId: r.areaId, revisionId: r.revisionId, revisionNo: r.revisionNo, submittedAt: r.submittedAt, ...(target ? { revision: true } : {}) });
      return { ok: true, replayed: r.replayed, status: r.status };
    } catch (e) {
      if (!e.retryable) store.setSubmission(id, previous && (previous.status !== 'unsent' || previous.revision) ? previous : null); // a definite refusal: forget this attempt's key
      return { ok: false, code: e.code ?? 'error', message: e.message ?? 'Could not submit.' };
    } finally { busy.delete(id); notify(); }
  }

  async function withdraw(id) {
    const area = store.get(id), sub = area?.submission;
    if (busy.has(id)) return { ok: false, code: 'busy', message: 'Please wait.' };
    if (!sub || sub.status !== 'pending' || !sub.revisionId) return { ok: false, code: 'not-eligible', message: 'Only a submission waiting for review can be withdrawn.' };
    if (!backend.available() || !backend.signedIn()) return { ok: false, code: 'signed-out', message: 'Sign in to withdraw a submission.' };
    busy.add(id); notify();
    try {
      await api.withdraw(sub.revisionId);
      store.setSubmission(id, { ...sub, status: 'withdrawn' });
      return { ok: true };
    } catch (e) {
      if (e.code === 'not-withdrawable') { busy.delete(id); await refresh(); }
      return { ok: false, code: e.code ?? 'error', message: e.message ?? 'Could not withdraw.' };
    } finally { busy.delete(id); notify(); }
  }

  /** Brings the status of linked local areas up to date from the account's own list. Does nothing when signed out or offline; never creates or deletes a local area. */
  async function refresh() {
    if (refreshing || !backend.available() || !backend.signedIn()) return false;
    if (!store.list().some((a) => a.submission?.revisionId)) return false;
    refreshing = true;
    try {
      const rows = new Map((await api.list()).map((r) => [r.revisionId, r]));
      for (const a of store.list()) {
        const sub = a.submission;
        if (!sub?.revisionId || busy.has(a.id)) continue;
        const row = rows.get(sub.revisionId);
        if (!row) { if (sub.status !== 'missing') store.setSubmission(a.id, { ...sub, status: 'missing' }); continue; }
        if (row.status !== sub.status || row.reason !== (sub.reason ?? '')) store.setSubmission(a.id, { ...sub, status: row.status, reason: row.reason, submittedAt: row.submittedAt });
      }
      return true;
    } catch { return false; } finally { refreshing = false; notify(); }
  }

  // The wish to submit, kept across the sign-in round trip (a Google redirect or an email link). It never submits anything: it only reopens the dialog.
  const intent = {
    set(areaId) { try { storage?.setItem(INTENT_KEY, JSON.stringify({ areaId, at: now() })); } catch { /* the person can press Submit again */ } },
    /** The area to offer for submission now, or null. Clears the note either way. */
    take() {
      let v = null;
      try { v = JSON.parse(storage?.getItem(INTENT_KEY) ?? 'null'); storage?.removeItem(INTENT_KEY); } catch { return null; }
      if (!v || typeof v.areaId !== 'string' || typeof v.at !== 'number' || now() - v.at > INTENT_MS || now() < v.at - 60000) return null;
      return store.get(v.areaId) ? v.areaId : null;
    },
  };

  return { state, eligible, isRevision, submit, withdraw, refresh, intent, isBusy: (id) => busy.has(id), onChange: (f) => { listeners.add(f); return () => listeners.delete(f); }, backend };
}
