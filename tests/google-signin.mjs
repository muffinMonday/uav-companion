// Google sign-in in the browser. MOCKED: the real supabase-js client runs against a mocked HTTP server; the browser never reaches Google. This proves the
// popover states, what is requested (provider, redirect), the return-URL handling and the layouts. The live run with the real OAuth client is the owner's.
import { chromium, CHANNEL } from './lib.mjs';
import fs from 'node:fs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const errs = [];

const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
const URL_ = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
const REF = new URL(URL_).hostname.split('.')[0];
const USER = { id: '22222222-2222-2222-2222-222222222222', email: 'tester@example.test', aud: 'authenticated', role: 'authenticated' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const session = () => ({ access_token: jwt(), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

let authorize = [], otp = 0;
const mock = async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const json = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname.endsWith('/auth/v1/authorize')) {
    authorize.push({ provider: u.searchParams.get('provider'), redirect: u.searchParams.get('redirect_to'), scopes: u.searchParams.get('scopes') });
    return route.fulfill({ status: 204 }); // no content: the browser stays on the page, as if still waiting for Google
  }
  if (u.pathname.includes('/auth/v1/otp')) { otp++; return json({}); }
  if (u.pathname.endsWith('/rest/v1/user_data')) return json([]);
  if (u.pathname.includes('/rest/v1/rpc/save_user_data')) return json({ status: 'ok', rev: 1, updated_at: '2026-11-15T00:00:00Z', device: 'x', markers: 0, trips: 0 });
  if (u.pathname.includes('/auth/v1/logout')) return json({}, 204);
  return json({ message: 'not mocked: ' + u.pathname }, 404);
};

const b = await chromium.launch({ channel: CHANNEL });
async function open({ signedIn = false, hash = '', search = '', size = { width: 1300, height: 900 }, touch = false, seed = null } = {}) {
  const ctx = await b.newContext({ viewport: size, hasTouch: touch, isMobile: touch });
  await ctx.route(new RegExp('^' + URL_.replace(/[.]/g, '\\.') + '/'), mock);
  await ctx.addInitScript(([ref, sess, sd]) => {
    if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
    if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
    if (sd) sessionStorage.setItem(sd[0], sd[1]);
  }, [REF, signedIn ? session() : null, seed]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::|not mocked|access_denied/.test(m.text()) && errs.push(m.text()));
  await p.goto('http://localhost:5173/' + search + hash, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  return { ctx, p };
}
const openAccount = async (p, sel = '#account-btn') => { await p.click(sel); await p.waitForSelector('#account-pop:not([hidden])'); };
const G = '#account-pop .cloud-google';
const ST = '#account-pop [role=status]';

// ---------- idle
{
  const { ctx, p } = await open();
  ok(await p.locator('#account-pop').isHidden(), 'idle: the popover is closed on a plain load');
  await openAccount(p);
  const g = p.locator(G);
  ok(await g.isVisible() && (await g.textContent()) === 'Continue with Google' && await g.getAttribute('type') === 'button', 'idle: a "Continue with Google" button is in the guest popover');
  const order = await p.evaluate(() => [...document.querySelectorAll('#account-pop .cloud-signin > *')].map((e) => e.className.split(' ').find((c) => /^cloud-/.test(c)) || e.tagName));
  ok(order.join() === 'cloud-google,cloud-or,cloud-form,P', 'idle: order is Google, "or use email", the email form, the status line (' + order.join() + ')');
  ok(/or use email/.test(await p.locator('#account-pop .cloud-or').textContent()), 'idle: the divider label reads "or use email"');
  ok(await p.locator('#account-pop input[type=email]').isVisible() && await p.locator('#account-pop >> text=Export or import your data').isVisible(), 'idle: the email form and the export link are unchanged');
  await g.focus(); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  const fv = await p.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { cls: e.className, outline: s.outlineStyle, w: parseFloat(s.outlineWidth) }; });
  ok(/cloud-google/.test(fv.cls) && fv.outline !== 'none' && fv.w >= 2, 'keyboard: the button is reachable with Tab and shows the focus ring (' + fv.outline + ' ' + fv.w + 'px)');
  await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.activeElement?.type) === 'email', 'keyboard: Tab goes on through the divider to the email field');
  await ctx.close();
}

// ---------- redirecting, and what is requested
{
  authorize = [];
  const { ctx, p } = await open();
  await openAccount(p);
  await p.click(G);
  await p.waitForFunction(() => document.querySelector('#account-pop .cloud-google')?.disabled);
  const st = p.locator(ST);
  ok(await p.locator(G).isDisabled() && await p.locator('#account-pop button[type=submit]').isDisabled(), 'redirecting: both submit controls are disabled');
  ok((await st.textContent()) === 'Opening Google…' && await st.isVisible(), 'redirecting: the status line says "Opening Google…"');
  await p.waitForTimeout(300);
  ok(authorize.length === 1 && authorize[0].provider === 'google', 'redirecting: the browser asked the authorize endpoint for provider google');
  ok(authorize[0]?.redirect === 'http://localhost:5173/', 'redirecting: it asked to return to the app address (' + authorize[0]?.redirect + ')');
  ok(authorize[0]?.scopes == null, 'redirecting: no extra scopes were requested');
  ok(otp === 0, 'redirecting: no magic link was requested');
  await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  ok(await p.locator(G).isEnabled() && await p.locator('#account-pop button[type=submit]').isEnabled() && await st.isHidden(), 'pageshow: the controls are enabled again and the "Opening Google…" line is gone');
  await ctx.close();
}

