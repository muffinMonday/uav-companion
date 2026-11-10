// Rain outlook: the data parsing and the summary used by the marker window. No browser needed.
import { ROOT } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);

const mw = await load('src/markerweather.js');
const E = (extra) => ({ t: 1, temp: 10, wind: 2, gust: 5, n: 5, start: '14:00', tz: 'GMT+8', ...extra });

ok(mw.rainOutlook(null) === null && mw.rainOutlook(E({})) === null, 'an entry saved before rain was fetched gives no outlook (nothing is shown until the next refresh)');
let o = mw.rainOutlook(E({ pp: [10, 40, 70, 30, 0], pr: [0, 0.2, 1.4, 0.1, 0] }));
ok(o.kind === 'prob' && o.peak === 70 && o.at === '16:00' && o.hours.length === 5, 'with a chance: peak 70% at 16:00 (third hour from 14:00)');
ok(o.hours[0].label === '14:00' && o.hours[4].label === '18:00' && o.hours[2].mm === 1.4, 'hours are labelled from the forecast start, and carry the expected mm');
o = mw.rainOutlook(E({ start: '22:00', pp: [5, 10, 80, 20, 0], pr: [0, 0, 0, 0, 0] }));
ok(o.hours.map((h) => h.label).join() === '22:00,23:00,00:00,01:00,02:00' && o.at === '00:00', 'hour labels wrap past midnight');
o = mw.rainOutlook(E({ pp: [20, 20, 20, 0, 0], pr: [] }));
ok(o.peak === 20 && o.at === '14:00', 'when several hours tie for the peak, the first one is named');
o = mw.rainOutlook(E({ pp: [null, 30, null, null, null], pr: [0, 0.1, 0, 0, 0] }));
ok(o.kind === 'prob' && o.peak === 30 && o.hours[0].p === null, 'missing hours are skipped for the peak and kept as gaps');
o = mw.rainOutlook(E({ pp: [], pr: [0, 0.3, 0.9, 0, 0] }));
ok(o.kind === 'mm' && Math.abs(o.total - 1.2) < 1e-9 && o.hours.length === 5, 'no chance from the model, but expected rain: total 1.2 mm');
o = mw.rainOutlook(E({ pp: [], pr: [0, 0, 0, 0, 0] }));
ok(o.kind === 'mm' && o.total === 0, 'zero expected rain is "no rain", not "unavailable"');
o = mw.rainOutlook(E({ pp: [], pr: [] }));
ok(o.kind === 'none' && o.hours.length === 0, 'neither chance nor millimetres: unavailable');
o = mw.rainOutlook(E({ pp: [0, 0, 0, 0, 0], pr: [0, 0, 0, 0, 0] }));
ok(o.kind === 'prob' && o.peak === 0, 'a chance of 0% everywhere is still a real answer (peak 0)');

// the request and its parsing, with a stand-in for fetch
const weather = await load('src/weather.js');
const day = Math.floor(Date.now() / 86400000) * 86400000;
const time = Array.from({ length: 48 }, (_, i) => new Date(day + i * 3600000).toISOString().slice(0, 16));
let lastUrl = '';
const reply = (hourly) => async (url) => { lastUrl = String(url); return { ok: true, status: 200, json: async () => ({ utc_offset_seconds: 0, timezone_abbreviation: 'GMT', hourly: { time, temperature_2m: time.map(() => 10), wind_speed_10m: time.map(() => 2), wind_gusts_10m: time.map(() => 5), ...hourly } }) }; };
globalThis.fetch = reply({ precipitation_probability: time.map((_, k) => (k * 5) % 100), precipitation: time.map(() => 0.2) });
let r = (await weather.fetchSummaries([{ id: 'a', lat: 30, lon: 114 }]))[0];
ok(/precipitation_probability/.test(lastUrl) && /precipitation(&|$|,)/.test(lastUrl), 'the request asks for rain chance and rain amount');
ok(r.pp.length === 5 && r.pr.length === 5 && r.pr.every((v) => v === 0.2), 'five hours of each come back');
globalThis.fetch = reply({});
r = (await weather.fetchSummaries([{ id: 'a', lat: 30, lon: 114 }]))[0];
ok(Array.isArray(r.pp) && r.pp.length === 0 && Array.isArray(r.pr) && r.pr.length === 0 && r.temp === 10, 'a reply without rain fields does not break the summary: empty lists');
globalThis.fetch = reply({ precipitation_probability: time.map(() => null), precipitation: time.map(() => null) });
r = (await weather.fetchSummaries([{ id: 'a', lat: 30, lon: 114 }]))[0];
ok(mw.rainOutlook({ t: 1, start: r.start, n: 5, ...r }).kind === 'none', 'all-null rain fields count as unavailable');
