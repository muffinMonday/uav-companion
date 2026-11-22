// The new shell's history manager (src/shell/history.js, Review 01 S10.2, NAV-07). A fake history/window; no browser.
import { createHistoryStack } from '../src/shell/history.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };

function fakeEnv() {
  const listeners = [];
  const win = { addEventListener: (ev, fn) => { if (ev === 'popstate') listeners.push(fn); }, removeEventListener: (ev, fn) => { if (ev === 'popstate') { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); } } };
  const pushed = [];
  const historyApi = { pushState: (state) => pushed.push(state) };
  return { win, historyApi, pushed, fireBack: () => listeners.forEach((f) => f()) };
}

// push() pushes one history entry and tracks depth
{
  const { win, historyApi, pushed } = fakeEnv();
  const h = createHistoryStack({ historyApi, win });
  ok(h.depth() === 0, 'starts empty');
  let closed = 0;
  const entry = h.push(() => { closed++; });
  ok(h.depth() === 1 && pushed.length === 1 && pushed[0].uavShell === 1, 'push() adds one entry and pushes one history state');
  entry.pop();
  ok(h.depth() === 0, 'pop() (the view closing itself) removes the entry without calling close()');
  ok(closed === 0, 'close() is not called when the view closes itself first');
}

// A browser Back closes the topmost entry, LIFO, and does not call close() on entries beneath it
{
  const { win, historyApi, fireBack } = fakeEnv();
  const h = createHistoryStack({ historyApi, win });
  const closedOrder = [];
  h.push(() => closedOrder.push('first'));
  h.push(() => closedOrder.push('second'));
  ok(h.depth() === 2, 'two entries pushed');
  fireBack();
  ok(closedOrder.length === 1 && closedOrder[0] === 'second' && h.depth() === 1, 'Back closes only the topmost entry (LIFO), not the one beneath it');
  fireBack();
  ok(closedOrder.length === 2 && closedOrder[1] === 'first' && h.depth() === 0, 'a second Back closes the remaining entry');
}

// A Back with nothing open is a no-op (lets the browser navigate normally elsewhere)
{
  const { win, historyApi, fireBack } = fakeEnv();
  const h = createHistoryStack({ historyApi, win });
  let called = false;
  fireBack();
  ok(!called && h.depth() === 0, 'Back with an empty stack calls nothing and changes nothing');
}

// destroy() stops listening
{
  const { win, historyApi, fireBack } = fakeEnv();
  const h = createHistoryStack({ historyApi, win });
  let closed = 0;
  h.push(() => closed++);
  h.destroy();
  fireBack();
  ok(closed === 0, 'destroy() stops the popstate listener; a later Back does not close the still-registered entry');
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
