// Motor diagnostics lab: status-message rules for the read-only lab page (pure, no DOM).
// Bug fixed 2026-11-16: after the FC was unplugged and reconnected, the earlier "The connection closed (NetworkError)."
// message stayed on screen beside a successful read, because only `error` was cleared when a new read started.
// Rules: a new read clears both the error and any earlier transport message; a close event from a transport that is not
// the current one is ignored (a late event from the old port must not overwrite the new session's status).

export function beginRead(S) {
  S.reading = true; S.error = null; S.message = '';
}

export function finishReadOk(S) {
  S.reading = false; S.error = null; S.message = '';
}

export function finishReadFailed(S, text) {
  S.reading = false; S.error = text;
}

// Returns true when the close belongs to the current transport and the status changed.
export function transportClosed(S, transport, reason) {
  if (S.transport !== transport) return false;
  S.message = 'The connection closed (' + reason + ').';
  return true;
}

export function statusText(S) {
  return S.error || (S.reading ? 'Reading the flight controller...' : S.message || (S.snapshot ? 'Read complete (read-only).' : 'Not connected.'));
}
