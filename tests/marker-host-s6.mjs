// Review 01 S6: the marker host's action model and overflow menu (src/marker-actions.js). Development switch only (?markerhost=1).
// Emulated: Playwright viewports and touch. No real phone, foldable, keyboard or screen reader.
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

async function session({ width, height = 800, host = true, touch = false }) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  await ctx.clock.install({ time: new Date('2026-11-13T10:00:00+08:00') }); await ctx.clock.resume();
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route('**/api.open-meteo.com/**', (r) => r.abort());
  await ctx.addInitScript(([po, tr]) => {
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
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items);
const view = (p) => p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}').view));
const labels = (p, sel) => p.evaluate((q) => [...document.querySelectorAll(q)].map((e) => (e.querySelector('.tool-label, .map-action-label') || e).textContent.trim()), sel);
const active = (p) => p.evaluate(() => { const a = document.activeElement; return a ? (a.querySelector?.('.tool-label')?.textContent || a.tagName).trim() : null; });
const menuOpen = (p) => p.evaluate(() => { const m = document.querySelector('#marker-host .pop-overflow'); return !!m && !m.hidden; });
const title = (p) => p.evaluate(() => document.getElementById('mh-title')?.textContent);

// ---------------------------------------------------------------- 1. layout at four sizes
for (const [label, w, h, touch] of [['folded phone 360', 360, 740, true], ['narrow phone 320', 320, 640, true], ['unfolded 760', 760, 800, true], ['desktop 1440', 1440, 900, false]]) {
  const s = await session({ width: w, height: h, touch });
  await click(s.p, 'Tower');
  const g = await s.p.evaluate(() => {
    const host = document.getElementById('marker-host'), hb = host.getBoundingClientRect(), body = host.querySelector('.mh-body');
    const acts = host.querySelector('.pop-actions'), ab = acts.getBoundingClientRect(), nav = host.querySelector('.pop-primary .map-action').getBoundingClientRect();
    const btns = [...acts.querySelectorAll('button, a')].filter((x) => x.offsetParent);
    const text = (x) => x.querySelector('.tool-label, .map-action-label') || x;
    return {
      mode: host.dataset.mode, hostW: hb.width, navW: nav.width, actsW: ab.width,
      overflowX: body.scrollWidth > body.clientWidth + 1,
      inside: btns.every((x) => { const r = x.getBoundingClientRect(); return r.left >= hb.left - 0.5 && r.right <= hb.right + 0.5; }),
      minH: Math.min(...btns.map((x) => x.getBoundingClientRect().height)),
      minFont: Math.min(...btns.map((x) => parseFloat(getComputedStyle(text(x)).fontSize))),
      clipped: btns.some((x) => { const t = text(x); return t.scrollWidth > t.clientWidth + 1; }),
      navCount: host.querySelectorAll('.map-action').length,
      nameCount: (host.innerText.match(/Tower/g) || []).length,
      barTools: host.querySelectorAll('.pop-bar .btn.tool').length,
      acts: [...acts.querySelectorAll('.pop-primary .map-action-label, .pop-secondary .tool-label')].map((x) => x.textContent.trim()),
      secondaryRows: new Set([...acts.querySelectorAll('.pop-secondary > *')].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().top))).size,
    };
  });
  ok(g.acts.join('|') === 'Navigate|Edit|Move location|Add visit|More', `${label}: Navigate, Edit, Move location, Add visit and More in that order (${g.acts.join('|')})`);
  ok(g.navCount === 1 && g.barTools === 0, `${label}: Navigate appears once and the top bar carries no action icons`);
  ok(g.nameCount === 1, `${label}: the marker name appears once in the panel (${g.nameCount})`);
  ok(g.navW >= g.actsW - 1 && g.navW > g.hostW * 0.7, `${label}: Navigate is the full width of the action area (${Math.round(g.navW)} of ${Math.round(g.actsW)}, panel ${Math.round(g.hostW)})`);
  ok(!g.overflowX && g.inside && !g.clipped, `${label}: no horizontal overflow, every action inside the panel, no label clipped`);
  ok(g.minFont >= 12, `${label}: action text stays readable (${g.minFont}px)`);
  ok(g.secondaryRows <= 2, `${label}: the four secondary buttons use at most two rows (${g.secondaryRows})`);
  if (touch) ok(g.minH >= 43.5, `${label}: touch targets are at least 44 px (${Math.round(g.minH)})`);
  if (label.includes('desktop')) ok(g.mode === 'side' && g.hostW <= 480, `${label}: capped side panel (${Math.round(g.hostW)} px)`);
  if (w === 760) ok(g.mode === 'side' && g.hostW >= 340 && g.hostW <= 480, `unfolded: the actions sit in the 340 to 480 px side panel (${Math.round(g.hostW)})`);
  if (w <= 360) ok(g.mode === 'bottom' && Math.abs(g.hostW - w) <= 1, `${label}: the actions sit in the full-width bottom sheet`);
  await s.ctx.close();
}

