// Community flying areas, Stage 3: recovering the contributor's own submissions on a device with no local data, in a real browser. The real Supabase client talks to a mocked HTTP server
// whose functions run the real migrations on an in-memory Postgres (PGlite), as in areas-explorer.mjs. Signed-in contributor, another contributor, guest; confirmation before create and
// replace; no write call is ever made; edit-and-resubmit eligibility; layouts at 320 / 390 px. Emulated only: no real device. Screenshots: tests/out/areas-recover/.
import { chromium, CHANNEL, OUT, moreTool } from './lib.mjs';
import { makeDb, as, A, B, C } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const SHOTS = `${OUT}/areas-recover`; fs.mkdirSync(SHOTS, { recursive: true });
const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const URL_ = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
const REF = new URL(URL_).hostname.split('.')[0];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = (id, email) => { const exp = Math.floor(Date.now() / 1000) + 3600; return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp })}.sig`, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id, email, aud: 'authenticated' } }; };
const db = await makeDb();
let lock = Promise.resolve();
const serial = (fn) => { const r = lock.then(fn, fn); lock = r.catch(() => {}); return r; };
const SETOF = new Set(['list_friends', 'list_blocked', 'list_sessions', 'list_public_sessions', 'list_my_session_invitations', 'list_my_session_notices', 'my_session_moderation', 'get_public_session', 'list_my_community_areas']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let calls = [];
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({}, 200);
  const fn = m[1], args = req.postData() ? JSON.parse(req.postData()) : {}, names = Object.keys(args);
  calls.push(fn);
  const q = SETOF.has(fn) ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t` : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
  try { const rows = await serial(() => as(db, uid, q, names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])))); return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j); }
  catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};
const WHO = { b: [B, 'b@example.test'], c: [C, 'c@example.test'] };
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await as(db, u, 'select public.ensure_profile($1) as r', [n]);
await db.query(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);

let keyN = 0;
const sq = (x, y, d = 0.004) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const body = (name, x, y, d, spots = 1, description = 'Open grass') => ({ idempotency_key: 'rcb-' + String(++keyN).padStart(12, '0'), name, description, draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq(x, y, d))] }, spots: Array.from({ length: spots }, (_, i) => ({ type: 'shelter', note: '', coordinates: [x + 0.001 + i * 0.0005, y + 0.001] })), attributes: { environment: 'park', access: 'public', hazards: ['water'], observed_on: '2026-11-01' } });
const sub = (uid, p) => as(db, uid, 'select public.submit_community_area($1::jsonb) as r', [JSON.stringify(p)]).then((r) => r[0].r);
const rev = (uid, areaId, p) => as(db, uid, 'select public.submit_community_revision($1, $2::jsonb) as r', [areaId, JSON.stringify(p)]).then((r) => r[0].r);
const review = (rid, d, why = null) => as(db, A, 'select public.review_community_area($1, $2, $3, $4, $5) as r', [rid, d, why, false, null]);
const marina = await sub(B, body('Marina Lawn', 103.8, 1.3, 0.004, 2)); await review(marina.revision_id, 'approve');
const marinaV2 = await rev(B, marina.area_id, body('Marina Lawn v2', 103.8, 1.3, 0.005, 2));
const kallang = await sub(B, body('Kallang Field', 103.87, 1.31, 0.004, 0)); await review(kallang.revision_id, 'reject', 'Outline crosses a road');
const pend = await sub(B, body('Pending Lot', 103.9, 1.35, 0.004, 1));
const camArea = await sub(C, body('Cam Secret Lot', 103.95, 1.4, 0.004, 1)); await review(camArea.revision_id, 'approve');

const b = await chromium.launch({ channel: CHANNEL });
async function open(who, { vp = { width: 1300, height: 850 }, touch = false, local = null } = {}) {
  const [uid, email] = WHO[who] ?? [null, null];
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, loc]) => {
    globalThis.__uavAreasExpose = true;
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.3, lon: 103.8, zoom: 13 }, basemap: 'osm', communityAreasOff: true }));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen: '9999' }));
    if (loc) localStorage.setItem('uavzones.v1.areas', JSON.stringify(loc));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, uid ? session(uid, email) : null, local]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]|zone data/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  if (await p.locator('#panel').isVisible().catch(() => false)) await p.click('#panel-close').catch(() => {});
  return { ctx, p };
}
const PANEL = '#areas-panel', DLG = 'dialog.area-recover-dialog';
const openPanel = async (p) => { if (await p.locator(PANEL).isHidden()) await moreTool(p, 'areas'); await p.waitForSelector(`${PANEL}:not([hidden])`); await p.waitForTimeout(500); };
const localAreas = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.areas') || '{"areas":[]}').areas);
const WRITES = /^(submit_community|withdraw_community|review_community|unpublish_community|update_profile|delete_profile)/;

