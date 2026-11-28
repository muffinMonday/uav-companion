// Community flying areas moderation panel: a mobile virtual keyboard fires window "resize" events. The panel must not rebuild its controls on them: the focused textarea keeps
// its element, focus, text, caret/selection and the panel scroll position (the keyboard stays up). Covers all five moderation textareas (approve note, photo-left-out reason,
// reject, unpublish, urgent photo removal), the layout class still following the viewport (sheet at <= 520 px), orientation changes, validation, Escape and a decision after resizes.
// Runs against an in-page account double (nothing reaches Supabase). Screenshots: tests/out/areas-admin-keyboard/.
import { chromium, CHANNEL, LATEST_SEEN, OUT, moreTool } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const shots = `${OUT}/areas-admin-keyboard`; fs.mkdirSync(shots, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ channel: CHANNEL });

const BACKEND = () => {
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const sq = (x, y, d = 0.004) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
  const mk = (n, over = {}) => ({ revision_id: uuid(n), area_id: uuid(1000 + n), revision_no: 1, name: 'Area ' + n, description: 'Description ' + n, draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [sq(103.8 + n * 0.01, 1.3)] },
    spots: [{ type: 'shelter', note: 'Pavilion ' + n, coordinates: [103.8 + n * 0.01 + 0.002, 1.302] }], area_m2: 190000, bbox: [103.8, 1.3, 103.81, 1.304], status: 'pending', submitted_at: new Date(Date.UTC(2026, 10, n)).toISOString(),
    reviewed_at: null, contributor_name: 'Bea', contributor_code: 'abcdef0123', own: false, has_published: false, unpublished: false, ...over });
  const photo = (n) => ({ id: uuid(5000 + n), width: 800, height: 600, caption: 'Lawn', state: 'attached', sha256: '0'.repeat(64) });
  const be = { calls: [], pending: [mk(1, { photo: photo(1) }), mk(2)], published: [mk(900, { status: 'approved', photo: photo(2) })], listeners: new Set() };
  globalThis.__be = be;
  globalThis.__uavAreasBackend = {
    available: () => true, signedIn: () => true, signIn() {}, onChange: (f) => { be.listeners.add(f); return () => be.listeners.delete(f); },
    fetchPhoto: async () => ({ data: new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], { type: 'image/png' }) }),
    purgePhotos: async () => ({}),
    rpc: async (fn, args) => {
      be.calls.push({ fn, args: JSON.parse(JSON.stringify(args)) });
      if (fn === 'my_roles') return { data: { admin: true, organiser: true } };
      if (fn === 'list_my_community_areas') return { data: [] };
      const page = (list) => ({ data: { items: list, next_cursor: null } });
      if (fn === 'list_pending_community_areas') return page(be.pending);
      if (fn === 'list_published_community_areas') return page(be.published);
      if (fn === 'review_community_area') { const i = be.pending.findIndex((x) => x.revision_id === args.p_revision_id); if (i < 0) return { error: { message: 'not_pending' } }; be.pending.splice(i, 1); return { data: { status: args.p_decision === 'approve' ? 'approved' : 'rejected', changed: true, xp_awarded: args.p_award_xp, xp: 100 } }; }
      if (fn === 'unpublish_community_area') { be.published.splice(0, 1); return { data: { status: 'unpublished', changed: true } }; }
      if (fn === 'remove_area_photo') return { data: { photo_id: args.p_area_id } };
      return { error: { message: 'unknown' } };
    } };
};
async function open(vp) {
  const ctx = await b.newContext({ viewport: vp, reducedMotion: 'reduce', hasTouch: true, isMobile: vp.width < 600 });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap|wpgmaps|cartocdn)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript(BACKEND);
  await ctx.addInitScript(([seen]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.3, lon: 103.82, zoom: 16 }, basemap: 'osm', holdHint: true }));
  }, [LATEST_SEEN]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation|zone data/i.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  if (await p.locator('#panel').isVisible()) await p.click('#panel-close');
  await p.evaluate(() => { globalThis.__resizes = 0; addEventListener('resize', () => { globalThis.__resizes++; }); });
  if (await p.locator('#areas-panel').isHidden()) await moreTool(p, 'areas');
  await p.waitForSelector('[data-act="admin-review"]'); await p.click('[data-act="admin-review"]');
  await p.waitForSelector('#areas-admin-panel:not([hidden]) .area-admin-item');
  return { ctx, p };
}
const AP = '#areas-admin-panel';
const state = (p, sel) => p.evaluate((s) => { const t = document.querySelector(s), r = document.getElementById('areas-admin-panel'); return { same: !!t && t.__keep === true, focused: !!t && document.activeElement === t, value: t?.value, a: t?.selectionStart, z: t?.selectionEnd, top: r.scrollTop, sheet: r.classList.contains('sheet'), resizes: globalThis.__resizes }; }, sel);
/** Types into the textarea, selects a range, scrolls the panel, marks the element, then opens and closes a "keyboard" (viewport height shrinks and returns). */
async function keyboardCycle(p, sel, label, vp) {
  await p.locator(sel).scrollIntoViewIfNeeded();
  await p.click(sel); await p.fill(sel, 'Faces are visible in the photo');
  await p.evaluate((s) => { const t = document.querySelector(s); t.setSelectionRange(6, 15); t.__keep = true; const r = document.getElementById('areas-admin-panel'); r.scrollTop = Math.max(0, r.scrollTop - 25); t.focus({ preventScroll: true }); }, sel);
  const before = await state(p, sel);
  for (const h of [Math.round(vp.height * 0.55), Math.round(vp.height * 0.4), vp.height, Math.round(vp.height * 0.55), vp.height]) { await p.setViewportSize({ width: vp.width, height: h }); await p.waitForTimeout(120); }
  const after = await state(p, sel);
  ok(after.resizes - before.resizes >= 3, `${label}: resize events fired (${after.resizes - before.resizes})`);
  ok(after.same, `${label}: the textarea element is the same node (not rebuilt)`);
  ok(after.focused, `${label}: the textarea keeps focus (keyboard stays up)`);
  ok(after.value === 'Faces are visible in the photo', `${label}: the entered text is kept`);
  ok(after.a === 6 && after.z === 15, `${label}: the selection is kept (${after.a}-${after.z})`);
  ok(Math.abs(after.top - before.top) <= 1, `${label}: the panel scroll position is kept (${before.top} -> ${after.top})`);
}
const VP = { width: 390, height: 640 };

