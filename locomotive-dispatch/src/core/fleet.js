/** Whole-fleet status partition (low/mid HP, slugs/CALF excluded). */
import { displayState } from './constants.js';

/** Low/mid-HP fleet, excluding HHP, slugs and CALF. */
export const fleetLowMidHP = (fleet) => (fleet || []).filter((f) => !f.hhp && !/^(YBU|HBU|CALF)/i.test(f.model || ''));

/** Status bucket for a fleet record. */
export function fleetCategory(f) {
  const op = f.op;
  if (op === 'LS' || f.desig === 'Shopped') return 'shop';
  if (op === 'LD' || op === 'DM' || f.desig === 'DIT') return 'dit';
  if (op === 'LA' || op === 'LB' || op === 'LO' || op === 'LV') return 'hbo';
  if (op === 'DH') return 'dh';
  if (op === 'LL') return 'leased';
  if (op === 'SM') return 'stored';
  if (op === 'SS') return 'sserv';
  if (op === 'LN') return 'service';
  return f.desig === 'Available' ? 'service' : 'held';
}

export const FLEET_CATEGORIES = [
  { k: 'service', l: 'In service', rule: 'LN', c: 'var(--green)' },
  { k: 'shop', l: 'In shop', rule: 'LS', c: 'var(--amber)' },
  { k: 'hbo', l: 'Heavy bad order', rule: 'LA/LB/LO/LV', c: 'var(--red)' },
  { k: 'dh', l: 'Deadhead', rule: 'DH', c: 'var(--cyan)' },
  { k: 'dit', l: 'Dead in transit', rule: 'LD/DM', c: '#ff7a3d' },
  { k: 'leased', l: 'Leased out', rule: 'LL', c: '#caa6e0' },
  { k: 'held', l: 'Other held', rule: 'LT', c: '#9aa0ab' },
  { k: 'sserv', l: 'Stored serviceable', rule: 'SS', c: '#5fcf9a' },
  { k: 'stored', l: 'Stored (mech.)', rule: 'SM', c: '#6b7280' },
];
export const FLEET_OVERLAYS = [
  { k: 'onhand', l: 'On hand (available)', rule: 'desig Available', c: 'var(--green)' },
  { k: 'free', l: 'Free L/M HP', rule: 'at free-status loc', c: '#b9a0ff', cls: 'sub' },
  { k: 'overdue', l: 'Overdue inspection', rule: 'insp past due', c: 'var(--red)' },
];

/** Leasing-company reporting marks. */
export const isLessorUnit = (loco) => /^(EMDX|GECX|CITX|HLCX|LLPX|NREX|CEFX|GMTX|LRCX|AReX)/i.test(loco || '');

const stationLabel = (s) => s.station + ', ' + displayState(s.state);

export function freeFleetUnits(stations) {
  const out = [];
  (stations || []).forEach((s) => {
    if (s.status !== 'free') return;
    (s.have_units || []).forEach((u) => out.push({ loco: u[0], model: u[1], loc: stationLabel(s), road: !!u[5] }));
  });
  return out;
}

export function overdueInspections(stations, locoIndex) {
  const out = [];
  (stations || []).forEach((s) => (s.insp || []).forEach((u) => {
    if (u.days >= 0) return;
    const f = locoIndex ? locoIndex[u.loco] : null;
    if (f && f.hhp) return;
    out.push({ loco: u.loco, model: u.model, loc: stationLabel(s), days: u.days, insp: u.insp });
  }));
  return out;
}

const packUnit = (f) => ({ loco: f.loco, model: f.model, loc: f.loc || '—', road: !!f.road, dest: f.dest || '',
  shop: f.shop || '', sinceD: f.sinceD == null ? null : f.sinceD, etr: f.etr || '' });

/** Full breakdown: counts per category + drill-down unit lists (including overlays). */
export function fleetBreakdown(data, locoIndex) {
  const F = fleetLowMidHP(data.fleet);
  const buckets = Object.fromEntries(FLEET_CATEGORIES.map((m) => [m.k, []]));
  F.forEach((f) => { const c = fleetCategory(f); (buckets[c] = buckets[c] || []).push(f); });
  const onhand = F.filter((f) => f.desig === 'Available');
  const drill = {};
  FLEET_CATEGORIES.forEach((m) => { drill[m.k] = (buckets[m.k] || []).map(packUnit); });
  drill.onhand = onhand.map(packUnit);
  drill.free = freeFleetUnits(data.stations);
  drill.overdue = overdueInspections(data.stations, locoIndex);
  const counts = Object.fromEntries(Object.entries(drill).map(([k, v]) => [k, v.length]));
  const maxCategory = Math.max(1, ...FLEET_CATEGORIES.map((m) => counts[m.k]));
  return { total: F.length, counts, drill, maxCategory };
}