// ---------------------------------------------------------------- 2. overflow menu: open, keys, Escape, focus, map untouched
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Tower');
  ok(!(await menuOpen(s.p)), 'the menu starts closed');
  const v0 = await view(s.p);
  await s.p.locator(`${H} .pop-more`).click(); await s.p.waitForTimeout(300);
  ok(await menuOpen(s.p) && await s.p.getAttribute(`${H} .pop-more`, 'aria-expanded') === 'true', 'More opens the menu (aria-expanded true)');
  ok((await labels(s.p, `${H} .pop-overflow [role=menuitem]`)).join('|').startsWith('Make Side Quest|Delete|Open details when I click a marker'), 'the menu holds Make Side Quest, Delete and the details switch');
  ok(await s.p.evaluate(() => document.querySelector('#marker-host .pop-overflow').getAttribute('role') === 'menu' && document.querySelector('#marker-host .pop-more').getAttribute('aria-controls') === document.querySelector('#marker-host .pop-overflow').id), 'role=menu, and the button controls it');
  ok((await active(s.p)) === 'Make Side Quest', 'focus is on the first item');
  await s.p.keyboard.press('ArrowDown'); ok((await active(s.p)) === 'Delete', 'ArrowDown moves to the next item');
  await s.p.keyboard.press('End'); ok((await active(s.p)).startsWith('Open details'), 'End goes to the last item');
  await s.p.keyboard.press('ArrowDown'); ok((await active(s.p)) === 'Make Side Quest', 'ArrowDown wraps to the first');
  await s.p.keyboard.press('ArrowUp'); ok((await active(s.p)).startsWith('Open details'), 'ArrowUp wraps to the last');
  await s.p.keyboard.press('Home'); ok((await active(s.p)) === 'Make Side Quest', 'Home goes to the first');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(200);
  ok(!(await menuOpen(s.p)) && await shown(s.p), 'Escape closes the menu and leaves the marker panel open');
  ok(await s.p.evaluate(() => document.activeElement?.classList.contains('pop-more')), 'focus returns to the More button');
  ok(await view(s.p) === v0 && (await title(s.p)) === 'Tower', 'opening and closing the menu neither moved the map nor changed the selected marker');
  await s.p.keyboard.press('ArrowDown'); await s.p.waitForTimeout(150);
  ok(await menuOpen(s.p) && (await active(s.p)) === 'Make Side Quest', 'ArrowDown on the button opens the menu');
  await s.p.keyboard.press('Escape'); await s.p.keyboard.press('ArrowUp'); await s.p.waitForTimeout(150);
  ok(await menuOpen(s.p) && (await active(s.p)).startsWith('Open details'), 'ArrowUp on the button opens it at the last item');
  await s.p.keyboard.press('Tab'); await s.p.waitForTimeout(200);
  ok(!(await menuOpen(s.p)), 'Tab leaves and closes the menu');
  await s.p.locator(`${H} .pop-more`).click(); await s.p.waitForTimeout(150);
  await s.p.locator(`${H} h3`).click(); await s.p.waitForTimeout(200);
  ok(!(await menuOpen(s.p)) && await shown(s.p), 'a press elsewhere in the panel closes the menu without closing the panel');
  await s.p.locator(`${H} .pop-more`).click(); await s.p.waitForTimeout(150);
  await s.p.locator(`${H} .pop-more`).click(); await s.p.waitForTimeout(150);
  ok(!(await menuOpen(s.p)), 'the More button toggles it');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(300);
  ok(!(await shown(s.p)), 'with the menu closed, Escape closes the marker panel as before');
  await s.ctx.close();
}
{
  const s = await session({ width: 360, height: 740, touch: true });
  await click(s.p, 'Tower');
  const v0 = await view(s.p), h0 = await s.p.evaluate(() => document.getElementById('marker-host').getBoundingClientRect().height);
  await s.p.locator(`${H} .pop-more`).tap(); await s.p.waitForTimeout(300);
  ok(await menuOpen(s.p) && await shown(s.p) && await view(s.p) === v0, 'touch: tapping More opens the menu; the panel stays and the map does not move');
  const r = await s.p.evaluate(() => { const m = document.querySelector('#marker-host .pop-overflow').getBoundingClientRect(), h = document.getElementById('marker-host').getBoundingClientRect(); return { inside: m.left >= h.left && m.right <= h.right, hs: [...document.querySelectorAll('#marker-host .pop-overflow button')].map((x) => x.getBoundingClientRect().height) }; });
  ok(r.inside && r.hs.every((x) => x >= 43.5), `touch: menu items fit the sheet width and are 44 px tall (${r.hs.map(Math.round)})`);
  ok(Math.abs(await s.p.evaluate(() => document.getElementById('marker-host').getBoundingClientRect().height) - h0) < 2, 'the sheet keeps its height while the menu is open (the body scrolls)');
  await s.p.locator(`${H} h3`).tap(); await s.p.waitForTimeout(200);
  ok(!(await menuOpen(s.p)) && await shown(s.p), 'touch: tapping outside the menu closes it, not the sheet');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 3. choosing items
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Tower');
  await s.p.locator(`${H} .pop-more`).click();
  await s.p.locator(`${H} [role=menuitem]`, { hasText: 'Make Side Quest' }).click(); await s.p.waitForTimeout(900);
  ok((await stored(s.p)).find((i) => i.id === 'a').isSub === true, 'Make Side Quest converts the marker');
  ok(await shown(s.p) && (await title(s.p)) === 'Tower' && !(await menuOpen(s.p)), 'the same marker stays selected, with the menu closed');
  await s.p.locator(`${H} .pop-more`).click();
  ok((await labels(s.p, `${H} [role=menuitem]`))[0] === 'Make main stop', 'a Side Quest then offers Make main stop');
  await s.p.keyboard.press('Escape');
  await s.p.locator(`${H} .pop-secondary .tool-label`, { hasText: 'Edit' }).click(); await s.p.waitForTimeout(500);
  ok(await s.p.locator(`${H} input, ${H} select`).count() > 0 && await shown(s.p), 'Edit opens the form inside the panel');
  await s.ctx.close();
}
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Bridge');
  const n0 = (await stored(s.p)).length;
  await s.p.locator(`${H} .pop-secondary .tool-label`, { hasText: 'Add visit' }).click(); await s.p.waitForTimeout(900);
  ok((await stored(s.p)).length === n0 + 1 && await shown(s.p) && await s.p.locator(`${H} input`).count() > 0, 'Add visit saves the place again and opens its form');
  await s.ctx.close();
}
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Tower');
  const was = await s.p.evaluate(() => document.querySelector('#marker-host .pop-eye') && !document.querySelector('#marker-host .pop-eye').classList.contains('off'));
  await s.p.locator(`${H} .pop-more`).click();
  await s.p.locator(`${H} [role=menuitem].pop-eye`).click(); await s.p.waitForTimeout(800);
  const now = await s.p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('uavzones.v1.prefs') || '{}')));
  ok(was === true && /"markerDetails":false/.test(now), `the details switch in the menu turns marker details off, as the map button does (${now.slice(0, 120)})`);
  await s.ctx.close();
}

