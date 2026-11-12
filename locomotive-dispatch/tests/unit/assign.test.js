import { describe, it, expect } from 'vitest';
import { analyze, rowsFromFleet } from '../../src/core/analyze.js';
import { loadData, snapshotDate } from '../fixtures/snapshotRows.js';

const snap = loadData('snapshot.json');
const plan = loadData('static-plan.json');
const base = { multiHome: loadData('base2home-multi.json'), lcs: loadData('lcs-fleet.json'), now: snapshotDate(snap) };
const rows = rowsFromFleet(snap.fleet);
const run = (assign) => analyze(rows, plan, loadData('base2home.json'), { ...base, assign });
const st = (out, k) => out.stations.find((s) => s.k === k);
const unit = (out, id) => out.fleet.find((f) => f.loco === id);

// pick real units from the current snapshot so the test follows data refreshes
const avail = snap.fleet.filter((f) => f.desig === 'Available' && !f.hhp && !/^(YBU|HBU|CALF)/.test(f.model));
const sitting = avail.find((f) => !f.home && snap.stations.some((s) => s.k === f.k && s.required > 0)); // counted where it sits
const homedAway = avail.find((f) => f.home && f.road);                                                   // counted on the road at its home
const target = snap.stations.find((s) => s.required > 0 && s.k !== (sitting && sitting.k) && s.k !== (homedAway && homedAway.home));
const notAvail = snap.fleet.find((f) => !f.hhp && f.desig !== 'Available');

describe('manual locomotive assignments', () => {
  it('no assignments reproduces the baked snapshot', () => {
    expect(JSON.stringify(run({}))).toBe(JSON.stringify(snap));
  });

  it('assigning a unit to another terminal moves its count there (as on the road)', () => {
    const out = run({ [sitting.loco]: target.k });
    expect(unit(out, sitting.loco)).toMatchObject({ home: target.k, road: true, manual: target.k });
    expect(st(out, target.k).have).toBe(st(snap, target.k).have + 1);
    expect(st(out, target.k).have_road).toBe(st(snap, target.k).have_road + 1);
    expect(st(out, sitting.k).have).toBe(st(snap, sitting.k).have - 1);
  });

  it('assigning a unit to the terminal it sits at counts it there, not on the road', () => {
    const out = run({ [homedAway.loco]: homedAway.k in Object.fromEntries(snap.stations.map((s) => [s.k, 1])) ? homedAway.k : target.k });
    const f = unit(out, homedAway.loco);
    expect(f.manual).toBe(f.home);
    expect(st(out, homedAway.home).have).toBe(st(snap, homedAway.home).have - 1); // left its old home
  });

  it('releasing a unit drops it from its home terminal', () => {
    const out = run({ [homedAway.loco]: '' });
    expect(unit(out, homedAway.loco)).toMatchObject({ home: null, manual: '' });
    expect(st(out, homedAway.home).have).toBe(st(snap, homedAway.home).have - 1);
  });

  it('releasing a unit that sits at a terminal stops it counting there too', () => {
    const out = run({ [sitting.loco]: '' });
    expect(st(out, sitting.k).have).toBe(st(snap, sitting.k).have - 1);
    expect(st(out, sitting.k).roster.some((u) => u.loco === sitting.loco)).toBe(true); // still listed as physically here
  });

  it('a unit that is not Available is assigned but never counted', () => {
    const out = run({ [notAvail.loco]: target.k });
    expect(unit(out, notAvail.loco).home).toBe(target.k);
    expect(st(out, target.k).have).toBe(st(snap, target.k).have);
  });

  it('an assignment to an unknown terminal leaves the unit with no home (not released)', () => {
    expect(unit(run({ [homedAway.loco]: 'NOWHERE|XX' }), homedAway.loco).home).toBeNull();
  });
});
