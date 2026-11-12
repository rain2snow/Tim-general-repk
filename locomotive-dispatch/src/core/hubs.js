/**
 * Hub-and-spoke dispatch model.
 *
 * Hubs are repair shops (data/hubs.json); each handles the plan zones it sits in.
 *   - Tactical: per-hub actions — cover shortages (from in-hub surplus first), swap overdue / due
 *     inspections into the hub shop, route dead units, re-task on-site power.
 *   - Strategic: per-hub balance after in-hub cover, and system transfers between hubs
 *     (residual surplus -> residual deficit, nearest first).
 */
import { haversineKm } from './geo.js';
import { findDonors } from './planning.js';
import { isGrouped } from './pools.js';
import { buildQueueActions } from './queue.js';

export const UNASSIGNED_HUB = { id: 'NONE', name: 'Unassigned', region: 'Unassigned', shops: [], zones: [] };
/** Region display order for the tactical view. */
export const HUB_REGION_ORDER = ['East', 'West', 'South', 'Unassigned'];

/** Distance (km) from a point to a hub (its nearest shop). */
function hubDistance(hub, lat, lng) {
  return Math.min(...hub.shopObjs.map((sh) => haversineKm([lat, lng], [sh.lat, sh.lng])), 1e9);
}

/** Resolve hub config against the shop list. */
export function resolveHubs(config, shops) {
  const byCode = Object.fromEntries((shops || []).map((s) => [s.code, s]));
  return (config.hubs || []).map((h) => {
    const shopObjs = h.shops.map((c) => byCode[c]).filter(Boolean);
    return { ...h, shopObjs, lat: shopObjs[0] ? shopObjs[0].lat : null, lng: shopObjs[0] ? shopObjs[0].lng : null };
  }).filter((h) => h.shopObjs.length);
}

/** station key -> hub id, by zone ownership (split by nearest shop when shared), else nearest hub. */
export function assignStationsToHubs(stations, hubs) {
  const owners = {};
  hubs.forEach((h) => h.zones.forEach((z) => (owners[z] = owners[z] || []).push(h)));
  const out = {};
  (stations || []).forEach((s) => {
    const cands = (s.zone && owners[s.zone]) || hubs;
    if (s.lat == null) { out[s.k] = cands.length === 1 ? cands[0].id : UNASSIGNED_HUB.id; return; }
    out[s.k] = cands.reduce((best, h) => (hubDistance(h, s.lat, s.lng) < hubDistance(best, s.lat, s.lng) ? h : best)).id;
  });
  return out;
}

/** Units a station is short / can spare, counting shared pools once (at the primary). */
export function stationShortSurplus(s) {
  if (isGrouped(s)) {
    if (s.k !== s.grp_primary) return { short: 0, surplus: 0 };
    return { short: s.shortfall || 0, surplus: Math.max(0, s.grp_net || 0) };
  }
  const surplus = s.status === 'surplus' ? s.have - s.required : s.status === 'free' ? s.have : 0;
  return { short: s.shortfall || 0, surplus: Math.max(0, surplus) };
}

/** Hub of an arbitrary point: by station key if known, else nearest hub. */
function hubOfPoint(stationHub, hubs, key, lat, lng) {
  if (key && stationHub[key]) return stationHub[key];
  if (lat == null) return UNASSIGNED_HUB.id;
  return hubs.reduce((best, h) => (hubDistance(h, lat, lng) < hubDistance(best, lat, lng) ? h : best)).id;
}

/**
 * Build the full hub model.
 * @returns {{ hubs, stationHub, byId, tactical: Object<hubId, action[]>, strategic: { transfers, system } }}
 */
