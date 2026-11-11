/** Date parsing for the mixed formats found in STP exports. Dates are local, midnight-based. */

export function parseDate(s) {
  s = (s || '').trim();
  if (!s) return null;
  s = s.slice(0, 10);
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) return new Date(+m[3], +m[1] - 1, +m[2]);
  if ((m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s))) return new Date(2000 + +m[3], +m[1] - 1, +m[2]);
  return null;
}

/** Whole days between two dates (a - b), rounded. */
export const dayDiff = (a, b) => Math.round((a - b) / 86400000);

export function isoDate(d) {
  const m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/** 'YYYY-MM-DD…' -> 'MM/DD/YYYY' for the header; passes anything else through. */
export function formatSnapshotLabel(snapshot) {
  const sd = snapshot ? String(snapshot) : '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(sd)) return sd;
  const [y, m, d] = sd.slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}

/** Snapshot date = most frequent date across 'Event Time' / 'Publish Date' (robust to sentinel dates). */
export function detectSnapshot(rows) {
  const tally = {};
  for (const r of rows) {
    for (const cand of [r['Event Time'], r['Publish Date']]) {
      const d = parseDate(cand);
      if (d) { const k = isoDate(d); tally[k] = (tally[k] || 0) + 1; }
    }
  }
  let best = null, bc = 0;
  for (const key in tally) if (tally[key] > bc) { bc = tally[key]; best = key; }
  return best ? parseDate(best) : null;
}
