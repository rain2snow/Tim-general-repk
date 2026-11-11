/**
 * Rebuild an STP-shaped export from the baked snapshot's fleet records, so the analysis engine
 * can be regression-tested against real data without shipping the raw STP CSV.
 * (Fields not carried in the fleet records — inspection dates, ETAs, notes — are left blank.)
 */
import { readFileSync } from 'node:fs';

export const loadData = (f) => JSON.parse(readFileSync(new URL('../../data/' + f, import.meta.url), 'utf8'));

export const SNAPSHOT_DATE = new Date(2026, 8, 23); // data/snapshot.json meta.snapshot

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function rowsFromSnapshot(snapshot, now = SNAPSHOT_DATE) {
  return snapshot.fleet.map((f) => ({
    'Loco ID': f.loco, 'Current Location': f.loc, 'Loco Model': f.model, 'Loco Type': f.t,
    OpCode: f.op, Designation: f.desig, 'Train ID': f.train, Destination: f.dest, Shop: f.shop, ETR: f.etr,
    'Since in OpCode': f.sinceD == null ? '' : iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - f.sinceD)),
  }));
}
