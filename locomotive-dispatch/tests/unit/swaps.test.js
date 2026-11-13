import { describe, it, expect } from 'vitest';
import { analyze, rowsFromFleet } from '../../src/core/analyze.js';
import { buildHubModel } from '../../src/core/hubs.js';
import { hubTerminals, suggestSwap, swapDeadheads, swapSummary, swapCandidates, committedUnits, nextSwapId, inspectionDays, snapshotNow, SWAP_FIT_DAYS } from '../../src/core/swaps.js';
import { buildBundle, parseBundle, combineSessions, summarizeBundle } from '../../src/core/session.js';
import { loadData, snapshotDate } from '../fixtures/snapshotRows.js';

const snap = loadData('snapshot.json');
const plan = loadData('static-plan.json');
const hm = buildHubModel(snap, loadData('hubs.json'));
const opts = { multiHome: loadData('base2home-multi.json'), lcs: loadData('lcs-fleet.json'), now: snapshotDate(snap) };
const rows = rowsFromFleet(snap.fleet);
const run = (o) => analyze(rows, plan, loadData('base2home.json'), { ...opts, ...o });
const st = (out, k) => out.stations.find((s) => s.k === k);

// a spoke (not a hub terminal) with inspections due and a suggestion that finds replacements
const pick = snap.stations.filter((s) => (s.insp || []).length).map((s) => {
  const hub = hm.byId[hm.stationHub[s.k]];
  return { s, hub, sug: hub ? suggestSwap(snap, hub, s.k) : null };
}).find((x) => x.sug && x.sug.toHub.length && x.sug.toSpoke.length && x.sug.base !== x.s.k);
const { s: SPOKE, hub: HUB, sug: SUG } = pick;

describe('hub terminals', () => {
  it('maps each shop to the yard it works from', () => {
    const t = (id) => hubTerminals(hm.byId[id], snap.stations);
    expect(t('TOR')).toEqual(['TORMACYAR|ON']);
    expect(t('EDM')).toEqual(['EDMONTON|AB']);          // nearest station with a plan, not EEDMONTON (no plan)
    expect(t('CHI')).toEqual(['KIRYARD|IN', 'MARKHAM|IL']);
  });
});

describe('suggested swap', () => {
  it('sends the spoke units due for inspection to the hub terminal and brings fit units back', () => {
    const due = SPOKE.insp.map((u) => u.loco);
    expect(SUG.base).toBe(hubTerminals(HUB, snap.stations)[0]);
    SUG.toHub.forEach((l) => expect(due.concat(snap.fleet.filter((f) => f.k === SPOKE.k).map((f) => f.loco))).toContain(l));
    const now = snapshotNow(snap), byLoco = Object.fromEntries(snap.fleet.map((f) => [f.loco, f]));
    SUG.toSpoke.forEach((l) => {
      const f = byLoco[l];
      expect(f.k).toBe(SUG.base);
      expect(f.desig).toBe('Available');
      const d = inspectionDays(f, now);
      expect(d == null || d > SWAP_FIT_DAYS).toBe(true);
    });
    expect(new Set(SUG.toSpoke).size).toBe(SUG.toSpoke.length);
  });
  it('is empty when the spoke is the hub terminal itself', () => {
    const base = hubTerminals(HUB, snap.stations)[0];
    expect(suggestSwap(snap, HUB, base)).toMatchObject({ toHub: [], toSpoke: [] });
  });
  it('skips units already committed to other plans, deadheads or consists', () => {
    const busy = SUG.toSpoke[0];
    const again = suggestSwap(snap, HUB, SPOKE.k, { ops: { deadheads: { [busy]: { to: 'X|ON' } } } });
    expect(again.toSpoke).not.toContain(busy);
    expect(committedUnits({ swaps: [{ id: 'W1', toHub: ['A'], toSpoke: ['B'] }], consists: [{ units: ['C'] }], deadheads: { D: {}, E: { swap: 'W1' } } }, null))
      .toEqual(new Set(['D', 'A', 'B', 'C']));
  });
  it('candidates rank family matches first', () => {
    const all = swapCandidates(snap, SPOKE.k, SUG.base).toSpoke;
    const fam = all[all.length - 1].fam;                          // the least preferred family by default
    const c = swapCandidates(snap, SPOKE.k, SUG.base, { wantFams: [fam] });
    expect(c.toHub[0].due).toBe(true);                            // due units first on the outgoing side
    expect(c.toSpoke.every((u) => u.counted)).toBe(true);
    const firstOther = c.toSpoke.findIndex((u) => u.fam !== fam);
    expect(c.toSpoke.slice(firstOther < 0 ? c.toSpoke.length : firstOther).some((u) => u.fam === fam)).toBe(false);
  });
});

