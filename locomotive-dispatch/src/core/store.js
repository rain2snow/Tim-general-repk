/**
 * Persistent store for dispatcher plans ("Your solution" text + resolved flag), keyed by action id.
 * Backed by localStorage when available, with an in-memory fallback (private mode / blocked storage).
 */
export function createActionStore(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const mem = {};
  const read = (k) => { try { return storage ? storage.getItem(k) : null; } catch { return null; } };
  const write = (k, v) => { try { storage && storage.setItem(k, v); } catch { /* ignore */ } };
  return {
    get(k) { const v = read(k); return v != null ? v : k in mem ? mem[k] : null; },
    set(k, v) { mem[k] = v; write(k, v); },
  };
}

/** Action id builders — the persisted keys; keep stable so saved plans survive upgrades. */
export const actionId = {
  dead: (loco) => 'dead:' + loco,
  short: (stationKey) => 'short:' + stationKey,
  insp: (loco, stationKey) => 'insp:' + loco + '@' + stationKey,
  retask: (loco, stationKey) => 'retask:' + loco + '@' + stationKey,
};

/** '' | 'planned' | 'done' for one action. */
export function planState(store, id) {
  try {
    if (store.get(id + ':done') === '1') return 'done';
    const v = store.get(id);
    if (v && String(v).trim()) return 'planned';
  } catch { /* ignore */ }
  return '';
}

/** Aggregate plan state of every action attached to a station. */
export function stationPlanState(store, s, retask = []) {
  if (!s) return '';
  const ids = [actionId.short(s.k)];
  (s.insp || []).forEach((u) => ids.push(actionId.insp(u.loco, s.k)));
  retask.forEach((c) => { if (c.s.k === s.k) ids.push(actionId.retask(c.u.loco, s.k)); });
  let any = '', done = true;
  ids.forEach((id) => { const ps = planState(store, id); if (ps) { any = 'planned'; if (ps !== 'done') done = false; } });
  return any ? (done ? 'done' : 'planned') : '';
}
