// The privacy-settings sub-panel: three switches that decide what may be sent to Open-Meteo. See privacy.js.
import { getPrivacy, setPrivacy } from './privacy.js';
import { diagnostics } from './log.js';

const $ = (id) => document.getElementById(id);

export function initPrivacyUI({ mw, elev, toast = () => {} }) {
  const auto = $('pv-auto'), alt = $('pv-alt'), geo = $('pv-geo'), chk = $('pv-checkin'), lau = $('pv-locate');
  const radios = [...document.querySelectorAll('input[name=pv-prec]')];

  const sync = () => {
    const p = getPrivacy();
    auto.checked = p.autoWeather;
    alt.checked = p.fetchAltitude;
    geo.checked = p.lookupNames;
    chk.checked = p.checkIn;
    lau.checked = p.locateOnLaunch;
    for (const r of radios) r.checked = r.value === p.weatherPrecision;
  };
  sync();

  // Turning weather or altitude on starts the fetch; turning either off also forgets what was fetched.
  auto.addEventListener('change', () => mw.setEnabled(auto.checked));
  alt.addEventListener('change', () => elev.setEnabled(alt.checked));
  geo.addEventListener('change', () => setPrivacy({ lookupNames: geo.checked }));
  chk.addEventListener('change', () => setPrivacy({ checkIn: chk.checked }));
  lau.addEventListener('change', () => setPrivacy({ locateOnLaunch: lau.checked }));
  for (const r of radios) r.addEventListener('change', () => { if (r.checked) setPrivacy({ weatherPrecision: r.value }); });

  initDiagnostics(toast);
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
