// The privacy-settings sub-panel: three switches that decide what may be sent to Open-Meteo. See privacy.js.
import { getPrivacy, setPrivacy } from './privacy.js';

const $ = (id) => document.getElementById(id);

export function initPrivacyUI({ mw, elev }) {
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
}
