// Motor bench test: a privacy-safe flight-controller fingerprint.
// The flight controller's UID (MSP_UID) is a stable hardware identifier. It is read for the connection and used in memory to notice
// a different board after a reconnect, but it is never displayed, stored or exported. What may be shown and saved is this derived
// value: the first 12 hex digits of SHA-256 over a fixed label, the UID and the target name. It is a change-detection aid only (48
// bits, not a cryptographic identity of the hardware). When SubtleCrypto is unavailable the fingerprint is null, never a fallback
// that would expose or weakly encode the UID.
const LABEL = 'uavc-fc-fingerprint-v1';

export async function deriveFingerprint(uidHex, targetName, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  try {
    if (typeof uidHex !== 'string' || !/^[0-9a-fA-F]{2,64}$/.test(uidHex) || !subtle || typeof subtle.digest !== 'function') return null;
    const data = new TextEncoder().encode(`${LABEL}|${uidHex.toLowerCase()}|${String(targetName || '')}`);
    const digest = new Uint8Array(await subtle.digest('SHA-256', data));
    let hex = '';
    for (let i = 0; i < 6; i++) hex += digest[i].toString(16).padStart(2, '0');
    return hex;
  } catch { return null; }
}
