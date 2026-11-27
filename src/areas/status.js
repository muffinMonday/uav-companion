// Community flying areas, Phase 2: the plain-language submission line and the panel's status labels (pure: no DOM, no Leaflet), shared by ui.js and the adapters.
const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
/** The plain-language line under a saved area for its submission state, or null. All text is set with textContent by the caller. */
export function submissionLine(st) {
  const on = st.sub?.submittedAt ? ` · submitted ${fmtDate(st.sub.submittedAt)}` : '';
  const rev = st.sub?.revision === true;
  const live = ' The published version stays live.';
  const edited = st.changed ? ' The draft has changed since: the submitted version is unchanged.' : '';
  switch (st.kind) {
    case 'sending': return 'Submitting…';
    case 'unsent': return 'Not submitted yet: the last attempt did not finish. Your draft is safe; you can submit again.';
    case 'pending': return rev ? `Change pending review${on}.${live} An administrator will look at it; you can withdraw it until then.${edited}` : `Pending review${on}. An administrator will look at it; you can withdraw it until then.${edited}`;
    case 'approved': return st.changed && st.sub?.areaId ? `Approved${on}. You have changes that are not submitted: the published version is unchanged until you submit them and an administrator approves.` : `Approved${on}.${edited}`;
    case 'rejected': return `${rev ? 'Change not approved' : 'Not approved'}${on}.${rev ? live : ''}${st.sub?.reason ? ' Reason: ' + st.sub.reason : ''}${edited}`;
    case 'withdrawn': return `${rev ? 'Change withdrawn' : 'Withdrawn'}${on}.${rev ? live : ''} Your draft stays here; you can submit it again.${edited}`;
    case 'missing': return 'Submitted earlier, but not found for the account you are signed in with. You can submit it again.';
    default: return null;
  }
}

export const CONTEXT_BADGE = { private: 'Private draft', pending: 'Pending review', rejected: 'Not approved', withdrawn: 'Withdrawn', 'public-approved': 'Approved community area' };

/** The badge in the details panel: a proposed change to a published area is named as such. */
export function badgeFor(context, sub) {
  if (sub?.revision === true) { const m = { pending: 'Change pending review', rejected: 'Change not approved', withdrawn: 'Change withdrawn' }[context]; if (m) return m; }
  return CONTEXT_BADGE[context];
}

/** The sentence a delete confirmation shows: deleting only ever removes the copy in this browser, and it says what that does NOT do. */
export function deleteWarning(sub) {
  if (sub?.status === 'approved' && sub.revisionId) return 'Delete this copy from this browser? The published community area stays public and is not affected. You will no longer be able to submit changes to it from here.';
  if (sub?.status === 'pending' && sub.revisionId) return 'Delete this copy from this browser? Its submission stays in review: this does not withdraw it, and you will not be able to withdraw it from here. Withdraw it first if you want it removed from review.';
  return 'Delete this area?';
}
