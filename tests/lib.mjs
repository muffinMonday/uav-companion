// Shared by the test suites. Paths and the browser come from here, so nothing in a suite is machine-specific.
import fs from 'node:fs';
import path from 'node:path';

/** Project root, with forward slashes. */
export const ROOT = path.resolve(import.meta.dirname, '..').replace(/\\/g, '/');
/** Where suites write screenshots and downloads. Gitignored. */
export const OUT = `${ROOT}/tests/out`;
fs.mkdirSync(OUT, { recursive: true });
/** Playwright browser channel. The suites were written against Microsoft Edge; set BROWSER_CHANNEL=chrome to use Chrome. */
export const CHANNEL = process.env.BROWSER_CHANNEL || 'msedge';

// The browser, with the welcome screen switched off in every new context (it would cover the page the suites click on).
// The welcome suite uses playwright-core directly to see the real thing.
import { chromium as real } from 'playwright-core';
import { WHATS_NEW } from '../src/whatsnew.js';
import { HELP } from '../src/help-content.js';
import { TYPE_GROUPS } from '../src/poi.js';
/** The id of the newest What's new entry: what a returning visitor has already seen. Suites use it so announcing something new does not reopen the dashboard in every test. */
export const LATEST_SEEN = WHATS_NEW[0].id;
export const chromium = {
  async launch(options) {
    const browser = await real.launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async ({ addFolded, listFolded, ...opts } = {}) => {
      const ctx = await newContext({ reducedMotion: 'reduce', ...opts }); // moving elements make timing flaky; motion.mjs asks for it back
      // (the contextual hints are marked as seen too, or a hint at the top of a pane would move what the suites click on; the discover suite starts without them)
      await ctx.addInitScript(([seen, hints]) => { try { if (localStorage.getItem('uavzones.v1.dash') === null) localStorage.setItem('uavzones.v1.dash', JSON.stringify({ v: 1, showOnStart: false, welcomed: true, seen })); if (localStorage.getItem('uavzones.v1.help') === null) localStorage.setItem('uavzones.v1.help', JSON.stringify({ v: 1, seen: hints })); } catch { /* ignore */ } }, [LATEST_SEEN, HELP.map((h) => h.id)]);
      // Add a marker is folded on every page load (by design). The older suites click its controls, so they get it opened; `addFolded: true` keeps the real first state (the picker suite).
      if (!addFolded) await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => document.getElementById('poi-add')?.setAttribute('open', '')); });
      // The saved list starts with its trips and days folded (by design). The older suites click rows, so every fold button is pressed whenever the list is drawn; `listFolded: true` keeps the real first state.
      if (!listFolded) await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const l = document.getElementById('poi-list'); if (!l) return; const open = () => l.querySelectorAll('.sec-toggle[aria-expanded=false]:not(:disabled)').forEach((b) => b.click()); new MutationObserver(open).observe(l, { childList: true }); open(); }); });
      return ctx;
    };
    return browser;
  },
};

/** Chooses a marker type in the Add a marker picker, opening the group it lives in first. */
export async function pickType(p, id) {
  const g = TYPE_GROUPS.find((x) => x.types.includes(id)).id;
  if (await p.locator(`#poi-types [data-type=${id}]`).isHidden()) await p.click(`#type-tab-${g}`);
  await p.click(`#poi-types [data-type=${id}]`);
}

/** Opens the dashboard if it is tucked away, clicks something inside it, and folds it to the strip again. */
export async function dashClick(p, selector) {
  if (await p.locator('#dash').isHidden()) await p.locator('#dash-tab:visible, #dash-peek:visible').first().click();
  await p.waitForSelector('#dash:not([hidden])');
  if (await p.locator('#dash-back').count()) await p.click('#dash-back'); // back from Help to the default view
  await p.evaluate(() => { const d = document.querySelector('#dash .dash-data'); if (d) d.open = true; }); // import, export and share live in the folded data row
  await p.click(selector);
  await p.waitForTimeout(150);
  await p.click('#dash-collapse');
}

/** Presses one of the tools in the More tools menu (opening the menu first), then puts the menu away again unless `keepOpen`. */
export async function moreTool(p, tool, { keepOpen = false } = {}) {
  const isOpen = () => p.evaluate(() => !document.getElementById('more-tools-menu').hidden);
  if (!(await isOpen())) await p.click('.more-btn');
  await p.click(`#more-tools-menu .more-row[data-tool="${tool}"]`);
  if (!keepOpen && tool !== 'sessions' && (await isOpen())) await p.click('.more-btn');
}
