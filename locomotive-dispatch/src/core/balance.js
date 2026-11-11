/** Dashboard fleet-balance model: KPIs and the region -> zone -> location tree, plus CSV export. */
import { REGION_ORDER, HBO_OPS, SLUG_MODELS } from './constants.js';
import { csvCellMinimal } from './csv.js';
import { isGrouped } from './pools.js';
import { stationOfKey } from './keys.js';

export const planStations = (data) => data.stations.filter((s) => s.required > 0);
export const isLowMidHP = (u) => !u.hhp && !SLUG_MODELS.has(u.model);

/**
 * Free low/mid HP units at a free-status station (required 0, not shared).
 * Tuple: [loco, model, family, type, lcs, road, reportingLocation, train]
 * (reporting location is the physical location for road units).
 */
export function stationFreeUnits(st) {
  if (st.status !== 'free') return [];
  const roadLoc = {}, roadTrain = {};
  (st.road_units || []).forEach((r) => { roadLoc[r.loco] = (r.loc || '').trim(); roadTrain[r.loco] = r.train || ''; });
  return (st.have_units || []).map((u) => [u[0], u[1], u[2], u[3], u[4], u[5],
    u[5] ? roadLoc[u[0]] || st.station : st.station, u[5] ? roadTrain[u[0]] || '' : '']);
}

export function computeKpis(data) {
  const plan = planStations(data);
  const totReq = plan.reduce((a, s) => a + s.required, 0);
  const totHave = plan.reduce((a, s) => a + s.have, 0);
  return {
    plan,
    totReq, totHave, totNet: totHave - totReq,
    nShort: plan.filter((s) => s.status === 'short' && (!s.grp_members || s.k === s.grp_primary)).length,
    freeUnits: data.stations.filter((s) => s.status === 'free').reduce((a, s) => a + s.have, 0),
    shopUnits: data.stations.reduce((a, s) => a + (s.roster || []).filter((u) => u.op === 'LS').length, 0),
    deadUnits: (data.dead || []).length,
    hboUnits: data.fleet.filter((f) => !f.hhp && HBO_OPS.includes(f.op)).length,
  };
}

/**
 * Region -> zone tree. Plan locations contribute required/have; free-status locations
 * contribute to have + a synthetic "Free low/mid HP" row. Free units with no plan region
 * are returned as `orphanFree`.
 */
export function buildBalanceTree(data) {
  const plan = planStations(data);
  const regions = {};
  const ensure = (r, z) => {
    if (!regions[r]) regions[r] = { req: 0, have: 0, free: 0, zones: {} };
    if (!regions[r].zones[z]) regions[r].zones[z] = { req: 0, have: 0, free: 0, freeUnits: [], locs: [] };
    return regions[r].zones[z];
  };
  for (const s of plan) {
    const r = s.region || '—', z = s.zone || '—';
    const zone = ensure(r, z);
    regions[r].req += s.required; regions[r].have += s.have;
    zone.req += s.required; zone.have += s.have;
    zone.locs.push(s);
  }
  const orphanFree = [];
  for (const s of data.stations) {
    if (s.status !== 'free') continue;
    const r = s.region || '—';
    if (!REGION_ORDER.includes(r)) { orphanFree.push(...stationFreeUnits(s)); continue; }
    const fu = stationFreeUnits(s);
    if (!fu.length) continue;
    const zone = ensure(r, s.zone || '—');
    regions[r].have += fu.length; regions[r].free += fu.length;
    zone.have += fu.length; zone.free += fu.length;
    zone.freeUnits.push(...fu);
  }
  return { regions, orphanFree };
}

/** Per-family required vs on-hand for one location (LCS folded into its base family). */
export function familyBreakdown(s) {
  const reqFam = {}, reqLcs = {}, haveFam = {}, haveLcs = {};
  (s.req_detail || []).forEach((d) => {
    const raw = String(d[0]), f = raw.replace(/ LCS$/, '');
    reqFam[f] = (reqFam[f] || 0) + d[1];
    if (/ LCS$/.test(raw)) reqLcs[f] = (reqLcs[f] || 0) + d[1];
  });
  (s.have_detail || []).forEach((d) => { haveFam[d[0]] = d[1]; haveLcs[d[0]] = d[2] || 0; });
  const fams = Array.from(new Set([...Object.keys(reqFam), ...Object.keys(haveFam)])).sort();
  return { fams, reqFam, reqLcs, haveFam, haveLcs };
}

