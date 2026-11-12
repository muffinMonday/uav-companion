// Side Quests (isSub, parentId): storage, export and import, share links, the main-stop filters, parent lookup and the AI import. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const poi = await load('src/poi.js');
const trips = await load('src/trips.js');
const dist = await load('src/distance.js');
const checkin = await load('src/checkin.js');
const ai = await load('src/aiimport.js');
const SC = await load('src/sharecompact.js');
const sync = await load('src/sync/core.js');

const base = (o) => ({ lat: 30.59, lon: 114.3, created: '2026-11-01T00:00:00.000Z', ...o });

// ---------- storage: sanitize
const plain = poi.sanitize(base({ id: 'a', type: 'photo', name: 'Tower', tripId: 't1', date: '2026-11-13', order: 1 }));
ok(!('isSub' in plain) && !('parentId' in plain), 'a marker without isSub is stored exactly as before (no new keys)');
const sq = poi.sanitize(base({ id: 's', type: 'photo', name: 'Cafe', isSub: true, parentId: 'a', order: 2 }));
ok(sq.isSub === true && sq.parentId === 'a' && sq.order === 2, 'a Side Quest keeps isSub, parentId and its order');
ok(!('isSub' in poi.sanitize(base({ id: 'x', type: 'photo', isSub: 'yes' }))) && !('isSub' in poi.sanitize(base({ id: 'x', type: 'photo', isSub: false }))), 'only isSub === true counts');
ok(!('parentId' in poi.sanitize(base({ id: 'x', type: 'photo', parentId: 'a' }))), 'parentId means nothing without isSub');
ok(!('parentId' in poi.sanitize(base({ id: 'x', type: 'photo', isSub: true, parentId: 'x' }))) && !('parentId' in poi.sanitize(base({ id: 'x', type: 'photo', isSub: true, parentId: 'z'.repeat(65) }))), 'a Side Quest cannot be its own parent, and an oversized parentId is dropped');
ok(['home', 'hotel', 'residence'].every((t) => !('isSub' in poi.sanitize(base({ id: 'x', type: t, isSub: true, parentId: 'a' })))), 'a Home point, Hotel or Home marker is never a Side Quest');
ok(poi.isMain(plain) && !poi.isSub(plain) && poi.isSub(sq) && !poi.isMain(sq), 'isMain and isSub');
ok(poi.stopNo(plain) === 1 && poi.stopNo(sq) === undefined, 'a Side Quest has no stop number');

// ---------- the store: convert in both directions
const store = poi.createStore();
const t = store.addTrip({ name: 'Wuhan', startDate: '2026-11-12', endDate: '2026-11-14' }).trip;
const main = store.add({ type: 'photo', name: 'Tower', lat: 30.59, lon: 114.3, tripId: t.id, date: '2026-11-13', order: 1 }).item;
const side = store.add({ type: 'other', name: 'Snacks', lat: 30.592, lon: 114.302, tripId: t.id, date: '2026-11-13', isSub: true, parentId: main.id }).item;
ok(store.get(side.id).isSub === true && store.get(side.id).parentId === main.id, 'store.add keeps a Side Quest');
const back = store.update(side.id, { isSub: false }).item;
ok(!('isSub' in back) && !('parentId' in back), 'turning isSub off makes it a main stop again and drops the parent link');
store.update(side.id, { isSub: true });
ok(store.get(side.id).isSub === true, 'and on again');
const sm = store.setMany([{ ...store.get(side.id), parentId: main.id }]);
ok(sm.ok && store.get(side.id).parentId === main.id, 'setMany keeps both fields');

