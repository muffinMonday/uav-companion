import { ROOT } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const throwsMsg = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

const poi = await load('src/poi.js');
const ai = await load('src/aiimport.js');

// ---- the published spec matches the code
const prompt = fs.readFileSync(path.join(ROOT, 'public/ai/prompt.md'), 'utf8');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/ai/schema.json'), 'utf8'));
const example = fs.readFileSync(path.join(ROOT, 'public/ai/example.geojson'), 'utf8');
const llms = fs.readFileSync(path.join(ROOT, 'public/llms.txt'), 'utf8');
const ids = poi.TYPES.map((t) => t.id);
ok(ids.every((id) => prompt.includes(`"${id}"`)), 'prompt.md names every marker type: ' + ids.join(', '));
ok(JSON.stringify(schema.$defs.feature.properties.properties.properties.type.enum) === JSON.stringify(ids), 'schema.json type list equals the app\'s type list');
ok(/LONGITUDE, LATITUDE/.test(prompt) && /geometry": null/.test(prompt) && /query/.test(prompt) && /OPTIONAL/.test(prompt), 'prompt states lon,lat order, the null-geometry + query rule, and that day/order are optional');
ok(/Never invent|Do not estimate|make them up/.test(prompt), 'prompt forbids invented coordinates');
ok(!/gemini|chatgpt|claude|openai/i.test(prompt + llms), 'prompt and llms.txt are not tied to any one AI');
ok(/ai\/prompt\.md/.test(llms) && /ai\/schema\.json/.test(llms) && /ai\/example\.geojson/.test(llms), 'llms.txt points at the three spec files');
ok(schema.properties.features.items.$ref === '#/$defs/feature' && !schema.$defs.feature.properties.properties.required.includes('day') && !schema.$defs.feature.properties.properties.required.includes('order'), 'schema: day and order are not required');

const ex = ai.parseItinerary(example);
ok(ex.rows.length === 4 && ex.rows.filter((r) => r.status === 'ok').length === 2 && ex.rows.filter((r) => r.status === 'lookup').length === 2 && ex.skipped === 0, 'example.geojson parses: 2 with coordinates, 2 to look up, 0 skipped');
ok(ex.rows.every((r) => r.unverified === true), 'AI-made content defaults to unverified');
ok(ex.rows[0].day === 1 && ex.rows[0].order === 1 && ex.rows[3].day === null && ex.rows[3].order === null, 'day/order read when present, null when absent');

// ---- tolerant input
const fc = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [114.3, 30.6] }, properties: { name: 'A' } }] });
ok(ai.parseItinerary('Sure! Here is your plan:\n```json\n' + fc + '\n```\nEnjoy your trip!').rows.length === 1, 'JSON inside a fenced block with prose around it');
ok(ai.parseItinerary('Here you go: ' + fc + ' Let me know if you want changes.').rows.length === 1, 'JSON inside prose with no fence');
ok(ai.parseItinerary('```\n' + fc + '\n```').rows.length === 1, 'fence without a language tag');
ok(ai.parseItinerary(JSON.stringify([{ name: 'B', type: 'hotel', lat: 1.3, lon: 103.8 }, { name: 'C', query: 'Marina Bay Sands, Singapore' }])).rows.map((r) => r.status).join() === 'ok,lookup', 'a bare array of flat objects');
ok(ai.parseItinerary(JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'solo' } })).rows.length === 1, 'a single Feature');
ok(await throwsMsg(() => ai.parseItinerary('')) !== null && /Nothing to read/.test(await throwsMsg(() => ai.parseItinerary('   '))), 'empty text: readable error');
ok(/valid JSON/.test(await throwsMsg(() => ai.parseItinerary('I could not do that, sorry.'))), 'prose with no JSON: readable error');
ok(/not a list of places/.test(await throwsMsg(() => ai.parseItinerary('{"hello":1}'))), 'JSON that is not places: readable error');
ok(/no places/.test(await throwsMsg(() => ai.parseItinerary('{"type":"FeatureCollection","features":[]}'))), 'empty collection: readable error');
ok(/No usable places/.test(await throwsMsg(() => ai.parseItinerary(JSON.stringify([{ note: 'x' }, { lat: 5 }])))), 'nothing placeable: readable error');
ok(/too long/.test(await throwsMsg(() => ai.parseItinerary('x'.repeat(2.1e6)))), 'oversized text rejected');

