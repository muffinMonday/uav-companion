// The pure side of progression (src/progression.js) and its database wrapper with a cache (src/progression-api.js). No browser, no network.
import { cleanProgression, rankProgress, groupAchievements, featuredOf, describeHistory, cleanHistory, xpText, glyphOf, RARITIES } from '../src/progression.js';
import { createProgression } from '../src/progression-api.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const raw = (o = {}) => ({ visible: true, xp: 350, tier: 3, rank_key: 'cadet', rank_name: 'Cadet', tier_min_xp: 250, next_min_xp: 450, next_name: 'Novice', max: false, unlocked_count: 2, featured: ['moving-up'],
  achievements: [
    { key: 'moving-up', category: 'progression', name: 'Moving Up', description: 'Reach the Cadet rank.', rarity: 'common', icon: 'chevron-up', unlocked: true, unlocked_at: '2026-11-14T10:00:00Z' },
    { key: 'first-flight', category: 'simulator', name: 'First Flight', description: 'Complete 1 hour.', rarity: 'common', icon: 'takeoff', unlocked: false },
    { key: 'ace-pilot', category: 'progression', name: 'Ace Pilot', description: 'Reach Ace.', rarity: 'legendary', icon: 'crown', unlocked: false },
  ], ...o });

// ---------- cleaning
let p = cleanProgression(raw());
ok(p.visible && p.xp === 350 && p.tier === 3 && p.rankName === 'Cadet' && p.rankKey === 'cadet' && p.tierMinXp === 250 && p.nextMinXp === 450 && p.nextName === 'Novice' && p.max === false, 'a good payload is read into camelCase fields');
ok(p.achievements.length === 3 && p.unlockedCount === 1 && p.achievements[0].unlockedAt === '2026-11-14T10:00:00Z' && p.achievements[1].unlockedAt === null, 'the unlocked count follows the list, and a locked one has no time');
for (const bad of [null, undefined, 5, 'x', {}, { visible: false }, { visible: 'true' }, raw({ xp: -1 }), raw({ xp: 'many' }), raw({ tier: 0 }), raw({ tier: null }), raw({ tier_min_xp: null })]) ok(cleanProgression(bad).visible === false, 'not drawn as progression: ' + JSON.stringify(bad)?.slice(0, 40));
ok(JSON.stringify(cleanProgression({ visible: false })) === '{"visible":false}', 'a hidden answer stays exactly hidden');
p = cleanProgression(raw({ rank_name: 'x'.repeat(100), featured: ['a', 'B!', 'c', 'd', 'e'], achievements: [{ key: 'ok', name: 'N', rarity: 'mythic', unlocked: 'yes' }, { key: '', name: 'No key' }, null, 7], tier: 99 }));
ok(p.rankName.length === 40 && p.featured.join() === 'a,c,d' && p.achievements.length === 1 && p.achievements[0].rarity === 'common' && p.achievements[0].unlocked === false, 'text is capped, bad keys dropped, featured limited to three, an unknown rarity becomes common, junk rows are dropped');
ok(cleanProgression(raw({ achievements: undefined })).achievements === null, 'a brief payload (no collection) has achievements null');
ok(cleanProgression(raw({ next_min_xp: null, next_name: null, max: true })).max === true && cleanProgression(raw({ next_min_xp: null, max: false })).max === true, 'no next rank means maximum, whatever max says');
ok(RARITIES.join() === 'common,rare,epic,legendary', 'four rarities, in order');

// ---------- progress to the next rank
const rp = (xp, tierMin, nextMin) => rankProgress(cleanProgression(raw({ xp, tier_min_xp: tierMin, next_min_xp: nextMin, max: nextMin === null })));
let r = rp(0, 0, 100);
ok(r.pct === 0 && r.remaining === 100 && r.span === 100 && r.max === false && r.nextName === 'Novice', 'no XP: 0 percent, 100 to go');
r = rp(99, 0, 100); ok(r.pct === 99 && r.remaining === 1, 'one XP short of the next rank: 99 percent');
r = rp(100, 100, 250); ok(r.pct === 0 && r.remaining === 150, 'exactly on a threshold starts the next bar at 0 percent');
r = rp(175, 100, 250); ok(r.pct === 50 && r.into === 75 && r.span === 150 && r.remaining === 75, 'halfway through Trainee: 50 percent');
r = rp(3500, 3500, null); ok(r.max === true && r.pct === 100 && r.remaining === 0 && r.span === 0, 'at Ace there is no next rank: maximum, no remaining XP');
r = rp(3650, 3500, null); ok(r.max === true && r.into === 150, 'past 3500 XP the rank stays maximum and the extra XP is kept');
ok(rankProgress({ visible: false }) === null && rankProgress(null) === null, 'a hidden person has no progress');
r = rp(10, 100, 250); ok(r.pct === 0, 'a total below its tier floor is clamped, never negative');