// ---------- export and import
const gj = poi.toGeoJSON(store.items(), store.trips());
const fe = (name) => gj.features.find((f) => f.properties.name === name).properties;
ok(fe('Snacks').isSub === true && fe('Snacks').parentId === main.id && !('isSub' in fe('Tower')), 'the export carries isSub and parentId only on a Side Quest');
const imp = poi.parseGeoJSON(JSON.stringify(gj));
ok(imp.items.find((i) => i.name === 'Snacks').isSub === true && imp.items.find((i) => i.name === 'Snacks').parentId === main.id && !imp.items.find((i) => i.name === 'Tower').isSub, 'it round-trips through parseGeoJSON');
const old = poi.parseGeoJSON(JSON.stringify({ type: 'FeatureCollection', uavzones: 1, features: [{ type: 'Feature', properties: { id: 'o1', type: 'photo', name: 'Old', created: '2026-01-01T00:00:00.000Z' }, geometry: { type: 'Point', coordinates: [114.3, 30.6] } }] }));
ok(old.items.length === 1 && !old.items[0].isSub, 'an export from before Side Quests loads unchanged');
ok(!JSON.stringify(poi.toGeoJSON([plain])).includes('isSub'), 'and a file without Side Quests has no new keys');
ok(sync.buildDoc({ items: store.items(), trips: [] }).items.some((i) => i.isSub === true && i.parentId === main.id), 'the cloud copy document carries the fields (stored as the app keeps them)');

// ---------- the main-stop filters
const T = { id: 't', name: 'T', startDate: '2026-11-12', endDate: '2026-11-14' };
const M = (o) => base({ tripId: 't', type: 'photo', ...o });
const a = M({ id: 'a', name: 'A', date: '2026-11-13', order: 1, lat: 30.59, lon: 114.3 });
const b = M({ id: 'b', name: 'B', date: '2026-11-13', order: 2, lat: 30.6, lon: 114.31 });
const c = M({ id: 'c', name: 'C', date: '2026-11-14', order: 1, lat: 30.62, lon: 114.33 });
const hotel = M({ id: 'h', name: 'Hotel', type: 'hotel', date: '2026-11-12', endDate: '2026-11-14', lat: 30.595, lon: 114.305 });
const s1 = M({ id: 's1', name: 'Snacks', type: 'other', date: '2026-11-13', order: 1, isSub: true, parentId: 'b', lat: 30.5902, lon: 114.3001 });
const s2 = M({ id: 's2', name: 'Cafe', type: 'other', date: '2026-11-13', order: 2, isSub: true, lat: 30.5901, lon: 114.3002 }); // no parent: nearest main stop
const s3 = M({ id: 's3', name: 'Lost', type: 'other', isSub: true, parentId: 'gone', lat: 30.62, lon: 114.33, date: '2026-11-14' }); // parent deleted
const all = [a, b, c, hotel, s1, s2, s3];
const seq = trips.tripSequence(all, 't').map((x) => x.id);
ok(!seq.includes('s1') && !seq.includes('s2') && !seq.includes('s3') && seq.includes('a') && seq.includes('c'), 'and keeps every main stop');
const plan = trips.planDays(all, T);
const ids = (xs) => xs.map((x) => x.id).sort().join();
ok(ids(plan.days[1].stops) === 'a,b' && plan.days[1].km > 0 && ids(plan.days[2].stops) === 'c', 'planDays lays out only main stops');
const km = trips.planDays([a, b], T).days[1].km;
ok(plan.days[1].km === km, 'a Side Quest does not change the length of the day');
ok(plan.undated.length === 0 && plan.outside.length === 0, 'a Side Quest is not counted as undated or outside the dates');
ok(trips.sideQuests(all, 't').length === 3 && trips.sideQuests(all, null).length === 0, 'sideQuests lists the Side Quests of one trip');

