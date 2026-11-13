// What the visitor allows to be sent to third parties beyond the basemap. Defaults are the most private choice; every
// change is remembered in this browser (prefs.js) and also held in memory, so it applies at once even if storage is blocked.
//
//   autoWeather       fetch weather for saved markers automatically            (default off)
//   weatherPrecision  'estimated' = coordinates rounded to ~1 km, 'precise' = ~10 m   (default estimated)
//   fetchAltitude     look up ground elevation for markers and checked points  (default off)
//                     Elevation always uses precise coordinates: at ~1 km the terrain can differ by hundreds of metres.
//   checkIn           read the position while the panel shows markers, to enable "Check in" within 300 m of one (never sent anywhere) (default off)
//   locateOnLaunch    ask for the position when the app opens and centre the map on it when the browser allows it (default ON; the position stays in this browser)
//   autoShare         'unset' | 'on' | 'off': automatic location sharing with the party and friends (autoshare.js). unset = not asked yet; it is asked once, the first time
//                     someone in a party or a friend is online, and only 'on' lets the app start sharing by itself. Never synced: the browser's own location
//                     permission is per browser too.
//   shareFriends      automatic sharing includes friends                                        (default on, once autoShare is on)
//   shareOff          trips (and 'friends') the person stopped by hand: they are not started automatically again until the person starts them
//   lookupNames       when importing an AI-made itinerary, look up places that came without coordinates by sending
//                     their names or addresses to a geocoder (Photon, then Nominatim)            (default off)
import { loadPrefs, savePrefs } from './prefs.js';
import { log } from './log.js';

const saved = loadPrefs();
let state = {
  autoWeather: !!saved.autoWeather,
  weatherPrecision: saved.weatherPrecision === 'precise' ? 'precise' : 'estimated',
  fetchAltitude: !!saved.fetchAltitude,
  lookupNames: !!saved.lookupNames,
  checkIn: !!saved.checkIn,
  locateOnLaunch: saved.locateOnLaunch !== false,
  autoShare: saved.autoShare ?? 'unset',
  shareFriends: saved.shareFriends !== false,
  shareOff: saved.shareOff ?? [],
};
const listeners = new Set();

export const getPrivacy = () => state;
export const onPrivacyChange = (fn) => { listeners.add(fn); };

export function setPrivacy(patch) {
  state = { ...state, ...patch };
  savePrefs({
    autoWeather: state.autoWeather || null,
    weatherPrecision: state.weatherPrecision === 'precise' ? 'precise' : null, // null = back to the default
    fetchAltitude: state.fetchAltitude || null,
    lookupNames: state.lookupNames || null,
    checkIn: state.checkIn || null,
    locateOnLaunch: state.locateOnLaunch ? null : false, // null = back to the default (on)
    autoShare: state.autoShare === 'unset' ? null : state.autoShare,
    shareFriends: state.shareFriends ? null : false,
    shareOff: state.shareOff.length ? state.shareOff : null,
  });
  listeners.forEach((fn) => { try { fn(state); } catch (e) { log.error('privacy', 'a listener failed', e); } }); // one failing listener must not stop the others
}
