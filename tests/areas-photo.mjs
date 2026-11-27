// Community flying areas, optional location photo, in a real browser. The real Supabase client talks to a mocked HTTP server: the database functions run the real migrations on an in-memory Postgres
// (PGlite) and the three Edge Function handlers run for real against an in-memory PRIVATE object store. A contributor chooses, resizes and submits a photo (and keeps, replaces or removes it in a later
// revision); an administrator previews it, approves with or without it, and removes one urgently; a guest sees it in the details panel; revoked photos answer 404 on the very next request. Layouts at
// 320 / 390 px. Emulated only: no real device. Screenshots: tests/out/areas-photo/.
import { chromium, CHANNEL, OUT, moreTool } from './lib.mjs';
import { makeDb, as, A, B, C } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
import { handleUpload, handleView, handleCleanup } from '../supabase/functions/_shared/area-photo-handlers.js';
import { png } from './lib-photo.mjs';
import { contentHash } from '../src/areas/api.js';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const SHOTS = `${OUT}/areas-photo`; fs.mkdirSync(SHOTS, { recursive: true });
const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const URL_ = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
const REF = new URL(URL_).hostname.split('.')[0];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = (id, email) => { const exp = Math.floor(Date.now() / 1000) + 3600; return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp })}.sig`, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id, email, aud: 'authenticated' } }; };
const db = await makeDb();
let lock = Promise.resolve();
const serial = (fn) => { const r = lock.then(fn, fn); lock = r.catch(() => {}); return r; };
const svc = (sql, params = []) => serial(async () => { await db.exec('set role service_role'); try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); } });
const objects = new Map();
const fnDeps = {
  getUser: async (auth) => { try { const id = JSON.parse(Buffer.from(auth.replace(/^Bearer\s+/i, '').split('.')[1], 'base64url').toString()).sub; return id ? { id } : null; } catch { return null; } },
  rpc: async (fn, args) => { const names = Object.keys(args); return (await svc(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`, names.map((n) => args[n])))[0].r; },
  storage: { put: async (k, b) => { objects.set(k, Uint8Array.from(b)); }, get: async (k) => (objects.has(k) ? { bytes: objects.get(k) } : null), remove: async (ks) => { for (const k of ks) objects.delete(k); } },
  env: { cleanupSecret: 'x' },
};
const SETOF = new Set(['list_friends', 'list_blocked', 'list_sessions', 'list_public_sessions', 'list_my_session_invitations', 'list_my_session_notices', 'my_session_moderation', 'get_public_session', 'list_my_community_areas']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const fnLog = []; const calls = [];
async function runFn(route) {
  const req = route.request(), u = new URL(req.url()), name = u.pathname.split('/functions/v1/')[1];
  const headers = req.headers(); const body = req.postDataBuffer();
  fnLog.push({ name, method: req.method(), auth: !!headers.authorization, type: headers['content-type'], caption: headers['x-caption'], bytes: body?.length ?? 0 });
  const r = new Request(u.href, { method: req.method(), headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method()) ? undefined : body });
  const h = name.startsWith('area-photo-upload') ? handleUpload : name.startsWith('area-photo-cleanup') ? handleCleanup : handleView;
  const res = await h(r, fnDeps);
  const out = Buffer.from(await res.arrayBuffer());
  const hdrs = {}; res.headers.forEach((v, k) => { hdrs[k] = v; });
  return route.fulfill({ status: res.status, headers: { ...CORS, ...hdrs }, body: out });
}
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (u.pathname.includes('/functions/v1/')) return runFn(route);
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({}, 200);
  const fn = m[1], args = req.postData() ? JSON.parse(req.postData()) : {}, names = Object.keys(args);
  calls.push({ fn, args });
  const q = SETOF.has(fn) ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t` : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
  try { const rows = await serial(() => as(db, uid, q, names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])))); return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j); }
  catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};
const WHO = { a: [A, 'a@example.test'], b: [B, 'b@example.test'], c: [C, 'c@example.test'] };
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await as(db, u, 'select public.ensure_profile($1) as r', [n]);
await db.query(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);

let keyN = 0;
const sq = (x, y, d = 0.004) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const ATTR = { environment: 'park', access: 'public' };
const local = (id, name, x, y, extra = {}) => ({ id, name, description: '', drawKind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq(x, y))] }, spots: [], attributes: ATTR, created: '2026-11-01T00:00:00.000Z', updated: '2026-11-01T00:00:00.000Z', ...extra });
const srv = (uid, name, x, y, photo) => as(db, uid, 'select public.submit_community_area($1::jsonb) as r', [JSON.stringify({ idempotency_key: 'phb-' + String(++keyN).padStart(12, '0'), name, description: '', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq(x, y))] }, spots: [], attributes: ATTR, ...(photo ? { photo_id: photo } : {}) })]).then((r) => r[0].r);
const approve = (rid, drop = null) => as(db, A, 'select public.review_community_area($1, $2, $3, $4, $5, $6, $7) as r', [rid, 'approve', drop, false, null, false, !!drop]);
const stageDirect = async (owner, bytes, mime, caption) => { const r = await handleUpload(new Request('https://x.test/u', { method: 'POST', headers: { authorization: 'Bearer ' + session(owner, 'x').access_token, 'content-type': mime, 'x-caption': encodeURIComponent(caption) }, body: bytes }), fnDeps); return (await r.json()).photo_id; };
const IMG = png(800, 600); // a real, decodable, metadata-free PNG (the pixels are black)
// pre-existing public areas: one with a captioned photo, one with a photo and no caption
const ph1 = await stageDirect(C, IMG, 'image/png', 'Pavilion with picnic tables');
const pubA = await srv(C, 'Captioned Park', 103.85, 1.32, ph1); await approve(pubA.revision_id);
const ph2 = await stageDirect(C, IMG, 'image/png', '');
const pubB = await srv(C, 'Uncaptioned Park', 103.86, 1.33, ph2); await approve(pubB.revision_id);

const b = await chromium.launch({ channel: CHANNEL });
async function open(who, { vp = { width: 1300, height: 850 }, touch = false, areas = null } = {}) {
  const [uid, email] = WHO[who] ?? [null, null];
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, loc]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.3, lon: 103.8, zoom: 15 }, basemap: 'osm', communityAreasOff: true }));
    localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen: '9999' }));
    if (loc) localStorage.setItem('uavzones.v1.areas', JSON.stringify({ v: 1, areas: loc }));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, uid ? session(uid, email) : null, areas]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of [45]|zone data/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  if (await p.locator('#panel').isVisible().catch(() => false)) await p.click('#panel-close').catch(() => {});
  return { ctx, p };
}
const PANEL = '#areas-panel', ADM = '#areas-admin-panel', SUBD = 'dialog.area-submit-dialog';
const openPanel = async (p) => { if (await p.locator(PANEL).isHidden()) await moreTool(p, 'areas'); await p.waitForSelector(`${PANEL}:not([hidden])`); await p.waitForTimeout(400); };
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.areas') || '{"areas":[]}').areas);
const choose = async (p, name, mimeType, buffer) => { await p.setInputFiles('#area-photo-file', { name, mimeType, buffer: Buffer.from(buffer) }); await p.waitForTimeout(500); };
const BIG = png(3000, 2000); // 3000 x 2000 original, to be resized to 1600 px
const photoRow = async (name) => (await db.query(`select p.* from public.community_area_photos p join public.community_area_revisions r on r.id = p.revision_id where r.name = $1 order by p.created_at desc limit 1`, [name])).rows[0];

// ======================================================= contributor: choose, validate, submit
let { ctx, p } = await open('b', { areas: [local('aNew1', 'Lakeside Lawn', 103.8, 1.3)] });
await openPanel(p); fnLog.length = 0;
await p.locator(`${PANEL} [data-act=submit]`).first().click(); await p.waitForSelector(SUBD);
ok(await p.locator(`${SUBD} .area-photo`).count() === 1 && /Photo \(optional\)/.test(await p.locator(`${SUBD} .area-photo legend`).innerText()) && /faces, vehicle number plates/.test(await p.locator(`${SUBD} .area-photo`).innerText()), 'the submit dialog has an optional Photo section with the privacy warning');
await choose(p, 'a.gif', 'image/gif', Buffer.from('GIF89a'));
ok(/Only JPEG, PNG and WebP/.test(await p.locator(`${SUBD} .area-photo-msg`).innerText()), 'a GIF is refused in the browser with a plain message');
await choose(p, 'huge.jpg', 'image/jpeg', Buffer.alloc(5 * 1024 * 1024 + 10));
ok(/larger than 5 MB/.test(await p.locator(`${SUBD} .area-photo-msg`).innerText()), 'an original over 5 MB is refused');
await choose(p, 'junk.png', 'image/png', Buffer.from('not an image at all'));
ok(/could not be read/.test(await p.locator(`${SUBD} .area-photo-msg`).innerText()), 'an unreadable file is refused');
await choose(p, 'small.png', 'image/png', png(150, 150));
ok(/too small/.test(await p.locator(`${SUBD} .area-photo-msg`).innerText()), 'a photo under 200 px is refused');
await p.locator('#area-ack').check();
ok(fnLog.length === 0, 'nothing was uploaded while choosing');
await choose(p, 'big.png', 'image/png', BIG); await p.waitForSelector(`${SUBD} .area-photo-preview:not([hidden])`);
ok(/Ready: 1600 × 1067 px/.test(await p.locator(`${SUBD} .area-photo-msg`).innerText()) && /It is uploaded only when you press Submit/.test(await p.locator(`${SUBD} .area-photo-msg`).innerText()), 'a 3000 x 2000 original is resized to 1600 px on the device, and the dialog says it is uploaded only on Submit');
ok(fnLog.length === 0, 'still nothing uploaded after the preview');
await p.fill('#area-photo-caption', 'Open lawn beside the lake');
await p.screenshot({ path: `${SHOTS}/desktop-submit-dialog.png` });
await p.click(`${SUBD} [data-act=confirm-submit]`); await p.waitForTimeout(1500);
const up = fnLog.find((f) => f.name === 'area-photo-upload');
ok(up && up.auth && up.type === 'image/jpeg' && decodeURIComponent(up.caption) === 'Open lawn beside the lake' && up.bytes > 1000 && up.bytes < 1000000, `one upload with the person's session: a JPEG of ${up?.bytes} bytes (under 1 MB), with the caption`);
const sent = calls.filter((c) => c.fn === 'submit_community_area').at(-1)?.args.p_payload;
ok(/^[0-9a-f-]{36}$/.test(sent?.photo_id ?? '') && !('keep_photo' in sent) && (await stored(p))[0].submission?.status === 'pending', 'the submission carries the staged photo id and is pending');
const lakeRow = await photoRow('Lakeside Lawn');
ok(lakeRow.state === 'attached' && lakeRow.caption === 'Open lawn beside the lake' && lakeRow.width === 1600 && lakeRow.height === 1067 && objects.has(lakeRow.object_key) && !lakeRow.object_key.includes(B), 'the photo is attached to the revision in the private store under a random key');
await ctx.close();

