// The quick setup: a dialog for a first visit (and from "Quick setup" later) that asks what the visitor came to do.
//   Plan a trip   -> a short form, or an itinerary link, that becomes a prompt to copy into any AI; then the AI's answer is pasted and previewed here
//   Plan a flight -> use my location, and centre the map on it (the Fly in buttons if the position cannot be had)
//   Skip          -> the dashboard opens with How it works showing
// The link is never fetched: it is only put in the prompt text. The choice is saved as prefs.mode for the flight planner that will open itself.
import { el } from './cards.js';
import { buildTripPrompt, buildLinkPrompt, checkUrl, LIMITS } from './aiprompt.js';
import { save as saveDash } from './dashstate.js';
import { savePrefs } from './prefs.js';

export function initSplash({ dash, panel, ai, locate, loadPrompt, toast }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'splash'; dlg.id = 'splash';
  dlg.setAttribute('aria-labelledby', 'splash-title');
  document.body.append(dlg);
  let settled = false; // the dialog was closed on purpose (an answer, or Skip); a close without it (Escape) counts as Skip

  const finish = () => { settled = true; saveDash({ welcomed: true }); if (dlg.open) dlg.close(); };
  const skip = () => { finish(); dash.open({ guide: true }); };
  dlg.addEventListener('close', () => { if (!settled) skip(); });
  dlg.addEventListener('cancel', () => { /* Escape: the close event follows and skips */ });

  const btn = (text, fn, cls = 'btn') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const field = (label, control) => { const l = el('label', 'field'); l.append(el('span', '', label), control); return l; };
  const input = (id, { max, placeholder = '', type = 'text' } = {}) => { const i = el('input'); i.id = id; i.type = type; i.maxLength = max; i.placeholder = placeholder; i.autocomplete = 'off'; return i; };
  const back = (to) => btn('Back', to, 'btn small');
  const heading = (text) => { const h = el('h2', '', text); h.id = 'splash-title'; return h; };

  function show(...nodes) { dlg.replaceChildren(...nodes); if (!dlg.open) dlg.showModal(); }

  // ---------- the first question ----------
  function choose() {
    const choices = el('div', 'splash-choices');
    const card = (id, title, text, fn) => { const b = el('button', 'splash-choice'); b.type = 'button'; b.id = id; b.append(el('b', '', title), el('span', '', text)); b.addEventListener('click', fn); return b; };
    choices.append(
      card('splash-trip', 'Plan a trip', 'Get a plan from an AI assistant, or turn an itinerary you already have into markers.', tripMenu),
      card('splash-flight', 'Plan a flight', 'Centre the map on where you are and check whether you can fly there.', flightIntro),
    );
    show(heading('Where do you want to start?'), el('p', 'hint', 'Everything stays in this browser. You can change your mind at any time.'), choices,
      Object.assign(btn('Skip, just show me the map', skip, 'dash-link'), { id: 'splash-skip' }));
  }

  // ---------- plan a trip ----------
  function tripMenu() {
    const choices = el('div', 'splash-choices');
    const card = (id, title, text, fn) => { const b = el('button', 'splash-choice'); b.type = 'button'; b.id = id; b.append(el('b', '', title), el('span', '', text)); b.addEventListener('click', fn); return b; };
    choices.append(
      card('splash-ai', 'Plan it for me', 'Say where and when. You get a prompt to paste into any AI assistant.', tripForm),
      card('splash-link', 'I have an itinerary link', 'You get a prompt that asks an AI assistant to turn it into markers.', linkForm),
    );
    show(heading('Plan a trip'), choices, back(choose));
  }

  /** Copy a prompt, then show the three steps and the box for the answer. If copying fails the prompt is shown to copy by hand. */
  async function copyThenPaste(prompt) {
    let copied = true;
    try { await navigator.clipboard.writeText(prompt); } catch { copied = false; }
    savePrefs({ mode: 'trip' });
    pasteStep(prompt, copied);
  }

  function tripForm() {
    const dest = input('splash-dest', { max: LIMITS.destination, placeholder: 'For example Kyoto, Japan' });
    const when = input('splash-when', { max: LIMITS.when, placeholder: 'For example 5 days in April 2027' });
    const ints = el('textarea'); ints.id = 'splash-interests'; ints.rows = 2; ints.maxLength = LIMITS.interests; ints.placeholder = 'For example temples, sunrise, coast';
    const msg = el('p', 'hint splash-msg'); msg.setAttribute('role', 'alert');
    const go = btn('Copy the prompt', async () => {
      if (!dest.value.trim()) { msg.textContent = 'Tell us where you are going.'; dest.focus(); return; }
      let base; try { base = await loadPrompt(); } catch { msg.textContent = 'Could not load the prompt. Check your connection and try again.'; return; }
      await copyThenPaste(buildTripPrompt({ destination: dest.value, when: when.value, interests: ints.value }, base));
    }, 'btn primary'); go.id = 'splash-copy-trip';
    const row = el('div', 'btn-row'); row.append(go, back(tripMenu));
    show(heading('Plan it for me'), field('Destination', dest), field('Dates, or how many days (optional)', when), field('Interests (optional)', ints), msg, row);
    dest.focus();
  }

  function linkForm() {
    const url = input('splash-url', { max: LIMITS.url, placeholder: 'https://', type: 'url' });
    const note = el('textarea'); note.id = 'splash-note'; note.rows = 2; note.maxLength = LIMITS.note; note.placeholder = 'For example: only the first three days';
    const msg = el('p', 'hint splash-msg'); msg.setAttribute('role', 'alert');
    const go = btn('Copy the prompt', async () => {
      const c = checkUrl(url.value);
      if (!c.ok) { msg.textContent = c.reason; url.focus(); return; }
      let base; try { base = await loadPrompt(); } catch { msg.textContent = 'Could not load the prompt. Check your connection and try again.'; return; }
      await copyThenPaste(buildLinkPrompt({ url: url.value, note: note.value }, base));
    }, 'btn primary'); go.id = 'splash-copy-link';
    const row = el('div', 'btn-row'); row.append(go, back(tripMenu));
    show(heading('Turn an itinerary link into markers'), field('Link to the itinerary', url), field('A note for the AI (optional)', note),
      el('p', 'hint', 'The link is not opened here. It only goes into the prompt, for the AI assistant to read.'), msg, row);
    url.focus();
  }

  function pasteStep(prompt, copied) {
    const steps = el('ol', 'w-steps');
    for (const t of [
      copied ? 'The prompt is copied. Paste it into your AI assistant (ChatGPT, Claude, Gemini or any other).' : 'Copy the prompt below and paste it into your AI assistant.',
      'Copy the answer it gives you.',
      'Paste the answer here and press Preview and add.',
    ]) steps.append(el('li', '', t));
    const nodes = [heading('Now ask your AI'), steps];
    if (!copied) { const ta = el('textarea'); ta.id = 'splash-prompt'; ta.rows = 5; ta.readOnly = true; ta.value = prompt; ta.addEventListener('focus', () => ta.select()); nodes.push(field('The prompt', ta)); }
    const ans = el('textarea'); ans.id = 'splash-answer'; ans.rows = 5; ans.spellcheck = false; ans.placeholder = '{"type":"FeatureCollection","features":[ … ]}';
    nodes.push(field('The AI’s answer', ans));
    const go = btn('Preview and add', () => {
      if (!ans.value.trim()) { ans.focus(); return; }
      finish(); dash.fold();
      panel.open('trips');
      ai.preview(ans.value);
      requestAnimationFrame(() => document.getElementById('ai-preview')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }, 'btn primary'); go.id = 'splash-preview';
    const later = btn('I will do this later', () => { finish(); dash.fold(); panel.open('trips'); document.getElementById('ai-card')?.scrollIntoView({ block: 'nearest' }); toast('The AI card in Trips is where you paste its answer.', 6000); }, 'btn small'); later.id = 'splash-later';
    const row = el('div', 'btn-row'); row.append(go, later);
    nodes.push(row);
    show(...nodes);
    (copied ? ans : dlg.querySelector('#splash-prompt')).focus();
  }

  // ---------- plan a flight ----------
  function flightIntro() {
    const go = btn('Use my location', async () => {
      savePrefs({ mode: 'flight' });
      finish(); dash.fold();                          // the map is wanted, not the dialog; a refusal brings the dialog back
      const found = await locate.show();
      if (!found) { await new Promise((r) => setTimeout(r, 0)); noLocation(); } // (after the close event of the dialog we just closed)
    }, 'btn primary'); go.id = 'splash-locate';
    const row = el('div', 'btn-row'); row.append(go, back(choose));
    show(heading('Plan a flight'), el('p', 'hint', 'The map centres on where you are. Your position is only used on this device, to show you the zones around you.'), row);
  }

  function noLocation() {
    settled = false;
    const row = el('div', 'btn-row');
    for (const k of dash.regions.countries) row.append(btn(k.name, () => { settled = true; dlg.close(); dash.regions.goTo?.(k.id); }, 'btn'));
    const close = btn('Close', () => { settled = true; dlg.close(); }, 'btn small'); close.id = 'splash-close';
    show(heading('No location yet'), el('p', 'hint', 'The browser did not give a position. You can allow location in its settings and press the locate button on the map, or start from a region:'), row, close);
  }

  return { open: choose };
}
