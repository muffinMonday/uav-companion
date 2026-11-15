// The XP badge of a session, one helper for Discover rows, Map Explorer cards and the detail view. The amount comes from the database (`xpReward`, null = no XP possible); nothing here knows 50.

/** { label, title } for a session, or null when the database says no XP is possible (or does not say). The wording says what is true: the XP follows verified attendance, never RSVP. */
export function xpBadgeInfo(s) {
  const n = s?.xpReward;
  if (!Number.isInteger(n) || n <= 0) return null;
  return { label: `+${n} XP`, title: `You can earn ${n} XP here once your attendance is verified. RSVP alone earns none.` };
}

/** The badge element, or null. */
export function xpBadge(s) {
  const i = xpBadgeInfo(s); if (!i) return null;
  const b = document.createElement('span'); b.className = 'badge xp'; b.textContent = i.label; b.title = i.title; b.dataset.xp = String(s.xpReward);
  b.setAttribute('aria-label', i.title);
  return b;
}