// ======================================================= administrator: preview, approve without the photo
({ ctx, p } = await open('a'));
await openPanel(p); await p.click(`${PANEL} [data-act=admin-review]`); await p.waitForSelector(`${ADM} .area-admin-item`);
await p.locator(`${ADM} .area-admin-item`, { hasText: 'Lakeside Lawn' }).locator('[data-act=open]').click(); await p.waitForSelector(`${ADM} .area-admin-detail`);
await p.waitForFunction(() => document.querySelector('#areas-admin-panel .area-admin-photo img'), null, { timeout: 8000 });
const adminImg = await p.locator(`${ADM} .area-admin-photo img`).evaluate((i) => ({ w: i.naturalWidth, alt: i.alt, src: i.src.startsWith('blob:') }));
ok(adminImg.w === 1600 && adminImg.src && adminImg.alt === 'Open lawn beside the lake' && /Check it for faces/.test(await p.locator(`${ADM} .area-admin-photo`).innerText()), 'the administrator previews the photo (read with their own session, shown from a blob URL) with a checklist');
await p.screenshot({ path: `${SHOTS}/admin-review.png` });
ok(await p.locator('#area-drop-photo').count() === 1 && await p.locator('#area-drop-why').isHidden(), 'the review offers "Approve the area without its photo" with its reason hidden until ticked');
await p.locator('#area-award').uncheck();
await p.locator('#area-drop-photo').check(); await p.click(`${ADM} [data-act=approve]`);
ok(/Give the reason the photo is left out/.test(await p.locator('#toast').innerText()) && await p.locator(`${ADM} .area-admin-confirm`).count() === 0, 'approving without the photo needs a reason');
await p.fill('#area-drop-why', 'Faces are visible'); await p.click(`${ADM} [data-act=approve]`); await p.waitForSelector(`${ADM} .area-admin-confirm`);
ok(/will NOT be published/.test(await p.locator(`${ADM} .area-admin-dropphoto`).innerText()) && /Approved without the photo: Faces are visible/.test(await p.locator(`${ADM} .area-admin-dropphoto`).innerText()), 'the confirmation says exactly what the contributor will read');
await p.click(`${ADM} [data-act=confirm]`); await p.waitForTimeout(1200);
const rv = calls.filter((c) => c.fn === 'review_community_area').at(-1).args;
ok(rv.p_drop_photo === true && rv.p_reason === 'Faces are visible', 'the decision sends the explicit drop flag and the reason');
const lake2 = await photoRow('Lakeside Lawn');
ok(lake2.state === 'rejected' && (await svc(`select public.area_photo_access($1, null) as r`, [lake2.id]))[0].r === null, 'the photo is never public; the area is');
await ctx.close();

