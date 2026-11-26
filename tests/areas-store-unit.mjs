// Community flying areas (src/areas/store.js): local CRUD, reload, corrupted or blocked storage, memory fallback, GeoJSON import and export. No browser.
import { createAreaStore, parseGeoJSON, toGeoJSON, KEY, BACKUP_KEY, MAX_AREAS, SPOT_KIND, GEOJSON_KIND } from '../src/areas/store.js';
import { closeRing } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };
const fake = (init = {}, { failSet = false, failGet = false } = {}) => {
  const m = { ...init };
  return { m, getItem(k) { if (failGet) throw new Error('blocked'); return k in m ? m[k] : null; }, setItem(k, v) { if (failSet) throw new Error('quota'); m[k] = String(v); } };
};
const sq = (x = 103.8, y = 1.3, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const draft = (over = {}) => ({ name: 'Park', description: 'Open grass', drawKind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq())] }, spots: [{ type: 'shelter', note: 'pavilion', coordinates: [103.805, 1.305] }], ...over });

// CRUD and persistence
{
  const s = fake(); const st = createAreaStore({ storage: s });
  ok(st.list().length === 0 && st.status().persistent, 'starts empty and persistent');
  const r = st.add(draft());
  ok(r.ok && /^a/.test(r.area.id) && r.area.created && r.area.updated, 'add returns the stored record with an id and times');
  ok(JSON.parse(s.m[KEY]).v === 1 && JSON.parse(s.m[KEY]).areas.length === 1, 'stored as { v: 1, areas }');
  ok(KEY === 'uavzones.v1.areas', 'the key is uavzones.v1.areas');
  const again = createAreaStore({ storage: s });
  ok(again.list().length === 1 && again.get(r.area.id).name === 'Park' && again.get(r.area.id).spots.length === 1, 'a reload gives the same area and spots back');
  const u = st.update(r.area.id, { ...draft({ name: 'Renamed' }) });
  ok(u.ok && u.area.id === r.area.id && u.area.created === r.area.created && st.get(r.area.id).name === 'Renamed', 'update keeps id and created time');
  ok(!st.update(r.area.id, draft({ name: '' })).ok && st.get(r.area.id).name === 'Renamed', 'an invalid update changes nothing');
  ok(!st.update('nope', draft()).ok, 'updating a missing area fails');
  const d = st.duplicate(r.area.id);
  ok(d.ok && d.area.id !== r.area.id && d.area.name === 'Copy of Renamed' && d.area.spots.length === 1 && st.count() === 2, 'duplicate makes a separate copy');
  const long = st.add(draft({ name: 'x'.repeat(80) })); const dl = st.duplicate(long.area.id);
  ok(dl.ok && Array.from(dl.area.name).length === 80, 'a duplicate of a very long name is cut to 80');
  ok(st.remove(r.area.id) && !st.remove(r.area.id) && st.count() === 3, 'remove deletes once');
  ok(createAreaStore({ storage: s }).count() === 3, 'removal is persisted');
  ok(!st.add({ ...draft(), name: 5 }).ok, 'add validates');
  const list = st.list(); list[0].name = 'hacked';
  ok(st.list()[0].name !== 'hacked', 'list returns copies');
  let n = 0; const off = st.onChange(() => n++); st.add(draft()); off(); st.add(draft());
  ok(n === 1, 'onChange fires per change and can be removed');
}

// corrupted storage
{
  const s = fake({ [KEY]: '{not json' }); const st = createAreaStore({ storage: s });
  ok(st.list().length === 0 && st.status().recovered?.reason === 'unreadable' && s.m[BACKUP_KEY] === '{not json', 'broken JSON: starts empty, original copied to the backup key');
  st.add(draft());
  ok(s.m[BACKUP_KEY] === '{not json', 'the backup is not overwritten by later saves');
  const s2 = fake({ [KEY]: JSON.stringify({ v: 2, areas: [] }) }); const st2 = createAreaStore({ storage: s2 });
  ok(st2.status().recovered?.reason === 'unknown-format' && s2.m[BACKUP_KEY], 'an unknown version is backed up, not read');
  const s3 = fake({ [KEY]: JSON.stringify({ v: 1, areas: 'x' }) });
  ok(createAreaStore({ storage: s3 }).status().recovered?.reason === 'unknown-format', 'areas that are not a list are refused');
  const good = createAreaStore({ storage: fake() }).add(draft()).area;
  const bad1 = { ...good, id: 'b1', name: '' }, bad2 = { ...good, id: 'b2', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] } }, noId = { ...good, id: '' }, dup = { ...good };
  const s4 = fake({ [KEY]: JSON.stringify({ v: 1, areas: [good, bad1, bad2, noId, dup, 'junk', null, { ...good, id: 'ok2', spots: [{ type: 'open', coordinates: [50, 50] }] }] }) });
  const st4 = createAreaStore({ storage: s4 });
  ok(st4.count() === 1 && st4.status().recovered.dropped === 7 && s4.m[BACKUP_KEY], 'invalid, duplicate and id-less records are dropped (7) and the original is backed up');
  const s5 = fake({ [KEY]: JSON.stringify({ v: 1, areas: [{ ...good, created: 'garbage', updated: 5 }] }) });
  const st5 = createAreaStore({ storage: s5 });
  ok(st5.count() === 1 && !Number.isNaN(Date.parse(st5.list()[0].created)), 'a bad timestamp is replaced, the area kept');
  const evil = { ...good, name: '<img src=x onerror=alert(1)>', description: '<script>' };
  ok(createAreaStore({ storage: fake({ [KEY]: JSON.stringify({ v: 1, areas: [evil] }) }) }).list()[0].name === '<img src=x onerror=alert(1)>', 'text is kept as text (rendering uses textContent)');
}

