// Motor diagnostics: the user-facing workspace (experimental beta). It reuses the bench controller, state machine and analysis
// modules unchanged; only the presentation differs from the developer lab (tools/motor-bench-lab/). It exists in the build only
// when VITE_BENCH_PHASE3=1, which is also the kill switch for the dashboard entry. No synthetic or fault-injection control is
// offered here; a simulated flight controller is available only to tests and local development (never in a production build).
import '../src/styles.css'; // the main app's own stylesheet: tokens, buttons, badges, cards, alerts, form controls
import '../src/preflight/ui-parts.css'; // arrangement of the shared parts only (same tokens)
import { applyTheme } from '../src/theme.js';
import { benchEnabled, fourwayEnabledFor } from '../src/benchtest/flag.js';
import { installLifecycle } from '../src/benchtest/lifecycle.js';

applyTheme(); // the app's light/dark choice (the same preference the main app writes)
const root = document.getElementById('bench');
const status = document.getElementById('bench-status');

if (!benchEnabled()) {
  const p = document.createElement('p');
  p.className = 'dg-disabled'; p.dataset.disabled = 'true';
  p.textContent = 'Motor diagnostics is not available in this build.';
  root.append(p);
} else {
  const [{ createBenchController }, { mountBench }, { WebSerialTransport, hasWebSerial }, { STATE }] = await Promise.all([
    import('../src/benchtest/controller.js'), import('../src/benchtest/bench-ui.js'), import('../src/preflight/transport.js'), import('../src/benchtest/state-machine.js'),
  ]);
  const controller = createBenchController();
  const say = (t) => { status.textContent = t || ''; };
  let notice = '';

  const connectReal = async () => {
    say('');
    try {
      const t = await WebSerialTransport.request(navigator); // must run inside this click
      await controller.connect(t);
    } catch (e) { say('Could not connect: ' + (e && e.message ? e.message : e)); }
  };
  // Tests and local development only: ?synthetic=1 on a non-production build starts the simulated flight controller.
  let connectMock;
  if (!import.meta.env.PROD && new URLSearchParams(location.search).get('synthetic') === '1') {
    const { benchFcTransport } = await import('../src/benchtest/mock-bench-fc.js');
    connectMock = async () => {
      say('');
      const t = benchFcTransport();
      if (fourwayEnabledFor('mock')) { const { attachFourWay } = await import('../src/fourway/mock-fourway-fc.js'); attachFourWay(t, { escCount: 4, channels: [{ kind: 'bluejay' }, { kind: 'bluejay' }, { kind: 'bluejay' }, { kind: 'bluejay' }], exit: 'ok', afterExit: { motorsDisabled: false } }); }
      await controller.connect(t);
    };
  }

  const ui = mountBench(root, { controller, onConnectReal: connectReal, onConnectMock: connectMock, realAvailable: hasWebSerial(), user: true, backHref: '../', notice: () => notice });
  installLifecycle(controller, { guardHistory: true, onBlockedNavigation: () => { notice = 'Going back is blocked while anything may be powered. Use Stop & zero, confirm the motors are still, then disconnect the battery.'; ui.render(); } });
  if (location.hash === '#history') setTimeout(() => { const h = document.getElementById('bt-sec-history'); if (h) h.scrollIntoView(); }, 0);
}
