// Community flying areas: the ONE shared details panel for a flying area, shown in the existing adaptive marker host (src/marker-host.js, via poi-ui's external host).
// The host gives the side dock / bottom sheet, rotation-aware recentring, Escape, focus and the explorer/panel rules. This file only draws a "view" and wires selection.
//   - Presentation here is context-free: header, Navigate, actions, status, description, weather, setup spots, byline, disclaimer. Everything that differs between a
//     private draft, a pending/rejected/withdrawn submission and an approved public area comes from an adapter (adapter-private.js, adapter-public.js) as data + actions.
//   - A community area is never a Saved Place, trip or POI: it has its own key ("area:<id>") and nothing here touches the marker store.
//   - Weather reuses markerweather.js (own cache key, only the OPEN area is requested) and weather.js; with automatic weather off the existing "Show weather here" is used.
import { el, tile, statsGrid, rainBlock } from '../cards.js';
import { mapLinkIcons } from '../maplinks-ui.js';
import { createMarkerWeather, formatWhen, rainOutlook, INTERVAL_MS } from '../markerweather.js';
import { getWindLimit } from '../weather.js';
import { avatarEl } from '../avatars.js';
import { profileTrigger } from '../profile-popover.js';
import { onPopupSwipe } from '../swipe.js';
import { formatArea, SPOT_LABELS } from './core.js';
import { SPOT_ICONS, DISCLAIMER } from './layer.js';
import { privateView } from './adapter-private.js';
import { publicView } from './adapter-public.js';
import { pickArea } from './geo.js';

const WX_KEY = 'uavzones.v1.wxcache.areas'; // apart from the markers' own forecast cache
const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const f1 = (v, dp = 1) => (v === null || v === undefined ? '–' : v.toFixed(dp));
/** The forecast key of a place: the area's id plus its centre, so a change of shape (a new centre) is a new place and is fetched again. */
export const weatherId = (view) => `${view.key}@${view.centre[1].toFixed(4)},${view.centre[0].toFixed(4)}`;

/**
 * @param {object} o  map, store, layer, submit, ops (see adapter-private), draw ({isBusy}), host (poi's external host), weatherButton, showWeather
 */
