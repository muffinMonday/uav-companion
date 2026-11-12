// The optional cloud copy in the browser: the real Supabase client talks to a mocked HTTP server backed by the in-memory cloud of the engine tests.
// Covers sign-in form when signed out, first upload, the status lines, the question when both sides changed (with the backup download), sign-out.
import { chromium, CHANNEL } from './lib.mjs';
import { makeCloud } from './lib-sync.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const URL_ = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
const REF = new URL(URL_).hostname.split('.')[0];
const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'tester@example.test', aud: 'authenticated', role: 'authenticated' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const session = () => ({ access_token: jwt(), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });

const cloud = makeCloud();
const server = cloud.adapter({ email: USER.email });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const hits = [];
const mock = async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  hits.push(req.method() + ' ' + u.pathname);
  const json = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) { const r = await server.fetch(); return json(r ? [{ ...r }] : []); }
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (m?.[1] === 'save_user_data') { const a = JSON.parse(req.postData()); return json(await server.save(a.p_doc, a.p_base_rev, a.p_device, a.p_force)); }
  if (m?.[1] === 'list_user_data_versions') return json(await server.listVersions());
  if (m?.[1] === 'delete_user_data') { await server.remove(); return json(null); }
  if (u.pathname.includes('/auth/v1/otp')) return json({});
  return json({ message: 'not mocked: ' + u.pathname }, 404);
};

const mk = (name, lat) => ({ id: 'm-' + name, type: 'photo', name, note: '', lat, lon: 114.3, created: '2026-11-01T00:00:00.000Z' });
const b = await chromium.launch({ channel: CHANNEL });
async function open({ signedIn, items = [], sync = null }) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mock);
  await ctx.addInitScript(([ref, sess, po, sy]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.pois', JSON.stringify({ v: 1, items: po }));
    if (sy) localStorage.setItem('uavzones.v1.sync', JSON.stringify(sy));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, signedIn ? session() : null, items, sync]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  return { ctx, p };
}
const openSettings = async (p) => { await p.click('#privacy-btn'); await p.waitForSelector('#cloud-card'); };
const openAccount = async (p) => { await p.click('#account-btn'); await p.waitForSelector('#account-pop:not([hidden])'); };
const status = (p) => p.locator('#cloud-card .cloud-status').textContent();
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('uavzones.v1.pois')).items.map((i) => i.name).sort().join());

// ---------- signed out: a form, and nothing is sent
let { ctx, p } = await open({ signedIn: false, items: [mk('Tower', 30.5)] });
ok(await p.locator('#account-btn').isVisible() && await p.locator('#account-btn').getAttribute('data-state') === 'guest', 'signed out: the panel header carries the account button, in its guest state');
await openAccount(p);
ok(await p.locator('#account-pop input[type=email]').isVisible() && /Email me a sign-in link/.test(await p.locator('#account-pop button[type=submit]').textContent()), 'signed out: the popover offers an email sign-in link');
ok(/only in this browser/.test(await p.locator('#account-pop .hint').first().textContent()), 'and says that without it everything stays in the browser');
ok(await p.locator('#account-pop >> text=Export or import your data').isVisible(), 'and links to export and import');
ok(!hits.some((h) => h.includes('/rest/v1/')), 'nothing was sent to the server');
await p.fill('#account-pop input[type=email]', 'someone@example.test'); await p.click('#account-pop button[type=submit]'); await p.waitForTimeout(600);
ok(/Check your email/.test(await p.locator('#account-pop [role=status]').textContent()), 'asking for a link says to check the email');
await p.keyboard.press('Escape');
ok(await p.locator('#account-pop').isHidden() && await p.evaluate(() => document.activeElement?.id) === 'account-btn', 'Escape closes the popover and returns focus to the button');
await p.click('#account-btn'); await p.click('#account-pop >> text=Export or import your data');
ok(await p.locator('#account-pop').isHidden() && await p.locator('#poi-export').isVisible(), 'the export link closes the popover and shows the export button');
await p.click('#account-btn'); await p.mouse.click(300, 400);
ok(await p.locator('#account-pop').isHidden(), 'a click on the map closes it');
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(300);
await p.evaluate(() => { if (!document.getElementById('panel').hidden) document.getElementById('panel-close').click(); }); await p.waitForSelector('#dock:not([hidden])'); await p.waitForTimeout(400);
await p.evaluate(() => { const c = document.getElementById('dock-circle'); if (c && !c.hidden) c.click(); });
await p.waitForTimeout(300);
await p.click('#dock-account'); await p.waitForSelector('#account-pop:not([hidden])');
const sheet = await p.locator('#account-pop').boundingBox();
ok(sheet.x === 0 && Math.abs(sheet.width - 390) < 1 && Math.abs(sheet.y + sheet.height - 800) < 1, 'on a phone the rail button opens it as a sheet along the bottom edge');
await ctx.close();

