// Share links: the compact form (z2.) gives back exactly what went in, is shorter, and the older link forms still open. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const ai = await load('src/aiimport.js');
const poi = await load('src/poi.js');
const SC = await load('src/sharecompact.js');

// ---------- a few hundred places, including awkward ones
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const types = poi.TYPES.map((t) => t.id);
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const items = [];
for (let i = 0; i < 300; i++) {
  const date = rnd() < 0.7 ? `2026-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}` : undefined;
  items.push({
    id: 'i' + i, type: types[Math.floor(rnd() * types.length)], name: ['黄鹤楼', 'East Lake "North" gate', 'Café, déjà vu', 'Tower #' + i, 'a\\b\nc'][i % 5],
    note: i % 7 === 0 ? 'Bring ND filters, say "hi"' : '', lat: r6((rnd() - 0.5) * 179.99), lon: r6((rnd() - 0.5) * 359.99), created: '2026-11-01T00:00:00.000Z',
    ...(date && { date }), ...(date && i % 11 === 0 && { endDate: '2027-01-15' }), ...(i % 3 === 0 && { order: 1 + (i % 9) }), ...(i % 13 === 0 && { day: 1 + (i % 5) }), ...(i % 17 === 0 && { unverified: true }), ...(i % 2 === 0 && { tripId: i % 4 === 0 ? 'ta' : 'tb' }),
  });
}
// the edges of the world, and zero
items.push({ id: 'e1', type: 'photo', name: 'South-west corner', note: '', lat: -89.999999, lon: -180, created: '2026-11-01T00:00:00.000Z' }, { id: 'e2', type: 'photo', name: 'North-east corner', note: '', lat: 90, lon: 179.999999, created: '2026-11-01T00:00:00.000Z' }, { id: 'e3', type: 'photo', name: 'Null Island', note: '', lat: 0, lon: 0, created: '2026-11-01T00:00:00.000Z' });
const trips = [
  { id: 'ta', name: 'Hubei "spring"', country: 'CN', startDate: '2026-03-01', endDate: '2026-03-09', description: 'A trip, with a comma', color: '#e91e63', notes: 'private', checklist: [{ text: 'x', done: true }] },
  { id: 'tb', name: 'Singapore', startDate: '2026-11-12', description: '', color: '#3949ab' },
];
const stored = items.map((i) => poi.sanitize(i));
const gj = poi.toGeoJSON(stored, trips.map((t) => poi.sanitizeTrip(t)));
for (const f of gj.features) { delete f.properties.id; delete f.properties.created; }

// ---------- round trip of the pure format
const back = SC.expandShare(JSON.parse(JSON.stringify(SC.compactShare(gj))));
ok(back.features.length === gj.features.length, 'every place comes back: ' + back.features.length);
let bad = 0;
gj.features.forEach((f, i) => {
  const g = back.features[i], p = f.properties, q = g.properties;
  const same = g.geometry.coordinates[0] === f.geometry.coordinates[0] && g.geometry.coordinates[1] === f.geometry.coordinates[1]
    && q.name === p.name && q.type === p.type && (q.note ?? '') === (p.note ?? '') && q.date === p.date && q.endDate === p.endDate && q.order === p.order && q.day === p.day && !!q.unverified === !!p.unverified
    && (q.tripId ? back.trips.find((t) => t.id === q.tripId).name : undefined) === (p.tripId ? gj.trips.find((t) => t.id === p.tripId).name : undefined);
  if (!same) { bad++; if (bad < 4) console.log('     differs at', i, JSON.stringify(p), JSON.stringify(q), f.geometry.coordinates, g.geometry.coordinates); }
});
ok(bad === 0, 'coordinates (to the last decimal), names, types, notes, dates, end dates, stop numbers, days, flags and trips are all identical (' + bad + ' differences)');
ok(back.trips.length === 2 && back.trips[0].name === 'Hubei "spring"' && back.trips[0].country === 'CN' && back.trips[0].startDate === '2026-03-01' && back.trips[0].endDate === '2026-03-09' && back.trips[0].description === 'A trip, with a comma' && back.trips[1].startDate === '2026-11-12' && back.trips[1].endDate === undefined, 'trips keep their name, country, dates and description');
ok(!JSON.stringify(SC.compactShare(gj)).includes('private') && !JSON.stringify(SC.compactShare(gj)).includes('checklist'), 'a trip\'s private notes and checklist are not in the link');
ok(back.trips.every((t) => !('color' in t)), 'and neither is its colour');

