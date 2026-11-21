// The content of the marker window (view and edit form) as a plain DOM builder. It was the body of popupContent in poi-ui.js; moved here unchanged
// (Review 01 S3) so a host other than a Leaflet popup can show it. It creates no popup: the host passes what it can do (close, update).
// Everything that lives in poi-ui.js (the store, the marker layer, the open window's state and the actions) comes in through `d`, read when needed, never copied.
import { typeOf, TYPE_GROUPS, pinSvg, sortForList, posInt, isoDate, listMode, dateLabel, isMain, isSub, stopNo, NOT_SUB } from './poi.js';
import { sortTrips, tripDatesLabel, outsideTrip, dayInfo, dayText, tripSequence } from './trips.js';
import { visitLabel } from './places.js';
import { mapLinkIcons } from './maplinks-ui.js';
import { markerActions, popupLayout, panelLayout, panelActions } from './marker-actions.js';
import { el, statusEl, disclaimer, toolBar } from './cards.js';
import { zoneExplanation } from './legends.js';
import { onPopupSwipe } from './swipe.js';
import { checkinStamp } from './checkin-ui.js';

export const fmt = (v) => v.toFixed(5);
export const tripLabel = (it, trip) => [dayText(dayInfo(it, trip)), stopNo(it) !== undefined && `Stop ${stopNo(it)}`].filter(Boolean).join(' · ');

/**
 * `d` = {
 *   store, cin, elev, toast, checkPoint, zoneSummary, weatherButton, showWeather,
 *   detailsOn(), expanded(), markers(), visitMap(), sideMap(), subParent(), newTripHandler(), setWxLine(line | null),
 *   tripOf, iconOf, sigOf, eyeLabel, renderDist, renderStats, addVisit, convert, remove, openPopup, selectMarker, setDetails, setWindowMode, goTo,
 * } -> { buildContent(id, startEditing, host) -> root element }, with host = { close(), closeSelf(), update() }:
 * close() and update() act on the window that is open now, closeSelf() on the window this content was built for.
 */
