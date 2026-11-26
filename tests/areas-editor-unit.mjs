// Community flying areas (src/areas/editor.js): polygon and rectangle drawing, vertex editing, setup spots, undo, cancel (dirty tracking). No browser.
import { createEditor } from '../src/areas/editor.js';
import { closeRing, validateArea } from '../src/areas/core.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };
const P = [[103.8, 1.3], [103.81, 1.3], [103.81, 1.31], [103.8, 1.31]];
const drawn = () => { const e = createEditor({ kind: 'polygon' }); for (const p of P) e.addVertex(p); return e; };

// polygon drawing
{
  const e = createEditor({ kind: 'polygon' });
  ok(e.kind === 'polygon' && !e.closed && e.vertices.length === 0 && !e.dirty && !e.canUndo, 'a new polygon session is empty and clean');
  ok(e.addVertex(P[0]).ok && e.addVertex(P[1]).ok && e.vertices.length === 2 && e.dirty, 'taps add vertices');
  ok(!e.finish().ok && /3/.test(e.finish().message), 'finish needs 3 points');
  ok(!e.addVertex(P[1]).ok && e.vertices.length === 2, 'a tap on an existing point is refused');
  ok(!e.addVertex([500, 1]).ok && !e.addVertex(null).ok, 'invalid positions are refused');
  e.addVertex(P[2]);
  ok(e.finish().ok && e.closed, 'finish closes a valid outline');
  ok(!e.addVertex(P[3]).ok, 'no new points after finish (drag to edit)');
  ok(e.validate().ok, 'the finished polygon validates');
  const d = e.toDraft(); d.name = 'Test';
  ok(validateArea(d).ok, 'the draft is accepted by validateArea');
}
{ // a bow-tie cannot be finished; live check explains it
  const e = createEditor({ kind: 'polygon' });
  [[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01]].forEach((p) => e.addVertex(p));
  ok(!e.check().ok && e.check().errors[0].code === 'self-intersection', 'live check reports the crossing');
  ok(!e.finish().ok && !e.closed, 'a self-intersecting outline cannot be finished');
  ok(e.removeVertex(3).ok && e.finish().ok, 'removing the offending point lets it finish');
}
{ // vertex cap
  const e = createEditor({ kind: 'polygon' });
  for (let i = 0; i < 100; i++) e.addVertex([0.001 * Math.cos(i / 100 * 6.2832) + 10, 0.001 * Math.sin(i / 100 * 6.2832)]);
  ok(e.vertices.length === 100 && !e.addVertex([11, 1]).ok && e.vertices.length === 100, 'the 101st point is refused');
}

// rectangle drawing
{
  const e = createEditor({ kind: 'rectangle' });
  ok(e.addVertex([103.8, 1.3]).ok && !e.closed && e.vertices.length === 1, 'first corner');
  ok(!e.addVertex([103.8, 1.31]).ok, 'a second corner in line with the first is refused');
  ok(e.addVertex([103.81, 1.31]).ok && e.closed && e.vertices.length === 4, 'second corner completes the rectangle');
  ok(JSON.stringify(e.vertices) === JSON.stringify(P), 'the rectangle is SW, SE, NE, NW');
  ok(e.drawKindOK !== false && e.toDraft().drawKind === 'rectangle', 'the draft remembers it was a rectangle');
  ok(e.finish().ok && e.validate().ok, 'a rectangle needs no finish step');
  // dragging a corner keeps the shape a rectangle and the opposite corner fixed
  ok(e.moveVertex(2, [103.82, 1.32]).ok, 'a corner can be dragged');
  ok(JSON.stringify(e.vertices) === JSON.stringify([[103.8, 1.3], [103.82, 1.3], [103.82, 1.32], [103.8, 1.32]]), 'the opposite corner stays, the rectangle stays axis-aligned');
  ok(e.moveVertex(0, [103.83, 1.33]).ok && e.vertices.length === 4 && e.vertices[0][0] === 103.82 && e.vertices[2][0] === 103.83, 'dragging past the opposite corner flips the rectangle, still four corners');
  ok(!e.moveVertex(0, [103.83, 1.2]).ok, 'a drag that would give zero width is refused');
  ok(!e.removeVertex(0).ok && !e.insertVertex(0, [103.805, 1.3]).ok, 'a rectangle has exactly four corners');
  // undo mid-draw
  const f = createEditor({ kind: 'rectangle' }); f.addVertex([1, 1]); f.addVertex([2, 2]);
  ok(f.undo() && !f.closed && f.vertices.length === 1, 'undo of the second corner reopens the rectangle');
  ok(f.undo() && f.vertices.length === 0 && !f.undo(), 'undo of the first corner empties it; nothing further to undo');
}

// vertex editing on a polygon
{
  const e = drawn(); e.finish();
  ok(e.moveVertex(1, [103.812, 1.299]).ok && e.vertices[1][0] === 103.812, 'a vertex can be moved');
  ok(!e.moveVertex(1, P[0]).ok, 'moving onto another vertex is refused');
  ok(!e.moveVertex(9, P[0]).ok && !e.moveVertex(-1, P[0]).ok && !e.moveVertex(0, [0, 99]).ok, 'bad index or position is refused');
  ok(e.insertVertex(0, [103.805, 1.2999]).ok && e.vertices.length === 5 && e.vertices[1][0] === 103.805, 'a point can be inserted after vertex 0');
  ok(e.removeVertex(1).ok && e.vertices.length === 4, 'a point can be removed');
  ok(e.removeVertex(0).ok && e.vertices.length === 3 && !e.removeVertex(0).ok && e.vertices.length === 3, 'a finished polygon keeps 3 points');
  // moving a vertex so the outline crosses is allowed but reported
  const g = drawn(); g.finish(); g.moveVertex(0, [103.81, 1.31 + 0.001]);
  ok(!g.check().ok && !g.validate().ok, 'an edit that makes the outline cross is flagged by check and validate');
  ok(createEditor({ kind: 'polygon' }).removeVertex(0).ok === false, 'removing from an empty outline does nothing');
  const h = createEditor({ kind: 'polygon' }); h.addVertex(P[0]); h.addVertex(P[1]);
  ok(h.removeVertex(1).ok && h.vertices.length === 1, 'while drawing, any point can be removed');
}

