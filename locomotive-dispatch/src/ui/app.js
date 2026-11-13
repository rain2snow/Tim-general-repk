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
import { initViewSwitcher, registerView, resetToConsole, showView } from './views/navigation.js';
import { openDashboard, initDashboardExport } from './views/dashboard/index.js';
import { buildFleetView } from './views/fleetView.js';
import { buildActionsRequired } from './views/actionsRequired.js';
import { initSearch } from './search.js';
import { initLoader } from './loader.js';
import { analyze, rowsFromFleet } from '../core/analyze.js';
import { loadSavedPlan, savePlan, clearSavedPlan } from './planStore.js';
import { initPlanView, buildPlanView } from './views/planView.js';
import { initThemeToggle } from './theme.js';
import { loadAssignments, saveAssignments, assignOption } from './assignStore.js';
import { loadDeadheads, saveDeadheads, loadConsists, saveConsists, nextConsistId, loadSwaps, saveSwaps } from './opsStore.js';
import { swapDeadheads, nextSwapId } from '../core/swaps.js';
import { openSwapEditor } from './swapEditor.js';
import { loadSavedSnapshot, saveSnapshot, clearSavedSnapshot } from './snapshotStore.js';
import { initSession } from './session.js';
import { markerByKey } from './map/mapView.js';

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
  renderLocoList();
  renderStationList();
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
    { multiHome: r.multiHome, lcs: r.lcs, now: app.snapshotNow || undefined,
      assign: assignOption(app.assignments), deadheads: allDeadheads(), consists: app.consists });
}

/* ---------- manual locomotive assignments (dispatcher overrides at a terminal) ---------- */

/**
 * Set (k = station key), release (k = '') or undo (k = null) a manual assignment, re-analyse and
 * keep the dispatcher where they were (reopens the terminal popup on its Assign tab).
 */
export function setAssignment(loco, k, note = '', reopen = null) {
  const map = { ...app.assignments };
  if (k === null) delete map[loco];
  else map[loco] = { k, note: note || '', at: new Date().toISOString(), ...(reopen ? { from: reopen } : {}) };
  app.assignments = map;
  saveAssignments(map);
  setData(analyzeWithPlan());
  emit('assign');
  if (reopen) setTimeout(() => { const m = markerByKey[reopen]; if (m) m.openPopup(); }, 30);
}

/* ---------- manual deadheads + consists + swap plans ---------- */
/** Deadheads the engine sees: swap-plan moves, then manual deadheads (a manual one wins). */
const allDeadheads = () => ({ ...swapDeadheads(app.swaps), ...app.deadheads });
const reopenPopup = (k) => { if (k) setTimeout(() => { const m = markerByKey[k]; if (m) m.openPopup(); }, 30); };
export const commitOpsNow = () => commitOps(null);
function commitOps(reopen) {
  saveDeadheads(app.deadheads); saveConsists(app.consists); saveSwaps(app.swaps);
  setData(analyzeWithPlan());
  emit('assign');
  reopenPopup(reopen);
}

/** Plan deadheads: each loco moves to station `to` (counts there). */
export function setDeadheads(locos, to, { eta = '', note = '' } = {}, reopen = null) {
  const at = new Date().toISOString();
  app.deadheads = { ...app.deadheads };
  locos.forEach((l) => { app.deadheads[l] = { to, eta, note, at }; });
  commitOps(reopen);
}
export function cancelDeadhead(loco, reopen = null) {
  app.deadheads = { ...app.deadheads };
  delete app.deadheads[loco];
  commitOps(reopen);
}

/** Create or update a consist (a unit belongs to at most one consist: it is moved out of others). */
export function saveConsist(c, reopen = null) {
  const id = c.id || nextConsistId(app.consists);
  const units = [...new Set(c.units)];
  const others = app.consists.filter((x) => x.id !== id)
    .map((x) => ({ ...x, units: x.units.filter((l) => !units.includes(l)) })).filter((x) => x.units.length);
  app.consists = [...others, { id, name: c.name || id, k: c.k, job: c.job || '', units, note: c.note || '', at: new Date().toISOString() }];
  commitOps(reopen);
}
export function dissolveConsist(id, reopen = null) {
  app.consists = app.consists.filter((x) => x.id !== id);
  commitOps(reopen);
}
/** Deadhead a whole consist: every unit moves, and the consist goes with them (job cleared). */
export function deadheadConsist(id, to, opts = {}, reopen = null) {
  const c = app.consists.find((x) => x.id === id);
  if (!c) return;
  app.consists = app.consists.map((x) => (x.id === id ? { ...x, k: to, job: '' } : x));
  setDeadheads(c.units, to, opts, reopen);
}
/**
 * Create or update a swap plan. Its units leave any other swap plan and any manual deadhead
 * (the plan now decides where they go).
 */
export function saveSwap(w, reopen = null) {
  const id = w.id || nextSwapId(app.swaps);
  const units = new Set([...w.toHub, ...w.toPoint]);
  const others = app.swaps.filter((x) => x.id !== id)
    .map((x) => ({ ...x, toHub: x.toHub.filter((l) => !units.has(l)), toPoint: x.toPoint.filter((l) => !units.has(l)) }))
    .filter((x) => x.toHub.length || x.toPoint.length);
  const prev = app.swaps.find((x) => x.id === id);
  app.swaps = [...others, { id, hub: w.hub, point: w.point, base: w.base, toHub: [...w.toHub], toPoint: [...w.toPoint],
    eta: w.eta || '', note: w.note || '', at: prev ? prev.at : new Date().toISOString() }]
    .sort((a, b) => +a.id.slice(1) - +b.id.slice(1));
  app.deadheads = Object.fromEntries(Object.entries(app.deadheads).filter(([l]) => !units.has(l)));
  commitOps(reopen);
}
export function deleteSwap(id, reopen = null) {
  app.swaps = app.swaps.filter((x) => x.id !== id);
  commitOps(reopen);
}
export function clearOps(kind = null) {
  if (kind === 'swaps') { app.swaps = []; commitOps(null); return; }
  app.deadheads = {}; app.consists = [];
  commitOps(null);
}
/** Count of manual changes shown on the header chip. */
export const manualCount = () => Object.keys(app.assignments).length + Object.keys(app.deadheads).length + app.consists.length + app.swaps.length;