export function createMarkerContent(d) {
  const { store, cin, elev, toast, checkPoint, zoneSummary, weatherButton, showWeather, tripOf, iconOf, sigOf, eyeLabel, renderDist, renderStats, addVisit, convert, remove, openPopup, selectMarker, setDetails, setWindowMode, goTo } = d;

  function buildContent(id, startEditing, host) {
    const root = el('div', 'pop poi-pop');
    let editing = false; // the edit form is up: a swipe does not close the window then
    // swipe left or right anywhere, or up or down from the top bar (with the close and collapse buttons) or the previous / next footer
    onPopupSwipe(root, { close: () => host.closeSelf(), enabled: () => !editing, vertical: host.verticalSwipe !== false, borders: (t) => !!t.closest('.pop-bar, .pop-seq, .pop-toggle, .pop-close') });

    function view() {
      editing = false;
      const it = store.get(id);
      if (!it) return;
      root.replaceChildren();

      // header: pin, type and name; coordinates underneath
      const toggle = el('button', 'pop-toggle'); toggle.type = 'button';
      // both arrows are always there and CSS shows one: replacing the clicked element mid-click would make Leaflet close the window
      toggle.innerHTML = '<svg class="ic-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg><svg class="ic-down" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
      const paintToggle = () => {
        if (!d.detailsOn()) { // details off: the button tucks the window away into the name tag's ⓘ
          toggle.setAttribute('aria-label', 'Hide the window (back to the name tag)'); toggle.title = 'Hide into the ⓘ'; toggle.setAttribute('aria-expanded', 'true');
          return;
        }
        toggle.setAttribute('aria-label', d.expanded() ? 'Collapse window' : 'Expand window'); toggle.title = d.expanded() ? 'Collapse' : 'Expand'; toggle.setAttribute('aria-expanded', String(d.expanded()));
      };
      paintToggle();
      toggle.addEventListener('detailschange', paintToggle); // the setting changed while this window is open
      toggle.addEventListener('click', () => { if (!d.detailsOn()) { selectMarker(id); return; } setWindowMode(!d.expanded()); paintToggle(); });
      // expanded: Leaflet's close button sits on the popup container, which the expanded layout moves away from this window, so the window has its own
      const close = el('button', 'pop-close'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.title = 'Close';
      close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      close.addEventListener('click', () => host.close());
      root.append(toggle, close);
      const trip0 = tripLabel(it, store.getTrip(it.tripId));
      const phone = window.matchMedia('(max-width: 520px)').matches;
      // the eye: the same setting as the map button and the switch in the Points of Interest tab
      // one list of actions (marker-actions.js); the popup and the host only lay it out differently
      const acts = markerActions(it, {
        eyeOn: d.detailsOn(), eyeLabel: eyeLabel(),
        // the eye: the same setting as the map button and the switch in the Points of Interest tab
        toggleEye: () => { const turningOff = d.detailsOn(); setDetails(!d.detailsOn()); if (turningOff) selectMarker(id); },
        edit: () => setTimeout(editForm, 0),
        // swap the contents after the click has finished: removing the clicked button mid-click would make Leaflet close the window
        visit: () => setTimeout(() => addVisit(id), 0),
        side: () => setTimeout(() => { if (convert(id, !isSub(it))) openPopup(id); }, 0),
        remove: () => remove(id),
      });
      const caption = [typeOf(it.type).label, isSub(it) && 'Side Quest', trip0].filter(Boolean).join(' · ');
      const panel = host.actions === 'panel'; // the adaptive host: Navigate and the actions go under the heading, not in the bar and the coordinate row
      root.append(toolBar(panel ? { caption } : { caption, ...popupLayout(acts, phone) }));
      const head = el('div', 'pop-head');
      const badge = el('span', 'pop-badge');
      badge.innerHTML = pinSvg(it.type); // built from constants only
      badge.firstChild.setAttribute('width', '26'); badge.firstChild.setAttribute('height', '35');
      const titles = el('div', 'pop-titles');
      titles.append(el('h3', '', it.name));
      const tripRec = it.tripId ? store.getTrip(it.tripId) : null;
      if (tripRec) {
        const line = el('div', 'pop-trip');
        const dot = el('i', 'trip-dot-sm'); dot.style.background = tripRec.color;
        line.append(dot, tripRec.name);
        titles.append(line);
      }
      if (it.date) titles.append(el('div', 'pop-dates', dateLabel(it)));
      const coordRow = el('div', 'coords-row');
      const navigate = mapLinkIcons({ lat: it.lat, lon: it.lon, name: it.name, home: it.type === 'residence' });
      coordRow.append(el('span', 'coords', `${fmt(it.lat)}, ${fmt(it.lon)}`));
      if (!panel) coordRow.append(navigate);
      titles.append(coordRow);
      { const stamp = checkinStamp({ cin, store, id }); if (stamp) titles.append(stamp); }
      head.append(badge, titles);
      root.append(head);
      if (panel) root.append(panelActions({ navigate, layout: panelLayout(acts) }));
      const visits = d.visitMap().get(id);
      if (visits) {
        // the same place saved for other dates: each visit is a button that switches the window to it
        const strip = el('div', 'pop-visits');
        strip.append(el('span', 'pop-visits-label', `${visits.length} visits here`));
        for (const v of visits) {
          const chip = el('button', 'chip visit-chip', visitLabel(v, { trip: store.getTrip(v.tripId), tripName: v.tripId && v.tripId !== it.tripId ? store.getTrip(v.tripId)?.name ?? '' : '' }));
          chip.type = 'button';
          if (v.id === id) chip.setAttribute('aria-current', 'true');
          else chip.addEventListener('click', () => goTo(v.id));
          strip.append(chip);
        }
        root.append(strip);
      }
      if (tripRec && outsideTrip(it, tripRec)) {
        const w = el('div', 'trip-warn');
        w.append(el('strong', '', 'Outside the trip\'s dates'), el('small', '', `This marker is dated ${dateLabel(it)}, but the trip runs ${tripDatesLabel(tripRec)}. Change one of them if that is a mistake.`));
        root.append(w);
      }

      // a location that came from an AI or a name lookup is a guess until someone has looked at it
      if (it.unverified) {
        const u = el('div', 'unverified');
        u.append(el('strong', '', 'Unverified location'), el('small', '', 'It came from an AI or a name lookup. Check it on the map, then mark it as checked.'));
        const ok = el('button', 'btn small', 'Mark as checked'); ok.type = 'button';
        ok.addEventListener('click', () => setTimeout(() => {
          store.update(id, { unverified: false });
          view();
          host.update();
        }, 0)); // deferred like Edit: the button is removed by the redraw
        u.append(ok);
        root.append(u);
      }

      // the verdict, most prominent
      const zone = el('div', 'zone');
      zone.append(el('div', 'status skeleton', 'Checking zone…'));
      root.append(zone);
      checkPoint(it.lat, it.lon)
        .then((res) => { zone.replaceChildren(statusEl(zoneSummary(res)), zoneExplanation(res)); host.update(); })
        .catch(() => { zone.replaceChildren(el('div', 'status unk', 'Zone check unavailable right now.')); });

      // the numbers (elevation and the 5-hour weather, when enabled), then how far this is from the nearest home point and hotel
      const dist = el('div', 'dist-wrap');
      const stats = el('div', 'stats-wrap');
      const line = { id, render: () => { renderDist(dist, id); renderStats(stats, id); } };
      d.setWxLine(line);
      line.render();
      root.append(stats, weatherButton(() => { d.closeWindow(); showWeather(it.lat, it.lon, it.name); }), dist); // conditions first, distances after
      elev.ensure(id); // no-op unless ground elevation is on

      if (it.note) root.append(el('p', 'note', it.note));
      { // Side Quests: this main stop's own, or the main stop a Side Quest hangs from
        const kids = d.sideMap().byParent.get(id) ?? [];
        const par = isSub(it) ? store.get(d.subParent().get(id)) : null;
        if (kids.length || par) {
          const box = el('div', 'pop-side');
          const jump = (target, text) => { const bt = el('button', 'pop-side-btn', text); bt.type = 'button'; bt.addEventListener('click', () => goTo(target.id)); return bt; };
          if (par) box.append(el('small', '', 'Side Quest near'), jump(par, par.name));
          else { box.append(el('small', '', `Side Quests (${kids.length})`)); for (const k of kids) box.append(jump(k, k.name)); }
          root.append(box);
        }
      }

      root.append(disclaimer());

      // previous / next stop of the trip, in itinerary order, pinned to the bottom of the window
      const seq = it.tripId ? tripSequence(store.items(), it.tripId) : [];
      const at = seq.findIndex((x) => x.id === id);
      if (at >= 0 && seq.length > 1) {
        const bar = el('div', 'pop-seq');
        const stopBtn = (target, arrow, word) => {
          const b = el('button', 'pop-seq-btn'); b.type = 'button';
          b.textContent = arrow === '‹' ? `‹ ${word}` : `${word} ›`;
          if (!target) { b.disabled = true; return b; }
          const where = [dayText(dayInfo(target, tripOf(target))), stopNo(target) !== undefined && `Stop ${stopNo(target)}`].filter(Boolean).join(' · ');
          b.title = `${word} stop: ${target.name}${where ? ` (${where})` : ''}`;
          b.setAttribute('aria-label', b.title);
          b.addEventListener('click', () => goTo(target.id));
          return b;
        };
        bar.append(stopBtn(seq[at - 1], '‹', 'Previous'), el('span', 'pop-seq-pos', `${at + 1} of ${seq.length}`), stopBtn(seq[at + 1], '›', 'Next'));
        root.append(bar);
      }
    }

    function editForm() {
      const it = store.get(id);
      if (!it) return;
      editing = true;
      d.setWxLine(null); // the form has no weather line
      root.replaceChildren();
      const form = el('form');
      const name = el('input'); name.type = 'text'; name.maxLength = 80; name.value = it.name; name.required = true;
      const type = el('select');
      for (const g of TYPE_GROUPS) {
        const og = el('optgroup'); og.label = g.label;
        for (const tid of g.types) { const o = el('option', '', typeOf(tid).label); o.value = tid; o.selected = tid === it.type; og.append(o); }
        type.append(og);
      }
      const note = el('textarea'); note.maxLength = 500; note.value = it.note; note.rows = 3;
      // The stop is optional. The day is not typed in: it follows from the date and the trip's start date.
      const order = el('input'); order.type = 'number'; order.min = '1'; order.max = '999'; order.step = '1'; order.placeholder = 'optional'; order.value = it.order ?? '';
      // Dates are optional too. The end date is for a stay of several days (a hotel), and only makes sense after a start date.
      const date = el('input'); date.type = 'date'; date.min = '2000-01-01'; date.max = '2100-12-31'; date.value = it.date ?? '';
      const endDate = el('input'); endDate.type = 'date'; endDate.max = '2100-12-31'; endDate.value = it.endDate ?? '';
      const syncEnd = () => { endDate.disabled = !date.value; endDate.min = date.value || '2000-01-01'; if (!date.value) endDate.value = ''; };
      date.addEventListener('input', syncEnd);
      syncEnd();
      const lab = (text, input) => { const l = el('label', '', text); l.append(input); return l; };
      const when = el('div', 'two'); when.append(lab('Start date', date), lab('End date', endDate));
      const trip = el('div'); trip.append(lab('Stop in the day', order));
      const dayLine = el('small', 'form-hint day-line');

      // Trip: which trip the marker belongs to. A Home marker (a residence) belongs to none, so the field goes away for that type.
      const tripPick = el('select');
      const none = el('option', '', 'No trip'); none.value = ''; tripPick.append(none);
      for (const t of sortTrips(store.trips())) { const o = el('option', '', t.name); o.value = t.id; tripPick.append(o); }
      const nw = el('option', '', 'New trip…'); nw.value = '__new'; tripPick.append(nw);
      tripPick.value = it.tripId ?? '';
      let lastTrip = tripPick.value;
      const tripLab = lab('Trip', tripPick);
      const hint = el('small', 'form-hint warn');
      const showHint = () => {
        const t = store.getTrip(tripPick.value);
        hint.textContent = t && outsideTrip({ date: date.value || undefined, endDate: endDate.value || undefined }, t)
          ? `That date is outside the trip's dates (${tripDatesLabel(t)}). You can still save it.` : '';
      };
      const syncTripField = () => { tripLab.hidden = type.value === 'residence'; };
      type.addEventListener('change', syncTripField);

      // Side Quest: an optional stop near a main stop. Not for a Home point, Hotel or Home marker. "Near" picks the main stop it hangs from (the nearest one by default).
      const subBox = el('input'); subBox.type = 'checkbox'; subBox.checked = isSub(it); subBox.id = 'edit-side';
      const subLab = el('label', 'check-row'); subLab.setAttribute('for', 'edit-side');
      subLab.append(subBox, el('span', '', 'Side Quest: an optional stop near a main stop'));
      const nearPick = el('select');
      const nearLab = lab('Near', nearPick); nearLab.classList.add('near-lab');
      const fillNear = () => {
        const keep = nearPick.value || (isSub(it) ? it.parentId ?? '' : '');
        nearPick.replaceChildren();
        const auto = el('option', '', 'The nearest main stop (automatic)'); auto.value = ''; nearPick.append(auto);
        const tid = tripPick.value || null;
        const mains = store.items().filter((m) => m.id !== id && isMain(m) && m.type !== 'residence' && (m.tripId ?? null) === tid);
        for (const m of sortForList(mains, listMode(mains))) {
          const o = el('option', '', [m.name, m.date && dateLabel(m)].filter(Boolean).join(' · ')); o.value = m.id; nearPick.append(o);
        }
        nearPick.value = [...nearPick.options].some((o) => o.value === keep) ? keep : '';
      };
      const subLost = el('small', 'hint'); subLost.textContent = "Side Quests can't be Home point, Accommodation or Home (residence): saving as this type makes it a main stop."; subLost.hidden = true;
      const syncSub = () => {
        subLost.hidden = !(isSub(it) && NOT_SUB.has(type.value));
        subLab.hidden = NOT_SUB.has(type.value);
        const on = subBox.checked && !subLab.hidden;
        nearLab.hidden = !on;
        trip.hidden = on; // a Side Quest has no stop number of its own
      };
      subBox.addEventListener('change', () => { if (!subBox.checked && isSub(it)) order.value = ''; syncSub(); });
      type.addEventListener('change', syncSub);
      tripPick.addEventListener('change', fillNear);
      fillNear();
      syncSub();
      tripPick.addEventListener('change', () => {
        if (tripPick.value === '__new') { // hand over to the Trips tab, which tags this marker once the trip is saved
          tripPick.value = lastTrip;
          setTimeout(() => { d.closeWindow(); d.newTripHandler()?.(id); }, 0);
          return;
        }
        lastTrip = tripPick.value;
        showHint();
      });
      // which day the date is, worked out from the trip (nothing to type)
      const paintDay = () => {
        const t = store.getTrip(tripPick.value), d = isoDate(date.value);
        const info = d ? dayInfo({ date: d, endDate: isoDate(endDate.value) || undefined }, t) : null;
        dayLine.textContent = tripLab.hidden || !t ? (it.day !== undefined && !d ? `Day ${it.day} (kept from before: give this marker a date and the day is worked out)` : '')
          : !t.startDate ? 'Add dates to the trip to see day numbers.'
          : !d ? 'Pick a date to see which day of the trip it is.'
          : info ? `${dayText(info)} of the trip (worked out from the date)` : 'This date is outside the trip, so it has no day.';
      };
      tripPick.addEventListener('change', paintDay);
      type.addEventListener('change', paintDay);
      date.addEventListener('input', () => { showHint(); paintDay(); });
      endDate.addEventListener('input', () => { showHint(); paintDay(); });
      syncTripField();
      showHint();
      paintDay();

      const acts = el('div', 'acts');
      const save = el('button', 'btn small primary', 'Save'); save.type = 'submit';
      const cancel = el('button', 'btn small', 'Cancel'); cancel.type = 'button';
      cancel.addEventListener('click', () => setTimeout(view, 0)); // deferred for the same reason as Edit
      acts.append(save, cancel);
      form.append(lab('Name', name), lab('Type', type), subLost, subLab, tripLab, nearLab, when, dayLine, trip, hint, el('small', 'form-hint', 'Trip, dates and stop are all optional. Use an end date for a stay of several days.'), lab('Note', note), acts);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const sub = subBox.checked && !NOT_SUB.has(type.value);
        const res = store.update(id, {
          name: name.value, type: type.value, note: note.value, order: sub ? (isSub(it) ? it.order : undefined) : posInt(order.value), date: isoDate(date.value), endDate: isoDate(endDate.value),
          isSub: sub, parentId: sub ? (nearPick.value || null) : null,
          tripId: type.value === 'residence' ? null : (tripPick.value || null), // a Home marker is never in a trip
        });
        if (!res.item) { toast('Could not save that change.'); return; }
        if (!res.ok) toast('Changed for now, but the browser would not store it. Export your markers to keep them.');
        const m = d.markers().get(id);
        if (m) {
          m.setIcon(iconOf(res.item)); m._sig = sigOf(res.item);
          m.options.title = res.item.name;
          m.getElement()?.setAttribute('title', res.item.name);
        }
        view();
        host.update();
      });
      root.append(form);
      host.update();
      setTimeout(() => { name.focus(); name.select(); }, 0);
    }

    if (startEditing) editForm(); else view();
    return root;
  }

  return { buildContent };
}
