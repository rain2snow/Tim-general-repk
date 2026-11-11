/** Off-plan train assignments tables (bottom of the dashboard). */
import { esc } from '../../core/html.js';
import { computeOffplan } from '../../core/offplan.js';
import { $$ } from '../dom.js';

export function renderOffplan(box, data) {
  if (!box || !(data && data.fleet)) return;
  const { notInPlan, wrongClass, stationName, reqFam } = computeOffplan(data);
  const rows = (list, withHome) => list.map((f) => {
    const badge = '<span class="opbadge ' + (f.op === 'LN' ? 'ln' : '') + '">' + esc(f.op) + '</span>';
    return '<tr><td>' + esc(f.loco) + '</td><td>' + esc(f.model) + ' <span style="color:var(--dim)">(' + esc(f.fam || 'Other') + ')</span></td>' +
      '<td>' + badge + '</td><td>' + esc(f.train) + '</td><td>' + esc(f.loc || f.k) + '</td>' +
      (withHome ? '<td>' + esc(stationName[f.home] || f.home) + '</td><td style="color:var(--dim)">' + esc((reqFam[f.home] || []).join(', ') || '—') + '</td>' : '') + '</tr>';
  }).join('');
  const grp = (title, why, list, withHome, cid) => {
    const head = '<tr><th>Loco</th><th>Model</th><th>Op</th><th>Train</th><th>Now at</th>' + (withHome ? '<th>Train home</th><th>Plan classes there</th>' : '') + '</tr>';
    return '<div class="op-grp collapsed" id="' + cid + '"><div class="op-gh"><span class="tw2">▼</span>' +
      '<span class="t">' + title + '</span><span class="n2">' + list.length + '</span><span class="why">' + why + '</span></div>' +
      '<div class="op-body"><table class="optable"><thead>' + head + '</thead><tbody>' +
      (list.length ? rows(list, withHome) : '<tr><td colspan="' + (withHome ? 7 : 5) + '" style="color:var(--dim)">none</td></tr>') +
      '</tbody></table></div></div>';
  };
  box.innerHTML = '<div class="op-h"><h3>Off-plan train assignments</h3>' +
    '<span class="sub">low/mid-HP units carrying a Train ID · excludes units on plan jobs with no model-class spec</span></div>' +
    grp('On trains not in the captive plan', 'train base resolves to no plan location', notInPlan, false, 'opgA') +
    grp('On captive trains, wrong model class', 'unit’s family not among the plan’s required classes at the train’s home', wrongClass, true, 'opgB');
  $$('.op-gh', box).forEach((h) => h.addEventListener('click', () => h.parentNode.classList.toggle('collapsed')));
}
