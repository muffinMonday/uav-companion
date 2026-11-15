// The XP badge of a session, one helper for Discover rows, Map Explorer cards and the detail view. The amount comes from the database (`xpReward`, null = no XP possible); nothing here knows 50.

/** { label, title } for a session, or null when the database says no XP is possible (or does not say). The wording says what is true: the XP follows verified attendance, never RSVP. */
export function xpBadgeInfo(s) {
  const n = s?.xpReward;
  if (!Number.isInteger(n) || n <= 0) return null;
  return { label: `+${n} XP`, title: `You can earn ${n} XP here once your attendance is verified. RSVP alone earns none.` };
}

/**
 * The EXP rule that applies to this person in a session's details, as one sentence, or null when they cannot earn XP here.
 * A participant gets the session's own amount (`xpReward`); a host gets the database's host reward rates (`rates` from sessions.js xpRates),
 * never a number kept in the app. Only for a scheduled session: a closed one has already paid.
 */
export function xpExplainText(s, rates) {
  if (!s || s.status !== 'scheduled') return null;
  if (s.isHost) {
    if (!rates || rates.hostBase + rates.hostPerAttendee <= 0) return null;
    return `Earn ${rates.hostBase} XP when the session closes, plus ${rates.hostPerAttendee} XP for each verified attendee. At least one verified attendee is required for the host reward.`;
  }
  const n = s.xpReward;
  if (!Number.isInteger(n) || n <= 0) return null;
  return `Earn ${n} XP when your attendance is verified. RSVP alone earns no XP.`;
}

/** The badge element, or null. */
export function xpBadge(s) {
  const i = xpBadgeInfo(s); if (!i) return null;
  const b = document.createElement('span'); b.className = 'badge xp'; b.textContent = i.label; b.title = i.title; b.dataset.xp = String(s.xpReward);
  b.setAttribute('aria-label', i.title);
  return b;
}
