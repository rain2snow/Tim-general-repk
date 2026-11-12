import { describe, it, expect } from 'vitest';
import { resolveNetwork, distanceToNetwork, lineLengthKm } from '../../src/core/network.js';
import { loadData } from '../fixtures/snapshotRows.js';

const network = loadData('cn-network.json');
const plan = loadData('static-plan.json');
const { lines, unresolved } = resolveNetwork(network, plan.plan);

describe('CN rail network data', () => {
  it('resolves every waypoint (plan station key or named place)', () => {
    expect(unresolved).toEqual([]);
    expect(lines).toHaveLength(network.lines.length);
  });

  it('has unique ids and a valid class on every line', () => {
    expect(new Set(network.lines.map((l) => l.id)).size).toBe(network.lines.length);
    network.lines.forEach((l) => expect(['main', 'secondary']).toContain(l.class));
  });

  it('runs through every plan terminal that carries a requirement (within 5 km)', () => {
    const off = plan.plan.filter((s) => s.required > 0)
      .map((s) => [s.k, Math.round(distanceToNetwork(lines, s.lat, s.lng).km)]).filter(([, km]) => km > 5);
    expect(off).toEqual([]);
  });

  it('reaches every repair shop', () => {
    plan.shops.forEach((sh) => expect([sh.code, distanceToNetwork(lines, sh.lat, sh.lng).km < 5]).toEqual([sh.code, true]));
  });

  it('forms a connected network apart from the isolated B&LE', () => {
    // union lines that share a waypoint
    const parent = lines.map((_, i) => i);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const owner = {};
    network.lines.forEach((l, i) => l.via.forEach((v) => { if (v in owner) parent[find(i)] = find(owner[v]); else owner[v] = i; }));
    const groups = {};
    network.lines.forEach((l, i) => (groups[find(i)] = groups[find(i)] || []).push(l.id));
    const small = Object.values(groups).filter((g) => g.length < 10);
    expect(small).toEqual([['ble']]);
  });

  it('measures route length in a realistic range for the CN system', () => {
    const km = lines.reduce((a, l) => a + lineLengthKm(l), 0);
    expect(km).toBeGreaterThan(20000);
    expect(km).toBeLessThan(35000);
  });
});

describe('network geometry helpers', () => {
  const sq = [{ path: [[0, 0], [0, 1]] }];
  it('measures point-to-line distance', () => {
    expect(distanceToNetwork(sq, 0, 0.5).km).toBeCloseTo(0, 5);
    expect(distanceToNetwork(sq, 1, 0.5).km).toBeCloseTo(110.57, 1);
  });
  it('resolves plan keys ahead of place names and reports missing ones', () => {
    const r = resolveNetwork({ places: { P: [1, 1] }, lines: [{ id: 'x', name: 'X', via: ['A|ON', 'P', 'NOPE'] }] }, [{ k: 'A|ON', lat: 0, lng: 0 }]);
    expect(r.lines[0].path).toEqual([[0, 0], [1, 1]]);
    expect(r.lines[0].stations).toEqual(['A|ON']);
    expect(r.unresolved).toEqual(['NOPE']);
  });
});