// blocked or full storage: memory fallback
{
  const st = createAreaStore({ storage: fake({}, { failGet: true }) });
  ok(!st.status().persistent && /export/i.test(st.status().warning), 'a blocked read falls back to memory with a warning');
  ok(st.add(draft()).ok && st.count() === 1, 'areas still work in memory');
  const full = createAreaStore({ storage: fake({}, { failSet: true }) });
  ok(full.status().persistent, 'storage that can be read starts persistent');
  full.add(draft());
  ok(!full.status().persistent && full.count() === 1 && /export/i.test(full.status().warning), 'a failed write switches to memory with a warning and keeps the area');
  const none = createAreaStore({ storage: null });
  ok(!none.status().persistent && none.add(draft()).ok, 'no storage at all: memory only');
}

// limits
{
  const st = createAreaStore({ storage: fake() });
  for (let i = 0; i < MAX_AREAS; i++) st.add(draft({ name: 'a' + i }));
  ok(st.count() === MAX_AREAS && st.add(draft()).errors[0].code === 'too-many-areas', `at most ${MAX_AREAS} areas`);
}

// export
{
  const st = createAreaStore({ storage: fake() });
  const a = st.add(draft({ drawKind: 'rectangle', geometry: { type: 'Polygon', coordinates: [closeRing(sq())] } })).area;
  const b = st.add(draft({ name: 'Second', spots: [] })).area;
  const fc = st.toGeoJSON();
  ok(fc.type === 'FeatureCollection' && fc.features.length === 3, 'export: 2 polygons + 1 spot point');
  const poly = fc.features[0];
  ok(poly.geometry.type === 'Polygon' && poly.properties.kind === GEOJSON_KIND && poly.properties.name === 'Park' && poly.properties.drawKind === 'rectangle' && poly.properties.id === a.id, 'polygon feature carries name, kind and id');
  ok(fc.features[1].geometry.type === 'Point' && fc.features[1].properties.kind === SPOT_KIND && fc.features[1].properties.areaId === a.id && fc.features[1].properties.type === 'shelter', 'spot feature names its area and type');
  ok(st.toGeoJSON([b.id]).features.length === 1, 'export of one area');
  ok(JSON.stringify(poly.geometry.coordinates[0][0]) === JSON.stringify(poly.geometry.coordinates[0].at(-1)), 'the exported ring is closed');
  // round trip
  const st2 = createAreaStore({ storage: fake() });
  const res = st2.importGeoJSON(JSON.stringify(fc));
  ok(res.added === 2 && res.skipped.length === 0 && !res.error, 'round trip: both areas imported');
  const back = st2.list();
  ok(back[0].name === 'Park' && back[0].drawKind === 'rectangle' && back[0].spots.length === 1 && back[0].spots[0].type === 'shelter' && back[0].spots[0].note === 'pavilion', 'round trip keeps name, kind and spots');
  ok(JSON.stringify(back[0].geometry) === JSON.stringify(a.geometry), 'round trip keeps the geometry');
  ok(back[0].id !== a.id, 'imported areas get new ids');
  st2.importGeoJSON(JSON.stringify(fc));
  ok(st2.count() === 4, 'importing again adds copies');
  ok(toGeoJSON([]).features.length === 0, 'an empty export is an empty collection');
}