// ---------- the parent of a Side Quest
ok(trips.parentOf(s1, all).id === 'b', 'an explicit parent is used');
ok(trips.parentOf(s2, all).id === 'a', 'with no parent: the nearest main stop on the same date (a, not the hotel, not c)');
ok(trips.parentOf(s3, all).id === 'c', 'a parent that no longer exists falls back to the nearest main stop');
ok(trips.parentOf({ ...s1, parentId: 's2' }, all).id === 'a', 'a Side Quest as parent is refused (falls back to the nearest main stop)');
ok(trips.parentOf({ ...s1, parentId: 'h' }, all).id === 'h', 'a hotel can be a parent when chosen');
ok(trips.parentOf(a, all) === null, 'a main stop has no parent');
ok(trips.parentOf({ ...s1, parentId: undefined }, [s1, hotel]) === null, 'with no main stop in the trip (a hotel is not one unless chosen) a Side Quest has no parent');
ok(trips.parentOf({ ...s1, parentId: 'x' }, [{ ...a, tripId: 'other' }, s1]) === null, 'a main stop of another trip never counts');
const sqm = trips.sideQuestMap(all);
ok(sqm.byParent.get('b').map((x) => x.id).join() === 's1' && sqm.byParent.get('a').map((x) => x.id).join() === 's2' && sqm.byParent.get('c').map((x) => x.id).join() === 's3' && sqm.orphans.length === 0, 'sideQuestMap groups them under their parents');
ok(trips.sideQuestMap([s1, s2]).orphans.length === 2, 'with no main stops they are orphans');

// ---------- distances and counts
const withHome = [a, hotel, M({ id: 'hp', name: 'Home point', type: 'home', lat: 30.59, lon: 114.3 }), s1];
const bases = dist.nearestBases(s1, withHome);
ok(bases.hotel.found && bases.home.found, 'a Side Quest still shows its distance to the hotel and the home point');
ok(dist.isWaypoint(s1) && ['home', 'hotel', 'residence'].every((tp) => !poi.sanitize(base({ id: 'q', type: tp, isSub: true })).isSub), 'and can never be one of the bases');
const vis = [{ ...a, checkin: { at: '2026-11-13T01:00:00.000Z', lat: 30.59, lon: 114.3 } }, b, { ...s1, checkin: { at: '2026-11-13T01:00:00.000Z', lat: 30.59, lon: 114.3 } }, s2];
ok(JSON.stringify(checkin.visitedCount(vis)) === '{"done":1,"total":2}' && JSON.stringify(checkin.sideVisitedCount(vis)) === '{"done":1,"total":2}', 'visited counts main stops and Side Quests apart');

// ---------- share links
const exp = poi.toGeoJSON([a, b, s1, s2], [T]);
const compact = SC.compactShare(exp);
ok(compact.v === 2 && compact.m.every((r) => r.length <= 13), 'the compact form stays version 2');
ok(compact.m[0].length <= 11 && compact.m[1].length <= 11, 'main rows are exactly as long as before (no extra slots)');
const back2 = SC.expandShare(JSON.parse(JSON.stringify(compact)));
const pr = (n) => back2.features.find((f) => f.properties.name === n).properties;
ok(pr('Snacks').isSub === true && pr('Snacks').parentId === pr('B').id && pr('B').id && !('isSub' in pr('A')), 'a Side Quest and its parent survive the compact form');
ok(pr('Cafe').isSub === true && !('parentId' in pr('Cafe')), 'a Side Quest with no parent link stays that way');
const oldLink = { v: 2, m: [[2, 'Old place', 30590000, 114300000, 8000, 0, 1]] };
ok(!SC.expandShare(oldLink).features[0].properties.isSub, 'a link made before Side Quests opens as before');
const parsed = ai.parseItinerary(JSON.stringify(back2));
const row = (n) => parsed.rows.find((r) => r.name === n);
ok(row('Snacks').isSub === true && row('Snacks').parentSrc === row('B').srcId && row('B').srcId, 'parseItinerary reads them from a link');
const ex = poi.sanitize(base({ id: 'x', type: 'photo' }));
ok(ex && ai.parseItinerary(JSON.stringify(poi.toGeoJSON([ex]))).rows[0].isSub === undefined, 'and leaves ordinary rows alone');

