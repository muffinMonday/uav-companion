// The local log store, the logger and the global error handlers (src/logstore.js, src/log.js, src/errors.js). No browser: storage is a memory backend or a failing one.
import { createLogStore, memoryBackend, idbBackend, rotation, LIMITS } from '../src/logstore.js';
import { createLog, applyDebugParam, readDebug, DEBUG_KEY } from '../src/log.js';
import { installErrorHandlers } from '../src/errors.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const DAY = 24 * 3600 * 1000;
const entry = (id, extra = {}) => ({ id, t: id, level: 'warn', src: 'test', msg: 'm' + id, data: {}, count: 1, ...extra });
const manual = () => { const q = []; return { schedule: (fn) => q.push(fn), run: async () => { while (q.length) q.shift()(); }, q }; };

// ---------- rotation
{
  const now = 100 * DAY, lim = { maxEntries: 3, maxBytes: 1e9, maxAgeMs: 7 * DAY };
  const es = [entry(now - 10 * DAY), entry(now - 3), entry(now - 2), entry(now - 1), entry(now)];
  const drop = rotation(es, lim, now);
  ok(drop.includes(now - 10 * DAY) && drop.includes(now - 3) && drop.length === 2, 'old entries go, then the oldest beyond the count limit');
  const big = [entry(1, { msg: 'x'.repeat(100) }), entry(2, { msg: 'x'.repeat(100) }), entry(3, { msg: 'x'.repeat(100) })];
  ok(rotation(big, { maxEntries: 99, maxBytes: 300, maxAgeMs: 1e12 }, 10).length >= 1, 'the size limit removes the oldest');
  ok(rotation([], lim, now).length === 0 && LIMITS.maxEntries === 500 && LIMITS.maxBytes === 200 * 1024 && LIMITS.maxAgeMs === 7 * DAY, 'defaults are 500 entries, 200 KB, 7 days');
}

// ---------- store
{
  const be = memoryBackend(), m = manual();
  let now = 1000;
  const s = createLogStore({ backend: be, schedule: m.schedule, now: () => now, limits: { maxEntries: 5 } });
  for (let i = 1; i <= 8; i++) s.put(entry(i));
  ok((await be.getAll()).length === 0, 'put does not write at once (queued)');
  ok(m.q.length === 1, 'one save is scheduled for a burst of puts');
  await m.run(); await s.flush();
  const r = await s.recent();
  ok(r.length === 5 && r[0].id === 4 && r[4].id === 8, 'after a save the newest 5 remain, oldest first');
  s.put(entry(8, { count: 4 })); await s.flush();
  const r2 = await s.recent();
  ok(r2.length === 5 && r2.find((e) => e.id === 8).count === 4, 'an entry with a known id is replaced (repeat count)');
  s.put({ ...entry(9), msg: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig12345 lat=30.5', data: { lat: 30.5, status: 2 } }); await s.flush();
  const last = (await s.recent()).pop();
  ok(!/eyJ|30\.5/.test(JSON.stringify(last)) && last.data.status === 2, 'the store scrubs what it is given');
  const ex = JSON.parse(await s.exportJson());
  ok(ex.entries.length === 5 && ex.limits.maxEntries === 5 && typeof ex.exported === 'string', 'export is JSON with the entries and the limits');
  const st = await s.stats();
  ok(st.entries === 5 && st.bytes > 0 && st.persistent === true, 'stats report entries, bytes and persistence');
  await s.clear();
  ok((await s.recent()).length === 0 && (await be.getAll()).length === 0, 'clear empties the store');
}

// ---------- a store that fails falls back to memory and never throws
{
  const bad = { putMany: async () => { throw new Error('quota'); }, getAll: async () => { throw new Error('x'); }, deleteMany: async () => {}, clear: async () => { throw new Error('x'); } };
  const s = createLogStore({ backend: bad, schedule: (fn) => fn(), now: () => 1000 });
  let threw = false;
  try { s.put(entry(1)); s.put(entry(2)); await s.flush(); await s.clear(); s.put(entry(3)); } catch { threw = true; }
  const r = await s.recent();
  ok(!threw && r.length === 1 && r[0].id === 3, 'a failing backend leaves a working memory store');
  ok((await s.stats()).persistent === false, 'and stats say it is not persistent');
  const none = createLogStore({ backend: null, schedule: (fn) => fn(), now: () => 1000 });
  none.put(entry(1)); ok((await none.recent()).length === 1, 'without IndexedDB the log is kept in memory');
  const boom = createLogStore({ backend: memoryBackend(), schedule: () => { throw new Error('no scheduler'); } });
  let t2 = false; try { boom.put(entry(1)); } catch { t2 = true; }
  ok(!t2, 'a failing scheduler does not break put');
}

// ---------- IndexedDB that throws when reached
{
  const had = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new Error('blocked'); } });
  let threw = false, be; try { be = idbBackend(); } catch { threw = true; }
  if (had) Object.defineProperty(globalThis, 'indexedDB', had); else delete globalThis.indexedDB;
  ok(!threw && be === null, 'an indexedDB that throws when reached gives no backend instead of breaking start-up');
}

