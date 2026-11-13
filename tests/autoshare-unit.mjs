// Automatic location sharing (src/autoshare.js) with a fake engine, fake settings and a fake list of who is online. No browser, no network, no database.
import { createAutoShare } from '../src/autoshare.js';
import { FRIENDS } from '../src/live.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

function setup({ autoShare = 'unset', shareFriends = true, shareOff = [], answer = 'on' } = {}) {
  const st = { autoShare, shareFriends, shareOff };
  const privacy = { get: () => st, set: (p) => Object.assign(st, p) };
  const sharing = new Set(), halted = new Set(), log = [];
  const live = {
    isSharing: (id) => sharing.has(id),
    start: (id, o = {}) => { if (o.auto && halted.has(id)) return { ok: false, reason: 'halted' }; sharing.add(id); log.push('start ' + id); return { ok: true }; },
    stop: (id) => { sharing.delete(id); log.push('stop ' + id); },
  };
  const w = { trips: [{ id: 'T1', online: 0, endDate: undefined }], friends: 0, signed: true, asks: [], answer };
  const auto = createAutoShare({
    live, privacy, signedIn: () => w.signed, trips: () => w.trips, friendsOnline: () => w.friends,
    consent: async (x) => { w.asks.push(x); return w.answer; },
  });
  return { st, sharing, halted, log, w, auto };
}

// ---------- nothing happens when nobody is online
{
  const s = setup({ autoShare: 'on' });
  await s.auto.evaluate();
  ok(!s.sharing.size && !s.w.asks.length, 'nobody online: nothing starts and nobody is asked');
}
// ---------- party: one other member online
{
  const s = setup({ autoShare: 'on' });
  s.w.trips[0].online = 1;
  await s.auto.evaluate();
  ok(s.sharing.has('T1') && !s.sharing.has(FRIENDS), 'one other party member online: sharing with the party starts');
  s.w.trips[0].online = 0;
  await s.auto.evaluate();
  ok(!s.sharing.size, 'they go offline: it stops again');
}
// ---------- friends
{
  const s = setup({ autoShare: 'on' });
  s.w.friends = 1;
  await s.auto.evaluate();
  ok(s.sharing.has(FRIENDS) && !s.sharing.has('T1'), 'one friend online: sharing with friends starts');
  s.st.shareFriends = false;
  await s.auto.evaluate();
  ok(!s.sharing.has(FRIENDS), 'friends switched off in the settings: it stops');
  s.st.shareFriends = true;
  await s.auto.evaluate();
  ok(s.sharing.has(FRIENDS), 'and starts again when switched back on');
  s.w.trips[0].online = 2; await s.auto.evaluate();
  ok(s.sharing.has('T1') && s.sharing.has(FRIENDS), 'party and friends together');
  s.w.friends = 0; await s.auto.evaluate();
  ok(s.sharing.has('T1') && !s.sharing.has(FRIENDS), 'only the scope whose people left stops');
}
// ---------- consent
{
  const s = setup({ answer: 'on' });
  s.w.friends = 1;
  await s.auto.evaluate();
  ok(s.w.asks.length === 1 && s.w.asks[0].friends === true && s.w.asks[0].party === false, 'unset: the person is asked once, told who it concerns');
  ok(s.st.autoShare === 'on' && s.sharing.has(FRIENDS), 'yes: remembered, and sharing starts');
}
{
  const s = setup({ answer: 'later' });
  s.w.trips[0].online = 1;
  await s.auto.evaluate(); await s.auto.evaluate();
  ok(s.w.asks.length === 1 && !s.sharing.size && s.st.autoShare === 'unset', '"not now": nothing starts, and the question is not repeated in the same session');
}
{
  const s = setup({ answer: 'off' });
  s.w.trips[0].online = 1;
  await s.auto.evaluate();
  ok(s.st.autoShare === 'off' && !s.sharing.size, 'no: remembered as off, nothing starts');
  s.w.friends = 1; await s.auto.evaluate();
  ok(s.w.asks.length === 1 && !s.sharing.size, 'and the person is not asked again');
}
{
  const s = setup({ autoShare: 'unset' });
  await s.auto.evaluate();
  ok(!s.w.asks.length, 'unset but nobody online: not asked yet');
}
// ---------- the person stays in control
{
  const s = setup({ autoShare: 'on' });
  s.w.trips[0].online = 1; s.w.friends = 1;
  await s.auto.evaluate();
  s.sharing.delete('T1'); s.auto.handStopped('T1'); // the person switched the trip off
  await s.auto.evaluate();
  ok(!s.sharing.has('T1') && s.st.shareOff.includes('T1') && s.sharing.has(FRIENDS), 'stopped by hand: not started again, the other scope goes on');
  s.auto.handStarted('T1'); s.sharing.add('T1');
  ok(!s.st.shareOff.includes('T1'), 'started by hand again: no longer excluded');
  s.w.trips[0].online = 0; await s.auto.evaluate();
  ok(s.sharing.has('T1'), 'sharing started by hand is not stopped by the module when people leave');
}
{
  const s = setup({ autoShare: 'on' });
  s.w.trips[0].online = 1; s.halted.add('T1');
  await s.auto.evaluate();
  ok(!s.sharing.has('T1'), 'a scope the engine halted (moved to another device, trip ended, permission refused) is not started again');
}
{
  const s = setup({ autoShare: 'on' });
  s.w.trips[0].online = 1; s.w.trips[0].endDate = '2020-01-01';
  await s.auto.evaluate();
  ok(!s.sharing.size, 'a trip that ended more than a day ago is not started');
}
{
  const s = setup({ autoShare: 'on' });
  s.w.trips[0].online = 1; s.w.friends = 1;
  await s.auto.evaluate();
  s.auto.setMode('off');
  ok(!s.sharing.size && s.st.autoShare === 'off', 'switching it off in the settings stops what it started');
  s.w.trips[0].online = 1; await s.auto.evaluate();
  ok(!s.sharing.size, 'and nothing starts while it is off');
}
{
  const s = setup({ autoShare: 'on' });
  s.w.trips[0].online = 1; s.w.signed = false;
  await s.auto.evaluate();
  ok(!s.sharing.size, 'signed out: nothing starts');
}
{
  const s = setup({ autoShare: 'on' });
  s.w.trips[0].online = 1;
  await Promise.all([s.auto.evaluate(), s.auto.evaluate(), s.auto.evaluate()]);
  ok(s.log.filter((l) => l === 'start T1').length === 1, 'calls made together start it once');
}
