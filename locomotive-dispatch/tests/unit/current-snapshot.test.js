/**
 * Sanity checks on whatever snapshot is currently baked into the app (data/snapshot.json).
 * Unlike the fixture-pinned tests, these hold for any STP refresh.
 */
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/core/analyze.js';
import { buildHubModel } from '../../src/core/hubs.js';
import { buildLocoIndex, computeRetask } from '../../src/core/planning.js';
import { loadData, rowsFromSnapshot, snapshotDate } from '../fixtures/snapshotRows.js';

const snap = loadData('snapshot.json');
const plan = loadData('static-plan.json');

describe(`baked snapshot (${snap.meta.snapshot})`, () => {
  it('is a full analysed snapshot of every plan location', () => {
    expect(snap.meta.snapshot).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snap.stations.map((s) => s.k)).toEqual(plan.plan.map((p) => p.k));
    expect(snap.fleet.length).toBeGreaterThan(1000);
    expect(snap.shops).toEqual(plan.shops);
  });

  it('is reproducible by the engine (balances, dead, deadhead, homes)', () => {
    const out = analyze(rowsFromSnapshot(snap, snapshotDate(snap)), plan, loadData('base2home.json'), {
      now: snapshotDate(snap), multiHome: loadData('base2home-multi.json'), lcs: loadData('lcs-fleet.json'),
    });
    const pick = (s) => [s.k, s.required, s.have, s.have_here, s.have_road, s.status, s.shortfall, s.grp_status ?? null];
    expect(out.stations.map(pick)).toEqual(snap.stations.map(pick));
    expect(out.dead.map((d) => d.loco)).toEqual(snap.dead.map((d) => d.loco));
    expect(out.deadhead.map((d) => d.loco)).toEqual(snap.deadhead.map((d) => d.loco));
    expect(out.fleet.map((f) => f.home)).toEqual(snap.fleet.map((f) => f.home));
  });

  it('reconciles tactical and strategic in the hub model', () => {
    const m = buildHubModel(snap, loadData('hubs.json'), { retask: computeRetask(snap.stations, buildLocoIndex(snap.fleet)) });
    const uncovered = Object.values(m.coverPlan).reduce((a, p) => a + p.uncovered, 0);
    expect(uncovered).toBe(m.strategic.system.residualShort);
    expect(m.tactical.NONE).toEqual([]);
  });
});
