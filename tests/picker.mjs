// Add a marker: folded on load, the four-group type picker (one choice across all 16), placement while folded or open,
// the Side Quest type switch, grouped edit form, keyboard use, and the small-screen layout. Starts with the card folded, as a visitor sees it.
import { OUT as SP, CHANNEL, chromium, pickType } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const GROUPS = { travel: 'hotel,food,attraction,shopping,nature,meeting', transport: 'train,airport,transport', drone: 'home,takeoff,landing,photo,hazard', special: 'residence,other' };

const mk = (id, name, n, extra = {}) => ({ id, type: 'photo', name, note: '', lat: 30.5 + n * 0.02, lon: 114.2 + n * 0.02, created: `2026-11-01T00:00:0${n}.000Z`, tripId: 't1', ...extra });
const items = [mk('A', 'Alpha', 2, { date: '2026-11-12', order: 1 }), mk('B', 'Bravo', 3, { date: '2026-11-13', order: 1 })];
const trips = { v: 1, trips: [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }] };

const b = await chromium.launch({ channel: CHANNEL });
async function session({ viewport = { width: 1200, height: 800 }, seed = true, touch = false, scheme = 'light' } = {}) {
  const ctx = await b.newContext({ viewport, addFolded: true, hasTouch: touch, isMobile: touch, colorScheme: scheme });
  if (seed) await ctx.addInitScript(([po, tr]) => { if (!sessionStorage.__seeded) { sessionStorage.__seeded = '1'; localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify(tr)); } }, [items, trips]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  await p.evaluate(() => { if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=poi]').click(); else document.getElementById('tab-poi').click(); });
  await p.waitForTimeout(300);
  return { ctx, p };
}
const goTo = async (p, text) => { await p.evaluate(() => { if (document.getElementById('search').classList.contains('collapsed')) document.getElementById('search-toggle').click(); }); await p.waitForTimeout(200); await p.fill('#q', text); await p.waitForTimeout(250); await p.keyboard.press('Enter'); };
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items);
const shown = (p) => p.$$eval('#poi-types .type-btn:not([hidden])', (bs) => bs.map((x) => x.dataset.type).join());
const chosen = (p) => p.$$eval('#poi-types .type-btn[aria-checked=true]', (bs) => bs.map((x) => x.dataset.type).join());

// ================= folded on load
let { ctx, p } = await session();
ok(await p.evaluate(() => !document.getElementById('poi-add').open), 'Add a marker is folded on a fresh load');
ok(await p.isVisible('#poi-add > summary') && /Add a marker/.test(await p.textContent('#poi-add > summary')) && /choose a type and place it/i.test(await p.textContent('#poi-add > summary')), 'its header says plainly how to add a place');
ok(!(await p.isVisible('#poi-place')) && !(await p.isVisible('#poi-types')), 'folded, the placement buttons and the picker are out of the way');
ok(await p.isVisible('#poi-list') && await p.isVisible('#poi-count'), 'and Saved places is visible below it');
const sumBox = await p.locator('#poi-add > summary').boundingBox();
ok(sumBox && sumBox.height >= 24 && sumBox.height < 70, 'the folded card is one compact row (' + Math.round(sumBox?.height) + ' px)');
await p.keyboard.press('Tab'); // keyboard: the summary can be reached and opened with Enter
await p.focus('#poi-add > summary'); await p.keyboard.press('Enter');
ok(await p.evaluate(() => document.getElementById('poi-add').open) && await p.isVisible('#poi-place') && await p.isVisible('#poi-center') && await p.isVisible('#poi-here'), 'Enter on the header opens it: Place on map, At map centre and At my location are there');
ok(await p.isVisible('#poi-trip-field') && await p.isVisible('#poi-edit'), 'and so are the trip for new markers and Edit mode');
await p.screenshot({ path: SP + '/picker-open.png' });

