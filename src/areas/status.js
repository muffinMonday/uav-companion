// Community flying areas, Phase 2: the plain-language submission line and the panel's status labels (pure: no DOM, no Leaflet), shared by ui.js and the adapters.
const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
/** The plain-language line under a saved area for its submission state, or null. All text is set with textContent by the caller. */
export function submissionLine(st) {
  const on = st.sub?.submittedAt ? ` · submitted ${fmtDate(st.sub.submittedAt)}` : '';
  const edited = st.changed ? ' The draft has changed since: the submitted version is unchanged.' : '';
  switch (st.kind) {
    case 'sending': return 'Submitting…';
    case 'unsent': return 'Not submitted yet: the last attempt did not finish. Your draft is safe; you can submit again.';
    case 'pending': return `Pending review${on}. An administrator will look at it; you can withdraw it until then.${edited}`;
    case 'approved': return `Approved${on}.${edited}`;
    case 'rejected': return `Not approved${on}.${st.sub?.reason ? ' Reason: ' + st.sub.reason : ''}${edited}`;
    case 'withdrawn': return `Withdrawn${on}. Your draft stays here; you can submit it again.${edited}`;
    case 'missing': return 'Submitted earlier, but not found for the account you are signed in with. You can submit it again.';
    default: return null;
  }
}

export const CONTEXT_BADGE = { private: 'Private draft', pending: 'Pending review', rejected: 'Not approved', withdrawn: 'Withdrawn', 'public-approved': 'Approved community area' };
