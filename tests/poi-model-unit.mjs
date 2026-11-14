// The saved-places view model: sections, counts, reveal, pruning and unlinked Side Quests. Pure; the input is frozen to prove it is never changed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const M = await load('src/poi-model.js');
const poi = await load('src/poi.js');
const T = await load('src/trips.js');

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const mk = (id, extra = {}) => poi.sanitize({ id, type: 'photo', name: id, lat: 30 + id.length * 0.01, lon: 114, created: '2026-11-01T00:00:00.000Z', ...extra });
const trip = (id, extra = {}) => ({ id, name: id, ...extra });
const t1 = trip('t1', { startDate: '2026-11-12', endDate: '2026-11-14' });

// ---------- scopes
ok(M.scopeOf(mk('a', { tripId: 't1' })) === 't1' && M.scopeOf(mk('b')) === 'none' && M.scopeOf(mk('r', { type: 'residence', tripId: 't1' })) === 'home', 'a marker belongs to its trip, else Unassigned; the Home marker is its own section even if a record names a trip');
ok(M.dayId('t1', '2026-11-12') === 't1|2026-11-12', 'a day key is the scope and the group key');

// ---------- counts
const items = deepFreeze([
  mk('stay', { type: 'hotel', tripId: 't1', date: '2026-11-12', endDate: '2026-11-14', order: 1 }),
  mk('tower', { tripId: 't1', date: '2026-11-12', order: 2 }),
  mk('lake', { tripId: 't1', date: '2026-11-13', order: 1 }),
  mk('snack', { tripId: 't1', date: '2026-11-13', isSub: true, parentId: 'lake', type: 'food' }),
  mk('later', { tripId: 't1', date: '2026-11-20', order: 1 }),
  mk('nodate', { tripId: 't1' }),
]);
let sum = M.summarise([...items], t1);
ok(sum.places === 6 && sum.days === 2 && sum.outside === 1 && sum.unscheduled === 1, 'places count every marker once (the Side Quest too); days only those inside the trip dates; outside and unscheduled are counted apart: ' + JSON.stringify(sum));
ok(M.summaryText(sum) === '6 places · 2 days · 1 outside the dates', 'the header line separates places from days: ' + M.summaryText(sum));
ok(M.summaryText({ places: 1, days: 0, outside: 0, unscheduled: 1 }) === '1 place', 'singular, and no day count when there are no dated groups');
const dayOnly = [mk('d1', { tripId: 't2', day: 1 }), mk('d2', { tripId: 't2', day: 1 }), mk('d3', { tripId: 't2', day: 3 }), mk('d4', { tripId: 't2' })];
sum = M.summarise(dayOnly, trip('t2'));
ok(sum.places === 4 && sum.days === 2 && sum.unscheduled === 1 && sum.outside === 0, 'a trip planned by day numbers counts those days: ' + JSON.stringify(sum));
sum = M.summarise([mk('p1', { tripId: 't3' }), mk('p2', { tripId: 't3' })], trip('t3'));
ok(sum.places === 2 && sum.days === 0 && sum.unscheduled === 0, 'a trip with no dates and no days is just places');
sum = M.summarise([mk('s1', { tripId: 't4', date: '2026-11-12' })], trip('t4', { startDate: '2026-11-12' }));
ok(sum.days === 1 && sum.outside === 0, 'a trip with only a start date counts a marker on or after it as inside');
ok(M.isOutside(items[4], t1, 'date') && !M.isOutside(items[1], t1, 'date') && !M.isOutside(items[5], t1, 'date') && !M.isOutside(items[4], null, 'date'), 'outside-the-dates is derived from the dates; undated markers and trips without dates are never outside');
ok(!M.isOutside(items[0], t1, 'date'), 'a stay that runs to the last day is inside');

// ---------- expansion state
const st = M.newExpansion();
ok(!M.scopeOpen(st, 't1') && !M.dayOpen(st, 't1', '2026-11-12'), 'everything starts folded');
ok(M.scopeOpen(st, 't1', true) && M.dayOpen(st, 't1', 'x', true), 'while the list must show everything (selecting, a filter, a search) every section reads as open');
ok(!M.scopeOpen(st, 't1'), 'and the stored state is not changed by that');
ok(M.reveal(st, items[3], [...items]) === true && M.scopeOpen(st, 't1') && M.dayOpen(st, 't1', '2026-11-13') && !M.dayOpen(st, 't1', '2026-11-12'), 'revealing a marker opens its trip and its own day only');
ok(M.reveal(st, items[3], [...items]) === false, 'revealing it again changes nothing');
M.reveal(st, items[5], [...items]);
ok(M.dayOpen(st, 't1', 'none'), 'an unscheduled marker opens the unscheduled group');
const loose = mk('loose');
M.reveal(st, loose, [loose]);
ok(M.scopeOpen(st, 'none') && st.days.size === 2, 'an unassigned marker opens Unassigned and no day (its days are always shown)');
const home = mk('home', { type: 'residence' });
M.reveal(st, home, [home]);
ok(M.scopeOpen(st, 'home'), 'the Home marker opens the Home section');
M.prune(st, ['t9']);
ok(!M.scopeOpen(st, 't1') && M.scopeOpen(st, 'none') && M.scopeOpen(st, 'home') && [...st.days].length === 0, 'pruning forgets trips that are gone and keeps Unassigned and Home');
ok(!JSON.stringify([...st.scopes]).includes('t1'), 'nothing of a removed trip is left');

