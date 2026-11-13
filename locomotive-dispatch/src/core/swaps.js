/**
 * Hub-and-spoke swap plans. A swap exchanges units between a spoke terminal and its hub's shop
 * terminal: units due for inspection (or otherwise wanted at the shop) go spoke -> hub, and fit
 * replacements go hub -> spoke, so the spoke keeps its power while the shop gets the work.
 *
 *   { id: 'W1', hub: 'TOR', spoke: 'BRANTFORD|ON', base: 'TORMACYAR|ON',
 *     toHub: [locoId…], toSpoke: [locoId…], eta, note, at }
 *
 * A plan acts through the deadhead mechanism (see swapDeadheads): each unit is a planned move to
 * the other end, tagged with the plan id. DOM-free.
 */
import { haversineKm } from './geo.js';
import { parseDate, dayDiff } from './dates.js';
import { actionFamily, approxHp } from './families.js';
import { SLUG_MODELS, INSPECTION_WINDOW_DAYS } from './constants.js';

/** A replacement should not itself come due for inspection within this many days. */
export const SWAP_FIT_DAYS = 7;
const TERMINAL_RADIUS_KM = 60;

/** Next free swap-plan id (W1, W2, …). */
export function nextSwapId(swaps) {
  const n = (swaps || []).reduce((m, s) => Math.max(m, +(String(s.id).match(/^W(\d+)$/) || [0, 0])[1]), 0);
  return 'W' + (n + 1);
}

/**
 * Terminals where a hub's shop(s) sit: per shop, the nearest station with a captive requirement
 * within 60 km (the yard the shop works from), else the nearest station. Unique, shop order.
 */
export function hubTerminals(hub, stations) {
  const located = stations.filter((s) => s.lat != null);
  const out = [];
  (hub.shopObjs || []).forEach((sh) => {
    const byDist = located.map((s) => ({ s, d: haversineKm([sh.lat, sh.lng], [s.lat, s.lng]) })).sort((a, b) => a.d - b.d);
    const pick = byDist.find((x) => x.s.required > 0 && x.d <= TERMINAL_RADIUS_KM) || byDist[0];
    if (pick && !out.includes(pick.s.k)) out.push(pick.s.k);
  });
  return out;
}

/** Expand swap plans into planned deadheads { loco: { to, eta, note, swap, at } }. */
export function swapDeadheads(swaps) {
  const out = {};
  (swaps || []).forEach((w) => {
    const base = { eta: w.eta || '', note: w.note || `swap ${w.id}`, swap: w.id, at: w.at || '' };
    (w.toHub || []).forEach((l) => { out[l] = { ...base, to: w.base }; });
    (w.toSpoke || []).forEach((l) => { out[l] = { ...base, to: w.spoke }; });
  });
  return out;
}

/** Days until a unit's inspection is due (negative = overdue), from its raw STP record; null if unknown. */
export function inspectionDays(f, now) {
  const d = f && f.stp ? parseDate(f.stp.id) : null;
  return d && now ? dayDiff(d, now) : null;
}

