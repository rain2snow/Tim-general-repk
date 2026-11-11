/** Network-status tiles and layer counts. */
import { setText } from '../dom.js';

export function networkCounts(data) {
  const cnt = { short: 0, even: 0, surplus: 0, shared: 0, free: 0 };
  let inspLocs = 0, inspUnits = 0, overdue = 0, freeUnits = 0;
  data.stations.forEach((s) => {
    if (s.status === 'shared') cnt.shared++;
    else if (s.status === 'free') { cnt.free++; freeUnits += s.have; }
    else if (s.required && cnt[s.status] != null) cnt[s.status]++;
    if (s.insp_n > 0) inspLocs++;
    inspUnits += s.insp_n; overdue += s.overdue_n || 0;
  });
  return { ...cnt, inspLocs, inspUnits, overdue, freeUnits,
    dead: data.dead.length, deadhead: (data.deadhead || []).length, shops: data.shops.length };
}

export function renderCounts(data) {
  const c = networkCounts(data);
  setText('t-short', c.short); setText('t-even', c.even); setText('t-surp', c.surplus); setText('t-dead', c.dead);
  setText('n-short', c.short); setText('n-even', c.even); setText('n-surp', c.surplus);
  setText('n-shared', c.shared); setText('n-free', c.freeUnits); setText('n-insp', c.inspLocs);
  setText('n-dead', c.dead); setText('n-shop', c.shops); setText('n-dh', c.deadhead);
  setText('netcount', `${c.short} short · ${c.freeUnits} free L/M HP · ${c.dead} dead · ${c.deadhead} inbound`);
  return c;
}