// ======================================================= contributor B, empty device
let { ctx, p } = await open('b');
await openPanel(p);
ok(await p.locator(`${PANEL} [data-act=recover]`).count() === 1 && (await localAreas(p)).length === 0, 'a signed-in contributor with no local data sees "Recover my submitted areas"');
calls = [];
await p.click(`${PANEL} [data-act=recover]`); await p.waitForSelector(`${DLG} .area-recover-item`);
const names = await p.locator(`${DLG} .area-item-name`).allTextContents();
ok(names.length === 3 && names.includes('Marina Lawn v2') && names.includes('Kallang Field') && names.includes('Pending Lot') && !names.some((n) => /Cam Secret/.test(n)), `own areas only, one per area, named after the newest version (${names.join(', ')})`);
const txt = await p.locator(DLG).innerText();
ok(/Change pending review/.test(txt) && /Not approved/.test(txt) && /Reason: Outline crosses a road/.test(txt) && /published version is live/.test(txt), 'each state is explained in plain language, with the rejection reason');
ok(calls.every((c) => c === 'list_my_community_areas'), `opening the list reads only the account list (${[...new Set(calls)].join(', ')})`);
await p.screenshot({ path: `${SHOTS}/desktop-list.png` });
// create: asks first, nothing changes on cancel
const marinaRow = p.locator(`${DLG} .area-recover-item`, { hasText: 'Marina Lawn v2' });
await marinaRow.locator('[data-act=create]').click();
ok(/Nothing is sent/.test(await marinaRow.innerText()) && (await localAreas(p)).length === 0, 'Create editable copy asks for confirmation first and says nothing is sent');
await marinaRow.locator('[data-act=cancel-recover]').click();
ok((await localAreas(p)).length === 0 && await marinaRow.locator('[data-act=create]').count() === 1, 'Cancel creates nothing');
calls = [];
await marinaRow.locator('[data-act=create]').click(); await marinaRow.locator('[data-act=confirm-create]').click(); await p.waitForTimeout(900);
const loc1 = await localAreas(p);
ok(loc1.length === 1 && loc1[0].name === 'Marina Lawn v2' && loc1[0].spots.length === 2 && loc1[0].submission.areaId === marina.area_id && loc1[0].submission.revisionId === marinaV2.revision_id && loc1[0].submission.status === 'pending' && loc1[0].submission.revision === true && loc1[0].attributes?.access === 'public' && loc1[0].attributes.hazards.join() === 'water' && loc1[0].attributes.observed_on === '2026-11-01', 'a private local draft linked to the newest revision (the pending change) is created, with its site details');
ok(calls.every((c) => !WRITES.test(c)) && calls.some((c) => c === 'get_my_community_revision'), `only reads were made (${[...new Set(calls)].join(', ')})`);
ok(await p.locator(`${DLG} .area-recover-item`, { hasText: 'Marina Lawn v2' }).locator('[data-act=replace]').count() === 1 && await p.locator(`${DLG} .area-recover-item`, { hasText: 'Marina Lawn v2' }).locator('[data-act=create]').count() === 0, 'the row now says it is on this device and offers Replace instead of a second copy');
// replace: warns about local edits
await p.evaluate(() => { const raw = JSON.parse(localStorage.getItem('uavzones.v1.areas')); raw.areas[0].name = 'Edited on this device'; localStorage.setItem('uavzones.v1.areas', JSON.stringify(raw)); });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
await p.locator('#name-dlg-skip').click({ timeout: 1500 }).catch(() => {});
await openPanel(p);
ok(await p.locator(`${PANEL} .area-item-name`, { hasText: 'Edited on this device' }).count() === 1, 'the local copy shows in My flying areas (with the edit made on this device)');
await p.click(`${PANEL} [data-act=recover]`); await p.waitForSelector(`${DLG} .area-recover-item`);
const mr = p.locator(`${DLG} .area-recover-item`, { hasText: 'Marina Lawn v2' });
await mr.locator('[data-act=replace]').click();
ok(/Replace your local copy/.test(await mr.innerText()) && /will be lost/.test(await mr.innerText()), 'Replace warns that local changes will be lost');
await mr.locator('[data-act=cancel-recover]').click();
ok((await localAreas(p))[0].name === 'Edited on this device', 'Cancel keeps the local edit');
await mr.locator('[data-act=replace]').click(); await mr.locator('[data-act=confirm-replace]').click(); await p.waitForTimeout(900);
const loc2 = await localAreas(p);
ok(loc2.length === 1 && loc2[0].name === 'Marina Lawn v2' && loc2[0].id === loc1[0].id, 'confirmed Replace restores the server version into the same record (still one)');
// a rejected one and a pending first submission
for (const n of ['Kallang Field', 'Pending Lot']) { const r = p.locator(`${DLG} .area-recover-item`, { hasText: n }); await r.locator('[data-act=create]').click(); await r.locator('[data-act=confirm-create]').click(); await p.waitForTimeout(700); }
const loc3 = await localAreas(p);
const kal = loc3.find((a) => a.name === 'Kallang Field'), pen = loc3.find((a) => a.name === 'Pending Lot');
ok(loc3.length === 3 && kal.submission.status === 'rejected' && kal.submission.reason === 'Outline crosses a road' && pen.submission.status === 'pending' && !pen.submission.revision, 'a rejected and a pending submission are recovered with their state');
await p.screenshot({ path: `${SHOTS}/desktop-after.png` });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.screenshot({ path: `${SHOTS}/desktop-panel.png` });
ok(await p.locator(`${PANEL} .area-item`, { hasText: 'Kallang Field' }).locator('[data-act=submit]').count() === 1, 'the recovered rejected area can be resubmitted (it is a normal local draft)');
ok(await p.locator(`${PANEL} .area-item`, { hasText: 'Pending Lot' }).locator('[data-act=withdraw]').count() === 1, 'the recovered pending area can be withdrawn');
ok(!calls.some((c) => WRITES.test(c)), 'no write function was called at any point');
await ctx.close();

