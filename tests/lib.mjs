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
