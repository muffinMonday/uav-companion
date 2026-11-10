// Where the generated data (manifests, tiles, places) is served from.
// Default: ./data/ next to the page. Set VITE_DATA_BASE_URL to read data from elsewhere, e.g. the deployed site,
// so the app can run without the raw source data:  VITE_DATA_BASE_URL=https://<user>.github.io/uav-companion/data/ npm run dev
const base = import.meta.env.VITE_DATA_BASE_URL || './data/';
const DATA_BASE = new URL(base.endsWith('/') ? base : `${base}/`, document.baseURI).href;

export const dataUrl = (p) => new URL(p, DATA_BASE).href;
