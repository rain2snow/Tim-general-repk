import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/core/analyze.js';
import { applyDemandDay } from '../../src/core/demand.js';
import { loadData, loadFixtureSnapshot, rowsFromSnapshot, SNAPSHOT_DATE } from '../fixtures/snapshotRows.js';

const snapshot = loadFixtureSnapshot();
const plan = loadData('static-plan.json');
const run = (opts = {}) => analyze(rowsFromSnapshot(snapshot), plan, loadData('base2home.json'), {
  now: SNAPSHOT_DATE, multiHome: loadData('base2home-multi.json'), lcs: loadData('lcs-fleet.json'), ...opts,
});

describe('analyze() against the baked 2026-09-23 snapshot', () => {
  const out = run();
  const byKey = Object.fromEntries(snapshot.stations.map((s) => [s.k, s]));

  it('produces one station per plan location, in plan order', () => {
    expect(out.stations.map((s) => s.k)).toEqual(snapshot.stations.map((s) => s.k));
  });

  it('reproduces every station balance exactly', () => {
    const fields = ['required', 'req_all', 'have', 'have_here', 'have_road', 'status', 'shortfall', 'spare_n', 'inservice',
      'have_detail', 'have_units', 'trains', 'road_units', 'spare', 'total_present',
      'grp_members', 'grp_primary', 'grp_required', 'grp_have', 'grp_net', 'grp_status'];
    for (const s of out.stations) {
      for (const f of fields) expect([s.k, f, s[f]]).toEqual([s.k, f, byKey[s.k][f]]);
    }
  });

  it('reproduces roster membership and in-status durations', () => {
    for (const s of out.stations) {
      const pick = (u) => [u.loco, u.op, u.desig, u.road, u.lcs, u.sinceD];
      expect(s.roster.map(pick)).toEqual(byKey[s.k].roster.map(pick));
    }
  });

  it('finds the same dead units and routes them to the same shops', () => {
    const pick = (d) => [d.loco, d.lockey, d.op, d.shop, d.tname, d.lat, d.lng, d.tlat, d.tlng];
    expect(out.dead.map(pick)).toEqual(snapshot.dead.map(pick));
  });

  it('finds the same inbound deadheads', () => {
    const pick = (d) => [d.loco, d.lockey, d.destkey, d.lat, d.tlat];
    expect(out.deadhead.map(pick)).toEqual(snapshot.deadhead.map(pick));
  });

  it('resolves the same home terminal for every unit', () => {
    const pick = (f) => [f.loco, f.k, f.home, f.road, f.fam, f.dead, f.offplan];
    expect(out.fleet.map(pick)).toEqual(snapshot.fleet.map(pick));
  });

  it('stamps the snapshot date', () => {
    expect(out.meta.snapshot).toBe('2026-09-23');
  });
});

describe('day-of-week demand', () => {
  it('analyze(day) and applyDemandDay(day) agree for every day', () => {
    for (let day = 0; day < 7; day++) {
      const direct = run({ day });
      const switched = run();
      applyDemandDay(switched.stations, day);
      const pick = (s) => [s.k, s.required, s.status, s.shortfall, s.grp_required ?? null, s.grp_status ?? null];
      expect(switched.stations.map(pick)).toEqual(direct.stations.map(pick));
    }
  });

  it('switching back to peak restores the plan requirement', () => {
    const out = run();
    const before = out.stations.map((s) => [s.required, s.status, s.shortfall]);
    applyDemandDay(out.stations, 2);
    applyDemandDay(out.stations, null);
    expect(out.stations.map((s) => [s.required, s.status, s.shortfall])).toEqual(before);
  });
});
