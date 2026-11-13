// The privacy scrubbing of the diagnostic log (src/logscrub.js). No browser, no network.
import { scrubText, scrubUrl, scrubStack, scrubData, scrubEntry, safeRoute, DATA_KEYS } from '../src/logscrub.js';
const ok = (c, m) => console.log((c ? 'PASS' : 'FAIL') + '  ' + m);
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const KEY = 'sb_publishable_AbCdEfGhIjKlMnOpQrStUv_1234';
const UID = '3f2b8c1e-9d4a-4b6f-8a1c-0e5d7f9a2b34';

// ---------- text
{
  const t = scrubText(`fetch failed for https://x.supabase.co/rest/v1/rpc/foo?apikey=${KEY}&token=abc#frag with Bearer ${JWT} user ${UID} mail a.b@c.org steam 76561198000000000`);
  ok(!/eyJ|sb_publishable|apikey|token=abc|frag|a\.b@c|3f2b8c1e|76561198000000000/.test(t), 'tokens, keys, query, hash, uuid, e-mail and a Steam id are gone: ' + t);
  ok(t.includes('x.supabase.co/rest/v1/rpc/foo'), 'the origin and path of a URL are kept');
  const c = scrubText('moved to 30.123456, 114.654321 then lat=30.5 lng: 114.2 position=abc');
  ok(!/30\.1234|114\.6543|30\.5|114\.2|position=abc/.test(c), 'coordinates and lat/lng/position pairs are redacted: ' + c);
  ok(!/0123456789abcdef0123456789abcdef/.test(scrubText('hash 0123456789abcdef0123456789abcdef0123')), 'a long opaque run is redacted');
  ok(scrubText('x'.repeat(500)).length <= 200, 'text is cut to 200 characters');
  ok(scrubText('HTTP status code=401 retry in 5 s') === 'HTTP status code=401 retry in 5 s', 'plain diagnostics survive');
  const samples = [`boom lat=30.123456 ${JWT}`, `Bearer ${JWT} token=abc key: v secret=s position=1,2`, 'a@b.co 76561198000000000 30.12345, 114.65432 https://h.io/p?x=1', `${UID} ${KEY}`];
  ok(samples.every((s) => scrubText(scrubText(s)) === scrubText(s)), 'scrubbing text twice changes nothing (the store scrubs what the logger already scrubbed)');
  ok(scrubText(null) === '' && scrubText(undefined) === '' && typeof scrubText({ toString() { throw new Error('x'); } }) === 'string', 'odd inputs give a string and never throw');
  ok(scrubText('Authorization: Bearer abc.def password=hunter2 secret: s3') .indexOf('hunter2') < 0 && !/\bs3\b/.test(scrubText('secret: s3')), 'password and secret values are redacted');
}

// ---------- URLs and stacks
{
  ok(scrubUrl('https://user:pw@host.example/p/a?q=1#h') === 'https://host.example/p/a', 'scrubUrl drops credentials, query and hash');
  const st = scrubStack(['TypeError: bad at ' + 'x'.repeat(10), ...Array.from({ length: 20 }, (_, i) => `    at fn${i} (https://uav.example/assets/index-abc123.js?v=${KEY}:10:${i})`)].join('\n'));
  ok(st.split('\n').length <= 9, 'a stack keeps at most 8 frames: ' + st.split('\n').length);
  ok(!/uav\.example|sb_publishable|\?v=/.test(st) && /index-abc123\.js:10:0/.test(st), 'frames keep file basename and line, not the path or query');
  ok(scrubStack(undefined) === '' && scrubStack(42) === '', 'no stack gives an empty string');
}

// ---------- data: allow-list, nested objects and arrays
{
  const d = scrubData({ status: 503, code: 'timeout', error_name: 'TypeError', count: 3, ms: 120.45678, attempt: 2, online: false, visible: true, kind: 'poll', route: 'trips/:id',
    lat: 30.1, lng: 114.2, token: JWT, email: 'a@b.c', name: 'Home', trip: 'Hubei trip', steam: '1', position: { lat: 1 }, extra: 'x',
    nested: { status: 1, token: JWT, deeper: { lat: 3 } }, list: [{ lat: 1 }, 'a'], fn() {} });
  ok(Object.keys(d).every((k) => DATA_KEYS.includes(k)), 'only allow-listed keys survive: ' + Object.keys(d).join(','));
  ok(d.status === 503 && d.code === 'timeout' && d.error_name === 'TypeError' && d.count === 3 && d.attempt === 2 && d.online === false && d.visible === true && d.kind === 'poll', 'allowed values are kept');
  ok(d.route === 'trips/:id', 'a route template is kept');
  ok(!JSON.stringify(d).includes(JWT) && !('nested' in d) && !('list' in d) && !('lat' in d) && !('name' in d), 'nested objects and arrays are dropped, not searched');
  ok(scrubData('x') && Object.keys(scrubData('x')).length === 0 && Object.keys(scrubData([1])).length === 0 && Object.keys(scrubData(null)).length === 0, 'non-objects give an empty object');
  const cyc = { status: 1 }; cyc.self = cyc;
  ok(scrubData(cyc).status === 1, 'a cyclic object is safe');
  ok(scrubData({ error_name: 'bad name with spaces & <script>' }).error_name === 'Error', 'error_name must look like a JS error type, otherwise Error');
  ok(scrubData({ code: 'x'.repeat(300) }).code.length <= 60, 'string values are short');
  ok(!('ms' in scrubData({ ms: NaN })) && !('ms' in scrubData({ ms: Infinity })), 'non-finite numbers are dropped');
}

// ---------- routes
{
  ok(safeRoute('trips') === 'trips' && safeRoute('friends/:id') === 'friends/:id', 'known routes and templates pass');
  ok(safeRoute('/trips/abc?x=1') === 'other' && safeRoute('trips/abc') === 'other' && safeRoute('nowhere') === 'other' && safeRoute(7) === 'other' && safeRoute('trips/:ID') === 'other', 'raw paths, ids, unknown routes and non-strings become other');
}

// ---------- entries
{
  const e = scrubEntry({ id: 5, t: 10, level: 'bogus', src: 'bad src!', msg: 'x ' + JWT, data: { token: 'a', status: 1 }, count: -4, stack: 'Error\n   at f (https://a/b/c.js:1:2)', evil: 'x' });
  ok(e.level === 'error' && e.src === 'app' && e.count === 1 && !('evil' in e) && !e.msg.includes('eyJ') && e.data.status === 1 && !('token' in e.data), 'an entry is rebuilt from known fields with safe defaults');
  ok(JSON.stringify(scrubEntry(e)) === JSON.stringify(e), 'scrubbing twice changes nothing (store and export can both scrub)');
  ok(scrubEntry(null).src === 'app' && scrubEntry('x').msg === '', 'garbage in gives a valid entry');
}