// ---- pending item without the photo option: approve note, reject
{
  const { ctx, p } = await open(VP);
  ok((await state(p, AP)).sheet, 'phone width: the panel is a bottom sheet');
  await p.locator(`${AP} .area-admin-item`).nth(1).locator('[data-act=open]').click(); await p.waitForSelector(`${AP} .area-admin-detail`);
  await keyboardCycle(p, '#area-approve-note', 'approval note', VP);
  await keyboardCycle(p, '#area-reject-reason', 'rejection reason', VP);
  // validation, Escape and a decision still behave after the resizes
  await p.fill('#area-reject-reason', ''); await p.click(`${AP} [data-act=reject]`);
  ok(/Give a reason|reason/i.test(await p.locator(`${AP} .area-errors`).first().innerText()) && await p.locator(`${AP} .area-admin-confirm`).count() === 0, 'rejection validation still requires a reason');
  await p.fill('#area-reject-reason', 'Overlaps a school'); await p.click(`${AP} [data-act=reject]`); await p.waitForSelector(`${AP} .area-admin-confirm`);
  await p.setViewportSize({ width: 390, height: 360 }); await p.setViewportSize(VP); await p.waitForTimeout(150);
  ok(await p.locator(`${AP} .area-admin-confirm`).count() === 1, 'an open confirmation survives resizes');
  await p.click(`${AP} [data-act=confirm]`); await p.waitForFunction(() => globalThis.__be.calls.some((c) => c.fn === 'review_community_area'));
  const rv = await p.evaluate(() => globalThis.__be.calls.find((c) => c.fn === 'review_community_area').args);
  ok(rv.p_decision === 'reject' && rv.p_reason === 'Overlaps a school', 'the rejection is sent with the entered reason after resizes');
  await ctx.close();
}
// ---- pending item with a photo: reason the photo is left out
{
  const { ctx, p } = await open(VP);
  await p.locator(`${AP} .area-admin-item`).first().locator('[data-act=open]').click(); await p.waitForSelector(`${AP} .area-admin-photo img`);
  await p.check('#area-drop-photo');
  await keyboardCycle(p, '#area-drop-why', 'photo-exclusion reason', VP);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(await p.locator(AP).isHidden(), 'Escape still closes the review panel from a focused textarea');
  await ctx.close();
}
// ---- published item: unpublish and urgent photo removal
{
  const { ctx, p } = await open(VP);
  await p.click(`${AP} [data-act=tab-published]`); await p.waitForSelector(`${AP} .area-admin-item`);
  await p.locator(`${AP} .area-admin-item`).first().locator('[data-act=open]').click(); await p.waitForSelector(`${AP} .area-admin-photo img`);
  await keyboardCycle(p, '#area-unpublish-reason', 'unpublication reason', VP);
  await keyboardCycle(p, '#area-photo-remove-why', 'photo-removal reason', VP);
  await p.screenshot({ path: `${shots}/phone.png` });
  await ctx.close();
}
// ---- orientation and breakpoint: the layout class still follows the viewport without a rebuild
{
  const { ctx, p } = await open({ width: 390, height: 780 });
  await p.locator(`${AP} .area-admin-item`).nth(1).locator('[data-act=open]').click(); await p.waitForSelector(`${AP} .area-admin-detail`);
  await p.evaluate(() => { document.getElementById('area-reject-reason').__keep = true; });
  await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(150);
  let s = await state(p, '#area-reject-reason');
  ok(!s.sheet, 'landscape (844 px): the sheet class is removed');
  ok(s.same, 'orientation change does not rebuild the textarea');
  await p.setViewportSize({ width: 390, height: 780 }); await p.waitForTimeout(150);
  s = await state(p, '#area-reject-reason');
  ok(s.sheet && s.same, 'portrait (390 px): the sheet class returns, textarea still the same node');
  await p.click(`${AP} [data-act=back]`); await p.waitForSelector(`${AP} .area-admin-item`);
  await p.setViewportSize({ width: 900, height: 700 }); await p.waitForTimeout(150);
  ok(!(await state(p, AP)).sheet && await p.locator(`${AP} .area-admin-item`).count() === 2, 'list view: layout follows the viewport and the list stays intact');
  await ctx.close();
}
console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
await b.close();