// ---------------------------------------------------------------- 4. Delete keeps its confirmation
for (const touch of [false, true]) {
  const s = await session({ width: touch ? 360 : 1440, height: touch ? 740 : 900, touch });
  const act = (loc) => (touch ? loc.tap() : loc.click());
  await click(s.p, 'Bridge');
  await act(s.p.locator(`${H} .pop-more`)); await s.p.waitForTimeout(150);
  const del = s.p.locator(`${H} [role=menuitem].danger`);
  await act(del); await s.p.waitForTimeout(250);
  ok(await shown(s.p) && await menuOpen(s.p) && (await stored(s.p)).some((i) => i.id === 'b') && /Confirm delete/i.test(await del.innerText()), `${touch ? 'touch' : 'mouse'}: the first press only arms Delete (Confirm delete); nothing is removed, the menu and panel stay`);
  await act(del); await s.p.waitForTimeout(900);
  ok(!(await shown(s.p)) && !(await stored(s.p)).some((i) => i.id === 'b'), `${touch ? 'touch' : 'mouse'}: the second press deletes it and closes the panel`);
  await s.ctx.close();
}
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Bridge');
  await s.p.locator(`${H} .pop-more`).click(); await s.p.locator(`${H} [role=menuitem].danger`).click(); await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(300);
  ok(await shown(s.p) && (await stored(s.p)).some((i) => i.id === 'b'), 'Escape after arming Delete closes the menu; the marker stays');
  await s.ctx.close();
}
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Bridge');
  await s.p.locator(`${H} .pop-more`).focus(); await s.p.keyboard.press('Enter'); await s.p.keyboard.press('ArrowDown'); await s.p.keyboard.press('Enter'); await s.p.waitForTimeout(200);
  ok((await stored(s.p)).some((i) => i.id === 'b') && await shown(s.p), 'keyboard: Enter on Delete arms it first');
  await s.p.keyboard.press('Enter'); await s.p.waitForTimeout(900);
  ok(!(await stored(s.p)).some((i) => i.id === 'b'), 'keyboard: a second Enter deletes');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 5. marker types and trips
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Base');
  const g = await s.p.evaluate(() => ({
    nav: document.querySelector('#marker-host .pop-primary .map-action')?.tagName,
    sec: [...document.querySelectorAll('#marker-host .pop-secondary .tool-label')].map((x) => x.textContent.trim()),
    ov: [...document.querySelectorAll('#marker-host .pop-overflow [role=menuitem] .tool-label')].map((x) => x.textContent.trim().slice(0, 11)),
  }));
  ok(g.nav === 'BUTTON', 'Home marker: Navigate is the asking button, not a link');
  await s.p.locator(`${H} .pop-primary .map-action`).click(); await s.p.waitForTimeout(150);
  ok((await s.p.locator(`${H} .pop-primary .map-action`).innerText()).includes('Tap again to share'), 'Home marker: the first tap still reads Tap again to share');
  ok(g.sec.join('|') === 'Edit|Move location|More' && g.ov.join('|') === 'Delete|Open detail', `Home marker: Edit and More; the menu has Delete and the details switch only (${g.sec}; ${g.ov})`);
  await s.ctx.close();
}
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Shared stop');
  const sec = await labels(s.p, `${H} .pop-secondary .tool-label`);
  await s.p.locator(`${H} .pop-more`).click();
  const ov = await labels(s.p, `${H} [role=menuitem]`);
  ok(sec.join('|') === 'Edit|Move location|Add visit|More' && ov.slice(0, 2).join('|') === 'Make Side Quest|Delete', `marker of a shared trip: same actions as an owned marker (${sec}; ${ov.slice(0, 2)})`);
  ok(await s.p.evaluate(() => /Friends trip/.test(document.getElementById('marker-host').innerText)), 'the shared trip name is shown once as before');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 6. keyboard reaches the actions in order
{
  const s = await session({ width: 1440, height: 900 });
  await click(s.p, 'Tower');
  const seen = [];
  for (let i = 0; i < 16 && seen.length < 5; i++) {
    await s.p.keyboard.press('Tab');
    const a = await s.p.evaluate(() => { const e = document.activeElement; return e && e.closest('#marker-host .pop-actions') ? (e.querySelector('.tool-label, .map-action-label')?.textContent || '').trim() : null; });
    if (a && seen[seen.length - 1] !== a) seen.push(a);
  }
  ok(seen.join('|') === 'Navigate|Edit|Move location|Add visit|More', `Tab reaches Navigate, Edit, Move location, Add visit, More in order (${seen.join('|')})`);
  await s.ctx.close();
}

