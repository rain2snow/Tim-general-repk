import { describe, it, expect } from 'vitest';
import { analyze, resolveHome } from '../../src/core/analyze.js';

/** A tiny two-terminal plan with one shop. */
const plan = {
  meta: { snapshot: '2026-01-01' },
  shops: [{ code: 'SHP', name: 'Main Shop', lat: 10, lng: 10 }],
  plan: [
    { k: 'ALPHA|ON', station: 'ALPHA', state: 'ON', zone: 'Z1', region: 'East', captive_jobs: 2, required: 2,
      req_detail: [['SD40', 2]], shared_in: [], lat: 1, lng: 1, rbd: [1, 2, 2, 2, 2, 2, 1],
      trains: [{ ids: ['L100'], req: 2, types: [['SD40', 2]], shared: [] }] },
    { k: 'BETA|ON', station: 'BETA', state: 'ON', zone: 'Z1', region: 'East', captive_jobs: 0, required: 0,
      req_detail: [], shared_in: [], lat: 2, lng: 2, rbd: [0, 0, 0, 0, 0, 0, 0], trains: [] },
  ],
};
const base2home = { L100: 'ALPHA|ON' };
const NOW = new Date(2026, 0, 10);

const row = (o) => ({
  'Loco ID': 'X1', 'Current Location': 'ALPHA     ON', 'Loco Model': 'SD40-2', 'Loco Type': 'MHP', OpCode: 'LN',
  Designation: 'Available', 'Train ID': '', Destination: '', Shop: '', ETR: '', 'Insp Date': '', Insp: '', ...o,
});
const run = (rows, opts = {}) => analyze(rows, plan, base2home, { now: NOW, ...opts });
const st = (out, k) => out.stations.find((s) => s.k === k);

describe('balance rules', () => {
  it('counts Available low/mid HP units and flags a short station', () => {
    const out = run([row({ 'Loco ID': 'A' })]);
    expect(st(out, 'ALPHA|ON')).toMatchObject({ have: 1, required: 2, shortfall: 1, status: 'short' });
  });

  it('excludes HHP, slugs and unavailable units from on-hand', () => {
    const out = run([
      row({ 'Loco ID': 'H', 'Loco Type': 'HHP' }),
      row({ 'Loco ID': 'S', 'Loco Model': 'YBU' }),
      row({ 'Loco ID': 'U', Designation: 'Shopped', OpCode: 'LS' }),
      row({ 'Loco ID': 'A' }), row({ 'Loco ID': 'B' }),
    ]);
    const a = st(out, 'ALPHA|ON');
    expect(a).toMatchObject({ have: 2, status: 'even' });
    expect(a.roster.map((u) => u.loco)).toEqual(['S', 'U', 'A', 'B']); // HHP is not on the console roster
  });

  it('counts a captive unit out on its train at its home terminal', () => {
    const out = run([row({ 'Loco ID': 'R', 'Current Location': 'BETA      ON', 'Train ID': 'L100-15' })]);
    expect(st(out, 'ALPHA|ON')).toMatchObject({ have: 1, have_here: 0, have_road: 1 });
    expect(st(out, 'BETA|ON').have).toBe(0);
    expect(out.fleet[0]).toMatchObject({ home: 'ALPHA|ON', road: true });
  });

  it('marks unassigned available power at a no-requirement location as free', () => {
    expect(st(run([row({ 'Current Location': 'BETA      ON' })]), 'BETA|ON').status).toBe('free');
  });

  it('routes dead-in-transit units to their assigned shop', () => {
    const out = run([row({ 'Loco ID': 'D', OpCode: 'LD', Shop: 'SHP' }), row({ 'Loco ID': 'E', Designation: 'DIT', OpCode: 'XX' })]);
    expect(out.dead.map((d) => [d.loco, d.tname, d.lat])).toEqual([['D', 'Main Shop', 1], ['E', '', 1]]);
    expect(out.fleet.every((f) => f.dead)).toBe(true);
  });

  it('records inbound deadheads at their destination', () => {
    const out = run([row({ 'Loco ID': 'DH1', OpCode: 'DH', Destination: 'BETA      ON', 'Train ETA': '01/11 08:00' })]);
    expect(out.deadhead[0]).toMatchObject({ destkey: 'BETA|ON', eta: '01/11 08:00', tlat: 2 });
    expect(st(out, 'BETA|ON').inbound).toHaveLength(1);
  });

  it('flags inspections due within 3 days and counts overdue ones', () => {
    const out = run([
      row({ 'Loco ID': 'I1', 'Insp Date': '2026-01-12', Insp: '92-day' }),
      row({ 'Loco ID': 'I2', 'Insp Date': '01/08/2026', Insp: 'annual' }),
      row({ 'Loco ID': 'I3', 'Insp Date': '2026-02-01' }),
    ]);
    const a = st(out, 'ALPHA|ON');
    expect(a.insp.map((u) => [u.loco, u.days])).toEqual([['I1', 2], ['I2', -2]]);
    expect(a.overdue_n).toBe(1);
  });

  it('fills captive trains with units of the required family', () => {
    const out = run([row({ 'Loco ID': 'A' }), row({ 'Loco ID': 'G', 'Loco Model': 'GP38-2' })]);
    expect(st(out, 'ALPHA|ON').trains[0].units.map((u) => u.loco)).toEqual(['A']);
  });

  it('uses the day-of-week requirement when a day is given', () => {
    expect(st(run([row({})], { day: 0 }), 'ALPHA|ON')).toMatchObject({ required: 1, req_all: 2, status: 'even' });
  });

  it('detects the snapshot date from the export when not given', () => {
    const rows = [row({ 'Event Time': '2026-03-04 10:00' }), row({ 'Publish Date': '2026-03-04' }), row({ 'Event Time': '1900-01-01' })];
    expect(analyze(rows, plan, base2home).meta.snapshot).toBe('2026-03-04');
  });
});

describe('resolveHome', () => {
  const ctx = { stationSet: { 'ALPHA|ON': 1, 'BETA|ON': 1 }, base2home: { T1: 'ALPHA|ON' }, multiHome: { T1: ['ALPHA|ON', 'BETA|ON'] } };
  it('prefers the physical location for colliding train bases', () => {
    expect(resolveHome({ 'Train ID': 'T1-01', 'Current Location': 'BETA  ON' }, ctx)).toBe('BETA|ON');
  });
  it('then the destination', () => {
    expect(resolveHome({ 'Train ID': 'T1', 'Current Location': 'X  ON', Destination: 'BETA  ON' }, ctx)).toBe('BETA|ON');
  });
  it('then the flat mapping', () => {
    expect(resolveHome({ 'Train ID': 'T1', 'Current Location': 'X  ON' }, ctx)).toBe('ALPHA|ON');
  });
  it('returns null with no train', () => {
    expect(resolveHome({ 'Train ID': '  ' }, ctx)).toBeNull();
  });
});