// ================= the picker
ok(await chosen(p) === 'hotel' && (await p.textContent('#poi-type-now')).includes('Accommodation'), 'it opens on Accommodation, and says so');
ok(await shown(p) === GROUPS.travel, 'Travel & Places shows its six types: ' + await shown(p));
ok((await p.locator('#poi-types .type-btn').count()) === 16, 'all 16 buttons exist; only the open group is shown');
for (const [g, list] of Object.entries(GROUPS)) {
  await p.click('#type-tab-' + g);
  ok(await shown(p) === list && await p.getAttribute('#type-tab-' + g, 'aria-pressed') === 'true' && (await p.$$eval('#poi-type-tabs [aria-pressed=true]', (x) => x.length)) === 1, 'the ' + g + ' group shows ' + list);
}
ok(await chosen(p) === 'hotel', 'switching groups does not change the chosen type');
ok(await p.getAttribute('#type-tab-travel', 'data-has-selected') === 'true' && await p.getAttribute('#type-tab-drone', 'data-has-selected') === 'false', 'the group that holds the chosen type is marked');
await pickType(p, 'food');
ok(await chosen(p) === 'food' && (await p.textContent('#poi-type-now')).includes('Food & Drink') && (await p.$$eval('#poi-types [aria-checked=true]', (x) => x.length)) === 1, 'choosing Food & Drink leaves exactly one chosen');
await p.click('#type-tab-drone');
ok(await chosen(p) === 'food' && !(await p.isVisible('#poi-types [data-type=food]')) && (await p.textContent('#poi-type-now')).includes('Food & Drink'), 'with another group open the choice is kept and still named');
const labels = await p.$$eval('#poi-types .type-btn', (bs) => Object.fromEntries(bs.map((x) => [x.dataset.type, x.textContent.trim()])));
ok(labels.hotel === 'Accommodation' && labels.transport === 'Other Transport' && labels.meeting === 'Meeting Point' && labels.nature === 'Nature & Outdoors' && labels.residence === 'Home' && labels.home === 'Home point', 'labels follow the agreed names');
ok((await p.$$eval('#poi-types .type-btn', (bs) => bs.every((x) => x.title.length > 5 && x.querySelector('svg')))), 'every button has an icon and a tooltip');
ok(await p.getAttribute('#poi-types', 'role') === 'radiogroup' && await p.getAttribute('#poi-type-tabs', 'aria-label') === 'Marker type groups', 'the picker is a radio group; the group buttons have a name');

// ================= placement from the picker
await pickType(p, 'attraction');
await p.click('#poi-center'); await p.waitForSelector('.poi-pop form');
let all = await stored(p);
const made = all.find((x) => !items.some((o) => o.id === x.id));
ok(made && made.type === 'attraction' && !('group' in made), 'At map centre saves the chosen type, and no group');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(300);
await pickType(p, 'transport'); await p.click('#poi-place');
ok(/Tap the map to place: Other Transport/.test(await p.textContent('#banner-text')) && await p.isVisible('#banner-action'), 'Place on map names the type in the banner and offers Cancel');
await pickType(p, 'meeting');
ok(/Meeting Point/.test(await p.textContent('#banner-text')), 'changing the type while placing updates the banner');
await p.click('#poi-add > summary'); // folding the card during a placement must not hide the way out
ok(await p.isVisible('#banner-action'), 'the banner button that ends placing stays reachable even if the card is folded');
await p.click('#banner-action'); await p.waitForTimeout(200);
ok(!(await p.isVisible('#banner')), 'Cancel ends placing');
await p.keyboard.press('Escape');

