import { stationStatus, repoolSharedGroups } from './pools.js';

/**
 * Switch the demand basis between peak (day = null) and a day of week (0 = Sunday).
 * Each plan station carries `rbd` (required-by-day) and `req_all` (peak). Mutates stations.
 */
export function applyDemandDay(stations, day) {
  (stations || []).forEach((s) => {
    s.required = day == null || !s.rbd ? (s.req_all != null ? s.req_all : s.required) : s.rbd[day];
    s.shortfall = Math.max(0, s.required - s.have);
    s.status = stationStatus(s);
  });
  repoolSharedGroups(stations || []);
  return stations;
}
