// The prompts the first-visit setup hands to an AI assistant. Pure: the importable-format rules (public/ai/prompt.md) come in as `base`, and each prompt puts a
// short instruction and the person's request around them. Nothing here fetches anything: a link is only placed in the prompt text.

export const LIMITS = { destination: 100, when: 100, interests: 300, url: 500, note: 300 };

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ending = (base) => String(base ?? '').trimEnd();

/** The request of the form, trimmed and cut to length. The destination is required: '' when it is missing. */
export function cleanTrip({ destination, when, interests } = {}) {
  return { destination: clean(destination, LIMITS.destination), when: clean(when, LIMITS.when), interests: clean(interests, LIMITS.interests) };
}

/** A prompt asking an AI to plan a trip from the form and answer in the importable format. '' when there is no destination. */
export function buildTripPrompt(form, base) {
  const t = cleanTrip(form);
  if (!t.destination) return '';
  const intro = 'I have not written an itinerary yet. Plan the trip described under MY ITINERARY at the end, choosing places that suit a traveller who flies a drone (where to stay, good places to take off, scenic spots to film, places to avoid), and then reply in the format below.';
  const request = [
    `  Destination: ${t.destination}`,
    t.when && `  When, or how many days: ${t.when}`,
    t.interests && `  Interests: ${t.interests}`,
    '  Plan it day by day. Do not invent dates I did not give.',
  ].filter(Boolean).join('\n');
  return `${intro}\n\n${ending(base)}\n${request}\n`;
}

/** Is this a link we will put in a prompt? Only http and https, one line, up to LIMITS.url characters. */
export function checkUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, reason: 'Paste the link to your itinerary.' };
  if (raw.length > LIMITS.url) return { ok: false, reason: `That link is too long (the limit is ${LIMITS.url} characters).` };
  if (/\s/.test(raw)) return { ok: false, reason: 'A link has no spaces. Paste only the link.' };
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'That does not look like a web link. It should start with https://' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Only web links (http or https) can be used.' };
  return { ok: true, url: u.href };
}

/** A prompt asking an AI to open an itinerary link and convert it to the importable format. '' when the link is not usable. */
export function buildLinkPrompt({ url, note } = {}, base) {
  const c = checkUrl(url);
  if (!c.ok) return '';
  const intro = 'My itinerary is on a web page, linked under MY ITINERARY at the end. Open the link, read the itinerary, and convert it to map markers in the format below. If you cannot open links, say so and ask me to paste the text of the page. Do not guess what is on it.';
  const n = clean(note, LIMITS.note);
  const request = [`  Link: ${c.url}`, n && `  Note: ${n}`].filter(Boolean).join('\n');
  return `${intro}\n\n${ending(base)}\n${request}\n`;
}
