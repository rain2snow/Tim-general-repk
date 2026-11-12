/**
 * Captive-plan editing.
 *
 * Plan model (data/static-plan.json, verified on all 132 plan locations):
 *   - a location's trains/jobs are the source: train.req = sum of its type counts
 *   - required   = sum of train.req;  req_detail = the trains' type counts aggregated
 *   - rbd[day]   = day-of-week requirement (Sun..Sat); the busiest day equals `required`
 *   - captive_jobs is an independent count from the source plan
 *   - shared_in  = jobs counted at another (primary) terminal — read-only here
 *
 * Train -> home mapping: units on a train are homed by its train base (the train ID minus its
 * last character, e.g. L580311 -> L58031). Edits record re-homing in
 * plan.meta.base2home_overrides ({ base: stationKey | null }), which analyze() applies, so an
 * exported plan carries its own mapping.
 */

export const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const PLAN_REGIONS = ['East', 'West', 'South'];

export const clonePlan = (plan) => JSON.parse(JSON.stringify(plan));

/** Train base used for homing, or null for placeholder jobs (HUMP0, SPARE0, ...). */
export function trainBaseOf(id) {
  const s = String(id || '').trim().toUpperCase();
  return /^[A-Z]{1,3}\d{4,6}$/.test(s) ? s.slice(0, -1) : null;
}

