// Review 01 S10.7 (ACT-01 to ACT-04; G1 spec section 20): the global Activity inbox. Aggregates real pending/unread counts from the four
// sources ACT-02 names - friend requests and shared-trip invitations (`cloud.friends`, already combined by `friends-ui.js`), Flight
// Session invitations and notices (`cloud.sessions.summary()`), and account/sync notices (`cloud.handle.hasSignInNotice()`) - no new
// notification backend (explicit standing constraint). Each row deep-links to the exact destination the existing notification already
// opens today (ACT-04); this file reimplements none of those flows. Built as one more panel tab, the same adaptive-host primitive every
// other pane already uses (NAV-03).
import { el } from '../cards.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17v-6a6 6 0 1 1 12 0v6l1.5 2h-15L6 17Z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>';

function row(title, detail, actionLabel, onOpen, kind) {
  const r = el('div', `act-row act-${kind}`);
  const body = el('div', 'act-row-body');
  body.append(el('h3', '', title), el('p', 'hint', detail));
  const b = el('button', 'btn small', actionLabel);
  b.type = 'button';
  b.addEventListener('click', onOpen);
  r.append(el('span', `act-dot act-dot-${kind}`, ''), body, b);
  return r;
}

/** `cloud`: the same mutable holder `main.js` passes to friends-ui/party-ui/sessions-hub/account-ui - read-only here, never written. */
export function initActivityUI({ panel, cloud }) {
  const pane = el('section');
  pane.id = 'pane-activity';
  const list = el('div', 'act-list');
  pane.append(el('h2', '', 'Activity'), list);
  const tab = panel.addTab({ key: 'activity', label: 'Activity', icon: ICON, pane });

  function pendingCount() {
    const friends = (cloud.friends?.incoming ?? 0) + (cloud.friends?.invites ?? 0);
    const sessions = cloud.sessions?.summary?.().invites ?? 0;
    return friends + sessions;
  }

  function render() {
    list.replaceChildren();
    let any = false;
    if (!cloud.handle) {
      list.append(el('p', 'hint', 'Sign in to see friend requests, trip and session invitations here.'));
      return;
    }
    const friendReqs = cloud.friends?.incoming ?? 0;
    const tripInvites = cloud.friends?.invites ?? 0;
    if (friendReqs || tripInvites) {
      any = true;
      const parts = [];
      if (friendReqs) parts.push(`${friendReqs} friend request${friendReqs === 1 ? '' : 's'}`);
      if (tripInvites) parts.push(`${tripInvites} trip invitation${tripInvites === 1 ? '' : 's'}`);
      list.append(row('Needs your response', parts.join(' · '), 'Open Friends', () => cloud.friends?.open?.(), 'pending'));
    }
    const summary = cloud.sessions?.summary?.();
    if (summary) {
      if (summary.invites) { any = true; list.append(row('Session invitations', `${summary.invites} waiting`, 'Open', () => cloud.sessions.open('invites'), 'pending')); }
      if (summary.updates) { any = true; list.append(row('Session updates', `${summary.updates} unread`, 'Open', () => cloud.sessions.open('mine'), 'unread')); }
    } else if (cloud.handle) {
      // ACT-03's partial-failure rule: a source that is not available yet is shown, not silently omitted.
      list.append(el('p', 'hint', 'Session invitations and updates need an internet connection to this build’s project.'));
    }
    if (cloud.handle.hasSignInNotice?.()) {
      any = true;
      list.append(row('Sign-in needs attention', 'Google sign-in did not finish.', 'Open Account', () => document.getElementById('account-btn')?.click(), 'unread'));
    }
    if (!any) list.append(el('p', 'hint', 'Nothing waiting. Friend requests, trip and session invitations will show up here.'));
  }
  render();

  return {
    open: () => panel.open('activity'),
    el: pane,
    /** Called whenever one of the four sources changes, so the inbox and the bell's badge stay current. */
    refresh() { render(); tab.badge(pendingCount()); },
    pendingCount,
  };
}
