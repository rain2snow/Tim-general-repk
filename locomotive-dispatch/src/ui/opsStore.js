/**
 * Dispatcher operations saved in this browser:
 *   deadheads: { locoId: { to, eta, note, at } }          planned moves (unit counts at `to`)
 *   consists:  [{ id, name, k, job, units: [locoId…], note, at }]   lead unit first
 *   swaps:     [{ id, hub, point, base, toHub: [locoId…], toPoint: [locoId…], eta, note, at }]  (core/swaps.js)
 */
const DH_KEY = 'cn-dispatch.deadheads.v1';
const CS_KEY = 'cn-dispatch.consists.v1';
const SW_KEY = 'cn-dispatch.swaps.v1';

import { normalizeSwap } from '../core/swaps.js';

const read = (key, fallback, ok) => {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return ok(v) ? v : fallback; } catch { return fallback; }
};
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };

export const loadDeadheads = () => read(DH_KEY, {}, (v) => v && typeof v === 'object' && !Array.isArray(v));
export const saveDeadheads = (m) => write(DH_KEY, m);
export const loadConsists = () => read(CS_KEY, [], (v) => Array.isArray(v));
export const saveConsists = (a) => write(CS_KEY, a);
export const loadSwaps = () => read(SW_KEY, [], (v) => Array.isArray(v)).map(normalizeSwap);
export const saveSwaps = (a) => write(SW_KEY, a);

/** Next free consist id (C1, C2, …). */
export function nextConsistId(consists) {
  const n = consists.reduce((m, c) => Math.max(m, +(String(c.id).match(/^C(\d+)$/) || [0, 0])[1]), 0);
  return 'C' + (n + 1);
}
