// Build/dev DOM equivalence and real fragment reloads. Servers, cache, builds and edits are isolated from :5173.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, createServer, preview } from 'vite';
import config from '../vite.config.js';
import { assembleHtml, htmlComponents } from '../scripts/html-components.js';
import { chromium, CHANNEL, ROOT } from './lib.mjs';

const pass = (text) => console.log('PASS  ' + text);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'uav-html-dom-'));
const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/html-dom-baseline.json', import.meta.url), 'utf8')).elements;
const browser = await chromium.launch({ channel: CHANNEL });
let dev, prod, fixtureServer;
const url = (server) => `http://127.0.0.1:${server.httpServer.address().port}/`;
const check = async (page, html, label) => {
  assert(!/<!--\s*include\b/.test(html), `${label}: no unexpanded includes`);
  const actual = await page.evaluate((html) => {
    const d = new DOMParser().parseFromString(html, 'text/html');
    // These are Vite-generated asset tags only; all application elements/attributes/text remain in the comparison.
    for (const e of d.head.querySelectorAll('script[src], link[href]')) {
      const src = e.getAttribute('src'), href = e.getAttribute('href');
      if (src === '/@vite/client') e.remove();
      else if (src?.match(/^\.\/assets\/index-[\w-]+\.js$/)) {
        for (const a of [...e.attributes]) e.removeAttribute(a.name);
        e.setAttribute('type', 'module'); e.setAttribute('src', '/src/main.js');
      } else if (['stylesheet', 'modulepreload'].includes(e.getAttribute('rel')) && href?.startsWith('./assets/')) e.remove();
    }
    const all = [...d.querySelectorAll('*')];
    return all.map((e) => ({ tag: e.localName, parent: all.indexOf(e.parentElement), attrs: Object.fromEntries([...e.attributes].map((a) => [a.name, a.value]).sort()), text: [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() }));
  }, html);
  assert.deepEqual(actual, expected, label);
  const ids = actual.filter((e) => e.attrs.id).map((e) => e.attrs.id);
  assert.equal(new Set(ids).size, ids.length);
  pass(`${label}: original ancestry, ordering, attributes, text and unique IDs`);
};
const until = async (condition) => {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    assert(Date.now() < deadline, 'timed out waiting for fragment reload notification');
    await new Promise((resolve) => setTimeout(resolve, 20)); // condition polling, not a layout delay
  }
};
try {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const p = await ctx.newPage();
  await check(p, assembleHtml(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), ROOT), 'assembled source');
  dev = await createServer({ ...config, configFile: false, root: ROOT, logLevel: 'silent', cacheDir: path.join(temp, 'cache'), server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  await dev.listen();
  const documentRequests = [];
  p.on('request', (r) => { if (r.resourceType() === 'document') documentRequests.push(r.url()); });
  const response = await p.goto(url(dev));
  await check(p, await response.text(), 'Vite development response');
  assert.equal(documentRequests.length, 1, 'complete document arrives without fragment requests');
  pass('development serves a complete document without runtime fragment fetching');
  await build({ ...config, configFile: false, root: ROOT, logLevel: 'silent', publicDir: false, build: { outDir: path.join(temp, 'dist'), emptyOutDir: true } });
  prod = await preview({ ...config, configFile: false, root: ROOT, logLevel: 'silent', build: { outDir: path.join(temp, 'dist') }, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  const productionResponse = await p.goto(url(prod));
  await check(p, await productionResponse.text(), 'Vite production response');
  await ctx.close();

  // A disposable project exercises edits/deletion/recreation without touching app source or another test's server.
  const fixtureRoot = path.join(temp, 'fixture');
  const components = path.join(fixtureRoot, 'src/components');
  fs.mkdirSync(components, { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'index.html'), '<!doctype html>\n<html><head><title>Reload fixture</title></head><body>\n<!-- include: panel.html -->\n</body></html>\n');
  fs.writeFileSync(path.join(components, 'panel.html'), '<!-- include: search.html -->\n');
  const leaf = path.join(components, 'search.html');
  fs.writeFileSync(leaf, '<h1 id="probe">Before edit</h1>\n');
  fixtureServer = await createServer({ configFile: false, root: fixtureRoot, plugins: [htmlComponents()], logLevel: 'silent', cacheDir: path.join(temp, 'fixture-cache'), server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  const sent = [];
  const send = fixtureServer.ws.send.bind(fixtureServer.ws);
  fixtureServer.ws.send = (...args) => { sent.push(args[0]); return send(...args); };
  await fixtureServer.listen();
  const live = await browser.newPage();
  let connected = false, documents = 0;
  live.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { if (JSON.parse(payload).type === 'connected') connected = true; }));
  live.on('request', (r) => { if (r.resourceType() === 'document') documents++; });
  await live.goto(url(fixtureServer));
  await until(() => connected);
  await live.locator('#probe').filter({ hasText: 'Before edit' }).waitFor();
  fs.writeFileSync(leaf, '<h1 id="probe">After edit</h1>\n');
  await live.locator('#probe').filter({ hasText: 'After edit' }).waitFor();
  assert(documents >= 2, 'nested fragment edit triggers a document reload');
  pass('editing a nested fragment reloads an open browser page with fresh markup');
  await live.close();
  sent.length = 0;
  fs.unlinkSync(leaf);
  await until(() => sent.some((m) => m.type === 'full-reload' && m.path === '*'));
  const missing = await fetch(url(fixtureServer));
  assert.equal(missing.status, 500);
  assert.match(await missing.text(), /Cannot read.*search.html/);
  pass('deletion sends a reload and the next request reports the missing component');
  sent.length = 0;
  fs.writeFileSync(leaf, '<h1 id="probe">Restored</h1>\n');
  await until(() => sent.some((m) => m.type === 'full-reload' && m.path === '*'));
  const restored = await fetch(url(fixtureServer));
  assert.equal(restored.status, 200);
  assert.match(await restored.text(), /Restored/);
  pass('recreating a fragment sends a reload and recovers without restarting Vite');
  const fixtureBuild = path.join(temp, 'fixture-dist');
  await build({ configFile: false, root: fixtureRoot, plugins: [htmlComponents()], logLevel: 'silent', build: { outDir: fixtureBuild, emptyOutDir: true } });
  assert.match(fs.readFileSync(path.join(fixtureBuild, 'index.html'), 'utf8'), /Restored/);
  pass('nested fixture includes also expand during production build');
} finally {
  await browser.close();
  for (const server of [fixtureServer, prod, dev]) await server?.close();
  assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
  assert(path.basename(temp).startsWith('uav-html-dom-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
