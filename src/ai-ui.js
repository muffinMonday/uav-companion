// "Plan with an AI": copy a prompt for any assistant, paste its answer (or open a share link), preview, then add.
// Nothing is added until the preview is confirmed. See aiimport.js for what is accepted and public/ai/ for the spec.
import { addDays } from './dates.js';
import { parseItinerary, isDuplicate, isRevisit, geocode, pause, encodeShare, decodeShare, MAX_LOOKUPS } from './aiimport.js';
import { typeOf, toGeoJSON, dateLabel } from './poi.js';
import { tripDatesLabel } from './trips.js';
import { countryName } from './countries.js';
import { getPrivacy, onPrivacyChange } from './privacy.js';
import { el } from './cards.js';

const $ = (id) => document.getElementById(id);
const LONG_LINK = 4000; // some chat and messaging apps cut links longer than this

export function initAI({ map, toast, panel, poi }) {
  const text = $('ai-text'), box = $('ai-preview');
  let rows = [];            // the parsed places, each with an `include` flag
  let meta = null;          // what the preview was parsed from (skipped count, notes, trips), to redraw it
  let controller = null;    // aborts a running name lookup
  let tripChoice = 'none';  // 'file' (the trip(s) in the reply) | 'none' | 't:<id>' (one of your trips)
  const tripDates = new Map(); // trip ref -> { start, end } typed in the preview for a reply's trip that came without dates
  // A trip needs a start and an end date. The reply's own, or the ones typed in the preview.
  const mergedDates = (t) => { const d = tripDates.get(t.ref) ?? {}; return { startDate: t.startDate || d.start || '', endDate: t.endDate || d.end || '' }; };
  const datesOk = (t) => { const m = mergedDates(t); return !!m.startDate && !!m.endDate && m.endDate >= m.startDate; };
  /** The reply's trips that places are about to be put in but that still have no usable dates. */
  const needDates = () => (tripChoice === 'file' ? (meta?.trips ?? []).filter((t) => rows.some((r) => r.include && r.type !== 'residence' && r.tripRef === t.ref) && !datesOk(t)) : []);

  // ---------- the prompt ----------
  $('ai-copy').addEventListener('click', async () => {
    try {
      const res = await fetch(new URL('ai/prompt.md', document.baseURI));
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      toast('Prompt copied. Paste it into any AI assistant and add your itinerary after it.', 6000);
    } catch {
      toast('Could not copy the prompt. Open ai/prompt.md on this site and copy it by hand.', 7000);
    }
  });

  // ---------- preview ----------
  function blocked(r, lookupIndex) {
    if (r.dup) return 'Already saved';
    if (r.status === 'lookup' && !getPrivacy().lookupNames) return 'Needs a name lookup. Turn it on in Privacy settings.';
    if (r.status === 'lookup' && lookupIndex >= MAX_LOOKUPS) return `Too many to look up at once (limit ${MAX_LOOKUPS}).`;
    return '';
  }

  function render() {
    box.replaceChildren();
    box.hidden = false;
    const existing = poi.items();
    let lookupIndex = 0;
    rows.forEach((r) => {
      r.dup = isDuplicate(r, existing);
      r.revisit = isRevisit(r, existing);
      r.block = blocked(r, r.status === 'lookup' ? lookupIndex++ : 0);
      if (r.block) r.include = false;
    });
    const ok = rows.filter((r) => r.status === 'ok').length, look = rows.filter((r) => r.status === 'lookup').length;
    box.append(el('p', 'prev-sum', `${rows.length} place${rows.length === 1 ? '' : 's'} found: ${ok} with coordinates, ${look} to look up${meta.skipped ? `, ${meta.skipped} skipped (nothing to place)` : ''}.`));
    for (const n of meta.notes) box.append(el('p', 'hint', n));
    box.append(el('p', 'hint', meta.appExport ? 'This list came from this app.' : 'Locations from an AI can be wrong. They will be added as unverified, so you can check each one on the map.'));

    // Which trip the places go into. A Home marker never goes into one, so with only Home rows there is nothing to choose.
    if (rows.some((r) => r.type !== 'residence')) {
      const sel = el('select'); sel.id = 'ai-trip';
      const add = (value, label) => { const o = el('option', '', label); o.value = value; sel.append(o); };
      if (meta.trips.length === 1) {
        const t = meta.trips[0];
        add('file', `Trip “${t.name}”${t.country ? ` · ${countryName(t.country)}` : ''}${t.startDate ? ` · ${tripDatesLabel(t)}` : ''}: create it, or use yours if it exists`);
      } else if (meta.trips.length > 1) add('file', `As in the file (${meta.trips.length} trips: created, or yours if they exist)`);
      add('none', 'No trip');
      for (const t of poi.store.trips()) add(`t:${t.id}`, `Your trip: ${t.name}`);
      if (![...sel.options].some((o) => o.value === tripChoice)) tripChoice = meta.trips.length ? 'file' : 'none';
      sel.value = tripChoice;
      sel.addEventListener('change', () => { tripChoice = sel.value; render(); });
      const lab = el('label', 'field'); lab.append(el('span', '', 'Put these places in'), sel);
      box.append(lab);
      // a reply's trip without dates cannot be created as it is: ask for them here
      if (tripChoice === 'file') {
        for (const t of meta.trips) {
          if ((t.startDate && t.endDate) || !rows.some((r) => r.type !== 'residence' && r.tripRef === t.ref)) continue;
          const d = tripDates.get(t.ref) ?? {};
          const wrap = el('div', 'ai-trip-dates');
          wrap.append(el('p', 'hint', `“${t.name}” came without dates. A trip needs a start and an end date (the same for one day), or choose “No trip”:`));
          const s = el('input'); s.type = 'date'; s.value = t.startDate || d.start || ''; s.disabled = !!t.startDate; s.setAttribute('aria-label', `Start date of ${t.name}`);
          const e = el('input'); e.type = 'date'; e.value = t.endDate || d.end || ''; e.disabled = !!t.endDate; e.setAttribute('aria-label', `End date of ${t.name}`);
          const keep = () => tripDates.set(t.ref, { start: s.value, end: e.value });
          s.addEventListener('input', keep); e.addEventListener('input', keep);
          const two = el('div', 'two');
          const l1 = el('label', 'field'); l1.append(el('span', '', 'Start date'), s);
          const l2 = el('label', 'field'); l2.append(el('span', '', 'End date'), e);
          two.append(l1, l2); wrap.append(two); box.append(wrap);
        }
      }
    }

    const list = el('ul', 'prev-list');
    rows.forEach((r, i) => {
      const li = el('li');
      const lab = el('label', 'prow');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = r.include; cb.disabled = !!r.block;
      cb.addEventListener('change', () => { r.include = cb.checked; refreshCount(); });
      const body = el('span', 'pbody');
      const trip = [r.date && dateLabel(r), r.day && `Day ${r.day}`, r.order && `Stop ${r.order}`].filter(Boolean).join(' · ');
      body.append(el('b', '', r.name || '(no name)'), el('small', '', `${typeOf(r.type).label}${trip ? ` · ${trip}` : ''}`));
      body.append(el('small', r.block ? 'pwarn' : 'pstat', r.block || ((r.status === 'ok' ? `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}` : `Will look up “${r.query}”`) + (r.revisit ? ' · another visit (you have this place on a different date)' : ''))));
      lab.append(cb, body);
      li.append(lab);
      list.append(li);
    });
    box.append(list);

    const acts = el('div', 'btn-row');
    const add = el('button', 'btn primary'); add.type = 'button'; add.id = 'ai-add';
    const cancel = el('button', 'btn', 'Cancel'); cancel.type = 'button'; cancel.id = 'ai-cancel';
    add.addEventListener('click', () => addSelected(add, cancel));
    cancel.addEventListener('click', () => { controller?.abort(); clearPreview(); });
    acts.append(add, cancel);
    box.append(acts);

    function refreshCount() {
      const n = rows.filter((r) => r.include).length;
      add.textContent = `Add ${n} marker${n === 1 ? '' : 's'}`;
      add.disabled = n === 0;
    }
    refreshCount();
  }

  function clearPreview() { rows = []; meta = null; tripDates.clear(); box.replaceChildren(); box.hidden = true; }

  // turning name lookup on or off while a preview is open changes which places can be added
  onPrivacyChange(() => { if (rows.length && !controller) { rows.forEach((r) => { r.include = true; }); render(); } });

  function preview(source) {
    try {
      const parsed = parseItinerary(source);
      meta = parsed;
      rows = parsed.rows.map((r) => ({ ...r, include: true }));
      // default: the reply's own trip if it has one, else the trip chosen for new markers, else none
      const cur = poi.getCurrentTrip();
      tripChoice = parsed.trips.length ? 'file' : cur ? `t:${cur}` : 'none';
      render();
      box.scrollIntoView({ block: 'nearest' });
    } catch (e) {
      clearPreview();
      toast(e.message, 8000);
    }
  }
  $('ai-preview-btn').addEventListener('click', () => preview(text.value));

  // ---------- add ----------
  async function addSelected(addBtn, cancelBtn) {
    const chosen = rows.filter((r) => r.include);
    if (!chosen.length) return;
    const need = needDates();
    if (need.length) { toast(`Give the trip “${need[0].name}” a start and an end date first, or choose “No trip”.`, 7000); return; }
    addBtn.disabled = true;
    controller = new AbortController();
    const found = [], failed = [];
    const lookups = chosen.filter((r) => r.status === 'lookup');
    const bias = map.getCenter();
    let done = 0;
    try {
      for (const r of chosen) {
        if (r.status === 'ok') { found.push(r); continue; }
        addBtn.textContent = `Looking up ${++done} of ${lookups.length}…`;
        cancelBtn.textContent = 'Stop';
        const g = await geocode(r.query, bias, controller.signal);
        if (g) found.push({ ...r, lat: g.lat, lon: g.lon, unverified: true }); else failed.push(r.name || r.query);
        await pause(250, controller.signal);
      }
    } catch (e) {
      if (e.name === 'AbortError') { toast('Stopped. Nothing was added.'); clearPreview(); return; }
      throw e;
    } finally { controller = null; }

    const existing = poi.items();
    const fresh = found.filter((r) => !isDuplicate(r, existing));

    // The trip each place goes into. Trips from the reply are created now, only if a place that is really added uses them,
    // and a trip you already have with the same name, country and dates is reused rather than duplicated.
    const choice = tripChoice, tripIdByRef = new Map();
    let createdTrips = 0;
    const tripFor = (r) => {
      if (r.type === 'residence' || choice === 'none') return undefined; // a Home marker belongs to no trip
      if (choice.startsWith('t:')) return poi.store.getTrip(choice.slice(2)) ? choice.slice(2) : undefined;
      if (!r.tripRef) return undefined;
      if (!tripIdByRef.has(r.tripRef)) {
        const def = meta.trips.find((t) => t.ref === r.tripRef);
        const res = def ? poi.store.ensureTrip({ ...def, ...mergedDates(def) }) : null;
        if (res?.created) createdTrips++;
        tripIdByRef.set(r.tripRef, res?.trip?.id);
      }
      return tripIdByRef.get(r.tripRef);
    };

    const { added, stored } = poi.addMany(fresh.map((r) => {
      const tripId = tripFor(r);
      const trip = tripId ? poi.store.getTrip(tripId) : null;
      // a day number becomes a date in a trip with dates (day 1 is the start date); the day itself is then worked out from the date
      let date = r.date ?? undefined, day = r.day ?? undefined;
      if (trip?.startDate) { if (!date && day) date = addDays(trip.startDate, day - 1); day = undefined; }
      return { type: r.type, name: r.name, note: r.note, day, order: r.order ?? undefined, date, endDate: r.endDate ?? undefined, lat: r.lat, lon: r.lon, unverified: r.unverified, tripId };
    }));
    const unv = added.filter((a) => a.unverified).length;
    toast(`Added ${added.length} marker${added.length === 1 ? '' : 's'}${createdTrips ? ` and ${createdTrips} trip${createdTrips === 1 ? '' : 's'}` : ''}${unv ? `, ${unv} unverified: check ${unv === 1 ? 'it' : 'them'} on the map` : ''}.`
      + `${failed.length ? ` Not found: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}.` : ''}`
      + `${stored ? '' : ' The browser would not store them: export to keep them.'}`, 9000);
    text.value = '';
    clearPreview();
    poi.fitToItems(added);
  }

  // ---------- share links ----------
  $('poi-share').addEventListener('click', async () => {
    const all = poi.items();
    const items = all.filter((i) => i.type !== 'residence'); // a link gets passed around: the Home marker (a residence) never goes in one
    const left = all.length - items.length;
    if (!items.length) { toast(left ? 'Nothing to share: your Home marker (your residence) is never put in a link.' : 'Nothing to share yet.', 6000); return; }
    // ids and creation times are noise in a link; dates, day, order, the unverified flag and the trips the shared markers are in are kept
    const used = new Set(items.map((i) => i.tripId).filter(Boolean));
    const gj = toGeoJSON(items, poi.store.trips().filter((t) => used.has(t.id)));
    for (const f of gj.features) { delete f.properties.id; delete f.properties.created; }
    const url = `${location.origin}${location.pathname}#import=${await encodeShare(JSON.stringify(gj))}`;
    try {
      await navigator.clipboard.writeText(url);
      const home = left ? ' Your Home marker was left out.' : '';
      toast((url.length > LONG_LINK ? `Link copied (${url.length} characters). Some apps cut long links, so use Export if it does not open.` : 'Link copied. Opening it elsewhere shows a preview before anything is added.') + home, 7000);
    } catch { toast('Could not copy the link.', 6000); }
  });

  /** A #import=… link: show what it carries as a preview. It is never added without confirmation. */
  async function fromHash() {
    const m = location.hash.match(/^#import=(.+)$/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search); // so a refresh does not offer it again
    panel.open('trips');
    try {
      preview(await decodeShare(m[1]));
      if (rows.length) toast('A link brought a list of places. Check it in the panel, then press Add.', 7000);
    } catch (e) { toast(e.message, 8000); }
  }

  // A link pasted into the address bar of a tab where the app is already open only changes the fragment: no reload, so listen for it.
  window.addEventListener('hashchange', fromHash);

  return { fromHash, preview };
}