// ---------------------------------------------------------------- 7. switch off: the popup keeps its layout
for (const [w, touch] of [[1200, false], [360, true]]) {
  const s = await session({ width: w, height: 800, host: false, touch });
  await click(s.p, 'Tower');
  const g = await s.p.evaluate(() => ({
    popup: !!document.querySelector('.leaflet-popup .pop.poi-pop'), host: !!document.getElementById('marker-host') && !document.getElementById('marker-host').hidden,
    panel: !!document.querySelector('.leaflet-popup .pop-actions'),
    tools: [...document.querySelectorAll('.leaflet-popup .pop-tools > .btn.tool .tool-label')].map((x) => x.textContent.trim().slice(0, 6)),
    menu: [...document.querySelectorAll('.leaflet-popup .pop-menu .tool-label')].map((x) => x.textContent.trim()),
    navInCoords: !!document.querySelector('.leaflet-popup .coords-row .map-action'),
  }));
  ok(g.popup && !g.host && !g.panel && g.navInCoords, `switch off, ${w}px: the Leaflet popup, Navigate beside the coordinates, no host and no action area`);
  if (w === 1200) ok(g.tools.join('|') === 'Open d|Edit|Add vi|Make S|Delete', `switch off, wide: eye, edit, visit, side, delete icons as before (${g.tools})`);
  else ok(g.tools.join('|') === 'Open d|Edit|More' && g.menu.join('|') === 'Add visit|Make Side Quest|Delete', `switch off, phone: eye and edit, then More with the rest as before (${g.tools}; ${g.menu})`);
  await s.ctx.close();
}

ok(errs.length === 0, 'no page errors ' + errs.join(' | ').slice(0, 300));
await b.close();
