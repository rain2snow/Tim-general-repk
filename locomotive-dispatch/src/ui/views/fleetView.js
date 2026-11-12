/** Fleet view: low/mid-HP status partition with drill-down unit lists. */
import { esc } from '../../core/html.js';
import { fleetBreakdown, FLEET_CATEGORIES, FLEET_OVERLAYS } from '../../core/fleet.js';
import { $$, byId } from '../dom.js';
import { app } from '../state.js';

let drill = {}, shopName = {};

export function buildFleetView() {
  const box = byId('fleetbox');
  if (!box || !(app.data && app.data.fleet)) return;
  const b = fleetBreakdown(app.data, app.locoIndex);
  drill = b.drill;
  shopName = {};
  (app.data.shops || []).forEach((sh) => { shopName[sh.code] = sh.name; });
  const row = (m, n) => {
    const pct = b.total ? Math.round((n / b.total) * 100) : 0, bw = Math.min(100, Math.round((n / b.maxCategory) * 100));
    return '<div class="fl-row ' + (m.cls || '') + '" data-fcat="' + m.k + '">' +
      '<span class="dot" style="background:' + m.c + '"></span>' +
      '<span class="lbl">' + m.l + '<span class="rule">' + m.rule + '</span></span>' +
      '<span class="bar"><i style="width:' + bw + '%;background:' + m.c + '"></i></span>' +
      '<span class="n">' + n + '</span><span class="pct">' + pct + '%</span></div>';
  };
  box.innerHTML = '<div class="fl-head"><h3>Low/mid-HP fleet breakdown</h3>' +
    '<span class="fl-sub">HHP &amp; slugs excluded · ' + esc((app.data.meta && app.data.meta.snapshot) || '') + '</span>' +
    '<span class="fl-tot"><b>' + b.total + '</b>units</span></div><div class="fl-grid">' +
    FLEET_CATEGORIES.map((m) => row(m, b.counts[m.k])).join('') +
    '<div class="fl-sep">Availability · overlays, not summed into the partition above</div>' +
    FLEET_OVERLAYS.map((m) => row(m, b.counts[m.k])).join('') +
    '</div><div class="fl-detail" id="fl-detail"></div>';
  $$('.fl-row', box).forEach((r) => r.addEventListener('click', () => toggleDrill(r.dataset.fcat, r)));
}

const days = (n) => (n == null ? '—' : n + 'd');

function movementList(units, cat) {
  const etr = cat === 'dit';
  const rows = units.slice().sort((a, b) => (b.sinceD || 0) - (a.sinceD || 0)).map((u) => {
    const planned = etr
      ? (u.shop ? esc(shopName[u.shop] || u.shop) : u.dest ? esc(u.dest) : '<span class="u-dim">no shop assigned</span>')
      : (u.dest ? esc(u.dest) : '<span class="u-dim">—</span>');
    return '<div class="fl-urow"><span class="ul">' + esc(u.loco) + '</span><span class="um">' + esc(u.model) + '</span>' +
      '<span class="uf">' + esc(u.loc || '—') + '</span><span class="us">' + days(u.sinceD) + '</span>' +
      '<span class="up">→ ' + planned + '</span>' + (etr ? '<span class="ue">' + (u.etr ? esc(u.etr) : '—') + '</span>' : '') + '</div>';
  }).join('');
  return '<div class="fl-list' + (etr ? ' etr' : '') + '"><div class="fl-urow head">' +
    '<span class="ul">Loco</span><span class="um">Model</span><span class="uf">Now at</span><span class="us">In status</span><span class="up">Planned to</span>' +
    (etr ? '<span class="ue">ETR</span>' : '') + '</div>' + rows + '</div>';
}

function overdueList(units) {
  const rows = units.slice().sort((a, b) => a.days - b.days).map((u) =>
    '<div class="fl-urow ov"><span class="ul">' + esc(u.loco) + '</span><span class="um">' + esc(u.model) + '</span>' +
    '<span class="uf">' + esc(u.loc || '—') + '</span><span class="us od">' + -u.days + 'd overdue</span>' +
    '<span class="up">' + esc(u.insp || 'inspection') + '</span></div>').join('');
  return '<div class="fl-list ov"><div class="fl-urow head ov"><span class="ul">Loco</span><span class="um">Model</span><span class="uf">Location</span><span class="us">Overdue</span><span class="up">Inspection</span></div>' + rows + '</div>';
}

function cardsByLocation(units) {
  const byLoc = {};
  units.forEach((u) => { const L = u.loc || '—'; (byLoc[L] = byLoc[L] || []).push(u); });
  return '<div class="kd-grid">' + Object.keys(byLoc).sort((a, b) => byLoc[b].length - byLoc[a].length).map((L) => {
    const tags = byLoc[L].map((u) => '<span class="ltag' + (u.road ? ' road' : '') + '">' + esc(u.loco) + ' <span style="color:var(--faint2)">' + esc(u.model) + '</span></span>').join('');
    return '<div class="kd-card"><div class="loc">' + esc(L) + '<span class="st">' + byLoc[L].length + ' unit' + (byLoc[L].length > 1 ? 's' : '') + '</span></div><div class="locos">' + tags + '</div></div>';
  }).join('') + '</div>';
}

function toggleDrill(cat, row) {
  const d = byId('fl-detail'), box = byId('fleetbox');
  if (!d || !box) return;
  const was = row.classList.contains('open');
  $$('.fl-row', box).forEach((x) => x.classList.remove('open'));
  if (was) { d.classList.remove('show'); d.innerHTML = ''; return; }
  row.classList.add('open');
  const units = drill[cat] || [];
  d.innerHTML = !units.length ? '<div class="fl-empty">No units in this category for the current snapshot.</div>'
    : cat === 'dh' || cat === 'dit' ? movementList(units, cat)
      : cat === 'overdue' ? overdueList(units)
        : cardsByLocation(units);
  d.classList.add('show');
}
