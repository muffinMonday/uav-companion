// Online status: while signed in and the page is visible, tell the server every 30 s that the app is open (touch_presence), and at once when the page
// comes back into view. The server shows friends and party members "online" for 75 s after the last signal, and does nothing for someone who hides their status.
import { createSocial } from './social.js';
import { canPoll } from './backoff.js';

const EVERY_MS = 30000;

export function initPresence({ handle }) {
  const social = createSocial(handle.adapter.client);
  const signedIn = () => !!handle.sync.status().session;
  const beat = () => { if (signedIn() && canPoll()) social.touch().catch(() => { /* the next one will do */ }); };
  setInterval(beat, EVERY_MS);
  document.addEventListener('visibilitychange', beat);
  let was = signedIn();
  handle.onChange(() => { const now = signedIn(); if (now && !was) beat(); was = now; });
  beat();
  return { beat };
}
