// Progression, the pure part: validating what the database returns (get_progression, list_progression, my_progression, my_xp_history), the progress towards the next rank,
// the achievement groups and labels. Every screen that shows a rank or an achievement uses these, so they all agree.
// Who may see what is decided by the database (supabase/migrations/20261114120000_progression_read.sql); nothing here asks for more than it is given.

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
export const CATEGORY_LABEL = { simulator: 'Simulator', community: 'Community', progression: 'Progression', platform: 'Platform' };
/** A small picture per icon key in the achievement definitions; an unknown key falls back to a star. */
const GLYPHS = { takeoff: '✈', gamepad: '🎮', headset: '🎧', medal: '🏅', handshake: '🤝', calendar: '📅', group: '👥', badge: '🎖', star: '⭐', 'chevron-up': '⬆', wings: '🕊', compass: '🧭', shield: '🛡', crown: '👑', link: '🔗', map: '🗺' };
export const glyphOf = (icon) => GLYPHS[icon] ?? '⭐';

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const slug = (v) => (typeof v === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(v) ? v : '');

/** XP with thousands separators: 3650 -> "3,650". */
export const xpText = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0');

/**
 * Makes a payload from the database safe to draw. Returns { visible: false } for a hidden or unusable one, otherwise
 * { visible, xp, tier, rankKey, rankName, tierMinXp, nextMinXp, nextName, max, unlockedCount, featured[], achievements[] }.
 */
export function cleanProgression(raw) {
  if (!raw || typeof raw !== 'object' || raw.visible !== true) return { visible: false };
  const xp = int(raw.xp), tier = int(raw.tier), tierMin = int(raw.tier_min_xp);
  if (xp === null || tier === null || tier < 1 || tierMin === null) return { visible: false };
  const nextMin = int(raw.next_min_xp);
  const out = {
    visible: true, xp, tier, rankKey: slug(raw.rank_key), rankName: text(raw.rank_name, 40) || 'Rank ' + tier, tierMinXp: tierMin,
    nextMinXp: nextMin, nextName: nextMin === null ? '' : text(raw.next_name, 40), max: raw.max === true || nextMin === null,
    unlockedCount: int(raw.unlocked_count) ?? 0,
    featured: Array.isArray(raw.featured) ? raw.featured.map(slug).filter(Boolean).slice(0, 3) : [],
    achievements: null,
  };
  if (Array.isArray(raw.achievements)) {
    out.achievements = raw.achievements.slice(0, 200).map((a) => (a && typeof a === 'object' ? {
      key: slug(a.key), category: slug(a.category) || 'other', name: text(a.name, 60), description: text(a.description, 200),
      rarity: RARITIES.includes(a.rarity) ? a.rarity : 'common', icon: slug(a.icon), unlocked: a.unlocked === true,
      unlockedAt: typeof a.unlocked_at === 'string' && !Number.isNaN(Date.parse(a.unlocked_at)) ? a.unlocked_at : null,
    } : null)).filter((a) => a && a.key && a.name);
    out.unlockedCount = out.achievements.filter((a) => a.unlocked).length;
  }
  return out;
}

/** Progress towards the next rank: { max, pct (0 to 100), into, span, remaining, nextName }. At the top rank there is no next rank, so max is true and the bar is not drawn. */
export function rankProgress(p) {
  if (!p?.visible) return null;
  if (p.max || p.nextMinXp === null) return { max: true, pct: 100, into: p.xp - p.tierMinXp, span: 0, remaining: 0, nextName: '' };
  const span = Math.max(1, p.nextMinXp - p.tierMinXp), into = Math.max(0, Math.min(span, p.xp - p.tierMinXp));
  return { max: false, pct: Math.round((into / span) * 100), into, span, remaining: Math.max(0, p.nextMinXp - p.xp), nextName: p.nextName };
}

/** The achievements grouped by category in the order the database gave them, with a label; locked ones included. */
export function groupAchievements(list) {
  const groups = [];
  for (const a of list ?? []) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) { g = { category: a.category, label: CATEGORY_LABEL[a.category] ?? a.category.charAt(0).toUpperCase() + a.category.slice(1), items: [] }; groups.push(g); }
    g.items.push(a);
  }
  return groups;
}

/** The featured achievements as definitions, in the person's order, for those the list holds and that are unlocked. */
export const featuredOf = (p) => (p?.achievements ? p.featured.map((k) => p.achievements.find((a) => a.key === k && a.unlocked)).filter(Boolean) : []);

/** One line of the XP history for the owner: { title, detail }. */
export function describeHistory(item) {
  const sign = item.amount > 0 ? '+' : item.amount < 0 ? '−' : '';
  const amt = sign + xpText(Math.abs(item.amount)) + ' XP';
  if (item.source === 'sim') return { title: amt, detail: 'Simulator playtime' };
  if (item.source === 'attendance') return { title: amt, detail: 'Flight session attended' };
  return { title: amt, detail: item.reason ? 'Adjusted by an administrator: ' + item.reason : 'Adjusted by an administrator' };
}

/** Makes a page of my_xp_history safe to draw: { items: [{ id, amount, source, reason, createdAt }], next }. */
export function cleanHistory(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.slice(0, 100).map((x) => (x && Number.isFinite(x.id) && Number.isFinite(x.amount) ? {
    id: x.id, amount: Math.trunc(x.amount), source: ['sim', 'attendance', 'admin'].includes(x.source) ? x.source : 'admin',
    reason: typeof x.reason === 'string' ? x.reason.slice(0, 200) : '', createdAt: typeof x.created_at === 'string' ? x.created_at : '',
  } : null)).filter(Boolean) : [];
  return { items, next: Number.isFinite(raw?.next) ? raw.next : null };
}
