// Where the generated data (manifests, tiles, places) is served from.
// Default: ./data/ next to the page. Set VITE_DATA_BASE_URL to read data from elsewhere, e.g. the deployed site,
// so the app can run without the raw source data:  VITE_DATA_BASE_URL=https://<user>.github.io/uav-companion/data/ npm run dev
const base = import.meta.env.VITE_DATA_BASE_URL || './data/';
const DATA_BASE = new URL(base.endsWith('/') ? base : `${base}/`, document.baseURI).href;

export const dataUrl = (p) => new URL(p, DATA_BASE).href;

// Regions built with "publish": false live in ./data-local/, next to the page. They exist on the machine that built them only
// (the deploy strips them), so the app looks for them on localhost and private network addresses, never on the public site.
export const localUrl = (p) => new URL(p, new URL('./data-local/', document.baseURI)).href;
/** The address of a file of a region: local regions have theirs under data-local. */
export const regionUrl = (r, p) => (r.local ? localUrl(p) : dataUrl(p));
export const mayHaveLocalData = () => /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)$/.test(location.hostname);
