// The app side of automatic attendance (src/session-arrival.js): which sessions the sampler reports for, when it runs and stops, what it says, and that the toast follows only a confirmed award.
// A fake clock, fake timers and a fake server. No browser.
import { eligibleSessions, nextStart, awardToast, sampleDelay, ARRIVAL_TEXT, createArrival } from '../src/session-arrival.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const H = 3600_000, T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const S = (o = {}) => ({ id: 's1', status: 'scheduled', iRsvped: true, isHost: false, myAttended: false, lat: 30, lng: 114, startsAt: new Date(T0 - H).toISOString(), endsAt: new Date(T0 + H).toISOString(), ...o });

// ---------- which sessions
ok(eligibleSessions([S()], T0).length === 1, 'a joined session under way is eligible');
for (const [name, o] of [['not joined', { iRsvped: false }], ['hosted by the person', { isHost: true }], ['already attended', { myAttended: true }], ['cancelled', { status: 'cancelled' }], ['no point', { lat: null }], ['not started', { startsAt: new Date(T0 + H).toISOString(), endsAt: new Date(T0 + 2 * H).toISOString() }], ['ended', { startsAt: new Date(T0 - 3 * H).toISOString(), endsAt: new Date(T0 - 2 * H).toISOString() }]]) ok(eligibleSessions([S(o)], T0).length === 0, 'not eligible: ' + name);
ok(eligibleSessions([S()], T0, new Set(['s1'])).length === 0, 'a session already answered finally is skipped');

// ---------- text and toast
ok(awardToast({ status: 'awarded', xp: 50 }) === 'Attendance confirmed: +50 XP earned.', 'the toast names the awarded XP');
for (const r of [{ status: 'awarded', xp: 0 }, { status: 'attended', xp: 0 }, { status: 'already_attended' }, { status: 'waiting' }, { status: 'tracking' }, null, undefined, { status: 'awarded' }, { status: 'awarded', xp: -5 }]) ok(awardToast(r) === null, 'no toast for ' + JSON.stringify(r));
ok(sampleDelay(30) === 35000 && sampleDelay(10) === 30000 && sampleDelay(90) === 60000 && sampleDelay(undefined) === 35000, 'the sample delay stays within 30 to 60 seconds');
ok(!/XP/.test(ARRIVAL_TEXT.waiting + ARRIVAL_TEXT.tracking + ARRIVAL_TEXT.checking + ARRIVAL_TEXT.too_far), 'progress text never mentions an XP award');

// ---------- the controller
function rig(over = {}) {
  const r = { calls: [], toasts: [], timers: [], cfg: { enabled: true, consented: true, spacing_s: 30, accuracy_m: 50 }, pref: true, signed: true, vis: true, now: T0, list: [S()], answers: [{ status: 'tracking', count: 1 }], pos: { lat: 30, lng: 114, accuracy: 10 }, posError: null, consentCalls: [], ...over };
  const api = { arrivalConfig: async () => r.cfg, recordConsent: async () => { r.consentCalls.push('on'); r.cfg = { ...r.cfg, consented: true }; return {}; }, withdrawConsent: async () => { r.consentCalls.push('off'); r.cfg = { ...r.cfg, consented: false }; return {}; }, submitArrival: async (id, la, ln, ac) => { r.calls.push([id, la, ln, ac]); return r.answers.length > 1 ? r.answers.shift() : r.answers[0]; } };
  r.a = createArrival({ api, candidates: () => r.list, signedIn: () => r.signed, pref: () => r.pref, setPref: (v) => { r.pref = v; }, toast: (t) => r.toasts.push(t), position: async () => { if (r.posError) throw r.posError; return r.pos; }, now: () => r.now, visible: () => r.vis, setTimer: (fn, ms) => { r.timers.push({ fn, ms }); return r.timers.length; }, clearTimer: (id) => { if (r.timers[id - 1]) r.timers[id - 1].dead = true; } });
  r.fire = async () => { const t = [...r.timers].reverse().find((x) => !x.dead && !x.fired); if (!t) return false; t.fired = true; await t.fn(); await new Promise((res) => setTimeout(res, 0)); return true; };
  return r;
}
let r = rig();
await r.a.refresh();
ok(r.timers.length === 1 && r.timers[0].ms === 1500, 'refresh starts a first sample soon');
await r.fire();
ok(r.calls.length === 1 && r.calls[0].join() === 's1,30,114,10' && r.a.state().status === 'tracking' && r.timers.at(-1).ms === 35000, 'a sample sends the position and the next one is scheduled');
ok(r.toasts.length === 0 && /Keep this page open/.test(r.a.state().text), 'tracking shows progress text and no toast');
r.answers = [{ status: 'waiting' }]; await r.fire();
ok(r.a.state().status === 'waiting' && r.toasts.length === 0, 'waiting for others: still no toast');
r.answers = [{ status: 'awarded', xp: 50 }]; await r.fire();
ok(r.toasts.join() === 'Attendance confirmed: +50 XP earned.' && r.a.state().status === 'awarded', 'the toast comes only with the server\'s awarded answer');
ok(!r.timers.some((t) => !t.dead && !t.fired), 'after the award nothing is scheduled: the sampler stops');
await r.fire(); ok(r.calls.length === 3, 'and no further sample is sent');

