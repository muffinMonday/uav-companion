// The rules of shared trips (src/sharedtrip/core.js): building the document and, above all, the three-way merge. No browser, no network.
import { buildSharedDoc, tripToDoc, sameDoc, mergeRecord, mergeDocs, describeChange } from '../src/sharedtrip/core.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const J = JSON.stringify;
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => J(canon(a)) === J(canon(b));

const T = 'trip-1';
const mk = (id, extra = {}) => ({ id, type: 'photo', name: 'M' + id, note: '', lat: 30.5, lon: 114.3, created: '2026-11-01T00:00:0' + (id.charCodeAt(id.length - 1) % 10) + '.000Z', tripId: T, ...extra });
const trip = (extra = {}) => ({ id: T, name: 'Hubei', description: '', created: '2026-10-01T00:00:00.000Z', color: '#e91e63', ...extra });
const doc = (items, t = {}) => ({ v: 1, trip: trip(t), items });
const at = (n) => `2026-11-02T10:00:${String(n).padStart(2, '0')}.000Z`; // later n = later change
const byId = (d, id) => d.items.find((i) => i.id === id);

// ---------- building the document
const items = [mk('a'), mk('b', { checkin: { at: 'x', lat: 1, lon: 1 } }), mk('h', { type: 'residence' }), mk('z', { tripId: 'other' }), { ...mk('n'), tripId: undefined }];
const d = buildSharedDoc({ ...trip(), shared: { id: T, owner: true } }, items);
ok(d.v === 1 && d.items.map((i) => i.id).sort().join() === 'a,b', 'the document holds only the trip\'s own markers: no Home marker, no other trip\'s, no untagged one');
ok(!('checkin' in byId(d, 'b')) && 'checkin' in items[1], 'check-ins are left out of the document, and the caller\'s list is not changed');
ok(!('shared' in d.trip) && d.trip.name === 'Hubei' && tripToDoc({ ...trip(), shared: 1, odd: 2 }).odd === undefined, 'local-only fields of a trip stay out of the document');
ok(sameDoc(doc([mk('a'), mk('b')]), doc([mk('b'), mk('a')])) && !sameDoc(doc([mk('a')]), doc([mk('a', { name: 'x' })])) && !sameDoc(doc([mk('a')], { name: 'x' }), doc([mk('a')])), 'sameDoc ignores the order of markers and sees every difference');

// ---------- merging one record
const base = mk('a', { name: 'Tower', note: 'n', updated: at(0) });
let r = mergeRecord(base, { ...base, name: 'Mine', updated: at(5) }, { ...base, note: 'Theirs', updated: at(6) });
ok(r.name === 'Mine' && r.note === 'Theirs', 'changes to different fields are both kept');
r = mergeRecord(base, { ...base, name: 'Mine', updated: at(5) }, { ...base, name: 'Theirs', updated: at(6) });
ok(r.name === 'Theirs' && r.updated === at(6), 'the same field changed on both sides takes the more recent record');
r = mergeRecord(base, { ...base, name: 'Mine', updated: at(7) }, { ...base, name: 'Theirs', updated: at(6) });
ok(r.name === 'Mine', 'in both directions');
r = mergeRecord(base, { ...base, name: 'Same', updated: at(5) }, { ...base, name: 'Same', updated: at(6) });
ok(r.name === 'Same', 'the same change on both sides is just that change');
const noDay = { ...base }; const withDay = { ...base, day: 2, updated: at(4) };
ok(!('day' in mergeRecord(withDay, { ...withDay, updated: at(4) }, { ...noDay, updated: at(5) })), 'a field removed on one side only is removed');
ok(J(mergeRecord(base, { ...base, checklist: [{ text: 'a', done: true }], updated: at(5) }, { ...base, updated: at(6) }).checklist) === J([{ text: 'a', done: true }]), 'a list field changed on one side only is taken whole');

