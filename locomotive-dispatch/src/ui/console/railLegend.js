/** CN rail network legend (weight-capacity classes) under the layer toggle. */
import { CAPACITY_ORDER } from '../../core/network.js';
import { esc } from '../../core/html.js';
import { byId, setText } from '../dom.js';
import { RAIL_STYLE } from '../map/mapView.js';

const swatch = (s) =>
  `<svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="${s.color}" stroke-width="${s.weight + 0.4}"` +
  `${s.dashArray ? ` stroke-dasharray="${s.dashArray}"` : ''} stroke-linecap="butt"/></svg>`;

/** @param summary from renderNetwork(); @param network the raw network JSON (labels + source) */
export function renderRailLegend(summary, network) {
  setText('n-rail', `${(summary.km / 1000).toFixed(1)}k km`);
  const tog = document.querySelector('.toggle[data-layer="tracks"]');
  if (tog) tog.title = `${summary.lines} line segments · ~${summary.km.toLocaleString()} route-km`;
  const el = byId('railLegend');
  if (!el) return;
  const caps = network.capacity || {};
  const rows = CAPACITY_ORDER.filter((k) => summary.byCapacity[k]).map((k) =>
    `<div class="rl-row">${swatch(RAIL_STYLE[k])}<span class="rl-l">${esc(k === 'rights' ? 'Track rights (other RR)' : (caps[k] || {}).label || k)}</span>` +
    `<span class="rl-n">${Math.round(summary.byCapacity[k]).toLocaleString()} km</span></div>`).join('');
  const src = network.meta && network.meta.source ? network.meta.source.replace(/\s*\(.*\)$/, '') : '';
  el.innerHTML = `<div class="rl-h">Max gross weight</div>${rows}${src ? `<div class="rl-src">${esc(src)}</div>` : ''}`;
}
