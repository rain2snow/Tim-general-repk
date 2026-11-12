/**
 * Fleet-balance analysis engine — turns an STP_Locomotives export into the console model.
 * (Port of final.py; validated against the baked snapshot.)
 *
 * Inputs:
 *  - stpRows    parsed STP CSV rows (see csv.parseCSV)
 *  - plan       captive plan { plan[], shops[], meta } (data/static-plan.json)
 *  - base2home  train-base -> home station key (data/base2home.json)
 *  - options    { now, multiHome, day, lcs }
 *      now        snapshot date (default: detected from the export)
 *      multiHome  train-base -> [candidate home keys] for colliding bases (data/base2home-multi.json)
 *      day        0-6 to use day-of-week requirement, null for peak
 *      lcs        Set/obj of LCS-equipped loco ids (data/lcs-fleet.json)
 *      assign     manual assignments { locoId: stationKey | "" } — overrides the train-based home;
 *                 "" releases the unit: no home, and not counted toward any terminal
 */
import { SPARE_OPS, SLUG_MODELS, INSPECTION_WINDOW_DAYS } from './constants.js';
import { parseDate, dayDiff, isoDate, detectSnapshot } from './dates.js';
import { keyOf, trainBase } from './keys.js';
import { planFamily, typeBase } from './families.js';
import { balanceStatus, buildSharedPools } from './pools.js';
import { effectiveBase2Home } from './planEdit.js';

const toLookup = (x) => {
  if (!x) return {};
  if (x instanceof Set) { const o = {}; x.forEach((k) => { o[k] = true; }); return o; }
  if (Array.isArray(x)) { const o = {}; x.forEach((k) => { o[k] = true; }); return o; }
  return x;
};

/**
 * Raw STP columns the engine reads (beyond the identity columns kept on every fleet record).
 * Each fleet record carries them compactly in `stp`, so an analysed snapshot can be re-analysed
 * later — e.g. against an edited captive plan — with no loss (see rowsFromFleet).
 */
const STP_RAW = {
  l: 'Current Location', tr: 'Train ID', d: 'Destination', sh: 'Shop', etr: 'ETR', id: 'Insp Date', i: 'Insp',
  n: 'Notes', p: 'Priority', te: 'Train ETA', le: 'Loco ETA', s: 'Since in OpCode',
};
function compactStp(r) {
  const o = {};
  for (const [k, col] of Object.entries(STP_RAW)) if (r[col]) o[k] = r[col];
  return o;
}

/**
 * Rebuild STP rows from an analysed snapshot's fleet records.
 * Exact for snapshots built with `stp` on each record; older snapshots fall back to the cleaned
 * fields (inspections, notes and ETAs are then unavailable).
 */
export function rowsFromFleet(fleet) {
  return (fleet || []).map((f) => {
    const row = { 'Loco ID': f.loco, OpCode: f.op, Designation: f.desig, 'Loco Model': f.model, 'Loco Type': f.t };
    if (f.stp) { for (const [k, col] of Object.entries(STP_RAW)) row[col] = f.stp[k] || ''; return row; }
    return { ...row, 'Current Location': f.loc, 'Train ID': f.train, Destination: f.dest, Shop: f.shop, ETR: f.etr };
  });
}

/** Resolve a train's home terminal, disambiguating colliding train bases. */
export function resolveHome(row, { stationSet, base2home, multiHome }) {
  const train = row['Train ID'] || '';
  const tb = train.trim() ? trainBase(train) : '';
  if (!tb) return null;
  const pkey = keyOf(row['Current Location'] || '');
  const cands = multiHome[tb];
  if (cands && cands.length > 1) {
    // collision: physical location first, then destination, then flat mapping
    const inSet = cands.filter((k) => stationSet[k]);
    if (inSet.includes(pkey)) return pkey;
    const dkey = keyOf(row['Destination'] || '');
    if (inSet.includes(dkey)) return dkey;
    const fb = base2home[tb];
    return fb && stationSet[fb] ? fb : inSet[0] || null;
  }
  const b1 = base2home[tb];
  return b1 && stationSet[b1] ? b1 : null;
}

