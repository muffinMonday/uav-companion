import L from 'leaflet';
import { currentTheme, onTheme } from './theme.js';
import { leafletLayer, PolygonSymbolizer } from 'protomaps-leaflet';
import { regionUrl, MAX_VIEW_BOUNDS } from './config.js';
import { zonePaintSpec, approxOutline, hatchTile } from './zone-style.js';
import { retainArchive, releaseArchive } from './pmtiles-source.js';
import { initMapAttribution } from './map-attribution.js';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Vite does not resolve Leaflet's default icon paths on its own: drop its path detection and use the bundled URLs.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

// Only OpenStreetMap-based layers: the standard map, two community styles hosted by OpenStreetMap France, and OpenTopoMap.
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const BASES = {
  hot: ['https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    { maxZoom: 19, subdomains: 'abc', attribution: OSM_CREDIT + ', style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>, hosted by <a href="https://openstreetmap.fr/">OpenStreetMap France</a>' }],
  cyclosm: ['https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    { maxZoom: 19, subdomains: 'abc', attribution: OSM_CREDIT + ', style by <a href="https://www.cyclosm.org/">CyclOSM</a>, hosted by <a href="https://openstreetmap.fr/">OpenStreetMap France</a>' }],
  topo: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom: 17, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)' }],
  osm: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: OSM_CREDIT }],
};

