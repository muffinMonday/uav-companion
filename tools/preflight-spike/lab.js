// Motor diagnostics lab page (Phase 2): the Phase 1 harness plus the read-only readiness view.
// Behind the same build-time flag (default off); not a Vite entry, so not in `dist`. See spike.js for how to run it.
import '../../src/styles.css'; // the app's own stylesheet; the readiness view is made of the shared production parts
import '../../src/preflight/ui-parts.css';
import { mountSpike } from './spike.js';
import { preflightEnabled } from '../../src/preflight/flag.js';

const root = document.getElementById('lab');
const readyRoot = document.createElement('div');
readyRoot.id = 'lab-readiness';
const spikeRoot = document.createElement('div');
root.append(readyRoot, spikeRoot);

let S = null;
const attestations = {};
if (preflightEnabled()) {
  const { evaluateReadiness } = await import('../../src/preflight/readiness.js');
  const { renderReadiness, viewState } = await import('../../src/preflight/readiness-ui.js');
  const draw = (state) => {
    const report = state && state.snapshot ? evaluateReadiness({ snapshot: state.snapshot, attestations, transportKind: state.transport ? state.transport.kind : 'unknown' }) : null;
    renderReadiness(readyRoot, {
      state: viewState({ connected: !!(state && state.snapshot), reading: !!(state && state.reading), error: state && state.error, report }),
      report, attestations, message: state && (state.error || state.message),
      onAttest: (p) => { Object.assign(attestations, p); for (const k of Object.keys(attestations)) if (attestations[k] === undefined) delete attestations[k]; draw(S); },
    });
  };
  S = await mountSpike(spikeRoot, { onState: (st) => { S = st; draw(st); } });
  draw(S);
} else {
  await mountSpike(spikeRoot);
}
