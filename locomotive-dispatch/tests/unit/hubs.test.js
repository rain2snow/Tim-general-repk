import { describe, it, expect } from 'vitest';
import { buildHubModel, assignStationsToHubs, resolveHubs, stationShortSurplus, hubSeverity, UNASSIGNED_HUB } from '../../src/core/hubs.js';
import { buildQueueActions } from '../../src/core/queue.js';
import { computeRetask, buildLocoIndex } from '../../src/core/planning.js';
import { applyDemandDay } from '../../src/core/demand.js';
import { loadData, loadFixtureSnapshot } from '../fixtures/snapshotRows.js';

const config = loadData('hubs.json');
const fresh = () => loadFixtureSnapshot();
const model = (data = fresh()) => buildHubModel(data, config, { retask: computeRetask(data.stations, buildLocoIndex(data.fleet)) });

describe('hub assignment', () => {
  const data = fresh();
  const hubs = resolveHubs(config, data.shops);
  const assign = assignStationsToHubs(data.stations, hubs);

  it('every configured shop exists and every station gets a hub', () => {
    expect(hubs).toHaveLength(config.hubs.length);
    data.stations.forEach((s) => expect(hubs.map((h) => h.id)).toContain(assign[s.k]));
  });

  it('assigns each hub the zone its shop sits in', () => {
    expect(assign['TORMACYAR|ON']).toBe('TOR');
    expect(assign['MONTASYAR|PQ']).toBe('MTL');
    expect(assign['WINSYMYAR|MB']).toBe('WPG');
    expect(assign['KIRYARD|IN']).toBe('CHI');
    expect(assign['MEMPHIS|TN']).toBe('MEM');
  });

  it('splits a zone shared by two hubs by nearest shop', () => {
    // LAKE is owned by Duluth (Proctor) and Stevens Point; IOWA by Chicago and Waterloo
    expect(assign['PROCTOR|MN']).toBe('DUL');
    expect(assign['WISRAPIDS|WI']).toBe('STP');
    expect(assign['GLEYARD|IL']).toBe('CHI');
    expect(assign['SIOCITY|IA']).toBe('WAT');
  });
});

describe('hub regions', () => {
  it('places every hub in East, West or South', () => {
    const m = model();
    expect(m.hubs.map((b) => b.region).every((r) => ['East', 'West', 'South'].includes(r))).toBe(true);
    expect(m.byId.TOR.region).toBe('East');
    expect(m.byId.EDM.region).toBe('West');
    expect(m.byId.CHI.region).toBe('South');
  });

  it('falls back to the majority region of the hub’s stations', () => {
    const data = fresh();
    const noRegion = { hubs: config.hubs.map(({ region, ...h }) => h) };
    const m = buildHubModel(data, noRegion);
    expect(m.byId.MTL.region).toBe('East');
    expect(m.byId.VAN.region).toBe('West');
    expect(m.byId.MEM.region).toBe('South');
  });
});

describe('hub balance', () => {
  const m = model();

  it('counts a shared pool once, at its primary', () => {
    const s = { k: 'B', grp_members: ['A', 'B'], grp_primary: 'A', shortfall: 0, grp_net: -2 };
    expect(stationShortSurplus(s)).toEqual({ short: 0, surplus: 0 });
    expect(stationShortSurplus({ ...s, k: 'A', shortfall: 2 })).toEqual({ short: 2, surplus: 0 });
  });

  it('covers in hub before escalating, and the books balance', () => {
    m.hubs.forEach((b) => {
      expect(b.cover).toBe(Math.min(b.short, b.surplus));
      expect(b.residualShort * b.residualSurplus).toBe(0); // a hub is never both short and spare after cover
    });
    const sys = m.strategic.system;
    expect(sys.coveredInHub + sys.residualShort).toBe(sys.short);
  });

  it('tactical cover plan leaves exactly the strategic deficit uncovered', () => {
    const uncovered = Object.values(m.coverPlan).reduce((a, p) => a + p.uncovered, 0);
    expect(uncovered).toBe(m.strategic.system.residualShort);
  });

  it('never allocates more from a donor than it can spare', () => {
    const used = {};
    Object.values(m.coverPlan).forEach((p) => p.from.forEach((f) => { used[f.k] = (used[f.k] || 0) + f.units; }));
    const data = fresh();
    Object.entries(used).forEach(([k, n]) => expect(n).toBeLessThanOrEqual(stationShortSurplus(data.stations.find((s) => s.k === k)).surplus));
  });
});

describe('tactical actions', () => {
  const data = fresh();
  const m = model(data);
  const all = Object.values(m.tactical).flat();

  it('places every console action in exactly one hub', () => {
    const base = buildQueueActions(data, computeRetask(data.stations, buildLocoIndex(data.fleet)));
    expect(all.map((a) => a.actid).sort()).toEqual(base.map((a) => a.actid).sort());
    expect(m.tactical[UNASSIGNED_HUB.id]).toEqual([]);
  });

  it('gives shortages an in-hub cover or an escalation, and inspections a hub shop', () => {
    all.filter((a) => a.actid.startsWith('short:')).forEach((a) => expect(a.hint).toMatch(/Cover in hub|escalated|Shared pool/));
    all.filter((a) => a.actid.startsWith('insp:')).forEach((a) => expect(a.hint).toMatch(/^Swap into /));
  });

  it('orders hubs that cannot cover themselves first', () => {
    const bal = m.byId.WAT;
    expect(hubSeverity(bal, m.tactical.WAT)[0]).toBe(bal.residualShort);
    expect(bal.residualShort).toBeGreaterThan(0);
  });
});

describe('strategic transfers', () => {
  it('moves residual surplus to residual deficit without overdrawing a hub', () => {
    const m = model();
    const out = {}, inn = {};
    m.strategic.transfers.forEach((t) => {
      if (t.from) out[t.from] = (out[t.from] || 0) + t.units;
      inn[t.to] = (inn[t.to] || 0) + t.units;
      expect(t.actid).toMatch(/^xfer:/);
    });
    Object.entries(out).forEach(([h, n]) => expect(n).toBeLessThanOrEqual(m.byId[h].residualSurplus));
    m.hubs.filter((b) => b.residualShort > 0).forEach((b) => expect(inn[b.id]).toBe(b.residualShort));
  });

  it('follows the day-of-week demand basis', () => {
    const peak = model().strategic.system;
    const data = fresh();
    applyDemandDay(data.stations, 0); // Sunday: lighter plan
    const sun = model(data).strategic.system;
    expect(sun.required).toBeLessThanOrEqual(peak.required);
  });
});
