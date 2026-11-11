/** Dispatch planning: donor search and on-site re-task candidates. */
import { actionFamily } from './families.js';
import { haversineKm } from './geo.js';

/** Index fleet records by loco id. */
export function buildLocoIndex(fleet) {
  const idx = {};
  (fleet || []).forEach((f) => { idx[f.loco] = f; });
  return idx;
}

export function stationIndex(stations) {
  const idx = {};
  (stations || []).forEach((s) => { idx[s.k] = s; });
  return idx;
}

/** Units a station can spare: surplus over plan, or everything at a free location. */
export const stationSlack = (t) => (t.status === 'surplus' ? t.have - t.required : t.status === 'free' ? t.have : 0);

/**
 * Candidate donor stations for a short station, preferring ones that hold the needed
 * family, then nearest first.
 */
export function findDonors(stations, s, fam) {
  const out = [];
  (stations || []).forEach((t) => {
    if (t.k === s.k || t.lat == null) return;
    const surplus = stationSlack(t);
    if (surplus <= 0) return;
    let hasFam = false;
    if (fam) {
      const pool = (t.roster || []).filter((u) => u.desig === 'Available' && !u.hhp && !u.slug && !u.road).concat(t.road_units || []);
      hasFam = pool.some((u) => actionFamily(u.model) === fam);
    }
    out.push({ k: t.k, station: t.station, state: t.state, surplus, fam: hasFam,
      d: s.lat != null ? haversineKm([s.lat, s.lng], [t.lat, t.lng]) : 1e9 });
  });
  out.sort((a, b) => (a.fam !== b.fam ? (a.fam ? -1 : 1) : a.d - b.d));
  return out;
}

/**
 * Re-task candidates: units physically at a short station, of a family it needs,
 * whose home terminal can spare them.
 */
export function computeRetask(stations, locoIndex) {
  const byKey = stationIndex(stations), out = [];
  (stations || []).forEach((s) => {
    if (s.status !== 'short') return;
    const need = {};
    (s.req_detail || []).forEach((r) => { need[String(r[0]).replace(/ LCS$/, '')] = true; });
    (s.roster || []).forEach((u) => {
      if (!u.road || u.hhp || u.slug) return;
      const fam = actionFamily(u.model);
      if (!fam || !need[fam]) return;
      const f = locoIndex ? locoIndex[u.loco] : null;
      const homeK = f && f.home ? f.home : null;
      if (!homeK || homeK === s.k) return;
      const home = byKey[homeK];
      if (!home) return;
      const slack = home.status === 'free' ? home.have : home.have - home.required;
      if (home.status === 'surplus' || home.status === 'free' || slack > 0) out.push({ s, u, home, slack, fam });
    });
  });
  return out;
}

/** "2× SD60, 1× GP9/GP38" */
export const reqText = (s) => (s.req_detail || []).map((r) => r[1] + '× ' + r[0]).join(', ');