// ======================================================= contributor: sees the decision
({ ctx, p } = await open('b', { areas: [{ ...(JSON.parse(JSON.stringify(local('aNew1', 'Lakeside Lawn', 103.8, 1.3)))), submission: { status: 'pending', key: null, contentHash: null, areaId: lakeRow.revision_id ? (await db.query('select area_id from public.community_area_revisions where id = $1', [lakeRow.revision_id])).rows[0].area_id : null, revisionId: lakeRow.revision_id, revisionNo: 1, submittedAt: '2026-11-28T00:00:00.000Z' } }] }));
await openPanel(p); await p.waitForTimeout(1200);
ok(/Approved without the photo: Faces are visible/.test(await p.locator(`${PANEL} .area-item-status`).innerText()), 'the contributor reads "Approved without the photo: <reason>" in their own list');
await ctx.close();

// ======================================================= guest: the public details panel
({ ctx, p } = await open('guest'));
const photoReqs = []; p.on('request', (r) => { if (/area-photo\?/.test(r.url())) photoReqs.push({ url: r.url(), auth: !!r.headers().authorization }); });
await moreTool(p, 'sessions'); await p.waitForSelector('#ses-hub[open]'); await p.click('#ses-hub .ses-tab[data-section=areas]'); await p.waitForSelector('#ses-hub .area-ex-row');
await p.locator('#ses-hub .area-ex-row', { hasText: /^Captioned Park/ }).locator('[data-act=show-area]').click(); await p.waitForSelector('#marker-host .area-photo-img', { timeout: 8000 });
await p.waitForFunction(() => document.querySelector('#marker-host .area-photo-img')?.complete && document.querySelector('#marker-host .area-photo-img').naturalWidth > 0);
const gi = await p.locator('#marker-host .area-photo-img').evaluate((i) => ({ w: i.naturalWidth, alt: i.alt, src: i.src, ref: i.referrerPolicy }));
ok(gi.w === 800 && gi.alt === 'Pavilion with picnic tables' && gi.src.includes('/functions/v1/area-photo?id=' + ph1) && !gi.src.includes('storage') && !gi.src.includes('staged') && gi.ref === 'no-referrer', 'a guest sees the photo, loaded by its id from the access-checking function (no storage address), alt text = the caption');
ok(/Pavilion with picnic tables/.test(await p.locator('#marker-host .area-photo-fig figcaption').innerText()) && photoReqs.every((r) => !r.auth), 'the caption is shown and the guest request carries no credentials');
await p.screenshot({ path: `${SHOTS}/public-details.png` });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await moreTool(p, 'sessions'); await p.waitForSelector('#ses-hub[open]'); await p.click('#ses-hub .ses-tab[data-section=areas]'); await p.waitForSelector('#ses-hub .area-ex-row');
await p.locator('#ses-hub .area-ex-row', { hasText: 'Uncaptioned Park' }).locator('[data-act=show-area]').click(); await p.waitForSelector('#marker-host .area-photo-img', { timeout: 8000 });
ok(/^Photo of Uncaptioned Park, added by a contributor \(no description given\)$/.test(await p.locator('#marker-host .area-photo-img').getAttribute('alt')) && await p.locator('#marker-host .area-photo-fig figcaption').count() === 0, 'without a caption the image has an accessible fallback description');
// revalidation: the very next request after a removal is 404
const url1 = gi.src;
const [resp] = await Promise.all([p.waitForResponse((r) => r.url() === url1), p.evaluate((u) => fetch(u).then((r) => r.status), url1)]);
const rh = resp.headers();
ok(resp.status() === 200 && rh['cache-control'] === 'no-cache' && rh['x-content-type-options'] === 'nosniff' && /sandbox/.test(rh['content-security-policy']) && !!rh.etag, 'the photo response is revalidated every time (no-cache), nosniff, sandboxed and carries an ETag');
await ctx.close();