export function createAreaDetails({ map, store, layer, submit, ops, isBusy = () => false, host, weatherButton, showWeather, publicAreas = null, toast = () => {} }) {
  let current = null;     // { view, render, hostApi } for the open panel
  let publicView_ = null; // the open public view (a fixture today), kept so "View flying area" can come back to it
  const wxItems = () => (current ? [{ id: weatherId(current.view), lat: current.view.centre[1], lon: current.view.centre[0] }] : []);
  const mw = createMarkerWeather({ getItems: wxItems, onChange: () => current?.renderWeather?.(), storageKey: WX_KEY });

  const viewOf = (key) => {
    if (publicView_?.key === key) return publicView_;
    const id = key.slice(5);
    return privateView({ store, submit, ops }, id);
  };

  // ---- presentation ----
  function build(key, _edit, hostApi) {
    const root = el('div', 'pop poi-pop area-pop');
    let confirming = null;
    const weatherBox = el('div', 'area-wx');
    onPopupSwipe(root, { close: () => hostApi.closeSelf(), enabled: () => !confirming, vertical: false, borders: () => false });

    function renderWeather() {
      const view = current?.view;
      weatherBox.replaceChildren();
      if (!view) return;
      const [lng, lat] = view.centre;
      if (!mw.enabled()) { weatherBox.append(weatherButton(() => { hostApi.close(); showWeather(lat, lng, view.area.name); })); return; }
      const s = mw.get(weatherId(view)), e = s.entry;
      const tiles = [], notes = [];
      if (!e) {
        const v = s.loading ? '…' : '–';
        tiles.push(tile('temp', 'Avg temp', v), tile('wind', 'Avg wind', v), tile('gust', 'Peak gust', v));
        if (!s.loading) notes.push('Weather unavailable right now.');
      } else {
        const limit = getWindLimit(), over = limit !== null && e.gust !== null && e.gust > limit;
        tiles.push(tile('temp', 'Avg temp', `${f1(e.temp)} °C`), tile('wind', 'Avg wind', `${f1(e.wind)} m/s`), tile('gust', 'Peak gust', `${f1(e.gust)} m/s`, over ? 'over' : ''));
        if (e.temp !== null && e.temp <= 5) notes.push('Cold: batteries lose capacity and flight time');
        notes.push(`${s.outdated ? 'Outdated. ' : ''}Next ${e.n} h · updated ${formatWhen(e.t)}${s.failed ? ' (latest refresh failed)' : ''} · forecast for the centre of the area, ${e.start} local time there`);
      }
      weatherBox.append(statsGrid(tiles));
      const outlook = rainOutlook(e); if (outlook) weatherBox.append(rainBlock(outlook));
      for (const n of notes.filter(Boolean)) weatherBox.append(el('small', 'stats-note', n));
      if (!e && !s.loading) { const r = el('button', 'btn', 'Try again'); r.type = 'button'; r.dataset.act = 'weather-retry'; r.addEventListener('click', () => mw.refresh([weatherId(view)])); weatherBox.append(r); }
      if (!s.loading && (!e || Date.now() - e.t > INTERVAL_MS) && !loadedOnce.has(weatherId(view))) { loadedOnce.add(weatherId(view)); mw.refresh([weatherId(view)]); }
    }
    const loadedOnce = new Set();

    function render() {
      const view = viewOf(key);
      if (!view) { hostApi.close(); return; }
      current = { view, render, renderWeather, hostApi };
      const focus = document.activeElement?.closest?.('.area-pop') ? document.activeElement?.dataset?.act : null;
      const a = view.area, [lng, lat] = view.centre;
      root.replaceChildren();
      const close = el('button', 'pop-close'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.title = 'Close';
      close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      close.addEventListener('click', () => hostApi.close());
      root.append(close);
      // header: caption, name, status chip, size, dates
      const head = el('div', 'pop-head area-head'), titles = el('div', 'pop-titles');
      titles.append(el('div', 'area-caption', view.caption), el('h3', '', a.name));
      const chip = el('span', `area-chip ctx-${view.context}`, view.badge); chip.dataset.context = view.context;
      const meta = [`About ${formatArea(a.areaM2 ?? 0)}`, view.dates.modified ? `${view.dates.modifiedLabel ?? 'Last edited'} ${fmtDate(view.dates.modified)}` : null, view.dates.observed ? `Last observed ${fmtDate(view.dates.observed)}` : null].filter(Boolean);
      titles.append(el('div', 'area-badges', ''), el('div', 'area-meta', meta.join(' · ')));
      titles.querySelector('.area-badges').append(chip);
      head.append(titles); root.append(head);
      // Navigate (the app-wide control: map app and coordinate conversion from the Maps settings) and the adapter's actions
      const row = el('div', 'pop-actions area-actions');
      const nav = el('div', 'pop-primary'); nav.append(mapLinkIcons({ lat, lon: lng, name: a.name })); row.append(nav);
      if (view.actions.length) row.append(actionsEl(view.actions));
      root.append(row);
      if (view.status) { const st = el('p', 'area-status', view.status); st.dataset.status = view.context; root.append(st); }
      if (a.description) { root.append(el('h4', 'area-h', 'Description')); root.append(el('p', 'area-desc', a.description)); }
      root.append(el('h4', 'area-h', 'Weather forecast'), weatherBox); renderWeather();
      root.append(el('h4', 'area-h', `Pilot setup spots (${a.spots.length})`), spotsEl(view));
      root.append(bylineEl(view.byline), el('p', 'area-disclaimer', DISCLAIMER));
      hostApi.update?.();
      if (focus) root.querySelector(`[data-act="${focus}"]`)?.focus({ preventScroll: true });
    }

    function actionsEl(list) {
      const box = el('div', 'pop-secondary area-secondary');
      if (confirming) {
        const a = list.find((x) => x.act === confirming);
        if (a) {
          box.append(el('span', 'area-confirm', a.confirm));
          const go = el('button', `btn${a.danger ? ' danger' : ' primary'}`, a.label); go.type = 'button'; go.dataset.act = `confirm-${a.act}`;
          go.addEventListener('click', () => { confirming = null; a.run(); });
          const no = el('button', 'btn', 'Cancel'); no.type = 'button'; no.dataset.act = 'cancel';
          no.addEventListener('click', () => { confirming = null; render(); root.querySelector(`[data-act="${a.act}"]`)?.focus({ preventScroll: true }); });
          box.append(go, no);
          return box;
        }
        confirming = null;
      }
      for (const a of list) {
        const b = el('button', `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`, a.label); b.type = 'button'; b.dataset.act = a.act;
        b.addEventListener('click', () => { if (a.confirm) { confirming = a.act; render(); root.querySelector('[data-act^="confirm-"]')?.focus({ preventScroll: true }); } else a.run(); });
        box.append(b);
      }
      return box;
    }

    function spotsEl(view) {
      const list = el('ul', 'area-spots-list'); list.setAttribute('aria-label', 'Pilot setup spots');
      if (!view.area.spots.length) { list.append(el('li', 'area-empty', 'No setup spots marked.')); return list; }
      for (const s of view.area.spots) {
        const li = el('li', ''), b = el('button', 'area-spot-item'); b.type = 'button'; b.dataset.spot = s.id;
        b.setAttribute('aria-label', `Show ${SPOT_LABELS[s.type] ?? SPOT_LABELS.other} on the map`);
        const ic = el('span', `area-spot-ic area-spot-${s.type in SPOT_ICONS ? s.type : 'other'}`); ic.innerHTML = SPOT_ICONS[s.type] ?? SPOT_ICONS.other; // constant markup
        const tx = el('span', 'area-spot-tx'); tx.append(el('strong', '', SPOT_LABELS[s.type] ?? SPOT_LABELS.other)); if (s.note) tx.append(el('small', '', s.note));
        b.append(ic, tx);
        b.addEventListener('click', () => layer.showSpot(view.area.id, s.id));
        li.append(b); list.append(li);
      }
      return list;
    }

    function bylineEl(by) {
      const p = el('p', 'area-byline'); p.dataset.byline = by.profileRow ? 'named' : 'text';
      if (by.profileRow) {
        const who = el('span', 'area-who'); who.append(avatarEl(by.profileRow.avatar, by.profileRow.display_name, 24), el('span', '', by.profileRow.display_name));
        p.append('Shared by ', profileTrigger(who, by.profileRow, 'Chose to be shown on approved community flying areas.'));
      } else p.textContent = by.text;
      return p;
    }

    render();
    return root;
  }

  // ---- the provider poi-ui's marker host asks (owns / build / latlngOf / onOpen / onClose / returnFocusTo) ----
  const provider = {
    owns: (key) => typeof key === 'string' && key.startsWith('area:'),
    build,
    latlngOf: (key) => { const v = current?.view?.key === key ? current.view : viewOf(key); return v ? { lat: v.centre[1], lng: v.centre[0] } : null; },
    onOpen(key) {
      const v = viewOf(key); if (!v) return;
      if (publicView_?.key === key) { layer.setExtra(publicView_.area); publicAreas?.skip(publicView_.area.id.slice(4)); } else { layer.setExtra(null); publicAreas?.skip(null); }
      layer.select(v.area.id);
      mw.prune([weatherId(v), ...store.list().map((a) => weatherId(privateView({ store, submit, ops }, a.id)))]); // forget forecasts of deleted or reshaped areas
    },
    onClose() { layer.select(null); layer.setExtra(null); publicAreas?.skip(null); current = null; publicView_ = null; },
    returnFocusTo: () => document.querySelector('#areas-panel:not([hidden]) .area-item .btn') ?? null,
  };
  host.register(provider);

  /** Opens the details of a local area. */
  function open(id) {
    if (!store.get(id)) return false;
    publicView_ = null;
    host.open(`area:${id}`);
    return true;
  }
  /** Opens a public area from an already fetched record. Only an approved, published, valid record is accepted (adapter-public.js). Today: tests with fixtures. */
  function openPublic(record) {
    const v = publicView(record);
    if (!v) return false;
    publicView_ = v; host.open(v.key);
    return true;
  }
  /** Opens a public area from the public layer's view, at once from what was fetched for the viewport, then re-reads it from the server: a contributor's attribution change or an unpublication since the viewport was fetched shows up now. */
  function openPublicArea(pv) {
    if (!pv || !openPublic(pv.record)) return false;
    const id = pv.areaId, key = `area:pub-${id}`;
    publicAreas?.api.get(id).then((rec) => {
      if (host.id() !== key) return;
      if (!rec || !publicView(rec)) { publicAreas.forget(id); host.close(); toast('This community flying area is no longer published.'); return; }
      publicView_ = publicView(rec); layer.setExtra(publicView_.area); current?.render();
    }).catch(() => { /* offline: the details already shown stay */ });
    return true;
  }
  layer.setOnView((areaId) => { if (!open(areaId) && publicView_?.area.id === areaId) host.open(publicView_.key); });

  // keep the open panel current: an edit, a status change, a deletion
  const refresh = () => { if (current && current.view.key.startsWith('area:') && host.id() === current.view.key) current.render(); };
  store.onChange(refresh); submit.onChange(refresh);

  /** A tap on the map: opens the area under it. -> true when it did (the caller then leaves the tap alone). Never while drawing/editing; never for a tap on a control, popup or handle. */
  function handleMapClick(e) {
    if (isBusy()) return false;
    if (e.originalEvent?.target?.closest?.('.area-vtx, .area-spot, .leaflet-popup, .leaflet-control, .marker-host')) return false;
    const a = layer.areaAt(e.latlng.wrap());
    if (a) { if (host.id() !== `area:${a.id}`) open(a.id); return true; }
    if (publicView_ && host.id() === publicView_.key && pickArea([publicView_.area], e.latlng.lng, e.latlng.lat)) return true; // a tap inside the public area that is already open keeps it open
    const p = publicAreas?.areaAt(e.latlng.wrap()); // an approved public area (never a private draft), shown in the same panel
    if (!p) return false;
    if (host.id() !== `area:pub-${p.areaId}`) openPublicArea(p);
    return true;
  }
  return { open, openPublic, openPublicArea, close: () => host.close(), handleMapClick, isOpen: () => host.id()?.startsWith?.('area:') ?? false, id: () => host.id() };
}
