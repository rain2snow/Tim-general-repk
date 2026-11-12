/** Application composition: wires the modules once, then (re)renders on every data change. */
import { buildLocoIndex, stationIndex, computeRetask } from '../core/planning.js';
import { applyDemandDay } from '../core/demand.js';
import { formatSnapshotLabel } from '../core/dates.js';
import { stationPlanState } from '../core/store.js';
import { $$, setText } from './dom.js';
import { app, on, emit } from './state.js';
import { initMap, renderMap, renderNetwork, renderPlanMarks, invalidateMapSize } from './map/mapView.js';
import { initLayerToggles } from './console/layerToggles.js';
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

/** Re-render everything derived from app.data. */
export function render() {
  const data = app.data;
  app.locoIndex = buildLocoIndex(data.fleet);
  app.stationsByKey = stationIndex(data.stations);
  app.retask = computeRetask(data.stations, app.locoIndex);
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

export function startApp({ snapshot, reference, network }) {
  initMap('map');
  if (network) {
    const n = renderNetwork(network, reference.plan.plan);
    setText('n-rail', n.lines);
    const tog = document.querySelector('.toggle[data-layer="tracks"]');
    if (tog) tog.title = `${n.lines} CN lines · ~${n.km.toLocaleString()} route-km`;
  }
  initLayerToggles();
  initDemandToggle(render);
  initTiles();
  initQueue();
  initPanels();
  initViewSwitcher();
  registerView('dash', openDashboard);
  registerView('actions', buildActionsRequired);
  registerView('fleet', buildFleetView);
  initDashboardExport();
  initSearch();
  on('plans', refreshPlanMarks);
  const loader = initLoader(reference, setData);
  try {
    app.data = snapshot;
    render();
  } catch (e) {
    console.error(e);
    loader.fail('Built-in snapshot failed to load — please load an STP file.');
  }
  return app;
}
