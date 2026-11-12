/**
 * A snapshot that came from an STP upload or a session import is kept in this browser, so it
 * survives a reload (otherwise the console falls back to the built-in snapshot). Stored losslessly
 * as { meta, fleet } — fleet records carry the raw STP fields (rowsFromFleet rebuilds the export).
 */
const KEY = 'cn-dispatch.snapshot.v1';

export function loadSavedSnapshot() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && v.meta && Array.isArray(v.fleet) ? v : null;
  } catch { return null; }
}

/** @returns true when saved (false e.g. when the browser's storage quota is exceeded) */
export function saveSnapshot(data, source) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ source, savedAt: new Date().toISOString(), meta: data.meta, fleet: data.fleet }));
    return true;
  } catch { return false; }
}

export function clearSavedSnapshot() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
