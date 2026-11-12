import { describe, it, expect } from 'vitest';
import { networkLines, distanceToNetwork, lineLengthKm, capacitySummary, CAPACITY_ORDER } from '../../src/core/network.js';
import { loadData } from '../fixtures/snapshotRows.js';

const network = loadData('cn-network.json');
const plan = loadData('static-plan.json');
const lines = networkLines(network);

describe('CN rail network (extracted from the CN weight-limitations system map)', () => {
  it('records its source and georeferencing accuracy', () => {
    expect(network.meta.source).toMatch(/Weight Limitations System Map/);
    expect(network.meta.accuracy.median_km).toBeLessThan(5);
    expect(network.meta.accuracy.max_km).toBeLessThan(20);
  });

  it('has valid, unique lines with a known capacity class', () => {
    expect(lines.length).toBeGreaterThan(100);
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
    lines.forEach((l) => {
      expect(CAPACITY_ORDER).toContain(l.capacity);
      expect(network.capacity[l.capacity]).toBeDefined();
      l.path.forEach(([lat, lng]) => { expect(lat).toBeGreaterThan(28); expect(lat).toBeLessThan(62); expect(lng).toBeGreaterThan(-132); expect(lng).toBeLessThan(-62); });
    });
  });

  it('measures a route length consistent with the CN system (~31,000 km)', () => {
    const km = lines.reduce((a, l) => a + l.km, 0);
    expect(km).toBeGreaterThan(27000);
    expect(km).toBeLessThan(36000);
    const byCap = capacitySummary(lines);
    expect(byCap['286k']).toBeGreaterThan(byCap['272k']); // most of the network is 286k
  });

  it('passes through or near the plan terminals', () => {
    const req = plan.plan.filter((s) => s.required > 0);
    const near = req.filter((s) => distanceToNetwork(lines, s.lat, s.lng).km < 10);
    expect(near.length / req.length).toBeGreaterThan(0.8); // some plan terminals are on lines CN did not operate in 2016 (e.g. Guelph sub) or have rough coordinates
  });

  it('reaches every repair shop', () => {
    plan.shops.forEach((sh) => expect([sh.code, distanceToNetwork(lines, sh.lat, sh.lng).km < 10]).toEqual([sh.code, true]));
  });

  it.each([
    ['Prince Rupert', 54.312, -130.325], ['Vancouver', 49.283, -123.12], ['Edmonton', 53.546, -113.49], ['Winnipeg', 49.895, -97.14],
    ['Toronto', 43.65, -79.38], ['Montreal', 45.5, -73.57], ['Halifax', 44.65, -63.58], ['Chicago', 41.85, -87.65],
    ['Memphis', 35.15, -90.05], ['New Orleans', 29.95, -90.07], ['Duluth', 46.78, -92.1],
  ])('runs through %s', (_, lat, lng) => {
    expect(distanceToNetwork(lines, lat, lng).km).toBeLessThan(12);
  });
});

describe('network geometry helpers', () => {
  const seg = [{ path: [[0, 0], [0, 1]] }];
  it('measures point-to-line distance and length', () => {
    expect(distanceToNetwork(seg, 0, 0.5).km).toBeCloseTo(0, 5);
    expect(distanceToNetwork(seg, 1, 0.5).km).toBeCloseTo(110.57, 1);
    expect(lineLengthKm(seg[0])).toBeCloseTo(111.32, 1);
  });
  it('attaches capacity metadata and drops degenerate lines', () => {
    const r = networkLines({ capacity: { '286k': { label: '286,000 lb', cars: 'x' } }, lines: [{ id: 'a', capacity: '286k', path: [[0, 0], [0, 1]] }, { id: 'b', capacity: '286k', path: [[0, 0]] }] });
    expect(r.map((l) => l.id)).toEqual(['a']);
    expect(r[0].capacityInfo.label).toBe('286,000 lb');
  });
});
