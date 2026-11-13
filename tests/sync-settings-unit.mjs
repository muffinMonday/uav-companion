// Synced settings (the colour theme) inside the cloud copy: the merge rules, and the engine across simulated devices. No browser, no network.
import { buildDoc, cleanSettings, mergeSettings, contentSig, sameContent, diffDocs } from '../src/sync/core.js';
import { createSync } from '../src/sync/engine.js';
import { makeCloud, memStorage } from './lib-sync.mjs';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const { createStore } = await import('../src/poi.js');
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const M = (id, name = id) => ({ id, name, lat: 30 + id.length / 10, lon: 114 });
const NOW = Date.now();
const T = (n) => NOW - 100000 + n * 1000; // increasing times in the past

// ---------- core: validation and merge
ok(cleanSettings({ theme: 'dark', themeAt: 5 })?.theme === 'dark' && cleanSettings({ theme: 'sepia', themeAt: 5 }) === null && cleanSettings({ theme: 'dark' }) === null && cleanSettings(null) === null && cleanSettings({ theme: 'dark', themeAt: -1 }) === null, 'cleanSettings keeps valid settings only');
ok(cleanSettings({ theme: 'dark', themeAt: NOW + 1e9 }, NOW).themeAt === NOW, 'a time in the future counts as now');
const d1 = { theme: 'dark', themeAt: T(1) }, l2 = { theme: 'light', themeAt: T(2) };
ok(mergeSettings(null, null).from === 'none' && mergeSettings(d1, null).from === 'local' && mergeSettings(null, d1).from === 'cloud', 'merge: nothing / only here / only in the cloud');
ok(mergeSettings(d1, l2).from === 'cloud' && mergeSettings(l2, d1).from === 'local' && mergeSettings(d1, { ...d1 }).from === 'none', 'merge: the later choice wins; equal times change nothing');
ok(mergeSettings(d1, { theme: 'bogus', themeAt: 99 }).from === 'local' && mergeSettings({ theme: 'x' }, d1).from === 'cloud', 'merge: an invalid side loses');
const base = { items: [M('a')], trips: [] };
ok(buildDoc(base).settings === undefined && buildDoc({ ...base, settings: d1 }).settings.theme === 'dark' && buildDoc({ ...base, settings: { theme: 'x' } }).settings === undefined, 'buildDoc adds settings only when valid');
ok(sameContent(buildDoc(base), buildDoc({ ...base, settings: d1 })) && contentSig(buildDoc(base)) === contentSig(buildDoc({ ...base, settings: d1 })), 'settings are not part of the content (sameContent, contentSig)');
ok(JSON.stringify(diffDocs(buildDoc(base), buildDoc({ ...base, settings: d1 })).markers) === JSON.stringify({ onlyLocal: 0, onlyCloud: 0, differ: 0, same: 1 }), 'diffDocs ignores settings');
ok(contentSig({ items: [M('a')], trips: [] }) !== contentSig({ items: [M('a', 'renamed')], trips: [] }) && contentSig({ items: [M('a'), M('b')], trips: [] }) === contentSig({ items: [M('b'), M('a')], trips: [] }), 'contentSig changes with the content, not the order');

// ---------- engine
function device(cloud, name, { user = { email: 'a@example.test' }, debounceMs = 10, theme = null } = {}) {
  const storage = memStorage(); globalThis.localStorage = storage;
  const store = createStore();
  const S = { v: theme, applied: [] };
  const settings = { get: () => S.v, apply: (x) => { S.v = x; S.applied.push(x); } };
  const changes = []; store.onChange((k) => changes.push(k));
  const sync = createSync({ store, adapter: cloud.adapter(user), storage, device: name, debounceMs, settings });
  return { store, sync, S, changes, choose(t, at) { S.v = { theme: t, themeAt: at }; sync.noteSettings(); } };
}
const cloudSettings = (c, u = 'a@example.test') => c.rows.get(u).doc.settings;
const cloudRev = (c, u = 'a@example.test') => c.rows.get(u).rev;

const c = makeCloud();
const A = device(c, 'laptop', { theme: d1 });
A.store.add(M('a'));
await A.sync.start();
ok(cloudSettings(c)?.theme === 'dark' && cloudSettings(c).themeAt === d1.themeAt, 'first upload carries the theme chosen here');

// a second, empty device takes the cloud copy and its theme
const B = device(c, 'phone');
await B.sync.start();
ok(B.store.items().length === 1 && B.S.v?.theme === 'dark' && B.S.v.themeAt === d1.themeAt, 'a new device adopts the cloud copy and its theme (with its own time)');

// B chooses light later: uploaded alone, no question, markers untouched
const rev0 = cloudRev(c);
B.choose('light', T(10)); await tick(150);
ok(cloudSettings(c)?.theme === 'light' && cloudRev(c) === rev0 + 1 && c.rows.get('a@example.test').doc.items.length === 1, 'a theme change uploads on its own; the markers in the cloud copy are untouched');
ok(B.sync.status().status === 'synced' && !B.sync.status().dirty && B.sync.status().baseRev === cloudRev(c), 'and the device stays synced and clean (its base moves with its own upload)');

