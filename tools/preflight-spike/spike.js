// Motor diagnostics, Phase 1 harness: read-only inventory + Android transport spike.
// Non-shipping: tools/ is not a Vite entry, so it is absent from `dist`. Run it with the flag on:
//   VITE_PREFLIGHT_DIAGNOSTICS=1 npm run dev     (PowerShell: $env:VITE_PREFLIGHT_DIAGNOSTICS='1'; npm run dev)
// On an Android phone use `adb reverse tcp:5173 tcp:5173` and open http://localhost:5173/tools/preflight-spike/ in Chrome 148+
// (Web Serial needs a secure context; localhost qualifies, a LAN IP does not).
// Everything here is read-only: transports reject any write that is not an allowlisted read request.
import { preflightEnabled } from '../../src/preflight/flag.js';
import { el } from '../../src/cards.js';
import { beginRead, finishReadOk, finishReadFailed, transportClosed, statusText } from '../../src/preflight/session-status.js';

// onState(S) is called after every change; the Phase 2 page uses it to draw the readiness view.
export async function mountSpike(root, { onState } = {}) {
  if (!preflightEnabled()) {
    const d = el('p', 'disabled-note', 'Disabled. This page is behind the build-time flag VITE_PREFLIGHT_DIAGNOSTICS, which is off.');
    d.dataset.disabled = 'true';
    root.append(d);
    return null;
  }
  const { WebSerialTransport, hasWebSerial } = await import('../../src/preflight/transport.js');
  const { mockFcTransport } = await import('../../src/preflight/mock-fc.js');
  const { ReadOnlySession } = await import('../../src/preflight/session.js');
  const { buildInventory, collectClientInfo, exportInventoryJson, exportInventoryMarkdown } = await import('../../src/preflight/inventory.js');
  const { renderInventoryPanel } = await import('../../src/preflight/inventory-ui.js');

  const S = { transport: null, session: null, snapshot: null, inventory: null, reading: false, error: null, message: '', manual: {}, log: [] };
  const t0 = performance.now();
  const note = (type, data = {}) => S.log.push({ t: Math.round(performance.now() - t0), type, ...data });
  const status = el('p'); status.setAttribute('role', 'status'); status.id = 'lab-status';
  const invRoot = el('div'); invRoot.id = 'lab-inventory';
  const bar = el('div');
  const spike = el('section', 'spike');
  const mkBtn = (text, fn, id) => { const b = el('button', '', text); b.type = 'button'; if (id) b.id = id; b.addEventListener('click', fn); bar.append(b); return b; };

  function save(text, name, type) {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); a.remove();
  }
  function draw() {
    S.inventory = S.snapshot ? buildInventory({ snapshot: S.snapshot, manual: S.manual, client: collectClientInfo(navigator, S.transport ? S.transport.kind : 'unknown') }) : null;
    status.textContent = statusText(S);
    if (S.inventory) {
      renderInventoryPanel(invRoot, {
        inventory: S.inventory, manual: S.manual,
        onManual: (p) => { S.manual = { ...S.manual, ...p }; draw(); },
        onExport: (kind, includeUid) => save(kind === 'json' ? exportInventoryJson(S.inventory, { includeUid }) : exportInventoryMarkdown(S.inventory, { includeUid }), `aircraft-inventory.${kind === 'json' ? 'json' : 'md'}`, kind === 'json' ? 'application/json' : 'text/markdown'),
      });
    } else invRoot.replaceChildren();
    if (onState) onState(S);
  }
  async function readAll(transport) {
    beginRead(S); draw();
    try {
      S.transport = transport; await transport.open();
      transport.onClose((r) => { note('transport-closed', { reason: String(r) }); if (transportClosed(S, transport, String(r))) draw(); });
      S.session = new ReadOnlySession(transport);
      S.snapshot = await S.session.collectSnapshot();
      note('snapshot', { failedReads: Object.entries(S.snapshot.reads).filter(([, r]) => !r.ok).map(([k, r]) => `${k}:${r.error}`) });
      finishReadOk(S);
    } catch (e) { finishReadFailed(S, 'Could not read the flight controller: ' + (e && e.message ? e.message : e)); note('error', { message: String(e) }); }
    draw();
  }

  mkBtn('Connect aircraft (USB)', async () => {
    try { note('request-port-click'); await readAll(await WebSerialTransport.request(navigator)); } catch (e) { S.error = String(e.message || e); note('request-port-failed', { message: String(e) }); draw(); }
  }, 'btn-connect');
  mkBtn('Use synthetic aircraft (mock, not real)', () => readAll(mockFcTransport()), 'btn-mock');
  mkBtn('Read again', async () => { if (S.session) { beginRead(S); draw(); S.snapshot = await S.session.collectSnapshot(); finishReadOk(S); draw(); } }, 'btn-reread');

  // ---- spike panel (backlog section 3, Android boundary; Phase 0 list M8). All read-only.
  const env = () => ({
    secureContext: window.isSecureContext, webSerial: hasWebSerial(), userAgent: navigator.userAgent,
    userAgentData: navigator.userAgentData ? { mobile: navigator.userAgentData.mobile, platform: navigator.userAgentData.platform, brands: navigator.userAgentData.brands } : null,
    visibility: document.visibilityState, online: navigator.onLine,
  });
  spike.append(el('h2', '', 'Android transport spike (read-only)'));
  spike.append(el('p', '', 'Track 1: native Web Serial. Track 2 (transport-only Capacitor bridge) is described in CAPACITOR_BRIDGE.md and is not built into this page.'));
  const out = el('pre'); out.id = 'spike-out';
  const show = () => { out.textContent = JSON.stringify({ env: env(), log: S.log.slice(-30) }, null, 2); };
  const sbar = el('div');
  const mk2 = (t, fn, id) => { const b = el('button', '', t); b.type = 'button'; if (id) b.id = id; b.addEventListener('click', fn); sbar.append(b); };
  mk2('List granted ports', async () => {
    try { const p = hasWebSerial() ? await navigator.serial.getPorts() : []; note('getPorts', { count: p.length, info: p.map((x) => (x.getInfo ? x.getInfo() : null)) }); } catch (e) { note('getPorts-failed', { message: String(e) }); }
    show();
  }, 'btn-ports');
  mk2('Latency test (50 reads)', async () => {
    if (!S.session) { note('latency-skipped', { reason: 'not connected' }); show(); return; }
    const ms = [];
    for (let i = 0; i < 50; i++) { const a = performance.now(); try { await S.session.request('MSP_API_VERSION'); ms.push(performance.now() - a); } catch (e) { note('latency-fail', { i, code: e.code }); break; } }
    ms.sort((a, b) => a - b);
    const q = (p) => (ms.length ? +ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(1) : null);
    note('latency', { n: ms.length, p50: q(0.5), p99: q(0.99), max: ms.length ? +ms[ms.length - 1].toFixed(1) : null }); show();
  }, 'btn-latency');
  mk2('Save spike log (JSON)', () => save(JSON.stringify({ env: env(), log: S.log }, null, 2), 'preflight-spike-log.json', 'application/json'), 'btn-savelog');
  spike.append(sbar, out);
  // What happens to the page and the port when the phone locks, switches app or the cable moves.
  for (const ev of ['visibilitychange', 'pagehide', 'pageshow', 'freeze', 'resume', 'online', 'offline']) document.addEventListener(ev, () => { note(ev, { visibility: document.visibilityState }); show(); });
  if (hasWebSerial()) { navigator.serial.addEventListener('connect', () => { note('serial-connect'); show(); }); navigator.serial.addEventListener('disconnect', () => { note('serial-disconnect'); show(); }); }

  root.append(bar, status, invRoot, spike);
  show(); draw();
  return S;
}