// ---------- collection helpers
p = cleanProgression(raw());
const gs = groupAchievements(p.achievements);
ok(gs.length === 2 && gs[0].category === 'progression' && gs[0].label === 'Progression' && gs[0].items.length === 2 && gs[1].label === 'Simulator', 'achievements are grouped by category in the order given, with a label, locked ones included');
ok(groupAchievements([{ category: 'seasonal-event', key: 'k', name: 'n' }])[0].label === 'Seasonal-event' && groupAchievements(null).length === 0, 'an unknown category still gets a label, and nothing gives no groups');
ok(featuredOf(p).map((a) => a.key).join() === 'moving-up', 'the featured achievements are looked up in order');
ok(featuredOf(cleanProgression(raw({ featured: ['ace-pilot', 'moving-up'] }))).map((a) => a.key).join() === 'moving-up', 'a featured key that is not unlocked is not shown');
ok(featuredOf(cleanProgression(raw({ achievements: undefined }))).length === 0, 'and without a collection nothing is shown');
ok(glyphOf('crown') !== glyphOf('nothing') && glyphOf('nothing') === '⭐' && typeof glyphOf(undefined) === 'string', 'icon keys map to a picture, with a fallback');
ok(xpText(0) === '0' && xpText(350) === '350' && xpText(3650) === '3,650' && xpText(123456) === '123,456' && xpText(NaN) === '0', 'XP is written with thousands separators');

// ---------- history
ok(describeHistory({ amount: 10, source: 'sim', reason: '' }).detail === 'Simulator playtime' && describeHistory({ amount: 10, source: 'sim' }).title === '+10 XP', 'a simulator hour reads "+10 XP"');
ok(describeHistory({ amount: 50, source: 'attendance' }).detail === 'Flight session attended', 'a session reads as attended');
const adm = describeHistory({ amount: -300, source: 'admin', reason: 'Corrected a duplicate' });
ok(adm.title === '−300 XP' && adm.detail === 'Adjusted by an administrator: Corrected a duplicate' && describeHistory({ amount: 5, source: 'admin', reason: '' }).detail === 'Adjusted by an administrator', 'an administrator adjustment shows its reason, or says it was an adjustment');
ok(describeHistory({ amount: 0, source: 'admin', reason: 'x' }).title === '0 XP', 'a zero adjustment reads "0 XP"');
const h = cleanHistory({ items: [{ id: 3, amount: 10, source: 'sim', reason: null, created_at: '2026-11-14T10:00:00Z' }, { id: 'x', amount: 1 }, null, { id: 2, amount: -5.7, source: 'weird', reason: 'r'.repeat(300), created_at: 5 }], next: 2 });
ok(h.items.length === 2 && h.items[1].amount === -5 && h.items[1].source === 'admin' && h.items[1].reason.length === 200 && h.items[1].createdAt === '' && h.next === 2, 'a page of history drops bad rows, caps text and keeps the cursor');
ok(cleanHistory(null).items.length === 0 && cleanHistory({}).next === null && cleanHistory({ items: 'x', next: 'y' }).next === null, 'junk is an empty page');

// ---------- the wrapper: calls, cache, errors
const calls = [];
let clock = 1000, fail = null;
const client = { rpc: async (fn, args) => { calls.push([fn, args]); if (fail) return { data: null, error: { message: fail } }; if (fn === 'get_progression' || fn === 'my_progression') return { data: raw(), error: null }; if (fn === 'my_xp_history') return { data: { items: [], next: null }, error: null }; if (fn === 'set_featured') return { data: { status: 'saved', featured: args.p_keys }, error: null }; return { data: null, error: null }; } };
const api = createProgression(client, () => clock);
let g = await api.get('friend', 'f1');
ok(g.visible && g.xp === 350 && calls.length === 1 && calls[0][0] === 'get_progression' && calls[0][1].p_kind === 'friend' && calls[0][1].p_id === 'f1', 'get asks the database by kind and id, and returns a cleaned payload');
await api.get('friend', 'f1'); ok(calls.length === 1, 'a second ask within 30 seconds is answered from the cache');
await api.get('member', 'f1'); ok(calls.length === 2, 'the same id as another kind is a different person');
ok(api.peek('friend', 'f1')?.xp === 350 && api.peek('friend', 'zzz') === null, 'peek gives what is held, or null');
clock += 31_000; ok(api.peek('friend', 'f1') === null, 'peek forgets after 30 seconds');
await api.get('friend', 'f1'); ok(calls.length === 3, 'and a later ask goes to the database again');
await api.mine(); await api.mine(); ok(calls.filter((c) => c[0] === 'my_progression').length === 1 && api.peek('me')?.visible === true, 'mine is cached too');
await api.mine({ force: true }); ok(calls.filter((c) => c[0] === 'my_progression').length === 2, 'and can be forced');
const ks = await api.setFeatured(['moving-up']);
ok(ks.join() === 'moving-up' && api.peek('me') === null, 'choosing featured achievements returns the saved keys and drops the cached own progression');
await api.history(null, 30); await api.history(9, 5);
ok(calls.at(-2)[1].p_before === null && calls.at(-2)[1].p_limit === 30 && calls.at(-1)[1].p_before === 9 && calls.at(-1)[1].p_limit === 5, 'history passes the cursor and page size');
api.forget(); ok(api.peek('friend', 'f1') === null, 'forget empties the cache (sign-out, another account)');
fail = 'permission denied';
let err = null; try { await api.get('friend', 'e1'); } catch (e) { err = e.message; }
ok(err === 'permission denied' && api.peek('friend', 'e1') === null, 'a database error is thrown with its message and is not cached');
fail = null;
const bad = createProgression({ rpc: async () => ({ data: { visible: true, xp: 'lots' }, error: null }) });
ok((await bad.get('friend', 'x')).visible === false, 'a payload that cannot be trusted is shown as hidden');
for (let i = 0; i < 205; i++) await api.get('friend', 'id' + i);
ok(api.peek('friend', 'id204')?.visible === true && api.peek('friend', 'id0') === null, 'the cache is bounded (oldest dropped past 200)');
