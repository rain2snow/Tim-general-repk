/** "Actions Required" worklist model + CSV export. */
import { actionFamily } from './families.js';
import { nearestShop, shopByCode } from './geo.js';
import { findDonors, reqText } from './planning.js';
import { actionId, planState } from './store.js';
import { csvCellQuoted } from './csv.js';

export const ACTION_CATEGORIES = [
  { k: 'dead', l: 'Dead → shop', c: 'var(--dead)' },
  { k: 'short', l: 'Short locations', c: 'var(--red)' },
  { k: 'retask', l: 'Re-task on-site power', c: 'var(--cyan)' },
  { k: 'insp', l: 'Inspection swaps', c: 'var(--amber)' },
];
export const ACTION_REGION_ORDER = ['East', 'West', 'South', 'Unassigned'];

const hasRealShop = (d) => (d.shop && d.shop !== 'OFF' ? 1 : 0);

/** Build the four worklists. */
export function buildWorklists(data, locoIndex, retask) {
  const dead = (data.dead || []).slice().sort((a, b) => hasRealShop(a) - hasRealShop(b));
  const shorts = (data.stations || []).filter((s) => s.status === 'short' && s.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall);
  const insps = [];
  (data.stations || []).forEach((s) => (s.insp || []).forEach((u) => {
    const f = locoIndex ? locoIndex[u.loco] : null;
    if (f && f.hhp) return; // captive inspection swaps are low/mid-HP only
    insps.push({ s, u });
  }));
  insps.sort((a, b) => a.u.days - b.u.days);
  return { dead, shorts, insps, retask: retask || [] };
}

/** Region / zone for grouping an item by its station key. */
export function regionZoneOf(stationsByKey, k) {
  const st = stationsByKey[k];
  return st ? { region: st.region || 'Unassigned', zone: st.zone || st.region || 'Other' } : { region: 'Unassigned', zone: 'Off-network' };
}

/** Suggested shop for a dead unit: its assigned shop, else the nearest one. */
export function deadUnitShop(shops, d) {
  const assigned = d.shop && d.shop !== 'OFF' ? shopByCode(shops, d.shop) : null;
  return { assigned, shop: assigned || (d.lat != null ? nearestShop(shops, d.lat, d.lng) : null) };
}

/** Coverage suggestion for an inspection swap. */
export function inspectionCover(stations, s, u) {
  const fam = actionFamily(u.model);
  const localSpare = s.spare && s.spare.length ? s.spare[0] : null;
  const localSurplus = s.status === 'surplus' || s.status === 'free';
  const donor = findDonors(stations, s, fam)[0] || null;
  return { fam, localSpare, localSurplus, donor };
}

export const shortFamily = (s) => (s.req_detail && s.req_detail[0] ? s.req_detail[0][0].replace(/ LCS$/, '') : null);

export function openCount(store, ids) {
  return ids.filter((id) => planState(store, id) !== 'done').length;
}

export function worklistIds(w) {
  return {
    dead: w.dead.map((d) => actionId.dead(d.loco)),
    short: w.shorts.map((s) => actionId.short(s.k)),
    retask: w.retask.map((c) => actionId.retask(c.u.loco, c.s.k)),
    insp: w.insps.map((it) => actionId.insp(it.u.loco, it.s.k)),
  };
}

export function actionsCsv(w, store, snapshot) {
  const row = (a) => a.map(csvCellQuoted).join(',') + '\r\n';
  const planOf = (id) => { try { return store.get(id) || ''; } catch { return ''; } };
  const statusOf = (id) => { const p = planState(store, id); return p === 'done' ? 'Done' : p === 'planned' ? 'Planned' : 'Open'; };
  const snap = snapshot || '';
  let out = row(['Category', 'Item', 'Location', 'Detail', 'Suggested action', 'Plan entered', 'Status', 'Snapshot']);
  w.dead.forEach((d) => {
    const id = actionId.dead(d.loco);
    const sug = 'Route to ' + (d.shop && d.shop !== 'OFF' ? d.shop + (d.tname ? ' (' + d.tname + ')' : '') : 'nearest capable shop') + (d.etr ? '; ETR ' + d.etr : '');
    out += row(['Dead -> shop', d.loco + ' ' + d.model, d.rawloc || d.lockey || '', d.op || 'DIT', sug, planOf(id), statusOf(id), snap]);
  });
  w.shorts.forEach((s) => {
    const id = actionId.short(s.k);
    out += row(['Short location', s.station + ' ' + s.state, s.zone || s.region || '',
      'Need +' + s.shortfall + ' (' + reqText(s) + '); req ' + s.required + ' / have ' + s.have,
      'Source ' + s.shortfall + ' from nearest surplus', planOf(id), statusOf(id), snap]);
  });
  w.retask.forEach((c) => {
    const id = actionId.retask(c.u.loco, c.s.k);
    out += row(['Re-task', c.u.loco + ' ' + c.u.model, c.s.station + ' ' + c.s.state,
      c.fam + '; homed at ' + c.home.station + ' (' + c.home.status + ' +' + c.slack + ')',
      'Pull on-site unit onto ' + c.s.station + ' captive job', planOf(id), statusOf(id), snap]);
  });
  w.insps.forEach(({ s, u }) => {
    const id = actionId.insp(u.loco, s.k);
    out += row(['Inspection swap', u.loco + ' ' + u.model, s.station + ' ' + s.state,
      (u.insp || 'inspection') + '; ' + (u.days < 0 ? 'overdue ' + -u.days + 'd' : 'due ' + u.days + 'd'),
      'Swap out, send to shop; backfill the assignment', planOf(id), statusOf(id), snap]);
  });
  return out;
}
