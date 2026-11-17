// Motor bench test (Phase 3) lab page. Developer-only, unlinked, behind the build-time flag VITE_BENCH_PHASE3 (default off).
// Default mode is the synthetic flight controller. Real hardware stays locked until the session unlock and the state machine's gates.
// Run locally:  VITE_BENCH_PHASE3=1 npm run dev   then open /tools/motor-bench-lab/   (PowerShell: $env:VITE_BENCH_PHASE3='1'; npm run dev)
import '../../src/styles.css'; // the main app's own stylesheet
import '../../src/preflight/ui-parts.css';
import { applyTheme } from '../../src/theme.js';
import { benchEnabled, fourwayEnabledFor } from '../../src/benchtest/flag.js';
import { installLifecycle } from '../../src/benchtest/lifecycle.js';

applyTheme();
const root = document.getElementById('bench');
const status = document.getElementById('bench-status');

if (!benchEnabled()) {
  const p = document.createElement('p');
  p.className = 'dg-disabled'; p.dataset.disabled = 'true';
  p.textContent = 'Disabled. This page is behind the build-time flag VITE_BENCH_PHASE3, which is off.';
  root.append(p);
} else {
  const [{ createBenchController }, { mountBench }, { benchFcTransport }, { WebSerialTransport, hasWebSerial }, { STATE }] = await Promise.all([
    import('../../src/benchtest/controller.js'), import('../../src/benchtest/bench-ui.js'), import('../../src/benchtest/mock-bench-fc.js'),
    import('../../src/preflight/transport.js'), import('../../src/benchtest/state-machine.js'),
  ]);
  const controller = createBenchController();
  let mock = null;
  const say = (t) => { status.textContent = t || ''; };

  // Synthetic ESC scan scenarios (practice mode only, and only in a build whose VITE_BENCH_FOURWAY allows the step for synthetic connections)
  const four = (kinds, exit = 'ok', motorsDisabled = false) => ({ channels: kinds.map((kind) => ({ kind })), exit, afterExit: { motorsDisabled } });
  const SCENARIOS = {
    success: four(['bluejay', 'bluejay', 'bluejay', 'bluejay']),
    'one-unavailable': four(['bluejay', 'silent', 'bluejay', 'bluejay']),
    'all-unavailable': four(['silent', 'silent', 'silent', 'silent']),
    'mixed-firmware': four(['bluejay', 'am32', 'bluejay', 'bluejay']),
    'exit-fails': four(['bluejay', 'bluejay', 'bluejay', 'bluejay'], 'never'),
    'motors-stay-off': four(['bluejay', 'bluejay', 'bluejay', 'bluejay'], 'ok', true),
  };
  let scenarioSelect = null;
  if (fourwayEnabledFor('mock')) {
    const f = document.createElement('label'); f.className = 'field'; const cap = document.createElement('span'); cap.textContent = 'Synthetic ESC scan scenario (practice mode)'; f.append(cap);
    scenarioSelect = document.createElement('select'); scenarioSelect.id = 'fw-scenario';
    for (const k of Object.keys(SCENARIOS)) { const o = document.createElement('option'); o.value = k; o.textContent = k; scenarioSelect.append(o); }
    f.append(scenarioSelect); status.before(f);
  }
  const connectMock = async () => {
    say('');
    mock = benchFcTransport();
    if (scenarioSelect) { const { attachFourWay } = await import('../../src/fourway/mock-fourway-fc.js'); attachFourWay(mock, { escCount: 4, ...SCENARIOS[scenarioSelect.value] }); }
    await controller.connect(mock);
  };
  const connectReal = async () => {
    say('');
    try {
      const t = await WebSerialTransport.request(navigator); // must run inside this click
      await controller.connect(t);
    } catch (e) { say('Could not connect: ' + (e && e.message ? e.message : e)); }
  };
  // Synthetic fault injection (the simulated flight controller only).
  const inject = (key) => {
    if (!mock) return;
    const sel = controller.view().caps.selectedMotor;
    if (key === 'disconnect') mock.disconnect('NetworkError (simulated)');
    else if (key === 'peerRpm') mock.fc.inject.extraRpm = { index: ((sel ?? 0) + 1) % 4, rpm: 300 };
    else if (key === 'telemetry') mock.fc.inject.telemetrySilent = true;
    else if (key === 'armed') mock.fc.inject.armed = true;
  };

  mountBench(root, { controller, onConnectMock: connectMock, onConnectReal: connectReal, realAvailable: hasWebSerial(), inject });

  installLifecycle(controller);
}
