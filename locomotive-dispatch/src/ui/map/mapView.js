/** The console map: layers, markers, routing lines, CN rail network, plan ticks, fly-to. */
import L from 'leaflet';
import { COLORS as CO } from '../../core/constants.js';
import { resolveNetwork, lineLengthKm } from '../../core/network.js';
import { esc } from '../../core/html.js';
import { stationPlanState } from '../../core/store.js';
import { app } from '../state.js';
import { installBasemap } from './basemap.js';
import { stationPopup, deadPopup, deadheadPopup, shopPopup } from './popups.js';

export let map = null;
/** Toggleable layer groups (names match data-layer attributes in the markup). */
export const layers = {};
let routeLines = null, dhLines = null;
const planMarks = {};
/** station key / loco id -> marker, for fly-to */
export const markerByKey = {};
export const deadByLoco = {};
export const dhByLoco = {};

/** Layers that carry an associated line group shown/hidden with them. */
const COMPANION = () => ({ dead: routeLines, deadhead: dhLines });
const INITIALLY_HIDDEN = new Set(['inspection']);

export function initMap(el = 'map') {
  map = L.map(el, { zoomControl: true, attributionControl: true, minZoom: 3, maxZoom: 11, worldCopyJump: false }).setView([49, -95], 4);
  installBasemap(map);
  ['tracks', 'short', 'even', 'surplus', 'shared', 'free', 'inspection', 'dead', 'deadhead', 'shop'].forEach((n) => {
    layers[n] = L.featureGroup();
    if (!INITIALLY_HIDDEN.has(n)) layers[n].addTo(map);
  });
  routeLines = L.featureGroup().addTo(map);
  dhLines = L.featureGroup().addTo(map);
  map.fitBounds([[29, -127], [59, -63]], { padding: [20, 20] }); // lower-48 + southern Canada
  return map;
}

export function setLayerVisible(name, show) {
  const groups = [layers[name], COMPANION()[name]].filter(Boolean);
  groups.forEach((g) => (show ? map.addLayer(g) : map.removeLayer(g)));
}

const rad = (n, base) => base + Math.min(n - 1, 6) * 1.6;
const divIcon = (html, size) => L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

/** Layer a station marker belongs to, by status. */
export const layerForStatus = (status) => (status === 'shared' ? 'shared' : status === 'free' ? 'free' : status);

function stationMarkerStyle(s) {
  let color, r, hollow = false, dia = false;
  if (s.status === 'short') { color = CO.red; r = rad(s.shortfall, 7); }
  else if (s.status === 'surplus') { color = CO.green; r = rad(s.have - s.required, 6); }
  else if (s.status === 'shared') { color = CO.even; r = 5; hollow = true; dia = true; } // shared-pool participant
  else if (s.status === 'free') { color = CO.violet; r = rad(s.have, 5); } // unassigned low/mid HP
  else { color = CO.even; r = 5; } // even
  return { color, r, hollow, dia };
}

function renderStations(stations) {
  stations.forEach((s) => {
    if (s.lat == null) return;
    if (!s.required && s.status !== 'shared' && s.status !== 'free') return; // plan + shared + free only
    const { color, r, hollow, dia } = stationMarkerStyle(s);
    const style = hollow
      ? `width:${r * 2}px;height:${r * 2}px;background:transparent;border:1.6px solid ${color};box-shadow:none`
      : `width:${r * 2}px;height:${r * 2}px;background:${color};--pc:${color}88`;
    const m = L.marker([s.lat, s.lng], { icon: divIcon(`<div class="${dia ? 'mk-dia' : 'mk-dot'}" style="${style}"></div>`, r * 2) })
      // popup content is a function so the plan-state band is always current
      .bindPopup(() => stationPopup(s, stationPlanState(app.store, s, app.retask)), { maxWidth: 300 });
    m.addTo(layers[layerForStatus(s.status)]);
    markerByKey[s.k] = m;

    if (s.insp_n > 0) { // overlay: amber halo ring if inspections are due here
      const rr = r + 5, od = (s.overdue_n || 0) > 0;
      const ring = `<div class="mk-ring ${od ? 'pulse' : ''}" style="width:${rr * 2}px;height:${rr * 2}px;border-color:${CO.amber};--pc:${CO.amber}77"></div>`;
      L.marker([s.lat, s.lng], { icon: divIcon(ring, rr * 2), interactive: false }).addTo(layers.inspection);
    }
  });
}

const RAIL_STYLE = {
  main: { color: '#e8a13a', weight: 2.4, opacity: 0.8 },
  secondary: { color: '#d99632', weight: 1.3, opacity: 0.55, dashArray: null },
};

/**
 * Draw the CN rail network (static: drawn once, independent of the snapshot).
 * Lines sit underneath the markers; hovering one names it.
 * @returns summary {lines, km} for the layer toggle count
 */
