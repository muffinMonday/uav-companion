// Community flying areas: the PRIVATE data adapter for the shared details panel (details.js). It reads the local store ("uavzones.v1.areas") and the Phase 2
// submission state, and decides which management actions exist for each state. details.js knows nothing about any of this: it only draws the view returned here.
// Works without an account: a guest sees the same panel (submitting is the only action that needs one, and it routes through the existing sign-in flow).
//
// view contract (shared with adapter-public.js): { key, context, caption, badge, byline, status, area, centre, dates, actions }
//   context: 'private' | 'pending' | 'rejected' | 'withdrawn' | 'public-approved'
//   actions: [{ act, label, primary?, danger?, confirm?, run() }]  `confirm`: the panel asks that sentence first. Editing never touches a submitted revision: only the local draft changes.
import { areaCentre } from './geo.js';
import { submissionLine, CONTEXT_BADGE } from './status.js';

const CONTEXT_OF = { pending: 'pending', rejected: 'rejected', withdrawn: 'withdrawn', approved: 'public-approved' }; // none, unsent, sending and missing stay private

/**
 * `ops`: { edit(id), remove(id), exportOne(id), startSubmit(id), withdraw(id) -> Promise } supplied by ui.js (the same functions the My flying areas list uses).
 * -> a view, or null when the area no longer exists.
 */
export function privateView({ store, submit, ops }, id) {
  const a = store.get(id);
  if (!a) return null;
  const st = submit.state(a);
  const context = CONTEXT_OF[st.kind] ?? 'private';
  const keepNote = 'Your submitted version stays exactly as it is; only your private draft changes.';
  const actions = [];
  const act = (o) => actions.push(o);
  switch (st.kind) {
    case 'pending':
      act({ act: 'edit', label: 'Edit draft', confirm: `Edit the local draft? ${keepNote}`, run: () => ops.edit(id) });
      act({ act: 'withdraw', label: 'Withdraw', confirm: 'Withdraw this submission? Your draft stays here.', run: () => ops.withdraw(id) });
      act({ act: 'export', label: 'Export', run: () => ops.exportOne(id) });
      break;
    case 'approved':
      act({ act: 'export', label: 'Export', run: () => ops.exportOne(id) });
      act({ act: 'edit', label: 'Edit local copy', confirm: `The approved version is published and stays as it is. ${keepNote} Edit your private copy?`, run: () => ops.edit(id) });
      break;
    case 'sending':
      break;
    default: {
      if (submit.eligible(a)) act({ act: 'submit', label: context === 'private' ? 'Submit for review' : 'Resubmit', primary: true, run: () => ops.startSubmit(id) });
      act({ act: 'edit', label: 'Edit', run: () => ops.edit(id) });
      act({ act: 'export', label: 'Export', run: () => ops.exportOne(id) });
      act({ act: 'delete', label: 'Delete', danger: true, confirm: 'Delete this area?', run: () => ops.remove(id) });
    }
  }
  return {
    key: `area:${a.id}`, context, caption: 'My flying area', badge: st.kind === 'sending' ? 'Submitting…' : CONTEXT_BADGE[context],
    byline: { text: 'Created by you' }, status: submissionLine(st),
    area: a, centre: areaCentre(a.geometry.coordinates[0]),
    dates: { modified: a.updated ?? null, observed: null }, // the last time the DRAFT was edited, never a physical visit
    actions,
  };
}