// ---------- failed or cancelled return (an error reaches the app)
{
  const { ctx, p } = await open({ hash: '#error=access_denied&error_code=bad&error_description=Nope%20nope' });
  ok(await p.locator('#account-pop').isVisible(), 'failed return: the popover opens by itself');
  const st = p.locator(ST);
  ok(/Google sign-in did not finish/.test(await st.textContent()) && await st.isVisible(), 'failed return: it says Google sign-in did not finish');
  ok(!/Nope/.test(await p.locator('#account-pop').textContent()), "failed return: the provider's own text is not shown");
  ok(await p.evaluate(() => location.hash === '' && !location.search), 'failed return: the error is removed from the address bar');
  ok(await p.locator(G).isEnabled() && await p.locator('#account-pop button[type=submit]').isEnabled(), 'failed return: Google can be tried again and email is usable');
  await p.fill('#account-pop input[type=email]', 'someone@example.test'); await p.click('#account-pop button[type=submit]'); await p.waitForTimeout(600);
  ok(otp === 1 && /Check your email/.test(await st.textContent()), 'failed return: the email link still works');
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  ok(await p.locator('#account-pop').isHidden(), 'failed return: a reload does not show the message again');
  await ctx.close();
}
{
  const { ctx, p } = await open({ search: '?error=server_error&error_description=x' });
  ok(await p.locator('#account-pop').isVisible() && await p.evaluate(() => !location.search), 'failed return (query form): popover opens and the address is cleaned');
  await ctx.close();
}

// ---------- a pending session link survives a failed return
{
  const { ctx, p } = await open({ hash: '#error=access_denied', seed: ['uavzones.session-link', 'tok-123'] });
  ok(await p.evaluate(() => sessionStorage.getItem('uavzones.session-link')) === 'tok-123', 'session link: the stashed token is still there after a failed return');
  await ctx.close();
}

// ---------- signed in: quiet on success
{
  const { ctx, p } = await open({ signedIn: true });
  ok(await p.locator('#account-pop').isHidden() && await p.locator('#account-btn').getAttribute('data-state') === 'in', 'returning session: no popover, the button shows the signed-in state');
  await openAccount(p);
  ok(await p.locator(G).count() === 0, 'signed in: no Google button in the signed-in view');
  await ctx.close();
}
{
  const { ctx, p } = await open({ hash: '#access_token=abc&refresh_token=r&expires_in=3600&token_type=bearer' });
  ok(await p.locator('#account-pop').isHidden(), 'success hash: the popover does not open as for a failure');
  await ctx.close();
}

// ---------- layouts: desktop panel header, phone dock sheet
{
  const { ctx, p } = await open();
  await openAccount(p);
  const bb = await p.locator(G).boundingBox(), pb = await p.locator('#account-pop').boundingBox();
  ok(bb.height >= 30 && bb.x >= pb.x && bb.x + bb.width <= pb.x + pb.width, 'desktop: the button fits the popover (' + Math.round(bb.width) + 'x' + Math.round(bb.height) + ')');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop: no horizontal scroll');
  await ctx.close();
}
for (const [name, size] of [['phone 390x844', { width: 390, height: 844 }], ['small phone 360x640', { width: 360, height: 640 }]]) {
  const { ctx, p } = await open({ size, touch: true });
  await p.evaluate(() => { if (!document.getElementById('panel').hidden) document.getElementById('panel-close').click(); });
  await p.waitForSelector('#dock:not([hidden])'); await p.waitForTimeout(400);
  await p.evaluate(() => { const c = document.getElementById('dock-circle'); if (c && !c.hidden) c.click(); }); await p.waitForTimeout(300);
  await openAccount(p, '#dock-account');
  const bb = await p.locator(G).boundingBox(), pb = await p.locator('#account-pop').boundingBox();
  ok(bb.x >= pb.x && bb.x + bb.width <= pb.x + pb.width + 0.5 && pb.y >= 0 && pb.y + pb.height <= size.height + 1, name + ': dock entry opens a sheet and the button fits it');
  const reach = await p.evaluate(() => { const e = document.querySelector('#account-pop .cloud-google'); return { h: e.getBoundingClientRect().height, inset: getComputedStyle(e, '::after').top }; });
  ok(reach.h >= 36 || reach.inset.startsWith('-'), name + ': touch target is tall enough (height ' + Math.round(reach.h) + ', ::after top ' + reach.inset + ')');
  await p.locator(G).scrollIntoViewIfNeeded();
  ok(await p.evaluate(() => { const r = document.querySelector('#account-pop .cloud-google').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), name + ': the button is on screen');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': no horizontal scroll');
  await ctx.close();
}

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
