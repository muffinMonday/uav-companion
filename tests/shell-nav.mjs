// The new shell navigation (src/shell/nav.js, src/shell/tier.js, Review 01 S10.2, NAV-01 to NAV-09). Experimental, behind VITE_NEW_SHELL
// (default off: absent from the production build, see the other suites' default passes). Starts its own flagged Vite dev server so it
// does not need the shared app on :5173, same pattern as tests/preflight-lab.mjs.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CHANNEL, chromium, ROOT, pickType } from './lib.mjs';

const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js');

function startVite(port, flag) {
  const env = { ...process.env };
  delete env.VITE_NEW_SHELL;
  if (flag) env.VITE_NEW_SHELL = '1';
  const child = spawn(process.execPath, [VITE, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start on ' + port)), 60000);
    const on = (d) => { if (/Local:|ready in/i.test(String(d))) { clearTimeout(t); resolve(child); } };
    child.stdout.on('data', on); child.stderr.on('data', (d) => { if (/EADDRINUSE|error/i.test(String(d))) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}

const on = await startVite(5192, true);
const off = await startVite(5193, false);
const b = await chromium.launch({ channel: CHANNEL, headless: true });
const errs = [];

async function openApp(url, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${url}: pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`${url}: console ${m.text()}`); });
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  return { ctx, p };
}

try {
  // ---- flag OFF: no new shell at all (the production default)
  {
    const { ctx, p } = await openApp('http://127.0.0.1:5193/');
    ok((await p.locator('#shell-nav').count()) === 0, 'flag off: #shell-nav does not exist (the production default stays the old dock/panel)');
    await ctx.close();
  }

  // ---- flag ON, desktop (1400x900, mouse): rail placement, labels shown, Tier 4
  {
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 1400, height: 900 } });
    const nav = p.locator('#shell-nav');
    ok((await nav.count()) === 1, 'flag on: #shell-nav exists');
    ok((await nav.getAttribute('data-placement')) === 'rail', 'desktop: rail placement');
    ok((await nav.getAttribute('data-labels')) === 'true', 'desktop: labels shown on the rail');
    const items = await nav.locator('[data-dest]').all();
    ok(items.length === 4, 'four destinations (Map, Trips, Explore, Profile)');
    const names = await Promise.all(items.map((i) => i.getAttribute('aria-label')));
    ok(names.join('|') === 'Map|Trips|Explore|Profile', 'named in order, each with an accessible aria-label');
    const box = await nav.boundingBox();
    ok(box.x === 0 && box.height > 700, 'rail spans the left edge, nearly the full height');
    await ctx.close();
  }

  // ---- flag ON, phone (390x844): bottom placement
  {
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const nav = p.locator('#shell-nav');
    ok((await nav.getAttribute('data-placement')) === 'bottom', 'phone: bottom bar placement');
    const box = await nav.boundingBox();
    ok(Math.abs(box.y + box.height - 844) < 2, 'bottom bar sits at the bottom edge');
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    ok(!overflow, 'no horizontal overflow with the bottom bar present');
    await ctx.close();
  }

  // ---- U-16: a touch-only tablet (1000x800, hasTouch, no hover) gets the compact rail, icon-only, 44px targets
  {
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 1000, height: 800 }, hasTouch: true, isMobile: false });
    const nav = p.locator('#shell-nav');
    ok((await nav.getAttribute('data-placement')) === 'rail', 'touch-only tablet (1000px): still a rail, not bottom nav');
    ok((await nav.getAttribute('data-labels')) === 'false', 'U-16: the touch-only tablet rail is icon-only (no visible labels)');
    const firstItem = nav.locator('.shell-nav-item').first();
    const box = await firstItem.boundingBox();
    ok(box.width >= 44 && box.height >= 44, 'U-16: minimum 44px touch target on the touch-only tablet rail');
    const labelBox = await nav.locator('.shell-nav-label').first().boundingBox();
    ok(labelBox === null || labelBox.width <= 1, 'the label text is visually hidden (clipped), not just styled small');
    const accessibleName = await firstItem.getAttribute('aria-label');
    ok(accessibleName === 'Map', 'the accessible name is still present for assistive tech even though the label is visually hidden');
    await ctx.close();
  }

  // ---- A non-touch device in the same 901-1200px band gets the labeled rail instead (the hover/pointer split, not a width-only rule)
  {
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 1000, height: 800 }, hasTouch: false, isMobile: false });
    const nav = p.locator('#shell-nav');
    ok((await nav.getAttribute('data-labels')) === 'true', 'a mouse/trackpad device at 1000px gets the labeled rail (hover split), not the touch-only compact one');
    await ctx.close();
  }

  // ---- adapter wiring: Trips opens the existing panel on its trips tab; Map closes it; nothing in panel.js/trips-ui.js was changed
  {
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 1400, height: 900 } });
    await p.click('#shell-nav [data-dest=trips]');
    ok(await p.isVisible('#panel') && await p.isVisible('#pane-trips'), 'Trips destination opens the existing Trips pane (temporary adapter, MAP/TRIP content unchanged)');
    ok((await p.getAttribute('#shell-nav [data-dest=trips]', 'aria-current')) === 'true', 'Trips shows as the current destination');
    await p.click('#shell-nav [data-dest=map]');
    ok(!(await p.isVisible('#panel')), 'Map destination closes the panel (the map is the default view)');
    await ctx.close();
  }

  // ---- S10.3: Map's quick actions (Layers, Saved Places) are adapters onto the existing panel tabs, hidden on every other destination
  {
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 1400, height: 900 } });
    ok(await p.locator('#shell-nav [data-action=layers]').isHidden() === false, 'Layers action is visible while Map is the current destination (the default)');
    ok(await p.locator('#shell-nav [data-action=places]').isHidden() === false, 'Saved Places action is visible while Map is current');
    await p.click('#shell-nav [data-action=layers]');
    ok(await p.isVisible('#panel') && await p.isVisible('#pane-config'), 'Layers opens the existing Map Configs pane unchanged');
    await p.click('#shell-nav [data-dest=trips]');
    ok(await p.locator('#shell-nav [data-action=layers]').isHidden(), 'Map actions hide once Trips becomes the current destination');
    await p.click('#shell-nav [data-dest=map]');
    await p.click('#shell-nav [data-action=places]');
    ok(await p.isVisible('#pane-poi'), 'Saved Places opens the existing POI pane unchanged');
    await ctx.close();
  }

  // ---- S10.4: Trips hero (TRIP-01), full-screen trip detail on a phone (TRIP-02), Back closes the detail instead of leaving the app (NAV-07)
  {
    const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const seededTrips = [{ id: 't1', name: 'Hubei spring', startDate: iso(2), endDate: iso(5), description: '', color: '#e91e63', created: '2026-01-01T00:00:00.000Z' }];
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(([tr]) => { localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr })); }, [seededTrips]);
    await p.goto('http://127.0.0.1:5192/', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
    await p.click('#shell-nav [data-dest=trips]');
    ok(await p.isVisible('#trips-hero .trip-card'), 'TRIP-01: the upcoming trip shows as a hero above the list');
    ok(await p.isVisible('#trips-list .trip-card'), 'TRIP-01: the same trip still shows in the full list (no duplication, one source)');
    ok(!(await p.locator('.sidepanel').evaluate((el) => el.classList.contains('tall'))), 'the sheet is not expanded while only the list shows');
    await p.click('#trips-hero .trip-card button:has-text("Open")');
    ok(await p.locator('.sidepanel').evaluate((el) => el.classList.contains('tall')), 'TRIP-02: opening a trip detail expands the phone sheet to full screen');
    await p.goBack();
    await p.waitForTimeout(300);
    ok(await p.isVisible('#trips-list') && (await p.isHidden('#trip-detail')), 'NAV-07: the browser Back button closes the trip detail and returns to the list');
    ok(!(await p.locator('.sidepanel').evaluate((el) => el.classList.contains('tall'))), 'the sheet collapses again once the detail closes');
    ok(await p.isVisible('#shell-nav'), 'NAV-07: Back closed the trip detail only - the app itself is still open');
    await ctx.close();
  }

  // ---- S10.7: Settings (SET-01..08) and the Activity bell (ACT-01..04) are global - always visible, on every destination, as adapters onto real, unmodified surfaces
  {
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 1400, height: 900 } });
    ok(await p.locator('#shell-nav [data-action=settings]').isVisible(), 'the Settings action is visible on Map');
    ok(await p.locator('#shell-nav [data-action=activity]').isVisible(), 'the Activity bell is visible on Map');
    await p.click('#shell-nav [data-dest=trips]');
    ok(await p.locator('#shell-nav [data-action=settings]').isVisible(), 'Settings stays visible on Trips (global, unlike the Map quick actions)');
    ok(await p.locator('#shell-nav [data-action=activity]').isVisible(), 'Activity stays visible on Trips too');
    await p.click('#shell-nav [data-dest=map]');
    await p.click('#shell-nav [data-action=settings]');
    ok(await p.isVisible('#panel') && await p.isVisible('#pane-settings'), 'SET-01: Settings opens its own panel tab');
    const headings = await p.locator('#pane-settings h3').allTextContents();
    ok(headings.join('|') === 'Map & display|Units & navigation|Privacy & location|Account & synchronization|Data management|Help & about', 'SET-01: the six named sections, in order');
    await p.click('#pane-settings .set-row:has-text("Privacy & location") button');
    ok(await p.isVisible('#privacy'), 'SET-04: the Privacy section opens the existing Privacy sub-panel unchanged');
    await p.click('#shell-nav [data-action=activity]');
    ok(await p.isVisible('#pane-activity'), 'ACT-01: the Activity bell opens its own panel tab (the same adaptive-sheet host)');
    ok(await p.locator('#pane-activity').getByText('Nothing waiting').count() === 1, 'ACT-02/ACT-03: with no pending items from any real source, the inbox says so rather than showing a fabricated row');
    await ctx.close();
  }

  // ---- S10.8: TRIP-03 - Use for new markers/Edit move behind a "More" disclosure on the trip card (new-shell only)
  {
    const seeded = [{ id: 't2', name: 'Overflow trip', startDate: null, endDate: null, description: '', color: '#2196f3', created: '2026-01-01T00:00:00.000Z' }];
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(([tr]) => { localStorage.setItem('uavzones.v1.trips', JSON.stringify({ v: 1, trips: tr })); }, [seeded]);
    await p.goto('http://127.0.0.1:5192/', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
    await p.click('#shell-nav [data-dest=trips]');
    const card = p.locator('#trips-list .trip-card', { hasText: 'Overflow trip' });
    ok(await card.getByRole('button', { name: 'Open' }).isVisible() && await card.getByRole('button', { name: 'Fit map' }).isVisible(), 'TRIP-03: Open and Fit map stay visible, primary actions');
    ok(await card.getByRole('button', { name: 'Edit' }).isHidden(), 'TRIP-03: Edit starts behind the More menu, not visible');
    await card.getByRole('button', { name: 'More' }).click();
    ok(await card.getByRole('menuitem', { name: 'Edit' }).isVisible() && await card.getByRole('menuitem', { name: 'Use for new markers' }).isVisible(), 'TRIP-03: the overflow menu holds Edit and Use for new markers');
    await ctx.close();
  }

  // ---- free-area integration: the rail is a cover, so a saved marker's host does not sit under it (NAV-09 cross-cutting rule)
  {
    const { ctx, p } = await openApp('http://127.0.0.1:5192/', { viewport: { width: 1400, height: 900 } });
    await p.click('#tab-poi').catch(() => {});
    await pickType(p, 'other');
    await p.click('#poi-place');
    await p.mouse.click(700, 450);
    await p.waitForSelector('.poi-pop form', { timeout: 8000 });
    await p.fill('.poi-pop input[type=text]', 'Shell nav check');
    await p.click('.poi-pop button[type=submit]');
    await p.waitForSelector('.poi-pop h3', { timeout: 8000 });
    const [navBox, hostBox] = await Promise.all([p.locator('#shell-nav').boundingBox(), p.locator('#marker-host').boundingBox()]);
    ok(hostBox.x >= navBox.x + navBox.width - 1, 'the marker host does not overlap the rail: free-area.js subtracts it as a cover');
    await ctx.close();
  }
} finally {
  await b.close();
  on.kill(); off.kill();
}

console.log(errs.length ? 'CONSOLE/PAGE ERRORS:\n' + errs.join('\n') : 'errors: none');