// ---------- merging documents
const B0 = doc([mk('a', { updated: at(0) }), mk('b', { updated: at(0) }), mk('c', { updated: at(0) })]);
const edit = (d0, id, patch, n) => ({ ...d0, items: d0.items.map((i) => (i.id === id ? { ...i, ...patch, updated: at(n) } : i)) });
const drop = (d0, id) => ({ ...d0, items: d0.items.filter((i) => i.id !== id) });
const add = (d0, m) => ({ ...d0, items: [...d0.items, m] });
let m = mergeDocs(B0, edit(B0, 'a', { name: 'A!' }, 5), edit(B0, 'b', { name: 'B!' }, 6));
ok(byId(m, 'a').name === 'A!' && byId(m, 'b').name === 'B!' && byId(m, 'c').name === 'Mc', 'edits to different markers are both kept');
m = mergeDocs(B0, add(B0, mk('x', { updated: at(5) })), add(B0, mk('y', { updated: at(6) })));
ok(m.items.length === 5 && byId(m, 'x') && byId(m, 'y'), 'markers added on each side are both kept');
m = mergeDocs(B0, drop(B0, 'a'), B0);
ok(!byId(m, 'a') && m.items.length === 2, 'a marker deleted here and untouched there is deleted');
m = mergeDocs(B0, B0, drop(B0, 'a'));
ok(!byId(m, 'a'), 'and the other way round');
m = mergeDocs(B0, drop(B0, 'a'), edit(B0, 'a', { name: 'Edited' }, 6));
ok(byId(m, 'a')?.name === 'Edited', 'a marker deleted here but edited there is kept, with the edit');
m = mergeDocs(B0, edit(B0, 'a', { name: 'Edited' }, 6), drop(B0, 'a'));
ok(byId(m, 'a')?.name === 'Edited', 'and the other way round');
m = mergeDocs(B0, drop(B0, 'a'), drop(B0, 'a'));
ok(!byId(m, 'a') && m.items.length === 2, 'a marker deleted on both sides is gone');
m = mergeDocs(B0, { ...B0, trip: trip({ name: 'Mine', updated: at(5) }) }, { ...B0, trip: trip({ notes: 'Theirs', updated: at(6) }) });
ok(m.trip.name === 'Mine' && m.trip.notes === 'Theirs', 'trip fields merge like marker fields');
m = mergeDocs(null, doc([mk('a', { name: 'Mine', updated: at(5) }), mk('x', { updated: at(5) })]), doc([mk('a', { name: 'Theirs', updated: at(6) }), mk('y', { updated: at(6) })]));
ok(m.items.length === 3 && byId(m, 'a').name === 'Theirs', 'with no common version, markers are united and the more recent record wins');
m = mergeDocs(B0, B0, B0);
ok(same(m, { ...B0, trip: { ...B0.trip } }) || sameDoc(m, B0), 'three identical versions merge to themselves');

// ---------- what changed
const dc = describeChange(B0, add(drop(edit(B0, 'a', { name: 'x' }, 5), 'b'), mk('n', { updated: at(5) })));
ok(dc.added === 1 && dc.removed === 1 && dc.changed === 1 && dc.trip === false && describeChange(B0, { ...B0, trip: trip({ name: 'New' }) }).trip === true, 'describeChange counts added, removed and changed markers, and a changed trip');

// ---------- properties on many random cases: the merge must not depend on which side runs it
let seed = 20261111;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const mutate = (d0, who, n) => {
  let out = { ...d0, trip: { ...d0.trip }, items: d0.items.map((i) => ({ ...i })) };
  for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
    const op = pick(['edit', 'edit', 'add', 'del', 'trip']);
    const time = at(Math.floor(rnd() * 50));
    if (op === 'edit' && out.items.length) { const i = pick(out.items); const f = pick(['name', 'note', 'day', 'lat']); i[f] = f === 'day' ? Math.floor(rnd() * 4) + 1 : who + n + Math.floor(rnd() * 3); i.updated = time; }
    else if (op === 'add') { const id = pick(ids); if (!out.items.some((x) => x.id === id)) out.items.push(mk(id, { name: who + id, updated: time })); }
    else if (op === 'del' && out.items.length) { const id = pick(out.items).id; out.items = out.items.filter((x) => x.id !== id); }
    else if (op === 'trip') { out.trip[pick(['name', 'notes', 'description'])] = who + Math.floor(rnd() * 3); out.trip.updated = time; }
  }
  return out;
};
let symmetric = 0, identity = 0, convergent = 0, total = 600;
for (let n = 0; n < total; n++) {
  let b = doc([]); for (const id of ids.slice(0, Math.floor(rnd() * 6))) b.items.push(mk(id, { updated: at(0) }));
  const mine = mutate(b, 'm', n), theirs = mutate(b, 't', n);
  const x = mergeDocs(b, mine, theirs), y = mergeDocs(b, theirs, mine);
  if (same(x, y)) symmetric++;
  if (sameDoc(mergeDocs(b, mine, b), mine) && sameDoc(mergeDocs(b, b, theirs), theirs)) identity++; // marker order is not meaningful, so it is not compared
  // after both have merged, a second sync from either side changes nothing
  if (same(mergeDocs(x, x, y), x)) convergent++;
}
ok(symmetric === total, `the merge gives the same document whichever side runs it (${symmetric} of ${total} random cases)`);
ok(identity === total, `merging with an unchanged side gives the changed side exactly (${identity} of ${total})`);
ok(convergent === total, `once merged, syncing again changes nothing (${convergent} of ${total})`);