// ---------- the logger
{
  const be = memoryBackend();
  const sink = createLogStore({ backend: be, schedule: () => {}, now: () => 5_000_000 });
  let now = 5_000_000, dbg = false;
  const con = []; const mirror = { error: (...a) => con.push(['error', ...a]), warn: (...a) => con.push(['warn', ...a]), log: (...a) => con.push(['log', ...a]) };
  const log = createLog({ sink, debug: () => dbg, now: () => now, mirror });
  log.debug('a', 'quiet'); log.info('a', 'quiet too');
  ok((await sink.recent()).length === 0, 'DEBUG and INFO are dropped at the default WARN level');
  log.warn('live', 'poll failed', { status: 503, lat: 30.1, token: 'x' });
  log.error('sync', 'boom', new TypeError('bad thing at https://x.test/p?token=abc'));
  let r = await sink.recent();
  ok(r.length === 2 && r[0].level === 'warn' && r[0].data.status === 503 && !('lat' in r[0].data), 'WARN and ERROR are kept with scrubbed data');
  ok(r[1].data.error_name === 'TypeError' && !/token=abc/.test(r[1].msg) && r[1].stack, 'an Error gives error_name, a scrubbed message and a stack');
  ok(con.length === 1 && con[0][0] === 'error', 'errors still reach the console; warnings do not at WARN level');
  now += 1000; log.warn('live', 'poll failed', { status: 503 }); now += 1000; log.warn('live', 'poll failed');
  r = await sink.recent();
  ok(r.length === 2 && r.find((e) => e.src === 'live').count === 3, 'the same message within a minute raises a count: ' + r.find((e) => e.src === 'live').count);
  now += 61_000; log.warn('live', 'poll failed');
  ok((await sink.recent()).filter((e) => e.src === 'live').length === 2, 'after a minute it is a new entry');
  dbg = true; log.debug('a', 'now visible'); log.child('kid').info('child works');
  r = await sink.recent();
  ok(r.some((e) => e.msg === 'now visible') && r.some((e) => e.src === 'kid'), 'with debug on, DEBUG and INFO are kept (and child loggers work)');
  ok(con.some((c) => c[0] === 'log' || c[0] === 'warn' || c[1]?.includes('now visible')), 'and are mirrored to the console while debugging');
  const e = new Error('x'); log.error('a', 'once', e);
  ok(log.seen(e) && !log.seen(new Error('x')) && !log.seen(null) && !log.seen('s'), 'seen() recognises an error that was logged');
  const throwing = createLog({ sink: { put() { throw new Error('sink down'); } }, debug: () => true, mirror: { error() { throw new Error('console down'); }, log() { throw new Error('x'); } } });
  let threw = false; try { throwing.error('a', 'x'); throwing.warn('a', 'y', new Error('z')); throwing.debug('a', { toString() { throw 1; } }); } catch { threw = true; }
  ok(!threw, 'a failing sink or console never makes the logger throw');
  let n = 0; const inner = createLog({ sink: { put() { n++; inner.error('a', 'again'); } }, mirror: null });
  inner.error('a', 'outer'); ok(n === 1, 'logging from inside the sink does not recurse');
}

