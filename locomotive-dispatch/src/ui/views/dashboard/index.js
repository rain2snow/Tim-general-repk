/** Dashboard view: KPI tiles, balance tree, footnote, off-plan trains, CSV export. */
import { computeKpis, dashboardCsv } from '../../../core/balance.js';
import { byId, downloadText } from '../../dom.js';
import { app, emit } from '../../state.js';
import { locateStation } from '../navigation.js';
import { kpiDefinitions, renderKpis } from './kpis.js';
import { balanceTreeHtml, wireBalanceTree } from './balanceTree.js';
import { renderOffplan } from '../offplan.js';

export function buildDashboard() {
  const data = app.data;
  const k = computeKpis(data);
  renderKpis(kpiDefinitions(data, k));
  const body = byId('dbody');
  body.innerHTML = balanceTreeHtml(data);
  wireBalanceTree(body, (key) => locateStation(key, { zoom: 8, duration: 0.8, popupDelay: 750 }));
  const snap = byId('snapdate').textContent;
  byId('dashfoot').textContent =
    `Snapshot ${snap} · ${k.plan.length} captive-plan locations · requirement = shared-job-adjusted, M-schedule and HHP excluded · on-hand = Available LHP/MHP non-slug, captive units counted at home terminal`;
  renderOffplan(byId('offplan'), data);
  emit('plans');
  app.dashStale = false;
}

/** Build on first open (or after the data changed). */
export function openDashboard() { if (app.dashStale) buildDashboard(); }

export function initDashboardExport() {
  const b = byId('dashexport');
  if (!b) return;
  b.addEventListener('click', () => {
    try {
      downloadText(dashboardCsv(app.data), 'dashboard_balance_' + ((app.data.meta && app.data.meta.snapshot) || 'export') + '.csv');
    } catch (e) { alert('Dashboard export failed: ' + e.message); }
  });
}
