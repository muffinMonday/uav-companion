// Community flying areas, Stage 4: structured site attributes end to end in a real browser. The real Supabase client talks to a mocked HTTP server whose functions run the real migrations on an
// in-memory Postgres (PGlite): a contributor fills in Site details (required environment and access, exclusive hazards, observation date), submits; an administrator reviews the attributes and
// a later change; a guest sees them in the Explorer and the details panel; legacy areas without attributes read "not provided". Layouts at 320 / 390 px. Emulated only: no real device.
// Screenshots: tests/out/areas-attributes/.
import { chromium, CHANNEL, OUT, moreTool } from './lib.mjs';
import { makeDb, as, A, B, C } from './lib-db.mjs';
import { closeRing } from '../src/areas/core.js';
import { contentHash } from '../src/areas/api.js';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];
const SHOTS = `${OUT}/areas-attributes`; fs.mkdirSync(SHOTS, { recursive: true });
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
const last = {}; const calls = [];
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({}, 200);
  const fn = m[1], args = req.postData() ? JSON.parse(req.postData()) : {}, names = Object.keys(args);
  calls.push(fn); last[fn] = args;
  const q = SETOF.has(fn) ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t` : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
  try { const rows = await serial(() => as(db, uid, q, names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])))); return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j); }
  catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};
const WHO = { a: [A, 'a@example.test'], b: [B, 'b@example.test'] };
for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam']]) await as(db, u, 'select public.ensure_profile($1) as r', [n]);
await db.query(`insert into public.app_roles (user_id, role) values ('${A}', 'admin')`);

// a legacy approved area (no attributes), made the way old rows exist: attributes {} on an approved revision
let keyN = 0;
const sq = (x, y, d = 0.004) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
const legacy = (await as(db, C, 'select public.submit_community_area($1::jsonb) as r', [JSON.stringify({ idempotency_key: 'att-' + String(++keyN).padStart(12, '0'), name: 'Legacy Lawn', description: '', draw_kind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq(103.85, 1.32))] }, spots: [], attributes: { environment: 'unknown', access: 'unknown' } })]))[0].r;
await db.exec('alter table public.community_area_revisions disable trigger community_revision_immutable');
await db.query(`update public.community_area_revisions set attributes = '{}' where id = $1`, [legacy.revision_id]);
await db.exec('alter table public.community_area_revisions enable trigger community_revision_immutable');
await as(db, A, 'select public.review_community_area($1, $2, $3, $4, $5) as r', [legacy.revision_id, 'approve', null, false, null]);

const SEED = { v: 1, areas: [{ id: 'aSeed1', name: 'Seed Park', description: 'Open grass', drawKind: 'polygon', geometry: { type: 'Polygon', coordinates: [closeRing(sq(103.8, 1.3))] }, spots: [], created: '2026-11-01T00:00:00.000Z', updated: '2026-11-01T00:00:00.000Z' }] };
const b = await chromium.launch({ channel: CHANNEL });
async function open(who, { vp = { width: 1300, height: 850 }, touch = false, local = null } = {}) {
  const [uid, email] = WHO[who] ?? [null, null];
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, loc]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 1.3, lon: 103.8, zoom: 15 }, basemap: 'osm', communityAreasOff: true }));
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
const PANEL = '#areas-panel', BAR = '#area-bar', FORM = 'dialog.area-dialog', ADM = '#areas-admin-panel';
const openPanel = async (p) => { if (await p.locator(PANEL).isHidden()) await moreTool(p, 'areas'); await p.waitForSelector(`${PANEL}:not([hidden])`); await p.waitForTimeout(400); };
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.areas') || '{"areas":[]}').areas);
const openForm = async (p) => { await p.locator(`${PANEL} [data-act=edit]`).first().click(); await p.waitForSelector(BAR); await p.locator(`${BAR} [data-act=details]`).click(); await p.waitForSelector(`${FORM}[open]`); };

// ======================================================= contributor: the gate, the form, the submission
let { ctx, p } = await open('b', { local: SEED });
await openPanel(p);
calls.length = 0;
ok(/Needed before you can submit/.test(await p.locator(`${PANEL} .area-item-status.needs-attrs`).innerText()), 'an older draft without environment and access says in the list what is needed');
await p.locator(`${PANEL} [data-act=submit]`).first().click(); await p.waitForTimeout(500);
ok(await p.locator('dialog.area-submit-dialog').count() === 0 && /site environment/i.test(await p.locator('#toast').innerText()) && !calls.some((c) => /submit_community/.test(c)), 'Submit on an area without environment and access explains what is missing and sends nothing');
await p.locator(`${PANEL} [data-act=show]`).first().click(); await p.waitForSelector('#marker-host .area-pop'); await p.waitForTimeout(400);
const priv = await p.locator('#marker-host .area-site-view').innerText();
ok(/Site environment\s*\n?\s*Not provided/i.test(priv) && /Access \/ permission\s*\n?\s*Not provided/i.test(priv) && /Last observation date not provided/.test(priv) && /to be able to submit/.test(priv), 'the private details panel shows "Not provided" (never public) and says what is needed');
ok(await p.locator('#marker-host [data-site] [data-access=none].is-caution').count() === 1, 'a missing access status is marked as a caution, not shown as open');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await openPanel(p); await openForm(p);
ok(await p.locator(`${FORM} .area-site`).count() === 1 && /needed to submit/.test(await p.locator('label:has(#area-attr-environment)').innerText()) && /needed to submit/.test(await p.locator('label:has(#area-attr-access)').innerText()) && !/needed to submit/.test(await p.locator('label:has(#area-attr-surface)').innerText()), 'the form has Site details with environment and access marked as needed to submit, the rest optional');
ok(/does not mean the public may enter/i.test(await p.locator(`${FORM} .area-site`).innerText()) && /not an authorisation/i.test(await p.locator(`${FORM} .area-site`).innerText()), 'the form says a mapped place is not permission and the details are unverified observations');
ok(await p.locator('#area-attr-observed').getAttribute('max') === new Date().toISOString().slice(0, 10) && await p.locator('#area-attr-observed').getAttribute('min') === '2000-01-01' && await p.locator('#area-attr-observed').inputValue() === '', 'the date field is empty by default and limited to 2000 until today');
await p.screenshot({ path: `${SHOTS}/desktop-form.png` });
// save without environment/access is still allowed (a draft)
await p.locator('#area-attr-environment').selectOption('park');
await p.locator('#area-attr-access').selectOption('permission');
for (const v of ['fpv', 'cinematic']) await p.locator(`${FORM} fieldset[data-attr=activities] input[value=${v}]`).check();
const haz = (v) => p.locator(`${FORM} fieldset[data-attr=hazards] input[value=${v}]`);
await haz('people').check(); await haz('none_reported').check();
ok(!(await haz('people').isChecked()) && await haz('none_reported').isChecked(), '"None reported" clears the other hazards');
await haz('roads').check();
ok(!(await haz('none_reported').isChecked()) && await haz('roads').isChecked(), 'choosing a hazard clears "None reported"');
await haz('unknown').check(); ok(!(await haz('roads').isChecked()), '"Unknown" also stands alone');
await haz('roads').check(); await haz('people').check();
await p.locator('#area-attr-observed').fill('2026-11-01');
await p.click(`${FORM} [data-act=save]`); await p.waitForSelector(FORM, { state: 'detached' });
const s1 = (await stored(p))[0];
ok(s1.attributes.environment === 'park' && s1.attributes.access === 'permission' && s1.attributes.activities.join() === 'fpv,cinematic' && s1.attributes.hazards.join() === 'people,roads' && s1.attributes.observed_on === '2026-11-01' && !('surface' in s1.attributes), 'the saved draft keeps what was chosen, in canonical order; surface stays unset (unknown stays unknown)');
await p.waitForTimeout(400); await openPanel(p);
calls.length = 0;
await p.locator(`${PANEL} [data-act=submit]`).first().click(); await p.waitForSelector('dialog.area-submit-dialog');
await p.check('#area-ack'); await p.click('dialog.area-submit-dialog [data-act=confirm-submit]'); await p.waitForTimeout(1200);
const sent = last.submit_community_area?.p_payload;
ok(sent?.attributes?.environment === 'park' && sent.attributes.access === 'permission' && sent.attributes.observed_on === '2026-11-01' && !('owner_id' in sent), 'the submission carries the attributes (and nothing about the person)');
ok((await stored(p))[0].submission?.status === 'pending', 'the area is pending review');
await ctx.close();

// ======================================================= administrator: sees the attributes, approves
({ ctx, p } = await open('a'));
await openPanel(p); await p.click(`${PANEL} [data-act=admin-review]`); await p.waitForSelector(`${ADM} .area-admin-item`);
await p.locator(`${ADM} .area-admin-item`, { hasText: 'Seed Park' }).locator('[data-act=open]').click(); await p.waitForSelector(`${ADM} .area-admin-detail`);
const at = await p.locator(`${ADM} .area-admin-attrs`).innerText();
ok(/Site environment: Park \/ recreation area/.test(at) && /Access \/ permission: Permission required/.test(at) && /Suitable activities: FPV freestyle, Cinematic/.test(at) && /Known hazards: People \/ crowds, Roads \/ traffic/.test(at) && /Last observed: 2026-11-01/.test(at) && /Ground \/ launch surface: not provided/.test(at), 'the review screen lists every attribute; unset ones read "not provided"');
await p.screenshot({ path: `${SHOTS}/admin-review.png` });
await p.locator('#area-award').uncheck(); await p.click(`${ADM} [data-act=approve]`); await p.click(`${ADM} [data-act=confirm]`); await p.waitForTimeout(900);
ok((await as(db, null, 'select public.get_public_area($1) as r', [last.review_community_area ? (await db.query(`select area_id from public.community_area_revisions where name = 'Seed Park'`)).rows[0].area_id : null]))[0].r?.attributes?.access === 'permission', 'approval published the attributes with the revision');
await ctx.close();

// ======================================================= guest: Explorer rows and the public details panel
({ ctx, p } = await open('guest'));
await moreTool(p, 'sessions'); await p.waitForSelector('#ses-hub[open]'); await p.click('#ses-hub .ses-tab[data-section=areas]'); await p.waitForSelector('#ses-hub .area-ex-row'); await p.waitForTimeout(300);
const seedRow = p.locator('#ses-hub .area-ex-row', { hasText: 'Seed Park' }), legRow = p.locator('#ses-hub .area-ex-row', { hasText: 'Legacy Lawn' });
ok(await seedRow.locator('.area-ex-attrs li').count() === 2 && /Park \/ recreation area/.test(await seedRow.innerText()) && await seedRow.locator('li[data-access=permission].is-caution').count() === 1, 'the Explorer row shows environment and access, access other than public marked as a caution');
ok(await legRow.locator('.area-ex-attrs').count() === 0 && !/public/i.test(await legRow.innerText()), 'a legacy area shows no attribute tags and is not implied to be public');
await p.screenshot({ path: `${SHOTS}/explorer.png` });
await seedRow.locator('[data-act=show-area]').click(); await p.waitForSelector('#marker-host .area-pop', { timeout: 8000 }); await p.waitForTimeout(500);
const pub = p.locator('#marker-host .area-site-view');
const pt = await pub.innerText();
ok(/Park \/ recreation area/.test(pt) && /Permission required/.test(pt) && /Do not assume you may enter/.test(pt) && await pub.locator('[data-access=permission].is-caution').count() === 1, 'the public details show environment and access prominently; permission required is a caution with plain words');
ok(/FPV freestyle/.test(pt) && /Cinematic/.test(pt) && /community tags, not a safety rating/.test(pt) && /People \/ crowds/.test(pt) && /contributor observations/.test(pt), 'activities and hazards are secondary tags, labelled as observations, not a rating');
ok(/Last observed 1 Nov 2026/.test(await p.locator('#marker-host .area-meta').innerText()) && !/Last observation date not provided/.test(pt), 'the observation date is shown, and the approval date is not used instead');
ok(!/safe to fly|legal|allowed to fly/i.test(await p.locator('#marker-host').innerText().then((t) => t.replace(/not flight authorization/gi, ''))), 'nothing says safe, legal or allowed');
await p.screenshot({ path: `${SHOTS}/public-details.png` });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await moreTool(p, 'sessions'); await p.waitForSelector('#ses-hub[open]'); await p.click('#ses-hub .ses-tab[data-section=areas]'); await p.waitForSelector('#ses-hub .area-ex-row');
await p.locator('#ses-hub .area-ex-row', { hasText: 'Legacy Lawn' }).locator('[data-act=show-area]').click(); await p.waitForSelector('#marker-host .area-pop', { timeout: 8000 }); await p.waitForTimeout(500);
const lt = await p.locator('#marker-host .area-site-view').innerText();
ok(/Site environment\s*\n?\s*Not provided/i.test(lt) && /Access \/ permission\s*\n?\s*Not provided/i.test(lt) && /Last observation date not provided/.test(lt) && await p.locator('#marker-host [data-access=none].is-caution').count() === 1, 'a legacy area reads "Not provided" and "Last observation date not provided", access marked as a caution');
await ctx.close();

// ======================================================= a later change of one attribute is a revision the administrator can see
const seedArea = (await db.query(`select area_id from public.community_area_revisions where name = 'Seed Park'`)).rows[0].area_id;
const local2 = { v: 1, areas: [{ ...s1, id: 'aSeed1', submission: { status: 'approved', key: null, contentHash: contentHash(s1), areaId: seedArea, revisionId: (await db.query(`select id from public.community_area_revisions where name = 'Seed Park'`)).rows[0].id, revisionNo: 1, submittedAt: '2026-11-27T00:00:00.000Z' } }] };
({ ctx, p } = await open('b', { local: local2 }));
await openPanel(p); await openForm(p);
await p.locator('#area-attr-access').selectOption('public'); await p.click(`${FORM} [data-act=save]`); await p.waitForSelector(FORM, { state: 'detached' }); await p.waitForTimeout(500); await openPanel(p);
ok(/Submit changes/.test(await p.locator(`${PANEL} [data-act=submit]`).first().innerText()), 'changing only an attribute of an approved area offers "Submit changes"');
await p.locator(`${PANEL} [data-act=submit]`).first().click(); await p.waitForSelector('dialog.area-submit-dialog'); await p.check('#area-ack'); await p.click('dialog.area-submit-dialog [data-act=confirm-submit]'); await p.waitForTimeout(1200);
ok((await stored(p))[0].submission?.status === 'pending' && last.submit_community_revision?.p_payload?.attributes?.access === 'public', 'the change is sent as a revision');
await ctx.close();
({ ctx, p } = await open('a'));
await openPanel(p); await p.click(`${PANEL} [data-act=admin-review]`); await p.waitForSelector(`${ADM} .area-admin-item`);
await p.locator(`${ADM} .area-admin-item`, { hasText: 'Seed Park' }).locator('[data-act=open]').click(); await p.waitForSelector(`${ADM} .area-admin-detail`);
const chg = await p.locator(`${ADM} .area-admin-changes`).innerText();
ok(/Access \/ permission: Permission required → Public access/.test(chg) && !/Site environment/.test(chg), `the comparison lists the one attribute that changed (${chg.replace(/\n/g, ' | ')})`);
await ctx.close();

// ======================================================= layouts
for (const [w, h] of [[320, 640], [390, 780]]) {
  ({ ctx, p } = await open('b', { vp: { width: w, height: h }, touch: true, local: SEED }));
  await openPanel(p);
  await p.locator(`${PANEL} [data-act=edit]`).first().click(); await p.waitForSelector(BAR); await p.locator(`${BAR} [data-act=details]`).click(); await p.waitForSelector(`${FORM}[open]`); await p.waitForTimeout(300);
  await p.locator('#area-attr-observed').scrollIntoViewIfNeeded();
  const m = await p.evaluate(() => { const d = document.querySelector('dialog.area-dialog'), r = d.getBoundingClientRect(); const wide = [...d.querySelectorAll('select, input[type=date], input[type=text], textarea')].filter((e) => e.getBoundingClientRect().right > d.getBoundingClientRect().right + 0.5); return { doc: document.documentElement.scrollWidth - innerWidth, sw: d.scrollWidth - d.clientWidth, l: r.left, r: r.right, vw: innerWidth, wide: wide.length }; });
  ok(m.doc <= 0 && m.sw <= 0 && m.l >= 0 && m.r <= m.vw && m.wide === 0, `${w}px: the form with Site details has no overflow or clipping`);
  const box = await p.locator(`${FORM} fieldset[data-attr=hazards] label`).first().boundingBox();
  ok(box.height >= 32, `${w}px: checkbox rows are at least 32 px tall (${Math.round(box.height)})`);
  await p.screenshot({ path: `${SHOTS}/phone-form-${w}.png` });
  await ctx.close();
}
await b.close();
ok(errs.length === 0, 'no page errors: ' + errs.slice(0, 3).join(' | '));