// Go Tiles permits keyless website use up to 15,000 tiles/site/month. No billing is enabled.
// CARTO basemaps (dark_all raster tiles). The API key is a PUBLIC browser key restricted to the site's domain by CARTO (it is rejected from any other origin, including localhost), supplied at build time as
// VITE_CARTO_API_KEY (see scripts/deploy-live.js). Without a key, or when the tiles fail (quota, outage, a refused origin) dark mode falls back to the standard tiles inverted by CSS. Terms: https://carto.com/legal ; attribution: https://carto.com/attributions
const CARTO_KEY = (import.meta.env?.VITE_CARTO_API_KEY ?? '').trim();
const DARK_OSM = CARTO_KEY ? [`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, {
  maxZoom: 19, maxNativeZoom: 19,
  attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> | ' + OSM_CREDIT,
}] : null;

/** The tile set for a selected basemap and resolved theme. Other selections retain their original cartography. */
export function baseTiles(key, theme = 'light') {
  const selected = Object.hasOwn(BASES, key) ? key : 'osm';
  const [url, opts] = selected === 'osm' && theme === 'dark' && DARK_OSM ? DARK_OSM : BASES[selected]; // no key: the standard tiles (dark mode then inverts them by CSS, see refreshBase)
  return [url, { ...opts, className: 'base-tiles' }];
}

// One fill colour per meaning: allow = where flying is permitted (teal), restrict = where it is restricted (red).
/** The zone fill for a region's meaning: the colours live in styles.css (--zone, --zone-restrict) so the legend and the map cannot drift apart. */
export const zoneFill = (semantics) => getComputedStyle(document.documentElement).getPropertyValue(semantics === 'allow' ? '--zone' : '--zone-restrict').trim();
const toLatLngBounds = (b) => L.latLngBounds([b[1], b[0]], [b[3], b[2]]);

/** `initial` carries the remembered settings: { view: {lat, lon, zoom}, basemap, units }. All optional. */
export function createMap(initial = {}) {
  const v = initial.view;
  const map = L.map('map', { zoomControl: true, maxZoom: 19, renderer: L.svg({ padding: 0.6 }) }) // (extra padding: vectors are drawn beyond the screen so a turned map does not clip them at the corners)
   .setView(v ? [v.lat, v.lon] : [35, 105], v ? v.zoom : 4);
  const makeScale = (units) => L.control.scale({ metric: units !== 'imperial', imperial: units === 'imperial', position: 'bottomleft', maxWidth: 140 }).addTo(map);
  let scale = makeScale(initial.units);
  initMapAttribution(map);

  // Minimum zoom = the zoom at which the largest region fills the view. Recomputed on resize, since it depends on the screen size.
  const largest = L.latLngBounds([MAX_VIEW_BOUNDS[1], MAX_VIEW_BOUNDS[0]], [MAX_VIEW_BOUNDS[3], MAX_VIEW_BOUNDS[2]]);
  const applyMinZoom = () => {
    const min = map.getBoundsZoom(largest);
    map.setMinZoom(min);
    if (map.getZoom() < min) map.setZoom(min, { animate: false });
  };
  applyMinZoom();
  map.on('resize', applyMinZoom);

  let selectedBase = initial.basemap;
  let base = null, pending = null;
  // A failure disables dark requests for this map's lifetime, including after rapid theme changes.
  // The preference remains untouched; a fresh visit can try the provider again.
  let darkFailed = !DARK_OSM; // no key = the native dark source is not available from the start
  const cancelPending = () => {
    if (!pending) return;
    const old = pending;
    pending = null;
    clearTimeout(old.timer);
    // Leaflet's remove handler releases its attribution; let it run before clearing our listeners.
    map.removeLayer(old.layer);
    old.layer.off();
  };
  const refreshBase = () => {
    const theme = currentTheme();
    const tiles = baseTiles(selectedBase, darkFailed ? 'light' : theme);
    const isDark = !!DARK_OSM && tiles[0] === DARK_OSM[0];
    const wantInverted = darkFailed && theme === 'dark' && selectedBase === 'osm';
    if (pending?.url === tiles[0]) { base?.getContainer?.()?.classList.toggle('base-tiles-inverted', wantInverted); return; }
    cancelPending();
    if (base?._url === tiles[0]) { base.getContainer?.()?.classList.toggle('base-tiles-inverted', wantInverted); return; } // same tiles, only the dark treatment changed
    const layer = L.tileLayer(tiles[0], { ...tiles[1], opacity: base ? 0 : 1 });
    // the native dark source failed (quota, outage): dark mode then shows the standard OSM tiles inverted by CSS (.base-tiles-inverted in styles.css) instead of a bright map; the class is a toggle on the container, the className option stays 'base-tiles'
    layer.on('add', () => layer.getContainer?.()?.classList.toggle('base-tiles-inverted', darkFailed && currentTheme() === 'dark' && selectedBase === 'osm'));
    const job = { layer, url: tiles[0], timer: null };
    pending = job;
    const finish = () => {
      if (pending !== job) return;
      clearTimeout(job.timer);
      layer.off('load', finish);
      layer.setOpacity(1);
      const settle = () => {
        if (pending !== job) return;
        pending = null;
        if (base) map.removeLayer(base);
        base = layer;
      };
      // Leaflet's load event precedes its 200ms tile fade. Keep backing tiles until that fade ends.
      // Keeping this job pending also lets a rapid switch cancel both the layer and its settle timer.
      if (base) job.timer = setTimeout(settle, 250);
      else settle();
    };
    const fallback = () => {
      if (pending !== job && base !== layer) return;
      darkFailed = true;
      layer.off('tileerror', fallback);
      refreshBase();
    };
    layer.on('load', finish);
    // Keep observing the active dark layer: later pans can fail too (including monthly quota exhaustion).
    if (isDark) layer.on('tileerror', fallback);
    job.timer = setTimeout(isDark ? fallback : finish, 12000);
    layer.addTo(map);
    layer.bringToBack();
    // A pending layer must be above the previous tiles, but below all airspace tile layers.
    if (base) base.bringToBack();
  };
  const switchBase = (key) => { selectedBase = key; refreshBase(); };
  refreshBase();
  const stopTheme = onTheme(refreshBase);
  map.once('unload', () => { stopTheme(); cancelPending(); });
  /** Metric or imperial scale bar, to match the distance units setting. */
  // Leaflet's scale control only builds the bar for the unit it started with, so switching means replacing the control.
  const setScaleUnits = (units) => {
    scale.remove();
    scale = makeScale(units);
  };
  return { map, switchBase, setScaleUnits };
}

/** Verified classes are a flat fill; an approximate class is stripes in its colour with an uncertainty outline (zone-style.js). */
const classSymbolizer = (c) => {
  const spec = zonePaintSpec(c, approxOutline());
  return spec.kind === 'hatch' ? new PolygonSymbolizer({ pattern: hatchTile(spec.stripe), fill: spec.stripe, stroke: spec.outline, width: 1.6 }) : new PolygonSymbolizer({ fill: spec.fill });
};

/** A region's rendering layer exists only while the region meets the viewport. Its archive is held in memory meanwhile and released
 *  (evicted after a grace period; the Cache API copy stays) once the region has left the view. */
export function createZones(map, regions) {
  const layers = new Map();
  let visible = true;
  let opacity = 0.45;

  const make = (r) => leafletLayer({
    url: retainArchive(regionUrl(r, r.file)),
    maxZoom: 19,
    maxDataZoom: r.maxZoom, // tiles stop here; deeper map zooms overzoom them (library default is 15)
    // Opaque fill; transparency is applied to the whole layer so adjacent cells do not darken at shared edges.
    // A region with named classes (Singapore) is drawn class by class, in the order of its classes, each in its own colour.
    paintRules: r.classes
      ? r.classes.filter((c) => !c.points).map((c) => ({ dataLayer: 'zones', filter: (zoom, f) => f.props.c === c.id, symbolizer: classSymbolizer(c) }))
      : [{ dataLayer: 'zones', symbolizer: new PolygonSymbolizer({ fill: zoneFill(r.semantics) }) }],
    labelRules: [],
    attribution: `Zones: ${r.source.authority}`,
  });

  const detach = (r) => {
    const layer = layers.get(r.id);
    if (!layer) return;
    map.removeLayer(layer);
    layers.delete(r.id);
    releaseArchive(regionUrl(r, r.file));
  };

  function sync() {
    if (!visible) return;
    const view = map.getBounds();
    for (const r of regions) {
      if (!view.intersects(toLatLngBounds(r.bounds))) { detach(r); continue; } // any overlap counts as visible
      if (layers.has(r.id)) continue;
      const layer = make(r);
      layer.setOpacity(opacity);
      layer.addTo(map);
      layers.set(r.id, layer);
    }
  }
  map.on('moveend', sync);

  return {
    sync,
    fit(options) {
      if (!regions.length) return;
      // the opening view shows Singapore, so a first visit downloads only its archive; the others are reached with the
      // country menu, since one view over regions thousands of kilometres apart would show none of them
      const all = toLatLngBounds((regions.find(r => r.id === 'sg-nofly') ?? regions[0]).bounds);
      map.fitBounds(all, options);
    },
    setVisible(v) {
      visible = v;
      if (v) sync(); // only the regions meeting the current view
      else for (const r of regions) detach(r);
    },
    setOpacity(v) {
      opacity = v;
      for (const l of layers.values()) l.setOpacity(v);
    },
  };
}
