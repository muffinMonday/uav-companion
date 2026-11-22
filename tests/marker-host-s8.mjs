// Review 01 S8: the edit form inside the marker host. Development switch only (?markerhost=1).
// Short screens and landscape (Save / Cancel stay reachable), software keyboard (overridden visualViewport), focus, Escape / swipe-down / Cancel with the unsaved-change question,
// Save parity, the "New trip..." hand-off, the popup (switch off) unchanged. Emulated: Playwright viewports, CDP touch. No real phone, keyboard or screen reader.
import { chromium, CHANNEL } from './lib.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const item = (id, name, lat, lon, extra) => ({ id, type: 'photo', name, note: 'A note', lat, lon, created: '2026-11-01T00:00:00.000Z', ...extra });
const items = [item('a', 'Tower', 30.5, 114.3, { tripId: 't1', date: '2026-11-12', day: 1, order: 1 }), item('b', 'Bridge', 30.503, 114.303, { tripId: 't1', date: '2026-11-12', day: 1, order: 2 })];
const trips = [{ id: 't1', name: 'Wuhan', color: '#e91e63', description: '', created: '2026-11-01T00:00:00.000Z', startDate: '2026-11-12', endDate: '2026-11-14' }];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ channel: CHANNEL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = '#marker-host';

async function session({ width, height = 800, host = true, touch = false }) {
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
  const s = { ctx, p };
  if (touch) {
    s.cdp = await ctx.newCDPSession(p);
    s.send = (type, pts) => s.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    s.swipe = async ([x0, y0], [x1, y1], steps = 10) => {
      await s.send('touchStart', [{ x: x0, y: y0, id: 1 }]);
      for (let i = 1; i <= steps; i++) { await s.send('touchMove', [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, id: 1 }]); await sleep(14); }
      await s.send('touchEnd', []); await sleep(400);
    };
  }
  return s;
}
const shown = (p) => p.evaluate(() => { const e = document.getElementById('marker-host'); return !!e && !e.hidden; });
const pinPos = (p, name) => p.evaluate((n) => { const e = [...document.querySelectorAll('.poi-pin')].find((x) => x.getAttribute('title') === n); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, name);
const click = async (p, name) => { const q = await pinPos(p, name); await p.mouse.click(q.x, q.y); await p.waitForTimeout(1200); };
const stored = (p, id) => p.evaluate((i) => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.find((x) => x.id === i), id);
const poiWrites = (p) => p.evaluate(() => window.__w.filter((k) => k === 'uavzones.v1.pois').length);
const resetWrites = (p) => p.evaluate(() => { window.__w = []; });
const edit = async (p) => { await p.locator(`${H} .pop-secondary .btn`, { hasText: 'Edit' }).first().click(); await p.waitForTimeout(600); };
const formUp = (p) => p.evaluate(() => !!document.querySelector('#marker-host form'));
const ask = (p) => p.evaluate(() => {
  const e = document.querySelector('#marker-host .edit-discard');
  return e ? { text: e.textContent, btns: [...e.querySelectorAll('button')].map((x) => x.textContent), focus: document.activeElement?.textContent, acts: getComputedStyle(document.querySelector('#marker-host form > .acts')).display } : null;
});
const focusInfo = (p) => p.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, text: a?.textContent?.trim(), type: a?.type, value: a?.value, inEdit: !!a?.closest('#marker-host .pop-secondary') }; });
const title = (p) => p.evaluate(() => document.getElementById('mh-title')?.textContent);
const onEdit = async (p) => { const f = await focusInfo(p); return f.text === 'Edit' && f.inEdit; };
const nameInput = (p) => p.locator(`${H} form input[type=text]`).first();
const reach = (p) => p.evaluate(() => {
  const hr = document.querySelector('#marker-host').getBoundingClientRect(), body = document.querySelector('.mh-body'), bs = [...document.querySelectorAll('#marker-host form > .acts .btn')];
  const inside = (e) => { const r = e.getBoundingClientRect(); return r.top >= hr.top - 1 && r.bottom <= hr.bottom + 1 && r.left >= hr.left - 1 && r.right <= hr.right + 1; };
  return { n: bs.length, inside: bs.every(inside), min: Math.min(...bs.map((e) => e.getBoundingClientRect().height)), overflowX: document.documentElement.scrollWidth > innerWidth || body.scrollWidth > body.clientWidth + 1 };
});

