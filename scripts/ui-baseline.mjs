// Visual baseline: captures the same screens at fixed viewports in both themes, with fixed data, a fixed clock and a placeholder map tile, so two runs
// (before and after a styling change) can be compared side by side. Writes PNGs, manifest.json and an index.html contact sheet OUTSIDE the repository.
//
//   node scripts/ui-baseline.mjs --label baseline                (everything; the app must be running on http://localhost:5173: npm run dev)
//   node scripts/ui-baseline.mjs --label after-p3 --vp desk,phone --theme dark --only popup,dash
//   node scripts/ui-baseline.mjs --compare baseline after-p3     (pixel difference per screenshot: a table in the terminal and diff.json; see docs/DESIGN.md)
//
// Options: --out DIR (default ~/UAV_UI_Screenshots), --label NAME, --vp desk,tabland,tabport,phone,phones, --theme light,dark, --only a,b (substring of a screen id), --jobs N.
// File names: <viewport>_<theme>_<NN>-<screen>.png. Comparing needs identical viewport, theme and screen ids, and the same machine and browser (fonts differ otherwise).
// Nothing here touches the app: it only drives it, like the browser suites. Signed-in screens use the same mocked Supabase (PGlite) as tests/progression.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium, CHANNEL, LATEST_SEEN } from '../tests/lib.mjs';
import { HELP } from '../src/help-content.js';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const OUT_ROOT = arg('out', path.join(os.homedir(), 'UAV_UI_Screenshots'));

// ---------- compare mode: two labels. Per screenshot: the pixel difference, and for each changed one a highlighted copy (the "after" image faded, changed pixels in magenta,
// the changed regions boxed). Writes diff_<a>_vs_<b>.json and a report folder compare_<a>_vs_<b>/index.html (before | after | highlighted, only the screens that differ).
if (process.argv.includes('--compare')) {
  const i = process.argv.indexOf('--compare'); const [la, lb] = [process.argv[i + 1], process.argv[i + 2]];
  const da = path.join(OUT_ROOT, la), db_ = path.join(OUT_ROOT, lb), rep = path.join(OUT_ROOT, `compare_${la}_vs_${lb}`);
  fs.mkdirSync(rep, { recursive: true });
  const files = fs.readdirSync(da).filter((f) => f.endsWith('.png')).sort();
  const browser = await chromium.launch({ channel: CHANNEL });
  const page = await browser.newPage();
  const rows = [];
  for (const f of files) {
    if (!fs.existsSync(path.join(db_, f))) { rows.push({ file: f, status: 'missing in ' + lb }); continue; }
    const r = await page.evaluate(async ([a, b]) => {
      const load = (s) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:image/png;base64,' + s; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
      const W = ia.width, H = ia.height;
      const px = (im) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, W, H); };
      const [pa, pb] = [px(ia), px(ib)]; let n = 0;
      const mask = new Uint8Array(W * H);
      for (let k = 0; k < W * H; k++) { const o = k * 4; if (Math.abs(pa.data[o] - pb.data[o]) + Math.abs(pa.data[o + 1] - pb.data[o + 1]) + Math.abs(pa.data[o + 2] - pb.data[o + 2]) > 12) { mask[k] = 1; n++; } }
      if (!n) return { diffPx: 0, pct: 0 };
      // boxes: 24 px cells that hold a changed pixel, merged when they touch
      const C = 24, cw = Math.ceil(W / C), ch = Math.ceil(H / C), cell = new Uint8Array(cw * ch);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) cell[Math.floor(y / C) * cw + Math.floor(x / C)] = 1;
      const seen = new Uint8Array(cw * ch), boxes = [];
      for (let s0 = 0; s0 < cell.length; s0++) {
        if (!cell[s0] || seen[s0]) continue;
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; const st = [s0]; seen[s0] = 1;
        while (st.length) { const c = st.pop(), cx = c % cw, cy = Math.floor(c / cw); x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue; const q = ny * cw + nx; if (cell[q] && !seen[q]) { seen[q] = 1; st.push(q); } } }
        boxes.push([x0 * C - 4, y0 * C - 4, (x1 - x0 + 1) * C + 8, (y1 - y0 + 1) * C + 8]);
      }
      const out = document.createElement('canvas'); out.width = W; out.height = H; const g = out.getContext('2d');
      g.drawImage(ib, 0, 0); g.fillStyle = 'rgba(255,255,255,.62)'; g.fillRect(0, 0, W, H);
      const hi = g.getImageData(0, 0, W, H);
      for (let k = 0; k < W * H; k++) if (mask[k]) { const o = k * 4; hi.data[o] = 255; hi.data[o + 1] = 0; hi.data[o + 2] = 200; hi.data[o + 3] = 255; }
      g.putImageData(hi, 0, 0); g.strokeStyle = '#ff6a00'; g.lineWidth = 2;
      for (const [x, y, w, h] of boxes) g.strokeRect(x, y, w, h);
      return { diffPx: n, pct: +(100 * n / (W * H)).toFixed(3), boxes: boxes.length, png: out.toDataURL('image/png').split(',')[1] };
    }, [fs.readFileSync(path.join(da, f)).toString('base64'), fs.readFileSync(path.join(db_, f)).toString('base64')]);
    if (r.png) { fs.writeFileSync(path.join(rep, f.replace('.png', '_diff.png')), Buffer.from(r.png, 'base64')); delete r.png; }
    rows.push({ file: f, ...r });
  }
  await browser.close();
  for (const r of rows) console.log((r.pct === 0 ? 'SAME  ' : r.size ? 'SIZE  ' : r.status ? 'MISS  ' : 'DIFF  ') + r.file + (r.pct ? `  ${r.pct}% (${r.diffPx} px, ${r.boxes} regions)` : r.size ? '  ' + r.size : r.status ? '  ' + r.status : ''));
  fs.writeFileSync(path.join(OUT_ROOT, `diff_${la}_vs_${lb}.json`), JSON.stringify(rows, null, 1));
  const changed = rows.filter((r) => r.pct > 0), same = rows.filter((r) => r.pct === 0).length;
  const html = `<!doctype html><meta charset="utf-8"><title>${la} vs ${lb}</title><style>body{font:14px system-ui;margin:16px;background:#f4f5f7}h2{margin:26px 0 6px}.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}img{max-width:100%;border:1px solid #bbb}small{color:#555}</style>
<h1>${la} (before) vs ${lb} (after)</h1><p>${same} of ${rows.length} screenshots identical; ${changed.length} differ. Third column: changed pixels magenta, changed regions boxed orange.</p>
${changed.map((r) => `<h2>${r.file} <small>${r.pct}% of pixels, ${r.boxes} regions</small></h2><div class="row"><a href="../${la}/${r.file}"><img loading="lazy" src="../${la}/${r.file}"></a><a href="../${lb}/${r.file}"><img loading="lazy" src="../${lb}/${r.file}"></a><a href="${r.file.replace('.png', '_diff.png')}"><img loading="lazy" src="${r.file.replace('.png', '_diff.png')}"></a></div>`).join('')}`;
  fs.writeFileSync(path.join(rep, 'index.html'), html);
  console.log(`${same} of ${rows.length} identical, ${changed.length} differ -> ${rep}`);
  process.exit(0);
}