export function clearAssignments() {
  app.assignments = {};
  saveAssignments({});
  setData(analyzeWithPlan());
  emit('assign');
}

/** Loco-ID suggestions for the Assign tab. */
function renderStationList() {
  let dl = document.getElementById('dh-stations');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'dh-stations'; document.body.appendChild(dl); }
  dl.innerHTML = app.data.stations.map((s) => `<option value="${s.station} ${s.state}">${s.region || ''} · ${s.zone || ''}</option>`).join('');
}

function renderLocoList() {
  let dl = document.getElementById('asg-locos');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'asg-locos'; document.body.appendChild(dl); }
  dl.innerHTML = (app.data.fleet || []).filter((f) => !f.hhp).map((f) => `<option value="${f.loco}">${f.model} · ${f.op} · ${f.loc}</option>`).join('');
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
  app.snapshotSource = 'upload';
  app.snapshotSaved = saveSnapshot(data, 'upload');   // survives a reload
  setData(data);
  emit('snapshot');
}

/** Use a snapshot given as { meta, fleet } (from a session file) as the current data. */
export function useSnapshot(snap, source = 'import') {
  app.rows = rowsFromFleet(snap.fleet);
  app.snapshotNow = snapshotDateOf(snap);
  app.snapshotSource = source;
  app.snapshotSaved = saveSnapshot(snap, source);
}

/** Drop an uploaded / imported snapshot and go back to the one built into the app. */
export function revertToBuiltinSnapshot() {
  clearSavedSnapshot();
  app.rows = rowsFromFleet(app.builtinSnapshot.fleet);
  app.snapshotNow = snapshotDateOf(app.builtinSnapshot);
  app.snapshotSource = 'built-in';
  setData(analyzeWithPlan());
  emit('snapshot');
}

/** Everything the dispatcher has changed, for a session handoff file. */
export function currentSession() {
  return {
    settings: { theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', demandDay: app.dow },
    plan: app.planEdited ? app.plan : null,
    assignments: app.assignments,
    deadheads: app.deadheads,
    consists: app.consists,
    swaps: app.swaps,
    actionPlans: app.store.entries(),
    snapshot: app.data,
  };
}

export function startApp({ snapshot, reference, network, hubs }) {
  app.hubs = hubs || null;
  app.reference = reference;
  app.plan = reference.plan;
  app.builtinSnapshot = snapshot;
  app.rows = rowsFromFleet(snapshot.fleet);   // the snapshot can be re-analysed losslessly
  app.snapshotNow = snapshotDateOf(snapshot);
  app.snapshotSource = 'built-in';
  // an uploaded / imported snapshot saved in this browser wins unless the built-in one is newer
  const savedSnap = loadSavedSnapshot();
  if (savedSnap && String(savedSnap.meta.snapshot) >= String(snapshot.meta.snapshot)) {
    app.rows = rowsFromFleet(savedSnap.fleet);
    app.snapshotNow = snapshotDateOf(savedSnap);
    app.snapshotSource = savedSnap.source || 'upload';
    app.snapshotSaved = true;
  } else if (savedSnap) clearSavedSnapshot();
  app.assignments = loadAssignments();
  app.deadheads = loadDeadheads();
  app.consists = loadConsists();
  app.swaps = loadSwaps();
  const saved = loadSavedPlan();
  initMap('map');
  initThemeToggle();
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
  document.addEventListener('dispatch:deadhead', (e) => {
    const { action, locos, loco, consist, to, eta, note, station } = e.detail;
    if (action === 'cancel') cancelDeadhead(loco, station);
    else if (consist) deadheadConsist(consist, to, { eta, note }, station);
    else setDeadheads(locos, to, { eta, note }, station);
  });
  document.addEventListener('dispatch:consist', (e) => {
    const { action, consist, id, station } = e.detail;
    if (action === 'dissolve') dissolveConsist(id, station); else saveConsist(consist, station);
  });
  document.addEventListener('dispatch:swap', (e) => {
    const { action, id, point, base, units } = e.detail;
    if (action === 'delete') deleteSwap(id, e.detail.station);
    else openSwapEditor(id ? { id } : { point, base, units });
  });
  document.addEventListener('dispatch:assign', (e) => {
    const { loco, k, note, station } = e.detail;
    setAssignment(loco, k, note, station);
  });
  const chip = document.getElementById('asgchip');
  if (chip) {
    chip.addEventListener('click', () => showView('fleet'));
    on('assign', () => { const n = manualCount(); chip.hidden = !n; chip.textContent = `${n} manual`; });
  }
  const loader = initLoader(loadRows);
  initSession();
  try {
    if (saved) {                         // this browser has an edited plan: use it
      app.plan = { ...saved.plan, shops: reference.plan.shops };
      app.planEdited = true;
    }
    // edited plan or manual assignments need a re-analysis; otherwise the baked snapshot is exact
    app.data = saved || manualCount() || app.snapshotSource !== 'built-in' ? analyzeWithPlan() : snapshot;
    render();
    emit('plan');
    emit('assign');
  } catch (e) {
    console.error(e);
    loader.fail('Built-in snapshot failed to load — please load an STP file.');
  }
  return app;
}