describe('swap plans in the engine', () => {
  const w = { id: 'W1', hub: HUB.id, spoke: SPOKE.k, base: SUG.base, toHub: SUG.toHub, toSpoke: SUG.toSpoke, eta: '11/14 06:00', note: '' };
  const out = run({ deadheads: swapDeadheads([w]) });

  it('expands into tagged deadheads both ways', () => {
    const dh = swapDeadheads([w]);
    w.toHub.forEach((l) => expect(dh[l]).toMatchObject({ to: w.base, swap: 'W1', eta: '11/14 06:00' }));
    w.toSpoke.forEach((l) => expect(dh[l]).toMatchObject({ to: w.spoke, swap: 'W1' }));
    const recs = out.deadhead.filter((d) => d.swap === 'W1');
    expect(recs.length).toBe(w.toHub.length + w.toSpoke.length);
    expect(st(out, w.spoke).inbound.filter((d) => d.swap === 'W1').map((d) => d.loco).sort()).toEqual([...w.toSpoke].sort());
  });

  it('an even swap keeps the spoke count; the hub terminal changes by the difference', () => {
    const sum = swapSummary(w, out);
    expect(st(out, w.spoke).have - st(snap, w.spoke).have).toBe(sum.net);
    if (sum.net === 0) expect(sum.warnings.filter((x) => /loses/.test(x))).toEqual([]);
  });

  it('warns when the spoke loses power or a unit is not where the plan says', () => {
    const lop = swapSummary({ ...w, toSpoke: [] }, snap);
    expect(lop.net).toBeLessThan(0);
    expect(lop.warnings.join(' ')).toMatch(/loses/);
    const elsewhere = snap.fleet.find((f) => f.k !== w.spoke && f.k !== w.base && f.desig === 'Available' && !f.hhp);
    expect(swapSummary({ ...w, toHub: [elsewhere.loco] }, snap).warnings.join(' ')).toMatch(/Not at/);
  });

  it('ids', () => { expect(nextSwapId([{ id: 'W1' }, { id: 'W7' }])).toBe('W8'); expect(nextSwapId([])).toBe('W1'); });
});

describe('session handoff carries swap plans', () => {
  const base = { settings: {}, plan: null, assignments: {}, actionPlans: {}, snapshot: null };
  it('round-trips, summarises, merges keeping each unit in one plan', () => {
    const b = parseBundle(JSON.stringify(buildBundle({ ...base, swaps: [{ id: 'W1', hub: 'TOR', spoke: 'A|ON', base: 'B|ON', toHub: ['X'], toSpoke: ['Y'] }] })));
    expect(b.swaps[0]).toMatchObject({ id: 'W1', toHub: ['X'], toSpoke: ['Y'] });
    expect(summarizeBundle(b, plan).swaps).toBe(1);
    const mine = { ...base, swaps: [{ id: 'W1', spoke: 'A|ON', base: 'B|ON', toHub: ['X', 'Z'], toSpoke: [] }, { id: 'W2', spoke: 'C|ON', base: 'B|ON', toHub: ['Q'], toSpoke: [] }] };
    const theirs = { ...base, swaps: [{ id: 'W5', spoke: 'A|ON', base: 'B|ON', toHub: ['X'], toSpoke: ['Y'] }] };
    expect(combineSessions(mine, theirs, 'merge').swaps.map((w) => [w.id, w.toHub])).toEqual([['W1', ['Z']], ['W2', ['Q']], ['W5', ['X']]]);
    expect(() => parseBundle(JSON.stringify({ ...buildBundle(base), swaps: [{ id: 'W1' }] }))).toThrow(/swaps/);
  });
});
