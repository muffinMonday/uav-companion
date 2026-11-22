// One history manager for every full-screen view and dialog the new shell opens (Review 01 S10.2, NAV-07). A `popstate` round trip
// closes the topmost entry without navigating the app away; entries close in LIFO order. Not yet wired to a live view in S10.2 (that
// scope has no new full-screen view of its own; those are content migrations, S10.3+) - built and tested so those stages can adopt it
// without inventing a second history mechanism. A separate, stricter navigation guard elsewhere in the app, used by an unrelated
// flagged feature, is untouched; this module is never used by it. `historyApi`/`win` are injectable so this is testable without a real browser history.
export function createHistoryStack({ historyApi = window.history, win = window } = {}) {
  const stack = []; // { id, close }
  let seq = 0;

  /** Registers an open view/dialog, pushing one history entry for it. `close` is called when the browser's Back closes this entry.
   * Returns { pop() } - call pop() when the view closes itself (Escape, a button, ...) so Back does not also try to close it again. */
  function push(close) {
    const id = ++seq;
    stack.push({ id, close });
    historyApi.pushState({ uavShell: id }, '');
    return { pop: () => popEntry(id) };
  }

  function popEntry(id) {
    const i = stack.findIndex((e) => e.id === id);
    if (i !== -1) stack.splice(i, 1);
  }

  function onPopState() {
    const top = stack[stack.length - 1];
    if (!top) return; // nothing we pushed is open here: let the browser's own navigation happen
    stack.pop();
    top.close();
  }

  win.addEventListener('popstate', onPopState);
  return {
    push,
    /** How many entries are currently open (for tests and diagnostics only). */
    depth: () => stack.length,
    destroy: () => win.removeEventListener('popstate', onPopState),
  };
}
