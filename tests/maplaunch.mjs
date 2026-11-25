// App-opening integration: real DOM events and navigation requests; no native app or external service needed.
import assert from 'node:assert/strict';
import { chromium, CHANNEL } from './lib.mjs';
const browser = await chromium.launch({ channel: CHANNEL });
const origin = 'http://localhost:5173';
try {
  for (const [platform, userAgent, prefix] of [
    ['Android Chrome', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 'intent:'],
    ['iPhone Chrome', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1', 'iosamap:'],
  ]) {
    const context = await browser.newContext({ userAgent });
    await context.route(`${origin}/maplaunch-test`, (r) => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await context.route('https://uri.amap.com/**', (r) => r.fulfill({ contentType: 'text/html', body: 'Web fallback' }));
    const p = await context.newPage(), requests = [];
    const cdp = await context.newCDPSession(p);
    await cdp.send('Page.enable');
    cdp.on('Page.frameRequestedNavigation', ({ url }) => requests.push(url));
    const setup = async () => {
      await p.goto(`${origin}/maplaunch-test`);
      await p.evaluate(async () => {
        const U = await import('/src/maplinks-ui.js'), L = await import('/src/maplinks.js');
        localStorage.setItem('uavzones.v1.prefs', JSON.stringify({ mapApp: 'auto', mapMode: 'walk' }));
        const point = { lat: 30.5928, lon: 114.3055, name: '黄鹤楼 & river' };
        const add = (id, control) => { const box = document.createElement('div'); box.id = id; box.append(control); document.body.append(box); };
        add('navigate', U.mapLinkIcons(point));
        add('session', U.sessionMapActions({ lat: point.lat, lng: point.lon, title: point.name }));
        add('place', U.linkButton({ label: 'Open in Amap', url: L.placeUrl('amap', point) }));
        add('home', U.mapLinkIcons({ ...point, home: true }));
        add('home-route', U.linkButton({ label: 'Home route', url: L.hereUrl('amap', point), confirm: true }));
        for (const node of U.routeLinks({ stops: [point, { lat: 30.6, lon: 114.4, name: 'Via' }, { lat: 30.7, lon: 114.5, name: 'End' }], mode: 'drive' })) add('route', node);
        add('outside', U.mapLinkIcons({ lat: 1.3, lon: 103.8, name: 'Singapore' }));
      });
    };
    for (const id of ['navigate', 'session', 'place', 'route', 'home', 'home-route']) {
      await setup();
      const control = p.locator(`#${id} .maplink`).first();
      if (!id.startsWith('home')) assert.match(await control.getAttribute('href'), /^https:\/\/uri\.amap\.com\//);
      else {
        const before = requests.length;
        await control.click();
        assert.match(await control.textContent(), /Tap again/);
        assert.equal(requests.length, before, 'first Home tap shares nothing');
      }
      const before = requests.length;
      await control.click();
      await p.waitForTimeout(100);
      assert.ok(requests.slice(before).some((url) => url.startsWith(prefix)), `${platform} ${id} requests native launch`);
      console.log(`PASS  ${platform}: ${id} launches Amap directly, preserving HTTPS copy links / Home confirmation`);

    }
    await setup();
    const href = await p.locator('#outside a').getAttribute('href');
    assert.match(href, /google.com\/maps/);
    // A listener after the control sees whether our app-first handler consumed the event;
    // then blocks browser default navigation so modified-click tests cannot contact providers.
    const clicks = await p.evaluate(() => {
      const a = document.querySelector('#navigate a'), seen = [];
      a.addEventListener('click', (e) => { seen.push(e.defaultPrevented); e.preventDefault(); });
      for (const opts of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...opts }));
      return seen;
    });
    assert.deepEqual(clicks, [false, false, false, false, false]);
    console.log(`PASS  ${platform}: outside-China selection and modified clicks retain existing behavior`);
    await context.close();
  }
} finally { await browser.close(); }