export function buildHubModel(data, config, { retask = [] } = {}) {
  const hubs = resolveHubs(config, data.shops);
  const stationHub = assignStationsToHubs(data.stations, hubs);
  const byId = Object.fromEntries(hubs.map((h) => [h.id, h]));
  const shopHub = {};
  hubs.forEach((h) => h.shops.forEach((c) => { shopHub[c] = h.id; }));
  const stationsByKey = Object.fromEntries(data.stations.map((s) => [s.k, s]));

  // ---- per-hub balance
  const agg = Object.fromEntries(hubs.map((h) => [h.id, {
    stations: [], required: 0, have: 0, short: 0, surplus: 0, shortStations: 0,
    overdue: 0, dueSoon: 0, deadHere: 0, deadInbound: 0, inShop: 0,
  }]));
  data.stations.forEach((s) => {
    const a = agg[stationHub[s.k]];
    if (!a) return;
    a.stations.push(s.k);
    a.required += s.required || 0;
    a.have += s.required > 0 || s.status === 'free' ? s.have : 0;
    const { short, surplus } = stationShortSurplus(s);
    a.short += short; a.surplus += surplus;
    if (short > 0) a.shortStations++;
    (s.insp || []).forEach((u) => { if (u.days < 0) a.overdue++; else a.dueSoon++; });
    a.inShop += (s.roster || []).filter((u) => u.op === 'LS').length;
  });
  (data.dead || []).forEach((d) => {
    const loc = hubOfPoint(stationHub, hubs, d.lockey, d.lat, d.lng);
    const here = agg[loc === UNASSIGNED_HUB.id ? shopHub[d.shop] : loc];
    if (here) here.deadHere++;
    const to = agg[shopHub[d.shop]];
    if (to) to.deadInbound++;
  });

  const balances = hubs.map((h) => {
    const a = agg[h.id];
    // region: configured, else the majority region of the hub's stations
    let region = h.region;
    if (!region) {
      const tally = {};
      a.stations.forEach((k) => { const r = stationsByKey[k].region; if (r) tally[r] = (tally[r] || 0) + 1; });
      region = Object.keys(tally).sort((x, y) => tally[y] - tally[x])[0] || 'Unassigned';
    }
    h = { ...h, region };
    const cover = Math.min(a.short, a.surplus);
    const residualShort = a.short - cover, residualSurplus = a.surplus - cover;
    const status = residualShort > 0 ? 'short' : residualSurplus > 0 ? 'surplus' : 'balanced';
    return { ...h, ...a, net: a.surplus - a.short, cover, residualShort, residualSurplus, status };
  });
  const balById = Object.fromEntries(balances.map((b) => [b.id, b]));

  // ---- tactical cover plan: allocate in-hub surplus to short stations (worst short first;
  // donors holding the needed family first, then nearest). Leftover shortage escalates.
  const remaining = {};
  data.stations.forEach((s) => { remaining[s.k] = stationShortSurplus(s).surplus; });
  const coverPlan = {};
  data.stations.filter((s) => stationShortSurplus(s).short > 0)
    .sort((a, b) => stationShortSurplus(b).short - stationShortSurplus(a).short)
    .forEach((s) => {
      const hubId = stationHub[s.k];
      const fam = s.req_detail && s.req_detail[0] ? String(s.req_detail[0][0]).replace(/ LCS$/, '') : null;
      let need = stationShortSurplus(s).short;
      const from = [];
      findDonors(data.stations, s, fam).filter((d) => stationHub[d.k] === hubId).forEach((d) => {
        const take = Math.min(need, remaining[d.k] || 0);
        if (take <= 0) return;
        remaining[d.k] -= take; need -= take;
        from.push({ k: d.k, station: d.station, units: take, fam: d.fam ? fam : null, km: Math.round(d.d) });
      });
      coverPlan[s.k] = { from, uncovered: need };
    });

  // ---- tactical: the console actions, tagged with their hub + an in-hub suggestion
  const tactical = Object.fromEntries(hubs.map((h) => [h.id, []]));
  tactical[UNASSIGNED_HUB.id] = [];
  buildQueueActions(data, retask).forEach((a) => {
    let hubId, hint = '';
    if (a.ref.kind === 'dead') {
      const d = data.dead.find((x) => x.loco === a.ref.id);
      const toHub = shopHub[d.shop];
      hubId = hubOfPoint(stationHub, hubs, d.lockey, d.lat, d.lng);
      if (hubId === UNASSIGNED_HUB.id && toHub) hubId = toHub; // no plotted location: its assigned shop's hub
      hint = toHub ? (toHub === hubId ? `Shop ${d.shop} is in this hub` : `Assigned to ${d.shop} (${byId[toHub].name} hub)`)
        : `No shop assigned — send to ${(byId[hubId] && byId[hubId].shopObjs[0].name) || 'nearest shop'}`;
    } else {
      hubId = stationHub[a.ref.id] || UNASSIGNED_HUB.id;
      const s = stationsByKey[a.ref.id], hub = byId[hubId];
      if (a.actid.startsWith('short:')) {
        const plan = coverPlan[s.k] || { from: [], uncovered: s.shortfall };
        if (isGrouped(s) && s.k !== s.grp_primary) {
          const prim = stationsByKey[s.grp_primary];
          hint = `Shared pool — balance handled at ${prim ? prim.station : s.grp_primary}` +
            (stationHub[s.grp_primary] && stationHub[s.grp_primary] !== hubId ? ` (${byId[stationHub[s.grp_primary]].name} hub)` : '');
        } else hint = (plan.from.length ? 'Cover in hub: ' + plan.from.map((f) => `${f.units} from ${f.station}${f.fam ? ' (' + f.fam + ')' : ''}`).join(', ') : '') +
          (plan.uncovered > 0 ? (plan.from.length ? ' · ' : '') + `${plan.uncovered} uncovered — escalated to Strategic` : '');
        a.cover = plan;
      } else if (a.actid.startsWith('insp:') && hub) {
        const shop = hub.shopObjs.reduce((b, sh) => (haversineKm([s.lat, s.lng], [sh.lat, sh.lng]) < haversineKm([s.lat, s.lng], [b.lat, b.lng]) ? sh : b));
        hint = `Swap into ${shop.name} (${shop.code})` + (s.spare_n ? ` · ${s.spare_n} spare on hand` : '');
      } else if (a.actid.startsWith('retask:')) {
        hint = 'On-site re-task — no movement needed';
      }
    }
    (tactical[hubId] = tactical[hubId] || []).push({ ...a, hub: hubId, hint, overdue: a.metas.some((m) => /^OVERDUE/.test(m.t)) });
  });

  // ---- strategic: system transfers between hubs (greedy, nearest surplus first)
  const pool = balances.filter((b) => b.residualSurplus > 0).map((b) => ({ id: b.id, left: b.residualSurplus }));
  const transfers = [];
  balances.filter((b) => b.residualShort > 0).sort((a, b) => b.residualShort - a.residualShort).forEach((need) => {
    let left = need.residualShort;
    pool.slice().sort((a, b) => haversineKm([balById[a.id].lat, balById[a.id].lng], [need.lat, need.lng]) -
      haversineKm([balById[b.id].lat, balById[b.id].lng], [need.lat, need.lng])).forEach((src) => {
      if (left <= 0 || src.left <= 0) return;
      const units = Math.min(left, src.left);
      src.left -= units; left -= units;
      transfers.push({ from: src.id, to: need.id, units, km: Math.round(haversineKm([balById[src.id].lat, balById[src.id].lng], [need.lat, need.lng])),
        actid: 'xfer:' + src.id + '>' + need.id });
    });
    if (left > 0) transfers.push({ from: null, to: need.id, units: left, km: null, actid: 'xfer:none>' + need.id });
  });

  const system = balances.reduce((s, b) => ({
    required: s.required + b.required, have: s.have + b.have, short: s.short + b.short, surplus: s.surplus + b.surplus,
    coveredInHub: s.coveredInHub + b.cover, residualShort: s.residualShort + b.residualShort, residualSurplus: s.residualSurplus + b.residualSurplus,
  }), { required: 0, have: 0, short: 0, surplus: 0, coveredInHub: 0, residualShort: 0, residualSurplus: 0 });
  system.hubsShort = balances.filter((b) => b.status === 'short').length;
  system.hubsSurplus = balances.filter((b) => b.status === 'surplus').length;

  return { hubs: balances, byId: balById, stationHub, tactical, coverPlan, strategic: { transfers, system } };
}

/**
 * Severity ordering of hubs for the tactical view (compare element-wise, descending):
 * shortage the hub cannot cover itself, then overdue inspections, then total shortage, then volume.
 */
export function hubSeverity(b, actions) {
  const overdue = actions.filter((a) => a.overdue).length;
  return [b ? b.residualShort : 0, overdue, b ? b.short : 0, actions.length];
}