const LABEL = arg('label', 'baseline');
const OUT = path.join(OUT_ROOT, LABEL);
fs.mkdirSync(OUT, { recursive: true });

// ---------- the matrix
const VIEWPORTS = {
  desk: { w: 1440, h: 900, touch: false, priority: true },
  tabland: { w: 1024, h: 768, touch: true },
  tabport: { w: 768, h: 1024, touch: true },
  phone: { w: 390, h: 844, touch: true, priority: true },
  phones: { w: 360, h: 640, touch: true },
};
const pick = (name, all) => { const v = arg(name, ''); return v ? v.split(',') : all; };
const VPS = pick('vp', Object.keys(VIEWPORTS));
const THEMES = pick('theme', ['light', 'dark']);
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const JOBS = Math.max(1, parseInt(arg('jobs', '3'), 10));
const isPhone = (vp) => VIEWPORTS[vp].w <= 520;

// ---------- fixed inputs: a clock, a map tile, and data that never changes
const FIXED = new Date('2026-11-13T10:00:00+08:00');
const iso = (off) => { const d = new Date('2026-11-13T12:00:00Z'); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };
const hrs = (h) => new Date(FIXED.getTime() + h * 3600_000).toISOString();

function pngTile() { // 256x256: pale land, a water body and two "roads", so the dark filter and overlays have something to sit on
  const W = 256, raw = Buffer.alloc((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      let c = [232, 228, 216];
      if (x > 150 && y > 120 && x < 240 && y < 200) c = [170, 200, 225];
      if (y % 128 < 3 || x % 128 < 3) c = [255, 255, 255];
      if (y % 64 === 0 || x % 64 === 0) c = [214, 210, 198];
      raw.set(c, y * (W * 3 + 1) + 1 + x * 3);
    }
  }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TILE = pngTile();

const mk = (id, type, name, lat, lon, extra = {}) => ({ id, type, name, note: '', lat, lon, created: `2026-11-01T00:00:${String(id.length).padStart(2, '0')}.000Z`, ...extra });
const POIS = [
  mk('home', 'home', 'Drone home point', 30.600, 114.300, {}),
  mk('p1', 'photo', 'East Lake Bridge', 30.575, 114.360, { tripId: 't1', date: iso(5), order: 1, note: 'Golden hour from the south bank.\nNo-fly line is 200 m north.' }),
  mk('p2', 'hotel', 'Lakeside Hotel', 30.590, 114.335, { tripId: 't1', date: iso(5), order: 2 }),
  mk('p3', 'takeoff', 'Hongshan Takeoff', 30.545, 114.345, { tripId: 't1', date: iso(6), order: 1 }),
  mk('p4', 'airport', 'Tianhe Airport', 30.784, 114.208, { tripId: 't1', date: iso(8), order: 1 }),
  mk('p5', 'train', 'Wuhan Station', 30.610, 114.250, { tripId: 't3', date: iso(0), order: 1 }),
  mk('p6', 'photo', 'Yellow Crane Tower', 30.545, 114.305, { tripId: 't3', date: iso(0), order: 2 }),
  mk('p7', 'hazard', 'Crowded square', 30.620, 114.280, {}),
  mk('p8', 'other', 'A place with a rather long name that has to wrap in narrow rows', 30.630, 114.330, {}),
];
const TRIPS = [
  { id: 't1', name: 'Hubei spring', country: 'CN', startDate: iso(5), endDate: iso(8), description: 'Four days around Wuhan: lakes, bridges and the old tower.', color: '#e91e63', created: '2026-11-01T00:00:00.000Z', checklist: [{ text: 'Batteries charged', done: true }, { text: 'Permit printed', done: false }, { text: 'ND filters', done: false }] },
  { id: 't3', name: 'Under way', startDate: iso(-1), endDate: iso(1), description: '', color: '#00897b', created: '2026-11-02T00:00:00.000Z' },
  { id: 't4', name: 'Autumn in Hangzhou (past)', startDate: iso(-30), endDate: iso(-28), description: '', color: '#3949ab', created: '2026-10-01T00:00:00.000Z' },
];

// stress content: long and CJK names, many markers and trips, a long note (the stress-* screens)
const LONG = 'The Very Long Named Place of the Old Eastern Lake Pavilion and Its Surrounding Gardens';
const STRESS_POIS = [
  mk('s1', 'photo', '武汉东湖听涛景区磨山樱园观景台（春季限定）', 30.575, 114.360, { tripId: 's1', date: iso(5), order: 1, note: '清晨日出前到达，注意无人机限飞区边界。' + String.fromCharCode(10) + 'A long note that keeps going so the window has to scroll and wrap: ' + 'the quick brown fox jumps over the lazy dog. '.repeat(8) }),
  mk('s2', 'hotel', LONG, 30.590, 114.335, { tripId: 's1', date: iso(5), order: 2 }),
  mk('s3', 'takeoff', '黄鹤楼', 30.545, 114.345, { tripId: 's1', date: iso(6), order: 1 }),
  ...Array.from({ length: 14 }, (_, i) => mk('s' + (i + 4), ['photo', 'train', 'airport', 'hazard', 'other'][i % 5], (i % 3 ? 'Spot ' : LONG.slice(0, 40) + ' ') + (i + 4), 30.52 + (i % 5) * 0.012, 114.28 + Math.floor(i / 5) * 0.015, { tripId: i % 2 ? 's2' : 's1', date: iso(5 + (i % 4)), order: i + 4 })),
];
const STRESS_TRIPS = [
  { id: 's1', name: '2027年春季湖北武汉周边航拍行程（含东湖、磨山、汉口江滩）', country: 'CN', startDate: iso(5), endDate: iso(12), description: LONG + '. ' + 'More description text. '.repeat(10), color: '#e91e63', created: '2026-11-01T00:00:00.000Z', checklist: Array.from({ length: 6 }, (_, i) => ({ text: i % 2 ? 'Charge every battery before leaving the hotel in the morning, ' + i : '检查桨叶', done: i % 3 === 0 })) },
  { id: 's2', name: LONG, startDate: iso(-1), endDate: iso(1), description: '', color: '#00897b', created: '2026-11-02T00:00:00.000Z' },
  ...['#3949ab', '#fb8c00', '#6d4c41', '#7cb342'].map((c, i) => ({ id: 's' + (i + 3), name: 'Trip ' + (i + 3), startDate: iso(20 + i * 5), endDate: iso(22 + i * 5), description: '', color: c, created: '2026-11-0' + (i + 3) + 'T00:00:00.000Z' })),
];

// ---------- signed-in screens: the real Supabase client against a mocked server running the real SQL on PGlite (same approach as tests/progression.mjs)
let acct = null;
async function account() {
  if (acct) return acct;
  const { makeDb, as, A, B, C, D } = await import('../tests/lib-db.mjs');
  const env = fs.readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
  const URL_ = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
  const REF = new URL(URL_).hostname.split('.')[0];
  const db = await makeDb();
  const one = async (u, q, params = []) => (await as(db, u, `select ${q} as r`, params))[0].r;
  const log = (m) => console.log('  seed: ' + m);
  for (const [u, n] of [[A, 'Alex'], [B, 'Bea'], [C, 'Cam'], [D, 'Dee']]) await one(u, 'public.ensure_profile($1)', [n]);
  const code = async (u) => (await one(u, 'public.ensure_profile()')).friend_code;
  for (const y of [B, C]) { const r = await one(A, 'public.request_friend($1)', [await code(y)]); await one(y, 'public.respond_friend($1, true)', [r.id]); }
  try { await one(D, 'public.request_friend($1)', [await code(A)]); } catch (e) { log('pending request: ' + e.message); }
  for (let h = 1; h <= 10; h++) await db.query(`select public.award_xp($1, 10, 'sim', $2)`, [A, 'hour:' + h]);
  await db.query(`select public.award_xp($1, 75, 'admin', 'seed2', 'A welcome bonus')`, [A]);
  await db.query(`select public.award_xp($1, 3650, 'admin', 'seed', 'seed')`, [C]);
  for (let i = 1; i <= 7; i++) await db.query(`select public.award_xp($1, 50, 'attendance', $2)`, [B, 'session:' + i]);
  try { await one(A, 'public.update_profile($1::jsonb)', [JSON.stringify({ bio: 'Weekend flyer. Mostly lakes, sometimes towers.', share_profile: true })]); } catch (e) { log('profile: ' + e.message); }
  await db.exec(`insert into public.app_roles (user_id, role) values ('${B}', 'organiser')`).catch((e) => log('role: ' + e.message));
  try {
    // fixed dates well ahead of both the fixed browser clock and the database's real clock (the database cannot be given a fake "now"); valid until March 2027
    await db.query(`insert into public.flight_sessions (title, description, location, starts_at, ends_at, created_by) values ('Field day', 'Bring batteries', 'East Lake', $1, $2, $3)`, ['2027-03-06T01:00:00Z', '2027-03-06T05:00:00Z', B]);
    const id = (await db.query(`insert into public.flight_sessions (title, location, starts_at, ends_at, created_by) values ('Spring meetup', 'Hongshan', $1, $2, $3) returning id`, ['2027-03-13T01:00:00Z', '2027-03-13T04:00:00Z', B])).rows[0].id;
    await one(A, 'public.rsvp_session($1)', [id]).catch((e) => log('rsvp: ' + e.message));
  } catch (e) { log('sessions: ' + e.message); }
  try {
    await db.exec(`update public.progression_settings set value = 1 where key = 'steam_enabled'`);
    await db.exec(`insert into public.steam_links (user_id, steam_id, state_steam_id, sim_minutes, hours_awarded, last_status, last_synced_at) values ('${A}', '76561198000000000', '76561198000000000', 1590, 26, 'ok', '${hrs(-3)}')`);
  } catch (e) { log('steam: ' + e.message); }
  let lock = Promise.resolve();
  const serial = (fn) => { const r = lock.then(fn, fn); lock = r.catch(() => {}); return r; };
  const SETOF = new Set(['list_friends', 'list_blocked', 'list_sessions', 'list_steam_apps', 'list_session_rsvps']);
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const mock = async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const reply = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rest/v1/user_data')) return reply([]);
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
    if (!m) return reply({ message: 'not mocked: ' + u.pathname }, 404);
    const fn = m[1], args = req.postData() ? JSON.parse(req.postData()) : {}, names = Object.keys(args);
    const q = SETOF.has(fn) ? `select to_jsonb(t) as j from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) t` : `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as j`;
    try { const rows = await serial(() => as(db, A, q, names.map((n) => args[n]))); return reply(SETOF.has(fn) ? rows.map((r) => r.j) : rows[0].j); } catch (e) { return reply({ message: String(e.message || e), code: 'P0001' }, 400); }
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
  const sess = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: A, email: 'a@example.test', role: 'authenticated', exp })}.sig`, refresh_token: 'r', token_type: 'bearer', expires_in: 21600, expires_at: exp, user: { id: A, email: 'a@example.test', aud: 'authenticated', role: 'authenticated' } };
  acct = { URL_, REF, mock, sess };
  return acct;
}

// ---------- page helpers
const browser = await chromium.launch({ channel: CHANNEL });
const browserVersion = browser.version();

const seedInit = ([ref, sess, o]) => {
  if (sessionStorage.__seeded) return; sessionStorage.__seeded = '1';
  localStorage.clear(); // a page opened earlier in this context must leave nothing behind
  const set = (k, v) => localStorage.setItem('uavzones.v1.' + k, JSON.stringify(v));
  if (o.dash) set('dash', { v: 1, ...o.dash }); else localStorage.removeItem('uavzones.v1.dash');
  set('help', { v: 1, seen: o.help }); // contextual hints already seen: they would sit at the top of every panel screen
  set('prefs', { view: { lat: 30.6, lon: 114.3, zoom: 11 }, basemap: 'osm', holdHint: true, ...o.prefs });
  if (o.data) { set('pois', { v: 1, items: o.pois }); set('trips', { v: 1, trips: o.trips }); }
  if (sess) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
};

async function newContext(vpName, theme) {
  const v = VIEWPORTS[vpName];
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, hasTouch: v.touch, isMobile: v.touch && v.w < 800, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-GB', timezoneId: 'Asia/Singapore' });
  await ctx.clock.install({ time: FIXED }); await ctx.clock.resume(); // the date starts at FIXED and then runs (a frozen Date stops Leaflet's tile fade-in, so the map would stay blank)
  await ctx.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), (r) => r.abort()); // nothing leaves the machine: weather, search and tiles come from nowhere
  await ctx.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname) && /\/\d+\/\d+\/\d+(\.png)?$/.test(u.pathname), (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  return ctx;
}

async function openPage(ctx, theme, { stress = false, signed = false, dash = { showOnStart: false, welcomed: true, seen: LATEST_SEEN }, data = true, prefs = {}, vpName } = {}) {
  const a = signed ? await account() : null;
  if (a) await ctx.route(new RegExp('^' + a.URL_.replace(/[.]/g, '\\.') + '/'), a.mock);
  const p = await ctx.newPage();
  p.on('request', (q) => { if (q.url().includes("/deps/leaflet.js")) p.leafletUrl = q.url(); }); // the app's own Leaflet module, for screens that draw on a map of their own
  await p.addInitScript(seedInit, [a?.REF, a?.sess ?? null, { dash, help: HELP.map((h) => h.id), prefs: { theme, themeAt: 1, ...prefs }, data: data && !signed, pois: stress ? STRESS_POIS : POIS, trips: stress ? STRESS_TRIPS : TRIPS }]);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1300);
  if (signed) await p.locator('#name-dlg-skip').click({ timeout: 2500 }).catch(() => {});
  return p;
}

const tab = (p, t) => p.evaluate((name) => { const d = document.querySelector(`#dock button[data-tab=${name}]`); if (!document.getElementById('panel').hidden) document.getElementById(`tab-${name}`).click(); else d.click(); }, t);
const profile = async (p) => { await p.evaluate(() => { const pop = document.getElementById('account-pop'); const b = [document.getElementById('account-btn'), document.getElementById('dock-account')].find((x) => x && x.offsetParent !== null); if (pop.hidden) b.click(); }); await p.waitForTimeout(900); };
const openSections = (p) => p.evaluate(() => document.querySelectorAll('#account-pop details').forEach((d) => { d.open = true; }));

