/**
 * Edited captive plan persistence (this browser only). The plan is also exportable as JSON — the
 * way to share edits or make them the built-in plan (replace data/static-plan.json).
 */
const KEY = 'cn-dispatch.captive-plan.v1';

export function loadSavedPlan() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && v.plan && Array.isArray(v.plan.plan) ? v : null;
  } catch { return null; }
}

export function savePlan(plan) {
  try { localStorage.setItem(KEY, JSON.stringify({ savedAt: new Date().toISOString(), plan })); return true; } catch { return false; }
}

export function clearSavedPlan() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Validate an imported plan file; returns the plan or throws with a readable message. */
export function parsePlanFile(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('Not a JSON file.'); }
  const plan = j && j.plan && Array.isArray(j.plan.plan) ? j.plan : j; // accept {plan:{...}} or the plan itself
  if (!plan || !Array.isArray(plan.plan)) throw new Error('No "plan" list found — expected a static-plan.json export.');
  plan.plan.forEach((s, i) => {
    if (!s || typeof s.k !== 'string' || !s.station) throw new Error(`Location ${i + 1} is missing its key/station.`);
    if (!Array.isArray(s.trains)) throw new Error(`${s.station}: "trains" must be a list.`);
  });
  return plan;
}
