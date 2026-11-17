// Motor bench test (Phase 3) lab page. Developer-only, unlinked, behind the build-time flag VITE_BENCH_PHASE3 (default off).
// Default mode is the synthetic flight controller. Real hardware stays locked until the session unlock and the state machine's gates.
// Run locally:  VITE_BENCH_PHASE3=1 npm run dev   then open /tools/motor-bench-lab/   (PowerShell: $env:VITE_BENCH_PHASE3='1'; npm run dev)
import '../../src/benchtest/bench.css';
import { benchEnabled } from '../../src/benchtest/flag.js';
import { installLifecycle } from '../../src/benchtest/lifecycle.js';

const root = document.getElementById('bench');
const status = document.getElementById('bench-status');

if (!benchEnabled()) {
  const p = document.createElement('p');
  p.className = 'disabled-note'; p.dataset.disabled = 'true';
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

  const connectMock = async () => {
    say('');
    mock = benchFcTransport();
    const r = await controller.connect(mock);
    if (r && r.ok !== false && controller.machine.state === STATE.READ_ONLY_READINESS) controller.setManual({ escFamily: 'Bluejay', escModel: 'synthetic' });
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
