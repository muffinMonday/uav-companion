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
export const chromium = {
  async launch(options) {
    const browser = await real.launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (opts) => {
      const ctx = await newContext(opts);
      await ctx.addInitScript(() => { try { if (localStorage.getItem('uavzones.v1.welcome') === null) localStorage.setItem('uavzones.v1.welcome', JSON.stringify({ v: 1, show: false })); } catch { /* ignore */ } });
      return ctx;
    };
    return browser;
  },
};