// ======================================================= edit-and-resubmit eligibility for a recovered approved area (revision 1 approved, no pending change)
const okArea = await sub(C, body('Cam Park', 104.0, 1.2, 0.004, 1)); await review(okArea.revision_id, 'approve');
({ ctx, p } = await open('c'));
await openPanel(p); await p.click(`${PANEL} [data-act=recover]`); await p.waitForSelector(`${DLG} .area-recover-item`);
const cn = await p.locator(`${DLG} .area-item-name`).allTextContents();
ok(cn.length === 2 && cn.includes('Cam Park') && cn.includes('Cam Secret Lot') && !cn.some((n) => /Marina|Kallang|Pending/.test(n)), "another contributor sees only their own areas (never B's)");
const cr = p.locator(`${DLG} .area-recover-item`, { hasText: 'Cam Park' }); await cr.locator('[data-act=create]').click(); await cr.locator('[data-act=confirm-create]').click(); await p.waitForTimeout(800);
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const row = p.locator(`${PANEL} .area-item`, { hasText: 'Cam Park' });
ok(await row.locator('[data-act=submit]').count() === 0 && /Approved/.test(await row.innerText()), 'an unedited recovered approved area has nothing to submit');
await p.evaluate(() => { const raw = JSON.parse(localStorage.getItem('uavzones.v1.areas')); raw.areas[0].name = 'Cam Park (edited)'; localStorage.setItem('uavzones.v1.areas', JSON.stringify(raw)); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200); await p.locator('#name-dlg-skip').click({ timeout: 1500 }).catch(() => {});
await openPanel(p);
ok(await p.locator(`${PANEL} .area-item`, { hasText: 'Cam Park (edited)' }).locator('[data-act=submit]').count() === 1 && /Submit changes/.test(await p.locator(`${PANEL} .area-item [data-act=submit]`).first().innerText()), 'after an edit the recovered approved area offers "Submit changes" (a revision), as a normally approved one does');
await ctx.close();

// ======================================================= guest and layouts
({ ctx, p } = await open('guest'));
await openPanel(p); calls = [];
await p.click(`${PANEL} [data-act=recover]`); await p.waitForTimeout(700);
ok(await p.locator(DLG).count() === 0 && calls.every((c) => !/community/.test(c)), 'a guest is asked to sign in; nothing about areas is requested');
await ctx.close();
for (const [w, h] of [[320, 640], [390, 780]]) {
  ({ ctx, p } = await open('b', { vp: { width: w, height: h }, touch: true }));
  await openPanel(p); await p.click(`${PANEL} [data-act=recover]`); await p.waitForSelector(`${DLG} .area-recover-item`); await p.waitForTimeout(300);
  const r0 = p.locator(`${DLG} .area-recover-item`).first(); await r0.locator('[data-act=create]').click(); await p.waitForTimeout(200);
  const m = await p.evaluate(() => { const d = document.querySelector('dialog.area-recover-dialog'), r = d.getBoundingClientRect(); return { doc: document.documentElement.scrollWidth - innerWidth, sw: d.scrollWidth - d.clientWidth, l: r.left, r: r.right, vw: innerWidth }; });
  ok(m.doc <= 0 && m.sw <= 0 && m.l >= 0 && m.r <= m.vw, `${w}px: the recovery dialog (with a confirmation open) has no overflow or clipping`);
  await p.screenshot({ path: `${SHOTS}/phone-${w}.png` });
  await ctx.close();
}
await b.close();
ok(errs.length === 0, 'no page errors: ' + errs.slice(0, 3).join(' | '));