// A comes back to the front: adopts the newer theme with no full sync, no question, no marker redraw
A.changes.length = 0;
await A.sync.checkSettings();
ok(A.S.v.theme === 'light' && A.S.v.themeAt === T(10) && A.sync.status().status === 'synced', 'the other device adopts the newer theme at the next look');
await A.sync.sync();
ok(A.changes.length === 0 && A.sync.status().baseRev === cloudRev(c) && !A.sync.status().dirty, 'a pull that only changed the theme does not touch the markers, and the device is up to date');

// the older choice never overwrites a newer one
A.S.v = { theme: 'dark', themeAt: T(5) }; A.sync.noteSettings(); await tick(150);
ok(cloudSettings(c).theme === 'light' && A.S.v.theme === 'light', 'an older local choice loses to the newer cloud one (and is replaced by it)');

// unsynced marker edits on A, then B changes the theme: A uploads on top, no question
const A2 = device(c, 'tablet', { debounceMs: 100000 });
await A2.sync.start();
A2.store.add(M('mine', 'Mine'));
B.choose('dark', T(20)); await tick(150);
await A2.sync.sync();
const doc = c.rows.get('a@example.test').doc;
ok(A2.sync.status().status === 'synced' && doc.items.some((i) => i.name === 'Mine') && doc.settings.theme === 'dark', 'edits here plus a theme change elsewhere: no question, both reach the cloud copy');

// a true marker conflict still asks, and a theme choice made meanwhile does not get through
const X = device(c, 'x1', { debounceMs: 100000 }), Y = device(c, 'y1', { debounceMs: 100000 });
await X.sync.start(); await Y.sync.start();
X.store.add(M('xx', 'X edit')); await X.sync.sync();
Y.store.add(M('yy', 'Y edit'));
await Y.sync.sync();
ok(Y.sync.status().status === 'ask', 'a real marker conflict still asks');
const revAsk = cloudRev(c);
Y.choose('light', T(30)); await Y.sync.sync(); await Y.sync.checkSettings();
ok(Y.sync.status().status === 'ask' && cloudRev(c) === revAsk, 'while a question is open nothing about the theme is uploaded');

// settings-only change on a device with no data and no cloud copy: nothing is created
const c2 = makeCloud();
const E = device(c2, 'empty', { theme: d1 });
await E.sync.start(); E.choose('light', T(40)); await tick(100);
ok(c2.rows.size === 0 && !c2.calls.includes('save'), 'no data and no cloud copy: a theme choice does not create a cloud copy');

// cloud copy from an older client (no settings) gets the local choice, once
const c3 = makeCloud();
const old = device(c3, 'old');
old.store.add(M('o')); await old.sync.start();
ok(cloudSettings(c3) === undefined, 'a device that never chose uploads no settings');
const nw = device(c3, 'new', { theme: d1 });
await nw.sync.start(); await tick(150); // the pull, then the settings upload after the usual pause
ok(nw.store.items().length === 1 && cloudSettings(c3)?.theme === 'dark', 'a device with a choice puts it into a cloud copy that has none');
const savesBefore = c3.calls.filter((x) => x === 'save').length;
await nw.sync.sync(); await nw.sync.sync();
ok(c3.calls.filter((x) => x === 'save').length === savesBefore, 'and does not upload it again');

// an old client rewrites the document without settings: the newer client puts them back at its next check
const oldAgain = device(c3, 'old2'); await oldAgain.sync.start(); // adopts the cloud copy
oldAgain.store.add(M('o2')); await oldAgain.sync.sync();
await nw.sync.sync(); // pulls the markers (and the settings the old client dropped are noticed as newer here)
await nw.sync.sync(); await tick(150);
ok(cloudSettings(c3)?.theme === 'dark', 'settings dropped by an old client come back from the newer client');

// forced push ("keep this device") keeps a newer cloud theme
const c4 = makeCloud();
const P = device(c4, 'p', { theme: { theme: 'dark', themeAt: T(1) } }), Q = device(c4, 'q');
P.store.add(M('p1')); await P.sync.start();
Q.store.add(M('q1')); await Q.sync.start(); // never synced, data on both: asks
ok(Q.sync.status().status === 'ask', 'never synced with data on both sides asks (unchanged)');
P.choose('light', T(50)); await tick(150);
await Q.sync.resolve('device', { backup: false });
ok(cloudSettings(c4).theme === 'light' && Q.S.v?.theme === 'light' && c4.rows.get('a@example.test').doc.items.some((i) => i.name === 'q1'), 'keeping this device replaces the markers but not a newer cloud theme');

for (const d of [A, B, A2, X, Y, E, old, nw, oldAgain, P, Q]) await d.sync.stop();