// undo
{
  const e = createEditor({ kind: 'polygon' });
  e.addVertex(P[0]); e.addVertex(P[1]); e.addVertex(P[2]); e.finish();
  ok(e.undo() && !e.closed && e.vertices.length === 3, 'undo reopens a finished polygon');
  e.addVertex(P[3]); e.finish(); e.moveVertex(0, [103.799, 1.299]); e.addSpot([103.805, 1.305], 'shelter');
  ok(e.undo() && e.spots.length === 0, 'undo removes the last spot');
  ok(e.undo() && e.vertices[0][0] === 103.8, 'undo reverses a vertex move');
  ok(e.undo() && !e.closed, 'undo reverses finish');
  while (e.undo());
  ok(e.vertices.length === 0 && !e.canUndo, 'undo all the way back');
}

// setup spots
{
  const e = drawn();
  ok(!e.addSpot([103.805, 1.305]).ok, 'spots wait for a finished outline');
  e.finish();
  const r = e.addSpot([103.805, 1.305], 'shelter', 'pavilion');
  ok(r.ok && e.spots.length === 1 && e.spots[0].type === 'shelter' && e.spots[0].note === 'pavilion' && e.spots[0].id, 'a spot is added with type, note and id');
  ok(!e.addSpot([103.9, 1.305], 'open').ok && e.spots.length === 1, 'a spot outside is refused');
  ok(e.addSpot([103.8, 1.305], 'open').ok && e.addSpot([103.81, 1.31], 'other').ok, 'boundary and vertex are inside');
  ok(!e.addSpot([103.805, 1.305], 'bogus').ok, 'unknown type refused');
  const id = e.spots[0].id;
  ok(e.moveSpot(id, [103.806, 1.306]).ok && e.spots[0].coordinates[0] === 103.806, 'a spot can be moved inside');
  ok(!e.moveSpot(id, [104, 1.3]).ok && e.spots[0].coordinates[0] === 103.806, 'moving a spot outside is refused, position kept');
  ok(e.setSpot(id, { type: 'seating', note: 'x'.repeat(200) }).ok && e.spots[0].type === 'seating' && e.spots[0].note.length === 120, 'type changes; a note is cut to 120');
  ok(!e.setSpot(id, { type: 'bogus' }).ok, 'bad type on edit refused');
  { let all = true; while (e.spots.length < 10) if (!e.addSpot([103.805, 1.305], 'open').ok) { all = false; break; } ok(all && e.spots.length === 10, 'spots 4 to 10 are accepted'); }
  ok(!e.addSpot([103.805, 1.305], 'open').ok && e.spots.length === 10, 'the 11th spot is refused');
  ok(e.removeSpot(id).ok && e.spots.length === 9 && !e.removeSpot(id).ok, 'a spot can be removed');
  // editing the outline can strand a spot
  const f = drawn(); f.finish(); f.addSpot([103.801, 1.301], 'open');
  ok(f.outsideSpotIds().length === 0, 'no stranded spots at first');
  f.moveVertex(0, [103.804, 1.304]); // the corner moves inward past the spot
  ok(f.outsideSpotIds().length === 1 && !f.validate().ok && f.validate().errors.some((x) => x.code === 'spot-outside'), 'a spot left outside by an outline edit is flagged and blocks validation');
}

// editing an existing area, dirty tracking and cancel
{
  const base = validateArea({ name: 'Park', description: 'd', drawKind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(P)] }, spots: [{ type: 'open', note: '', coordinates: [103.805, 1.305] }] }).area;
  const e = createEditor({ area: base });
  ok(e.closed && e.vertices.length === 4 && e.spots.length === 1 && e.name === 'Park' && e.description === 'd' && !e.dirty, 'an existing area opens finished and clean');
  e.setText({ name: 'Renamed' });
  ok(e.dirty && e.toDraft().name === 'Renamed', 'a text change makes the session dirty');
  e.setText({ name: 'Park' });
  ok(!e.dirty, 'restoring the text makes it clean again');
  e.moveVertex(0, [103.799, 1.299]); ok(e.dirty, 'a move makes it dirty');
  e.markSaved(); ok(!e.dirty, 'markSaved clears the dirty flag');
  const r = createEditor({ area: { ...base, drawKind: 'rectangle' } });
  ok(r.kind === 'rectangle' && r.moveVertex(2, [103.82, 1.32]).ok && r.vertices.length === 4, 'a stored rectangle stays a rectangle when edited');
  ok(JSON.stringify(createEditor({ area: base }).toDraft().geometry.coordinates[0]) === JSON.stringify(closeRing(P)), 'the draft ring is closed, in the original order');
  // cancelling is the caller discarding the editor: the stored area is untouched because the editor works on copies
  e.moveVertex(1, [103.9, 1.3]);
  ok(JSON.stringify(base.geometry.coordinates[0]) === JSON.stringify(closeRing(P)) && base.spots[0].coordinates[0] === 103.805, 'editing never mutates the stored record (cancel loses nothing)');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
