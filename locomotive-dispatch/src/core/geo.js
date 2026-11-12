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
