// The Friends tab in the browser. The real Supabase client talks to a mocked HTTP server whose functions run the real friends SQL on an
// in-memory Postgres (PGlite), so the interface is tested against the real access rules. Two users, each in their own browser context.
import { chromium, CHANNEL } from './lib.mjs';
import { makeDb, as, A, B } from './lib-db.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const URL_ = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
const REF = new URL(URL_).hostname.split('.')[0];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = (id, email) => {
  const user = { id, email, aud: 'authenticated', role: 'authenticated' };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp })}.sig`, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user };
};

const db = await makeDb();
let lock = Promise.resolve(); // one database call at a time: the role is set per call
const serial = (fn) => { const r = lock.then(fn, fn); lock = r.catch(() => {}); return r; };
const SETOF = new Set(['list_friends', 'list_blocked']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const calls = [];
const mockFor = (uid) => async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
  const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (!m) return reply({ message: 'not mocked: ' + u.pathname }, 404);
  const fn = m[1]; calls.push(fn);
  const args = req.postData() ? JSON.parse(req.postData()) : {};
  const names = Object.keys(args);
  const sql = SETOF.has(fn)
    ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t`
    : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
  try {
    const rows = await serial(() => as(db, uid, sql, names.map((n) => args[n])));
    return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j);
  } catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
};

const b = await chromium.launch({ channel: CHANNEL });
async function open(who, { vp = { width: 1300, height: 850 }, mobile = false, signedIn = true, prompt = 'skip' } = {}) {
  const [uid, email] = who === 'a' ? [A, 'a@example.test'] : [B, 'b@example.test'];
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mockFor(uid));
  await ctx.addInitScript(([ref, sess, dash]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    localStorage.setItem('uavzones.v1.dash', JSON.stringify(dash));
    localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm' }));
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [REF, signedIn ? session(uid, email) : null, { v: 1, showOnStart: false, welcomed: true, seen: '9999' }]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|status of 4/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  if (prompt === 'skip') await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {}); // a new profile is asked for a name on first sign-in
  return { ctx, p };
}
const goFriends = async (p) => { await p.evaluate(() => { const t = document.getElementById('tab-friends'); if (document.getElementById('panel').hidden) document.querySelector('#dock button[data-tab=friends]').click(); else t.click(); }); await p.waitForTimeout(700); };
const code = (p) => p.locator('#fr-code').textContent();

// ---------- signed out: the tab shows a pointer, nothing is sent
let { ctx, p } = await open('a', { signedIn: false });
ok(await p.locator('#tab-friends').count() === 1 && await p.locator('#dock button[data-tab=friends]').count() === 1, 'the Friends tab and its rail icon exist when this build has accounts');
await goFriends(p);
ok(/Sign in/.test(await p.textContent('#pane-friends')) && !calls.length, 'signed out, it explains and points to sign-in, and nothing is sent');
await p.click('#pane-friends >> text=Sign in…'); await p.waitForSelector('#account-pop:not([hidden])');
ok(await p.locator('#account-pop input[type=email]').isVisible(), 'its button opens the account popover, where sign-in lives');
await ctx.close();

// ---------- Alex: profile
({ ctx, p } = await open('a', { prompt: 'none' }));
await p.waitForSelector('#name-dialog[open] #name-dlg-input');
ok(await p.locator('#name-dlg-input').isVisible() && await p.getAttribute('#name-dlg-input', 'placeholder') === 'Pilot', 'a new profile is asked for a display name on first sign-in');
await p.click('#name-dlg-save'); await p.waitForTimeout(200);
ok(await p.locator('#name-dialog[open]').count() === 1, 'an empty name is not accepted');
await p.click('#name-dlg-skip'); await p.waitForSelector('#name-dialog', { state: 'hidden' }); await p.waitForTimeout(300);
ok((await db.query(`select display_name, named from public.profiles where user_id = '${A}'`)).rows[0].named === true, 'Skip keeps the default name and marks the profile as named');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
ok(await p.locator('#name-dialog[open]').count() === 0, 'and it is not asked again');
const tabs = await p.$$eval('#panel [role=tab]', (t) => t.map((x) => x.textContent.trim()));
ok(tabs.join('|') === 'Map Configs|Trips|Points of Interest|Friends', 'four tabs in order: ' + tabs.join('|'));
await goFriends(p);
ok(await p.textContent('#fr-me-name') === 'Pilot' && /^[0-9A-F]{5}-[0-9A-F]{5}$/.test(await code(p)), 'the first visit creates a profile with a default name and shows the friend code in two groups of five: ' + await code(p));
const editProfile = async (pg) => { await pg.click('#fr-edit-profile'); await pg.waitForSelector('#profile-dialog[open] #pf-card'); };
ok(await p.locator('#pf-card').count() === 0 && await p.locator('#panel [role=tab]').count() === 4, 'the profile editor is not in the Friends tab and is not a tab of its own');
await editProfile(p);
await p.fill('#pf-name', 'Alex'); await p.click('#pf-save'); await p.waitForSelector('#profile-dialog', { state: 'hidden' }); await p.waitForTimeout(400);
ok(await p.textContent('#fr-me-name') === 'Alex' && (await db.query(`select display_name from public.profiles where user_id = '${A}'`)).rows[0].display_name === 'Alex', 'the display name saves from the Edit profile dialog, which closes');
const aCode = await code(p);
ok(await p.locator('#fr-friends').textContent().then((t) => /No friends yet/.test(t)), 'no friends yet, and it says what to do');

