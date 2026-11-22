// Review 01 S7: staged Move in the marker host (src/marker-move.js, applyStagedMove in poi-ui.js). Development switch only (?markerhost=1).
// Real mouse and keyboard events (Playwright). No real phone or foldable.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const item = (id, name, lat, lon, extra) => ({ id, type: 'photo', name, note: '', lat, lon, created: '2026-11-01T00:00:00.000Z', ...extra });
const items = [
  item('a', 'Tower', 30.5, 114.3, { tripId: 't1', date: '2026-11-12', day: 1, order: 1 }),
  item('b', 'Bridge', 30.503, 114.303, { tripId: 't1', date: '2026-11-12', day: 1, order: 2 }),
  item('h', 'Base', 30.497, 114.297, { type: 'residence' }),
  item('s', 'Shared stop', 30.5, 114.306, { tripId: 't2', date: '2026-11-12', day: 1, order: 1 }),
];
const trips = [
  { id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' },
  { id: 't2', name: 'Friends trip', color: '#2196f3', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14', shared: { owner: false, ownerName: 'Ann' } },
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ channel: CHANNEL });
const H = '#marker-host';

async function session({ width = 1200, height = 800, host = true, touch = false }) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  await ctx.clock.install({ time: new Date('2026-11-13T10:00:00+08:00') }); await ctx.clock.resume();
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route('**/api.open-meteo.com/**', (r) => r.abort());
  await ctx.addInitScript(([po, tr]) => {
    const orig = Storage.prototype.setItem; window.__w = [];
    Storage.prototype.setItem = function (k, v) { window.__w.push(k); return orig.call(this, k, v); };
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po })); localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.5, lon: 114.3, zoom: 15 }, basemap: 'osm' }));
  }, [items, trips]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/arcgisonline|Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/' + (host ? '?markerhost=1' : '?markerhost=0'), { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  if (await p.evaluate(() => !document.getElementById('panel').hidden)) await p.click('#panel-close');
  await p.waitForTimeout(300);
  return { ctx, p };
}
const shown = (p) => p.evaluate(() => { const e = document.getElementById('marker-host'); return !!e && !e.hidden; });
const pinPos = (p, name) => p.evaluate((n) => { const e = [...document.querySelectorAll('.poi-pin')].find((x) => x.getAttribute('title') === n); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, name);
const click = async (p, name) => { const q = await pinPos(p, name); await p.mouse.click(q.x, q.y); await p.waitForTimeout(1200); };
const stored = (p, id) => p.evaluate((i) => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.find((x) => x.id === i), id);
const bar = (p) => p.evaluate(() => { const e = document.querySelector('.mv-bar'); return e && !e.hidden ? { coords: e.querySelector('.mv-coords').textContent, text: e.querySelector('.mv-text').textContent, focused: document.activeElement === e } : null; });
const writes = (p) => p.evaluate(() => window.__w.filter((k) => k !== 'uavzones.v1.prefs'));
const toastState = (p) => p.evaluate(() => { const t = document.getElementById('toast'); return { shown: !t.hidden, text: t.textContent, undo: !!t.querySelector('.toast-action') }; });
const mapBox = (p) => p.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
const moveBtn = (p) => p.locator(`${H} .pop-move`);
const startMove = async (p) => { await p.evaluate(() => { window.__w = []; }); await moveBtn(p).click(); await p.waitForTimeout(700); };
const pan = async (p, dx, dy) => { const m = await mapBox(p); await p.mouse.move(m.cx - 100, m.cy - 100); await p.mouse.down(); await p.mouse.move(m.cx - 100 + dx / 2, m.cy - 100 + dy / 2, { steps: 4 }); await p.mouse.move(m.cx - 100 + dx, m.cy - 100 + dy, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(500); };
const paths = (p) => p.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].map((e) => e.getAttribute('d')).join('|'));
const num = (t) => t.split(',').map((x) => parseFloat(x));

