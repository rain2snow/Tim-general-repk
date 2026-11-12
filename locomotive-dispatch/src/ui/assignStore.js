/**
 * Manual locomotive assignments (this browser): { locoId: { k, note, at } }
 *   k = station key  -> the unit is assigned to that terminal (overrides its train-based home)
 *   k = ''           -> the unit is released: no home terminal and not counted anywhere
 *   from             -> terminal it was assigned / released at (so the popup there can undo it)
 */
const KEY = 'cn-dispatch.assignments.v1';

export function loadAssignments() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

export function saveAssignments(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); return true; } catch { return false; }
}

/** { loco: k } view used by analyze(). */
export const assignOption = (map) => Object.fromEntries(Object.entries(map || {}).map(([loco, v]) => [loco, v.k]));