// ---------- the whole path, with real links
const json = JSON.stringify(gj);
const link = await ai.encodeShare(json);
ok(link.startsWith('z2.'), 'a share link is written in the compact form');
const oldLink = 'z.' + zlib.deflateRawSync(Buffer.from(json)).toString('base64url');
ok(link.length < oldLink.length * 0.8, 'and is much shorter than the older form: ' + link.length + ' against ' + oldLink.length + ' characters');
// the import preview takes up to 200 places, so the preview path uses a list under that
const small = { ...gj, features: [...gj.features.slice(0, 150), ...gj.features.slice(-3)] };
const smallLink = await ai.encodeShare(JSON.stringify(small));
const parsed = ai.parseItinerary(await ai.decodeShare(smallLink));
ok(parsed.rows.length === small.features.length && parsed.trips.length === 2, 'the preview reads it: ' + parsed.rows.length + ' places, ' + parsed.trips.length + ' trips');
const first = parsed.rows[0], g0 = small.features[0];
ok(first.lat === g0.geometry.coordinates[1] && first.lon === g0.geometry.coordinates[0] && first.name === g0.properties.name, 'its first place has the same name and the same coordinates');
const edge = parsed.rows.find((r) => r.name === 'South-west corner');
ok(edge.lat === -89.999999 && edge.lon === -180, 'the corner of the world is exact: ' + edge.lat + ', ' + edge.lon);

// ---------- the older forms still open
const smallOld = 'z.' + zlib.deflateRawSync(Buffer.from(JSON.stringify(small))).toString('base64url');
const old = ai.parseItinerary(await ai.decodeShare(smallOld));
ok(old.rows.length === small.features.length, 'a link in the older compressed form still opens');
const plain = ai.parseItinerary(await ai.decodeShare(encodeURIComponent(JSON.stringify(small))));
ok(plain.rows.length === small.features.length, 'and so does a plain, uncompressed link');
let threw = false; try { await ai.decodeShare('z2.not-a-link'); } catch { threw = true; }
ok(threw, 'a damaged compact link is refused with a readable message');

// ---------- small lists and the shape of a link
const one = poi.toGeoJSON([poi.sanitize({ type: 'photo', name: 'Solo', lat: 1.3521, lon: 103.8198 })], []);
const l1 = await ai.encodeShare(JSON.stringify(one));
const r1 = ai.parseItinerary(await ai.decodeShare(l1));
ok(r1.rows.length === 1 && r1.rows[0].lat === 1.3521 && r1.rows[0].lon === 103.8198 && r1.trips.length === 0, 'one place and no trip: a short link that reads back exactly');
const notOurs = await ai.encodeShare(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'x' }, geometry: { type: 'Point', coordinates: [1, 2] } }] }));
ok(notOurs.startsWith('z.'), 'anything that is not an app export keeps the older compressed form');

// ---------- the type list in a link is frozen: new types are only appended
const OLD_TEN = ['home', 'hotel', 'takeoff', 'landing', 'photo', 'train', 'airport', 'hazard', 'residence', 'other'];
const NEW_SIX = ['food', 'attraction', 'shopping', 'nature', 'transport', 'meeting'];
ok(JSON.stringify(SC.SHARE_TYPE_ORDER) === JSON.stringify([...OLD_TEN, ...NEW_SIX]) && JSON.stringify(poi.TYPES.map((t) => t.id)) === JSON.stringify(SC.SHARE_TYPE_ORDER), 'the share order is the first ten, unchanged, then the six new types; TYPES lists them in the same order');
{
  const gjOf = (type) => ({ type: 'FeatureCollection', uavzones: 1, features: [{ type: 'Feature', properties: { id: 'a', type, name: 'X' }, geometry: { type: 'Point', coordinates: [114.3, 30.5] } }] });
  const idx = (type) => SC.compactShare(gjOf(type)).m[0][0];
  ok(OLD_TEN.every((t, i) => idx(t) === i), 'a link written today stores each of the first ten types as the same number as before, so links made earlier open correctly');
  // a row an earlier version wrote: type number 8 was "residence", 9 "other"
  const oldRows = (n) => ({ v: 2, m: [[n, 'Old', 1, 1]] });
  ok(SC.expandShare(oldRows(8)).features[0].properties.type === 'residence' && SC.expandShare(oldRows(9)).features[0].properties.type === 'other' && SC.expandShare(oldRows(1)).features[0].properties.type === 'hotel', 'rows written by an earlier version decode to the same types');
  ok(SC.expandShare(oldRows(99)).features[0].properties.type === 'other', 'a type number nobody knows decodes to other');
  ok(idx('banana') === OLD_TEN.indexOf('other') && idx(undefined) === OLD_TEN.indexOf('other'), 'an unknown type is written as other, not as the first type (home)');
  let all = true;
  for (const t of poi.TYPES.map((x) => x.id)) {
    const l = await ai.encodeShare(JSON.stringify(gjOf(t)));
    const row = ai.parseItinerary(await ai.decodeShare(l)).rows[0];
    all = all && row.type === t;
  }
  ok(all, 'all sixteen types survive a real share link (encode, decode, import preview)');
}
