// The same place on several dates: grouping, labels, and what the AI import calls a duplicate versus another visit. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const places = await load('src/places.js');
const ai = await load('src/aiimport.js');
const it = (id, lat, lon, extra = {}) => ({ id, type: 'photo', name: 'Tower', note: '', lat, lon, created: `2026-11-01T00:00:0${id.length}.000Z`, ...extra });

// ---------- distance
ok(Math.abs(places.metres({ lat: 30, lon: 114 }, { lat: 30.001, lon: 114 }) - 111.2) < 1, 'distance: 0.001 degrees of latitude is about 111 m');
ok(places.metres({ lat: 30, lon: 114 }, { lat: 30, lon: 114 }) === 0, 'distance: the same point is 0');

// ---------- groups
const a = it('a', 30.5, 114.3, { date: '2026-11-14', day: 3 }), b = it('bb', 30.5, 114.3, { date: '2026-11-12', day: 1, order: 2 });
const c = it('ccc', 30.50005, 114.3, { date: '2026-11-13' }); // about 5.5 m away
const far = it('d', 30.51, 114.3);
const home = it('h', 30.5, 114.3, { type: 'residence' });
let g = places.visitGroups([a, b, c, far, home]);
ok(g.size === 3 && g.get('a').length === 3 && g.get('a') === g.get('bb') && !g.has('d') && !g.has('h'), 'groups: three markers within about 15 m are one place; a far one and the Home marker are not in any group');
ok(g.get('a').map((x) => x.id).join() === 'bb,ccc,a', 'groups: visits are in date order (12, 13, 14 Nov)');
ok(places.visitGroups([a, far]).size === 0 && places.visitGroups([]).size === 0, 'groups: a marker alone has no group');
const edge = it('e', 30.50013, 114.3); // about 14.5 m from a
ok(places.visitGroups([a, edge]).size === 2, 'groups: 14.5 m apart still counts as the same place');
const wide = it('f', 30.50020, 114.3); // about 22 m
ok(places.visitGroups([a, wide]).size === 0, 'groups: 22 m apart does not');
const lonShift = it('g', 30.5, 114.30014); // about 13.5 m east at this latitude
ok(places.visitGroups([a, lonShift]).size === 2, 'groups: east-west distance is measured in metres too (13.5 m)');
const chain = places.visitGroups([it('m1', 30.5, 114.3), it('m2', 30.50010, 114.3), it('m3', 30.50020, 114.3)]);
ok(chain.size === 3 && chain.get('m1').length === 3, 'groups: a chain of near neighbours is one place');
const undated = places.visitGroups([it('u1', 30.6, 114.3, { date: '2026-11-12' }), it('u22', 30.6, 114.3)]);
ok(undated.get('u1').map((x) => x.id).join() === 'u1,u22', 'groups: an undated visit comes after the dated ones');
const many = Array.from({ length: 3000 }, (_, i) => it('x' + i, 30 + (i % 60) * 0.01, 114 + Math.floor(i / 60) * 0.01));
const t0 = Date.now();
places.visitGroups(many);
ok(Date.now() - t0 < 1500, 'groups: 3000 markers are grouped quickly (' + (Date.now() - t0) + ' ms)');

// ---------- labels
ok(places.visitLabel(b) === 'Day 1 · Stop 2 · Thu, Nov 12' && places.visitLabel(it('z', 1, 1)) === 'No date', 'labels: "Day 1 · Stop 2 · Thu, Nov 12" and "No date"');
ok(places.visitLabel(a, { tripName: 'Wuhan' }) === 'Day 3 · Thu, Nov 14 · Wuhan' || /Wuhan$/.test(places.visitLabel(a, { tripName: 'Wuhan' })), 'labels: the trip name is added when asked');

// ---------- AI import: duplicate or another visit
const row = (extra) => ({ status: 'ok', name: 'Tower', lat: 30.5, lon: 114.3, ...extra });
const saved = [it('s1', 30.5, 114.3, { date: '2026-11-12' })];
ok(ai.isDuplicate(row({ date: '2026-11-12' }), saved) === true && ai.isRevisit(row({ date: '2026-11-12' }), saved) === false, 'import: same place, same date is a duplicate');
ok(ai.isDuplicate(row({ date: '2026-11-14' }), saved) === false && ai.isRevisit(row({ date: '2026-11-14' }), saved) === true, 'import: same place on another date is another visit, not a duplicate');
ok(ai.isDuplicate(row({ date: '2026-11-12', endDate: '2026-11-14' }), saved) === false && ai.isRevisit(row({ date: '2026-11-12', endDate: '2026-11-14' }), saved) === true, 'import: the same start date with a different stay length counts as another visit');
ok(ai.isDuplicate(row({}), saved) === true, 'import: a row with no date is still a duplicate of a dated marker');
ok(ai.isDuplicate(row({ date: '2026-11-14' }), [it('s2', 30.5, 114.3)]) === true, 'import: a dated row for a marker with no date is still a duplicate');
ok(ai.isDuplicate(row({}), [it('s3', 30.5, 114.3)]) === true, 'import: two undated ones are duplicates (the old behaviour)');
ok(ai.isDuplicate(row({ name: 'Other', date: '2026-11-14' }), saved) === false && ai.isRevisit(row({ name: 'Other', date: '2026-11-14' }), saved) === false, 'import: a different place is neither');
ok(ai.isDuplicate(row({ lat: 30.51, date: '2026-11-14' }), saved) === false && ai.isRevisit(row({ lat: 30.51, date: '2026-11-14' }), saved) === false, 'import: the same name far away is neither');
ok(ai.isRevisit(row({ date: '2026-11-14' }), [...saved, it('s4', 30.5, 114.3, { date: '2026-11-14' })]) === false, 'import: if the new date is already saved too, it is a duplicate, not another visit');
ok(ai.isDuplicate({ status: 'lookup', name: 'Tower', query: 'x' }, saved) === false && ai.isRevisit({ status: 'lookup', name: 'Tower' }, saved) === false, 'import: rows still to be looked up are neither');