// ---------- the screens. `vp`: restrict to phones or non-phones. `prio`: part of the short manual-review list.
const SCREENS = [
  { id: 'map-default', prio: 1, run: async () => {} },
  { id: 'dash-open', prio: 1, open: { dash: { showOnStart: true, welcomed: true, seen: '9999' } }, run: async (p) => { await p.waitForSelector('#dash:not([hidden])'); } },
  { id: 'dash-whatsnew', open: { dash: { showOnStart: true, welcomed: true, seen: '9999' } }, run: async (p) => { await p.waitForSelector('#dash:not([hidden])'); } },
  { id: 'dash-tall', only: 'phone', open: { dash: { showOnStart: true, welcomed: true, seen: '9999' } }, run: async (p) => { await p.evaluate(() => document.getElementById('dash-expand').click()); await p.waitForTimeout(600); } },
  { id: 'panel-config', prio: 1, run: async (p) => { await tab(p, 'config'); await p.waitForTimeout(500); } },
  { id: 'panel-trips', prio: 1, run: async (p) => { await tab(p, 'trips'); await p.waitForTimeout(500); } },
  { id: 'panel-poi', prio: 1, run: async (p) => { await tab(p, 'poi'); await p.waitForTimeout(500); } },
  { id: 'panel-friends-signedout', run: async (p) => { await tab(p, 'friends'); await p.waitForTimeout(500); } },
  { id: 'panel-tall', only: 'phone', run: async (p) => { await tab(p, 'poi'); await p.waitForTimeout(400); await p.click('.sp-grab button, .sp-grab .icon-btn'); await p.waitForTimeout(500); } },
  { id: 'privacy', run: async (p) => { await tab(p, 'config'); await p.click('#privacy-btn'); await p.waitForTimeout(500); } },
  { id: 'trip-detail', run: async (p) => { await tab(p, 'trips'); await p.locator('.trip-card.clickable').first().click(); await p.waitForTimeout(700); } },
  { id: 'popup-collapsed', prio: 1, open: { prefs: { windowExpanded: false } }, run: async (p) => { await tab(p, 'poi'); await p.locator('#poi-list .poi-item', { hasText: 'East Lake Bridge' }).click(); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(700); } },
  { id: 'popup-expanded', open: { prefs: { windowExpanded: true } }, run: async (p) => { await tab(p, 'poi'); await p.locator('#poi-list .poi-item', { hasText: 'East Lake Bridge' }).click(); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(700); } },
  { id: 'popup-edit', run: async (p) => { await tab(p, 'poi'); await p.locator('#poi-list .poi-item', { hasText: 'East Lake Bridge' }).click(); await p.waitForSelector('.poi-pop h3'); await p.locator('.poi-pop .btn', { hasText: 'Edit' }).first().click(); await p.waitForSelector('.poi-pop form'); await p.waitForTimeout(500); await p.evaluate(() => { document.activeElement?.blur?.(); getSelection()?.removeAllRanges(); }); await p.waitForTimeout(200); } }, // no focus or selection state: it varied with machine load
  { id: 'point-check', prio: 1, run: async (p, vp) => { const v = VIEWPORTS[vp]; const x = v.w * 0.42, y = v.h * 0.62; await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(2400); await p.mouse.up(); await p.waitForTimeout(1200); } },
  { id: 'placing-banner', run: async (p) => { await tab(p, 'poi'); await p.getByRole('button', { name: /Place on map/i }).first().click(); await p.waitForTimeout(600); } },
  { id: 'splash', open: { dash: null, data: false }, run: async (p) => { await p.waitForSelector('dialog.splash[open]', { timeout: 4000 }); await p.waitForTimeout(400); } },
  { id: 'toast', run: async (p) => { await p.mouse.click(300, 400); await p.waitForTimeout(700); }, open: { prefs: { holdHint: false } } },
  // signed in (mocked server)
  { id: 'acct-popover', prio: 1, signed: true, run: async (p) => { await profile(p); await p.waitForSelector('#account-pop #pane-progression .prog-card[data-status=ready]', { timeout: 6000 }).catch(() => {}); } },
  { id: 'acct-popover-open', signed: true, run: async (p) => { await profile(p); await p.waitForSelector('#account-pop #pane-progression .prog-card[data-status=ready]', { timeout: 6000 }).catch(() => {}); await openSections(p); await p.waitForTimeout(400); } },
  { id: 'achievements', prio: 1, signed: true, run: async (p) => { await profile(p); await p.waitForSelector('#account-pop .prog-card[data-status=ready]', { timeout: 6000 }); await p.click('#account-pop [data-act=collection]'); await p.waitForSelector('#prog-dialog[open] .ach-tile', { timeout: 4000 }); await p.waitForTimeout(500); } },
  { id: 'xp-history', signed: true, run: async (p) => { await profile(p); await p.waitForSelector('#account-pop .prog-card[data-status=ready]', { timeout: 6000 }); await p.click('#account-pop [data-act=history]'); await p.waitForSelector('#prog-dialog[open] .prog-hist-row', { timeout: 4000 }); await p.waitForTimeout(500); } },
  { id: 'edit-profile', signed: true, run: async (p) => { await profile(p); await p.getByRole('button', { name: /Edit profile/i }).first().click(); await p.waitForSelector('#profile-dialog[open]', { timeout: 4000 }); await p.waitForTimeout(500); } },
  { id: 'friends-tab', prio: 1, signed: true, run: async (p) => { await tab(p, 'friends'); await p.waitForTimeout(1500); } },
  { id: 'sessions-card', prio: 1, signed: true, run: async (p) => { await tab(p, 'friends'); await p.waitForSelector('#fr-sessions .ses-card[data-status=ready]', { timeout: 6000 }).catch(() => {}); await p.locator('#fr-sessions').scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(600); } },
  { id: 'profile-popover', signed: true, run: async (p) => { await tab(p, 'friends'); await p.waitForTimeout(1200); await p.locator('.pv-trigger').first().click(); await p.waitForTimeout(1200); } },
  // live friends' pins with the rank ring and tier badge, and the rank badges of all ten tiers: the real livemap.js and progression-ui.js drawn on a map of their own over the app
  { id: 'rank-rings', prio: 1, run: async (p, vp) => {
    await p.evaluate(async ([narrow, leaflet]) => {
      const L = (await import(leaflet)).default;
      const { createLiveLayer } = await import('/src/livemap.js');
      const { cleanProgression } = await import('/src/progression.js');
      const { rankBadge } = await import('/src/progression-ui.js');
      const host = document.createElement('div'); host.id = 'rank-gallery'; host.style.cssText = 'position:fixed;inset:0;z-index:5000';
      const mapEl = document.createElement('div'); mapEl.style.cssText = 'position:absolute;inset:0'; host.append(mapEl);
      document.body.append(host);
      const map = L.map(mapEl, { zoomControl: false, attributionControl: false }).setView([30.6, 114.3], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { className: 'base-tiles' }).addTo(map);
      const strip = document.createElement('div'); strip.style.cssText = 'position:absolute;left:8px;right:8px;top:8px;z-index:1000;display:flex;flex-wrap:wrap;gap:8px;padding:8px;background:var(--surface);border-radius:12px;box-shadow:var(--shadow-sm)';
      const prog = (tier) => cleanProgression({ visible: true, xp: tier * 300, tier, rank_key: 'r' + tier, rank_name: 'Rank ' + tier, tier_min_xp: tier * 250, next_min_xp: tier === 10 ? null : (tier + 1) * 250 });
      for (let t = 1; t <= 10; t++) strip.append(rankBadge(prog(t), 22), rankBadge(prog(t), 32));
      host.append(strip);
      const cols = narrow ? 3 : 5, w = innerWidth, h = innerHeight, top = 120, cellW = w / cols, cellH = (h - top - 20) / 2;
      const ranks = new Map(), others = [];
      for (let i = 0; i < 10; i++) {
        const ll = map.containerPointToLatLng([cellW * (i % cols) + cellW / 2, top + cellH * Math.floor(i / cols) + cellH / 2]);
        ranks.set('m' + i, prog(i + 1));
        others.push({ member_id: 'm' + i, display_name: 'Member ' + (i + 1), lat: ll.lat, lon: ll.lng, accuracy: 0, age_seconds: 5, trip_id: 't' });
      }
      const layer = createLiveLayer(map); layer.setRanks(ranks); layer.update(others);
    }, [VIEWPORTS[vp].w <= 520, p.leafletUrl]);
    await p.waitForTimeout(1200);
  } },
  { id: 'stress-poi-list', open: { stress: true }, run: async (p) => { await tab(p, 'poi'); await p.waitForTimeout(600); } },
  { id: 'stress-trips', open: { stress: true }, run: async (p) => { await tab(p, 'trips'); await p.waitForTimeout(600); } },
  { id: 'stress-popup', open: { stress: true, prefs: { windowExpanded: true } }, run: async (p) => { await tab(p, 'poi'); await p.locator('#poi-list .poi-item', { hasText: '听涛' }).first().click(); await p.waitForSelector('.poi-pop h3'); await p.waitForTimeout(800); } },
  { id: 'stress-dash', open: { stress: true, dash: { showOnStart: true, welcomed: true, seen: '9999' } }, run: async (p) => { await p.waitForSelector('#dash:not([hidden])'); await p.waitForTimeout(400); } },
];

