import L from 'leaflet';
import { leafletLayer, PolygonSymbolizer } from 'protomaps-leaflet';
import { dataUrl } from './config.js';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Vite does not resolve Leaflet's default icon paths on its own: drop its path detection and use the bundled URLs.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

const BASES = {
  esri: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles &copy; Esri' }],
  sat: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics' }],
  topo: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom: 17, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)' }],
  osm: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }],
};

// One fill colour per meaning: allow = where flying is permitted (teal), restrict = where it is restricted (red).
const FILL = { allow: '#2aa6b8', restrict: '#d64545' };
const toLatLngBounds = (b) => L.latLngBounds([b[1], b[0]], [b[3], b[2]]);

/** `initial` carries the remembered settings: { view: {lat, lon, zoom}, basemap, units }. All optional. */
export function createMap(initial = {}) {
  const v = initial.view;
  const map = L.map('map', { zoomControl: true, maxZoom: 19 }).setView(v ? [v.lat, v.lon] : [35, 105], v ? v.zoom : 4);
  const makeScale = (units) => L.control.scale({ metric: units !== 'imperial', imperial: units === 'imperial', position: 'bottomleft', maxWidth: 140 }).addTo(map);
  let scale = makeScale(initial.units);

  let base = L.tileLayer(...BASES[initial.basemap in BASES ? initial.basemap : 'esri']).addTo(map);
  const switchBase = (key) => {
    map.removeLayer(base);
    base = L.tileLayer(...BASES[key]).addTo(map);
    base.bringToBack();
  };
  /** Metric or imperial scale bar, to match the distance units setting. */
  // Leaflet's scale control only builds the bar for the unit it started with, so switching means replacing the control.
  const setScaleUnits = (units) => {
    scale.remove();
    scale = makeScale(units);
  };
  return { map, switchBase, setScaleUnits };
}

/** Loads each region's PMTiles layer when it enters the viewport. */
export function createZones(map, regions) {
  const layers = new Map();
  let visible = true;
  let opacity = 0.45;

  const make = (r) => leafletLayer({
    url: dataUrl(r.file),
    maxZoom: 19,
    maxDataZoom: r.maxZoom, // tiles stop here; deeper map zooms overzoom them (library default is 15)
    // Opaque fill; transparency is applied to the whole layer so adjacent cells do not darken at shared edges.
    paintRules: [{ dataLayer: 'zones', symbolizer: new PolygonSymbolizer({ fill: FILL[r.semantics] }) }],
    labelRules: [],
    attribution: `Zones: ${r.source.authority}`,
  });

  function sync() {
    if (!visible) return;
    const view = map.getBounds();
    for (const r of regions) {
      if (layers.has(r.id) || !view.intersects(toLatLngBounds(r.bounds))) continue;
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
      const all = regions.map((r) => toLatLngBounds(r.bounds)).reduce((a, b) => a.extend(b));
      map.fitBounds(all, options);
    },
    setVisible(v) {
      visible = v;
      if (v) { for (const l of layers.values()) l.addTo(map); sync(); }
      else for (const l of layers.values()) map.removeLayer(l);
    },
    setOpacity(v) {
      opacity = v;
      for (const l of layers.values()) l.setOpacity(v);
    },
  };
}
