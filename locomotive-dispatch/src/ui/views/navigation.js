/** View switcher (Console / Dashboard / Fleet / Actions Required) and cross-view "locate on map". */
import { $, $$ } from '../dom.js';
import { app } from '../state.js';
import { markerByKey, deadByLoco, flyToMarker, invalidateMapSize, layerForStatus } from '../map/mapView.js';
import { ensureLayerShown } from '../console/layerToggles.js';

const MODES = { dash: 'dashmode', actions: 'actmode', fleet: 'fleetmode', plan: 'planmode' };
const builders = {};

/** Register the builder each non-console view runs when it is opened. */
export function registerView(view, build) { builders[view] = build; }

export function showView(view) {
  $$('#vtab button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  const shell = $('.shell');
  shell.classList.remove(...Object.values(MODES));
  if (MODES[view]) shell.classList.add(MODES[view]);
  if (builders[view]) builders[view]();
  if (view === 'console') invalidateMapSize(80);
}

export function initViewSwitcher() {
  $$('#vtab button').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));
}

/** Reset to the console view without side effects (used on data reload). */
export function resetToConsole() {
  $('.shell').classList.remove(...Object.values(MODES));
  $$('#vtab button').forEach((b) => b.classList.toggle('on', b.dataset.view === 'console'));
}

/** Switch to the console and fly to a station marker. */
export function locateStation(k, { zoom = 7, duration = 0.7, popupDelay = 600 } = {}) {
  showView('console');
  setTimeout(() => {
    const st = app.stationsByKey[k];
    if (st) ensureLayerShown(layerForStatus(st.status));
    flyToMarker(markerByKey[k], zoom, { duration, popupDelay });
  }, 120);
}

/** Switch to the console and fly to a dead unit. */
export function locateDead(loco) {
  showView('console');
  setTimeout(() => {
    if (!deadByLoco[loco]) return;
    ensureLayerShown('dead');
    flyToMarker(deadByLoco[loco], 7, { duration: 0.7, popupDelay: 600 });
  }, 120);
}