// ---------- run
const jobs = [];
for (const vp of VPS) for (const theme of THEMES) jobs.push({ vp, theme });
const manifest = { label: LABEL, taken: new Date().toISOString(), browser: `${CHANNEL} ${browserVersion}`, fixedClock: FIXED.toISOString(), node: process.version, shots: [] };
let n = 0;
async function runJob({ vp, theme }) {
  const ctx = await newContext(vp, theme);
  let i = 0;
  for (const s of SCREENS) {
    i++;
    if (s.only === 'phone' && !isPhone(vp)) continue;
    if (ONLY && !ONLY.some((w) => s.id.includes(w))) continue;
    const name = `${vp}_${theme}_${String(i).padStart(2, '0')}-${s.id}.png`;
    let p, status = 'ok', note = '';
    try {
      p = await openPage(ctx, theme, { signed: !!s.signed, vpName: vp, ...(s.open ?? {}) });
      await s.run(p, vp);
      await p.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (/[0-9A-Z]{5}-[0-9A-Z]{5}/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/[0-9A-Z]{5}-[0-9A-Z]{5}/g, 'ABCDE-12345'); }); // the friend code is random on every run
      await p.screenshot({ path: path.join(OUT, name), animations: 'disabled', caret: 'hide' });
    } catch (e) { status = 'failed'; note = String(e.message).split('\n')[0].slice(0, 160); }
    finally { await p?.close().catch(() => {}); }
    manifest.shots.push({ file: name, viewport: vp, theme, screen: s.id, priority: !!(s.prio && VIEWPORTS[vp].priority), status, note });
    console.log(`${status === 'ok' ? 'ok    ' : 'FAILED'} ${name}${note ? '  ' + note : ''}`);
    n++;
  }
  await ctx.close();
}
const queue = [...jobs];
await Promise.all(Array.from({ length: JOBS }, async () => { while (queue.length) await runJob(queue.shift()); }));
await browser.close();