r = rig({ answers: [{ status: 'awarded', xp: 0 }] }); await r.a.refresh(); await r.fire();
ok(r.toasts.length === 0, 'an award of 0 XP gives no toast');
r = rig({ answers: [{ status: 'already_attended' }] }); await r.a.refresh(); await r.fire();
ok(r.toasts.length === 0 && r.a.state().text === 'Attendance already recorded.' && !r.timers.some((t) => !t.dead && !t.fired), 'already attended: neutral text, no toast, stops');
r = rig({ answers: [{ status: 'capped' }] }); await r.a.refresh(); await r.fire();
ok(/organiser can still confirm/.test(r.a.state().text) && !r.timers.some((t) => !t.dead && !t.fired), 'capped: says so and stops asking for that session');

// ---------- when it must not run
for (const [name, o] of [['switch off in the database', { cfg: { enabled: false, consented: true } }], ['no consent', { cfg: { enabled: true, consented: false } }], ['local switch off', { pref: false }], ['signed out', { signed: false }], ['page hidden', { vis: false }], ['no session under way', { list: [S({ iRsvped: false })] }]]) {
  const x = rig(o); await x.a.refresh(); ok(x.timers.length === 0 && x.calls.length === 0, 'does not run: ' + name);
}
r = rig(); await r.a.refresh(); r.vis = false; await r.fire(); ok(r.calls.length === 0, 'a timer firing while the page is hidden sends nothing');
r = rig({ posError: Object.assign(new Error('denied'), { code: 1 }) }); await r.a.refresh(); await r.fire();
ok(r.a.state().status === 'denied' && /Manual verification still works/.test(r.a.state().text) && r.calls.length === 0 && !r.timers.some((t) => !t.dead && !t.fired), 'denied permission: says so and stops');
r = rig({ posError: Object.assign(new Error('timeout'), { code: 3 }) }); await r.a.refresh(); await r.fire();
ok(r.a.state().status === 'unavailable' && r.timers.some((t) => !t.dead && !t.fired), 'a failed fix is reported and the next sample is still scheduled');
r = rig({ answers: [{ status: 'unavailable' }] }); await r.a.refresh(); r.cfg = { ...r.cfg, enabled: false }; await r.fire();
ok(!r.timers.some((t) => !t.dead && !t.fired), 'when the server says unavailable the config is re-read and a switched-off database stops the sampler');

// ---------- consent and sign-out
r = rig({ pref: false, cfg: { enabled: true, consented: false, spacing_s: 30 } }); await r.a.enable();
ok(r.consentCalls.join() === 'on' && r.pref === true && r.timers.length > 0, 'turning it on records the consent on the server first, then the switch, then starts');
await r.a.disable();
ok(r.consentCalls.join() === 'on,off' && r.pref === false && r.a.state().status === 'idle' && !r.timers.some((t) => !t.dead && !t.fired), 'turning it off withdraws the consent on the server and stops');
const bad = rig({ pref: false }); bad.a = createArrival({ api: { arrivalConfig: async () => bad.cfg, recordConsent: async () => { throw new Error('nope'); }, withdrawConsent: async () => {}, submitArrival: async () => ({}) }, candidates: () => bad.list, signedIn: () => true, pref: () => bad.pref, setPref: (v) => { bad.pref = v; }, toast: () => {} });
let threw = false; try { await bad.a.enable(); } catch { threw = true; }
ok(threw && bad.pref === false, 'if the server refuses the consent the switch stays off');
r = rig(); await r.a.refresh(); r.a.reset();
ok(r.a.state().status === 'idle' && !r.timers.some((t) => !t.dead && !t.fired) && r.a.config() === null, 'reset (sign-out) clears everything');

// ---------- waking up for a session that has not begun
ok(nextStart([S({ startsAt: new Date(T0 + 2 * H).toISOString(), endsAt: new Date(T0 + 3 * H).toISOString() }), S({ id: 's2', startsAt: new Date(T0 + H).toISOString(), endsAt: new Date(T0 + 2 * H).toISOString() })], T0) === T0 + H && nextStart([S()], T0) === null && nextStart([S({ isHost: true, startsAt: new Date(T0 + H).toISOString() })], T0) === null, 'nextStart is the soonest joined session that has not begun');
{
  const later = S({ startsAt: new Date(T0 + 20 * 60000).toISOString(), endsAt: new Date(T0 + 2 * H).toISOString() });
  const x = rig({ list: [later] }); await x.a.refresh();
  ok(x.timers.length === 1 && x.timers[0].ms >= 20 * 60000 && x.timers[0].ms <= 21 * 60000 + 2000 && x.calls.length === 0, 'with a session about to begin the sampler sleeps until it starts, sending nothing');
  x.now = T0 + 21 * 60000; await x.fire();
  ok(x.timers.at(-1).ms === 500 && !x.timers.at(-1).dead, 'and wakes up when it begins');
}