// ======================================================= administrator: urgent removal of a published photo
({ ctx, p } = await open('a'));
await openPanel(p); await p.click(`${PANEL} [data-act=admin-review]`); await p.waitForSelector(`${ADM} [data-act=tab-published]`);
await p.click(`${ADM} [data-act=tab-published]`); await p.waitForSelector(`${ADM} .area-admin-item`);
await p.locator(`${ADM} .area-admin-item`, { hasText: /^Captioned Park/ }).locator('[data-act=open]').click(); await p.waitForSelector(`${ADM} .area-admin-detail`);
ok(await p.locator('#area-photo-remove-why').count() === 1, 'the Published view offers an urgent photo removal');
await p.click(`${ADM} [data-act=remove-photo]`); ok(/Give a reason/.test(await p.locator(`${ADM} .area-admin-reject .area-errors`).first().innerText()), 'a reason is required');
const key1 = (await db.query('select object_key from public.community_area_photos where id = $1', [ph1])).rows[0].object_key;
await p.fill('#area-photo-remove-why', 'Shows a number plate'); await p.click(`${ADM} [data-act=remove-photo]`); await p.waitForSelector(`${ADM} .area-admin-confirm`);
fnLog.length = 0;
await p.click(`${ADM} [data-act=confirm]`); await p.waitForTimeout(1500);
ok(/Photo removed\. It is no longer served and the file has been deleted/.test(await p.locator('#toast').innerText()) && !objects.has(key1) && fnLog.some((f) => f.name.startsWith('area-photo-cleanup') && f.auth), 'removal is immediate in the database and the file is purged at once through the admin-authenticated function');
const after = await p.evaluate(async (u) => (await fetch(u)).status, url1);
ok(after === 404, 'the very next request for the removed photo is 404');
ok((await db.query(`select count(*)::int c from public.audit_events where action = 'area.photo_remove'`)).rows[0].c === 1, 'the removal is audited');
await ctx.close();
({ ctx, p } = await open('guest'));
await moreTool(p, 'sessions'); await p.waitForSelector('#ses-hub[open]'); await p.click('#ses-hub .ses-tab[data-section=areas]'); await p.waitForSelector('#ses-hub .area-ex-row');
await p.locator('#ses-hub .area-ex-row', { hasText: /^Captioned Park/ }).locator('[data-act=show-area]').click(); await p.waitForSelector('#marker-host .area-pop'); await p.waitForTimeout(800);
ok(await p.locator('#marker-host .area-photo-fig').count() === 0 && /Captioned Park/.test(await p.locator('#marker-host').innerText()), 'the area stays public without its photo');
await ctx.close();

