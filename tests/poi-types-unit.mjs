// The sixteen marker types: ids, groups, behaviour of the six added ones, and the rules that must not move. No browser needed.
import { ROOT } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const poi = await load('src/poi.js');
const dist = await load('src/distance.js');
const trips = await load('src/trips.js');
const ids = poi.TYPES.map((t) => t.id);
const OLD = ['home', 'hotel', 'takeoff', 'landing', 'photo', 'train', 'airport', 'hazard', 'residence', 'other'];
const NEW = ['food', 'attraction', 'shopping', 'nature', 'transport', 'meeting'];

ok(ids.length === 16 && JSON.stringify(ids) === JSON.stringify([...OLD, ...NEW]), 'exactly 16 ids: the ten existing ones in their old order, then the six new ones');
ok(poi.typeOf('hotel').label === 'Accommodation' && ids.includes('hotel') && !ids.includes('accommodation'), 'hotel keeps its id and is shown as Accommodation');
ok(poi.typeOf('nonsense').id === 'other' && poi.typeOf(undefined).id === 'other', 'an unknown type falls back to other (looked up by id, not by position)');
ok(new Set(poi.TYPES.map((t) => t.color)).size === 16 && new Set(poi.TYPES.map((t) => t.glyph)).size === 16, 'every type has its own colour and its own glyph');
ok(poi.TYPES.every((t) => typeof t.label === 'string' && t.label.length > 2 && typeof t.hint === 'string' && t.hint.length > 5), 'every type has a label and a hint');
ok(poi.TYPES.every((t) => /^#[0-9a-f]{6}$/i.test(t.color)), 'colours are plain hex values');

// white glyphs on the pin: WCAG contrast of the colour against white must be at least 3
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (hex) => 1.05 / (lum(hex) + 0.05);
const weak = poi.TYPES.filter((t) => contrast(t.color) < 3).map((t) => t.id + ' ' + contrast(t.color).toFixed(2));
ok(weak.length === 0, 'every pin colour has at least 3:1 contrast with its white glyph' + (weak.length ? ': ' + weak.join(', ') : ''));
ok(NEW.every((id) => { const svg = poi.pinSvg(id); return svg.startsWith('<svg') && svg.includes(poi.typeOf(id).color) && !/<script|on\w+=/i.test(svg); }), 'the new pins build from constants only');

// picker groups: presentation only, every type exactly once
const inGroups = poi.TYPE_GROUPS.flatMap((g) => g.types);
ok(poi.TYPE_GROUPS.map((g) => g.label).join('|') === 'Travel & Places|Transportation|Drone & Safety|Special', 'four groups in the agreed order');
ok(inGroups.length === 16 && new Set(inGroups).size === 16 && ids.every((id) => inGroups.includes(id)), 'every type is in exactly one group');
ok(poi.groupOf('hotel') === 'travel' && poi.groupOf('transport') === 'transport' && poi.groupOf('train') === 'transport' && poi.groupOf('home') === 'drone' && poi.groupOf('residence') === 'special' && poi.groupOf('meeting') === 'travel', 'groupOf follows the agreed table');
ok(poi.groupOf('unknown') === 'special', 'an unknown type is shown under Special');
ok(!('group' in poi.sanitize({ type: 'food', name: 'x', lat: 1, lon: 1 })), 'the group is not a stored property');

// behaviour: the six new types are ordinary waypoints
ok(NEW.every((id) => !poi.NOT_SUB.has(id)) && [...poi.NOT_SUB].sort().join() === 'home,hotel,residence', 'none of the six is in NOT_SUB; the three special types are unchanged');
ok(NEW.every((id) => dist.isWaypoint({ type: id }) && dist.needsDistance({ type: id })) && dist.BASE_TYPES.map((b) => b.id).join() === 'home,hotel,residence', 'none of the six is a distance base; they are waypoints measured to the bases');
const hotelBase = dist.BASE_TYPES.find((b) => b.id === 'hotel');
ok(hotelBase.launch === true && hotelBase.label === 'Accommodation' && dist.BASE_TYPES.find((b) => b.id === 'residence').launch === false, 'the accommodation base still counts toward max range; Home still does not');
for (const id of OLD) ok(poi.sanitize({ type: id, name: 'n', lat: 1, lon: 2 }).type === id, 'sanitize keeps ' + id);
for (const id of NEW) {
  const s = poi.sanitize({ type: id, name: 'n', lat: 1, lon: 2, isSub: true, parentId: 'p', tripId: 't', date: '2026-11-12', order: 2, note: 'x' });
  ok(s.type === id && s.isSub === true && s.parentId === 'p' && s.tripId === 't' && s.date === '2026-11-12' && s.order === 2, id + ': kept as a Side Quest with trip, date and order');
}
const sub = (type) => poi.sanitize({ type, name: 'h', lat: 1, lon: 2, isSub: true, tripId: 't' });
ok(sub('hotel').isSub === undefined && sub('home').isSub === undefined && sub('residence').isSub === undefined && sub('residence').tripId === undefined, 'Accommodation, Home point and Home still cannot be Side Quests; Home still has no trip');
ok(poi.sanitize({ type: 'food', name: '', lat: 1, lon: 2 }).name === 'Food & Drink', 'an unnamed new marker takes its type label as the name');
ok(poi.sanitize({ type: 'teleporter', name: 'n', lat: 1, lon: 2 }).type === 'other', 'a type this build does not know becomes other');

// legacy data: stored markers of the first ten types load unchanged
const legacy = OLD.map((t, i) => ({ id: 'l' + i, type: t, name: 'Old ' + t, note: 'n', lat: 10 + i, lon: 20 + i, created: '2026-01-01T00:00:00.000Z' }));
ok(legacy.every((raw) => { const s = poi.sanitize(raw); return s.id === raw.id && s.type === raw.type && s.name === raw.name && s.lat === raw.lat && s.lon === raw.lon && s.created === raw.created; }), 'stored markers of the first ten types load with the same id, type, name, position and created time');

// Accommodation keeps its lodging rules (night coverage); a food stop is not lodging; the warning text says accommodation
const trip = { id: 't1', name: 'T', startDate: '2026-11-12', endDate: '2026-11-15' };
const stay = poi.sanitize({ id: 'h', type: 'hotel', name: 'H', lat: 1, lon: 1, tripId: 't1', date: '2026-11-12', endDate: '2026-11-13' });
const meal = poi.sanitize({ id: 'f', type: 'food', name: 'F', lat: 1, lon: 1, tripId: 't1', date: '2026-11-14' });
const w = trips.tripWarnings([stay, meal], trip);
ok(w.noHotel.join() === '2,3', 'a stay covers the nights from check-in to check-out, and the gap days are reported');
ok(trips.warningsLine(w).includes('no accommodation for the night of Days 2, 3') && !/hotel/i.test(trips.warningsLine(w)), 'the trip warning says accommodation');
ok(trips.tripWarnings([meal], trip).noHotel.length === 0, 'a trip with no accommodation at all gives no gap warning (staying with friends)');

// wording: the id is still hotel in what an AI reads
const prompt = fs.readFileSync(path.join(ROOT, 'public/ai/prompt.md'), 'utf8');
ok(/"hotel"/.test(prompt) && /Accommodation/.test(prompt), 'the prompt keeps the id "hotel" and says it is shown as Accommodation');