/** Every counted type used anywhere in the plan (plus the standard families). */
export function planTypes(plan) {
  const set = new Set(['GP9/GP38', 'GP9/GP38 LCS', 'GP40', 'SD38', 'SD40', 'SD40 LCS', 'SD60', 'SD60 LCS']);
  plan.plan.forEach((s) => (s.trains || []).forEach((t) => (t.types || []).forEach(([ty]) => set.add(ty))));
  return [...set].sort();
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

/**
 * Recompute a location's derived fields after its trains changed.
 * Day-of-week values move with the requirement (each day shifted by the same delta, clamped to
 * 0..required), so the busiest day keeps matching the peak.
 */
export function normalizeStation(st, prevRequired = st.required) {
  const trains = (st.trains || []).map((t) => {
    const types = (t.types || []).filter(([ty, n]) => ty && n > 0).map(([ty, n]) => [ty, clampInt(n, 0, 99)]);
    return { ...t, ids: (t.ids || []).map((x) => String(x).trim()).filter(Boolean), types, req: types.reduce((a, [, n]) => a + n, 0), shared: t.shared || [] };
  });
  const required = trains.reduce((a, t) => a + t.req, 0);
  const agg = {};
  trains.forEach((t) => t.types.forEach(([ty, n]) => { agg[ty] = (agg[ty] || 0) + n; }));
  // count desc; ties keep first-appearance order (stable sort), matching the source plan
  const req_detail = Object.entries(agg).sort((a, b) => b[1] - a[1]);
  const delta = required - (prevRequired || 0);
  const base = Array.isArray(st.rbd) && st.rbd.length === 7 ? st.rbd : Array(7).fill(prevRequired || 0);
  const rbd = base.map((v) => clampInt(v + delta, 0, required));
  return { ...st, trains, required, req_detail, rbd, captive_jobs: clampInt(st.captive_jobs, 0, 999) };
}

/** Set one day's requirement (0..required). */
export function setDay(st, day, value) {
  const rbd = (st.rbd && st.rbd.length === 7 ? st.rbd : Array(7).fill(st.required)).slice();
  rbd[day] = clampInt(value, 0, st.required);
  return { ...st, rbd };
}

export function newStation({ station, state, lat, lng, region = '', zone = '' }) {
  const s = String(station || '').trim().toUpperCase(), st = String(state || '').trim().toUpperCase();
  return { k: `${s}|${st}`, station: s, state: st, zone: String(zone || '').toUpperCase(), region, captive_jobs: 0, required: 0,
    req_detail: [], shared_in: [], lat: lat === '' || lat == null ? null : Number(lat), lng: lng === '' || lng == null ? null : Number(lng),
    trains: [], rbd: Array(7).fill(0), added: true };
}

/** Fields that define a location for comparison purposes. */
const SIG_FIELDS = ['station', 'state', 'zone', 'region', 'captive_jobs', 'required', 'req_detail', 'rbd', 'trains', 'lat', 'lng'];
export const stationSig = (s) => JSON.stringify(SIG_FIELDS.map((f) => s[f] ?? null));

/** Locations added / changed / removed between two plans. */
export function diffPlan(base, edited) {
  const b = Object.fromEntries(base.plan.map((s) => [s.k, s]));
  const e = Object.fromEntries(edited.plan.map((s) => [s.k, s]));
  const out = [];
  edited.plan.forEach((s) => {
    if (!b[s.k]) out.push({ k: s.k, station: s.station, kind: 'added' });
    else if (stationSig(s) !== stationSig(b[s.k])) {
      const o = b[s.k];
      const fields = SIG_FIELDS.filter((f) => JSON.stringify(s[f] ?? null) !== JSON.stringify(o[f] ?? null));
      out.push({ k: s.k, station: s.station, kind: 'changed', fields, required: [o.required, s.required] });
    }
  });
  base.plan.forEach((s) => { if (!e[s.k]) out.push({ k: s.k, station: s.station, kind: 'removed' }); });
  return out;
}

/** Effective train-base -> home map: built-in map with the plan's overrides applied. */
export function effectiveBase2Home(base2home, plan) {
  const ov = (plan && plan.meta && plan.meta.base2home_overrides) || {};
  if (!Object.keys(ov).length) return base2home;
  const out = { ...base2home };
  for (const [base, k] of Object.entries(ov)) { if (k) out[base] = k; else delete out[base]; }
  return out;
}

/**
 * Record re-homing for a location's train-ID edits into plan.meta.base2home_overrides.
 * `plan` must already contain the edit (its trains hold `newIds`), so a base still used by
 * another job at the location is not released.
 *  - an added ID homes its train base at this location
 *  - a removed ID releases its base if it was homed here and no other plan job uses that base
 */
export function updateOverrides(plan, base2home, key, oldIds, newIds) {
  const meta = { ...(plan.meta || {}) };
  const ov = { ...(meta.base2home_overrides || {}) };
  const eff = effectiveBase2Home(base2home, plan);
  const stillUsed = new Set();
  plan.plan.forEach((s) => (s.trains || []).forEach((t) => t.ids.forEach((id) => { const b = trainBaseOf(id); if (b) stillUsed.add(b + '@' + s.k); })));
  const oldB = new Set(oldIds.map(trainBaseOf).filter(Boolean)), newB = new Set(newIds.map(trainBaseOf).filter(Boolean));
  newB.forEach((b) => { if (eff[b] !== key) ov[b] = key; });
  oldB.forEach((b) => {
    if (newB.has(b) || stillUsed.has(b + '@' + key)) return;
    if (eff[b] === key) { if (base2home[b] === key) ov[b] = null; else delete ov[b]; }
  });
  // drop no-op overrides
  for (const [b, k] of Object.entries(ov)) if ((k === null && !(b in base2home)) || (k !== null && base2home[b] === k)) delete ov[b];
  meta.base2home_overrides = ov;
  return { ...plan, meta };
}

/** Warnings for a location (shown in the editor; they never block saving). */
export function stationWarnings(st, plan) {
  const w = [];
  const max = Math.max(...(st.rbd || [0]));
  if (max !== st.required) w.push(`Busiest day is ${max}, but the requirement is ${st.required} — usually the busiest day equals the requirement.`);
  if (st.lat == null || st.lng == null) w.push('No map coordinates — the location will not appear on the map.');
  const others = {};
  plan.plan.forEach((s) => { if (s.k !== st.k) (s.trains || []).forEach((t) => t.ids.forEach((id) => { others[id.toUpperCase()] = s.station; })); });
  (st.trains || []).forEach((t, i) => {
    if (!t.ids.length) w.push(`Job ${i + 1} has no train IDs.`);
    if (!t.types.length) w.push(`Job ${i + 1} has no unit types, so it requires nothing.`);
    t.ids.forEach((id) => { if (others[id.toUpperCase()]) w.push(`${id} is also a job at ${others[id.toUpperCase()]}.`); });
  });
  return w;
}
