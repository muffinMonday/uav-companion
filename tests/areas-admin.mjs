// Community flying areas, Phase 3 (src/areas/admin-*.js): the administrator moderation panel in a real browser, against an in-page double of the account backend
// (nothing reaches Supabase). Covers: visibility (guest, ordinary user, administrator), the pending queue (order, contributor, preview, spots, description, safe text),
// paging, the approve controls (XP checkbox on by default, 100 to 500 slider in steps of 100, amount beside it and in the confirmation), reject reason validation,
// confirmations, refresh after a decision, own submission (no reward), a stale decision, unpublish, and that the Phase 1/2 panel still works. Screenshots: tests/out/areas-admin/.
import { chromium, CHANNEL, LATEST_SEEN, OUT, moreTool } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const shots = `${OUT}/areas-admin`; fs.mkdirSync(shots, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ channel: CHANNEL });
const requests = [];

const BACKEND = ([signed, admin, total]) => {
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const sq = (x, y, d = 0.004) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
  const mk = (n, over = {}) => ({ revision_id: uuid(n), area_id: uuid(1000 + n), revision_no: 1, name: 'Area ' + n, description: 'Description ' + n, draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [sq(103.8 + n * 0.01, 1.3)] },
    spots: [{ type: 'shelter', note: 'Pavilion ' + n, coordinates: [103.8 + n * 0.01 + 0.002, 1.302] }], area_m2: 190000, bbox: [103.8, 1.3, 103.81, 1.304], status: 'pending', submitted_at: new Date(Date.UTC(2026, 10, n)).toISOString(),
    reviewed_at: null, contributor_name: 'Bea', contributor_code: 'abcdef0123', own: false, has_published: false, unpublished: false, ...over });
  const pending = Array.from({ length: total }, (_, i) => mk(i + 1));
  pending[0] = mk(1, { name: '<img src=x onerror=window.__xss=1>Evil', description: '<b>bold</b> <script>window.__xss=1</script>' });
  pending[1] = mk(2, { own: true, contributor_name: 'Me' });
  const published = [mk(900, { status: 'approved' })];
  const be = { calls: [], signIns: 0, signed: signed === 1, admin: admin === 1, pending, published, stale: false, listeners: new Set(), fire() { for (const f of be.listeners) f(); } };
  globalThis.__be = be;
  globalThis.__uavAreasBackend = {
    available: () => true, signedIn: () => be.signed, signIn: () => { be.signIns++; }, onChange: (f) => { be.listeners.add(f); return () => be.listeners.delete(f); }, fire: () => be.fire(),
    rpc: async (fn, args) => {
      be.calls.push({ fn, args: JSON.parse(JSON.stringify(args)) });
      if (fn === 'my_roles') return { data: { admin: be.admin, organiser: be.admin } };
      if (fn === 'list_my_community_areas') return { data: [] };
      if (!be.admin && /community_area/.test(fn)) return { error: { message: 'not allowed', code: '42501' } };
      const page = (list, a) => { const i = a.p_cursor ? list.findIndex((x) => x.revision_id === a.p_cursor.id) + 1 : 0; const slice = list.slice(i, i + a.p_limit); const last = slice[slice.length - 1];
        return { data: { items: slice, next_cursor: i + a.p_limit < list.length ? { at: last.submitted_at, id: last.revision_id } : null } }; };
      if (fn === 'list_pending_community_areas') return page(be.pending, args);
      if (fn === 'list_published_community_areas') return page(be.published, args);
      if (fn === 'review_community_area') {
        const i = be.pending.findIndex((x) => x.revision_id === args.p_revision_id);
        if (be.stale || i < 0) { if (i >= 0) be.pending.splice(i, 1); return { error: { message: 'not_pending' } }; }
        if (be.unpub && args.p_decision === 'approve' && args.p_republish !== true) return { error: { message: 'area_unpublished' } };
        const it = be.pending.splice(i, 1)[0];
        if (args.p_decision === 'approve') be.published.push({ ...it, status: 'approved' });
        return { data: { status: args.p_decision === 'approve' ? 'approved' : 'rejected', changed: true, xp_awarded: args.p_award_xp, xp: args.p_award_xp ? args.p_xp_amount : 0 } };
      }
      if (fn === 'unpublish_community_area') { const i = be.published.findIndex((x) => x.area_id === args.p_area_id); if (i >= 0) be.published.splice(i, 1); return { data: { status: 'unpublished', changed: true } }; }
      return { error: { message: 'unknown' } };
    } };
};
async function open({ vp = { width: 1300, height: 850 }, signed = 1, admin = 1, total = 5 } = {}) {
  const ctx = await b.newContext({ viewport: vp, reducedMotion: 'reduce' });
  await ctx.route(/^https?:\/\/[^/]*(openstreetmap|opentopomap|wpgmaps)[^/]*\/.*\.png/i, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.addInitScript(BACKEND, [signed, admin, total]);
  await ctx.addInitScript(([seen]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen }));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.3, lon: 103.82, zoom: 16 }, basemap: 'osm', holdHint: true }));
  }, [LATEST_SEEN]);
  const p = await ctx.newPage();
  p.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|geolocation|Geolocation|zone data/i.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  if (await p.locator('#panel').isVisible()) await p.click('#panel-close');
  await p.waitForTimeout(250);
  return { ctx, p };
}
const calls = (p, fn) => p.evaluate((f) => globalThis.__be.calls.filter((c) => c.fn === f), fn);
const openAreas = async (p) => { if (await p.locator('#areas-panel').isHidden()) await moreTool(p, 'areas'); await p.waitForSelector('#areas-panel:not([hidden])'); };
const AP = '#areas-admin-panel';