export function renderNetwork(network, stations) {
  layers.tracks.clearLayers();
  const { lines, unresolved } = resolveNetwork(network, stations);
  if (unresolved.length) console.warn('[network] unresolved waypoints:', unresolved.join(', '));
  // secondary first so main lines draw on top
  [...lines].sort((a, b) => (a.class === 'main') - (b.class === 'main')).forEach((ln) => {
    const style = RAIL_STYLE[ln.class] || RAIL_STYLE.secondary;
    L.polyline(ln.path, { ...style, className: 'cn-rail cn-rail-' + ln.class })
      .bindTooltip(`<b>${esc(ln.name)}</b><br><span style="opacity:.7">CN ${ln.class} line · ~${Math.round(lineLengthKm(ln)).toLocaleString()} km</span>`, { sticky: true, className: 'rail-tip' })
      .on('mouseover', (e) => e.target.setStyle({ weight: style.weight + 1.6, opacity: 1 }))
      .on('mouseout', (e) => e.target.setStyle(style))
      .addTo(layers.tracks);
  });
  return { lines: lines.length, km: Math.round(lines.reduce((a, l) => a + lineLengthKm(l), 0)) };
}

function renderShops(shops) {
  shops.forEach((sh) => {
    const html = `<div class="mk-sq" style="width:15px;height:15px;background:${CO.cyan}">⚙</div>`;
    L.marker([sh.lat, sh.lng], { icon: divIcon(html, 15) }).bindPopup(shopPopup(sh)).addTo(layers.shop);
  });
}

function renderMovers(list, { layer, lines, index, color, size, dash, opacity, popup }) {
  (list || []).forEach((d) => {
    if (d.lat == null) return;
    const html = `<div class="mk-dia pulse" style="width:${size}px;height:${size}px;background:${color};--pc:${color}88"></div>`;
    const m = L.marker([d.lat, d.lng], { icon: divIcon(html, size) }).bindPopup(popup(d), { maxWidth: 300 });
    m.addTo(layer);
    index[d.loco] = m;
    if (d.tlat != null) {
      L.polyline([[d.lat, d.lng], [d.tlat, d.tlng]], { color, weight: 1.6, opacity, dashArray: dash, className: 'route-line' }).addTo(lines);
      const end = color === CO.dead ? CO.cyan : color;
      L.circleMarker([d.tlat, d.tlng], { radius: 2.5, color: end, fillColor: end, fillOpacity: 0.9, weight: 0 }).addTo(lines);
    }
  });
}

const clearIndex = (o) => Object.keys(o).forEach((k) => delete o[k]);

/** Rebuild every data layer from the current snapshot. */
export function renderMap(data) {
  Object.entries(layers).forEach(([name, l]) => { if (name !== 'tracks') l.clearLayers(); }); // network is static
  routeLines.clearLayers(); dhLines.clearLayers();
  [markerByKey, deadByLoco, dhByLoco].forEach(clearIndex);
  renderStations(data.stations);
  renderShops(data.shops);
  // dead units: march toward the assigned shop
  renderMovers(data.dead, { layer: layers.dead, lines: routeLines, index: deadByLoco, color: CO.dead, size: 13, dash: '6 8', opacity: 0.65, popup: deadPopup });
  // inbound deadheads: toward their destination
  renderMovers(data.deadhead, { layer: layers.deadhead, lines: dhLines, index: dhByLoco, color: CO.inbound, size: 12, dash: '2 7', opacity: 0.7, popup: deadheadPopup });
}

/** Small green tick beside any station with a plan in place. */
export function renderPlanMarks(stations) {
  if (!map) return;
  Object.keys(planMarks).forEach((k) => { try { map.removeLayer(planMarks[k]); } catch { /* ignore */ } delete planMarks[k]; });
  (stations || []).forEach((s) => {
    if (s.lat == null || !stationPlanState(app.store, s, app.retask)) return;
    const icon = L.divIcon({ className: '', html: '<div class="mk-plan" title="plan in place">✓</div>', iconSize: [14, 14], iconAnchor: [-7, 17] });
    planMarks[s.k] = L.marker([s.lat, s.lng], { icon, interactive: false, zIndexOffset: 2000 }).addTo(map);
  });
}

export function flyToMarker(m, zoom = 7, { duration = 0.8, popupDelay = 650 } = {}) {
  if (!m) return false;
  map.flyTo(m.getLatLng(), zoom, { duration });
  setTimeout(() => m.openPopup(), popupDelay);
  return true;
}

export function flyToBoundsOf(name) {
  try {
    const b = layers[name].getBounds();
    if (b.isValid()) map.flyToBounds(b, { padding: [60, 60], maxZoom: 6 });
  } catch { /* ignore */ }
}

export const invalidateMapSize = (delay = 0) => setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, delay);
