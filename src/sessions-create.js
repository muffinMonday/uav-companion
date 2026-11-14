// The "New session" form of the Sessions hub: title and details, date and times, repeat with a preview, a point on the map (picked on the map, the map centre, or a saved
// marker), who can see it, and an optional capacity. Private is the default; publishing says plainly that the exact point is public. The draft lives in this module's memory
// only (it survives the hub closing for the map picker and reopening; it is never stored). Plain DOM, textContent only. The database checks everything again.
import { FREQUENCIES, MIN_COUNT, MAX_COUNT, DEFAULT_COUNT, nextSaturday, localDate, localTime, previewSeries } from './sessions-recurrence.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, cls = 'btn small') => { const b = el('button', cls, label); b.type = 'button'; return b; };
const pad = (n) => String(n).padStart(2, '0');

let draft = null; // { title, description, date, start, end, repeat, count, label, lat, lng, visibility, ack, capacity }
export const hasDraft = () => draft !== null;
export const clearDraft = () => { draft = null; };

/** A fresh draft: tomorrow, the next full hour, three hours long. */
export function blankDraft(now = new Date()) {
  const s = new Date(+now + 86400000); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + (now.getMinutes() ? 1 : 0));
  const e = new Date(+s + 3 * 3600000);
  return { title: '', description: '', date: localDate(s), start: localTime(s), end: localTime(e), repeat: 'none', count: DEFAULT_COUNT, label: '', lat: null, lng: null, visibility: 'private', ack: false, capacity: '' };
}

/** Minutes from the start time to the end time on the same or the next day (an end at or before the start means the next day). */
export function durationMinutes(start, end) {
  const m = (t) => { const x = /^(\d{2}):(\d{2})$/.exec(t || ''); return x ? +x[1] * 60 + +x[2] : null; };
  const a = m(start), b = m(end);
  if (a === null || b === null) return null;
  return b > a ? b - a : b + 1440 - a;
}

/** The arguments for the database from a draft, or { error }. `tz` is the event's IANA zone (the browser's). */
export function draftToRequest(d, tz) {
  const title = d.title.trim();
  if (!title) return { error: 'Give the session a title.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) return { error: 'Choose a date.' };
  const dur = durationMinutes(d.start, d.end);
  if (dur === null) return { error: 'Choose a start and an end time.' };
  if (d.lat === null || d.lng === null) return { error: 'Choose where it meets: a point on the map is required.' };
  if (d.visibility === 'public' && !d.ack) return { error: 'Confirm that anyone will see the exact meeting point, or keep the session private.' };
  const cap = d.capacity === '' || d.capacity === null ? null : Number(d.capacity);
  if (cap !== null && !(Number.isInteger(cap) && cap >= 1 && cap <= 500)) return { error: 'Capacity is a number from 1 to 500, or empty for no limit.' };
  const base = { title, description: d.description.trim(), location: d.label.trim(), lat: d.lat, lng: d.lng, timezone: tz, visibility: d.visibility, capacity: cap };
  if (d.repeat === 'none') {
    const startsAt = new Date(`${d.date}T${d.start}`);
    if (Number.isNaN(+startsAt)) return { error: 'Choose a date and start time.' };
    return { series: false, ...base, startsAt: startsAt.toISOString(), endsAt: new Date(+startsAt + dur * 60000).toISOString() };
  }
  const count = Number(d.count);
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) return { error: `A repeating session has ${MIN_COUNT} to ${MAX_COUNT} occurrences.` };
  return { series: true, ...base, localStart: `${d.date}T${d.start}:00`, durationMinutes: dur, frequency: d.repeat, count };
}

/**
 * Returns { el, refresh() }. `tools`: { pickPoint({lat,lng}|null) -> Promise<{lat,lng}|null> (closes the hub while the person picks), center() -> {lat,lng}, markers() -> [{ name, lat, lon }] }.
 * `onSubmit(request) -> Promise<message>` makes the session; `onCancel()` leaves the form.
 */