// ======================================================= revision: keep, replace, remove
const keepPhoto = await stageDirect(B, IMG, 'image/png', 'Kept photo');
const base = await srv(B, 'Keeper Park', 103.9, 1.34, keepPhoto); await approve(base.revision_id);
const baseArea = base.area_id;
const approvedSub = (orig, areaId, revisionId) => ({ status: 'approved', key: null, contentHash: contentHash(orig), areaId, revisionId, revisionNo: 1, submittedAt: '2026-11-28T00:00:00.000Z' }); // the hash of what was submitted: an edited copy then differs
const approvedLocal = (name, x) => ({ ...local('aKeep1', name, x, 1.34), submission: { status: 'approved', key: null, contentHash: contentHash(local('x', name, x, 1.34)), areaId: baseArea, revisionId: base.revision_id, revisionNo: 1, submittedAt: '2026-11-28T00:00:00.000Z' } });
const withHash = async (p0, name) => { // make the saved copy "changed": a new name
  await p0.evaluate(([n]) => { const raw = JSON.parse(localStorage.getItem('uavzones.v1.areas')); raw.areas[0].name = n; localStorage.setItem('uavzones.v1.areas', JSON.stringify(raw)); }, [name]);
};
({ ctx, p } = await open('b', { areas: [approvedLocal('Keeper Park', 103.9)] }));
await withHash(p, 'Keeper Park 2'); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200); await p.locator('#name-dlg-skip').click({ timeout: 1500 }).catch(() => {});
await openPanel(p); await p.locator(`${PANEL} [data-act=submit]`).first().click(); await p.waitForSelector(SUBD);
await p.waitForSelector(`${SUBD} .area-photo-modes input[value=keep]`, { timeout: 8000 });
ok(await p.locator(`${SUBD} .area-photo-modes input[value=keep]`).isChecked() && /Keep the current photo \(“Kept photo”\)/.test(await p.locator(`${SUBD} .area-photo-modes`).innerText()) && await p.locator(`${SUBD} .area-photo-modes input[value=none]`).count() === 1 && /Remove the photo/.test(await p.locator(`${SUBD} .area-photo-modes`).innerText()), 'a revision of an area with a photo offers Keep (the default), Replace and Remove');
await p.locator('#area-ack').check();
fnLog.length = 0; await p.click(`${SUBD} [data-act=confirm-submit]`); await p.waitForTimeout(1200);
ok(calls.filter((c) => c.fn === 'submit_community_revision').at(-1).args.p_payload.keep_photo === true && !fnLog.some((f) => f.name === 'area-photo-upload'), 'keeping sends keep_photo and uploads nothing');
const keepRev = (await db.query(`select p.* from public.community_area_photos p join public.community_area_revisions r on r.id = p.revision_id where r.name = 'Keeper Park 2'`)).rows[0];
ok(keepRev && keepRev.object_key === (await db.query('select object_key from public.community_area_photos where id = $1', [keepPhoto])).rows[0].object_key, 'the new revision uses the same stored object (no copy)');
await ctx.close();
// replace in a second area, remove in a third
const rpl = await stageDirect(B, IMG, 'image/png', 'Old'); const base2 = await srv(B, 'Swap Park', 103.91, 1.35, rpl); await approve(base2.revision_id);
({ ctx, p } = await open('b', { areas: [{ ...local('aSwap1', 'Swap Park 2', 103.91, 1.35), submission: approvedSub(local('x', 'Swap Park', 103.91, 1.35), base2.area_id, base2.revision_id) }] }));
await openPanel(p); await p.locator(`${PANEL} [data-act=submit]`).first().click(); await p.waitForSelector(SUBD); await p.waitForSelector(`${SUBD} .area-photo-modes input[value=keep]`, { timeout: 8000 });
await p.locator(`${SUBD} .area-photo-modes input[value=new]`).check(); await choose(p, 'new.png', 'image/png', png(900, 700)); await p.waitForSelector(`${SUBD} .area-photo-preview:not([hidden])`);
await p.locator('#area-ack').check(); await p.click(`${SUBD} [data-act=confirm-submit]`); await p.waitForTimeout(1500);
const swapPayload = calls.filter((c) => c.fn === 'submit_community_revision').at(-1).args.p_payload;
ok(/^[0-9a-f-]{36}$/.test(swapPayload.photo_id ?? '') && !('keep_photo' in swapPayload), 'replacing uploads the new photo and sends its id');
await ctx.close();
const rmv = await stageDirect(B, IMG, 'image/png', 'Bye'); const base3 = await srv(B, 'Drop Park', 103.92, 1.36, rmv); await approve(base3.revision_id);
({ ctx, p } = await open('b', { areas: [{ ...local('aDrop1', 'Drop Park 2', 103.92, 1.36), submission: approvedSub(local('x', 'Drop Park', 103.92, 1.36), base3.area_id, base3.revision_id) }] }));
await openPanel(p); await p.locator(`${PANEL} [data-act=submit]`).first().click(); await p.waitForSelector(SUBD); await p.waitForSelector(`${SUBD} .area-photo-modes input[value=none]`, { timeout: 8000 });
await p.locator(`${SUBD} .area-photo-modes input[value=none]`).check(); await p.locator('#area-ack').check(); await p.click(`${SUBD} [data-act=confirm-submit]`); await p.waitForTimeout(1200);
const dropPayload = calls.filter((c) => c.fn === 'submit_community_revision').at(-1).args.p_payload;
ok(!('photo_id' in dropPayload) && !('keep_photo' in dropPayload), 'choosing Remove sends neither (the new revision has no photo)');
await ctx.close();
// the photo state cannot be checked offline: submitting is blocked, never a silent removal
const base4 = await srv(B, 'Offline Park', 103.93, 1.37, await stageDirect(B, IMG, 'image/png', 'x')); await approve(base4.revision_id);
({ ctx, p } = await open('b', { areas: [{ ...local('aOff1', 'Offline Park 2', 103.93, 1.37), submission: approvedSub(local('x', 'Offline Park', 103.93, 1.37), base4.area_id, base4.revision_id) }] }));
await openPanel(p); await ctx.route(/get_my_area_photo/, (r) => r.abort());
await p.locator(`${PANEL} [data-act=submit]`).first().click(); await p.waitForSelector(SUBD); await p.waitForTimeout(1200); await p.locator('#area-ack').check();
ok(/Could not check the current photo/.test(await p.locator(`${SUBD} .area-photo-msg`).innerText()) && await p.locator(`${SUBD} [data-act=confirm-submit]`).isDisabled(), 'if the current photo cannot be checked, Submit stays disabled (a revision could otherwise remove it unseen)');
await ctx.close();

