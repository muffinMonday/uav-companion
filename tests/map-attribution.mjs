// Exercise the original Leaflet credit lifecycle inside the compact disclosure.
import assert from 'node:assert/strict';
import { chromium, CHANNEL } from './lib.mjs';

const browser = await chromium.launch({ channel: CHANNEL });
try {
  for (const viewport of [{ width: 360, height: 640 }, { width: 1280, height: 800 }, { width: 640, height: 360 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/__attribution_test__', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <link rel="stylesheet" href="/node_modules/leaflet/dist/leaflet.css">
      <link rel="stylesheet" href="/src/styles.css">
      <div id="map" style="position:fixed;inset:0"></div>
      <script type="module">
        import * as L from '/node_modules/leaflet/dist/leaflet-src.esm.js';
        import { initMapAttribution } from '/src/map-attribution.js';
        import { createExplorer } from '/src/sessions-map-explorer.js';
        const map = L.map('map').setView([1.3, 103.8], 10);
        initMapAttribution(map);
        const base = L.layerGroup([], { className: 'base-tiles', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
        const zones = L.layerGroup([], { attribution: 'Zones: CAAM / CAAS' }).addTo(map);
        const explorer = createExplorer({ map, getItems: () => [] });
        window.fixture = { map, base, zones, explorer };
      </script>` }));
    await page.goto('http://localhost:5173/__attribution_test__');
    await page.waitForFunction(() => !!window.fixture);
    const control = page.locator('.map-attribution');
    const toggle = page.getByLabel('Map credits');
    const credits = page.locator('.leaflet-control-attribution');
    assert.equal(await control.count(), 1);
    assert.equal(await credits.isVisible(), false, 'full attribution starts collapsed');
    assert.equal(await page.locator('.map-base-attribution').count(), 0, 'no duplicate persistent bottom-right credit');
    assert.equal(await page.locator('.leaflet-bottom.leaflet-right .leaflet-control-attribution, .leaflet-bottom.leaflet-right .map-attribution').count(), 0, 'nothing credit-like at bottom right');
    assert.equal(await page.locator('.leaflet-bottom .leaflet-control-attribution').count(), 0);
    const closed = await control.boundingBox();
    assert(closed.width <= 36 && closed.height <= 36, 'closed control reclaims map space');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await credits.waitFor({ state: 'visible' });
    assert.match(await credits.innerText(), /Leaflet.*OpenStreetMap.*CAAM \/ CAAS/s);
    assert.equal(await credits.locator('a[href="https://www.openstreetmap.org/copyright"]').count(), 1);
    const box = await credits.boundingBox();
    assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
    await page.evaluate(() => window.fixture.map.removeLayer(window.fixture.zones));
    assert(!/CAAM/.test(await credits.innerText()), 'removed layers release their credits');
    assert(await control.getAttribute('open') !== null, 'layer updates keep the disclosure open');
    await page.evaluate(() => window.fixture.zones.addTo(window.fixture.map));
    assert.match(await credits.innerText(), /CAAM \/ CAAS/);
    await page.evaluate(() => {
      const { map, base } = window.fixture;
      map.removeLayer(base);
      base.options.attribution = '&copy; Go Tiles by WP Go Maps | &copy; OpenStreetMap contributors';
      base.addTo(map);
    });
    assert.match(await credits.innerText(), /Go Tiles by WP Go Maps.*OpenStreetMap/s);
    assert.match(await credits.innerText(), /Go Tiles by WP Go Maps/);
    await page.keyboard.press('Escape');
    assert.equal(await credits.isVisible(), false);
    assert(await toggle.evaluate((e) => e === document.activeElement));
    await toggle.click();
    await page.mouse.click(viewport.width - 10, viewport.height - 10);
    assert.equal(await credits.isVisible(), false, 'outside press closes credits');
    await page.evaluate(() => window.fixture.explorer.open());
    await page.locator('#ses-explorer').waitFor({ state: 'visible' });
    await toggle.click();
    assert(await credits.isVisible(), 'credits work while the Flight Sessions dock is open');
    for (const element of [toggle]) {
      assert(await element.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), 'attribution remains above or beside the session sheet/side panel');
    }
    await page.evaluate(() => window.fixture.explorer.close());
    await page.evaluate(() => window.fixture.map.remove());
    assert.deepEqual(errors, [], 'no errors during layer updates or map cleanup');
    console.log(`PASS  compact attribution, keyboard, bounds, live credits and cleanup at ${viewport.width}×${viewport.height}`);
    await context.close();
  }
} finally {
  await browser.close();
}
