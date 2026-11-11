import { STATE_FIX } from './constants.js';

/** Station key from an STP location string: "SENNETERR  QC" -> "SENNETERR|PQ". */
export function keyOf(loc) {
  loc = loc || '';
  let state = loc.slice(-2).trim();
  const station = loc.slice(0, -2).trim();
  state = STATE_FIX[state] || state;
  return station.toUpperCase() + '|' + state;
}

/** Station key from a display name: "SENNETERR, PQ" -> "SENNETERR|PQ". */
export function keyName(name) {
  const i = name.lastIndexOf(',');
  if (i < 0) return name.trim().toUpperCase();
  const n = name.slice(0, i).trim().toUpperCase(), s = name.slice(i + 1).trim();
  return n + '|' + (STATE_FIX[s] || s);
}

/** Train base id: "L550311-15" -> "L550311". */
export const trainBase = (x) => (x || '').split('-')[0].trim();

/** Station name portion of a key. */
export const stationOfKey = (k) => String(k).split('|')[0];
