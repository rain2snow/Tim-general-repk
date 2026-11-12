/** The console map: layers, markers, routing lines, CN rail network, plan ticks, fly-to. */
import L from 'leaflet';
import { COLORS as CO } from '../../core/constants.js';
import { networkLines, capacitySummary, CAPACITY_ORDER } from '../../core/network.js';
import { esc } from '../../core/html.js';
import { stationPlanState } from '../../core/store.js';
import { app } from '../state.js';
import { installBasemap } from './basemap.js';
import { stationPopupElement, stationPopupOptions, deadPopup, deadheadPopup, shopPopup } from './popups.js';

export let map = null;
/** Toggleable layer groups (names match data-layer attributes in the markup). */
export const layers = {};
let routeLines = null, dhLines = null, basemap = null;
/** Keep the basemap in step with the light / dark theme. */
export const setMapTheme = (theme) => { if (basemap) basemap.matchTheme(theme); };
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
  basemap = installBasemap(map);
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
      .bindPopup(() => stationPopupElement(s, stationPlanState(app.store, s, app.retask), app.locoIndex,
        { map: app.assignments || {}, deadheads: app.deadheads || {},
          nameOf: (k) => (app.stationsByKey[k] ? app.stationsByKey[k].station : String(k).split('|')[0]),
          isStation: (k) => !!app.stationsByKey[k] }), stationPopupOptions());
    m.addTo(layers[layerForStatus(s.status)]);
    markerByKey[s.k] = m;

    if (s.insp_n > 0) { // overlay: amber halo ring if inspections are due here
      const rr = r + 5, od = (s.overdue_n || 0) > 0;
      const ring = `<div class="mk-ring ${od ? 'pulse' : ''}" style="width:${rr * 2}px;height:${rr * 2}px;border-color:${CO.amber};--pc:${CO.amber}77"></div>`;
      L.marker([s.lat, s.lng], { icon: divIcon(ring, rr * 2), interactive: false }).addTo(layers.inspection);
    }
  });
}

/**
 * Weight-capacity styling. An amber/stone ramp (heaviest = brightest, solid) keeps the network
 * readable without clashing with the status colours used by the markers.
 */
export const RAIL_STYLE = {
  '286k': { color: '#e8a13a', weight: 2.0, opacity: 0.85 },
  '272k': { color: '#c9a66b', weight: 1.6, opacity: 0.8 },
  '268k': { color: '#b39a74', weight: 1.4, opacity: 0.8, dashArray: '6 3' },
  '263k': { color: '#a08f78', weight: 1.4, opacity: 0.8, dashArray: '6 3' },
  lt263k: { color: '#c47b5a', weight: 1.4, opacity: 0.85, dashArray: '2 3' },
  rights: { color: '#8f96a3', weight: 1.2, opacity: 0.75, dashArray: '1 4' },
};
const railStyle = (ln) => {
  const s = RAIL_STYLE[ln.capacity] || RAIL_STYLE['272k'];
  return ln.rank === 'main' ? { ...s, weight: s.weight + 0.6 } : s;
};

/**
 * Draw the CN rail network (static: drawn once, independent of the snapshot).
 * Lines sit underneath the markers; hovering one names its corridor and weight limit.
 * @returns {lines, km, byCapacity} summary for the layer legend
 */
export function renderNetwork(network) {
  layers.tracks.clearLayers();
  const lines = networkLines(network);
  // lightest classes first so the heavy main lines draw on top
  [...lines].sort((a, b) => CAPACITY_ORDER.indexOf(b.capacity) - CAPACITY_ORDER.indexOf(a.capacity) || (a.rank === 'main') - (b.rank === 'main'))
    .forEach((ln) => {
      const style = railStyle(ln);
      const cap = ln.capacityInfo;
      const tip = `<b>${esc(ln.corridor)}</b><br>` +
        (ln.capacity === 'rights' ? `<span style="opacity:.75">${esc(cap.label)}</span>`
          : `<span style="opacity:.75">Max gross ${esc(cap.label)} · ${esc(cap.cars)}</span>`) +
        `<br><span style="opacity:.55">this segment ~${Math.round(ln.km).toLocaleString()} km</span>`;
      L.polyline(ln.path, { ...style, className: 'cn-rail cn-rail-' + ln.capacity })
        .bindTooltip(tip, { sticky: true, className: 'rail-tip' })
        .on('mouseover', (e) => e.target.setStyle({ weight: style.weight + 1.6, opacity: 1 }))
        .on('mouseout', (e) => e.target.setStyle(style))
        .addTo(layers.tracks);
    });
  return { lines: lines.length, km: Math.round(lines.reduce((a, l) => a + l.km, 0)), byCapacity: capacitySummary(lines) };
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
      L.polyline([[d.lat, d.lng], [d.tlat, d.tlng]], { color, weight: 1.6, opacity, dashArray: dash, className: 'route-line ' + (color === CO.dead ? 'route-dead' : 'route-dh') + (d.manual ? ' route-manual' : '') }).addTo(lines);
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
