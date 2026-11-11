import { describe, it, expect } from 'vitest';
import { balanceStatus, buildSharedPools, repoolSharedGroups } from '../../src/core/pools.js';
import { createActionStore, planState, stationPlanState, actionId } from '../../src/core/store.js';
import { computeRetask, findDonors, buildLocoIndex, reqText } from '../../src/core/planning.js';
import { buildQueueActions, countByType } from '../../src/core/queue.js';
import { buildWorklists, actionsCsv } from '../../src/core/actionsRequired.js';
import { computeKpis, buildBalanceTree, dashboardCsv } from '../../src/core/balance.js';
import { fleetCategory, fleetBreakdown } from '../../src/core/fleet.js';
import { computeOffplan } from '../../src/core/offplan.js';
import { loadData } from '../fixtures/snapshotRows.js';

const fresh = () => loadData('snapshot.json');

describe('balance status & shared pools', () => {
  it('classifies balance', () => {
    expect([balanceStatus(2, 1), balanceStatus(2, 2), balanceStatus(2, 3), balanceStatus(0, 0, true), balanceStatus(0, 1), balanceStatus(0, 0)])
      .toEqual(['short', 'even', 'surplus', 'shared', 'free', 'ok']);
  });

  const pool = () => buildSharedPools([
    { k: 'P|ON', station: 'P', state: 'ON', required: 3, have: 1, shared_in: [] },
    { k: 'S|ON', station: 'S', state: 'ON', required: 1, have: 2, shared_in: [{ primary: 'P, ON', ids: ['J1'], req: 1 }] },
    { k: 'X|ON', station: 'X', state: 'ON', required: 1, have: 0, shared_in: [] },
  ]);

  it('combines linked stations and reports the deficit at the primary only', () => {
    const [p, s, x] = pool();
    expect(p).toMatchObject({ grp_primary: 'P|ON', grp_required: 4, grp_have: 3, grp_net: -1, status: 'short', shortfall: 1 });
    expect(s).toMatchObject({ grp_primary: 'P|ON', status: 'short', shortfall: 0 });
    expect(x.grp_members).toBeUndefined();
  });

  it('re-pools when requirements change', () => {
    const st = pool();
    st[0].required = 1;
    repoolSharedGroups(st);
    expect(st[0]).toMatchObject({ grp_required: 2, grp_net: 1, status: 'surplus', shortfall: 0 });
  });
});

describe('action store / plan state', () => {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };

  it('tracks planned and done per action, and aggregates per station', () => {
    const store = createActionStore(mem());
    const s = { k: 'A|ON', insp: [{ loco: 'U1' }] };
    expect(stationPlanState(store, s)).toBe('');
    store.set(actionId.short('A|ON'), 'send 2 from B');
    expect(planState(store, 'short:A|ON')).toBe('planned');
    expect(stationPlanState(store, s)).toBe('planned');
    store.set('short:A|ON:done', '1');
    expect(stationPlanState(store, s)).toBe('done');
    store.set(actionId.insp('U1', 'A|ON'), '  ');
    expect(stationPlanState(store, s)).toBe('done'); // whitespace-only text is not a plan
  });

  it('falls back to memory when storage throws', () => {
    const store = createActionStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    store.set('k', 'v');
    expect(store.get('k')).toBe('v');
  });

  it('keeps the persisted id format stable', () => {
    expect([actionId.dead('CN1'), actionId.short('A|ON'), actionId.insp('CN1', 'A|ON'), actionId.retask('CN1', 'A|ON')])
      .toEqual(['dead:CN1', 'short:A|ON', 'insp:CN1@A|ON', 'retask:CN1@A|ON']);
  });
});