const prev = path.join(OUT, 'manifest.json'); // a partial run (--only) adds to the manifest of the same label instead of replacing it
if (ONLY && fs.existsSync(prev)) { const old = JSON.parse(fs.readFileSync(prev, 'utf8')).shots.filter((o) => !manifest.shots.some((n) => n.file === o.file)); manifest.shots.push(...old); }
manifest.shots.sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

// contact sheet: for each screen and viewport, light beside dark
const by = {};
for (const s of manifest.shots) ((by[`${s.viewport}|${s.screen}`] ??= { vp: s.viewport, screen: s.screen, prio: s.priority, file: {} }).file[s.theme] = s);
const cell = (s) => (s && s.status === 'ok' ? `<a href="${s.file}"><img loading="lazy" src="${s.file}"></a>` : `<div class="miss">${s ? 'failed: ' + s.note : 'not captured'}</div>`);
const html = `<!doctype html><meta charset="utf-8"><title>UI baseline ${LABEL}</title><style>body{font:14px system-ui;margin:16px;background:#f4f5f7}h2{margin:28px 0 6px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}img{max-width:100%;border:1px solid #bbb}.miss{padding:20px;border:1px dashed #c33;color:#c33}.p{color:#0a7a4b}</style>
<h1>UI baseline: ${LABEL}</h1><p>${manifest.browser}, fixed clock ${manifest.fixedClock}, taken ${manifest.taken}. Left light, right dark. Priority screens are marked.</p>
${[...Object.values(by)].sort((a, b) => (b.prio - a.prio) || a.vp.localeCompare(b.vp) || a.screen.localeCompare(b.screen)).map((g) => `<h2>${g.vp} / ${g.screen}${g.prio ? ' <span class="p">priority</span>' : ''}</h2><div class="row">${cell(g.file.light)}${cell(g.file.dark)}</div>`).join('\n')}`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
const bad = manifest.shots.filter((s) => s.status !== 'ok');
console.log(`\n${manifest.shots.length - bad.length} screenshots, ${bad.length} failed -> ${OUT}`);
process.exit(bad.length ? 1 : 0);
