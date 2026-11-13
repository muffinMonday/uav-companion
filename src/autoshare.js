// Automatic location sharing: decides when to start and stop sharing this device's position with a party and with friends. No screen code and no network
// here: it drives live.js (which sends the positions) and reads what the app already knows (who is online).
//
//   - Only after the person said yes once (privacy `autoShare` = 'on'). While it is 'unset' the question is asked once per session, the first time someone
//     in a party or a friend is online; 'off' means never.
//   - A trip's party is shared with when at least one other joined member is online (so two people are online: the person and that member).
//     Friends are shared with when at least one friend is online (and privacy `shareFriends` is on).
//   - Sharing that this module started stops again when nobody is online any more. Sharing the person started by hand is never stopped here.
//   - A scope the person stopped by hand (`shareOff`) is not started again by this module until they start it by hand; one that live.js halted (moved to
//     another device, trip ended, left, permission refused) is not started again either.
import { FRIENDS, endedMoreThanADay } from './live.js';

/**
 * live: createLive(); privacy: { get, set } (privacy.js); trips(): [{ id, online, endDate }] (joined shared trips, `online` = other members online);
 * friendsOnline(): number; signedIn(): boolean; consent({ party, friends }): Promise<'on' | 'off' | 'later'>.
 */
export function createAutoShare({ live, privacy, trips, friendsOnline, signedIn, consent, now = () => Date.now() }) {
  const mine = new Set(); // scopes this module started (and so may stop)
  let asked = false, running = null, again = false;

  const off = () => new Set(privacy.get().shareOff);
  function stopMine() { for (const id of [...mine]) { mine.delete(id); if (live.isSharing(id)) live.stop(id); } }

  async function run() {
    if (!signedIn()) { mine.clear(); return; }
    const hand = off();
    const wantTrips = trips().filter((t) => t.online > 0 && !hand.has(t.id) && !endedMoreThanADay(t.endDate, now())).map((t) => t.id);
    const wantFriends = privacy.get().shareFriends && friendsOnline() > 0 && !hand.has(FRIENDS);
    const want = new Set(wantFriends ? [...wantTrips, FRIENDS] : wantTrips);
    let mode = privacy.get().autoShare;
    if (mode === 'unset') {
      if (!want.size || asked) return;
      asked = true;
      const answer = await consent({ party: wantTrips.length > 0, friends: wantFriends });
      if (answer === 'on' || answer === 'off') { privacy.set({ autoShare: answer }); mode = answer; } else return; // 'later': asked again next session
    }
    if (mode !== 'on') { stopMine(); return; }
    for (const id of [...mine]) if (!live.isSharing(id)) mine.delete(id); // stopped by something else (an error, a halt, the person)
    for (const id of want) if (!live.isSharing(id) && live.start(id, { auto: true }).ok) mine.add(id);
    for (const id of [...mine]) if (!want.has(id)) { mine.delete(id); live.stop(id); } // nobody is online any more
  }

  return {
    /** Looks at who is online and starts or stops sharing. Safe to call often; calls made while one is running cause one more pass. */
    evaluate() {
      if (running) { again = true; return running; }
      running = run().catch(() => {}).finally(() => { running = null; if (again) { again = false; this.evaluate(); } });
      return running;
    },
    /** The person started this scope by hand (a switch): it may be stopped by hand too, and is no longer this module's. */
    handStarted(id) { mine.delete(id); const s = off(); if (s.delete(id)) privacy.set({ shareOff: [...s] }); },
    /** The person stopped this scope by hand: it is not started again automatically. */
    handStopped(id) { mine.delete(id); const s = off(); if (!s.has(id)) { s.add(id); privacy.set({ shareOff: [...s].slice(-50) }); } },
    /** Sharing, as far as this module is concerned, was switched off in the settings. */
    setMode(mode) { privacy.set({ autoShare: mode }); if (mode !== 'on') stopMine(); else this.evaluate(); },
    owns: (id) => mine.has(id),
  };
}
