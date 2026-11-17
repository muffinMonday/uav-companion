// The privacy-settings sub-panel: three switches that decide what may be sent to Open-Meteo. See privacy.js.
import { getPrivacy, setPrivacy } from './privacy.js';
import { diagnostics } from './log.js';
import { approxSize as aircraftDiagSize, deleteAll as deleteAircraftDiag } from './aircraft-diag-data.js';

const $ = (id) => document.getElementById(id);

export function initPrivacyUI({ mw, elev, toast = () => {} }) {
  const auto = $('pv-auto'), alt = $('pv-alt'), geo = $('pv-geo'), chk = $('pv-checkin'), lau = $('pv-locate'), ash = $('pv-autoshare'), asf = $('pv-autoshare-friends');
  const radios = [...document.querySelectorAll('input[name=pv-prec]')];

  const sync = () => {
    const p = getPrivacy();
    auto.checked = p.autoWeather;
    alt.checked = p.fetchAltitude;
    geo.checked = p.lookupNames;
    chk.checked = p.checkIn;
    lau.checked = p.locateOnLaunch;
    if (ash) { ash.checked = p.autoShare === 'on'; asf.checked = p.shareFriends; asf.disabled = p.autoShare !== 'on'; }
    for (const r of radios) r.checked = r.value === p.weatherPrecision;
  };
  sync();

  // Turning weather or altitude on starts the fetch; turning either off also forgets what was fetched.
  auto.addEventListener('change', () => mw.setEnabled(auto.checked));
  alt.addEventListener('change', () => elev.setEnabled(alt.checked));
  geo.addEventListener('change', () => setPrivacy({ lookupNames: geo.checked }));
  chk.addEventListener('change', () => setPrivacy({ checkIn: chk.checked }));
  lau.addEventListener('change', () => setPrivacy({ locateOnLaunch: lau.checked }));
  // Automatic sharing: turning it on here is the person's yes (autoshare.js starts and stops sharing by itself from then on; it also reads this setting each pass)
  if (ash) {
    ash.addEventListener('change', () => { setPrivacy({ autoShare: ash.checked ? 'on' : 'off' }); sync(); });
    asf.addEventListener('change', () => setPrivacy({ shareFriends: asf.checked }));
  }
  for (const r of radios) r.addEventListener('change', () => { if (r.checked) setPrivacy({ weatherPrecision: r.value }); });

  const attendance = initSessionAttendance(toast);
  initDiagnostics(toast);
  initAircraftDiagnostics(toast);
  return attendance;
}

/** The automatic-attendance card: the switch is the person's yes (the server records the consent first); it is disabled when signed out or when the database switch is off. Returns { bindArrival(controller) }. */
function initSessionAttendance(toast) {
  const sw = $('pv-sessatt'), note = $('pv-sessatt-note');
  if (!sw || !note) return { bindArrival() {} };
  let a = null;
  const paint = () => {
    const cfg = a?.config();
    if (!cfg) { sw.checked = false; sw.disabled = true; note.textContent = 'Sign in to use automatic attendance.'; return; }
    sw.disabled = !cfg.enabled;
    sw.checked = cfg.enabled && cfg.consented && getPrivacy().autoSessionAttendance;
    note.textContent = !cfg.enabled ? 'Automatic attendance is not switched on yet. An organiser can still confirm you by hand.' : sw.checked ? (a.state().text || 'On. Keep this page open at the meeting point.') : 'Off.';
  };
  sw.addEventListener('change', async () => {
    if (!a) { sw.checked = false; return; }
    sw.disabled = true;
    try { await (sw.checked ? a.enable() : a.disable()); } catch (e) { sw.checked = !sw.checked; toast(e.message || 'That did not work.'); }
    paint();
  });
  paint();
  return { bindArrival(c) { a = c; c.onState(paint); paint(); } };
}

const fmtSize = (b) => (b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB');

/** The Diagnostics card: how much is in the local log (log.js), a JSON download, and clearing. All local; nothing is sent. */
function initDiagnostics(toast) {
  const stats = $('diag-stats'), dl = $('diag-download'), clr = $('diag-clear');
  if (!stats || !dl || !clr) return;
  async function refresh() {
    try {
      const s = await diagnostics.stats();
      stats.textContent = s.entries
        ? s.entries + (s.entries === 1 ? ' entry, ' : ' entries, ') + fmtSize(s.bytes) + '.' + (s.persistent ? '' : ' Kept in memory only: this browser blocks storage for the log.')
        : 'Nothing has been logged.';
      dl.disabled = clr.disabled = !s.entries;
    } catch { stats.textContent = 'The log is not available.'; dl.disabled = clr.disabled = true; }
  }
  dl.addEventListener('click', async () => {
    try {
      const blob = new Blob([await diagnostics.exportJson()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'uav-companion-diagnostics-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch { toast('Could not create the diagnostics file.'); }
  });
  clr.addEventListener('click', async () => { await diagnostics.clear(); await refresh(); toast('Diagnostics cleared.'); });
  $('privacy-btn')?.addEventListener('click', refresh); // each time the panel is opened
  refresh();
}

/** Aircraft diagnostic data (motor-diagnostic records kept by aircraft-diag-data.js): its own card, shown only while something is stored.
 *  Separate from the Diagnostics log above, never part of a trip export, sharing or sync; Delete removes the records and any kept live samples. */
function initAircraftDiagnostics(toast) {
  const anchor = $('diag-card');
  if (!anchor) return;
  const card = document.createElement('div'); card.className = 'card'; card.id = 'aircraft-diag-card'; card.hidden = true;
  const h = document.createElement('h2'); h.textContent = 'Aircraft diagnostic data';
  const hint = document.createElement('p'); hint.className = 'hint';
  hint.textContent = 'Results of motor checks you chose to save are kept in this browser only: derived measurements and, only if you chose it, the live samples behind them. They are separate from the Diagnostics log, are not part of a trip export, sharing or sync, and are never sent anywhere.';
  const stat = document.createElement('p'); stat.className = 'hint'; stat.id = 'aircraft-diag-stats'; stat.setAttribute('aria-live', 'polite');
  const row = document.createElement('div'); row.className = 'btn-row';
  const del = document.createElement('button'); del.type = 'button'; del.className = 'btn small'; del.id = 'aircraft-diag-delete'; del.textContent = 'Delete aircraft diagnostic data';
  row.append(del); card.append(h, hint, stat, row); anchor.after(card);
  function refresh() {
    const s = aircraftDiagSize();
    card.hidden = !(s.available && s.totalBytes > 0);
    stat.textContent = s.totalBytes > 0 ? s.records + (s.records === 1 ? ' saved result, about ' : ' saved results, about ') + fmtSize(s.totalBytes) + (s.sampleBytes ? ' (' + fmtSize(s.sampleBytes) + ' of live samples).' : ', no live samples kept.') : '';
  }
  del.addEventListener('click', () => { const ok = deleteAircraftDiag(); refresh(); toast(ok ? 'Aircraft diagnostic data deleted.' : 'Could not delete the aircraft diagnostic data.'); });
  $('privacy-btn')?.addEventListener('click', refresh);
  refresh();
}