export function analyze(stpRows, plan, base2homeIn, options = {}) {
  // an edited plan carries its train re-homing (plan.meta.base2home_overrides)
  const base2home = effectiveBase2Home(base2homeIn, plan);
  const multiHome = options.multiHome || {};
  const lcs = toLookup(options.lcs);
  // manual assignments: loco -> station key (assign there) or '' (released: count where it sits)
  const assign = options.assign || {};
  const DAY = options.day ?? null;
  const NOW = options.now || detectSnapshot(stpRows) ||
    (plan.meta && plan.meta.snapshot ? parseDate(plan.meta.snapshot) : null) || new Date();

  const stationSet = {};
  plan.plan.forEach((p) => { stationSet[p.k] = 1; });
  const shopByCode = {};
  plan.shops.forEach((s) => { shopByCode[s.code] = s; });

  const roster = {}, roadunits = {}, dead = [], deadhead = [], fleet = [];
  const push = (map, k, v) => (map[k] = map[k] || []).push(v);

  stpRows.forEach((r) => {
    const op = r['OpCode'], desig = r['Designation'], train = r['Train ID'] || '',
      model = r['Loco Model'], t = r['Loco Type'], loco = r['Loco ID'], curLoc = r['Current Location'] || '';
    const pkey = keyOf(curLoc), hhp = t === 'HHP', slug = SLUG_MODELS.has(model);
    const ov = Object.prototype.hasOwnProperty.call(assign, loco) ? assign[loco] : undefined;
    const h = ov !== undefined ? (ov && stationSet[ov] ? ov : null) : resolveHome(r, { stationSet, base2home, multiHome });
    const isroad = !!h && h !== pkey;
    const rec = {
      loco, model, t, op, desig, hhp, slug, lcs: !!lcs[loco], pkey, home: h, road: isroad, assigned: !!h, released: ov === '',
      fdate: parseDate(r['Insp Date']), insp: r['Insp'] || '', train, curLoc,
      since: parseDate(r['Since in OpCode']), etrDate: parseDate(r['ETR']), etrRaw: (r['ETR'] || '').trim(),
    };
    if (!hhp) push(roster, pkey, rec); // console roster: low/mid HP only
    fleet.push({
      loco, loc: (curLoc || '').trim(), k: pkey, model, t, op, desig, hhp, home: h, road: isroad, lcs: !!lcs[loco],
      train, fam: planFamily(model), dest: (r['Destination'] || '').trim(), shop: (r['Shop'] || '').trim(),
      sinceD: rec.since ? dayDiff(NOW, rec.since) : null, etr: (r['ETR'] || '').trim(),
      stp: compactStp(r),
      ...(ov !== undefined ? { manual: ov || '' } : {}),
    });
    if (isroad && !hhp) push(roadunits, h, rec);
    if ((op === 'LD' || op === 'DM' || desig === 'DIT') && !hhp) {
      const shop = r['Shop'] || '', sc = shopByCode[shop] || null;
      dead.push({
        loco, lockey: pkey, rawloc: curLoc.trim(), op, dest: r['Destination'] || '', shop, etr: r['ETR'] || '',
        model, notes: r['Notes'] || '', priority: r['Priority'] || '', lat: null, lng: null,
        tlat: sc ? sc.lat : null, tlng: sc ? sc.lng : null, tname: sc ? sc.name : '',
      });
    }
    if (op === 'DH' && !hhp) { // deadhead: healthy unit moving to a destination
      const ddst = r['Destination'] || '', dk = keyOf(ddst);
      if (ddst.trim() && dk !== pkey) {
        deadhead.push({
          loco, lockey: pkey, rawloc: curLoc.trim(), op, model, t, destkey: dk, dest: ddst.trim(),
          eta: (r['Train ETA'] || r['Loco ETA'] || '').trim(), etr: (r['ETR'] || '').trim(), train,
          notes: r['Notes'] || '', lat: null, lng: null, tlat: null, tlng: null,
        });
      }
    }
  });

  // counted on-hand: Available low/mid HP, not a slug, and not released by the dispatcher
  const elig = (u) => u.desig === 'Available' && !u.hhp && !u.slug && !u.released;

  const stations = plan.plan.map((p) => {
    const rost = roster[p.k] || [], rd = roadunits[p.k] || [];
    const here = rost.filter((u) => elig(u) && !u.road);
    const roadE = rd.filter(elig);
    const have_here = here.length, have_road = roadE.length, have = have_here + have_road;
    const counted = here.concat(roadE);

    const famCount = {}, famLcs = {};
    counted.forEach((u) => {
      const f = planFamily(u.model) || 'Other';
      famCount[f] = (famCount[f] || 0) + 1;
      if (u.lcs) famLcs[f] = (famLcs[f] || 0) + 1;
    });
    const have_detail = Object.keys(famCount).map((f) => [f, famCount[f], famLcs[f] || 0]).sort((a, b) => b[1] - a[1]);
    // [loco, model, family, type, lcs, road]
    const have_units = counted.map((u) => [u.loco, u.model, planFamily(u.model) || 'Other', u.t, u.lcs ? 1 : 0, u.road ? 1 : 0]);

    const req = DAY != null && p.rbd ? p.rbd[DAY] : p.required;
    const shortfall = Math.max(0, req - have);
    const spareUnits = here.filter((u) => SPARE_OPS.has(u.op) && !u.assigned);
    const spare_n = spareUnits.length, inservice = have - spare_n;
    const insp = rost.filter((u) => u.fdate && dayDiff(u.fdate, NOW) <= INSPECTION_WINDOW_DAYS && u.desig === 'Available');
    const overdue_n = insp.filter((u) => dayDiff(u.fdate, NOW) < 0).length;
    const status = balanceStatus(req, have, !!(p.shared_in && p.shared_in.length));

    // display-only: distribute eligible units across trains by type family
    const pool = counted.slice(), used = {};
    const trains = (p.trains || []).map((t) => {
      const units = [];
      (t.types || []).forEach((ty) => {
        let want = ty[1];
        const fam = typeBase(ty[0]);
        for (let i = 0; i < pool.length && want > 0; i++) {
          const u = pool[i];
          if (used[u.loco]) continue;
          if (typeBase(planFamily(u.model) || '') === fam) {
            units.push({ loco: u.loco, model: u.model, t: u.t, loc: (u.curLoc || '').trim() ? u.curLoc : u.pkey, here: !u.road });
            used[u.loco] = 1; want--;
          }
        }
      });
      return { ids: t.ids, req: t.req, types: t.types, units, shared: t.shared || [] };
    });

    return {
      k: p.k, station: p.station, state: p.state, zone: p.zone, region: p.region,
      captive_jobs: p.captive_jobs, required: req, req_all: p.required, rbd: p.rbd || null,
      have, have_here, have_road, shortfall, req_detail: p.req_detail, have_detail, have_units, trains,
      total_present: rost.length,
      roster: rost.map((u) => ({
        loco: u.loco, model: u.model, t: u.t, op: u.op, desig: u.desig, hhp: u.hhp, slug: u.slug, road: u.road, lcs: u.lcs,
        sinceD: u.since ? dayDiff(NOW, u.since) : null,
        etrH: u.etrDate ? Math.round((u.etrDate - NOW) / 3600000) : null, etr: u.etrRaw,
      })),
      road_units: rd.map((u) => ({ loco: u.loco, model: u.model, t: u.t, train: u.train, loc: (u.curLoc || '').trim() ? u.curLoc : u.pkey })),
      inservice,
      spare: spareUnits.map((u) => ({ loco: u.loco, op: u.op, model: u.model })),
      spare_n,
      insp: insp.map((u) => ({ loco: u.loco, days: dayDiff(u.fdate, NOW), model: u.model, insp: u.insp, op: u.op })),
      insp_n: insp.length, overdue_n,
      shared_in: p.shared_in, status, lat: p.lat, lng: p.lng,
    };
  });

  buildSharedPools(stations);

  // coordinates for dead / deadhead endpoints from station coords
  const coordByKey = {};
  stations.forEach((s) => { coordByKey[s.k] = [s.lat, s.lng]; });
  dead.forEach((d) => { const c = coordByKey[d.lockey]; if (c) { d.lat = c[0]; d.lng = c[1]; } });
  deadhead.forEach((d) => {
    const c = coordByKey[d.lockey]; if (c) { d.lat = c[0]; d.lng = c[1]; }
    const tc = coordByKey[d.destkey]; if (tc) { d.tlat = tc[0]; d.tlng = tc[1]; }
  });
  const inboundByKey = {};
  deadhead.forEach((d) => { if (d.destkey) (inboundByKey[d.destkey] = inboundByKey[d.destkey] || []).push(d); });
  stations.forEach((s) => { s.inbound = inboundByKey[s.k] || []; });

  const deadSet = new Set(dead.map((d) => d.loco));
  fleet.forEach((f) => {
    const c = coordByKey[f.k];
    f.lat = c ? c[0] : null; f.lng = c ? c[1] : null;
    f.dead = deadSet.has(f.loco); f.offplan = !stationSet[f.k];
  });

  const meta = { ...(plan.meta || {}), snapshot: isoDate(NOW) };
  return { stations, dead, deadhead, shops: plan.shops, meta, fleet };
}

/** True when parsed rows look like an STP export. */
export const isStpExport = (rows) => !!rows.length && 'Loco ID' in rows[0];
