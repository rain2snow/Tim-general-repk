/**
 * Session handoff bundle: everything a dispatcher changed, in one versioned JSON file, so the
 * console can be handed between people / browsers / sessions.
 *
 *   {
 *     app: 'cn-locomotive-dispatch', kind: 'session', version: 1,
 *     exportedAt, by, note,
 *     settings:   { theme: 'light'|'dark', demandDay: 0-6|null },
 *     plan:       edited captive plan (incl. meta.base2home_overrides) | null = built-in plan,
 *     assignments:{ locoId: { k, note, at, from? } },          manual locomotive assignments
 *     deadheads:  { locoId: { to, eta, note, at } },          planned deadhead moves
 *     consists:   [{ id, name, k, job, units: [loco…], note }], consists (lead unit first)
 *     actionPlans:{ 'short:EDMONTON|AB': 'text', 'short:EDMONTON|AB:done': '1', ... },
 *     snapshot:   { meta, fleet } | null                         the analysed snapshot (lossless:
 *                                                              fleet records carry raw STP fields)
 *   }
 */
import { diffPlan } from './planEdit.js';
import { ACTION_KEY_RE } from './store.js';

export const SESSION_APP = 'cn-locomotive-dispatch';
export const SESSION_KIND = 'session';
export const SESSION_VERSION = 1;

export function buildBundle({ settings = {}, plan = null, assignments = {}, deadheads = {}, consists = [], actionPlans = {}, snapshot = null, by = '', note = '', now = new Date() }) {
  return {
    app: SESSION_APP, kind: SESSION_KIND, version: SESSION_VERSION,
    exportedAt: now.toISOString(), by: String(by || '').trim(), note: String(note || '').trim(),
    settings: { theme: settings.theme === 'dark' ? 'dark' : 'light', demandDay: Number.isInteger(settings.demandDay) ? settings.demandDay : null },
    plan: plan || null,
    assignments: { ...assignments },
    deadheads: { ...deadheads },
    consists: consists.map((c) => ({ ...c, units: [...c.units] })),
    actionPlans: Object.fromEntries(Object.entries(actionPlans).filter(([k, v]) => ACTION_KEY_RE.test(k) && v)),
    snapshot: snapshot ? { meta: snapshot.meta, fleet: snapshot.fleet } : null,
  };
}

/** Parse + validate a session file; throws an Error with a readable message. */
export function parseBundle(text) {
  let b;
  try { b = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('Not a JSON file.'); }
  if (!b || b.app !== SESSION_APP || b.kind !== SESSION_KIND) {
    if (b && Array.isArray(b.plan && b.plan.plan ? b.plan.plan : b.plan)) throw new Error('This is a captive-plan file — import it from the Captive Plan tab.');
    throw new Error('Not a dispatch session file.');
  }
  if (!(b.version >= 1)) throw new Error('Unknown session file version.');
  if (b.version > SESSION_VERSION) throw new Error(`This session file was made by a newer version of the console (v${b.version}).`);
  if (b.plan != null && !Array.isArray(b.plan.plan)) throw new Error('Session file: "plan" is malformed.');
  if (b.assignments != null && (typeof b.assignments !== 'object' || Array.isArray(b.assignments))) throw new Error('Session file: "assignments" is malformed.');
  if (b.snapshot != null && !(b.snapshot.meta && Array.isArray(b.snapshot.fleet))) throw new Error('Session file: "snapshot" is malformed.');
  if (b.consists != null && !(Array.isArray(b.consists) && b.consists.every((c) => c && c.id && c.k && Array.isArray(c.units)))) throw new Error('Session file: "consists" is malformed.');
  return {
    ...b,
    settings: b.settings || {},
    plan: b.plan || null,
    assignments: b.assignments || {},
    deadheads: b.deadheads && typeof b.deadheads === 'object' && !Array.isArray(b.deadheads) ? b.deadheads : {},
    consists: b.consists || [],
    actionPlans: Object.fromEntries(Object.entries(b.actionPlans || {}).filter(([k, v]) => ACTION_KEY_RE.test(k) && typeof v === 'string' && v)),
    snapshot: b.snapshot || null,
  };
}

/** Counts for the export / import preview. */
export function summarizeBundle(b, builtinPlan) {
  const keys = Object.keys(b.actionPlans || {});
  const planned = keys.filter((k) => !k.endsWith(':done')).length;
  const resolved = keys.filter((k) => k.endsWith(':done') && b.actionPlans[k] === '1').length;
  const planDiff = b.plan && builtinPlan ? diffPlan(builtinPlan, b.plan) : [];
  const overrides = b.plan && b.plan.meta && b.plan.meta.base2home_overrides ? Object.keys(b.plan.meta.base2home_overrides).length : 0;
  const lossless = !b.snapshot || b.snapshot.fleet.every((f) => f.stp);
  return {
    planLocations: planDiff.length, planDiff, trainRehomes: overrides,
    assignments: Object.keys(b.assignments || {}).length,
    deadheads: Object.keys(b.deadheads || {}).length,
    consists: (b.consists || []).length,
    actionPlans: planned, resolved,
    snapshotDate: b.snapshot ? b.snapshot.meta.snapshot : null, snapshotUnits: b.snapshot ? b.snapshot.fleet.length : 0, lossless,
    theme: (b.settings && b.settings.theme) || 'light', demandDay: b.settings ? b.settings.demandDay ?? null : null,
    by: b.by || '', note: b.note || '', exportedAt: b.exportedAt || '',
  };
}

/**
 * Combine an incoming bundle with the current state.
 *  replace: the incoming session wins wholesale (a clean handoff)
 *  merge:   assignments and action plans are unioned (incoming wins on conflict); the incoming
 *           plan / snapshot are taken only if the bundle has them, otherwise mine are kept
 */
export function combineSessions(mine, incoming, mode = 'replace') {
  if (mode === 'replace') {
    return { ...incoming, plan: incoming.plan, assignments: { ...incoming.assignments }, deadheads: { ...(incoming.deadheads || {}) },
      consists: (incoming.consists || []).map((c) => ({ ...c })), actionPlans: { ...incoming.actionPlans } };
  }
  return {
    ...incoming,
    settings: { ...mine.settings, ...incoming.settings },
    plan: incoming.plan || mine.plan,
    assignments: { ...mine.assignments, ...incoming.assignments },
    deadheads: { ...(mine.deadheads || {}), ...(incoming.deadheads || {}) },
    consists: mergeConsists(mine.consists || [], incoming.consists || []),
    actionPlans: { ...mine.actionPlans, ...incoming.actionPlans },
    snapshot: incoming.snapshot || null,
  };
}

/** Union of consists: incoming wins on the same id, and a unit stays in one consist (incoming's). */
function mergeConsists(mine, incoming) {
  const ids = new Set(incoming.map((c) => c.id)), taken = new Set(incoming.flatMap((c) => c.units));
  const kept = mine.filter((c) => !ids.has(c.id)).map((c) => ({ ...c, units: c.units.filter((l) => !taken.has(l)) })).filter((c) => c.units.length);
  return [...kept, ...incoming.map((c) => ({ ...c }))];
}
