import { describe, it, expect } from 'vitest';
import { analyze, rowsFromFleet, jobKey } from '../../src/core/analyze.js';
import { approxHp } from '../../src/core/families.js';
import { buildBundle, parseBundle, combineSessions, summarizeBundle } from '../../src/core/session.js';
import { loadData, snapshotDate } from '../fixtures/snapshotRows.js';

const snap = loadData('snapshot.json');
const plan = loadData('static-plan.json');
const opts = { multiHome: loadData('base2home-multi.json'), lcs: loadData('lcs-fleet.json'), now: snapshotDate(snap) };
const rows = rowsFromFleet(snap.fleet);
const run = (o) => analyze(rows, plan, loadData('base2home.json'), { ...opts, ...o });
const st = (out, k) => out.stations.find((s) => s.k === k);
const unit = (out, id) => out.fleet.find((f) => f.loco === id);

// a terminal with a job and >= 2 counted units sitting there, and a target terminal elsewhere
const T = snap.stations.find((s) => s.trains.length && s.have_units.filter((u) => !u[5]).length >= 2);
const [U1, U2] = T.have_units.filter((u) => !u[5]).map((u) => u[0]);
const DEST = snap.stations.find((s) => s.required > 0 && s.k !== T.k && s.lat != null);

describe('manual deadheads', () => {
  const out = run({ deadheads: { [U1]: { to: DEST.k, eta: '11/13 14:00', note: 'cover' } } });

  it('counts the unit at its destination (on the road) and not at its origin', () => {
    expect(st(out, T.k).have).toBe(st(snap, T.k).have - 1);
    expect(st(out, DEST.k).have).toBe(st(snap, DEST.k).have + 1);
    expect(st(out, DEST.k).have_road).toBe(st(snap, DEST.k).have_road + 1);
    expect(unit(out, U1)).toMatchObject({ home: DEST.k, road: true, dhTo: DEST.k });
  });

  it('adds a manual deadhead (map line + inbound list at the destination)', () => {
    const d = out.deadhead.find((x) => x.loco === U1);
    expect(d).toMatchObject({ lockey: T.k, destkey: DEST.k, eta: '11/13 14:00', notes: 'cover', manual: true });
    expect(d.lat).not.toBeNull(); expect(d.tlat).not.toBeNull();
    expect(st(out, DEST.k).inbound.map((x) => x.loco)).toContain(U1);
  });

  it('replaces a deadhead from the STP export for the same unit', () => {
    const dhUnit = snap.deadhead[0];
    const o = run({ deadheads: { [dhUnit.loco]: { to: DEST.k } } });
    const mine = o.deadhead.filter((x) => x.loco === dhUnit.loco);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ destkey: DEST.k, manual: true });
  });

  it('beats a manual assignment for the same unit', () => {
    const o = run({ assign: { [U1]: T.k }, deadheads: { [U1]: { to: DEST.k } } });
    expect(unit(o, U1).home).toBe(DEST.k);
  });
});

describe('consists', () => {
  const job = jobKey(T.trains[0]);
  const c = { id: 'C1', name: 'TEST-1', k: T.k, job, units: [U2, U1] };
  const out = run({ consists: [c] });
  const s = st(out, T.k);

  it('puts the consist units on its job, lead first, and counts them at the terminal', () => {
    const onJob = s.trains[0].units.filter((u) => u.consist === 'C1').map((u) => u.loco);
    expect(onJob).toEqual([U2, U1]);
    expect(s.have).toBe(st(snap, T.k).have);
    // the job is not overfilled: consist units count against its required types
    expect(s.trains[0].units.length).toBeLessThanOrEqual(Math.max(T.trains[0].req, 2));
  });

  it('summarises the consist: lead, approx HP, no warnings for two Available units at the terminal', () => {
    const sum = s.consists[0];
    expect(sum).toMatchObject({ id: 'C1', name: 'TEST-1', job, warnings: [] });
    expect(sum.units[0]).toMatchObject({ loco: U2, lead: true, counted: true, here: true });
    expect(sum.hp).toBe(sum.units.reduce((a, u) => a + approxHp(u.model), 0));
  });

  it('a consist at another terminal pulls its units there (weakest override)', () => {
    const o = run({ consists: [{ ...c, k: DEST.k, job: '' }] });
    expect(st(o, DEST.k).have).toBe(st(snap, DEST.k).have + 2);
    expect(st(o, DEST.k).consists[0].warnings).toEqual([]);   // same location (both at T) -> no split warning
    expect(run({ consists: [{ ...c, k: DEST.k }], assign: { [U1]: T.k } }).fleet.find((f) => f.loco === U1).home).toBe(T.k);
  });

  it('warns about split locations, units that are not Available, and slugs', () => {
    const away = snap.fleet.find((f) => f.desig === 'Available' && !f.hhp && f.k !== T.k && /^GP|^SD/.test(f.model));
    const notAvail = snap.fleet.find((f) => !f.hhp && f.desig !== 'Available');
    const slug = snap.fleet.find((f) => /^YBU|^HBU/.test(f.model));
    const w = st(run({ consists: [{ id: 'C2', k: T.k, units: [slug.loco, U1, away.loco, notAvail.loco] }] }), T.k).consists[0].warnings.join(' | ');
    expect(w).toMatch(/different locations/);
    expect(w).toMatch(/Not Available/);
    expect(w).toMatch(/slug cannot lead/);
  });

  it('no consists / deadheads leaves the snapshot byte-identical', () => {
    expect(JSON.stringify(run({ consists: [], deadheads: {} }))).toBe(JSON.stringify(snap));
  });
});

describe('approx HP', () => {
  it('knows the fleet models', () => {
    expect([approxHp('GP38-2'), approxHp('SD40-3'), approxHp('SD60'), approxHp('ES44AC'), approxHp('YBU')]).toEqual([2000, 3000, 3800, 4400, 0]);
  });
});

describe('session handoff carries deadheads and consists', () => {
  const base = { settings: {}, plan: null, assignments: {}, actionPlans: {}, snapshot: null };
  it('round-trips and summarises them', () => {
    const b = parseBundle(JSON.stringify(buildBundle({ ...base, deadheads: { X1: { to: 'A|ON' } }, consists: [{ id: 'C1', k: 'A|ON', units: ['X1', 'X2'] }] })));
    expect(b.deadheads.X1.to).toBe('A|ON');
    expect(b.consists[0].units).toEqual(['X1', 'X2']);
    expect(summarizeBundle(b, plan)).toMatchObject({ deadheads: 1, consists: 1 });
  });
  it('merge keeps a unit in one consist (incoming wins) and unions deadheads', () => {
    const mine = { ...base, deadheads: { A: { to: 'X|ON' } }, consists: [{ id: 'C1', k: 'X|ON', units: ['U1', 'U2'] }, { id: 'C2', k: 'X|ON', units: ['U3'] }] };
    const theirs = { ...base, deadheads: { B: { to: 'Y|ON' } }, consists: [{ id: 'C9', k: 'Y|ON', units: ['U2', 'U4'] }] };
    const r = combineSessions(mine, theirs, 'merge');
    expect(Object.keys(r.deadheads).sort()).toEqual(['A', 'B']);
    expect(r.consists.map((c) => [c.id, c.units])).toEqual([['C1', ['U1']], ['C2', ['U3']], ['C9', ['U2', 'U4']]]);
  });
});
