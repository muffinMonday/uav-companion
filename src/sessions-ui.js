// The Flight sessions card in the Friends tab: a short summary (your next session, invitations, updates) and a button that opens the Sessions hub (sessions-hub.js), where
// sessions are found, joined, planned and managed. Plain DOM, textContent only.
import { whenText } from './sessions.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** Lines to show for a hub summary ({ signedIn, ready, soon, next, invites, updates, takedowns }). */
export function summaryLines(s) {
  if (!s.signedIn) return ['Sign in to plan, join and manage flight sessions.'];
  if (!s.ready) return ['Loading sessions…'];
  const out = [];
  if (s.next) out.push(`Next: “${s.next.title}”, ${whenText(s.next.startsAt, s.next.endsAt)}.`);
  if (s.invites) out.push(s.invites === 1 ? '1 private invitation is waiting.' : `${s.invites} private invitations are waiting.`);
  if (s.updates) out.push(s.updates === 1 ? '1 update on a session you joined.' : `${s.updates} updates on sessions you joined.`);
  if (s.takedowns) out.push('A moderator took down one of your sessions.');
  return out.length ? out : ['You have no upcoming sessions.'];
}

/** `hub` is the Sessions hub. Returns { mount(host), reload(), reset() }: mount only draws; reload() asks the hub for a fresh summary (the Friends tab calls it when it loads); reset() forgets everything (sign-out). */
export function createSessionsCard({ hub }) {
  let host = null;
  const paint = (s = hub.summary()) => {
    if (!host) return;
    const c = el('div', 'ses-card');
    for (const t of summaryLines(s)) c.append(el('p', 'hint ses-line', t));
    const row = el('div', 'btn-row');
    const open = el('button', 'btn small primary', 'Open Sessions'); open.type = 'button'; open.id = 'ses-open';
    open.addEventListener('click', () => hub.open(s.invites ? 'invites' : s.signedIn ? 'mine' : 'discover'));
    const find = el('button', 'btn small', 'Find sessions'); find.type = 'button'; find.addEventListener('click', () => hub.open('discover'));
    row.append(open, find); c.append(row);
    host.replaceChildren(c);
  };
  hub.onSummary((s) => paint(s));
  return {
    mount(h) { host = h; paint(); },
    reload() { return hub.refresh(); },
    reset() { hub.reset(); },
  };
}
