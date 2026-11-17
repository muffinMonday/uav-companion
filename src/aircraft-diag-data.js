// Aircraft diagnostic data: the local store for DERIVED motor-diagnostic records (and, only on an explicit choice, the live
// samples behind them). It is separate from the generic Diagnostics log (log.js, logstore.js) and is deliberately NOT part of
// trip export, sharing or synchronization: nothing here is read by sync, share or export code, and no function here sends anything.
//
// Keys (shape change = version bump + docs/DATABASE.md note):
//   uavzones.aircraftdiag.v1          { v: 1, records: [record, ...] }            derived records, newest last
//   uavzones.aircraftdiag.samples.v1  { v: 1, sets: { [recordId]: evidence } }    opt-in live samples, off by default
// The Privacy panel (privacy-ui.js) shows the approximate size and deletes both keys. This module knows nothing about motors,
// the flight controller or the bench code, so the main app can depend on it without pulling any bench code into its bundle.
export const RECORDS_KEY = 'uavzones.aircraftdiag.v1';
export const SAMPLES_KEY = 'uavzones.aircraftdiag.samples.v1';
export const STORE_VERSION = 1;
export const LIMITS = Object.freeze({ maxRecords: 20, maxSampleSets: 2, maxBytes: 1500000 });

function pick(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; } catch { return null; } // even reading the property can throw when site data is blocked
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function readKey(st, key) {
  let text;
  try { text = st.getItem(key); } catch { return { ok: false, reason: 'unavailable' }; }
  if (text === null) return { ok: true, empty: true, value: null, bytes: 0 };
  try {
    const v = JSON.parse(text);
    if (!isObj(v) || v.v !== STORE_VERSION) return { ok: false, reason: 'unreadable', bytes: text.length };
    return { ok: true, value: v, bytes: text.length };
  } catch { return { ok: false, reason: 'unreadable', bytes: text.length }; }
}

// A record is accepted only if it is a plain object with the minimum fields; anything else is dropped on read (stored data is untrusted).
function validRecord(r) {
  return isObj(r) && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64 && r.schemaVersion === 1 && typeof r.savedAt === 'string'
    && isObj(r.result) && typeof r.result.category === 'string' && Array.isArray(r.motors);
}

export function listRecords(storage) {
  const st = pick(storage);
  if (!st) return { available: false, records: [], corrupt: false };
  const r = readKey(st, RECORDS_KEY);
  if (!r.ok) return { available: r.reason !== 'unavailable', records: [], corrupt: r.reason === 'unreadable' };
  const raw = r.value && Array.isArray(r.value.records) ? r.value.records : [];
  return { available: true, records: raw.filter(validRecord), corrupt: false };
}

// The newest saved record, or null (used by the dashboard card).
export function latestSaved(storage) {
  const { records } = listRecords(storage);
  return records.length ? records[records.length - 1] : null;
}

export function loadSampleSet(id, storage) {
  const st = pick(storage);
  if (!st) return null;
  const r = readKey(st, SAMPLES_KEY);
  if (!r.ok || !r.value || !isObj(r.value.sets)) return null;
  const s = r.value.sets[id];
  return isObj(s) ? s : null;
}

// Writes and reads back. Returns { ok, reason }. Never throws.
function writeKey(st, key, value) {
  const text = JSON.stringify(value);
  if (text.length > LIMITS.maxBytes) return { ok: false, reason: 'too-large' };
  try { st.setItem(key, text); return st.getItem(key) === text ? { ok: true } : { ok: false, reason: 'verify-failed' }; } catch { return { ok: false, reason: 'storage-failed' }; }
}

// record: a derived record (built by the aircraft check history module). sampleSet: the evidence export, or null (the default).
export function saveRecord(record, sampleSet = null, storage) {
  const st = pick(storage);
  if (!st) return { ok: false, reason: 'unavailable' };
  if (!validRecord(record)) return { ok: false, reason: 'invalid-record' };
  const cur = listRecords(st);
  if (!cur.available) return { ok: false, reason: 'unavailable' };
  const records = [...cur.records.filter((r) => r.id !== record.id), record].slice(-LIMITS.maxRecords);
  const kept = new Set(records.map((r) => r.id));
  if (sampleSet !== null) { // write the samples first: a failed sample write must not leave a record that claims samples are kept
    const s = readKey(st, SAMPLES_KEY);
    const sets = s.ok && s.value && isObj(s.value.sets) ? { ...s.value.sets } : {};
    delete sets[record.id]; sets[record.id] = sampleSet; // re-insert so it is the newest entry
    const ids = Object.keys(sets).filter((id) => kept.has(id));
    while (ids.length > LIMITS.maxSampleSets) { delete sets[ids.shift()]; }
    for (const id of Object.keys(sets)) if (!ids.includes(id)) delete sets[id];
    const w = writeKey(st, SAMPLES_KEY, { v: STORE_VERSION, sets });
    if (!w.ok) return { ok: false, reason: w.reason };
  }
  const w = writeKey(st, RECORDS_KEY, { v: STORE_VERSION, records });
  return w.ok ? { ok: true } : { ok: false, reason: w.reason };
}

// Approximate size of what is stored, in bytes (characters; the store is ASCII-dominated JSON).
export function approxSize(storage) {
  const st = pick(storage);
  if (!st) return { available: false, records: 0, recordBytes: 0, sampleBytes: 0, totalBytes: 0 };
  const a = readKey(st, RECORDS_KEY), b = readKey(st, SAMPLES_KEY);
  const recordBytes = a.bytes || 0, sampleBytes = b.bytes || 0;
  const records = a.ok && a.value && Array.isArray(a.value.records) ? a.value.records.filter(validRecord).length : 0;
  return { available: true, records, recordBytes, sampleBytes, totalBytes: recordBytes + sampleBytes };
}

// Deletes everything this module stores. True only when both keys are confirmed gone.
export function deleteAll(storage) {
  const st = pick(storage);
  if (!st) return false;
  try { st.removeItem(RECORDS_KEY); st.removeItem(SAMPLES_KEY); return st.getItem(RECORDS_KEY) === null && st.getItem(SAMPLES_KEY) === null; } catch { return false; }
}
export function deleteSamples(storage) {
  const st = pick(storage);
  if (!st) return false;
  try { st.removeItem(SAMPLES_KEY); return st.getItem(SAMPLES_KEY) === null; } catch { return false; }
}
