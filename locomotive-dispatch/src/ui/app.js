/** Application composition: wires the modules once, then (re)renders on every data change. */
import { buildLocoIndex, stationIndex, computeRetask } from '../core/planning.js';
import { applyDemandDay } from '../core/demand.js';
import { buildHubModel } from '../core/hubs.js';
import { formatSnapshotLabel } from '../core/dates.js';
import { stationPlanState } from '../core/store.js';
import { $$, setText } from './dom.js';
import { app, on, emit } from './state.js';
import { initMap, renderMap, renderNetwork, renderPlanMarks, invalidateMapSize } from './map/mapView.js';
import { initLayerToggles } from './console/layerToggles.js';
import { renderRailLegend } from './console/railLegend.js';
import { renderCounts } from './console/counts.js';
import { initDemandToggle } from './console/demandToggle.js';
import { initQueue, rebuildQueue, renderQueue } from './console/actionQueue.js';
import { initTiles } from './console/tiles.js';
import { initPanels } from './console/panels.js';
import { initViewSwitcher, registerView, resetToConsole } from './views/navigation.js';
import { openDashboard, initDashboardExport } from './views/dashboard/index.js';
import { buildFleetView } from './views/fleetView.js';
import { buildActionsRequired } from './views/actionsRequired.js';
import { initSearch } from './search.js';
import { initLoader } from './loader.js';
import { analyze, rowsFromFleet } from '../core/analyze.js';
import { loadSavedPlan, savePlan, clearSavedPlan } from './planStore.js';
import { initPlanView, buildPlanView } from './views/planView.js';

/** Re-render everything derived from app.data. */
export function render() {
  const data = app.data;
  app.locoIndex = buildLocoIndex(data.fleet);
  app.stationsByKey = stationIndex(data.stations);
  app.retask = computeRetask(data.stations, app.locoIndex);
  app.hubModel = app.hubs ? buildHubModel(data, app.hubs, { retask: app.retask }) : null;
  resetToConsole();
  setText('snapdate', formatSnapshotLabel(data.meta && data.meta.snapshot));
  renderMap(data);
  renderCounts(data);
  rebuildQueue();
  app.dashStale = true;
  emit('data');
  setTimeout(() => emit('plans'), 0);
}

/** Load a new snapshot (keeps the selected demand day). */
export function setData(data) {
  app.data = data;
  if (app.dow != null) applyDemandDay(data.stations, app.dow);
  invalidateMapSize();
  render();
}

/** Plan text / resolved changes ripple to the queue badges, map ticks and dashboard highlights. */
function refreshPlanMarks() {
  if (!app.data) return;
  renderQueue();
  renderPlanMarks(app.data.stations);
  const planned = (k) => !!stationPlanState(app.store, app.stationsByKey[k], app.retask);
  $$('#dbody .drow[data-key]').forEach((r) => r.classList.toggle('planned', planned(r.dataset.key)));
  $$('#kpi-detail .kd-card[data-key]').forEach((c) => c.classList.toggle('planned', planned(c.dataset.key)));
}

/* ---------- captive plan: analysis against the active (possibly edited) plan ---------- */
const snapshotDateOf = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((d.meta && d.meta.snapshot) || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

/** Analyse the current STP rows against `plan` (defaults to the active plan). */
export function analyzeWithPlan(plan = app.plan) {
  const r = app.reference;
  return analyze(app.rows, { ...plan, shops: r.plan.shops }, r.base2home,
    { multiHome: r.multiHome, lcs: r.lcs, now: app.snapshotNow || undefined });
}

/** Make `plan` the active captive plan: persist it (or clear when built-in) and re-analyse. */
export function applyPlan(plan, { builtIn = false } = {}) {
  app.plan = plan;
  app.planEdited = !builtIn;
  if (builtIn) clearSavedPlan(); else savePlan(plan);
  setData(analyzeWithPlan(plan));
  emit('plan');
}

/** New STP export loaded: keep its rows (for later plan edits) and analyse against the active plan. */
function loadRows(rows) {
  app.rows = rows;
  app.snapshotNow = null;                 // detect from the export
  const data = analyzeWithPlan();
  app.snapshotNow = snapshotDateOf(data);
  setData(data);
}

export function startApp({ snapshot, reference, network, hubs }) {
  app.hubs = hubs || null;
  app.reference = reference;
  app.plan = reference.plan;
  app.rows = rowsFromFleet(snapshot.fleet);   // the snapshot can be re-analysed losslessly
  app.snapshotNow = snapshotDateOf(snapshot);
  const saved = loadSavedPlan();
  initMap('map');
  if (network) renderRailLegend(renderNetwork(network), network);
  initLayerToggles();
  initDemandToggle(render);
  initTiles();
  initQueue();
  initPanels();
  initViewSwitcher();
  registerView('dash', openDashboard);
  registerView('actions', buildActionsRequired);
  registerView('fleet', buildFleetView);
  registerView('plan', buildPlanView);
  initPlanView({ applyPlan, analyzeWithPlan });
  initDashboardExport();
  initSearch();
  on('plans', refreshPlanMarks);
  const loader = initLoader(loadRows);
  try {
    if (saved) {                         // this browser has an edited plan: use it
      app.plan = { ...saved.plan, shops: reference.plan.shops };
      app.planEdited = true;
      app.data = analyzeWithPlan();
    } else {
      app.data = snapshot;
    }
    render();
    emit('plan');
  } catch (e) {
    console.error(e);
    loader.fail('Built-in snapshot failed to load — please load an STP file.');
  }
  return app;
}