export const netOf = (s) => s.have - s.required;
export const byNetAsc = (a, b) => netOf(a) - netOf(b);

export function dashboardCsv(data) {
  const q = csvCellMinimal;
  const R = {};
  data.stations.forEach((s) => {
    const r = s.region || '—', z = s.zone || '—';
    if (s.required > 0) { R[r] = R[r] || {}; (R[r][z] = R[r][z] || []).push(s); }
    else if (s.status === 'free' && REGION_ORDER.includes(r)) { R[r] = R[r] || {}; R[r][z] = R[r][z] || []; }
  });
  const out = [['Level', 'Region', 'Zone', 'Location', 'State', 'Status', 'Required', 'OnHand', 'Net', 'Pooled / Detail'].map(q).join(',')];
  const freeInScope = (rf, zf) => {
    let n = 0; const list = [];
    data.stations.forEach((s) => {
      if (s.status !== 'free') return;
      const r = s.region || '—', z = s.zone || '—';
      if (rf != null && r !== rf) return;
      if (zf != null && z !== zf) return;
      const fu = stationFreeUnits(s); n += fu.length; list.push(...fu);
    });
    return { n, list };
  };
  const freeUnitRow = (r, z, u) => ['Free unit', r, z, u[6], '', 'free', '', '1', '',
    u[0] + ' ' + u[1] + ' ' + u[3] + (u[4] ? ' LCS' : '') + (u[5] ? (u[7] ? ' on train ' + u[7] : ' (road)') : '')].map(q).join(',');

  REGION_ORDER.forEach((r) => {
    const zones = R[r], reg = freeInScope(r, null);
    if (!zones && !reg.n) return;
    let rReq = 0, rHave = 0;
    if (zones) Object.values(zones).forEach((arr) => arr.forEach((s) => { rReq += s.required; rHave += s.have; }));
    rHave += reg.n;
    out.push(['Region', r, '', '', '', '', rReq, rHave, rHave - rReq, reg.n ? '+' + reg.n + ' free incl.' : ''].map(q).join(','));
    (zones ? Object.keys(zones).sort() : []).forEach((z) => {
      const arr = zones[z];
      let zReq = 0, zHave = 0;
      arr.forEach((s) => { zReq += s.required; zHave += s.have; });
      const zf = freeInScope(r, z); zHave += zf.n;
      out.push(['Zone', r, z, '', '', '', zReq, zHave, zHave - zReq, zf.n ? '+' + zf.n + ' free incl.' : ''].map(q).join(','));
      arr.slice().sort(byNetAsc).forEach((s) => {
        const grouped = isGrouped(s), isPrim = !grouped || s.k === s.grp_primary;
        const net = grouped ? (isPrim ? s.grp_net : '') : s.have - s.required;
        const pooled = grouped ? (isPrim ? 'pool ' + s.grp_have + '/' + s.grp_required + ' primary' : 'pooled → ' + stationOfKey(s.grp_primary)) : '';
        out.push(['Location', r, z, s.station, s.state, s.status, s.required, s.have, net, pooled].map(q).join(','));
      });
      zf.list.forEach((u) => out.push(freeUnitRow(r, z, u)));
    });
  });
  const orph = [];
  data.stations.forEach((s) => { if (s.status === 'free' && !REGION_ORDER.includes(s.region)) orph.push(...stationFreeUnits(s)); });
  if (orph.length) {
    out.push(['Region', 'Unassigned', '', '', '', '', '', '', orph.length, 'free — no plan zone'].map(q).join(','));
    orph.forEach((u) => out.push(freeUnitRow('Unassigned', '', u)));
  }
  return out.join('\n');
}
