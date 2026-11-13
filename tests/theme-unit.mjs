// Colour theme: the resolve rule, the prefs fields, and the script in index.html that applies it before first paint (must agree with resolveTheme).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ls = {}; globalThis.localStorage = { getItem: (k) => ls[k] ?? null, setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } };
const { resolveTheme } = await import('../src/theme.js');
const { loadPrefs, savePrefs } = await import('../src/prefs.js');
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

// ---------- resolveTheme
ok(resolveTheme('light', true) === 'light' && resolveTheme('dark', false) === 'dark', 'a chosen light or dark wins over the device');
ok(resolveTheme('system', true) === 'dark' && resolveTheme('system', false) === 'light', 'system follows the device');
ok(resolveTheme(undefined, true) === 'dark' && resolveTheme('bogus', false) === 'light' && resolveTheme(null, true) === 'dark', 'unset or damaged counts as system');

// ---------- prefs fields
ok(loadPrefs().theme === undefined, 'nothing chosen: no theme stored');
savePrefs({ theme: 'dark', themeAt: 1700000000000 });
ok(loadPrefs().theme === 'dark' && loadPrefs().themeAt === 1700000000000, 'theme and its time are kept');
savePrefs({ theme: 'sepia' });
ok(loadPrefs().theme === undefined && loadPrefs().themeAt === undefined, 'an unknown theme is dropped, with its time');
savePrefs({ theme: 'system', themeAt: -5 });
ok(loadPrefs().theme === 'system' && loadPrefs().themeAt === undefined, 'system is a choice; a bad time is dropped');
savePrefs({ theme: 'light', themeAt: 'x' });
ok(loadPrefs().theme === 'light' && loadPrefs().themeAt === undefined, 'a non-number time is dropped');

// ---------- the inline script in index.html gives the same answer as resolveTheme
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/<script>([^<]*uavzones\.v1\.prefs[^<]*)<\/script>/);
ok(!!m, 'index.html has the before-first-paint theme script');
let same = !!m;
for (const stored of [undefined, 'system', 'light', 'dark', 'bogus']) {
  for (const sysDark of [false, true]) {
    const store = stored === undefined ? '{}' : JSON.stringify({ theme: stored });
    const root = { dataset: {} };
    vm.runInNewContext(m[1], { localStorage: { getItem: () => store }, matchMedia: () => ({ matches: sysDark }), document: { documentElement: root } });
    if (root.dataset.theme !== resolveTheme(stored, sysDark)) { same = false; console.log('  differs for', stored, sysDark, root.dataset.theme); }
  }
}
ok(same, 'the inline script and resolveTheme agree for every stored value and device setting');
const broken = { dataset: {} };
vm.runInNewContext(m[1], { localStorage: { getItem: () => '{not json' }, matchMedia: () => ({ matches: true }), document: { documentElement: broken } });
ok(broken.dataset.theme === undefined, 'damaged storage: the script does not throw (theme.js applies it afterwards)');