// ---- coordinates: the main hallucination risks
const one = (props, geometry) => ai.parseItinerary(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: props }] }));
const pt = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });
ok(one({ name: 'Null island', query: 'Somewhere' }, pt(0, 0)).rows[0].status === 'lookup', '(0, 0) is treated as missing and falls back to the query');
ok(await throwsMsg(() => one({}, pt(0, 0))) !== null, '(0, 0) with no name or query: nothing usable');
const sw = one({ name: 'Swapped' }, pt(30.5928, 114.3055));
ok(sw.rows[0].lat === 30.5928 && sw.rows[0].lon === 114.3055 && sw.notes.some((n) => /wrong way round/.test(n)), 'impossible latitude (lat,lon given swapped) is corrected and reported');
ok(one({ name: 'Out', query: 'q' }, pt(500, 20)).rows[0].status === 'lookup', 'longitude out of range: not trusted, falls back to the query');
ok(one({ name: 'Str' }, { type: 'Point', coordinates: ['114.3', '30.6'] }).rows[0].lat === 30.6, 'numeric strings are accepted as coordinates');
ok(one({ name: 'Nan', query: 'q' }, { type: 'Point', coordinates: ['x', null] }).rows[0].status === 'lookup', 'non-numeric coordinates fall back to the query');
ok(one({ name: 'Line', query: 'q' }, { type: 'LineString', coordinates: [[1, 2], [3, 4]] }).rows[0].status === 'lookup', 'a non-Point geometry is ignored');

// ---- optional fields
const f = (p) => one({ name: 'F', ...p }, pt(114, 30)).rows[0];
ok(f({}).day === null && f({}).order === null, 'day and order absent: null');
ok(f({ day: 3, order: 2 }).day === 3 && f({ day: '4', order: '1' }).day === 4, 'day/order accepted as numbers or numeric strings');
ok([0, -1, 1000, 2.5, 'abc', '', null, true, [1]].every((v) => f({ day: v }).day === null), 'invalid day values (0, -1, 1000, 2.5, text, empty, null, true, array) are dropped, not guessed');
ok(f({ type: 'spaceship' }).type === 'other' && f({ type: 'hotel' }).type === 'hotel', 'unknown type falls back to other');
ok(f({ name: 'x'.repeat(200) }).name.length === 80 && f({ note: 'n'.repeat(900) }).note.length === 500, 'name and note are length-limited');
ok(one({ name: 'Q', query: 'q'.repeat(500) }, null).rows[0].query.length === 200, 'query is length-limited');
ok(one({ name: '', query: '' }, pt(1, 2)).rows[0].status === 'ok', 'a place with coordinates but no name is kept (it gets a default name later)');
const big = JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: 250 }, (_, i) => ({ type: 'Feature', geometry: pt(100 + i * 0.01, 30), properties: { name: 'p' + i } })) });
const cap = ai.parseItinerary(big);
ok(cap.rows.length === 200 && cap.skipped === 50 && cap.notes.some((n) => /first 200/.test(n)), 'more than 200 places: the first 200 are read and the rest reported as skipped');

// ---- unverified: AI vs this app's own export
const own = JSON.stringify({ type: 'FeatureCollection', uavzones: 1, features: [
  { type: 'Feature', geometry: pt(114, 30), properties: { name: 'verified one' } },
  { type: 'Feature', geometry: pt(115, 31), properties: { name: 'still unchecked', unverified: true } }] });
const o = ai.parseItinerary(own);
ok(o.appExport && o.rows[0].unverified === false && o.rows[1].unverified === true, 'this app\'s own export keeps its unverified flags (verified stays verified)');
ok(ai.parseItinerary(fc).appExport === false, 'a file without the app marker is treated as AI output');

// ---- duplicates
const existing = [{ name: 'Riverside Hotel', lat: 30.5928, lon: 114.3055 }];
ok(ai.isDuplicate({ status: 'ok', name: 'riverside hotel', lat: 30.5929, lon: 114.3056 }, existing), 'same name within ~30 m is a duplicate (case-insensitive)');
ok(!ai.isDuplicate({ status: 'ok', name: 'Riverside Hotel', lat: 30.62, lon: 114.3055 }, existing), 'same name 3 km away is not');
ok(!ai.isDuplicate({ status: 'ok', name: 'Other', lat: 30.5928, lon: 114.3055 }, existing), 'different name at the same spot is not');
ok(!ai.isDuplicate({ status: 'lookup', name: 'Riverside Hotel' }, existing), 'a place still to be looked up cannot be judged yet');

