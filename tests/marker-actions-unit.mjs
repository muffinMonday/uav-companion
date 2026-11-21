// The marker action model (src/marker-actions.js, Review 01 S6): which actions each marker type has, and the two layouts. Pure; no browser.
import { markerActions, popupLayout, panelLayout } from '../src/marker-actions.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };
const h = { eyeOn: true, eyeLabel: 'eye', toggleEye() {}, edit() {}, visit() {}, side() {}, remove() {} };
const ids = (l) => l.map((a) => a.id).join(',');

const photo = markerActions({ type: 'photo', name: 'x' }, h);
ok(ids(Object.values(photo)) === 'eye,edit,delete,visit,side', 'a photo marker has eye, edit, delete, visit and side');
for (const type of ['residence', 'home', 'hotel']) {
  const a = markerActions({ type, name: 'x' }, h);
  ok(!a.side, `${type}: never a Side Quest action`);
}
const home = markerActions({ type: 'residence', name: 'x' }, h);
ok(!home.visit && !home.side && home.edit && home.delete && home.eye, 'the Home marker: no Add visit, no Side Quest, still Edit, Delete and the eye');
ok(markerActions({ type: 'photo', name: 'x', isSub: true }, h).side.label === 'Make main stop' && photo.side.label === 'Make Side Quest', 'the side action reads Make main stop for a Side Quest and Make Side Quest otherwise');
ok(!!markerActions({ type: 'accommodation', name: 'x' }, h).side, 'an Accommodation can still be a Side Quest (the current rule: only home, hotel and residence cannot)');
ok(photo.delete.danger === true && photo.edit.danger === undefined, 'only Delete is destructive (it keeps the two-press confirmation)');
ok(photo.eye.cls === 'pop-eye' && markerActions({ type: 'photo' }, { ...h, eyeOn: false }).eye.cls === 'pop-eye off', 'the eye follows the details setting');

// the popup's layout is what it was before the extraction
const wide = popupLayout(photo, false), phone = popupLayout(photo, true);
ok(ids(wide.tools) === 'eye,edit,visit,side,delete' && wide.menu.length === 0, 'popup, wide: eye, edit, visit, side, delete as icons');
ok(ids(phone.tools) === 'eye,edit' && ids(phone.menu) === 'visit,side,delete', 'popup, phone: eye and edit, the rest in the menu');
ok(ids(popupLayout(home, false).tools) === 'eye,edit,delete' && ids(popupLayout(home, true).menu) === 'delete', 'popup, Home marker: eye, edit, delete; phone menu holds only delete');

// the host's layout: frequent actions out, rare and destructive ones in More
const panel = panelLayout(photo);
ok(ids(panel.secondary) === 'edit,visit' && ids(panel.overflow) === 'side,delete,eye', 'host: Edit and Add visit as buttons; Side Quest, Delete and the eye in More');
const ph = panelLayout(home);
ok(ids(ph.secondary) === 'edit' && ids(ph.overflow) === 'delete,eye', 'host, Home marker: Edit; Delete and the eye in More');
const all = (p) => [...p.secondary, ...p.overflow].map((a) => a.id).sort().join(',');
ok(all(panel) === Object.keys(photo).sort().join(',') && all(ph) === Object.keys(home).sort().join(','), 'the host layout holds every action once (nothing lost, nothing doubled)');
ok(panel.overflow.find((a) => a.id === 'delete').danger === true, 'Delete is flagged destructive in the overflow');
// a marker of a shared trip has the same actions: marker permissions are not decided here (trip deletion is, in poi.js)
ok(ids(Object.values(markerActions({ type: 'photo', name: 'x', tripId: 's1' }, h))) === ids(Object.values(photo)), 'a marker in a shared trip has the same action list');
// S7: Move exists only when the host passes a handler (the popup never gets it)
const mv = markerActions({ type: 'photo', name: 'x' }, { ...h, move() {} });
ok(!photo.move && !!mv.move && mv.move.label === 'Move location', 'Move is in the list only when a handler is given');
ok(ids(popupLayout(mv, false).tools) === 'eye,edit,visit,side,delete' && ids(popupLayout(mv, true).menu) === 'visit,side,delete', 'the popup layouts never show Move');
ok(ids(panelLayout(mv).secondary) === 'edit,move,visit' && ids(panelLayout(mv).overflow) === 'side,delete,eye', 'host: Edit, Move location, Add visit as buttons');
for (const type of ['residence', 'hotel', 'accommodation', 'photo']) ok(!!markerActions({ type, name: 'x' }, { ...h, move() {} }).move, `${type}: Move is available (all types)`);
ok(ids(panelLayout(markerActions({ type: 'residence', name: 'x' }, { ...h, move() {} })).secondary) === 'edit,move', 'host, Home marker: Edit and Move location');
process.exit(fails ? 1 : 0);