// ======================================================= layouts
for (const [w, h] of [[320, 640], [390, 780]]) {
  ({ ctx, p } = await open('b', { vp: { width: w, height: h }, touch: true, areas: [local('aPh', 'Phone Park', 103.95, 1.3)] }));
  await openPanel(p); await p.locator(`${PANEL} [data-act=submit]`).first().tap(); await p.waitForSelector(SUBD);
  await choose(p, 'p.png', 'image/png', png(1000, 800)); await p.waitForSelector(`${SUBD} .area-photo-preview:not([hidden])`);
  const m = await p.evaluate(() => { const d = document.querySelector('dialog.area-submit-dialog'), r = d.getBoundingClientRect(); const wide = [...d.querySelectorAll('img, input, textarea, button, fieldset')].filter((e) => e.getBoundingClientRect().right > d.getBoundingClientRect().right + 0.5); return { doc: document.documentElement.scrollWidth - innerWidth, sw: d.scrollWidth - d.clientWidth, l: r.left, r: r.right, vw: innerWidth, wide: wide.length }; });
  ok(m.doc <= 0 && m.sw <= 0 && m.l >= 0 && m.r <= m.vw && m.wide === 0, `${w}px: the submit dialog with a photo preview has no overflow or clipping`);
  await p.screenshot({ path: `${SHOTS}/phone-submit-${w}.png` });
  await ctx.close();
}
await b.close();
ok(errs.length === 0, 'no page errors: ' + errs.slice(0, 3).join(' | '));