// ---------- signed in, cloud empty: this device is uploaded
({ ctx, p } = await open({ signedIn: true, items: [mk('Tower', 30.5), mk('Lake', 30.6)] }));
await openAccount(p);
await p.waitForFunction(() => /up to date/.test(document.querySelector('#account-pop .cloud-status')?.textContent || ''), null, { timeout: 15000 });
ok(/tester@example\.test/.test(await p.locator('#account-pop').textContent()) && await p.locator('#account-btn .avatar').count() === 1, 'signed in: the popover shows who, and the button shows an avatar');
ok(await p.locator('#account-pop >> text=Edit profile').isVisible() && await p.locator('#account-pop >> text=Sign out').isVisible() && /Friends/.test(await p.locator('#account-pop .btn-row').textContent()), 'with Edit profile, Friends and Sign out');
await p.click('#account-pop >> text=Friends'); await p.waitForSelector('#pane-friends:not([hidden])');
ok(await p.locator('#account-pop').isHidden(), 'the Friends shortcut opens the Friends tab and closes the popover');
await openSettings(p);
ok(await p.locator('#cloud-card >> text=Sign out').count() === 0, 'the privacy settings no longer carry the sign-out button');
ok(cloud.rows.get(USER.email)?.rev === 1 && cloud.rows.get(USER.email).doc.items.length === 2, 'the first sign-in uploaded both markers (revision 1)');
ok(/Cloud copy up to date/.test(await status(p)), 'the status line says so: ' + await status(p));
await p.click('#privacy-back'); await p.waitForTimeout(300);
await p.evaluate(() => document.getElementById('dash-tab')?.click() || document.getElementById('dash-peek')?.click()); await p.waitForTimeout(500);
const dashLine = p.locator('#dash .cloud-line');
ok(await dashLine.count() === 1 && /Cloud copy: Cloud copy up to date/.test(await dashLine.textContent()), 'the dashboard\'s Your data card carries the same line');

await ctx.close();

// ---------- both sides changed: a question, a backup, then the cloud copy
cloud.versions.set(USER.email, [{ rev: 1, doc: { items: [mk('Old', 30.1)], trips: [] }, updated_at: '2026-11-10T09:00:00.000Z', device: 'Chrome on Windows' }]); // an earlier version, as a past overwrite would leave
cloud.rows.get(USER.email).doc.items.push({ ...mk('FromPhone', 30.7) }); cloud.rows.get(USER.email).rev = 2; cloud.rows.get(USER.email).device = 'Safari on iOS';
({ ctx, p } = await open({ signedIn: true, items: [mk('Tower', 30.5), mk('Lake', 30.6), mk('Local only', 30.8)], sync: { baseRev: 1, dirty: true, lastSyncedAt: '2026-11-11T10:00:00.000Z' } }));
await p.waitForSelector('dialog.cloud-dialog[open]', { timeout: 15000 });
const dlgText = await p.locator('dialog.cloud-dialog').textContent();
ok(/Both copies changed/.test(dlgText) && /Safari on iOS/.test(dlgText), 'the question names the device that changed the cloud copy');
ok(/3 markers/.test(dlgText) && /Only on the cloud: 1 marker/.test(dlgText) && /Only here: 1 marker/.test(dlgText), 'and what is on each side: ' + dlgText.replace(/\s+/g, ' ').slice(0, 260));
ok(await stored(p) === 'Lake,Local only,Tower' && cloud.rows.get(USER.email).rev === 2, 'nothing is overwritten while it waits');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('dialog.cloud-dialog >> text=Use the cloud copy')]);
ok(/this-device/.test(dl.suggestedFilename()), 'the side being replaced is offered for download first: ' + dl.suggestedFilename());
await p.waitForFunction(() => /up to date/.test(document.querySelector('#cloud-card .cloud-status')?.textContent || ''), null, { timeout: 15000 });
ok(await stored(p) === 'FromPhone,Lake,Tower', 'this device now holds the cloud copy: ' + await stored(p));
ok(!(await p.locator('dialog.cloud-dialog[open]').count()), 'and the question is closed');

// ---------- earlier versions
await openSettings(p);
await p.click('#cloud-card >> text=Earlier versions'); await p.waitForTimeout(500);
ok(await p.locator('#cloud-card .cloud-version').count() === 1 && /Chrome on Windows · 1 marker/.test(await p.locator('#cloud-card .cloud-version').textContent()), 'earlier versions are listed with device and counts');

// ---------- sign out
await p.click('#privacy-back'); await openAccount(p);
await p.click('#account-pop >> text=Sign out'); await p.waitForTimeout(600);
await openAccount(p);
ok(await p.locator('#account-pop input[type=email]').isVisible() && await stored(p) === '' && cloud.rows.get(USER.email).doc.items.length === 3, 'sign-out returns to the form, clears this device (it was in step with the cloud) and leaves the cloud copy alone');
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
