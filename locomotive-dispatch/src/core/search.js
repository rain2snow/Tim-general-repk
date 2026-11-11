/** Loco-id search: prefix matches first, then substring matches, each sorted; capped. */
export function searchLocos(locoIndex, query, limit = 10) {
  const s = (query || '').trim().toUpperCase();
  if (!s) return [];
  const starts = [], contains = [];
  for (const k of Object.keys(locoIndex)) {
    if (k.indexOf(s) === 0) starts.push(k);
    else if (k.indexOf(s) > -1) contains.push(k);
  }
  starts.sort(); contains.sort();
  return starts.concat(contains).slice(0, limit);
}
