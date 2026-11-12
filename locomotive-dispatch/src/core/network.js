/**
 * CN rail network geometry (data/cn-network.json).
 *
 * Lines are ordered waypoint chains. A waypoint is either a plan station key (resolved to that
 * station's coordinates, so lines pass exactly through the plan terminals) or a named place.
 */

/**
 * Resolve every line to a coordinate path.
 * @param network   parsed cn-network.json
 * @param stations  anything with {k, lat, lng} (plan or analysed stations)
 * @returns {{ lines: Array<{id, name, class, path: number[][], stations: string[]}>, unresolved: string[] }}
 */
export function resolveNetwork(network, stations) {
  const byKey = {};
  (stations || []).forEach((s) => { if (s.lat != null && s.lng != null) byKey[s.k] = [s.lat, s.lng]; });
  const unresolved = new Set();
  const lines = (network.lines || []).map((ln) => {
    const path = [], onLine = [];
    ln.via.forEach((v) => {
      const pt = byKey[v] || (network.places || {})[v];
      if (!pt) { unresolved.add(v); return; }
      if (byKey[v]) onLine.push(v);
      path.push(pt);
    });
    return { id: ln.id, name: ln.name, class: ln.class || 'secondary', path, stations: onLine };
  });
  return { lines: lines.filter((l) => l.path.length >= 2), unresolved: [...unresolved] };
}

/** Approximate distance (km) from a point to a segment, on a local equirectangular projection. */
function pointSegmentKm(p, a, b) {
  const kx = 111.32 * Math.cos((p[0] * Math.PI) / 180), ky = 110.57;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Distance (km) from a point to the nearest line of a resolved network, and which line. */
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

/** Route length (km) of a resolved line. */
export function lineLengthKm(line) {
  let km = 0;
  for (let i = 1; i < line.path.length; i++) km += pointSegmentKm(line.path[i - 1], line.path[i], line.path[i]);
  return km;
}