describe('planning on the baked snapshot', () => {
  const data = fresh();
  const idx = buildLocoIndex(data.fleet);
  const retask = computeRetask(data.stations, idx);

  it('finds re-task candidates whose home can spare them', () => {
    expect(retask.map((c) => [c.u.loco, c.s.station, c.home.station])).toEqual([
      ['EJE667', 'WATERLOO', 'KIRYARD'], ['EJE669', 'WATERLOO', 'KIRYARD'],
      ['CN4130', 'BRAINTTER', 'TORMACYAR'], ['CN4726', 'BRAINTTER', 'TORMACYAR'],
    ]);
    retask.forEach((c) => expect(c.s.status).toBe('short'));
  });

  it('ranks donors: matching family first, then nearest', () => {
    const edm = data.stations.find((s) => s.k === 'EDMONTON|AB');
    const donors = findDonors(data.stations, edm, 'SD40');
    expect(donors.length).toBeGreaterThan(0);
    const firstNoFam = donors.findIndex((d) => !d.fam);
    if (firstNoFam > 0) expect(donors.slice(firstNoFam).every((d) => !d.fam)).toBe(true);
    donors.forEach((d) => expect(d.surplus).toBeGreaterThan(0));
    expect(reqText(edm)).toMatch(/^6× SD40, /);
  });

  it('builds the console queue: re-task, worst shorts, then inspections and routing', () => {
    const q = buildQueueActions(data, retask);
    expect(countByType(q)).toEqual({ all: 88, route: 17, swap: 67, retask: 4 });
    expect(q.slice(0, 5).map((a) => a.type)).toEqual(['retask', 'retask', 'retask', 'retask', 'swap']);
    expect(q[4].actid).toBe('short:EDMONTON|AB');
  });

  it('builds the Actions Required worklists and CSV', () => {
    const w = buildWorklists(data, idx, retask);
    expect([w.dead.length, w.shorts.length, w.insps.length, w.retask.length]).toEqual([17, 32, 29, 4]); // pool secondaries carry no shortfall; HHP inspections excluded
    const csv = actionsCsv(w, createActionStore(null), '2026-09-23');
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(1 + 17 + 32 + 4 + 29);
    expect(lines[0]).toBe('"Category","Item","Location","Detail","Suggested action","Plan entered","Status","Snapshot"');
  });
});

describe('dashboard model on the baked snapshot', () => {
  const data = fresh();
  it('computes the KPI row', () => {
    const k = computeKpis(data);
    expect([k.totReq, k.totHave, k.totNet, k.nShort, k.freeUnits, k.shopUnits, k.deadUnits, k.hboUnits])
      .toEqual([544, 572, 28, 32, 14, 56, 17, 52]);
  });

  it('rolls plan locations up into region totals that match the plan', () => {
    const { regions } = buildBalanceTree(data);
    const req = Object.values(regions).reduce((a, r) => a + r.req, 0);
    expect(req).toBe(computeKpis(data).totReq);
    expect(Object.keys(regions).sort()).toEqual(['East', 'South', 'West']);
  });

  it('exports a CSV with region, zone, location and free-unit rows', () => {
    const csv = dashboardCsv(data).split('\n');
    expect(csv[0]).toBe('Level,Region,Zone,Location,State,Status,Required,OnHand,Net,Pooled / Detail');
    expect(csv.filter((l) => l.startsWith('Region,')).length).toBeGreaterThanOrEqual(3);
    expect(csv.filter((l) => l.startsWith('Location,'))).toHaveLength(computeKpis(data).plan.length);
  });
});

describe('fleet & off-plan', () => {
  it('partitions status codes', () => {
    expect(['LS', 'LD', 'LB', 'DH', 'LL', 'SM', 'SS', 'LN'].map((op) => fleetCategory({ op })))
      .toEqual(['shop', 'dit', 'hbo', 'dh', 'leased', 'stored', 'sserv', 'service']);
    expect(fleetCategory({ op: 'LT', desig: 'Available' })).toBe('service');
    expect(fleetCategory({ op: 'LT', desig: 'Held' })).toBe('held');
  });

  it('partitions the whole low/mid-HP fleet with no unit lost', () => {
    const data = fresh();
    const b = fleetBreakdown(data, buildLocoIndex(data.fleet));
    const parts = ['service', 'shop', 'hbo', 'dh', 'dit', 'leased', 'held', 'sserv', 'stored'].reduce((a, k) => a + b.counts[k], 0);
    expect(parts).toBe(b.total);
  });

  it('lists off-plan train assignments with in-service (LN) units first', () => {
    const { notInPlan, wrongClass } = computeOffplan(fresh());
    for (const list of [notInPlan, wrongClass]) {
      const firstNonLN = list.findIndex((f) => f.op !== 'LN');
      if (firstNonLN >= 0) expect(list.slice(firstNonLN).some((f) => f.op === 'LN')).toBe(false);
      list.forEach((f) => expect(f.hhp).toBe(false));
    }
  });
});
