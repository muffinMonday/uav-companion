// scripts/html-components.js: expansion, containment by registered names, diagnostics and the frozen source digest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assembleHtml } from '../scripts/html-components.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uav-html-components-'));
const dir = path.join(root, 'src/components');
fs.mkdirSync(dir, { recursive: true });
const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
const include = (name) => `<!-- include: ${name} -->\n`;
const pass = (text) => console.log('PASS  ' + text);
try {
  assert.equal(assembleHtml('<p>Plain HTML</p>\n<!-- ordinary comment -->', root), '<p>Plain HTML</p>\n<!-- ordinary comment -->');
  pass('HTML without includes is unchanged');
  write('search.html', '<div id="search">宜昌</div>\n');
  assert.equal(assembleHtml('<body>\n' + include('search.html') + '</body>', root), '<body>\n<div id="search">宜昌</div>\n</body>');
  pass('standalone include preserves attributes, Unicode and whitespace');
  write('panel.html', include('search.html'));
  assert.equal(assembleHtml('  ' + include('panel.html'), root), '<div id="search">宜昌</div>\n');
  pass('nested includes expand without additional wrappers or indentation');
  write('search.html', '<p>Edited, no final newline</p>');
  assert.equal(assembleHtml(include('search.html') + '<footer></footer>', root), '<p>Edited, no final newline</p>\n<footer></footer>');
  pass('each transform reads fresh content and keeps the include-line boundary');
  for (const name of ['../search.html', '/search.html', 'C:\\search.html', 'https://example.test/search.html', 'search.html?x', 'unknown.html', 'SEARCH.html']) {
    assert.throws(() => assembleHtml(include(name), root), /Unknown component/);
    pass(`unregistered name rejected: ${name}`);
  }
  write('panel.html', include('privacy-panel.html'));
  assert.throws(() => assembleHtml(include('panel.html'), root), /Cannot read "privacy-panel.html".*index.html -> panel.html -> privacy-panel.html/);
  pass('missing component error identifies the complete include chain');
  write('search.html', include('panel.html'));
  write('panel.html', include('search.html'));
  assert.throws(() => assembleHtml(include('search.html'), root), /Include cycle.*search.html -> panel.html -> search.html/);
  pass('indirect include cycle fails with the chain');
  write('panel.html', include('panel.html'));
  assert.throws(() => assembleHtml(include('panel.html'), root), /Include cycle/);
  pass('direct include cycle fails');
  for (const text of ['<div>' + include('search.html') + '</div>', '<!-- include search.html -->', '<!-- include:\nsearch.html -->', '<!-- include: search.html']) {
    assert.throws(() => assembleHtml(text, root), /Malformed include/);
    pass('malformed or non-standalone include fails instead of leaking into output');
  }
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/html-dom-baseline.json', import.meta.url), 'utf8'));
  const assembled = assembleHtml(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), ROOT).replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(assembled).digest('hex'), fixture.sourceSha256);
  pass('application assembly exactly matches frozen pre-extraction HTML (LF)');
} finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith('uav-html-components-'));
  fs.rmSync(root, { recursive: true, force: true });
}