/** Snapshot date of the analysed data as a local Date. */
export function snapshotNow(data) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((data.meta && data.meta.snapshot) || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

const isSlug = (f) => SLUG_MODELS.has(String(f.model || '').toUpperCase()) || /^(YBU|HBU)/.test(String(f.model || ''));
/** Would this unit count toward a terminal's on-hand (Available, low/mid HP, not a slug)? */
export const countable = (f) => !!f && f.desig === 'Available' && !f.hhp && !isSlug(f);

/** Units already committed elsewhere by the dispatcher (other swaps, deadheads, consists). */
export function committedUnits({ swaps = [], deadheads = {}, consists = [] } = {}, exceptSwapId = null) {
  const set = new Set(Object.keys(deadheads).filter((l) => !deadheads[l].swap));
  swaps.filter((w) => w.id !== exceptSwapId).forEach((w) => [...(w.toHub || []), ...(w.toSpoke || [])].forEach((l) => set.add(l)));
  consists.forEach((c) => c.units.forEach((l) => set.add(l)));
  return set;
}

/**
 * Candidates for each side of a swap between `spokeKey` and `baseKey`.
 *  toHub:   units physically at the spoke, those due/overdue for inspection first, then other
 *           Available units (which could go to the shop for other work)
 *  toSpoke: countable units physically at the hub terminal whose inspection is not due within
 *           SWAP_FIT_DAYS, ranked by family match with the spoke's outgoing units / requirement,
 *           then by how long until their inspection
 * Each entry: { loco, model, fam, op, desig, inspDays, due, counted, committed }.
 */
export function swapCandidates(data, spokeKey, baseKey, { committed = new Set(), wantFams = [] } = {}) {
  const now = snapshotNow(data);
  const view = (f) => {
    const d = inspectionDays(f, now);
    return { loco: f.loco, model: f.model, fam: actionFamily(f.model), op: f.op, desig: f.desig, inspDays: d,
      due: d != null && d <= INSPECTION_WINDOW_DAYS, counted: countable(f), committed: committed.has(f.loco) };
  };
  const at = (k) => (data.fleet || []).filter((f) => f.k === k && !f.hhp && !f.dhTo);
  const toHub = at(spokeKey).map(view).sort((a, b) =>
    (b.due - a.due) || ((a.inspDays ?? 1e9) - (b.inspDays ?? 1e9)) || (b.counted - a.counted) || a.loco.localeCompare(b.loco));
  const spoke = (data.stations || []).find((s) => s.k === spokeKey);
  const reqFams = spoke && spoke.req_detail ? spoke.req_detail.map((r) => String(r[0]).replace(/ LCS$/, '')) : [];
  const fams = [...wantFams, ...reqFams];
  const rank = (fam) => { const i = fams.indexOf(fam); return i < 0 ? 99 : i; };
  const toSpoke = at(baseKey).map(view)
    .filter((u) => u.counted && (u.inspDays == null || u.inspDays > SWAP_FIT_DAYS))
    .sort((a, b) => (a.committed - b.committed) || (rank(a.fam) - rank(b.fam)) || ((b.inspDays ?? 0) - (a.inspDays ?? 0)) || a.loco.localeCompare(b.loco));
  return { toHub, toSpoke };
}

/**
 * Suggested swap for a spoke: send every unit due for inspection there to the hub terminal and
 * bring back the same number of fit units (same family where possible), skipping units the
 * dispatcher has already committed. `only` limits the outgoing side to given units.
 */
export function suggestSwap(data, hub, spokeKey, { baseKey, ops = {}, only = null, exceptSwapId = null } = {}) {
  const base = baseKey || hubTerminals(hub, data.stations)[0];
  if (!base || base === spokeKey) return { hub: hub.id, spoke: spokeKey, base, toHub: [], toSpoke: [], unmatched: 0 };   // already at the shop
  const committed = committedUnits(ops, exceptSwapId);
  const out = swapCandidates(data, spokeKey, base, { committed }).toHub
    .filter((u) => !u.committed && (only ? only.includes(u.loco) : u.due));
  const { toSpoke } = swapCandidates(data, spokeKey, base, { committed, wantFams: out.map((u) => u.fam).filter(Boolean) });
  const pool = toSpoke.filter((u) => !u.committed);
  const back = [];
  out.forEach((u) => {
    if (!u.counted) return;            // a unit that does not count needs no replacement
    const i = pool.findIndex((c) => c.fam === u.fam);
    const pick = pool.splice(i >= 0 ? i : 0, pool.length ? 1 : 0)[0];
    if (pick) back.push(pick.loco);
  });
  return { hub: hub.id, spoke: spokeKey, base, toHub: out.map((u) => u.loco), toSpoke: back,
    unmatched: out.filter((u) => u.counted).length - back.length };
}

/**
 * Summary of a plan against the analysed data (which already includes the plan's moves):
 * units with where they are, warnings, and the effect on the spoke's count.
 */
export function swapSummary(w, data) {
  const byLoco = Object.fromEntries((data.fleet || []).map((f) => [f.loco, f]));
  const now = snapshotNow(data);
  const unit = (l, from) => {
    const f = byLoco[l];
    if (!f) return { loco: l, missing: true };
    const d = inspectionDays(f, now);
    return { loco: l, model: f.model, fam: actionFamily(f.model), op: f.op, desig: f.desig, at: f.k, loc: f.loc,
      here: f.k === from, counted: countable(f), inspDays: d, hp: approxHp(f.model) };
  };
  const toHub = (w.toHub || []).map((l) => unit(l, w.spoke));
  const toSpoke = (w.toSpoke || []).map((l) => unit(l, w.base));
  const net = toSpoke.filter((u) => u.counted).length - toHub.filter((u) => u.counted).length;
  const warnings = [];
  const missing = [...toHub, ...toSpoke].filter((u) => u.missing).map((u) => u.loco);
  if (missing.length) warnings.push(`Not in this snapshot: ${missing.join(', ')}`);
  const nameOf = (k) => String(k).split('|')[0];
  const away = (list, k) => list.filter((u) => !u.missing && !u.here).map((u) => `${u.loco} (at ${nameOf(u.at)})`);
  const a1 = away(toHub, w.spoke), a2 = away(toSpoke, w.base);
  if (a1.length) warnings.push(`Not at ${nameOf(w.spoke)}: ${a1.join(', ')}`);
  if (a2.length) warnings.push(`Not at ${nameOf(w.base)}: ${a2.join(', ')}`);
  const unfit = toSpoke.filter((u) => !u.missing && (!u.counted || (u.inspDays != null && u.inspDays <= SWAP_FIT_DAYS)))
    .map((u) => `${u.loco} (${!u.counted ? u.op + ' · ' + u.desig : 'inspection in ' + u.inspDays + 'd'})`);
  if (unfit.length) warnings.push(`Replacement not fit: ${unfit.join(', ')}`);
  if (net < 0) warnings.push(`${nameOf(w.spoke)} loses ${-net} counted unit${net === -1 ? '' : 's'} — add a replacement`);
  const famOut = toHub.filter((u) => u.counted && u.fam).map((u) => u.fam).sort().join(',');
  const famIn = toSpoke.filter((u) => u.counted && u.fam).map((u) => u.fam).sort().join(',');
  if (net === 0 && famOut && famIn && famOut !== famIn) warnings.push('Families differ — check the spoke’s jobs can use the replacements');
  if (!toHub.length && !toSpoke.length) warnings.push('No units in this plan');
  return { ...w, toHubUnits: toHub, toSpokeUnits: toSpoke, net, warnings,
    hpOut: toHub.reduce((a, u) => a + (u.hp || 0), 0), hpIn: toSpoke.reduce((a, u) => a + (u.hp || 0), 0) };
}

/** Index plans by the spoke + base terminals and by loco, for popups and the queue. */
export function indexSwaps(swaps) {
  const byStation = {}, byLoco = {};
  (swaps || []).forEach((w) => {
    [w.spoke, w.base].forEach((k) => { (byStation[k] = byStation[k] || []).includes(w) || byStation[k].push(w); });
    [...(w.toHub || []), ...(w.toSpoke || [])].forEach((l) => { byLoco[l] = w; });
  });
  return { byStation, byLoco };
}

