// UX discoverability, the parts that need no browser: the hint registry, the seen-state store (storage blocked, corrupt, newer version), and the map tool labels.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const { HELP, helpById } = await load('src/help-content.js');
const S = await load('src/help-state.js');
const { toolRow, FOLDED, DIRECT, TOOLS } = await load('src/map-tool-labels.js');

// ---------- registry
ok(HELP.length >= 7, 'the registry lists the seven planned hints');
ok(new Set(HELP.map((h) => h.id)).size === HELP.length, 'ids are unique');
ok(HELP.every((h) => /^[a-z0-9-]{1,40}$/.test(h.id)), 'ids are storable (lower case, digits, dashes)');
ok(HELP.every((h) => typeof h.text === 'string' && h.text.length >= 20 && h.text.length <= 220), 'each text is a short sentence or two');
ok(HELP.every((h) => ['map', 'panel', 'hub', 'poi'].includes(h.where)), 'every hint has a known place');
ok(HELP.filter((h) => h.where === 'poi').every((h) => ['type', 'list', 'top'].includes(h.anchor)), 'pane hints name a known anchor');
ok(['poi', 'poi-types', 'trip-visibility', 'newtype-shared'].every((id) => helpById(id)) && helpById('poi').where === 'panel' && helpById('poi').tab === 'poi', 'the existing poi hint keeps its id (so seen state is kept) and the three new ones are distinct entries');
ok(/search/i.test(helpById('poi').text) && /Add a marker/.test(helpById('poi').text), 'the poi text now explains the explorer: Add a marker and search');
ok(HELP.filter((h) => h.ack).map((h) => h.id).join() === 'newtype-shared', 'only the old-version notice has to be dismissed');
ok(['poi-types', 'trip-visibility', 'newtype-shared'].every((id) => helpById(id).replay.length <= 30), 'the new replay labels are short');
ok(!HELP.some((h) => /launch|permission to fly|safe to fly/i.test(h.text)), 'no hint implies a launch recommendation or permission');
ok(HELP.filter((h) => h.where === 'panel').every((h) => ['config', 'trips', 'poi', 'friends'].includes(h.tab)), 'panel hints name a real tab');
ok(HELP.every((h) => h.replay && h.replay.length <= 30), 'each has a short replay label');
ok(helpById('trips')?.tab === 'trips' && helpById('nope') === null, 'helpById finds an entry or returns null');
ok(HELP.every((h) => !/https?:|@|\d{2}\.\d{3}/.test(h.text)), 'no address, link or coordinate in a hint');

// ---------- state
const fake = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
let st = fake(); let h = S.createHelpState(st);
ok(!h.has('poi'), 'nothing is seen at first');
h.mark('poi'); h.mark('poi');
ok(h.has('poi') && h.list().length === 1, 'mark is idempotent');
ok(JSON.stringify(JSON.parse(st.m.get(S.KEY))) === JSON.stringify({ v: 1, seen: ['poi'] }), 'only a version and the ids are stored');
ok(S.createHelpState(st).has('poi'), 'a new page load still has it seen');
ok(S.KEY === 'uavzones.v1.help', 'own key, outside the preferences');

const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
h = S.createHelpState(blocked); h.mark('trips');
ok(h.has('trips'), 'blocked storage: memory fallback works and nothing throws');
ok(S.createHelpState(null).has('x') === false, 'no storage object at all is fine');
for (const bad of ['{not json', '"text"', '42', 'null', '{"seen":"poi"}', '{"seen":[1,{},null,"BAD ID","ok-id"]}']) {
  st = fake(); st.setItem(S.KEY, bad);
  const g = S.createHelpState(st);
  ok(g.list().every((i) => /^[a-z0-9-]+$/.test(i)) && (bad.includes('ok-id') ? g.has('ok-id') && g.list().length === 1 : g.list().length === 0), 'corrupt value is sanitised: ' + bad.slice(0, 24));
}
st = fake(); st.setItem(S.KEY, JSON.stringify({ v: 9, seen: ['poi', 'future-feature'] }));
h = S.createHelpState(st);
ok(h.has('poi') && h.has('future-feature'), 'a newer version is still read, so nothing is replayed');
st = fake(); st.setItem(S.KEY, JSON.stringify({ v: 1, seen: Array.from({ length: 200 }, (_, i) => 'id-' + i) }));
ok(S.createHelpState(st).list().length === 64, 'the list is capped');
h = S.createHelpState(fake()); h.mark('BAD ID'); h.mark('x'.repeat(50));
ok(h.list().length === 0, 'malformed ids are not stored');

// ---------- More tools rows
ok(FOLDED.every((x) => { const r = toolRow(x, { pressed: true }); return r && typeof r.name === 'string' && r.name.length > 0; }), 'every folded tool has a row');
ok(toolRow('nope') === null && toolRow('locate') === null && toolRow('compass') === null, 'unknown tools and the direct buttons (locate, compass) have no row');
ok(!FOLDED.includes('zoom-in') && DIRECT.join() === 'locate,compass' && TOOLS.includes('more'), 'zoom buttons are not rows; locate and compass stay direct');
ok(FOLDED.join() === 'details,side-quests,trips,crosshair,sessions', 'the rows come in a fixed order');
ok(toolRow('crosshair', { pressed: true }).state === 'On' && toolRow('crosshair', { pressed: false }).state === 'Off', 'crosshair row follows its state');
ok(toolRow('details', { pressed: true }).name === 'Marker details' && toolRow('details', { pressed: false }).state === 'Off', 'marker details row follows its state');
ok(toolRow('side-quests', { pressed: true }).state === 'All shown' && toolRow('side-quests', { pressed: false }).state === 'Open stop only', 'Side Quests row says what the switch does');
ok(toolRow('trips', { pressed: true }).state === 'Shown' && toolRow('trips', { pressed: false }).state === 'Hidden', 'trip markers row follows its state');
ok(toolRow('sessions').name === 'Flight Sessions' && toolRow('sessions').state === null, 'Flight Sessions is an action with no state');
