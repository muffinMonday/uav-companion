// Back-off for repeated requests (src/backoff.js) and where it is used: the live sender and poll, and the progression list call. No browser, no network.
import { createBackoff } from '../src/backoff.js';
import { createLive } from '../src/live.js';
import { createProgression } from '../src/progression-api.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

// ---------- the helper
let t = 0;
const b = createBackoff({ base: 1000, max: 8000, jitter: 0, now: () => t });
ok(b.ready() && b.failures() === 0, 'ready at the start');
ok(b.fail() === 1000 && !b.ready(), 'the first failure waits the base time');
t += 1000; ok(b.ready(), 'and is ready when it is over');
ok(b.fail() === 2000 && b.fail() === 4000 && b.fail() === 8000 && b.fail() === 8000, 'each failure doubles the wait, up to the maximum');
b.ok(); ok(b.ready() && b.failures() === 0 && b.fail() === 1000, 'a success resets it');
const j = createBackoff({ base: 1000, max: 8000, jitter: 0.25, now: () => t, rand: () => 0 });
const jh = createBackoff({ base: 1000, max: 8000, jitter: 0.25, now: () => t, rand: () => 1 });
ok(j.fail() === 750 && jh.fail() === 1250, 'jitter varies the wait by 25 % either way');

// ---------- the live engine: a failing sender is not retried on every position
{
  let now = 1_000_000, sends = 0, fails = true;
  const watchers = [];
  const geo = { watchPosition: (ok2) => { watchers.push(ok2); return 1; }, clearWatch: () => {} };
  const api = { shareLocation: async () => { sends++; if (fails) throw new Error('network down'); return { status: 'ok' }; }, stopSharing: async () => {}, stopAll: async () => {}, live: async () => [] };
  const eng = createLive({ api, geo, getTrip: () => ({}), now: () => now, pollMs: 100000, minMs: 5000, keepMs: 15000 });
  let step = 0; const pos = () => watchers.forEach((w) => w({ coords: { latitude: 30 + (step++) * 0.0001, longitude: 114, accuracy: 10 } })); // 11 m further each time
  const tick = () => new Promise((r) => setTimeout(r, 5));
  eng.start('t1'); pos(); await tick();
  ok(sends === 1, 'the first position is sent');
  for (let i = 0; i < 20; i++) { now += 1000; pos(); await tick(); } // 20 s of positions while the server is unreachable
  ok(sends <= 4, 'while sends fail, positions are not all sent: ' + sends + ' sends in 20 s of positions (not 20)');
  fails = false; now += 70000; pos(); await tick();
  ok(sends >= 2 && eng.snapshot().sharing.t1.status === 'ok', 'after the wait, a send that works clears the error');
  now += 6000; pos(); await tick(); const after = sends; now += 6000; pos(); await tick();
  ok(sends === after + 1, 'and sending is back to the normal pace');
  await eng.stopAll();
}

// ---------- the live engine: one poll at a time, and a failing poll waits
{
  let calls = 0, release, fails = false, now = 0;
  const api = { live: () => { calls++; if (fails) return Promise.reject(new Error('down')); return new Promise((r) => { release = () => r([]); }); }, stopAll: async () => {}, stopSharing: async () => {} };
  const eng = createLive({ api, geo: null, now: () => now, pollMs: 1000 });
  const p1 = eng.poll(), p2 = eng.poll();
  ok(calls === 1 && p1 === p2, 'a poll asked for while one is running shares it');
  release(); await p1;
  ok(eng.snapshot().error === null, 'it answers normally');
  fails = true; await eng.poll();
  ok(eng.snapshot().error === 'down', 'a failing poll reports the error');
  // the timer skips ticks during the wait
  let ticks = 0; const orig = api.live; api.live = () => { ticks++; return orig(); };
  eng.startPolling(() => true);
  await new Promise((r) => setTimeout(r, 2300)); // real timers: two or three ticks of 1 s
  eng.stopPolling();
  ok(ticks === 0, 'while waiting after a failure the timer makes no request (' + ticks + ')');
}

// ---------- progression: a failing list call is not repeated at once
{
  let now = 0, calls = 0, fail = true;
  const client = { rpc: async () => { calls++; return fail ? { data: null, error: { message: 'boom' } } : { data: [], error: null }; } };
  const prog = createProgression(client, () => now);
  const ids = ['a', 'b'];
  let threw = 0;
  await prog.many('member', ids).catch(() => { threw++; });
  await prog.many('member', ids).catch(() => { threw++; });
  await prog.many('member', ids).catch(() => { threw++; });
  ok(calls === 1 && threw === 3, 'after one failure, later calls fail at once without asking the database (' + calls + ' call)');
  now += 200_000; fail = false;
  const m = await prog.many('member', ids);
  ok(calls === 2 && m.get('a').visible === false, 'after the wait it asks again');
}