// ---------------------------------------------------------------- 1. layout: Save and Cancel reachable at every size
for (const [w, h, touch] of [[360, 740, true], [660, 800, false], [760, 800, true], [1440, 900, false], [640, 360, true]]) {
  const s = await session({ width: w, height: h, touch });
  await click(s.p, 'Tower'); await edit(s.p);
  const lab = `${w}x${h}`;
  ok(await formUp(s.p) && (await focusInfo(s.p)).type === 'text', `${lab}: the form opens in the host with focus in the name field`);
  let r = await reach(s.p);
  ok(r.n === 2 && r.inside, `${lab}: Save and Cancel are inside the host at the top of the form`);
  await s.p.evaluate(() => { const bd = document.querySelector('.mh-body'); bd.scrollTop = bd.scrollHeight; }); await s.p.waitForTimeout(150);
  r = await reach(s.p);
  ok(r.inside && !r.overflowX, `${lab}: ... and at the bottom of the scroll, with no horizontal overflow`);
  await s.p.evaluate(() => { const bd = document.querySelector('.mh-body'); bd.scrollTop = 0; }); await s.p.waitForTimeout(100);
  ok((await reach(s.p)).inside, `${lab}: ... and after scrolling back to the top (they stay at the bottom edge)`);
  if (touch) ok(r.min >= 43.5, `${lab}: touch targets 44 px (${Math.round(r.min)})`);
  const clear = await s.p.evaluate(() => {
    const t = document.querySelector('#marker-host form textarea'); t.scrollIntoView({ block: 'nearest' });
    const q = t.getBoundingClientRect(), a = document.querySelector('#marker-host form > .acts').getBoundingClientRect();
    return q.bottom <= a.top + 1 || q.top >= a.bottom - 1;
  });
  ok(clear, `${lab}: the note field is not hidden under Save and Cancel after scrolling to it`);
  await s.ctx.close();
}

