/**
 * Rebuild an STP-shaped export from the baked snapshot's fleet records, so the analysis engine
 * can be regression-tested against real data without shipping the raw STP CSV.
 * (Fields not carried in the fleet records — inspection dates, ETAs, notes — are left blank.)
 */
import { readFileSync } from 'node:fs';

export const loadData = (f) => JSON.parse(readFileSync(new URL('../../data/' + f, import.meta.url), 'utf8'));

/**
 * Frozen 2026-09-23 snapshot: the unit tests' expected values are pinned to it, so refreshing
 * data/snapshot.json with a newer STP export does not change them.
 */
export const loadFixtureSnapshot = () => JSON.parse(readFileSync(new URL('./snapshot-2026-09-23.json', import.meta.url), 'utf8'));
export const SNAPSHOT_DATE = new Date(2026, 8, 23); // fixture meta.snapshot

/** Snapshot date of a snapshot object, as a local-midnight Date. */
export function snapshotDate(snap) {
  const [y, m, d] = String(snap.meta.snapshot).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function rowsFromSnapshot(snapshot, now = SNAPSHOT_DATE) {
  return snapshot.fleet.map((f) => ({
    'Loco ID': f.loco, 'Current Location': f.loc, 'Loco Model': f.model, 'Loco Type': f.t,
    OpCode: f.op, Designation: f.desig, 'Train ID': f.train, Destination: f.dest, Shop: f.shop, ETR: f.etr,
    'Since in OpCode': f.sinceD == null ? '' : iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - f.sinceD)),
  }));
}