// ---------------------------------------------------------------- 1. start, Cancel (button, Escape), nothing persisted
{
  const s = await session({});
  await click(s.p, 'Tower');
  ok((await s.p.locator(`${H} .pop-secondary .tool-label`).allInnerTexts()).join('|') === 'Edit|Move location|Add visit|More', 'the host offers Move location beside Edit and Add visit');
  const before = await stored(s.p, 'a');
  await startMove(s.p);
  const bs = await bar(s.p);
  ok(!(await shown(s.p)) && bs && bs.focused, 'Move hides the marker panel, shows the bar and focuses it');
  const geo = await s.p.evaluate(() => { const c = document.querySelector('.mv-cross').getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect(); return { dx: c.left + c.width / 2 - (m.left + m.width / 2), dy: c.top + c.height / 2 - (m.top + m.height / 2), w: c.width, vis: getComputedStyle(document.querySelector('.mv-cross')).display !== 'none', btn: [...document.querySelectorAll('.mv-bar .btn')].map((x) => x.textContent) }; });
  ok(Math.abs(geo.dx) < 1 && Math.abs(geo.dy) < 1 && geo.vis, 'the crosshair is visible at the map centre');
  ok(geo.btn.join('|') === 'Cancel|Save', 'the bar has Cancel and Save');
  ok(Math.abs(num(bs.coords)[0] - before.lat) < 0.0002 && Math.abs(num(bs.coords)[1] - before.lon) < 0.0002, `it starts centred on the marker (${bs.coords})`);
  ok(await s.p.evaluate(() => { const e = [...document.querySelectorAll('.poi-pin')][0]; return getComputedStyle(e).pointerEvents === 'none'; }), 'pins cannot be tapped while moving');
  await pan(s.p, 90, 60);
  const c2 = (await bar(s.p)).coords;
  ok(c2 !== bs.coords, `panning changes the live coordinates (${bs.coords} to ${c2})`);
  await s.p.locator('.mv-cancel').click(); await s.p.waitForTimeout(900);
  const after = await stored(s.p, 'a');
  ok(after.lat === before.lat && after.lon === before.lon, 'Cancel: the stored coordinates are unchanged');
  ok((await writes(s.p)).length === 0, `Cancel: nothing was written to storage, so no update, no invalidation (${(await writes(s.p)).join(',') || 'no writes'})`);
  ok(await shown(s.p) && (await s.p.evaluate(() => document.getElementById('mh-title')?.textContent)) === 'Tower' && !(await bar(s.p)), 'Cancel reopens the same marker and hides the bar');
  ok(await s.p.evaluate(() => document.activeElement?.classList.contains('pop-move')), 'focus returns to the Move button');
  // Escape and keyboard start
  await s.p.evaluate(() => { window.__w = []; });
  await s.p.keyboard.press('Enter'); await s.p.waitForTimeout(700);
  ok(!!(await bar(s.p)) && !(await shown(s.p)), 'Enter on the focused Move button starts a move');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(800);
  ok(!(await bar(s.p)) && await shown(s.p) && (await writes(s.p)).length === 0 && await s.p.evaluate(() => document.activeElement?.classList.contains('pop-move')), 'Escape cancels like the Cancel button, writes nothing and returns focus to Move');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 2. Save, Undo (local)
{
  const s = await session({});
  await click(s.p, 'Tower');
  const before = await stored(s.p, 'a'), routesBefore = await paths(s.p);
  await startMove(s.p);
  await pan(s.p, 120, -80);
  const staged = num((await bar(s.p)).coords);
  await s.p.locator('.mv-save').click(); await s.p.waitForTimeout(1200);
  const after = await stored(s.p, 'a');
  ok(Math.abs(after.lat - staged[0]) < 6e-6 && Math.abs(after.lon - staged[1]) < 6e-6 && (after.lat !== before.lat), `Save stores the staged coordinates (${after.lat.toFixed(5)}, ${after.lon.toFixed(5)})`);
  ok((await writes(s.p)).includes('uavzones.v1.pois'), 'Save goes through the store (a write of the markers happened)');
  const pin = await pinPos(s.p, 'Tower');
  const fa = await s.p.evaluate(() => { const m = document.getElementById('map').getBoundingClientRect(), h = document.getElementById('marker-host').getBoundingClientRect(); return (m.left + h.left) / 2; });
  ok(Math.abs(pin.x - fa) < 40, `the pin is at its new place, centred in the free area beside the reopened panel (x ${Math.round(pin.x)} of ${Math.round(fa)})`);
  ok(await shown(s.p) && (await s.p.evaluate(() => document.getElementById('mh-title')?.textContent)) === 'Tower' && await s.p.evaluate(() => document.activeElement?.classList.contains('pop-move')), 'Save reopens the same marker with focus on Move');
  ok(await s.p.evaluate((c) => document.querySelector('#marker-host .coords').textContent === c, `${after.lat.toFixed(5)}, ${after.lon.toFixed(5)}`), 'the reopened panel shows the new coordinates');
  const t = await toastState(s.p);
  ok(t.shown && /Marker moved/.test(t.text) && t.undo, 'a local marker gets "Marker moved." with an Undo action');
  const routesAfter = await paths(s.p);
  ok(routesBefore !== routesAfter, 'routes were redrawn from the new coordinates (the existing store-change path)');
  // Undo restores
  await s.p.locator('#toast .toast-action').click(); await s.p.waitForTimeout(900);
  const undone = await stored(s.p, 'a');
  ok(undone.lat === before.lat && undone.lon === before.lon, 'Undo restores the previous coordinates exactly');
  const pin2 = await pinPos(s.p, 'Tower');
  ok(Math.abs(pin2.x - pin.x) > 20 || Math.abs(pin2.y - pin.y) > 20, 'Undo moves the pin back as well');
  ok(/Move undone/.test((await toastState(s.p)).text), 'Undo says so');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 3. Undo is refused when stale
{
  const s = await session({});
  await click(s.p, 'Tower');
  await startMove(s.p); await pan(s.p, 70, 40);
  await s.p.locator('.mv-save').click(); await s.p.waitForTimeout(1000);
  const moved = await stored(s.p, 'a');
  await s.p.evaluate(() => { window.__old = document.querySelector('#toast .toast-action'); }); // the Undo offer, kept to press it later
  // the marker is changed again (Make Side Quest), then the old Undo is pressed
  await s.p.locator(`${H} .pop-more`).click();
  await s.p.locator(`${H} [role=menuitem]`, { hasText: 'Make Side Quest' }).click(); await s.p.waitForTimeout(900);
  const hasUndo = await s.p.evaluate(() => (window.__old ? 1 : 0));
  await s.p.evaluate(() => window.__old?.click()); await s.p.waitForTimeout(500);
  const now = await stored(s.p, 'a');
  ok(hasUndo === 1 && now.lat === moved.lat && now.lon === moved.lon && /changed since/.test((await toastState(s.p)).text), 'Undo after another change to the marker is refused and says why');
  await s.ctx.close();
}
{
  // a second move makes the first Undo unavailable; the timeout removes it
  const s = await session({});
  await click(s.p, 'Tower');
  await startMove(s.p); await pan(s.p, 70, 40);
  await s.p.locator('.mv-save').click(); await s.p.waitForTimeout(1000);
  const first = await stored(s.p, 'a');
  await s.p.evaluate(() => { window.__old = document.querySelector('#toast .toast-action'); });
  await startMove(s.p); await pan(s.p, -60, 30);
  await s.p.locator('.mv-save').click(); await s.p.waitForTimeout(1000);
  const second = await stored(s.p, 'a');
  await s.p.evaluate(() => window.__old?.click()); await s.p.waitForTimeout(500);
  const third = await stored(s.p, 'a');
  ok(second.lat !== first.lat && third.lat === second.lat && third.lon === second.lon, 'the first move\'s Undo cannot undo the second move');
  await s.p.clock.fastForward(9500); await s.p.waitForTimeout(300);
  ok(!(await toastState(s.p)).shown, 'the Undo offer expires with its message');
  await s.ctx.close();
}
{
  // expiry in state: after the timeout a retained button does nothing
  const s = await session({});
  await click(s.p, 'Bridge');
  const before = await stored(s.p, 'b');
  await startMove(s.p); await pan(s.p, 50, 50);
  await s.p.locator('.mv-save').click(); await s.p.waitForTimeout(900);
  await s.p.evaluate(() => { window.__old = document.querySelector('#toast .toast-action'); });
  await s.p.clock.fastForward(9500); await s.p.waitForTimeout(300);
  const moved = await stored(s.p, 'b');
  await s.p.evaluate(() => window.__old?.click()); await s.p.waitForTimeout(400);
  const kept = await stored(s.p, 'b');
  ok(moved.lat !== before.lat && kept.lat === moved.lat && /no longer available/.test((await toastState(s.p)).text), 'after the time limit Undo does nothing and says it is no longer available');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 4. shared trip and Home
{
  const s = await session({});
  await click(s.p, 'Shared stop');
  const before = await stored(s.p, 's');
  await startMove(s.p); await pan(s.p, 80, 50);
  await s.p.locator('.mv-save').click(); await s.p.waitForTimeout(1000);
  const after = await stored(s.p, 's');
  const t = await toastState(s.p);
  ok(after.lat !== before.lat && after.lon !== before.lon, 'a marker of a shared trip can be moved (existing permissions: any joined member)');
  ok(t.shown && /Marker moved/.test(t.text) && !t.undo, 'a shared-trip move shows a plain confirmation without Undo');
  ok(await shown(s.p) && (await s.p.evaluate(() => document.getElementById('mh-title')?.textContent)) === 'Shared stop', 'the same shared marker is reopened');
  await s.ctx.close();
}
{
  const s = await session({});
  await click(s.p, 'Base');
  const before = await stored(s.p, 'h');
  await startMove(s.p); await pan(s.p, 60, 60);
  await s.p.locator('.mv-save').click(); await s.p.waitForTimeout(1000);
  const after = await stored(s.p, 'h');
  ok(after.lat !== before.lat && (await toastState(s.p)).undo, 'the Home marker can be moved and, being on this device only, can be undone');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 5. phone: bar fits, targets are 44 px
{
  const s = await session({ width: 360, height: 740, touch: true });
  await click(s.p, 'Tower');
  await moveBtn(s.p).tap(); await s.p.waitForTimeout(700);
  const g = await s.p.evaluate(() => { const b = document.querySelector('.mv-bar').getBoundingClientRect(); return { l: b.left, r: b.right, w: innerWidth, hs: [...document.querySelectorAll('.mv-bar .btn')].map((x) => x.getBoundingClientRect().height) }; });
  ok(g.l >= 0 && g.r <= g.w && g.hs.every((h) => h >= 43.5), `phone: the bar fits the screen and its buttons are 44 px tall (${g.hs.map(Math.round)})`);
  await s.p.locator('.mv-cancel').tap(); await s.p.waitForTimeout(800);
  ok(await shown(s.p), 'phone: Cancel reopens the sheet');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 6. switch off: popup and drag unchanged
{
  const s = await session({ host: false });
  await click(s.p, 'Tower');
  const g = await s.p.evaluate(() => ({ popup: !!document.querySelector('.leaflet-popup .poi-pop'), labels: [...document.querySelectorAll('.leaflet-popup .tool-label')].map((x) => x.textContent), bar: !!document.querySelector('.mv-bar'), cross: !!document.querySelector('.mv-cross') }));
  ok(g.popup && !g.labels.includes('Move location') && !g.bar && !g.cross, 'switch off: the popup has no Move action and no move bar or crosshair exists');
  await s.ctx.close();
}

ok(errs.length === 0, 'no page errors ' + errs.join(' | ').slice(0, 300));
await b.close();
