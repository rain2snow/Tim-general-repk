/** Console action queue (right panel): route dead units, cover shorts, swap inspections, re-task. */
import { esc } from './html.js';
import { displayState } from './constants.js';
import { actionId } from './store.js';

export const QUEUE_FILTERS = ['all', 'route', 'swap', 'retask'];

export function buildQueueActions(data, retask = []) {
  const actions = [];
  data.dead.forEach((d) => {
    const noShop = !d.tlat;
    actions.push({
      type: 'route', loco: d.loco, model: d.model,
      text: noShop
        ? `Assign a shop, then move from <span class="hi">${esc(d.rawloc)}</span>`
        : `Move from <span class="hi">${esc(d.rawloc)}</span> to <span class="hi">${esc(d.tname || d.shop)}</span>`,
      metas: [noShop ? { c: 'urg', t: 'NO SHOP' } : { t: d.shop }, { t: 'ETR ' + (d.etr.split(' ')[0] || '—') }, { t: d.op }],
      sort: noShop ? 0 : 1, ref: { kind: 'dead', id: d.loco }, actid: actionId.dead(d.loco),
    });
  });
  data.stations.forEach((s) => {
    const where = `${esc(s.station)}, ${esc(displayState(s.state))}`;
    if (s.status === 'short') {
      actions.push({
        type: 'swap', cls: 'short', loco: esc(s.station), model: 'need +' + s.shortfall,
        text: `Send power to <span class="hi">${where}</span> — plan needs ${s.required}, ${s.have} on hand`,
        metas: [{ c: 'urg', t: 'SHORT −' + s.shortfall }, { t: (s.captive_jobs || 0) + ' jobs' }, { t: s.have + ' on hand' }],
        sort: -1000 - s.shortfall, ref: { kind: 'station', id: s.k }, actid: actionId.short(s.k),
      });
    }
    (s.insp || []).forEach((u) => {
      actions.push({
        type: 'swap', cls: s.status === 'short' ? 'short' : 'insp', loco: u.loco, model: u.model,
        text: `Swap out at <span class="hi">${where}</span> — ${esc(u.insp)} inspection`,
        metas: [u.days < 0 ? { c: 'urg', t: 'OVERDUE ' + -u.days + 'D' } : { c: 'due', t: 'DUE ' + u.days + 'D' },
          s.spare_n ? { t: s.spare_n + ' spare here' } : { c: 'urg', t: 'NO SPARE' }],
        sort: u.days, ref: { kind: 'station', id: s.k }, actid: actionId.insp(u.loco, s.k),
      });
    });
  });
  retask.forEach((c) => {
    actions.push({
      type: 'retask', cls: 'retask', loco: c.u.loco, model: c.u.model,
      text: `Re-task to cover <span class="hi">${esc(c.s.station)}, ${esc(displayState(c.s.state))}</span> — sitting here, homed at <span class="hi">${esc(c.home.station)}</span> (${esc(c.home.status)} +${c.slack})`,
      metas: [{ c: 'urg', t: 'RE-TASK' }, { t: c.fam }, { t: c.home.station + ' +' + c.slack }],
      sort: -2000, ref: { kind: 'station', id: c.s.k }, actid: actionId.retask(c.u.loco, c.s.k),
    });
  });
  // stable sort (ES2019+) keeps insertion order for ties, as before
  actions.sort((a, b) => a.sort - b.sort);
  return actions;
}

export function countByType(actions) {
  return {
    all: actions.length,
    route: actions.filter((a) => a.type === 'route').length,
    swap: actions.filter((a) => a.type === 'swap').length,
    retask: actions.filter((a) => a.type === 'retask').length,
  };
}