// ---- a guest and an ordinary signed-in user never see the entry
for (const [label, signed, admin] of [['guest', 0, 0], ['signed-in non-administrator', 1, 0]]) {
  const { ctx, p } = await open({ signed, admin });
  await openAreas(p);
  ok(await p.locator('[data-act="admin-review"]').count() === 0, `${label}: no review button in My flying areas`);
  ok(await p.locator(AP).isHidden(), `${label}: the review panel is hidden`);
  ok((await calls(p, 'list_pending_community_areas')).length === 0 && (await calls(p, 'list_published_community_areas')).length === 0, `${label}: no moderation request is made`);
  await ctx.close();
}

// ---- the administrator
{
  const { ctx, p } = await open({ total: 25 });
  await openAreas(p);
  await p.waitForSelector('[data-act="admin-review"]');
  ok(true, 'administrator: the review button appears');
  ok((await calls(p, 'my_roles')).length >= 1 && (await calls(p, 'list_pending_community_areas')).length === 0, 'the role is read first; the queue is not fetched until it is opened');
  await p.click('[data-act="admin-review"]');
  await p.waitForSelector(`${AP}:not([hidden]) .area-admin-item`);
  ok(await p.locator('#areas-panel').isHidden(), 'the review panel replaces the My flying areas panel');
  const list = await calls(p, 'list_pending_community_areas');
  ok(list.length === 1 && list[0].args.p_limit === 20 && list[0].args.p_cursor === null, 'the first page asks for a bounded page (20) with no cursor');
  const names = await p.$$eval(`${AP} .area-item-name`, (n) => n.map((x) => x.textContent));
  ok(names.length === 20 && names[2] === 'Area 3' && names[19] === 'Area 20', 'twenty pending items, oldest first');
  const first = p.locator(`${AP} .area-admin-item`).first();
  ok(/Bea \(abcdef0123\)/.test(await first.locator('.area-item-meta').textContent()) && /submitted 1 Nov 2026/.test(await first.locator('.area-item-meta').textContent()) && /revision 1/.test(await first.locator('.area-item-meta').textContent()), 'a card shows contributor, submission date and revision');
  ok(await first.locator('svg.area-admin-preview polygon').count() === 1 && await first.locator('svg circle.area-admin-spot').count() === 1, 'a card previews the outline and the setup spot');
  ok(await p.locator(`${AP} img, ${AP} script, ${AP} b`).count() === 0 && (await first.locator('.area-item-name').textContent()).startsWith('<img') && await p.evaluate(() => globalThis.__xss !== 1), 'hostile text is shown as text, never as markup');
  await p.screenshot({ path: `${shots}/queue.png` });
  await p.click(`${AP} [data-act="more"]`);
  await p.waitForFunction(() => document.querySelectorAll('#areas-admin-panel .area-admin-item').length === 25);
  ok((await calls(p, 'list_pending_community_areas')).at(-1).args.p_cursor?.id === '00000000-0000-4000-8000-000000000020', 'Load more continues from the cursor; 25 items, no more button');
  ok(await p.locator(`${AP} [data-act="more"]`).count() === 0, 'no Load more after the last page');

  // review view, approve with the XP controls
  await p.locator(`${AP} .area-admin-item`).nth(2).locator('[data-act="open"]').click();
  await p.waitForSelector(`${AP} .area-admin-detail`);
  ok(/Description 3/.test(await p.locator(`${AP} .area-admin-desc`).textContent()) && /Pavilion 3/.test(await p.locator(`${AP} .area-admin-spots`).textContent()) && await p.locator(`${AP} .area-admin-detail svg polygon`).count() === 1, 'the review view shows the description, the setup spots and the outline');
  ok(await p.locator('#area-award').isChecked() && await p.locator('#area-xp').inputValue() === '100' && await p.locator('#area-xp').getAttribute('step') === '100' && await p.locator('#area-xp').getAttribute('min') === '100' && await p.locator('#area-xp').getAttribute('max') === '500', 'XP checkbox is on by default; the slider is 100 to 500, step 100, starting at 100');
  ok(await p.locator('#area-xp-out').textContent() === '100 XP', 'the amount is shown beside the slider');
  await p.locator('#area-xp').fill('300');
  ok(await p.locator('#area-xp-out').textContent() === '300 XP', 'moving the slider updates the amount');
  await p.locator('#area-award').uncheck();
  ok(await p.locator('#area-xp').isDisabled() && await p.locator('#area-xp-out').isHidden(), 'unticking disables the slider');
  await p.locator('#area-award').check();
  await p.click(`${AP} [data-act="approve"]`);
  await p.waitForSelector(`${AP} .area-admin-confirm`);
  ok(/300 XP will be awarded to Bea/.test(await p.locator('.area-admin-xp-line').textContent()) && (await calls(p, 'review_community_area')).length === 0, 'the confirmation states the amount; nothing is sent yet');
  await p.screenshot({ path: `${shots}/confirm.png` });
  await p.click(`${AP} [data-act="cancel"]`);
  ok((await calls(p, 'review_community_area')).length === 0 && await p.locator(`${AP} .area-admin-approve`).count() === 1, 'Cancel returns to the review without sending');
  await p.click(`${AP} [data-act="approve"]`); await p.click(`${AP} [data-act="confirm"]`);
  await p.waitForFunction(() => !document.querySelector('#areas-admin-panel .area-admin-detail'));
  const rv = await calls(p, 'review_community_area');
  ok(rv.length === 1 && rv[0].args.p_decision === 'approve' && rv[0].args.p_award_xp === true && rv[0].args.p_xp_amount === 300 && rv[0].args.p_revision_id.endsWith('3') && !('p_user_id' in rv[0].args) && Object.keys(rv[0].args).sort().join() === 'p_award_xp,p_decision,p_reason,p_revision_id,p_xp_amount', 'the approval sends only the revision, the decision, the note and the reward');
  ok(/Approved and published. 300 XP awarded/.test(await p.locator('#toast').textContent()), 'a result toast states the XP awarded');
  ok(!(await p.$$eval(`${AP} .area-item-name`, (n) => n.map((x) => x.textContent))).includes('Area 3'), 'the list refreshes after the decision');

  // approve without a reward
  await p.locator(`${AP} .area-admin-item`).nth(2).locator('[data-act="open"]').click();
  await p.locator('#area-award').uncheck(); await p.click(`${AP} [data-act="approve"]`);
  ok(/No XP will be awarded/.test(await p.locator('.area-admin-xp-line').textContent()), 'with the box off the confirmation says no XP');
  await p.click(`${AP} [data-act="confirm"]`); await p.waitForFunction(() => !document.querySelector('#areas-admin-panel .area-admin-detail'));
  const rv2 = (await calls(p, 'review_community_area')).at(-1);
  ok(rv2.args.p_award_xp === false && rv2.args.p_xp_amount === null, 'approval without a reward sends award false and no amount');

  // reject: reason validation
  await p.locator(`${AP} .area-admin-item`).nth(2).locator('[data-act="open"]').click();
  await p.click(`${AP} [data-act="reject"]`);
  ok(/Give a reason/.test(await p.locator(`${AP} .area-admin-reject .area-errors`).textContent()) && (await calls(p, 'review_community_area')).length === 2, 'rejecting without a reason is refused locally');
  await p.fill('#area-reject-reason', '   ');
  await p.click(`${AP} [data-act="reject"]`);
  ok((await calls(p, 'review_community_area')).length === 2, 'a blank reason is refused');
  ok(await p.getAttribute('#area-reject-reason', 'maxlength') === '500', 'the reason field is limited to 500 characters');
  await p.fill('#area-reject-reason', 'Overlaps a school playground');
  ok(await p.locator('.area-count').textContent() === '28 / 500', 'a character counter is shown');
  await p.click(`${AP} [data-act="reject"]`);
  ok(/Overlaps a school playground/.test(await p.locator('.area-admin-quote').textContent()), 'the confirmation shows the reason the contributor will see');
  await p.click(`${AP} [data-act="confirm"]`); await p.waitForFunction(() => !document.querySelector('#areas-admin-panel .area-admin-detail'));
  const rv3 = (await calls(p, 'review_community_area')).at(-1);
  ok(rv3.args.p_decision === 'reject' && rv3.args.p_reason === 'Overlaps a school playground' && rv3.args.p_award_xp === false, 'rejection sends the reason and no reward');

  // an administrator's own submission cannot carry a reward
  await p.locator(`${AP} [data-revision="00000000-0000-4000-8000-000000000002"]`).locator('[data-act="open"]').click();
  ok(await p.locator('#area-award').isDisabled() && !(await p.locator('#area-award').isChecked()) && /cannot earn you XP/.test(await p.locator(`${AP} .areas-warn`).textContent()), 'own submission: the reward box is off and disabled, with a notice');
  await p.click(`${AP} [data-act="approve"]`);
  ok(/No XP will be awarded/.test(await p.locator('.area-admin-xp-line').textContent()), 'own submission: the confirmation says no XP');
  await p.click(`${AP} [data-act="confirm"]`); await p.waitForFunction(() => !document.querySelector('#areas-admin-panel .area-admin-detail'));
  ok((await calls(p, 'review_community_area')).at(-1).args.p_award_xp === false, 'own submission: no reward is requested');

  // a stale decision
  await p.evaluate(() => { globalThis.__be.stale = true; });
  await p.locator(`${AP} .area-admin-item`).first().locator('[data-act="open"]').click();
  await p.click(`${AP} [data-act="approve"]`); await p.click(`${AP} [data-act="confirm"]`);
  await p.waitForFunction(() => !document.querySelector('#areas-admin-panel .area-admin-detail'));
  ok(!(await p.$$eval(`${AP} .area-item-name`, (n) => n.some((x) => x.textContent.startsWith('<img')))), 'a stale decision (already decided elsewhere) returns to a refreshed list');
  await p.evaluate(() => { globalThis.__be.stale = false; });

  // an unpublished area is republished only by a second, explicit confirmation
  await p.evaluate(() => { globalThis.__be.unpub = true; });
  const before = (await calls(p, 'review_community_area')).length;
  await p.locator(`${AP} .area-admin-item`).first().locator('[data-act="open"]').click();
  await p.locator('#area-award').uncheck(); await p.click(`${AP} [data-act="approve"]`); await p.click(`${AP} [data-act="confirm"]`);
  await p.waitForSelector(`${AP} .area-admin-republish`);
  const rv4 = (await calls(p, 'review_community_area')).slice(before);
  ok(rv4.length === 1 && !('p_republish' in rv4[0].args) && /unpublished by an administrator/.test(await p.locator(`${AP} .area-admin-republish`).textContent()) && await p.locator(`${AP} .area-admin-detail`).count() === 1, 'the server refusal opens a second confirmation that says the approval will publish the area again; nothing was decided');
  await p.click(`${AP} [data-act="cancel"]`);
  ok((await calls(p, 'review_community_area')).length === before + 1, 'cancelling the second confirmation sends nothing more');
  await p.click(`${AP} [data-act="approve"]`); await p.click(`${AP} [data-act="confirm"]`); await p.waitForSelector(`${AP} .area-admin-republish`);
  await p.click(`${AP} [data-act="confirm"]`); await p.waitForFunction(() => !document.querySelector('#areas-admin-panel .area-admin-detail'));
  const rv5 = (await calls(p, 'review_community_area')).at(-1);
  ok(rv5.args.p_republish === true && rv5.args.p_decision === 'approve', 'only the second, explicit confirmation sends p_republish = true');
  await p.evaluate(() => { globalThis.__be.unpub = false; });

  // published tab and unpublish
  await p.click(`${AP} [data-act="tab-published"]`);
  await p.waitForSelector(`${AP} .area-admin-item`);
  const pubNames = await p.$$eval(`${AP} .area-item-name`, (n) => n.map((x) => x.textContent));
  ok(pubNames.includes('Area 900') && pubNames.includes('Area 4'), 'the Published tab lists published areas');
  await p.locator(`${AP} .area-admin-item`).first().locator('[data-act="open"]').click();
  ok(await p.locator(`${AP} [data-act="approve"]`).count() === 0 && await p.locator('#area-unpublish-reason').count() === 1, 'a published area offers Unpublish, not Approve');
  await p.click(`${AP} [data-act="unpublish"]`);
  ok(/Give a reason/.test(await p.locator(`${AP} .area-errors`).textContent()) && (await calls(p, 'unpublish_community_area')).length === 0, 'unpublishing needs a reason');
  await p.fill('#area-unpublish-reason', 'Private land');
  await p.click(`${AP} [data-act="unpublish"]`); await p.click(`${AP} [data-act="confirm"]`);
  await p.waitForFunction(() => !document.querySelector('#areas-admin-panel .area-admin-detail'));
  const un = (await calls(p, 'unpublish_community_area'))[0];
  ok(un?.args.p_reason === 'Private land' && Object.keys(un.args).sort().join() === 'p_area_id,p_reason', 'unpublish sends the area and the reason only');
  await p.screenshot({ path: `${shots}/published.png` });

  // the panel closes, and the Phase 1/2 panel still works
  await p.click(`${AP} [data-act="close"]`);
  ok(await p.locator(AP).isHidden(), 'Close hides the review panel');
  await openAreas(p);
  ok(await p.locator('#areas-panel [data-act="draw-polygon"]').count() === 1 && await p.locator('#areas-panel [data-act="import"]').count() === 1, 'My flying areas still offers drawing and import');

  // signing out hides it again
  await p.evaluate(() => { globalThis.__be.signed = false; globalThis.__be.fire(); });
  await p.waitForFunction(() => !document.querySelector('[data-act="admin-review"]'));
  ok(true, 'signing out removes the review entry');
  await ctx.close();
}