// ================= edit mode opens the card
await p.evaluate(() => { document.getElementById('poi-add').open = false; });
await p.evaluate(() => { const e = document.getElementById('poi-edit'); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
await p.waitForTimeout(150);
ok(await p.evaluate(() => document.getElementById('poi-add').open) && /Edit mode/.test(await p.textContent('#banner-text')), 'edit mode opens a folded card so the switch that ends it is visible');
await p.click('#banner-action'); await p.waitForTimeout(150);

// ================= a Side Quest cannot keep Accommodation: the picker switches visibly, and stays there
await pickType(p, 'hotel');
await goTo(p, '30.5700, 114.3100');
await p.waitForSelector('.leaflet-popup .pop-tools button[title="Add as Side Quest"]', { timeout: 8000 });
await p.click('.leaflet-popup .pop-tools button[title="Add as Side Quest"]'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
all = await stored(p);
const sq = all.find((x) => x.isSub && !items.some((o) => o.id === x.id));
ok(sq && sq.type === 'other', 'a Side Quest made while Accommodation was chosen is saved as Other');
ok(await chosen(p) === 'other' && (await p.textContent('#poi-type-now')).includes('Other') && /Side Quests can't be/.test(await p.textContent('#toast')), 'the picker now shows Other, and a message says why');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(300);
await goTo(p, '30.5800, 114.3200');
await p.waitForSelector('.leaflet-popup .pop-tools button[title="Add as Side Quest"]', { timeout: 8000 });
await p.evaluate(() => { document.getElementById('toast').hidden = true; });
await p.click('.leaflet-popup .pop-tools button[title="Add as Side Quest"]'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
ok(await chosen(p) === 'other' && await p.isHidden('#toast'), 'it stays Other (no second message) until the person changes it');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(300);
// the six new types are allowed Side Quests
await pickType(p, 'food');
await goTo(p, '30.5900, 114.3300');
await p.waitForSelector('.leaflet-popup .pop-tools button[title="Add as Side Quest"]', { timeout: 8000 });
await p.click('.leaflet-popup .pop-tools button[title="Add as Side Quest"]'); await p.waitForSelector('.poi-pop form', { timeout: 8000 });
all = await stored(p);
const foodSq = all.filter((x) => x.isSub && x.type === 'food');
ok(foodSq.length === 1 && await chosen(p) === 'food', 'a Food & Drink Side Quest keeps its type and the picker stays on it');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(300);

// ================= the edit form: grouped types, and the Side Quest note
await p.click('#poi-list .poi-item:has-text("Alpha")'); await p.waitForSelector('.leaflet-popup h3');
await p.click('.leaflet-popup button[title="Edit"]').catch(() => {}); await p.waitForSelector('.poi-pop form', { timeout: 6000 });
const optgroups = await p.evaluate(() => [...[...document.querySelectorAll('.poi-pop form')].at(-1).querySelectorAll('select optgroup')].map((x) => x.label + ':' + [...x.querySelectorAll('option')].map((o) => o.value).join('+')));
ok(optgroups.join('|') === 'Travel & Places:hotel+food+attraction+shopping+nature+meeting|Transportation:train+airport+transport|Drone & Safety:home+takeoff+landing+photo+hazard|Special:residence+other', 'the edit form lists the 16 types under the four groups: ' + optgroups.join(' | '));
ok(await p.evaluate(() => [...document.querySelectorAll('.poi-pop form')].at(-1).querySelector('select:has(optgroup)').value) === 'photo', 'and shows the stored type selected');
await p.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click()); await p.waitForTimeout(300);

// ================= reload: folded again, markers kept
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(900);
await p.evaluate(() => document.getElementById('tab-poi').click());
ok(await p.evaluate(() => !document.getElementById('poi-add').open) && (await stored(p)).length >= 4, 'after a reload the card is folded again and the markers are kept');
ok(await chosen(p) === 'hotel', 'the chosen type is page state only: after a reload it is Accommodation again');
const stor = await p.evaluate(() => localStorage.getItem('uavzones.v1.prefs') ?? '');
ok(!/hotel|attraction|food|group/.test(stor), 'nothing about the picker is stored');
await p.close(); await ctx.close();

// ================= small screens, touch, dark
for (const [name, vp, scheme] of [['phone', { width: 390, height: 844 }, 'light'], ['phone-landscape', { width: 844, height: 390 }, 'dark'], ['tablet', { width: 768, height: 1024 }, 'dark']]) {
  ({ ctx, p } = await session({ viewport: vp, touch: true, scheme }));
  ok(await p.evaluate(() => !document.getElementById('poi-add').open) && await p.isVisible('#poi-add > summary'), name + ': folded on load, header visible');
  const bx = await p.locator('#poi-add > summary').boundingBox();
  ok(bx && bx.height >= 36, name + ': the header is a touch-sized target (' + Math.round(bx?.height) + ' px)');
  await p.tap('#poi-add > summary'); await p.waitForTimeout(200);
  ok(await p.isVisible('#poi-place'), name + ': a tap opens it');
  await p.tap('#type-tab-transport'); await p.tap('#poi-types [data-type=transport]');
  ok(await chosen(p) === 'transport', name + ': touch chooses a type in another group');
  const over = await p.evaluate(() => { const r = document.getElementById('poi-types').getBoundingClientRect(), pn = document.getElementById('panel').getBoundingClientRect(); return { r: Math.round(r.right), pr: Math.round(pn.right), sw: document.documentElement.scrollWidth, iw: innerWidth }; });
  ok(over.r <= over.pr + 1 && over.sw <= over.iw + 1, name + ': nothing overflows sideways');
  const hit = await p.evaluate(() => { const c = document.querySelector('#poi-types [data-type=transport]').getBoundingClientRect(); const e = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2); return e?.closest('.type-btn')?.dataset.type; });
  ok(hit === 'transport', name + ': the button is what a tap on it lands on');
  await p.screenshot({ path: SP + '/picker-' + name + '.png' });
  await p.close(); await ctx.close();
}

ok(errs.length === 0, 'no page errors: ' + errs.join(' | ').slice(0, 300));
await b.close();
