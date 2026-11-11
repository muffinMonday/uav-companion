// The Trips tab: create, edit and delete trips, see what is in each, and jump to its markers.
// A trip groups markers; distances from a waypoint to a hotel or home point stay inside its trip. Data is in poi.js.
import { COUNTRIES, countryCode, countryName } from './countries.js';
import { sortTrips, tripSummary, tripLength } from './trips.js';
import { el } from './cards.js';

const $ = (id) => document.getElementById(id);

export function initTripsUI({ poi, panel, toast }) {
  const store = poi.store;
  const list = $('trips-list'), empty = $('trips-empty'), count = $('trips-count');
  const card = $('trip-form-card'), form = $('trip-form'), title = $('trip-form-title');
  const fName = $('trip-name'), fCountry = $('trip-country'), fStart = $('trip-start'), fEnd = $('trip-end'), fDesc = $('trip-desc');
  const lengthEl = $('trip-length'), errorEl = $('trip-error');
  let editingId = null;   // the trip being edited, or null for a new one
  let assignId = null;    // a marker to put in the new trip once it is saved ("New trip…" in a marker's form)

  // the country list the field suggests from
  for (const [, name] of COUNTRIES) { const o = document.createElement('option'); o.value = name; $('country-list').append(o); }

  // ---------- the list ----------
  function render() {
    const trips = sortTrips(store.trips());
    const items = store.items();
    count.textContent = trips.length ? `(${trips.length})` : '';
    empty.hidden = trips.length > 0;
    list.replaceChildren();
    for (const t of trips) {
      const n = items.filter((i) => i.tripId === t.id).length;
      const isCurrent = poi.getCurrentTrip() === t.id;
      const li = el('li', 'trip-card');
      const head = el('div', 'trip-card-head');
      const dot = el('i', 'trip-dot-sm'); dot.style.background = t.color;
      const name = el('b', '', t.name);
      if (isCurrent) name.append(' ', el('span', 'badge ok', 'For new markers'));
      head.append(dot, name);
      li.append(head);
      const summary = tripSummary(t);
      if (summary) li.append(el('div', 'trip-card-sub', summary));
      if (!t.startDate || !t.endDate) li.append(el('div', 'trip-card-warn', 'No dates yet. Add them (Edit) to see day numbers and the countdown.'));
      if (t.description) li.append(el('p', 'trip-card-desc', t.description));
      li.append(el('div', 'trip-card-count', `${n} marker${n === 1 ? '' : 's'}`));

      const acts = el('div', 'btn-row trip-acts');
      const btn = (text, fn, cls = '') => { const b = el('button', `btn small ${cls}`.trim(), text); b.type = 'button'; b.addEventListener('click', fn); acts.append(b); return b; };
      btn('Show markers', () => poi.showTrip(t.id));
      btn('Fit map', () => { if (poi.fitTrip(t.id)) panel.closeIfPhone(); });
      if (!isCurrent) btn('Use for new markers', () => { poi.setCurrentTrip(t.id); render(); toast(`New markers will go into “${t.name}”.`, 4000); });
      btn('Edit', () => openForm(t));
      let armed = null;
      const del = btn('Delete', () => {
        if (!armed) {
          del.textContent = n ? `Confirm: ${n} marker${n === 1 ? '' : 's'} stay without a trip` : 'Confirm delete';
          armed = setTimeout(() => { del.textContent = 'Delete'; armed = null; }, 5000);
          return;
        }
        clearTimeout(armed);
        const res = store.removeTrip(t.id);
        toast(`Deleted “${t.name}”.${res.untagged ? ` Its ${res.untagged} marker${res.untagged === 1 ? ' is' : 's are'} kept, with no trip.` : ''}`, 6000);
      }, 'danger');
      li.append(acts);
      list.append(li);
    }
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
  render();
  return { openForm };
}
