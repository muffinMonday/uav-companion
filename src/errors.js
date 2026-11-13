// Global error handlers: an uncaught exception or an unhandled promise rejection leaves a note in the local log (log.js).
//
// They only observe. They are added with addEventListener (window.onerror is never replaced), they never call preventDefault or stop propagation, so the browser
// console and any other listener behave as before, and they pass mirror:false because the browser has already reported the error itself. An error that code already
// logged and then rethrew (log.seen) is skipped; identical errors within a minute are counted by the logger instead of repeated.

const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i];
const ignored = (m) => IGNORED.some((re) => re.test(String(m || '')));

export function installErrorHandlers({ target = globalThis, log }) {
  let busy = false;
  const guard = (fn) => (ev) => {
    if (busy) return;
    busy = true;
    try { fn(ev); } catch { /* the handler must never raise */ } finally { busy = false; }
  };

  const onError = guard((ev) => {
    if (ev && ev.target && ev.target !== target) return; // a failed image, script or stylesheet load, not an exception
    const err = ev?.error instanceof Error ? ev.error : null;
    if (ignored(ev?.message) || (err && log.seen(err))) return;
    const where = ev?.filename ? ' (' + String(ev.filename).split(/[?#]/)[0].split('/').pop() + ':' + (ev.lineno || 0) + ')' : '';
    if (err) log.error('window', 'uncaught error', err, { mirror: false });
    else log.error('window', 'uncaught error: ' + String(ev?.message || 'unknown') + where, { kind: 'error' }, { mirror: false });
  });

  const onRejection = guard((ev) => {
    const r = ev?.reason;
    if (r instanceof Error) {
      if (ignored(r.message) || log.seen(r)) return;
      log.error('window', 'unhandled rejection', r, { mirror: false });
    } else {
      log.error('window', 'unhandled rejection: ' + (typeof r === 'string' ? r : 'non-error value'), { kind: 'rejection' }, { mirror: false });
    }
  });

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => { target.removeEventListener('error', onError); target.removeEventListener('unhandledrejection', onRejection); };
}