// ---- phone layout
{
  const { ctx, p } = await open({ vp: { width: 390, height: 780 } });
  await openAreas(p); await p.click('[data-act="admin-review"]');
  await p.waitForSelector(`${AP}:not([hidden]) .area-admin-item`);
  const box = await p.$eval(AP, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, vw: innerWidth }; });
  ok(box.l >= 0 && box.r <= box.vw + 1 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: the panel fits the screen with no horizontal scroll');
  await p.screenshot({ path: `${shots}/phone.png` });
  await ctx.close();
}

// ---- Phase 5: a proposed revision of a published area is marked and compared with what is published now
{
  const { ctx, p } = await open({ total: 3 });
  await p.evaluate(() => {
    const be = globalThis.__be, cur = be.pending[2];
    const sq = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
    be.pending[2] = { ...cur, name: 'Area 3 (bigger)', description: 'A new description', revision_no: 2, has_published: true, area_m2: 260000, geometry: { type: 'Polygon', coordinates: [sq(103.83, 1.3, 0.005)] },
      published: { revision_id: '00000000-0000-4000-8000-0000000000aa', revision_no: 1, name: 'Area 3', description: 'Description 3', draw_kind: 'polygon', geometry: cur.geometry, spots: cur.spots, area_m2: 190000 } };
  });
  await openAreas(p); await p.click('[data-act="admin-review"]');
  await p.waitForSelector(`${AP}:not([hidden]) .area-admin-item`);
  const cards = p.locator(`${AP} .area-admin-item`);
  ok(await cards.nth(2).locator('.area-admin-tag').count() === 1 && await cards.nth(0).locator('.area-admin-tag').count() === 0, 'only the revision card carries the "Proposed change" tag; initial submissions do not');
  ok((await cards.nth(2).locator('.area-item-meta').textContent()).includes('proposed change (revision 2) to a published area') && (await cards.nth(0).locator('.area-item-meta').textContent()).includes('revision 1 (new area)'), 'the meta line distinguishes a revision from a new area');
  await cards.nth(2).locator('[data-act="open"]').click();
  await p.waitForSelector(`${AP} .area-admin-detail`);
  ok(/proposed change to a published area/i.test(await p.locator(`${AP} .area-admin-revision`).textContent()), 'the review view says the published version stays public until approval');
  const figs = p.locator(`${AP} .area-admin-fig`);
  ok(await figs.count() === 2 && (await figs.nth(0).textContent()).includes('Published now (revision 1): Area 3') && (await figs.nth(1).textContent()).includes('Proposed (revision 2): Area 3 (bigger)') && await figs.locator('svg polygon').count() === 2, 'the published version and the proposal are shown side by side');
  const ch = await p.locator(`${AP} .area-admin-changes li`).allTextContents();
  ok(ch.some((x) => x.includes('→ “Area 3 (bigger)”')) && ch.some((x) => x === 'Description changed') && ch.some((x) => x.includes('Outline changed (+70,000 m²)')) && !ch.some((x) => x.includes('Setup spots')), 'a plain list says what changed: ' + ch.join(' | '));
  ok(/materially improves/.test(await p.locator(`${AP} .area-admin-approve`).textContent()), 'XP guidance for revisions is shown at the approve control');
  await p.click(`${AP} [data-act="approve"]`);
  ok(/replace the published version of .Area 3./.test(await p.locator(`${AP} .area-admin-confirm`).textContent()), 'the confirmation says it replaces the published version');
  await p.screenshot({ path: `${shots}/revision.png` });
  await p.click(`${AP} [data-act="cancel"]`);
  await p.click(`${AP} [data-act="back"]`);
  await cards.nth(0).locator('[data-act="open"]').click();
  await p.waitForSelector(`${AP} .area-admin-detail`);
  ok(await p.locator(`${AP} .area-admin-compare`).count() === 0 && await p.locator(`${AP} .area-admin-revision`).count() === 0, 'an initial submission has no comparison section');
  await ctx.close();
}

ok(!requests.some((r) => !/localhost:5173|data:|blob:/.test(r.url) && r.method !== 'GET'), 'no request left the browser');
ok(errs.length === 0, 'no page or console errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
