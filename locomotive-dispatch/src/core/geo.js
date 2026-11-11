/** Great-circle distance in km; 1e9 when either point is missing. */
export function haversineKm(a, b) {
  if (!a || !b || a[0] == null || b[0] == null) return 1e9;
  const R = 6371, toR = Math.PI / 180;
  const dLa = (b[0] - a[0]) * toR, dLo = (b[1] - a[1]) * toR, la1 = a[0] * toR, la2 = b[0] * toR;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function nearestShop(shops, lat, lng) {
  let best = null, bd = 1e9;
  (shops || []).forEach((sh) => {
    if (sh.lat == null) return;
    const d = haversineKm([lat, lng], [sh.lat, sh.lng]);
    if (d < bd) { bd = d; best = sh; }
  });
  return best;
}

export const shopByCode = (shops, code) => (shops || []).find((x) => x.code === code) || null;

/**
 * Schematic rail corridors: link each station to its 2 nearest neighbours within a
 * latitude-corrected squared-degree cap. Returns unique [a, b] index pairs into `points`.
 */
export function schematicCorridors(points, cap = 10.24, neighbours = 2) {
  const n = points.length, seen = new Set(), out = [];
  if (n < 2) return out;
  const d2 = (a, b) => {
    const c = Math.cos(((a[0] + b[0]) * Math.PI) / 360), dx = (a[1] - b[1]) * c, dy = a[0] - b[0];
    return dx * dx + dy * dy;
  };
  for (let i = 0; i < n; i++) {
    const o = [];
    for (let j = 0; j < n; j++) if (j !== i) { const w = d2(points[i], points[j]); if (w <= cap) o.push([w, j]); }
    o.sort((a, b) => a[0] - b[0]);
    for (let m = 0; m < o.length && m < neighbours; m++) {
      const a = Math.min(i, o[m][1]), b = Math.max(i, o[m][1]), key = a + '_' + b;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  }
  return out;
}
