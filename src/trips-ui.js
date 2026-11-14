// The Trips tab: create, edit and delete trips, see what is in each, and jump to its markers.
// A trip groups markers; distances from a waypoint to a hotel or home point stay inside its trip. Data is in poi.js.
import { COUNTRIES, countryCode, countryName } from './countries.js';
import { sortTrips, tripSummary, tripLength, tripStatus, countdownLabel, todayISO, isPastTrip, planDays, tripWarnings, warningsLine, dayInfo, dayText, sideQuestMap } from './trips.js';
import { formatDate, typeOf, MAX_NOTES, MAX_CHECKLIST } from './poi.js';
import { getDistanceSettings } from './units.js';
import { fmtDistance } from './distance.js';
import { createTripWeather, weatherInfo, forecastSpots } from './tripweather.js';
import { getWindLimit } from './weather.js';
import { getPrivacy } from './privacy.js';
import { el } from './cards.js';
import { log } from './log.js';
import { checkinCell } from './checkin-ui.js';
import { visitedCount } from './checkin.js';
import { onPrivacyChange } from './privacy.js';
import { routeLinks } from './maplinks-ui.js';
import { MAX_STOPS } from './maplinks.js';
import { loadPrefs } from './prefs.js';
import { initReorder } from './reorder-ui.js';

const $ = (id) => document.getElementById(id);