// import validation
{
  const poly = (extra = {}, ring = closeRing(sq()), props = { name: 'X' }) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring], ...extra } });
  const run = (doc) => { const st = createAreaStore({ storage: fake() }); const r = st.importGeoJSON(typeof doc === 'string' ? doc : JSON.stringify(doc)); return { r, st }; };
  ok(run('').r.error && run('   ').r.error, 'empty file refused');
  ok(/valid JSON/.test(run('{oops').r.error), 'invalid JSON refused');
  ok(/not GeoJSON/.test(run({ hello: 1 }).r.error) && /not GeoJSON/.test(run([]).r.error) && /not GeoJSON/.test(run('null').r.error), 'non-GeoJSON refused');
  ok(/too large/.test(run('x'.repeat(2 * 1024 * 1024 + 1)).r.error), 'a file over 2 MB is refused');
  ok(run(poly()).r.added === 1, 'a single Feature is accepted');
  ok(run({ type: 'Polygon', coordinates: [closeRing(sq())] }).r.skipped.length === 1, 'a bare Polygon has no name, so it is skipped with a reason');
  ok(run({ type: 'FeatureCollection', features: [poly({}, closeRing(sq()), { title: 'T' })] }).st.list()[0].name === 'T', 'properties.title is accepted as a name');
  ok(run({ type: 'FeatureCollection', features: [poly(), poly({}, closeRing(sq(1, 1, 0.01)), { name: '' })] }).r.skipped.length === 1, 'one valid, one without a name: one added, one skipped');
  let r = run({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'M' }, geometry: { type: 'MultiPolygon', coordinates: [] } }, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 1] } }, { type: 'Feature', properties: {}, geometry: null }] }).r;
  ok(r.added === 0 && r.skipped.length === 3 && /MultiPolygon/.test(r.skipped[0].reason), 'MultiPolygon, Point and null geometry are skipped with reasons');
  r = run(poly({}, [...closeRing(sq()).slice(0, 4)])).r;
  ok(r.added === 0 && /not closed/.test(r.skipped[0].reason), 'an unclosed ring is skipped');
  r = run({ type: 'Feature', properties: { name: 'H' }, geometry: { type: 'Polygon', coordinates: [closeRing(sq()), closeRing(sq(103.802, 1.302, 0.002))] } }).r;
  ok(r.added === 0 && /holes/.test(r.skipped[0].reason), 'a polygon with a hole is skipped');
  r = run(poly({}, [[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01], [0, 0]])).r;
  ok(r.added === 0 && /crosses/.test(r.skipped[0].reason), 'a self-intersecting polygon is skipped');
  r = run(poly({}, closeRing(sq(0, 0, 1)))).r;
  ok(r.added === 0 && /km²/.test(r.skipped[0].reason), 'an oversized polygon is skipped');
  r = run(poly({}, [[179.99, 0], [-179.99, 0], [-179.99, 0.01], [179.99, 0.01], [179.99, 0]])).r;
  ok(r.added === 0 && /180/.test(r.skipped[0].reason), 'an antimeridian polygon is skipped');
  r = run(poly({}, [[0, 0], [0.01, 0], [200, 5], [0, 0]])).r;
  ok(r.added === 0 && r.skipped.length === 1, 'out-of-range coordinates are skipped');
  r = run(poly({}, closeRing(Array.from({ length: 101 }, (_, i) => [0.001 * Math.cos(i / 101 * 6.2832), 0.001 * Math.sin(i / 101 * 6.2832)])))).r;
  ok(r.added === 0 && /100/.test(r.skipped[0].reason), 'a 101-vertex polygon is skipped');
  const withSpots = (spots) => ({ type: 'FeatureCollection', features: [poly({}, closeRing(sq()), { kind: GEOJSON_KIND, id: 'P1', name: 'With' }), ...spots.map(([type, c, areaId = 'P1']) => ({ type: 'Feature', properties: { kind: SPOT_KIND, areaId, type, note: 'n' }, geometry: { type: 'Point', coordinates: c } }))] });
  let x = run(withSpots([['open', [103.805, 1.305]]]));
  ok(x.r.added === 1 && x.st.list()[0].spots.length === 1, 'a spot inside is imported with its area');
  x = run(withSpots([['open', [110, 1.305]]]));
  ok(x.r.added === 0 && /outside/.test(x.r.skipped[0].reason), 'a spot outside makes the area fail validation, with a reason');
  x = run(withSpots([['toilet', [103.805, 1.305]]]));
  ok(x.r.added === 0, 'a spot with an unknown type fails the area');
  x = run(withSpots([['open', [103.805, 1.305], 'OTHER']]));
  ok(x.r.added === 1 && x.st.list()[0].spots.length === 0, 'a spot naming an absent area is ignored');
  x = run(withSpots(Array.from({ length: 11 }, () => ['open', [103.805, 1.305]])));
  ok(x.r.added === 0 && /10/.test(x.r.skipped[0].reason), 'more than 10 spots fail the area');
  x = run({ type: 'FeatureCollection', features: [poly({}, closeRing(sq()), { name: '<script>alert(1)</script>', id: '__proto__' })] });
  ok(x.r.added === 1 && x.st.list()[0].id !== '__proto__', 'an imported id is never reused');
  ok(parseGeoJSON('{"type":"FeatureCollection","features":[]}').areas.length === 0, 'an empty collection imports nothing without error');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
