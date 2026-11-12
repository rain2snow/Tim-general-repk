/**
 * CN rail network geometry (data/cn-network.json).
 *
 * Built by scripts/network/build_cn_network.py from CN's Weight Limitations System Map
 * (rev. 7/2016): each line is a georeferenced polyline carrying its maximum-gross-weight class
 * ("capacity") and the corridor it belongs to.
 */

/** Display order + styling hints per capacity class (heaviest first). */
export const CAPACITY_ORDER = ['286k', '272k', '268k', '263k', 'lt263k', 'rights'];

/** Lines with their path, capacity metadata and length. */
export function networkLines(network) {
  const caps = network.capacity || {};
  return (network.lines || [])
    .filter((l) => l.path && l.path.length >= 2)
    .map((l) => ({ ...l, capacityInfo: caps[l.capacity] || { label: l.capacity, cars: '' }, km: lineLengthKm(l) }));
}

/** Approximate distance (km) from a point to a segment, on a local equirectangular projection. */
function pointSegmentKm(p, a, b) {
  const kx = 111.32 * Math.cos((p[0] * Math.PI) / 180), ky = 110.57;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Distance (km) from a point to the nearest line, and which line. */
export function distanceToNetwork(lines, lat, lng) {
  let best = Infinity, line = null;
  for (const l of lines) {
    for (let i = 1; i < l.path.length; i++) {
      const d = pointSegmentKm([lat, lng], l.path[i - 1], l.path[i]);
      if (d < best) { best = d; line = l; }
    }
  }
  return { km: best, line };
}

/** Route length (km) of a line. */
export function lineLengthKm(line) {
  let km = 0;
  for (let i = 1; i < line.path.length; i++) km += pointSegmentKm(line.path[i - 1], line.path[i], line.path[i]);
  return km;
}

/** Route-km per capacity class. */
export function capacitySummary(lines) {
  const out = {};
  lines.forEach((l) => { out[l.capacity] = (out[l.capacity] || 0) + (l.km ?? lineLengthKm(l)); });
  return out;
}
