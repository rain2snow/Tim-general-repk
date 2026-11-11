import { describe, it, expect } from 'vitest';
import { parseCSV, csvCellMinimal, csvCellQuoted } from '../../src/core/csv.js';
import { parseDate, dayDiff, isoDate, formatSnapshotLabel } from '../../src/core/dates.js';
import { keyOf, keyName, trainBase } from '../../src/core/keys.js';
import { planFamily, actionFamily, typeBase } from '../../src/core/families.js';
import { haversineKm, nearestShop, schematicCorridors } from '../../src/core/geo.js';
import { esc } from '../../src/core/html.js';
import { searchLocos } from '../../src/core/search.js';

describe('csv', () => {
  it('parses quoted fields, escaped quotes, CRLF and a BOM', () => {
    const rows = parseCSV('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,,\n');
    expect(rows).toEqual([{ a: '1', b: 'x, y', c: 'say "hi"' }, { a: '2', b: '', c: '' }]);
  });
  it('fills missing trailing cells', () => {
    expect(parseCSV('a,b\n1')).toEqual([{ a: '1', b: '' }]);
  });
  it('quotes cells for export', () => {
    expect(csvCellMinimal('a,b')).toBe('"a,b"');
    expect(csvCellMinimal('plain')).toBe('plain');
    expect(csvCellQuoted('x"y')).toBe('"x""y"');
  });
});

describe('dates', () => {
  it.each([
    ['2026-09-23 14:00', [2026, 8, 23]], ['9/23/2026', [2026, 8, 23]], ['2026/09/23', [2026, 8, 23]], ['9/23/26', [2026, 8, 23]],
  ])('parses %s', (s, [y, m, d]) => expect(parseDate(s)).toEqual(new Date(y, m, d)));
  it('rejects junk', () => { expect(parseDate('soon')).toBeNull(); expect(parseDate('')).toBeNull(); });
  it('diffs and formats', () => {
    expect(dayDiff(new Date(2026, 0, 3), new Date(2026, 0, 1))).toBe(2);
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatSnapshotLabel('2026-09-23')).toBe('09/23/2026');
  });
});

describe('keys', () => {
  it('normalises STP locations to plan keys (QC -> PQ)', () => {
    expect(keyOf('SENNETERR  QC')).toBe('SENNETERR|PQ');
    expect(keyOf('edmonton   AB')).toBe('EDMONTON|AB');
    expect(keyName('SENNETERR, QC')).toBe('SENNETERR|PQ');
    expect(trainBase(' L550311-15 ')).toBe('L550311');
  });
});

describe('families', () => {
  it('classifies models for plan matching', () => {
    expect(['SD60M', 'SD40-2', 'SD38-2', 'GP40-3', 'GP40-2', 'GP9-RM', 'GP38-2', 'YBU', 'ES44AC'].map(planFamily))
      .toEqual(['SD60', 'SD40', 'SD38', 'SD40', 'GP40', 'GP9/GP38', 'GP9/GP38', 'CALF', null]);
  });
  it('classifies models for action planning (stricter)', () => {
    expect(['GP40-3', 'YBU', 'CALF'].map(actionFamily)).toEqual(['GP40', null, 'CALF']);
    expect(typeBase('SD60 LCS')).toBe('SD60');
  });
});

describe('geo', () => {
  it('measures distance and picks the nearest shop', () => {
    expect(Math.round(haversineKm([0, 0], [0, 1]))).toBe(111);
    expect(haversineKm(null, [0, 0])).toBe(1e9);
    const shops = [{ code: 'A', lat: 50, lng: -100 }, { code: 'B', lat: 45, lng: -80 }];
    expect(nearestShop(shops, 44, -79).code).toBe('B');
  });
  it('links nearby stations into schematic corridors without duplicates', () => {
    const pairs = schematicCorridors([[0, 0], [0, 1], [0, 2], [40, 40]]);
    expect(pairs).toEqual([[0, 1], [0, 2], [1, 2]]);
  });
});

describe('misc', () => {
  it('escapes HTML', () => expect(esc('<a&b>')).toBe('&lt;a&amp;b&gt;'));
  it('searches loco ids, prefix matches first', () => {
    const idx = { CN4701: 1, CN4702: 1, GTW4701: 1, BLE904: 1 };
    expect(searchLocos(idx, 'cn47')).toEqual(['CN4701', 'CN4702']);
    expect(searchLocos(idx, '4701')).toEqual(['CN4701', 'GTW4701']);
    expect(searchLocos(idx, ' ')).toEqual([]);
  });
});