// ---------- Bea
let bea = await open('b', { prompt: 'none' });
await bea.p.waitForSelector('#name-dialog[open] #name-dlg-input');
await bea.p.fill('#name-dlg-input', 'Bea'); await bea.p.click('#name-dlg-save'); await bea.p.waitForSelector('#name-dialog', { state: 'hidden' }); await bea.p.waitForTimeout(400);
ok((await db.query(`select display_name, named from public.profiles where user_id = '${B}'`)).rows[0].display_name === 'Bea', 'a name typed in the first-sign-in prompt is applied');
await goFriends(bea.p);
const bCode = await code(bea.p);
ok(bCode !== aCode, 'a second person gets a different code');

// ---------- a request
await p.fill('#fr-add', 'not a code'); await p.click('#pane-friends form.fr-name button'); await p.waitForTimeout(600);
ok(/that code was not found/.test(await p.textContent('.fr-message')), 'a wrong code says "that code was not found"');
await p.fill('#fr-add', bCode.toLowerCase().replace('-', ' ')); await p.click('#pane-friends form.fr-name button'); await p.waitForTimeout(700);
ok(/Request sent/.test(await p.textContent('.fr-message')) && /Bea/.test(await p.textContent('#fr-requests')) && /waiting for an answer/.test(await p.textContent('#fr-requests')), 'a code typed in lower case with a space still works, and the request shows as waiting');
// Bea looks again
await bea.p.evaluate(() => document.getElementById('tab-trips').click()); await bea.p.waitForTimeout(200); await goFriends(bea.p);
ok(/Alex/.test(await bea.p.textContent('#fr-requests')) && /wants to be friends/.test(await bea.p.textContent('#fr-requests')), 'Bea sees the incoming request with Alex\'s name');
ok(await bea.p.locator('#tab-friends .tab-badge:not([hidden])').textContent() === '1', 'the Friends tab carries a badge with the number of requests');
// the dashboard says so too
await bea.p.evaluate(() => document.getElementById('panel-close').click()); await bea.p.waitForTimeout(500);
await bea.p.evaluate(() => (document.getElementById('dash-tab') && !document.getElementById('dash-tab').hidden ? document.getElementById('dash-tab') : document.getElementById('dash-peek')).click()); await bea.p.waitForSelector('#dash:not([hidden])');
ok(/1 friend request is waiting/.test(await bea.p.textContent('#dash .dash-friends')), 'the dashboard shows a card for it');
await bea.p.click('#dash .dash-friends button'); await bea.p.waitForSelector('#pane-friends:not([hidden])');
ok(true, 'its button opens the Friends tab');
await bea.p.click('#fr-requests >> text=Accept'); await bea.p.waitForTimeout(700);
ok(/Alex/.test(await bea.p.textContent('#fr-friends')) && !(await bea.p.locator('#fr-requests').count()) && await bea.p.locator('#tab-friends .tab-badge:not([hidden])').count() === 0, 'accepting moves Alex to Friends and clears the badge');
await p.evaluate(() => document.getElementById('tab-trips').click()); await p.waitForTimeout(200); await goFriends(p);
ok(/Bea/.test(await p.textContent('#fr-friends')) && /Friends \(1\)/.test(await p.textContent('#fr-friends')), 'Alex sees Bea among his friends');

