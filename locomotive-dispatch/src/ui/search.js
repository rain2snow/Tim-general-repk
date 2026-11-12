/** Header "Find loco ID…" search with keyboard navigation. */
import { searchLocos } from '../core/search.js';
import { stationOfKey } from '../core/keys.js';
import { $$, byId, isMobile } from './dom.js';
import { app } from './state.js';
import { markerByKey, deadByLoco, flyToMarker, layerForStatus, map } from './map/mapView.js';
import { ensureLayerShown } from './console/layerToggles.js';

function mobileToMap() {
  if (!isMobile()) return;
  const r = byId('right'); if (r) r.classList.remove('show');
  $$('.mtab button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'map'));
}

function showStation(k) {
  const st = app.stationsByKey[k];
  if (st) ensureLayerShown(layerForStatus(st.status));
  flyToMarker(markerByKey[k]);
}

/** Fly to a loco: dead marker, else its home terminal (if on the road), else where it sits. */
export function locateLoco(loco, box) {
  loco = (loco || '').toUpperCase();
  const f = app.locoIndex[loco];
  if (!f) return false;
  box.classList.remove('show');
  if (f.dead && deadByLoco[loco]) { ensureLayerShown('dead'); flyToMarker(deadByLoco[loco]); mobileToMap(); return true; }
  if (f.road && f.home && markerByKey[f.home]) { showStation(f.home); mobileToMap(); return true; }
  if (f.k && markerByKey[f.k]) { showStation(f.k); mobileToMap(); return true; }
  if (f.lat != null) { map.flyTo([f.lat, f.lng], 7, { duration: 0.8 }); mobileToMap(); return true; }
  box.innerHTML = '<div class="empty"><b style="color:var(--menu-txt)">' + loco + '</b> <span style="color:var(--menu-dim)">' + f.model + '</span><br>at ' +
    (f.loc || 'unknown location') + ' — off the captive plan (no map pin)<br>' +
    '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:var(--menu-dim)">' + f.op + ' · ' + f.desig + '</span></div>';
  box.classList.add('show');
  return true;
}

function resultHtml(k, selected) {
  const e = app.locoIndex[k];
  const tag = e.dead
    ? '<span class="op" style="color:var(--s-dead)">' + e.op + ' · DIT</span>'
    : '<span class="op" style="color:' + (e.desig === 'Available' ? 'var(--s-avail)' : 'var(--s-held)') + '">' + e.op + '</span>';
  const extra = e.road && e.home ? ' <span style="color:var(--cn)">· ↗ ' + stationOfKey(e.home) + '</span>'
    : e.offplan && !e.dead ? ' <span style="color:var(--s-off)">· off-plan</span>' : '';
  return '<div class="r' + (selected ? ' sel' : '') + '" data-loco="' + k + '"><span class="id">' + k + '<span class="mo">' + e.model + '</span></span>' +
    '<span class="lo">' + (e.loc || '?') + extra + '<br>' + tag + '</span></div>';
}

export function initSearch() {
  const q = byId('locoq'), box = byId('locores');
  if (!q || !box) return;
  let sel = -1, cur = [];
  const render = (s) => {
    const query = (s || '').trim().toUpperCase();
    if (!query) { box.classList.remove('show'); cur = []; return; }
    cur = searchLocos(app.locoIndex, query);
    if (!cur.length) { box.innerHTML = '<div class="empty">No locomotive matches “' + query + '”</div>'; box.classList.add('show'); return; }
    box.innerHTML = cur.map((k, idx) => resultHtml(k, idx === sel)).join('');
    box.classList.add('show');
    $$('.r', box).forEach((r) => r.addEventListener('mousedown', (ev) => { ev.preventDefault(); q.value = r.dataset.loco; locateLoco(r.dataset.loco, box); }));
  };
  q.addEventListener('input', () => { sel = -1; render(q.value); });
  q.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { sel = Math.min(sel + 1, cur.length - 1); render(q.value); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(q.value); ev.preventDefault(); }
    else if (ev.key === 'Enter') { const p = sel >= 0 && cur[sel] ? cur[sel] : cur[0]; if (p) { q.value = p; locateLoco(p, box); } }
    else if (ev.key === 'Escape') { box.classList.remove('show'); q.blur(); }
  });
  q.addEventListener('focus', () => { if (q.value.trim()) render(q.value); });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.locosearch')) box.classList.remove('show'); });
}
