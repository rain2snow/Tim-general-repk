import { describe, it, expect } from 'vitest';
import {
  normalizeStation, setDay, trainBaseOf, effectiveBase2Home, updateOverrides, diffPlan, clonePlan, newStation, stationWarnings,
} from '../../src/core/planEdit.js';
import { analyze, rowsFromFleet } from '../../src/core/analyze.js';
import { loadData, snapshotDate } from '../fixtures/snapshotRows.js';

const plan = loadData('static-plan.json');
const base2home = loadData('base2home.json');
const snap = loadData('snapshot.json');
const ref = { multiHome: loadData('base2home-multi.json'), lcs: loadData('lcs-fleet.json'), now: snapshotDate(snap) };
const run = (p) => analyze(rowsFromFleet(snap.fleet), p, base2home, ref);
const find = (p, k) => p.plan.find((s) => s.k === k);

describe('plan model', () => {
  it('normalizeStation reproduces every built-in location unchanged', () => {
    plan.plan.forEach((s) => {
      const n = normalizeStation(s);
      expect([s.k, n.required, n.req_detail, n.rbd]).toEqual([s.k, s.required, s.req_detail, s.rbd]);
    });
  });

  it('derives requirement from jobs and shifts day-of-week with it', () => {
    const s = find(plan, 'TORMACYAR|ON');                    // required 23, rbd [22,22,23,22,22,22,22]
    const t = s.trains.map((x) => ({ ...x, types: x.types.map((y) => [...y]) }));
    t[0].types[0][1] += 2;                                   // +2 SD40 on one job
    const n = normalizeStation({ ...s, trains: t }, s.required);
    expect(n.required).toBe(25);
    expect(n.rbd).toEqual([24, 24, 25, 24, 24, 24, 24]);     // busiest day still = requirement
    expect(Math.max(...n.rbd)).toBe(n.required);
    expect(n.req_detail.find(([ty]) => ty === 'SD40')[1]).toBe(s.req_detail.find(([ty]) => ty === 'SD40')[1] + 2);
  });

  it('clamps a day to 0..required', () => {
    const s = find(plan, 'BRANTFORD|ON');
    expect(setDay(s, 3, 9).rbd[3]).toBe(s.required);
    expect(setDay(s, 3, -1).rbd[3]).toBe(0);
  });

  it('maps train IDs to train bases, skipping placeholder jobs', () => {
    expect(trainBaseOf('L580311')).toBe('L58031');
    expect(trainBaseOf('ydh3331')).toBe('YDH333');
    expect(['HUMP0', 'SPARE0', 'spare', 'TRNIN'].map(trainBaseOf)).toEqual([null, null, null, null]);
  });
});

describe('train re-homing overrides', () => {
  it('homes an added train and releases a removed one', () => {
    let p = clonePlan(plan);
    p = updateOverrides(p, base2home, 'HALIFAX|NS', [], ['Y542111']);
    expect(effectiveBase2Home(base2home, p).Y54211).toBe('HALIFAX|NS');
    const brant = find(p, 'BRANTFORD|ON');
    brant.trains[0].ids = ['L581311', 'L581312'];            // the plan carries the edit
    p = updateOverrides(p, base2home, 'BRANTFORD|ON', ['L580311', 'L581311', 'L581312'], ['L581311', 'L581312']);
    expect(base2home.L58031).toBe('BRANTFORD|ON');
    expect(effectiveBase2Home(base2home, p).L58031).toBeUndefined();
    // and putting it back cancels the override entirely
    brant.trains[0].ids = ['L580311', 'L581311', 'L581312'];
    p = updateOverrides(p, base2home, 'BRANTFORD|ON', ['L581311', 'L581312'], ['L580311', 'L581311', 'L581312']);
    expect(p.meta.base2home_overrides).toEqual({ Y54211: 'HALIFAX|NS' });
  });

  it('is applied by analyze() itself (so exported plans carry their re-homing)', () => {
    const p = updateOverrides(clonePlan(plan), base2home, 'HALIFAX|NS', [], ['Y542111']);
    const hal = find(p, 'HALIFAX|NS');
    hal.trains = [...hal.trains, { ids: ['Y542111'], req: 0, types: [], shared: [] }];
    const out = run(p);
    expect(out.fleet.find((f) => f.loco === 'BLE908').home).toBe('HALIFAX|NS');
  });
});

describe('re-analysis with an edited plan', () => {
  it('rebuilds the STP export from the snapshot exactly (unedited plan = baked snapshot)', () => {
    expect(JSON.stringify(run(plan))).toBe(JSON.stringify(snap));
  });

  it('an edited requirement flows through status and shortfall', () => {
    const p = clonePlan(plan);
    const i = p.plan.findIndex((s) => s.k === 'BRANTFORD|ON');
    const t = p.plan[i].trains.map((x) => ({ ...x, types: x.types.map((y) => [...y]) }));
    t[0].types[0][1] = 5;
    p.plan[i] = normalizeStation({ ...p.plan[i], trains: t }, p.plan[i].required);
    const s = run(p).stations.find((x) => x.k === 'BRANTFORD|ON');
    expect([s.required, s.status, s.shortfall]).toEqual([5, 'short', 5 - s.have]);
  });

  it('a new location with coordinates is analysed and can be found in the diff', () => {
    const p = clonePlan(plan);
    p.plan.push(newStation({ station: 'TESTLOC', state: 'ON', lat: 44, lng: -79, region: 'East', zone: 'SOUTHERN ONTARIO' }));
    expect(diffPlan(plan, p)).toEqual([{ k: 'TESTLOC|ON', station: 'TESTLOC', kind: 'added' }]);
    expect(run(p).stations.some((s) => s.k === 'TESTLOC|ON')).toBe(true);
  });
});

describe('editor warnings', () => {
  it('flags busiest-day mismatch, missing coordinates and duplicate train IDs', () => {
    const s = { ...newStation({ station: 'X', state: 'ON' }), required: 2, rbd: [1, 1, 1, 1, 1, 1, 1],
      trains: [{ ids: ['L580311'], types: [['GP9/GP38', 2]], req: 2, shared: [] }] };
    const w = stationWarnings(s, plan).join(' | ');
    expect(w).toMatch(/Busiest day is 1/);
    expect(w).toMatch(/No map coordinates/);
    expect(w).toMatch(/L580311 is also a job at BRANTFORD/);
  });
});