export function createSessionForm({ tools, tz, onSubmit, onCancel, locale = 'en-GB' }) {
  draft = draft ?? blankDraft();
  const f = el('form', 'ses-form ses-create'); f.id = 'ses-form'; f.noValidate = true;
  let n = 0, cur = f;
  /** Starts a titled group; the fields that follow go inside it. `wide` groups span both columns when the hub is wide. */
  const section = (name, wide = false) => { const g = el('div', 'ses-sec' + (wide ? ' ses-sec-wide' : '')); g.append(el('h4', '', name)); f.append(g); cur = g; return g; };
  const field = (label, input, hint, into = cur) => { const l = el('label', 'fr-label', label); const id = 'sc-' + (++n); input.id = id; l.setAttribute('for', id); into.append(l, input); if (hint) into.append(el('small', 'hint', hint)); return input; };
  const input = (type, key, extra = {}) => { const i = el('input'); i.type = type; i.value = draft[key] ?? ''; Object.assign(i, extra); i.addEventListener('input', () => { draft[key] = i.value; update(); }); return i; };

  section('Basics', true);
  const title = field('Title', input('text', 'title', { maxLength: 80 })); title.name = 'title';
  const desc = field('Details (optional)', el('textarea')); desc.rows = 2; desc.maxLength = 500; desc.value = draft.description; desc.addEventListener('input', () => { draft.description = desc.value; });
  section('When');
  const times = el('div', 'ses-when'); const dateBox = el('div', 'ses-date'); times.append(dateBox);
  const date = field('Date', input('date', 'date'), undefined, dateBox); date.name = 'date';
  const start = input('time', 'start'), end = input('time', 'end');
  for (const [lab, i] of [['Starts', start], ['Ends', end]]) { const l = el('label', 'fr-label', lab); i.id = 'sc-' + lab.toLowerCase(); l.setAttribute('for', i.id); const w = el('div'); w.append(l, i); times.append(w); }
  cur.append(times);
  const endHint = el('small', 'hint ses-endhint'); cur.append(endHint);

  // repeat
  const rep = el('select'); rep.append(new Option('Does not repeat', 'none'));
  for (const q of FREQUENCIES) rep.append(new Option(q.label, q.id));
  field('Repeat', rep); rep.value = draft.repeat; rep.addEventListener('change', () => { draft.repeat = rep.value; update(); });
  const repBox = el('div', 'ses-repeat');
  const preset = btn('Every Saturday for 4 weeks'); preset.dataset.act = 'preset-saturday';
  preset.addEventListener('click', () => { draft.repeat = 'weekly'; draft.count = DEFAULT_COUNT; draft.date = nextSaturday(draft.date) ?? draft.date; rep.value = 'weekly'; date.value = draft.date; count.value = draft.count; update(); });
  const count = el('input'); count.type = 'number'; count.min = MIN_COUNT; count.max = MAX_COUNT; count.step = 1; count.value = draft.count; count.setAttribute('aria-label', 'Number of sessions');
  count.addEventListener('input', () => { draft.count = count.value; update(); });
  const countRow = el('div', 'ses-count-row'); const cl = el('label', 'fr-label', 'Number of sessions (2 to 12)'); cl.setAttribute('for', 'sc-count'); count.id = 'sc-count'; countRow.append(cl, count);
  const preview = el('div', 'ses-preview'); preview.setAttribute('aria-live', 'polite');
  repBox.append(countRow, preview); cur.append(preset, repBox);

  // where
  section('Where');
  const lab = field('Place name (optional)', input('text', 'label', { maxLength: 120 }), 'Shown with the session; the map point below is what people navigate to.');
  const pin = el('div', 'ses-pin');
  const pinText = el('p', 'ses-pin-text'); pinText.setAttribute('role', 'status');
  const pinBtns = el('div', 'btn-row');
  const choose = btn('Choose on the map', 'btn small primary'); choose.dataset.act = 'pick';
  choose.addEventListener('click', async () => { const p = await tools.pickPoint(draft.lat !== null ? { lat: draft.lat, lng: draft.lng } : null); if (p) setPoint(p.lat, p.lng); });
  const centre = btn('Use the map centre'); centre.dataset.act = 'centre'; centre.addEventListener('click', () => { const c = tools.center(); if (c) setPoint(c.lat, c.lng); });
  pinBtns.append(choose, centre);
  const marks = (tools.markers?.() ?? []).slice(0, 200);
  const sel = el('select'); sel.setAttribute('aria-label', 'Use a saved marker'); sel.append(new Option('Use a saved marker…', ''));
  marks.forEach((m, i) => sel.append(new Option(m.name || 'Marker', String(i))));
  sel.addEventListener('change', () => { const m = marks[+sel.value]; sel.value = ''; if (!m) return; setPoint(m.lat, m.lon); if (!draft.label && m.name) { draft.label = m.name.slice(0, 120); lab.value = draft.label; } });
  pin.append(pinText, pinBtns); if (marks.length) pin.append(sel);
  cur.append(el('span', 'fr-label', 'Meeting point'), pin);
  function setPoint(lat, lng) { draft.lat = Math.round(lat * 1e6) / 1e6; draft.lng = Math.round(lng * 1e6) / 1e6; update(); }

  // who can see it
  section('Who can see it');
  const vis = el('fieldset', 'ses-vis'); vis.append(el('legend', 'fr-label', 'Who can see it'));
  const radios = {};
  for (const [v, t, h] of [['private', 'Private', 'Only you, people you invite and people you give a link to.'], ['public', 'Public', 'Anyone, signed in or not, can find it and see the exact meeting point.']]) {
    const l = el('label', 'ses-radio'); const r = el('input'); r.type = 'radio'; r.name = 'ses-vis'; r.value = v; r.checked = draft.visibility === v; radios[v] = r;
    r.addEventListener('change', () => { if (r.checked) { draft.visibility = v; update(); } });
    const s = el('span'); s.append(el('b', '', t), document.createTextNode(' '), el('small', 'hint', h)); l.append(r, s); vis.append(l);
  }
  const warn = el('div', 'ses-public-warn'); warn.append(el('p', '', 'Publishing makes the exact meeting point visible to anyone. It does not share your live location and it does not mean flying there is allowed: check the zone rules for that spot.'));
  const ackL = el('label', 'ses-radio'); const ack = el('input'); ack.type = 'checkbox'; ack.checked = draft.ack; ack.id = 'sc-ack';
  ack.addEventListener('change', () => { draft.ack = ack.checked; update(); }); ackL.append(ack, el('span', '', 'I understand that anyone can see the exact meeting point.')); warn.append(ackL);
  cur.append(vis, warn);

  section('Capacity');
  const cap = field('Capacity (optional)', input('number', 'capacity', { min: 1, max: 500, step: 1 }), 'Leave empty for no limit. People who RSVP after it is full are turned away.'); cap.name = 'capacity';

  cur = f;
  const msg = el('p', 'hint ses-message'); msg.setAttribute('role', 'status'); f.append(msg);
  const row = el('div', 'btn-row ses-actions');
  const go = btn('Create session', 'btn small primary'); go.type = 'submit'; go.id = 'ses-create';
  const cancel = btn('Cancel'); cancel.id = 'ses-create-cancel'; cancel.addEventListener('click', () => onCancel());
  row.append(go, cancel); f.append(row);

  function update() {
    pinText.textContent = draft.lat === null ? 'No point chosen yet.' : `Point chosen: ${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`;
    const dur = durationMinutes(draft.start, draft.end);
    endHint.textContent = dur !== null && draft.end <= draft.start ? 'It ends the next day.' : dur !== null ? `Lasts ${Math.floor(dur / 60)} h ${pad(dur % 60)} min.` : '';
    const repeating = draft.repeat !== 'none';
    repBox.hidden = !repeating;
    preview.replaceChildren();
    if (repeating) {
      const p = previewSeries(draft.date, draft.repeat, Number(draft.count), { locale });
      if (!p.total) preview.append(el('p', 'hint', `Choose a date and 2 to 12 sessions to see the dates.`));
      else {
        preview.append(el('p', 'ses-preview-total', `${p.total} sessions. The first ${Math.min(3, p.total)}:`));
        const ul = el('ul'); for (const l of p.lines) ul.append(el('li', '', l)); preview.append(ul);
        for (const t of p.notes) preview.append(el('p', 'hint', t));
        preview.append(el('p', 'hint', 'Each session has its own RSVPs, capacity and attendance. The start time stays the same on the clock when daylight saving changes.'));
      }
    }
    warn.hidden = draft.visibility !== 'public';
  }
  update();

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const req = draftToRequest(draft, tz);
    if (req.error) { msg.textContent = req.error; return; }
    go.disabled = true; msg.textContent = 'Creating…';
    try { const m = await onSubmit(req); draft = null; msg.textContent = m || ''; }
    catch (err) { msg.textContent = err.message || 'That did not work.'; go.disabled = false; }
  });
  return { el: f, focus: () => title.focus() };
}