// ---- share links
const items = [{ type: 'Feature', geometry: pt(114.3055, 30.5928), properties: { name: 'Hotel 酒店 "quoted" <b>', type: 'hotel', note: 'line1\nline2', day: 1, order: 2 } }];
const text = JSON.stringify({ type: 'FeatureCollection', uavzones: 1, features: items });
const enc = await ai.encodeShare(text);
ok(enc.startsWith('z.') && /^z\.[A-Za-z0-9_-]+$/.test(enc), 'share fragment is compressed base64url: ' + enc.slice(0, 20) + '…');
ok(await ai.decodeShare(enc) === text, 'share round trip preserves the text exactly (including non-ASCII, quotes, newlines)');
const many = JSON.stringify({ type: 'FeatureCollection', uavzones: 1, features: Array.from({ length: 40 }, (_, i) => ({ type: 'Feature', geometry: pt(114 + i * 0.001, 30.5), properties: { name: 'Stop ' + i, type: 'photo', note: 'A scenic place number ' + i, day: 1 + (i % 4), order: i } })) });
const encMany = await ai.encodeShare(many);
ok(encMany.length < many.length * 0.6, `40 places: ${many.length} chars of JSON become a ${encMany.length} character link fragment`);
ok(await ai.decodeShare(encodeURIComponent(text)) === text, 'plain percent-encoded JSON is accepted as well');
for (const [label, v] of [['cut short', enc.slice(0, enc.length - 6)], ['not base64', 'z.!!!@@@'], ['garbage', 'z.' + 'A'.repeat(50)], ['empty payload', 'z.'], ['bad percent escape', '%E0%A4%A']]) {
  ok(/could not be read/.test(await throwsMsg(() => ai.decodeShare(v))), `bad link (${label}): readable error, no crash`);
}
ok(/could not be read/.test(await throwsMsg(() => ai.decodeShare('z.' + 'A'.repeat(500000)))), 'oversized link rejected');

// ---- optional fields in stored records
const base = { type: 'hotel', name: 'N', note: '', lat: 1, lon: 2 };
ok(Object.keys(poi.sanitize({ ...base })).sort().join() === 'created,id,lat,lon,name,note,type', 'a marker without day/order/unverified has exactly the original 7 fields');
const full = poi.sanitize({ ...base, day: 2, order: 3, unverified: true });
ok(full.day === 2 && full.order === 3 && full.unverified === true, 'day, order and unverified are kept when set');
ok(!('day' in poi.sanitize({ ...base, day: null })) && !('unverified' in poi.sanitize({ ...base, unverified: false })) && !('unverified' in poi.sanitize({ ...base, unverified: 'yes' })), 'null/false/non-true values leave the field out');
const gj = poi.toGeoJSON([full, poi.sanitize(base)]);
ok(gj.features[0].properties.day === 2 && gj.features[0].properties.unverified === true && !('day' in gj.features[1].properties) && !('unverified' in gj.features[1].properties), 'export includes the optional fields only where set');
ok(gj.uavzones === 1, 'export carries the app marker used to recognise it');
const rt = poi.parseGeoJSON(JSON.stringify(gj)).items;
ok(rt[0].day === 2 && rt[0].order === 3 && rt[0].unverified === true && rt[1].day === undefined, 'file import round-trips the optional fields');

// ---- list order
const mk = (name, day, order, t) => ({ name, ...(day && { day }), ...(order && { order }), created: new Date(Date.UTC(2026, 0, t)).toISOString() });
const plain = poi.sortForList([mk('old', 0, 0, 1), mk('new', 0, 0, 3), mk('mid', 0, 0, 2)]);
ok(plain.map((i) => i.name).join() === 'new,mid,old', 'no day anywhere: newest first (unchanged behaviour)');
const planned = poi.sortForList([mk('d2o1', 2, 1, 1), mk('none', 0, 0, 9), mk('d1o2', 1, 2, 2), mk('d1o1', 1, 1, 3), mk('d1', 1, 0, 4), mk('d2', 2, 0, 5)]);
ok(planned.map((i) => i.name).join() === 'd1o1,d1o2,d1,d2o1,d2,none', 'with days: by day, then stop, stops without a number last in the day, no-day last: ' + planned.map((i) => i.name).join());
console.log('done');