// ---------- debug flag
{
  const mem = new Map(); const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  ok(applyDebugParam('?debug=1', st) === true && mem.get(DEBUG_KEY) === '1', '?debug=1 turns debug on and remembers it');
  ok(applyDebugParam('?other=1', st) === true && readDebug(st) === true, 'the flag persists without the parameter');
  ok(applyDebugParam('?debug=0', st) === false && !mem.has(DEBUG_KEY), '?debug=0 turns it off');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  ok(applyDebugParam('?debug=1', blocked) === false && readDebug(blocked) === false, 'blocked storage leaves debug off without throwing');
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  let threw = false, r1, r2; try { r1 = applyDebugParam('?debug=1'); r2 = readDebug(); } catch { threw = true; }
  if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  ok(!threw && r1 === false && r2 === false, 'a localStorage that throws when reached (blocked site data) is survived');
}

// ---------- global handlers
{
  const handlers = {};
  const target = { addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener: (t) => { delete handlers[t]; } };
  const sink = createLogStore({ backend: memoryBackend(), schedule: () => {}, now: () => 1e9 });
  const con = []; const log = createLog({ sink, now: () => 1e9, mirror: { error: (...a) => con.push(a), log() {} } });
  const off = installErrorHandlers({ target, log });
  ok(typeof handlers.error === 'function' && typeof handlers.unhandledrejection === 'function', 'both listeners are added with addEventListener');
  let prevented = false, stopped = false;
  const ev = (o) => ({ preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; }, stopImmediatePropagation: () => { stopped = true; }, ...o });
  handlers.error(ev({ target, message: 'Uncaught TypeError: x is not a function', error: new TypeError('x is not a function') }));
  handlers.error(ev({ target, message: 'ResizeObserver loop completed with undelivered notifications.' }));
  handlers.error(ev({ target, message: 'Script error.' }));
  handlers.error(ev({ target: { tagName: 'IMG' }, message: '' })); // a resource failed to load
  const caught = new Error('handled then rethrown'); log.error('app', 'could not do it', caught);
  handlers.error(ev({ target, message: 'Uncaught Error: handled then rethrown', error: caught }));
  handlers.unhandledrejection(ev({ reason: new RangeError('bad range') }));
  handlers.unhandledrejection(ev({ reason: 'plain string reason' }));
  handlers.unhandledrejection(ev({ reason: { secret: 'token' } }));
  const r = await sink.recent();
  ok(r.filter((e) => e.src === 'window').length === 4, 'uncaught error, two rejections and one non-error rejection are logged; noise, resource errors and rethrown errors are not: ' + r.map((e) => e.src + ':' + e.msg).join(' | '));
  ok(r.filter((e) => e.src === 'app').length === 1, 'the earlier caught-and-logged error is there once');
  ok(!prevented && !stopped, 'the handlers never prevent the default or stop propagation');
  ok(con.every((c) => !String(c[0]).startsWith('[window]')), 'the handlers do not repeat the error on the console');
  ok(!r.some((e) => JSON.stringify(e).includes('token')), 'a rejection value that is an object is not stored');
  const burst = (n) => { for (let i = 0; i < n; i++) handlers.error(ev({ target, message: 'same', error: new Error('same failure') })); };
  burst(5);
  const r2 = (await sink.recent()).filter((e) => e.msg.includes('same failure'));
  ok(r2.length === 1 && r2[0].count === 5, 'a burst of the same error is one entry with a count');
  const broken = installErrorHandlers({ target: { addEventListener: (t, f) => { handlers['b' + t] = f; }, removeEventListener() {} }, log: { error() { throw new Error('log down'); }, seen() { throw new Error('x'); } } });
  let threw = false; try { handlers.berror(ev({ target: undefined, message: 'm', error: new Error('e') })); handlers.bunhandledrejection(ev({ reason: new Error('r') })); } catch { threw = true; }
  ok(!threw, 'a failing logger never makes a handler throw');
  off(); ok(!handlers.error && !handlers.unhandledrejection, 'the returned function removes the listeners');
}
