// Progression on screen: the rank badge, the progression card (own profile and other people's profiles), the achievement collection and the XP history.
// One set of components with a `mode` ('self' or 'other') so every screen draws the same thing from the same data (see progression.js). Plain DOM, textContent only.
import { RARITY_LABEL, glyphOf, rankProgress, groupAchievements, featuredOf, describeHistory, xpText } from './progression.js';
import { onDialogSwipe } from './swipe.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, cls = 'btn small') => { const b = el('button', cls, label); b.type = 'button'; return b; };
const day = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

/** A small round badge with the tier number, ringed in the rank's colour (the same colour the map marker ring will use). */
export function rankBadge(p, size = 22) {
  const b = el('span', 'rank-badge', String(p.tier));
  b.dataset.tier = String(p.tier);
  b.style.setProperty('--rank', `var(--rank-${Math.min(10, Math.max(1, p.tier))})`);
  b.style.setProperty('--rb', size + 'px');
  b.title = p.rankName + ' (tier ' + p.tier + ')'; b.setAttribute('role', 'img'); b.setAttribute('aria-label', p.rankName + ', tier ' + p.tier);
  return b;
}

/** One achievement as a tile: picture, name, rarity, how to earn it, and whether it is unlocked. */
export function achievementTile(a, { self = false } = {}) {
  const t = el('div', 'ach-tile rar-' + a.rarity); t.dataset.key = a.key; t.dataset.unlocked = String(a.unlocked);
  const g = el('span', 'ach-glyph', glyphOf(a.icon)); g.setAttribute('aria-hidden', 'true');
  const body = el('div', 'ach-body');
  const head = el('div', 'ach-head'); head.append(el('b', 'ach-name', a.name), el('span', 'ach-rarity', RARITY_LABEL[a.rarity]));
  body.append(head, el('small', 'ach-desc', a.description));
  body.append(el('small', 'ach-state', a.unlocked ? (self && a.unlockedAt ? 'Unlocked ' + day(a.unlockedAt) : 'Unlocked') : 'Locked'));
  t.append(g, body);
  return t;
}