export function initTripsUI({ poi, panel, toast, checkPoint, zoneSummary }) {
  const store = poi.store;
  const cin = poi.checkin;
  const list = $('trips-list'), empty = $('trips-empty'), count = $('trips-count');
  const card = $('trip-form-card'), form = $('trip-form'), title = $('trip-form-title');
  const fName = $('trip-name'), fCountry = $('trip-country'), fStart = $('trip-start'), fEnd = $('trip-end'), fDesc = $('trip-desc');
  const lengthEl = $('trip-length'), errorEl = $('trip-error');
  let party = null;       // shared trips (party-ui.js), once it has loaded; only in a build with accounts
  let editingId = null;   // the trip being edited, or null for a new one
  let assignId = null;    // a marker to put in the new trip once it is saved ("New trip…" in a marker's form)

  // the country list the field suggests from
  for (const [, name] of COUNTRIES) { const o = document.createElement('option'); o.value = name; $('country-list').append(o); }

  // ---------- the list ----------
  let dayShown = null;    // the day the flip card shows, drawn on the map while the trip screen is on show
  const syncDay = () => poi.showDay?.(dayShown && panel.isOpen() && panel.getTab() === 'trips' ? dayShown.tripId : null, dayShown?.date);
  panel.onChange?.(syncDay);
  let openId = null;      // the trip whose detail screen is showing, or null for the list
  const forecastListeners = new Set();
  const tw = createTripWeather({ onChange: () => { render(); for (const fn of forecastListeners) fn(); } }); // per-day forecasts, only while automatic weather is on
  const pageOf = new Map();       // tripId -> the page (day) of its flip card, kept while the page is open
  let revealStop = null;          // while a trip's detail is drawn: brings one stop's row into view, turning to its day first
  const zoneChecks = new Map(); // tripId -> Map(markerId -> { sig, s }): what the map data says about each stop, until the page closes
  const sigOf = (it) => `${it.lat},${it.lon}`;
  const dayWeatherText = (w) => [`${weatherInfo(w.code).icon} ${w.max !== null ? Math.round(w.max) : '–'}°/${w.min !== null ? Math.round(w.min) : '–'}°`, w.snow !== null && w.snow >= 0.1 ? `snow ${w.snow.toFixed(1)} cm` : w.rain !== null && `rain ${Math.round(w.rain)}%`, w.wind !== null && `wind ${w.wind.toFixed(0)} m/s`].filter(Boolean).join(' · ');
  const listCard = list.closest('.card'), detail = $('trip-detail'), aiCard = $('ai-card');
  const pastBox = $('trips-past'), pastList = $('trips-past-list');

  function tripCard(t, items, today) {
    const n = items.filter((i) => i.tripId === t.id).length;
    const isCurrent = poi.getCurrentTrip() === t.id;
    const li = el('li', 'trip-card clickable');
    const head = el('div', 'trip-card-head');
    const dot = el('i', 'trip-dot-sm'); dot.style.background = t.color;
    const name = el('b', '', t.name);
    if (isCurrent) name.append(' ', el('span', 'badge ok', 'For new markers'));
    head.append(dot, name);
    const status = tripStatus(t, today);
    if (status) head.append(el('span', 'trip-countdown', countdownLabel(status)));
    li.append(head);
    const summary = tripSummary(t);
    if (summary) li.append(el('div', 'trip-card-sub', summary));
    if (t.shared) { const c = party?.membersCount(t.id); li.append(el('div', 'trip-card-sub party-line', '👥 Shared · ' + (t.shared.owner ? 'you own it' : 'by ' + (t.shared.ownerName || 'a friend')) + (c ? ' · ' + c + ' in the party' : ''))); }
    if (!t.startDate || !t.endDate) li.append(el('div', 'trip-card-warn', 'No dates yet. Add them (Edit) to see day numbers and the countdown.'));
    else {
      const line = warningsLine(tripWarnings(items, t));
      if (line) li.append(el('div', 'trip-card-warn', '⚠ ' + line));
    }
    const fc = tw.get(t.id);
    if (fc && tripLength(t)) {
      const strip = el('div', 'trip-wx-strip');
      for (const d of planDays(items, t).days) {
        const w = fc[d.date];
        if (!w) continue;
        const cell = el('span', '', weatherInfo(w.code).icon);
        cell.title = `${formatDate(d.date)}: ${weatherInfo(w.code).label}, ${dayWeatherText(w).replace(/^\S+ /, '')}`;
        strip.append(cell);
      }
      if (strip.childNodes.length) li.append(strip);
    }
    if (t.description) li.append(el('p', 'trip-card-desc', t.description));
    const done = t.checklist ? t.checklist.filter((c) => c.done).length : 0;
    const visited = visitedCount(items.filter((i) => i.tripId === t.id));
    li.append(el('div', 'trip-card-count', [n + ' marker' + (n === 1 ? '' : 's'), (visited.done || (cin.enabled() && visited.total)) && visited.done + ' of ' + visited.total + ' visited', t.checklist && done + ' of ' + t.checklist.length + ' checked'].filter(Boolean).join(' · ')));

    const acts = el('div', 'btn-row trip-acts');
    const btn = (text, fn, cls = '') => { const b = el('button', ('btn small ' + cls).trim(), text); b.type = 'button'; b.addEventListener('click', fn); acts.append(b); return b; };
    btn('Open', () => openDetail(t.id), 'primary');
    btn('Show markers', () => poi.showTrip(t.id));
    btn('Fit map', () => { if (poi.fitTrip(t.id)) panel.closeIfPhone(); });
    if (!isCurrent) btn('Use for new markers', () => { poi.setCurrentTrip(t.id); render(); toast('New markers will go into “' + t.name + '”.', 4000); });
    btn('Edit', () => openForm(t));
    deleteOrLeave(btn, t, n);
    li.append(acts);
    li.addEventListener('click', (e) => { if (!e.target.closest('button, a, input')) openDetail(t.id); });
    return li;
  }
  /** Delete for a trip of your own; Leave for a shared trip you were invited to (only the owner deletes a shared trip). */
  function deleteOrLeave(btn, t, n) {
    if (t.shared && !t.shared.owner) {
      const b = btn('Leave trip', () => party?.leave(t), 'danger');
      if (!party?.ready()) { b.disabled = true; b.title = 'Sign in to leave a shared trip'; }
    } else btn('Delete', deleteHandler(t, n), 'danger');
  }
  /** The two-step Delete shared by the card and the detail screen. For a shared trip the owner deletes it for the whole party. */
  function deleteHandler(t, n) {
    let armed = null;
    const sharedOwner = !!t.shared?.owner;
    return async (e) => {
      const b = e.currentTarget;
      if (!armed) {
        b.textContent = sharedOwner ? 'Confirm: deletes it for the whole party' : n ? 'Confirm: ' + n + ' marker' + (n === 1 ? '' : 's') + ' stay without a trip' : 'Confirm delete';
        armed = setTimeout(() => { b.textContent = 'Delete'; armed = null; }, 5000);
        return;
      }
      clearTimeout(armed);
      if (sharedOwner) {
        if (!party?.ready()) { toast('Sign in to delete a shared trip.', 5000); b.textContent = 'Delete'; armed = null; return; }
        if (!(await party.deleteShared(t))) { b.textContent = 'Delete'; armed = null; return; }
      }
      const res = store.removeTrip(t.id);
      toast('Deleted “' + t.name + '”.' + (res.untagged ? ' Its ' + res.untagged + ' marker' + (res.untagged === 1 ? ' is' : 's are') + ' kept, with no trip.' : ''), 6000);
    };
  }

  function render() {
    const trips = sortTrips(store.trips());
    const items = store.items();
    const today = todayISO();
    count.textContent = trips.length ? '(' + trips.length + ')' : '';
    empty.hidden = trips.length > 0;
    list.replaceChildren(); pastList.replaceChildren();
    const past = trips.filter((t) => isPastTrip(t, today));
    for (const t of trips) (past.includes(t) ? pastList : list).append(tripCard(t, items, today));
    pastBox.hidden = !past.length;
    if (getPrivacy().autoWeather) {
      tw.prune(trips.map((t) => t.id));
      for (const t of trips.filter((x) => !past.includes(x) && tripLength(x)).slice(0, 6)) tw.ensure(t.id, forecastSpots(planDays(items, t).days, today));
    }
    $('trips-past-title').textContent = 'Past trips (' + past.length + ')';
    const open = openId && store.getTrip(openId);
    if (!open) openId = null;
    listCard.hidden = !!open; aiCard.hidden = !!open; detail.hidden = !open;
    revealStop = null;
    if (open) renderDetail(open, items, today);
  }

  // ---------- one trip: warnings, the days, notes and the checklist ----------
  function openDetail(id) { openId = id; render(); panel.open('trips'); $('pane-trips').scrollTop = 0; detail.scrollIntoView({ block: 'start' }); }
  function closeDetail() { openId = null; dayShown = null; syncDay(); render(); }

  async function runZoneCheck(t, stops, btn) {
    btn.disabled = true;
    const found = new Map();
    let n = 0;
    for (const it of stops) {
      btn.textContent = 'Checking ' + (++n) + ' of ' + stops.length + '…';
      try { found.set(it.id, { sig: sigOf(it), s: zoneSummary(await checkPoint(it.lat, it.lon)) }); } catch (e) { log.warn('trips', 'a stop could not be checked', e); /* a stop that cannot be read simply has no verdict */ }
    }
    zoneChecks.set(t.id, found);
    const bad = [...found.values()].filter((z) => z.s.cls === 'no').length;
    toast(bad ? bad + ' of ' + stops.length + ' stop' + (stops.length === 1 ? '' : 's') + ' need a look: see the warnings.' : 'Checked ' + stops.length + ' stop' + (stops.length === 1 ? '' : 's') + ': none is inside a restricted area.', 6000);
    render();
  }

  function renderDetail(t, items, today) {
    cin.unbind('trips');
    detail.replaceChildren();
    const top = el('div', 'trip-detail-top');
    const back = el('button', 'btn small', '‹ Trips'); back.type = 'button'; back.addEventListener('click', closeDetail);
    const edit = el('button', 'btn small', 'Edit'); edit.type = 'button'; edit.addEventListener('click', () => openForm(t));
    top.append(back, edit);
    const h = el('h2', 'trip-detail-title');
    const dot = el('i', 'trip-dot-sm'); dot.style.background = t.color;
    h.append(dot, t.name);
    detail.append(top, h);
    const status = tripStatus(t, today);
    const sub = el('div', 'trip-card-sub', [tripSummary(t), status && countdownLabel(status)].filter(Boolean).join(' · '));
    detail.append(sub);
    if (t.description) detail.append(el('p', 'trip-card-desc full', t.description));
    const acts = el('div', 'btn-row trip-acts');
    const btn = (text, fn, cls = '') => { const x = el('button', ('btn small ' + cls).trim(), text); x.type = 'button'; x.addEventListener('click', fn); acts.append(x); return x; };
    btn('Show markers', () => poi.showTrip(t.id));
    btn('Fit map', () => { if (poi.fitTrip(t.id)) panel.closeIfPhone(); });
    if (poi.getCurrentTrip() !== t.id) btn('Use for new markers', () => { poi.setCurrentTrip(t.id); render(); toast('New markers will go into “' + t.name + '”.', 4000); });
    const n = items.filter((i) => i.tripId === t.id).length;
    deleteOrLeave(btn, t, n);
    detail.append(acts);
    if (party) detail.append(party.section(t)); // Party Members: share the trip, invite friends, see who is in it

    const dated = !!tripLength(t);
    if (dated) {
      const w = tripWarnings(items, t);
      const msgs = [];
      if (w.undated) msgs.push(w.undated + ' marker' + (w.undated === 1 ? ' has' : 's have') + ' no date (listed under “No date” below).');
      if (w.outside) msgs.push(w.outside + ' marker' + (w.outside === 1 ? ' is' : 's are') + ' dated outside the trip (listed under “Outside the dates”).');
      for (const d of w.noHotel) msgs.push('No accommodation for the night of Day ' + d + '.');
      const zr = zoneChecks.get(t.id);
      if (zr) for (const it of items) { const z = it.tripId === t.id && zr.get(it.id); if (z && z.sig === sigOf(it) && z.s.cls === 'no') msgs.push(it.name + ': ' + z.s.title + '.'); }
      const box = el('details', 'trip-warnings'); box.open = msgs.length > 0;
      box.append(el('summary', '', msgs.length ? 'Warnings (' + msgs.length + ')' : 'No warnings'));
      if (msgs.length) { const ul = el('ul'); for (const m of msgs) ul.append(el('li', '', m)); box.append(ul); }
      else box.append(el('p', 'hint', 'Every marker is dated inside the trip' + (items.some((i) => i.tripId === t.id && i.type === 'hotel') ? ', and every night has accommodation.' : '.')));
      detail.append(box);
      const stopsToCheck = items.filter((i) => i.tripId === t.id && i.type !== 'residence');
      if (stopsToCheck.length) {
        const row = el('div', 'btn-row trip-acts');
        const chk = el('button', 'btn small', zoneChecks.has(t.id) ? 'Check stops again' : 'Check stops against no-fly zones'); chk.type = 'button';
        chk.addEventListener('click', () => runZoneCheck(t, stopsToCheck, chk));
        row.append(chk, el('small', 'hint', 'Reads the map data in your browser; nothing is sent.'));
        detail.append(row);
      }
    }

    // the days
    const units = getDistanceSettings().units;
    const plan = planDays(items, t);
    const fc = tw.get(t.id);
    const limit = getWindLimit();
    const sm = sideQuestMap(items); // each main stop's Side Quests, folded under it until it is tapped
    const stopRow = (it, day, dragKey, parentId) => { // dragKey: the date of the day page it is on (rows there can be held and dragged)
      const row = el('button', 'plan-stop'); row.type = 'button';
      poi.cards.mark(row, it.id); // highlighted while this marker (or, for a parent, one of its Side Quests) is selected
      const info = dayInfo(it, t);
      const mark = el('span', 'plan-n', it.isSub ? '↳' : it.order !== undefined ? String(it.order) : '•');
      const text = el('span', 'plan-name');
      text.append(el('b', '', it.name), el('small', '', [typeOf(it.type).label, day === undefined && it.date && formatDate(it.date), info && info.last > info.day && dayText(info)].filter(Boolean).join(' · ')));
      const z = zoneChecks.get(t.id)?.get(it.id);
      if (z && z.sig === sigOf(it)) text.append(el('small', 'plan-zone ' + z.s.cls, z.s.title));
      row.append(mark, text);
      const kids = it.isSub ? [] : sm.byParent.get(it.id) ?? [];
      row.addEventListener('click', () => { if (!it.isSub) poi.sideState.set(kids.length ? it.id : null); poi.openMarker(it.id); }); // a tap opens the marker and unfolds its Side Quests
      const cell = checkinCell({ cin, store, id: it.id, ns: 'trips' }); // Check in, or what was recorded, at the right
      let chip = null;
      if (kids.length) {
        const open = poi.sideState.expanded() === it.id;
        chip = el('button', 'side-chip', `${open ? '▴' : '▾'} ${kids.length}`); chip.type = 'button';
        chip.title = `${kids.length} Side Quest${kids.length === 1 ? '' : 's'}: ${open ? 'fold away' : 'show'}`; chip.setAttribute('aria-expanded', String(open)); chip.setAttribute('aria-label', chip.title);
        chip.addEventListener('click', (e) => { e.stopPropagation(); poi.sideState.set(open ? null : it.id); });
      }
      let line = row;
      if (cell || chip) { line = el('div', 'plan-row'); line.append(row, ...[chip, cell].filter(Boolean)); }
      if (dragKey && it.type !== 'residence' && (it.isSub ? parentId : it.date === dragKey)) {
        Object.assign(line.dataset, { id: it.id, scope: t.id, mode: 'date', gkey: dragKey, drag: '1' });
        if (it.isSub) Object.assign(line.dataset, { sub: '1', parent: parentId });
      }
      if (!kids.length || poi.sideState.expanded() !== it.id) return line;
      const group = el('div', 'plan-group');
      group.append(line);
      for (const k of kids) { const kr = stopRow(k, day, dragKey, it.id); kr.classList.add('plan-side'); group.append(kr); }
      return group;
    };
    // the days, as pages of one card: ‹ and › turn to the previous and next day
    const pages = [];
    if (dated) for (const d of plan.days) pages.push({ day: d });
    if (plan.undated.length) pages.push({ label: 'No date', list: plan.undated });
    if (plan.outside.length) pages.push({ label: 'Outside the dates', list: plan.outside });
    if (pages.length) {
      let at = pageOf.get(t.id);
      if (at === undefined) at = status && status.state === 'now' ? status.day - 1 : 0; // a trip under way opens on today
      at = Math.max(0, Math.min(at, pages.length - 1));
      const flip = el('section', 'flip'); flip.tabIndex = 0; flip.setAttribute('aria-label', 'Days of the trip');
      const turn = (label, path) => { const bt = el('button', 'btn tool flip-btn'); bt.type = 'button'; bt.title = label; bt.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>'; bt.append(el('span', 'tool-label', label)); return bt; };
      const prev = turn('Previous day', 'M15 6l-6 6 6 6'), next = turn('Next day', 'M9 6l6 6-6 6');
      const title = el('div', 'flip-title'); title.setAttribute('aria-live', 'polite');
      const nav = el('div', 'flip-nav'); nav.append(prev, title, next);
      const body = el('div', 'flip-body'), dots = el('div', 'flip-dots');
      flip.append(nav, body, dots);
      const paint = (dir) => {
        const pg = pages[at];
        body.replaceChildren(); dots.replaceChildren();
        const stops = pg.day ? pg.day.stops : pg.list;
        title.textContent = pg.day ? 'Day ' + pg.day.day + ' of ' + plan.days.length + ' · ' + formatDate(pg.day.date) : pg.label + ' (' + pg.list.length + ')';
        if (pg.day) {
          const d = pg.day;
          const w = fc?.[d.date];
          if (w) { const line = el('small', 'plan-wx' + (limit !== null && w.wind !== null && w.wind > limit ? ' over' : ''), dayWeatherText(w)); line.title = weatherInfo(w.code).label; body.append(line); }
          const seen = visitedCount(stops);
          if (seen.done || (cin.enabled() && seen.total)) body.append(el('small', 'plan-km', seen.done + ' of ' + seen.total + ' visited'));
          if (d.km >= 0.1) body.append(el('small', 'plan-km', '≈ ' + fmtDistance(d.km * 1000, units) + ' between stops'));
          if (!stops.length) body.append(el('small', 'plan-empty', 'Nothing planned'));
        }
        for (const it of stops) body.append(stopRow(it, pg.day ? pg.day.day : undefined, pg.day?.date));
        if (stops.length) {
          const fit = el('button', 'btn small', pg.day ? 'Fit map to this day' : 'Fit map to these'); fit.type = 'button';
          fit.addEventListener('click', () => poi.fitItems(stops.map((x) => x.id)));
          body.append(fit);
        }
        if (pg.day && stops.length >= 2 && stops.length <= MAX_STOPS) { // a route through the day's stops, in order
          const nav = el('div', 'day-route');
          nav.append(el('small', 'plan-km', 'Navigate this day'), ...routeLinks({ stops: stops.map((s) => ({ lat: s.lat, lon: s.lon, name: s.name })), mode: loadPrefs().mapMode ?? 'drive', home: false }));
          body.append(nav);
        }
        prev.disabled = at === 0; next.disabled = at === pages.length - 1;
        dayShown = pg.day ? { tripId: t.id, date: pg.day.date } : null; syncDay();
        pages.forEach((p, i) => {
          const dot = el('button', 'flip-dot'); dot.type = 'button'; dot.setAttribute('aria-label', p.day ? 'Day ' + p.day.day : p.label);
          if (i === at) dot.setAttribute('aria-current', 'true');
          dot.addEventListener('click', () => go(i));
          dots.append(dot);
        });
        if (dir) { body.classList.remove('flip-next', 'flip-prev'); void body.offsetWidth; body.classList.add(dir > 0 ? 'flip-next' : 'flip-prev'); }
      };
      const go = (to) => { if (to < 0 || to >= pages.length || to === at) return; const dir = to > at ? 1 : -1; at = to; pageOf.set(t.id, at); paint(dir); };
      revealStop = (id) => { // a marker was clicked on the map: turn to its day (a Side Quest is on its parent's) and scroll to its row
        const day = pages.findIndex((pg) => (pg.day ? pg.day.stops : pg.list).some((s) => s.id === id || (sm.byParent.get(s.id) ?? []).some((k) => k.id === id)));
        if (day >= 0) go(day);
        poi.cards.scrollTo(detail.querySelector(`[data-stop-id="${CSS.escape(id)}"]`));
      };
      prev.addEventListener('click', () => go(at - 1));
      next.addEventListener('click', () => go(at + 1));
      flip.addEventListener('keydown', (e) => { if (e.target.closest('input, textarea, select')) return; if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); } });
      let sx = null, sy = null; // a swipe on a touch screen
      body.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { sx = e.clientX; sy = e.clientY; } });
      body.addEventListener('pointerup', (e) => { if (sx === null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null; if (Math.abs(dx) > 50 && Math.abs(dy) < 40) go(at + (dx < 0 ? 1 : -1)); });
      body.addEventListener('pointercancel', () => { sx = null; });
      paint(0);
      detail.append(flip);
    }
    revealStop ??= (id) => poi.cards.scrollTo(detail.querySelector(`[data-stop-id="${CSS.escape(id)}"]`)); // no day pages: only the loose rows below
    const lone = sm.orphans.filter((s) => s.tripId === t.id); // Side Quests with no main stop to hang from
    if (lone.length) { detail.append(el('p', 'hint', `Side Quests with no main stop (${lone.length}):`)); for (const s of lone) detail.append(stopRow(s)); }
    if (!dated) detail.append(el('p', 'hint', 'Add start and end dates (Edit) to see the days.'));
    if (dated) detail.append(el('p', 'hint', 'Distances are straight lines between the stops of a day, not driving distances.'));
    if (dated && forecastSpots(plan.days, today).length) {
      detail.append(el('p', 'hint', getPrivacy().autoWeather
        ? 'Forecast per day from Open-Meteo.com, for the first stop of each day, up to 16 days ahead.'
        : 'Turn on automatic weather in the privacy settings (shield button) to see a forecast for each day, up to 16 days ahead.'));
    }

    // notes
    const notes = el('section', 'trip-notes');
    notes.append(el('h3', '', 'Notes'));
    const ta = el('textarea'); ta.rows = 4; ta.maxLength = MAX_NOTES; ta.value = t.notes ?? ''; ta.placeholder = 'Anything to remember for this trip';
    ta.setAttribute('aria-label', 'Trip notes');
    ta.addEventListener('change', () => { store.updateTrip(t.id, { notes: ta.value }); });
    notes.append(ta, el('small', 'hint', 'Saved in this browser when you leave the box.'));
    detail.append(notes);

    // checklist
    const checks = el('section', 'trip-checklist');
    const list0 = t.checklist ?? [];
    checks.append(el('h3', '', list0.length ? 'Checklist (' + list0.filter((c) => c.done).length + ' of ' + list0.length + ')' : 'Checklist'));
    const ul = el('ul', 'check-list');
    list0.forEach((c, i) => {
      const li = el('li');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = c.done; cb.setAttribute('aria-label', c.text);
      cb.addEventListener('change', () => store.updateTrip(t.id, { checklist: list0.map((x, j) => (j === i ? { ...x, done: cb.checked } : x)) }));
      const label = el('span', c.done ? 'done' : '', c.text);
      const rm = el('button', 'icon-btn', '✕'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove ' + c.text);
      rm.addEventListener('click', () => store.updateTrip(t.id, { checklist: list0.filter((_, j) => j !== i) }));
      li.append(cb, label, rm); ul.append(li);
    });
    checks.append(ul);
    const add = el('div', 'check-add');
    const input = el('input'); input.type = 'text'; input.maxLength = 80; input.placeholder = 'Add an item, e.g. Batteries charged'; input.setAttribute('aria-label', 'New checklist item');
    const addBtn = el('button', 'btn small', 'Add'); addBtn.type = 'button';
    const addItem = () => {
      const text = input.value.trim();
      if (!text) return;
      if (list0.length >= MAX_CHECKLIST) { toast('A checklist can have ' + MAX_CHECKLIST + ' items.'); return; }
      store.updateTrip(t.id, { checklist: [...list0, { text, done: false }] });
      detail.querySelector('.check-add input')?.focus();
    };
    addBtn.addEventListener('click', addItem);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
    add.append(input, addBtn);
    checks.append(add);
    detail.append(checks);
  }

  // ---------- the form ----------
  const showError = (text) => { errorEl.textContent = text; errorEl.hidden = !text; };
  function updateDates() {
    fEnd.disabled = !fStart.value;
    fEnd.min = fStart.value || '2000-01-01';
    if (!fStart.value) fEnd.value = '';
    const n = fStart.value && fEnd.value ? tripLength({ startDate: fStart.value, endDate: fEnd.value }) : null;
    lengthEl.textContent = n === null ? '' : n < 1 ? '' : `${n} day${n === 1 ? '' : 's'}`;
  }
  fStart.addEventListener('input', updateDates);
  fEnd.addEventListener('input', updateDates);

  function openForm(trip = null, { assign = null } = {}) {
    editingId = trip?.id ?? null;
    assignId = assign;
    title.textContent = trip ? 'Edit trip' : 'New trip';
    fName.value = trip?.name ?? '';
    fCountry.value = trip?.country ? countryName(trip.country) : '';
    fStart.value = trip?.startDate ?? '';
    fEnd.value = trip?.endDate ?? '';
    fDesc.value = trip?.description ?? '';
    showError('');
    updateDates();
    card.hidden = false;
    panel.open('trips');
    card.scrollIntoView({ block: 'nearest' });
    setTimeout(() => fName.focus(), 0);
  }
  function closeForm() { card.hidden = true; editingId = null; assignId = null; showError(''); }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = fName.value.trim();
    if (!name) { showError('Give the trip a name.'); fName.focus(); return; }
    const countryText = fCountry.value.trim();
    const country = countryText ? countryCode(countryText) : null;
    if (countryText && !country) { showError('Choose a country from the list, or leave the country empty.'); fCountry.focus(); return; }
    if (!fStart.value) { showError('Add a start date: day numbers and the countdown depend on it.'); fStart.focus(); return; }
    if (!fEnd.value) { showError('Add an end date (the same as the start date for a one-day trip).'); fEnd.focus(); return; }
    if (fEnd.value < fStart.value) { showError('The end date cannot be before the start date.'); fEnd.focus(); return; }
    const fields = { name, country, startDate: fStart.value || null, endDate: fEnd.value || null, description: fDesc.value };

    if (editingId) {
      const res = store.updateTrip(editingId, fields);
      if (!res.trip) { showError('Could not save that change.'); return; }
      toast(res.ok ? `Saved “${res.trip.name}”.` : 'Saved for now, but the browser would not store it. Export your markers to keep them.', 5000);
    } else {
      const res = store.addTrip(fields);
      if (!res.trip) { showError(res.reason === 'limit' ? 'You can keep up to 200 trips.' : 'Could not save that trip.'); return; }
      poi.setCurrentTrip(res.trip.id); // a new trip is where the next markers go; the card says so and the choice is one tap to change
      if (assignId) poi.tagMarker(assignId, res.trip.id);
      toast(`Created “${res.trip.name}”.${assignId ? ' The marker is in it.' : ' New markers will go into it.'}`, 5000);
    }
    closeForm();
    render();
  });
  $('trip-cancel').addEventListener('click', closeForm);
  $('trip-new').addEventListener('click', () => openForm());

  poi.setNewTripHandler((markerId) => openForm(null, { assign: markerId }));
  store.onChange(render);
  poi.sideState.onChange(render); // a card was unfolded or folded in a list
  poi.cards.onReveal((id, tab) => { if (tab === 'trips') revealStop?.(id); }); // a marker was clicked on the map while this tab is open
  // Hold a stop on a day page for 1 s and drag it to another place the same day (moving between days is done in the Points of Interest tab).
  // The rules are the list's (poi-ui.js moveStop / stepStop); the page redraws from the store.
  const refocus = (id) => setTimeout(() => detail.querySelector(`[data-id="${CSS.escape(id)}"] .plan-stop, .plan-stop[data-id="${CSS.escape(id)}"]`)?.focus(), 60);
  initReorder({
    list: detail, scroller: detail.closest('.sp-body') || detail, flat: true,
    onDrop: (d) => { poi.moveStop(d); },
    onStep: (id, scope, mode, dir) => {
      const row = detail.querySelector(`[data-id="${CSS.escape(id)}"][data-drag]`);
      // a main stop steps within its day only: stepping past the first or last stop of the page would change its date
      const mates = [...detail.querySelectorAll(`[data-drag][data-scope="${scope}"]:not([data-sub])`)].map((x) => x.dataset.id);
      const at = mates.indexOf(id);
      if (row?.dataset.sub !== '1' && (at < 0 || at + dir < 0 || at + dir >= mates.length)) return;
      if (poi.stepStop(id, scope, mode, dir)) refocus(id);
    },
  });
  onPrivacyChange(render); // check-in switched on or off changes the rows
  render();
  return {
    openForm, openDetail,
    refresh: render,
    /** Shared trips: the Party Members section and the Leave button appear once this is set. */
    setParty(p) { party = p; p.attach({ refresh: render }); render(); },
    /** The first day of a trip that has a forecast: { date, text }, or null (weather off, no forecast yet, or the trip is out of range). */
    forecastFor(tripId) {
      const t = store.getTrip(tripId), fc = t && tw.get(tripId);
      if (!fc) return null;
      const day = planDays(store.items(), t).days.find((d) => fc[d.date]);
      return day ? { date: day.date, text: dayWeatherText(fc[day.date]) } : null;
    },
    onForecast(fn) { forecastListeners.add(fn); },
  };
}