// ---------- profile: editing, and what a friend sees
const prof = async () => (await db.query(`select avatar, bio, location, interests, share_profile from public.profiles where user_id = '${A}'`)).rows[0];
await editProfile(p);
ok(await p.locator('#pf-card .pf-pick').count() >= 12 && await p.locator('#pf-card [data-interest]').count() >= 12, 'the Profile card offers the preset avatars and the interest tags');
await p.click('#pf-card [data-pick=fpv-cinewhoop]');
await p.fill('#pf-bio', 'Cinewhoop and chill'); await p.fill('#pf-location', 'Wuhan, China');
await p.click('#pf-card [data-interest=fpv-cinematic]'); await p.click('#pf-card [data-interest=hiking]');
await p.fill('#pf-bio', 'Draft kept through the preview');
await p.click('#pf-preview-btn'); await p.waitForSelector('#pf-preview');
const pv = await p.textContent('#pf-preview');
ok(/Alex/.test(pv) && /Draft kept through the preview/.test(pv) && /Wuhan, China/.test(pv) && /Hiking/.test(pv) && await p.locator('#pf-preview .avatar[data-avatar=fpv-cinewhoop]').count() === 1, 'the preview shows the draft as others see it: name, avatar, location, interests, bio');
await p.waitForSelector('#pf-preview .prog-card:not([data-status=loading])');
ok(await p.locator('#pf-preview [data-act=collection]').count() === 1 && await p.locator('#pf-preview [data-act=history]').count() === 0, 'the preview is the profile popover body: the progression card with Achievements, without XP history');
await p.click('#pf-preview-back'); await p.waitForSelector('#pf-card');
ok(await p.inputValue('#pf-bio') === 'Draft kept through the preview' && await p.getAttribute('#pf-card [data-pick=fpv-cinewhoop]', 'aria-pressed') === 'true', 'going back from the preview keeps the unsaved draft');
await p.click('#pf-share'); await p.click('#pf-preview-btn'); await p.waitForSelector('#pf-preview');
ok(!/Wuhan|Draft kept/.test(await p.textContent('#pf-preview')) && /No more details/.test(await p.textContent('#pf-preview')), 'with sharing off the preview shows only the name and avatar');
ok(await p.locator('#pf-preview .prog-card').count() === 0, 'with sharing off the preview shows no progression card');
await p.click('#pf-preview-back'); await p.waitForSelector('#pf-card'); await p.click('#pf-share');
await p.fill('#pf-bio', 'Cinewhoop and chill');
for (const k of ['food', 'history', 'wildlife']) await p.click(`#pf-card [data-interest=${k}]`);
await p.click('#pf-card [data-interest=cycling]');
ok(/up to 5/.test(await p.textContent('#profile-dialog .pf-msg')) && await p.getAttribute('#pf-card [data-interest=cycling]', 'aria-pressed') === 'false', 'a sixth interest is refused with a message');
await p.click('#pf-card [data-interest=food]'); await p.click('#pf-card [data-interest=history]'); await p.click('#pf-card [data-interest=wildlife]');
await p.click('#pf-save'); await p.waitForSelector('#profile-dialog', { state: 'hidden' }); await p.waitForTimeout(500);
let row = await prof();
ok(row.avatar === 'fpv-cinewhoop' && row.bio === 'Cinewhoop and chill' && row.location === 'Wuhan, China' && JSON.stringify(row.interests) === JSON.stringify(['fpv-cinematic', 'hiking']) && row.share_profile === true, 'Save writes all the fields: ' + JSON.stringify(row));
await p.click('#account-btn'); await p.waitForSelector('#account-pop:not([hidden])'); await p.waitForTimeout(500);
ok(await p.locator('#account-pop .avatar[data-avatar=fpv-cinewhoop]').count() === 1 && await p.locator('#account-btn .avatar[data-avatar=fpv-cinewhoop]').count() === 1, 'the account button and popover show the chosen avatar');
await p.keyboard.press('Escape');
await bea.p.evaluate(() => document.getElementById('tab-trips').click()); await bea.p.waitForTimeout(200); await goFriends(bea.p); await bea.p.waitForTimeout(700);
let fr = await bea.p.textContent('#fr-friends');
ok(await bea.p.locator('#fr-friends .avatar[data-avatar=fpv-cinewhoop]').count() === 1 && /Wuhan, China/.test(fr) && /FPV cinematic/.test(fr) && /Hiking/.test(fr) && /Cinewhoop and chill/.test(fr), 'Bea sees Alex\'s avatar, location, interests and bio in her friends list');
await bea.p.click('#fr-friends .pv-trigger >> nth=0'); await bea.p.waitForSelector('#profile-pop:not([hidden])');
const pop1 = await bea.p.textContent('#profile-pop');
ok(/Alex/.test(pop1) && /Wuhan, China/.test(pop1) && /Hiking/.test(pop1) && /Cinewhoop and chill/.test(pop1) && await bea.p.locator('#profile-pop .avatar[data-avatar=fpv-cinewhoop]').count() === 1 && !pop1.includes('@'), "clicking a friend's avatar opens a small profile popover with what they share (and no email)");
await bea.p.keyboard.press('Escape');
ok(await bea.p.locator('#profile-pop').isHidden(), 'Escape closes the profile popover');
const vp0 = bea.p.viewportSize(); // an unfolded phone: wider than the phone sheet, too narrow for the panel and the popover side by side
await bea.p.setViewportSize({ width: 734, height: 707 }); await bea.p.waitForTimeout(300);
await bea.p.click('#fr-friends .pv-trigger >> nth=0'); await bea.p.waitForSelector('#profile-pop:not([hidden])'); await bea.p.waitForTimeout(200);
const edge = await bea.p.evaluate(() => { const r = document.getElementById('profile-pop').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
ok(edge.l >= 0 && edge.r <= edge.w, 'at 734 px wide the profile popover stays inside the screen: ' + JSON.stringify(edge));
await bea.p.keyboard.press('Escape'); await bea.p.setViewportSize(vp0); await bea.p.waitForTimeout(300);
await bea.p.click('#fr-friends .fr-who .pv-trigger >> nth=0'); await bea.p.waitForSelector('#profile-pop:not([hidden])'); await bea.p.click('#fr-friends .fr-who .pv-trigger >> nth=0');
ok(await bea.p.locator('#profile-pop').isHidden(), 'clicking the same name again closes it');
await editProfile(p); await p.click('#pf-share'); await p.click('#pf-save'); await p.waitForSelector('#profile-dialog', { state: 'hidden' }); await p.waitForTimeout(500);
await bea.p.evaluate(() => document.getElementById('tab-trips').click()); await bea.p.waitForTimeout(200); await goFriends(bea.p); await bea.p.waitForTimeout(700);
fr = await bea.p.textContent('#fr-friends');
ok(await bea.p.locator('#fr-friends .avatar[data-avatar=fpv-cinewhoop]').count() === 1 && !/Wuhan|Cinewhoop and chill|FPV cinematic/.test(fr), 'with sharing off Bea still sees the avatar, but not the bio, location or interests');
await bea.p.click('#fr-friends .pv-trigger >> nth=0'); await bea.p.waitForSelector('#profile-pop:not([hidden])');
ok(!/Wuhan|Cinewhoop and chill|Hiking/.test(await bea.p.textContent('#profile-pop')) && /No more details/.test(await bea.p.textContent('#profile-pop')), 'with sharing off the popover shows only the name and avatar');
await bea.p.keyboard.press('Escape');
await editProfile(p); await p.click('#pf-share'); await p.click('#pf-save'); await p.waitForSelector('#profile-dialog', { state: 'hidden' }); await p.waitForTimeout(500);
await editProfile(p);
ok(await p.locator('#profile-dialog button:text-is("Clear")').count() === 0, 'the editor has no Clear buttons');
{ const pb = await p.locator('#pf-preview-btn').boundingBox(), cb = await p.locator('#profile-dialog .btn-row .btn >> text=Cancel').boundingBox(), sb = await p.locator('#pf-save').boundingBox();
  ok(sb.y > pb.y + pb.height - 1 && sb.y > cb.y + cb.height - 1, 'Save profile sits below Preview and Cancel'); }
await p.locator('#pf-card .pf-pick[aria-pressed=true]').click(); await p.click('#pf-save'); await p.waitForSelector('#profile-dialog', { state: 'hidden' }); await p.waitForTimeout(700);
ok((await prof()).avatar === null, 'tapping the chosen avatar again removes it');
await editProfile(p);
await p.keyboard.press('Escape'); await p.waitForSelector('#profile-dialog', { state: 'hidden' });
await p.click('#account-btn'); await p.waitForSelector('#account-pop:not([hidden])'); await p.click('#account-pop >> text=Edit profile');
await p.waitForSelector('#profile-dialog[open] #pf-card');
ok(await p.locator('#account-pop').isHidden() && await p.locator('#pane-friends').isHidden() === false, 'Edit profile in the account popover opens the dialog (Escape closes it)');
await p.keyboard.press('Escape');
// ---------- the editor: validation, unsaved changes, account pane contents
await editProfile(p);
await p.fill('#pf-name', '   '); await p.click('#pf-save');
ok(await p.locator('#pf-name[aria-invalid=true]').count() === 1 && /cannot be empty/.test(await p.textContent('#profile-dialog .pf-msg')) && await p.locator('#profile-dialog[open]').count() === 1, 'an empty display name is refused in the editor, with the field marked invalid');
ok(await p.locator('#pf-card .pf-group').count() === 3 && await p.locator('#pf-card .pf-opt').count() === 3, 'the editor is grouped, and the optional fields say so');
await p.fill('#pf-name', 'Alex'); await p.fill('#pf-bio', 'unsaved words');
p.removeAllListeners('dialog'); p.once('dialog', (d) => d.dismiss()); await p.click('#profile-dialog .btn-row >> text=Cancel'); await p.waitForTimeout(300);
ok(await p.locator('#profile-dialog[open]').count() === 1 && await p.inputValue('#pf-bio') === 'unsaved words', 'Cancel with unsaved changes asks first, and staying keeps the draft');
p.once('dialog', (d) => d.accept()); await p.click('#profile-dialog .btn-row >> text=Cancel'); await p.waitForSelector('#profile-dialog', { state: 'hidden' });
await editProfile(p);
ok(await p.inputValue('#pf-bio') !== 'unsaved words', 'discarding drops the draft');
p.on('dialog', (d) => d.accept());
await p.click('#profile-dialog .btn-row >> text=Cancel'); await p.waitForSelector('#profile-dialog', { state: 'hidden' });
await p.click('#account-btn'); await p.waitForSelector('#account-pop:not([hidden])');
ok(await p.locator('#account-pop #pane-progression').count() === 1 && await p.locator('#account-pop #pane-steam').count() === 1 && !(await p.textContent('#account-pop')).includes('@'), 'the account pane holds Progression and Steam and shows no email address');
await p.keyboard.press('Escape');
await goFriends(p);
ok(await p.locator('#pane-friends #fr-progression, #pane-friends #fr-steam').count() === 0 && await p.locator('#fr-friends').count() === 1, 'the Friends tab has neither card and keeps the friends list');
ok(!JSON.stringify(await p.evaluate(() => document.getElementById('pane-friends').innerHTML)).includes('@'), 'no email address appears in the Friends tab');

// ---------- online status
const wakeBoth = async () => { for (const pg of [p, bea.p]) await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(900); };
const refreshFriends = async (pg) => { await pg.evaluate(() => document.getElementById('tab-trips').click()); await pg.waitForTimeout(150); await goFriends(pg); };
await wakeBoth(); await refreshFriends(p); await refreshFriends(bea.p);
ok(/Online/.test(await p.textContent('#fr-friends')) && await p.locator('#fr-friends .presence.on').count() === 1, 'a friend who has the app open shows as online, with a green dot');
ok(/Online/.test(await bea.p.textContent('#fr-friends')), 'and so does Alex to Bea');
await bea.p.uncheck('#fr-online'); await bea.p.waitForTimeout(700);
await refreshFriends(p); await refreshFriends(bea.p);
ok(!/Online|Seen/.test(await p.textContent('#fr-friends')) && await p.locator('#fr-friends .presence').count() === 0, 'when Bea hides her status, Alex sees nothing for her');
ok(await bea.p.locator('#fr-friends .presence').count() === 0 && !/Online|Seen/.test(await bea.p.textContent('#fr-friends')), 'and Bea, having hidden hers, does not see Alex\'s');
ok(await bea.p.locator('#fr-online').isChecked() === false, 'the switch shows that it is off');
await bea.p.check('#fr-online'); await bea.p.waitForTimeout(700); await wakeBoth();
await refreshFriends(p);
ok(await p.locator('#fr-friends .presence.on').count() === 1, 'switched back on, she shows as online again');

// ---------- blocking
await bea.p.click('#fr-friends >> text=Block'); await bea.p.waitForTimeout(700);
ok(/Alex/.test(await bea.p.textContent('#fr-blocked')) && /No friends yet/.test(await bea.p.textContent('#fr-friends')), 'blocking removes the friend and lists them under Blocked');
await p.fill('#fr-add', bCode); await p.click('#pane-friends form.fr-name button'); await p.waitForTimeout(700);
ok(/that code was not found/.test(await p.textContent('.fr-message')), 'the blocked person asking again just gets "that code was not found"');
await bea.p.click('#fr-blocked >> text=Unblock'); await bea.p.waitForTimeout(700);
ok(!(await bea.p.locator('#fr-blocked').count()), 'unblocking clears the list');

// ---------- switching requests off, new code, delete
await bea.p.uncheck('#fr-accepts'); await bea.p.waitForTimeout(600);
await p.fill('#fr-add', bCode); await p.click('#pane-friends form.fr-name button'); await p.waitForTimeout(700);
ok(/that code was not found/.test(await p.textContent('.fr-message')), 'with requests switched off the code gives the same answer as a wrong one');
await bea.p.check('#fr-accepts'); await bea.p.waitForTimeout(500);
await bea.p.click('#pane-friends >> text=New code'); await bea.p.waitForTimeout(700);
ok(await code(bea.p) !== bCode, 'a new code replaces the old one');
await bea.p.click('#pane-friends >> text=Delete my profile and friends'); await bea.p.waitForTimeout(800);
ok((await db.query(`select count(*)::int as n from public.profiles where user_id = '${B}'`)).rows[0].n === 0, 'deleting the profile removes it from the database');
await bea.ctx.close(); await ctx.close();

// ---------- a phone: four tabs fit
({ ctx, p } = await open('a', { vp: { width: 360, height: 740 }, mobile: true }));
await p.tap('#dock button[data-tab=friends]'); await p.waitForSelector('#pane-friends:not([hidden])'); await p.waitForTimeout(500);
const fit = await p.$eval('#panel .tabs', (t) => ({ sw: t.scrollWidth, cw: t.clientWidth }));
const head = await p.$eval('#panel .sp-head', (h) => { const r = h.getBoundingClientRect(); const c = document.getElementById('panel-close').getBoundingClientRect(); return { right: r.right, close: c.right }; });
ok(fit.sw <= fit.cw + 1 && head.close <= head.right, 'on a 360 px phone the four tabs fit and the > button is still in the header (' + fit.sw + ' of ' + fit.cw + ' px)');
// on a phone: Edit profile opens without the keyboard (no text field is focused) and a swipe down dismisses it
{
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const swipeDown = async (x, y0, y1) => { await touch('touchStart', x, y0); for (let i = 1; i <= 8; i++) { await touch('touchMove', x, y0 + ((y1 - y0) * i) / 8); await p.waitForTimeout(12); } await touch('touchEnd'); await p.waitForTimeout(500); };
  const focusedField = () => p.evaluate(() => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || ''));
  await p.evaluate(() => document.getElementById('fr-edit-profile').click()); await p.waitForSelector('#profile-dialog[open] #pf-card');
  ok(!(await focusedField()), 'on a touch screen Edit profile does not focus the name field (no keyboard)');
  const r = await p.$eval('#profile-dialog h2', (h) => { const b = h.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await swipeDown(r.x, r.y, r.y + 260);
  ok(await p.locator('#profile-dialog[open]').count() === 0, 'a swipe down on the Edit profile title dismisses it');
  await p.evaluate(() => document.getElementById('fr-edit-profile').click()); await p.waitForSelector('#profile-dialog[open] #pf-card');
  ok(await p.evaluate(() => document.getElementById('profile-dialog').style.transform === ''), 'the dialog is back in place when it reopens');
  await p.fill('#pf-name', 'Alexander'); // the page accepts the "Discard changes?" question
  await p.click('#pf-preview-btn'); await p.waitForSelector('#pf-preview');
  const r2 = await p.$eval('#profile-dialog h2', (h) => { const b = h.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await swipeDown(r2.x, r2.y, r2.y + 260);
  ok(await p.locator('#profile-dialog[open]').count() === 0, 'a swipe down on the preview dismisses the dialog too');
}
await ctx.close();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
await db.close();
