/**
 * Balance status + shared-job pool logic.
 *
 * Some captive jobs share power across terminals. Those stations are linked (via
 * `shared_in[].primary`) into pools; a pool's requirement and on-hand are combined and
 * its deficit/surplus is reported once, at the pool's primary station.
 */

/** Balance status for a single station (or pool). */
export function balanceStatus(req, have, isSharedParticipant = false) {
  if (req > 0) return have < req ? 'short' : have === req ? 'even' : 'surplus';
  if (isSharedParticipant) return 'shared';
  if (have > 0) return 'free';
  return 'ok';
}

/** Status of a station from its own required/have/shared_in. */
export const stationStatus = (s) => balanceStatus(s.required, s.have, !!(s.shared_in && s.shared_in.length));

/** Apply pooled totals to every member of a group (mutates). */
function applyPoolTotals(byKey, members, primary) {
  let gReq = 0, gHave = 0;
  members.forEach((k) => { const m = byKey[k]; if (m) { gReq += m.required; gHave += m.have; } });
  const gStatus = balanceStatus(gReq, gHave);
  const gShort = Math.max(0, gReq - gHave);
  members.forEach((k) => {
    const s = byKey[k];
    if (!s) return;
    s.grp_required = gReq; s.grp_have = gHave; s.grp_net = gHave - gReq; s.grp_status = gStatus;
    s.status = gStatus;
    s.shortfall = k === primary ? gShort : 0;
  });
}

/**
 * Discover pools from `shared_in` links (union-find) and assign grp_* fields.
 * The primary is the first member that is not itself a shared participant.
 */
export function buildSharedPools(stations) {
  const byKey = {}, byName = {};
  stations.forEach((s) => { byKey[s.k] = s; byName[s.station + ', ' + s.state] = s; });
  const parent = {};
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => {
    if (!(a in parent)) parent[a] = a;
    if (!(b in parent)) parent[b] = b;
    parent[find(a)] = find(b);
  };
  stations.forEach((s) => (s.shared_in || []).forEach((e) => { const pr = byName[e.primary]; if (pr) uni(s.k, pr.k); }));
  const groups = {};
  Object.keys(parent).forEach((k) => { const r = find(k); (groups[r] = groups[r] || []).push(k); });
  Object.values(groups).forEach((mem) => {
    if (mem.length < 2) return;
    let prim = mem.find((k) => !(byKey[k].shared_in && byKey[k].shared_in.length)) ?? null;
    if (prim === null) prim = mem[0];
    mem.forEach((k) => { byKey[k].grp_members = mem.slice(); byKey[k].grp_primary = prim; });
    applyPoolTotals(byKey, mem, prim);
  });
  return stations;
}

/** Recompute pooled totals for already-discovered pools (e.g. after required changes). */
export function repoolSharedGroups(stations) {
  const byKey = {}, done = new Set();
  stations.forEach((s) => { byKey[s.k] = s; });
  stations.forEach((s) => {
    if (!s.grp_members || s.grp_members.length < 2) return;
    if (done.has(s.grp_primary)) return;
    done.add(s.grp_primary);
    applyPoolTotals(byKey, s.grp_members, s.grp_primary);
  });
  return stations;
}

/** True when a station is in a pool but is not the pool's primary (its balance is shown elsewhere). */
export const isPooledSecondary = (s) => !!(s.grp_members && s.grp_members.length > 1) && s.k !== s.grp_primary;
export const isGrouped = (s) => !!(s.grp_members && s.grp_members.length > 1);