// ---------- every record is reachable: exactly one section each, the filter never moves a marker
const everyone = deepFreeze([...items, loose, home, mk('t2a', { tripId: 't2', day: 2 }), mk('orphan', { tripId: 't5', isSub: true, date: '2026-12-01' })]);
const scopes = new Map();
for (const it of everyone) { const s = M.scopeOf(it); scopes.set(s, (scopes.get(s) ?? 0) + 1); }
ok([...scopes.values()].reduce((a, b) => a + b, 0) === everyone.length && scopes.get('home') === 1, 'every marker is in exactly one section (' + [...scopes].map(([k, v]) => k + ':' + v).join(' ') + ')');
const a1 = M.ancestorsOf(items[1], [...items]);
const a2 = M.ancestorsOf(items[1], [items[1]]);
ok(a1.mode === 'date' && a1.key === '2026-11-12' && a2.key === '2026-11-12', 'a marker keeps its day group whatever else is shown');

// ---------- unlinked Side Quests
const lone = deepFreeze([
  mk('stay2', { type: 'hotel', tripId: 'x', date: '2026-11-12' }),
  mk('sq-dated', { tripId: 'x', date: '2026-11-12', isSub: true, type: 'food' }),
  mk('sq-undated', { tripId: 'x', isSub: true, type: 'nature' }),
  mk('sq-free', { isSub: true, type: 'meeting' }),
  mk('stop', { tripId: 'y', date: '2026-11-12', order: 1 }),
  mk('sq-linked', { tripId: 'y', date: '2026-11-12', isSub: true, parentId: 'stop' }),
]);
const un = M.unlinkedSideQuests([...lone]);
const find = (id) => un.find((u) => u.item.id === id);
ok(un.length === 3 && find('sq-linked') === undefined, 'a Side Quest that has a main stop is not unlinked; three here have none (a base marker is not a stop to hang from)');
ok(find('sq-dated').scope === 'x' && find('sq-dated').key === '2026-11-12', 'a dated one is listed under its trip and its day');
ok(find('sq-undated').scope === 'x' && find('sq-undated').key === 'none', 'an undated one is listed under its trip, unscheduled');
ok(find('sq-free').scope === 'none', 'one with no trip is listed under Unassigned');
ok(Object.isFrozen(lone[1]) && lone[1].isSub === true && lone[1].parentId === undefined, 'listing it changes nothing about the record');
ok(M.unlinkedSideQuests([...items.slice(0, 3)]).length === 0, 'no Side Quests, nothing unlinked');
ok(T.sideQuestMap([...lone]).orphans.length === 3, 'the model agrees with the Trips tab about which are orphans');

// ---------- search matching
{
  const a = mk('a', { name: 'Yellow Crane Tower', note: 'Opens at 8, bring ND filter', tripId: 't1', type: 'attraction' });
  const m = (it, q, tn = '') => M.matches(it, M.queryTerms(q), tn);
  ok(m(a, 'crane') && m(a, 'CRANE') && m(a, 'tower yellow'), 'matches the name, ignoring case and word order');
  ok(m(a, 'nd filter') && !m(a, 'nd lens'), 'matches the note; every word must match');
  ok(m(a, 'attraction') && m(mk('f', { type: 'food' }), 'food drink') && m(mk('h', { type: 'hotel' }), 'accommodation'), 'matches the type label (Food & Drink, Accommodation), not only the id');
  ok(m(a, 'wuhan spring', 'Wuhan spring') && !m(a, 'wuhan', 'Singapore'), 'matches the trip name');
  ok(!m(mk('r', { type: 'residence', name: 'Flat' }), 'wuhan', 'Wuhan'), 'the Home marker is not found through a trip name');
  ok(m(a, '') && m(a, '   ') && M.queryTerms('  A  b ').join() === 'a,b', 'an empty query matches everything; words are split and folded');
  ok(m(mk('c', { name: '黄鹤楼' }), '黄鹤') && m(mk('e', { name: 'Café' }), 'café'), 'non-ASCII text matches');
  ok(M.queryTerms('a b c d e f g h i j k').length === 8, 'a query is capped at eight words');
}
