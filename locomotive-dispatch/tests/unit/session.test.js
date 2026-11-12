import { describe, it, expect } from 'vitest';
import { buildBundle, parseBundle, summarizeBundle, combineSessions, SESSION_VERSION } from '../../src/core/session.js';
import { createActionStore } from '../../src/core/store.js';
import { clonePlan, normalizeStation, updateOverrides } from '../../src/core/planEdit.js';
import { analyze, rowsFromFleet } from '../../src/core/analyze.js';
import { loadData, snapshotDate } from '../fixtures/snapshotRows.js';

const plan = loadData('static-plan.json');
const snap = loadData('snapshot.json');
const b2h = loadData('base2home.json');

function editedPlan() {
  const p = clonePlan(plan);
  const i = p.plan.findIndex((s) => s.k === 'BRANTFORD|ON');
  const t = p.plan[i].trains.map((x) => ({ ...x, types: x.types.map((y) => [...y]) }));
  t[0].types[0][1] = 1;
  p.plan[i] = normalizeStation({ ...p.plan[i], trains: t }, p.plan[i].required);
  return updateOverrides(p, b2h, 'HALIFAX|NS', [], ['Y542111']);
}
const session = () => ({
  settings: { theme: 'dark', demandDay: 2 },
  plan: editedPlan(),
  assignments: { CN4138: { k: 'HALIFAX|NS', note: 'cover', at: '2026-11-12T10:00:00Z', from: 'HALIFAX|NS' } },
  actionPlans: { 'short:EDMONTON|AB': 'send 2 from Clover Bar', 'short:EDMONTON|AB:done': '1', 'xfer:CHI>WAT': 'ok', 'not-an-action': 'x', 'dead:CN1:done': '' },
  snapshot: snap,
});

describe('session bundle', () => {
  it('round-trips through JSON with everything a handoff needs', () => {
    const b = parseBundle(JSON.stringify(buildBundle({ ...session(), by: 'Tim', note: 'night shift' })));
    expect(b).toMatchObject({ app: 'cn-locomotive-dispatch', kind: 'session', version: SESSION_VERSION, by: 'Tim', note: 'night shift' });
    expect(b.settings).toEqual({ theme: 'dark', demandDay: 2 });
    expect(b.plan.plan.find((s) => s.k === 'BRANTFORD|ON').required).toBe(1);
    expect(b.plan.meta.base2home_overrides).toEqual({ Y54211: 'HALIFAX|NS' });
    expect(b.assignments.CN4138.k).toBe('HALIFAX|NS');
    // only action keys with values travel
    expect(Object.keys(b.actionPlans).sort()).toEqual(['short:EDMONTON|AB', 'short:EDMONTON|AB:done', 'xfer:CHI>WAT']);
    expect(b.snapshot.fleet.length).toBe(snap.fleet.length);
  });

  it('carries the snapshot losslessly: re-analysis from the bundle equals the source', () => {
    const b = parseBundle(JSON.stringify(buildBundle(session())));
    const opts = { multiHome: loadData('base2home-multi.json'), lcs: loadData('lcs-fleet.json'), now: snapshotDate(b.snapshot) };
    const out = analyze(rowsFromFleet(b.snapshot.fleet), plan, b2h, opts);
    expect(JSON.stringify(out)).toBe(JSON.stringify(snap));
  });

  it('can leave the snapshot out', () => {
    expect(buildBundle({ ...session(), snapshot: null }).snapshot).toBeNull();
  });

  it('summarises what it contains', () => {
    const sum = summarizeBundle(buildBundle(session()), plan);
    expect(sum).toMatchObject({ planLocations: 1, trainRehomes: 1, assignments: 1, actionPlans: 2, resolved: 1,
      theme: 'dark', demandDay: 2, snapshotDate: snap.meta.snapshot, lossless: true });
  });

  it('rejects files that are not session files, with a useful message', () => {
    expect(() => parseBundle('{nope')).toThrow(/Not a JSON file/);
    expect(() => parseBundle(JSON.stringify({ hello: 1 }))).toThrow(/Not a dispatch session file/);
    expect(() => parseBundle(JSON.stringify(plan))).toThrow(/captive-plan file/);
    expect(() => parseBundle(JSON.stringify({ ...buildBundle(session()), version: 99 }))).toThrow(/newer version/);
  });
});

describe('combining sessions', () => {
  const mine = { settings: { theme: 'light', demandDay: null }, plan: null,
    assignments: { A: { k: 'X|ON' }, B: { k: '' } }, actionPlans: { 'short:X|ON': 'mine', 'dead:Q': 'mine' }, snapshot: null };
  const theirs = { settings: { theme: 'dark', demandDay: 3 }, plan: editedPlan(),
    assignments: { B: { k: 'Y|ON' }, C: { k: 'Z|ON' } }, actionPlans: { 'short:X|ON': 'theirs' }, snapshot: null };

  it('replace: the incoming session wins wholesale', () => {
    const r = combineSessions(mine, theirs, 'replace');
    expect(Object.keys(r.assignments).sort()).toEqual(['B', 'C']);
    expect(r.actionPlans).toEqual({ 'short:X|ON': 'theirs' });
    expect(r.settings.theme).toBe('dark');
  });

  it('merge: assignments and action plans are unioned, incoming wins on conflict', () => {
    const r = combineSessions(mine, theirs, 'merge');
    expect(r.assignments).toEqual({ A: { k: 'X|ON' }, B: { k: 'Y|ON' }, C: { k: 'Z|ON' } });
    expect(r.actionPlans).toEqual({ 'short:X|ON': 'theirs', 'dead:Q': 'mine' });
    expect(r.plan).toBe(theirs.plan);
  });

  it('merge keeps my plan when the incoming session has none', () => {
    const p = editedPlan();
    expect(combineSessions({ ...mine, plan: p }, { ...theirs, plan: null }, 'merge').plan).toBe(p);
  });
});

describe('action store listing', () => {
  it('lists and removes action plans, ignoring other keys', () => {
    const mem = {};
    const storage = { get length() { return Object.keys(mem).length; }, key: (i) => Object.keys(mem)[i],
      getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
    const st = createActionStore(storage);
    st.set('short:A|ON', 'plan'); st.set('short:A|ON:done', '1'); st.set('insp:U@A|ON:done', ''); mem['cn-dispatch.theme'] = 'dark';
    expect(st.entries()).toEqual({ 'short:A|ON': 'plan', 'short:A|ON:done': '1' });
    st.remove('short:A|ON');
    expect(st.entries()).toEqual({ 'short:A|ON:done': '1' });
  });
});