/** The part every screen shares: rank badge, rank name, tier, exact XP and progress to the next rank (or the maximum-rank line at Ace, with no bar). */
export function progressionSummary(p) {
  const c = el('div', 'prog-summary');
  const head = el('div', 'prog-head');
  head.append(rankBadge(p, 40));
  const who = el('div', 'prog-who');
  who.append(el('b', 'prog-rank', p.rankName), el('small', 'prog-tier', 'Tier ' + p.tier));
  const xp = el('div', 'prog-xp'); xp.append(el('b', '', xpText(p.xp)), el('small', '', 'XP'));
  head.append(who, xp);
  c.append(head);

  const prog = rankProgress(p);
  if (prog.max) {
    const m = el('p', 'prog-max', 'Maximum rank reached'); m.dataset.max = 'true';
    c.append(m);
  } else {
    const bar = el('div', 'prog-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(prog.pct));
    bar.setAttribute('aria-label', 'Progress to ' + prog.nextName);
    const fill = el('i', 'prog-fill'); fill.style.width = prog.pct + '%'; bar.append(fill);
    c.append(bar, el('small', 'prog-next', xpText(prog.remaining) + ' XP to ' + prog.nextName + ' (' + xpText(p.nextMinXp) + ' XP)'));
  }
  return c;
}

/** The small card shown when a rank-ringed map pin is selected: the person's name and the summary, nothing else (no achievements, no buttons). */
export function progressionMini(p, name) {
  const c = el('div', 'prog-mini'); c.dataset.tier = String(p.tier);
  c.append(el('b', 'prog-mini-name', name), progressionSummary(p));
  return c;
}

/**
 * The progression card. `status` is 'loading', 'error' or 'ready'; `p` is a cleaned payload (progression.js). `handlers`: onCollection(), onHistory() (self only), onRetry().
 * Draws: rank and tier, exact XP, progress to the next rank (or the maximum-rank state at Ace), featured achievements, and the buttons to the collection and history.
 */
export function progressionCard({ status = 'ready', p = null, mode = 'other', handlers = {} } = {}) {
  const c = el('div', 'prog-card'); c.dataset.status = status; c.dataset.mode = mode;
  if (status === 'loading') { c.append(el('p', 'hint', 'Loading progression…')); return c; }
  if (status === 'error') {
    c.append(el('p', 'hint', 'Progression is unavailable right now.'));
    if (handlers.onRetry) { const r = btn('Try again'); r.addEventListener('click', handlers.onRetry); c.append(r); }
    return c;
  }
  if (!p?.visible) { c.dataset.status = 'hidden'; c.append(el('p', 'hint', mode === 'self' ? 'Your progression is not available.' : 'Progression is not shown for this person.')); return c; }

  c.dataset.tier = String(p.tier);
  c.append(progressionSummary(p));
  if (p.xp === 0) c.append(el('p', 'hint', mode === 'self' ? 'No XP yet. Fly in an approved simulator or attend a flight session to earn some.' : 'No XP yet.'));

  const feat = featuredOf(p);
  if (feat.length) {
    const row = el('div', 'prog-featured'); row.setAttribute('aria-label', 'Featured achievements');
    for (const a of feat) { const chip = el('span', 'ach-chip rar-' + a.rarity); chip.title = a.name + ' (' + RARITY_LABEL[a.rarity] + ')'; const g = el('span', '', glyphOf(a.icon)); g.setAttribute('aria-hidden', 'true'); chip.append(g, ' ' + a.name); row.append(chip); }
    c.append(row);
  } else if (p.unlockedCount === 0) c.append(el('p', 'hint', mode === 'self' ? 'No achievements yet.' : 'No achievements unlocked yet.'));
  else if (mode === 'self') c.append(el('p', 'hint', 'Open your achievements to feature up to three on your profile.'));

  const row = el('div', 'btn-row');
  const total = p.achievements ? p.achievements.length : 0;
  const col = btn('Achievements' + (total ? ` ${p.unlockedCount}/${total}` : ` ${p.unlockedCount}`)); col.dataset.act = 'collection';
  col.addEventListener('click', () => handlers.onCollection?.());
  row.append(col);
  if (mode === 'self' && handlers.onHistory) { const h = btn('XP history'); h.dataset.act = 'history'; h.addEventListener('click', () => handlers.onHistory()); row.append(h); }
  c.append(row);
  return c;
}

/**
 * Fills `host` with the progression card for a person, going through loading and error. `load()` resolves a cleaned payload; `mode` is 'self' or 'other'.
 * Returns { reload() }. A late answer for an earlier request is ignored.
 */
export function mountProgression(host, { load, peek = null, mode = 'other', api = null, toast = () => {}, onDraw = () => {} }) {
  let seq = 0;
  const draw = (state) => { host.replaceChildren(progressionCard({ ...state, mode, handlers: {
    onRetry: () => reload(),
    onCollection: () => state.p && openCollection({ p: state.p, mode, api, toast, onChange: (np) => draw({ status: 'ready', p: np }) }),
    onHistory: mode === 'self' && api ? () => openHistory({ api }) : null,
  } })); onDraw(); };
  async function reload() {
    const mine = ++seq;
    draw({ status: 'loading' });
    try { const p = await load(); if (mine === seq) draw({ status: 'ready', p }); } catch { if (mine === seq) draw({ status: 'error' }); }
  }
  const cached = peek?.(); // a fresh answer we already hold is drawn at once, so redrawing a screen does not flash "Loading"
  if (cached) draw({ status: 'ready', p: cached }); else reload();
  return { reload };
}

// ---------- the collection and the history, in one dialog

let dlg = null;
function dialog() {
  if (!dlg) { dlg = el('dialog', 'account-dialog prog-dialog'); dlg.id = 'prog-dialog'; dlg.setAttribute('aria-labelledby', 'prog-dialog-title'); document.body.append(dlg); onDialogSwipe(dlg); }
  return dlg;
}
function frame(title) {
  const d = dialog(); d.replaceChildren();
  const h = el('h2', '', title); h.id = 'prog-dialog-title';
  const close = btn('Close'); close.addEventListener('click', () => d.close());
  d.append(h);
  return { d, close };
}

/** All achievements, locked ones with how to earn them. For your own profile each unlocked one can be featured (up to three). `onChange(newP)` runs after a featured change. */
export function openCollection({ p, mode = 'other', api = null, toast = () => {}, onChange = () => {} }) {
  const self = mode === 'self';
  const { d, close } = frame('Achievements');
  const list = p.achievements ?? [];
  const sum = el('p', 'hint prog-sum', `${list.filter((a) => a.unlocked).length} of ${list.length} unlocked`);
  d.append(sum);
  if (!list.length) d.append(el('p', 'hint', 'No achievements to show.'));
  let featured = [...p.featured];
  for (const g of groupAchievements(list)) {
    const sec = el('section', 'ach-group'); sec.append(el('h3', '', g.label));
    for (const a of g.items) {
      const t = achievementTile(a, { self });
      if (self && a.unlocked && api) {
        const on = featured.includes(a.key);
        const f = btn(on ? 'Featured' : 'Feature'); f.dataset.act = 'feature'; f.setAttribute('aria-pressed', String(on));
        f.addEventListener('click', async () => {
          const next = featured.includes(a.key) ? featured.filter((k) => k !== a.key) : [...featured, a.key];
          if (next.length > 3) { toast('You can feature up to three achievements.'); return; }
          f.disabled = true;
          try { featured = await api.setFeatured(next); onChange({ ...p, featured }); openCollection({ p: { ...p, featured }, mode, api, toast, onChange }); }
          catch (e) { toast(e.message || 'Could not save.'); f.disabled = false; }
        });
        t.append(f);
      }
      sec.append(t);
    }
    d.append(sec);
  }
  const row = el('div', 'btn-row'); row.append(close); d.append(row);
  if (!d.open) d.showModal();
}

/** The caller's own XP history, newest first, a page at a time. Admin adjustments show their reason. */
export function openHistory({ api }) {
  const { d, close } = frame('XP history');
  const ul = el('ul', 'prog-hist'); const msg = el('p', 'hint'); const more = btn('Show more'); more.hidden = true;
  const row = el('div', 'btn-row'); row.append(more, close);
  d.append(ul, msg, row);
  let next = null, busy = false;
  async function page() {
    if (busy) return; busy = true; msg.textContent = '';
    try {
      const r = await api.history(next, 30);
      for (const x of r.items) {
        const line = describeHistory(x); const li = el('li', 'prog-hist-row'); li.dataset.source = x.source;
        li.append(el('b', x.amount < 0 ? 'neg' : 'pos', line.title), el('small', '', line.detail + (x.createdAt ? ' · ' + day(x.createdAt) : '')));
        ul.append(li);
      }
      next = r.next; more.hidden = next === null;
      if (!ul.children.length) msg.textContent = 'No XP yet.';
    } catch { msg.textContent = 'The history is unavailable right now.'; }
    busy = false;
  }
  more.addEventListener('click', page);
  if (!d.open) d.showModal();
  page();
}