// ---------------------------------------------------------------- 2. unchanged form: Escape and Cancel go straight back; the host stays
{
  const s = await session({ width: 1200 });
  await click(s.p, 'Tower'); await resetWrites(s.p);
  await edit(s.p);
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(300);
  ok(await shown(s.p) && !(await formUp(s.p)) && (await title(s.p)) === 'Tower', 'unchanged + Escape: back to the details, the host stays open');
  ok(await onEdit(s.p), 'unchanged + Escape: focus is on Edit');
  ok(!(await s.p.evaluate(() => !!document.querySelector('#marker-host .edit-discard'))), 'unchanged + Escape: no question');
  await edit(s.p);
  await s.p.locator(`${H} form .acts .btn`, { hasText: 'Cancel' }).click(); await s.p.waitForTimeout(300);
  ok(await shown(s.p) && !(await formUp(s.p)) && await onEdit(s.p), 'unchanged + Cancel: back to the details with focus on Edit');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(300);
  ok(!(await shown(s.p)), 'Escape in the details still closes the host (unchanged)');
  ok((await poiWrites(s.p)) === 0, 'nothing was written to the markers store');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 3. changed form: Escape / Cancel ask; Keep editing; Discard
{
  const s = await session({ width: 1200 });
  await click(s.p, 'Tower'); await resetWrites(s.p);
  await edit(s.p);
  await nameInput(s.p).fill('Tower renamed');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(300);
  let q = await ask(s.p);
  ok(await shown(s.p) && await formUp(s.p) && q && /Discard your changes/.test(q.text), 'changed + Escape: the host and the form stay, a question is shown');
  ok(q && q.btns.join('|') === 'Keep editing|Discard changes' && q.focus === 'Keep editing' && q.acts === 'none', 'the question offers Keep editing (focused) and Discard changes; Save / Cancel are replaced');
  ok((await s.p.evaluate(() => document.querySelector('#marker-host').getAttribute('role'))) === 'region', 'the host is still a non-modal region (no dialog, no scrim)');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(300);
  q = await ask(s.p); const f = await focusInfo(s.p);
  ok(!q && f.type === 'text' && f.value === 'Tower renamed', 'a second Escape means Keep editing: the question goes, the typed text and focus are kept');
  await s.p.locator(`${H} form .acts .btn`, { hasText: 'Cancel' }).click(); await s.p.waitForTimeout(300);
  ok(!!(await ask(s.p)) && await formUp(s.p), 'changed + Cancel asks too');
  await s.p.locator(`${H} .edit-discard button`, { hasText: 'Keep editing' }).click(); await s.p.waitForTimeout(200);
  ok(!(await ask(s.p)) && (await nameInput(s.p).inputValue()) === 'Tower renamed', 'Keep editing (button) returns to the form with the text');
  await s.p.locator(`${H} form .acts .btn`, { hasText: 'Cancel' }).click(); await s.p.waitForTimeout(200);
  await s.p.locator(`${H} .edit-discard button`, { hasText: 'Discard changes' }).click(); await s.p.waitForTimeout(300);
  ok(await shown(s.p) && !(await formUp(s.p)) && (await title(s.p)) === 'Tower' && await onEdit(s.p), 'Discard changes: back to the details, original name, focus on Edit, host open');
  ok((await stored(s.p, 'a')).name === 'Tower' && (await poiWrites(s.p)) === 0, 'Discard: stored marker unchanged, nothing written (no draft persisted)');
  await edit(s.p);
  await s.p.locator(`${H} form textarea`).fill('A different note');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(300);
  ok(!!(await ask(s.p)), 'a changed note counts as a change');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(150);
  await s.p.locator(`${H} form textarea`).fill('A note');
  await s.p.keyboard.press('Escape'); await s.p.waitForTimeout(300);
  ok(!(await ask(s.p)) && !(await formUp(s.p)), 'putting the value back makes the form unchanged again');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 4. Save parity
{
  const s = await session({ width: 1200 });
  await click(s.p, 'Tower'); await edit(s.p); await resetWrites(s.p);
  await nameInput(s.p).fill('Tower saved');
  await s.p.locator(`${H} form .acts .primary`).click(); await s.p.waitForTimeout(500);
  const it = await stored(s.p, 'a');
  ok(it.name === 'Tower saved' && it.note === 'A note' && it.lat === 30.5 && it.lon === 114.3 && it.tripId === 't1', 'Save stores the change and nothing else');
  ok(await shown(s.p) && (await title(s.p)) === 'Tower saved' && await onEdit(s.p), 'Save: details with the new name, host open, focus on Edit');
  ok(await s.p.evaluate(() => [...document.querySelectorAll('.poi-pin')].some((e) => e.getAttribute('title') === 'Tower saved')), 'the pin carries the new name');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 5. sheet drag down (phone)
{
  const s = await session({ width: 360, height: 740, touch: true });
  await click(s.p, 'Tower'); await resetWrites(s.p);
  const handle = () => s.p.evaluate(() => { const r = document.querySelector('.mh-handle').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await edit(s.p);
  let hb = await handle();
  await s.swipe(hb, [hb[0], hb[1] + 120]);
  ok(await shown(s.p) && !(await formUp(s.p)) && await onEdit(s.p), 'unchanged form + drag down from the compact sheet: back to the details, the sheet stays');
  await edit(s.p); await nameInput(s.p).fill('Dragged');
  hb = await handle();
  await s.swipe(hb, [hb[0], hb[1] + 120]);
  ok(await shown(s.p) && await formUp(s.p) && !!(await ask(s.p)), 'changed form + drag down: the sheet stays and the question appears');
  const h = await s.p.evaluate(() => document.querySelector('#marker-host').getBoundingClientRect().height);
  ok(h > 150, `the sheet kept its size (${Math.round(h)} px)`);
  await s.p.locator(`${H} .edit-discard button`, { hasText: 'Discard changes' }).click(); await s.p.waitForTimeout(300);
  ok(!(await formUp(s.p)) && (await stored(s.p, 'a')).name === 'Tower' && (await poiWrites(s.p)) === 0, 'Discard after the drag: nothing stored');
  hb = await handle();
  await s.swipe(hb, [hb[0], hb[1] + 120]);
  ok(!(await shown(s.p)), 'in the details a drag down from the compact sheet still closes the host');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 6. software keyboard
{
  const s = await session({ width: 360, height: 740, touch: true });
  await click(s.p, 'Tower'); await edit(s.p);
  await s.p.locator(`${H} form textarea`).focus();
  const kb = await s.p.evaluate(async () => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { get: () => 400, configurable: true });
    vv.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 400));
    const hr = document.getElementById('marker-host').getBoundingClientRect(), a = document.querySelector('#marker-host form > .acts').getBoundingClientRect(), t = document.querySelector('#marker-host form textarea').getBoundingClientRect();
    return { bottom: hr.bottom, top: hr.top, h: hr.height, saveIn: a.top >= hr.top && a.bottom <= hr.bottom + 1, saveAboveKb: a.bottom <= 401, noteTop: t.top, noteBottom: t.bottom, acts: a.top };
  });
  ok(Math.abs(kb.bottom - 400) <= 1 && kb.top >= 0, `keyboard (visual viewport 400 of 740): the sheet sits above it (bottom ${Math.round(kb.bottom)}, height ${Math.round(kb.h)})`);
  ok(kb.saveIn && kb.saveAboveKb, 'Save and Cancel are reachable above the keyboard');
  ok(kb.noteTop >= kb.top && kb.noteBottom <= kb.acts + 1, 'the focused note field is visible above Save and Cancel ' + JSON.stringify(kb));
  await s.p.evaluate(async () => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); await new Promise((r) => setTimeout(r, 300)); });
  ok(Math.abs((await s.p.evaluate(() => document.querySelector('#marker-host').getBoundingClientRect().bottom)) - 740) <= 1, 'keyboard gone: the sheet is back at the bottom of the screen');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 7. "New trip..." hand-off
{
  const s = await session({ width: 1200 });
  await click(s.p, 'Tower'); await edit(s.p); await resetWrites(s.p);
  await s.p.locator(`${H} form select`).nth(1).selectOption('__new'); await s.p.waitForTimeout(700);
  ok(!(await shown(s.p)), '"New trip…" closes the host (the existing hand-off)');
  ok(await s.p.evaluate(() => !document.getElementById('panel').hidden), 'the side panel opens for the new trip');
  ok((await poiWrites(s.p)) === 0 && (await stored(s.p, 'a')).tripId === 't1', 'nothing stored by the hand-off');
  await s.ctx.close();
}

// ---------------------------------------------------------------- 8. switch off: the popup keeps its behaviour
{
  const s = await session({ width: 1200, host: false });
  await click(s.p, 'Tower');
  const popEdit = () => s.p.evaluate(() => [...document.querySelectorAll('.leaflet-popup button')].find((e) => /^Edit$/.test(e.getAttribute('aria-label') || e.title || e.textContent.trim()))?.click());
  await popEdit(); await s.p.waitForTimeout(600);
  ok(await s.p.evaluate(() => !!document.querySelector('.leaflet-popup form')), 'popup: the edit form opens');
  await s.p.locator('.leaflet-popup form input[type=text]').fill('Popup renamed');
  await s.p.locator('.leaflet-popup form .acts .btn', { hasText: 'Cancel' }).click(); await s.p.waitForTimeout(400);
  ok(await s.p.evaluate(() => !document.querySelector('.leaflet-popup form') && !!document.querySelector('.leaflet-popup h3') && !document.querySelector('.edit-discard')), 'popup: Cancel returns at once without a question (unchanged)');
  ok(!(await shown(s.p)), 'popup: no marker host is shown');
  await popEdit(); await s.p.waitForTimeout(500);
  await s.p.locator('.leaflet-popup form input[type=text]').fill('Popup saved');
  await s.p.locator('.leaflet-popup form .acts .primary').click(); await s.p.waitForTimeout(400);
  ok((await stored(s.p, 'a')).name === 'Popup saved', 'popup: Save still stores');
  await s.ctx.close();
}

ok(errs.length === 0, 'no console or page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
