// UX discoverability, the parts that need no browser: the hint registry, the seen-state store (storage blocked, corrupt, newer version), and the map tool labels.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const { HELP, helpById } = await load('src/help-content.js');
const S = await load('src/help-state.js');
const { toolLabel, TOOLS } = await load('src/map-tool-labels.js');

// ---------- registry
ok(HELP.length >= 7, 'the registry lists the seven planned hints');
ok(new Set(HELP.map((h) => h.id)).size === HELP.length, 'ids are unique');
ok(HELP.every((h) => /^[a-z0-9-]{1,40}$/.test(h.id)), 'ids are storable (lower case, digits, dashes)');
ok(HELP.every((h) => typeof h.text === 'string' && h.text.length >= 20 && h.text.length <= 220), 'each text is a short sentence or two');
ok(HELP.every((h) => ['map', 'panel', 'hub'].includes(h.where)), 'every hint has a known place');
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

// ---------- labels
ok(TOOLS.every((t) => typeof toolLabel(t, {}) === 'string'), 'every tool has a label');
ok(toolLabel('nope') === null, 'an unknown tool has none');
ok(!TOOLS.includes('zoom-in') && toolLabel('zoom-in') === null, 'zoom buttons are not labelled');
ok(toolLabel('locate', { text: 'Show my location' }) === 'My location', 'locate: off');
ok(toolLabel('locate', { text: 'Follow me' }) === 'Follow me' && toolLabel('locate', { text: 'Follow me and turn the map with the way the phone points' }) === 'Follow me', 'locate: located');
ok(toolLabel('locate', { text: 'Stop following and turn the map back to north' }) === 'Stop following', 'locate: following');
ok(toolLabel('crosshair', { pressed: true }) === 'Hide crosshair' && toolLabel('crosshair', { pressed: false }) === 'Show crosshair', 'crosshair follows its state');
ok(toolLabel('details', { pressed: true }) === 'Hide marker details' && toolLabel('details', { pressed: false }) === 'Show marker details', 'marker details follows its state');
ok(toolLabel('side-quests', { pressed: true }) === 'Hide Side Quests' && toolLabel('side-quests', { pressed: false }) === 'Show all Side Quests', 'Side Quests follows its state');
ok(toolLabel('trips', { pressed: true }) === 'Hide trip markers' && toolLabel('trips', { pressed: false }) === 'Show trip markers', 'trip markers follows its state');
ok(toolLabel('compass') === 'Reset to north' && toolLabel('sessions') === 'Browse flight sessions', 'compass and sessions');
ok(toolLabel('labels', { pressed: true }) === 'Hide labels' && toolLabel('labels', { pressed: false }) === 'Show map tool labels', 'the toggle names its own action');