// ---------- the AI import
const fc = (props) => JSON.stringify({ type: 'FeatureCollection', features: props.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [114.3, 30.6] }, properties: p })) });
const ar = ai.parseItinerary(fc([{ name: 'Yellow Crane Tower', type: 'photo', date: '2026-11-13' }, { name: 'Hubu Alley', type: 'other', sideQuest: true, near: 'yellow crane tower', date: '2026-11-13' }, { name: 'Inn', type: 'hotel', sideQuest: true }, { name: 'Plain', type: 'photo' }])).rows;
ok(!ar[0].isSub && ar[1].isSub === true && ar[1].near === 'yellow crane tower' && !ar[2].isSub && !ar[3].isSub, 'an AI reply: sideQuest marks a row (not a hotel), near is read');
ok(ai.parseItinerary(fc([{ name: 'X', type: 'photo', isSub: true }])).rows[0].isSub === true, 'isSub is accepted from an AI too');
ok(!ai.parseItinerary(JSON.stringify({ type: 'FeatureCollection', uavzones: 1, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'X', type: 'photo', sideQuest: true } }] })).rows[0].isSub, 'this app\'s own files use isSub, not sideQuest');
const mk = (id, name, extra = {}) => ({ id, name, type: 'photo', tripId: 'T', isSub: undefined, ...extra });
const rowsA = [ar[0], ar[1]];
const added = [mk('n1', 'Yellow Crane Tower', { date: '2026-11-13' }), mk('n2', 'Hubu Alley', { isSub: true, date: '2026-11-13' })];
const links = ai.linkSideQuests(rowsA, added, []);
ok(links.length === 1 && links[0].id === 'n2' && links[0].parentId === 'n1', 'near is matched by name, ignoring case, to the main stop added with it');
ok(ai.linkSideQuests([ar[1]], [added[1]], [mk('e1', 'Yellow Crane Tower', { date: '2026-11-13' })])[0]?.parentId === 'e1', 'or to a main stop you already had');
ok(ai.linkSideQuests([ar[1]], [added[1]], [mk('e2', 'Yellow Crane Tower', { tripId: 'OTHER' })]).length === 0, 'but never one in another trip');
ok(ai.linkSideQuests([ar[1]], [added[1]], [mk('e3', 'Yellow Crane Tower', { isSub: true })]).length === 0, 'nor a Side Quest');
ok(ai.linkSideQuests([ar[1]], [null], []).length === 0, 'a row that was not added is skipped');
const two = [{ name: 'Near early', near: 'Spot', isSub: true }];
const days = [mk('d1', 'Spot', { date: '2026-11-12' }), mk('d2', 'Spot', { date: '2026-11-13' })];
ok(ai.linkSideQuests(two, [mk('q', 'Near early', { isSub: true, date: '2026-11-13' })], days)[0].parentId === 'd2', 'with two stops of that name the one on the same date wins');
const byId = ai.linkSideQuests([row('B'), row('Snacks')], [mk('nb', 'B'), mk('ns', 'Snacks', { isSub: true })], []);
ok(byId.length === 1 && byId[0].id === 'ns' && byId[0].parentId === 'nb', 'a file or link finds the parent by id');

// ---------- the AI assets
import fs from 'node:fs';
const prompt = fs.readFileSync(path.join(ROOT, 'public/ai/prompt.md'), 'utf8');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/ai/schema.json'), 'utf8'));
const example = ai.parseItinerary(fs.readFileSync(path.join(ROOT, 'public/ai/example.geojson'), 'utf8'));
ok(/sideQuest/.test(prompt) && /near/.test(prompt) && /never a side quest/i.test(prompt), 'prompt.md explains sideQuest and near');
const props = schema.$defs.feature.properties.properties.properties;
ok(props.sideQuest.type === 'boolean' && props.near.type === 'string', 'schema.json lists sideQuest and near');
ok(example.rows.some((r) => r.isSub && r.near === 'Yellow Crane Tower'), 'example.geojson has a Side Quest that names its main stop');
