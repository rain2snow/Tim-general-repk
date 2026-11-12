/** Leaflet popup HTML for stations, dead units, deadheads and shops. */
import { COLORS as CO, displayState } from '../../core/constants.js';
import { esc } from '../../core/html.js';
import { stationOfKey } from '../../core/keys.js';

const BADGES = {
  short: ['SHORT', CO.red], even: ['EVEN', CO.even], surplus: ['SURPLUS', CO.green],
  shared: ['SHARED', CO.even], free: ['FREE L/M HP', CO.violet],
};
function stBadge(st) {
  const [t, c] = BADGES[st] || ['', ''];
  return `<span class="badge" style="background:${c}22;color:${c}">${t}</span>`;
}
function ltTag(t) {
  const c = t === 'HHP' ? CO.cyan : t === 'MHP' ? CO.amber : CO.green;
  return `<span style="color:${c}">${esc(t || '—')}</span>`;
}
const netband = (color, n, label) =>
  `<div class="netband" style="color:${color};border-color:${color}55"><span class="nb-n">${n}</span><span class="nb-l">${label}</span></div>`;

/* ------------------------------------------------------------------ station popup panes
 * Each pane: { key, label (tab), count, cap (heading inside the pane), body }.
 * The station popup shows a fixed summary, then one tab per non-empty pane. */

function trainsPane(s) {
  if (!s.trains || !s.trains.length) return null;
  const body = s.trains.map((t) => {
    const types = t.types.map((x) => `${x[1]}× ${esc(x[0])}`).join(', ');
    const ids = esc(t.ids.join(' / '));
    const shared = t.shared && t.shared.length ? `<span class="shz">shared: ${esc(t.shared.join('; '))}</span>` : '';
    const filled = t.units.length, short = filled < t.req;
    const units = filled
      ? t.units.map((u) => `<span class="tu ${u.here ? '' : 'road'}" title="${esc(u.model)}${u.here ? '' : ' · ' + esc(u.loc)}">${esc(u.loco)}${u.here ? '' : ' ↗'}</span>`).join('')
      : `<span class="tu none">— no units on train —</span>`;
    return `<div class="tr${short ? ' tshort' : ''}"><div class="tr1"><span class="tid">${ids}${shared}</span><span class="treq">${t.req} · ${types}</span></div><div class="turow">${units}</div></div>`;
  }).join('');
  return { key: 'trains', label: 'Trains', count: s.trains.length,
    cap: `Trains / jobs · ${s.trains.length} · requires ${s.required}`, body: `<div class="units trains pgrid">${body}</div>` };
}

/** Units physically here, grouped Available first, then by OpCode. */
function unitsPane(s) {
  if (!s.roster || !s.roster.length) return null;
  const row = (u) => {
    const avail = u.desig === 'Available';
    const tag = u.hhp ? `<span class="hhpx">≥4000hp</span>` : u.slug ? `<span class="slugx">slug</span>` : '';
    const lcsTag = u.lcs ? `<span class="lcsx">LCS</span>` : '';
    const dim = u.hhp || u.slug || !avail ? 'opacity:.55' : '';
    const dur = u.op !== 'LN' && u.sinceD != null ? ` <span class="dur">${u.sinceD}d</span>` : '';
    return `<div class="u" style="${dim}"><span><b>${esc(u.loco)}</b> ${esc(u.model)} ${ltTag(u.t)}${lcsTag}</span><span>${esc(u.op)}${dur}${tag}</span></div>`;
  };
  const groups = {};
  s.roster.forEach((u) => {
    const g = u.desig === 'Available' && !u.hhp && !u.slug ? 'Available' : u.hhp ? 'HHP (≥4000hp)' : u.slug ? 'Slugs' : u.op;
    (groups[g] = groups[g] || []).push(u);
  });
  const order = Object.keys(groups).sort((a, b) => (a === 'Available' ? -1 : b === 'Available' ? 1 : groups[b].length - groups[a].length));
  const body = order.map((g) => `<div class="ugh">${esc(g)} <span>${groups[g].length}</span></div><div class="units roster pgrid">${groups[g].map(row).join('')}</div>`).join('');
  return { key: 'units', label: 'Units here', count: s.roster.length, cap: `Locomotives here · ${s.roster.length}`, body };
}

/**
 * Units homed here but out on the road. Only Available low/mid-HP units count toward on-hand, so a
 * unit riding its train dead (LD / DM / DIT), in shop, etc. is dimmed and tagged "not counted".
 * Status comes from the fleet index (road_units do not carry OpCode / Designation).
 */
function roadPane(s, locoIndex) {
  const list = s.road_units || [];
  if (!list.length) return null;
  const status = (u) => (locoIndex && locoIndex[u.loco]) || {};
  const counts = (u) => { const f = status(u); return !f.op || (f.desig === 'Available' && !f.hhp); };
  const notCounted = list.filter((u) => !counts(u)).length;
  const working = notCounted ? ` · <span class="ncc">${list.length - notCounted} working</span>` : '';
  const body = list.map((u) => {
    if (counts(u)) {
      return `<div class="u"><span><b>${esc(u.loco)}</b> ${esc(u.model)} ${ltTag(u.t)}</span><span style="color:var(--dim)">↗ ${esc(u.loc)}${u.train ? ' · ' + esc(u.train) : ''}</span></div>`;
    }
    const f = status(u);
    const dead = f.op === 'LD' || f.op === 'DM' || f.desig === 'DIT';
    const why = [f.op, f.desig && f.desig !== f.op ? f.desig : ''].filter(Boolean).join(' · ') + (dead && f.shop ? ` → ${f.shop}` : '');
    return `<div class="u nc"><span><b>${esc(u.loco)}</b> ${esc(u.model)} ${ltTag(u.t)}<span class="ncx ${dead ? 'dead' : ''}" title="${dead ? 'Dead in transit' : 'Not Available'} — not counted toward on-hand${f.etr ? ' · ETR ' + esc(f.etr) : ''}">${esc(why)} · not counted</span></span>` +
      `<span style="color:var(--dim)">↗ ${esc(u.loc)}${u.train ? ' · ' + esc(u.train) : ''}</span></div>`;
  }).join('');
  return { key: 'road', label: 'On the road', count: list.length,
    cap: `Home terminal here · out on the road · ${list.length}${working}`, body: `<div class="units roster pgrid">${body}</div>` };
}

function shopPane(lsUnits) {
  if (!lsUnits.length) return null;
  const lsSoon = lsUnits.filter((u) => u.etrH != null && u.etrH < 24).length;
  const body = lsUnits.map((u) => {
    const soon = u.etrH != null && u.etrH < 24;
    const etrTxt = u.etr ? `ETR ${esc(u.etr)}` : 'ETR —';
    const dur = u.sinceD != null ? ` <span class="dur">${u.sinceD}d in shop</span>` : '';
    return `<div class="u"${soon ? ` style="background:${CO.green}14;border-radius:5px;padding:1px 4px"` : ''}><span><b>${esc(u.loco)}</b> ${esc(u.model)}${dur}</span><span style="color:${soon ? CO.green : 'var(--dim)'};${soon ? 'font-weight:700' : ''}">${soon ? '↩ ' : ''}${etrTxt}</span></div>`;
  }).join('');
  return { key: 'shop', label: 'In shop', count: lsUnits.length,
    cap: `In shop (LS / Shopped) · ${lsUnits.length}${lsSoon ? ` · <span style="color:${CO.green}">${lsSoon} returning ≤24h</span>` : ''}`,
    body: `<div class="units pgrid">${body}</div>` };
}

function inspPane(s) {
  if (!s.insp || !s.insp.length) return null;
  const body = s.insp.map((u) =>
    `<div class="u"><span><b>${esc(u.loco)}</b> ${esc(u.model)}</span><span style="color:${u.days < 0 ? CO.red : CO.amber}">${u.days < 0 ? 'overdue ' + -u.days + 'd' : 'in ' + u.days + 'd'} · ${esc(u.insp)}</span></div>`).join('');
  return { key: 'insp', label: 'Inspections', count: s.insp.length, alert: s.insp.some((u) => u.days < 0),
    cap: 'Inspections due ≤3d', body: `<div class="units pgrid">${body}</div>` };
}

function inboundPane(inb) {
  if (!inb.length) return null;
  const body = inb.map((u) => `<div class="u"><span><b>${esc(u.loco)}</b> ${esc(u.model)} ${ltTag(u.t)}</span><span style="color:${CO.inbound}">from ${esc(u.rawloc)} · ETA ${esc(u.eta) || '—'}</span></div>`).join('');
  return { key: 'inbound', label: 'Inbound', count: inb.length, cap: `Inbound deadhead · ${inb.length}`, body: `<div class="units pgrid">${body}</div>` };
}

function sharedPane(s) {
  if (!s.shared_in || !s.shared_in.length) return null;
  const body = s.shared_in.map((x) => `<div class="u"><span>${esc(x.ids.join(' / '))}</span><span style="color:${CO.even}">→ ${esc(x.primary)} · ${x.req}u</span></div>`).join('');
  return { key: 'shared', label: 'Shared', count: s.shared_in.length, cap: 'Shared assignment — counted at the primary terminal', body: `<div class="units">${body}</div>` };
}

function balanceBand(s) {
  if (s.status === 'shared') return netband(CO.even, 'SHARED', 'pool counted at primary terminal');
  if (s.status === 'free') return netband(CO.violet, s.have, 'free low/mid HP · unassigned to any captive job');
  if (!s.required) return '';
  const grouped = !!(s.grp_members && s.grp_members.length > 1);
  const isPrim = !grouped || s.k === s.grp_primary;
  if (grouped && !isPrim) {
    return netband(CO.even, '⇄', `in shared pool — deficit/surplus shown at ${esc(stationOfKey(s.grp_primary))} (${s.grp_have}/${s.grp_required} pooled)`);
  }
  const gnet = grouped ? s.grp_net : (s.have || 0) - (s.required || 0);
  const gReq = grouped ? s.grp_required : s.required;
  const gHave = grouped ? s.grp_have : s.have;
  const c = gnet < 0 ? CO.red : gnet > 0 ? CO.green : CO.even;
  const lab = gnet < 0 ? 'DEFICIT' : gnet > 0 ? 'SURPLUS' : 'EVEN';
  const big = gnet === 0 ? '0' : gnet > 0 ? '+' + gnet : gnet;
  const poolNote = grouped ? ` · shared pool ${gHave}/${gReq} across ${s.grp_members.map(stationOfKey).join(' + ')} (primary)` : '';
  return netband(c, big, `${lab} · ${s.have} on hand vs ${s.required} required${poolNote}`);
}

const stat = (label, value, color, sub = '') => `<div class="pst"><span class="pv"${color ? ` style="color:${color}"` : ''}>${value}</span>` +
  `<span class="pl">${label}</span>${sub ? `<span class="ps">${sub}</span>` : ''}</div>`;

/** The tab remembered across popups (reopened when the next station has that pane). */
let lastTab = null;

/**
 * Station popup: fixed summary (balance band + key stats) and a tab per non-empty detail pane.
 * @param planSt    '' | 'planned' | 'done'
 * @param locoIndex loco id -> fleet record (OpCode / Designation for the on-the-road list)
 */
export function stationPopup(s, planSt = '', locoIndex = null) {
  const lsUnits = (s.roster || []).filter((u) => u.op === 'LS');
  const inb = s.inbound || [];
  const planNote = planSt ? netband(CO.green, planSt === 'done' ? '✓' : '●', (planSt === 'done' ? 'plan resolved' : 'plan in place') + ' — see Actions Required tab') : '';
  const stats = [
    stat('Captive jobs', s.captive_jobs || '—'),
    s.required ? stat('Plan requires (excl. HHP, CALF)', s.required) : '',
    s.required ? stat('On hand (avail, &lt;4000hp)', s.have, s.shortfall > 0 ? CO.red : CO.green,
      s.have_road ? `(${s.have_here} here · ${s.have_road} on trains)` : '') : '',
    s.shortfall > 0 ? stat('Shortfall', `<b>−${s.shortfall}</b>`, CO.red) : '',
    stat('In service (captive)', s.inservice),
    stat('Idle spare power', s.spare_n, s.spare_n ? CO.green : null),
    lsUnits.length ? stat('In shop (LS)', lsUnits.length, CO.cyan) : '',
    inb.length ? stat('Inbound (deadhead)', inb.length, CO.inbound, `· ETA ${esc(inb[0].eta) || '—'}`) : '',
  ].join('');
  const panes = [trainsPane(s), unitsPane(s), shopPane(lsUnits), inspPane(s), roadPane(s, locoIndex), inboundPane(inb), sharedPane(s)].filter(Boolean);
  const active = (panes.find((p) => p.key === lastTab) || panes[0] || {}).key;
  const tabs = panes.length ? `<div class="ptabs" role="tablist">` + panes.map((p) =>
    `<button type="button" role="tab" class="ptab${p.key === active ? ' on' : ''}${p.alert ? ' alert' : ''}" data-tab="${p.key}">${p.label}<span class="pn">${p.count}</span></button>`).join('') + `</div>` : '';
  const bodies = panes.map((p) => `<div class="ppane${p.key === active ? ' on' : ''}" data-pane="${p.key}" role="tabpanel"><div class="cap">${p.cap}</div>${p.body}</div>`).join('');
  return `<div class="pop pop-station">
    <div class="phead">
      <div><h3>${esc(s.station)} ${stBadge(s.status)}</h3>
      <div class="loc">${esc(s.station)}, ${esc(displayState(s.state))} · ${esc(s.region)} / ${esc(s.zone)}</div></div>
    </div>
    ${planNote}
    ${balanceBand(s)}
    <div class="pstats">${stats}</div>
    ${tabs}
    <div class="ppanes">${bodies}</div>
  </div>`;
}

/** Wrap the station popup in an element with working tabs (Leaflet accepts an element as content). */
export function stationPopupElement(s, planSt, locoIndex) {
  const el = document.createElement('div');
  el.innerHTML = stationPopup(s, planSt, locoIndex);
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.ptab');
    if (!btn) return;
    lastTab = btn.dataset.tab;
    el.querySelectorAll('.ptab').forEach((b) => b.classList.toggle('on', b === btn));
    el.querySelectorAll('.ppane').forEach((p) => p.classList.toggle('on', p.dataset.pane === lastTab));
  });
  return el;
}

/** Popup sizing: wide on desktop, never wider than the viewport. */
export function stationPopupOptions() {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const w = Math.max(280, Math.min(620, vw - 40));
  return { maxWidth: w, minWidth: Math.min(540, w), className: 'station-popup', autoPanPadding: [20, 20] };
}

export function deadPopup(d) {
  const noShop = !d.tlat;
  return `<div class="pop">
    <h3 style="color:${CO.dead}">${esc(d.loco)} <span class="badge" style="background:${CO.dead}22;color:${CO.dead}">${esc(d.op)} DEAD</span></h3>
    <div class="loc">${esc(d.model)} · at ${esc(d.rawloc)}</div>
    <div class="row"><span>Action</span><span style="color:${noShop ? CO.red : CO.dead}">${noShop ? 'Assign shop' : 'Move to shop'}</span></div>
    <div class="row"><span>Destination shop</span><span style="color:${noShop ? CO.red : CO.cyan}">${noShop ? '— none —' : esc(d.shop + ' · ' + d.tname)}</span></div>
    ${d.dest ? `<div class="row"><span>Train dest</span><span>${esc(d.dest)}</span></div>` : ''}
    <div class="row"><span>Est. release (ETR)</span><span>${esc(d.etr) || '—'}</span></div>
    ${d.notes ? `<div class="units">${esc(d.notes)}</div>` : ''}
  </div>`;
}

export function deadheadPopup(d) {
  return `<div class="pop">
    <h3 style="color:${CO.inbound}">${esc(d.loco)} <span class="badge" style="background:${CO.inbound}22;color:${CO.inbound}">DH · DEADHEAD</span></h3>
    <div class="loc">${esc(d.model)} · from ${esc(d.rawloc)}</div>
    <div class="row"><span>Moving to</span><span style="color:${CO.inbound}">${esc(d.dest)}</span></div>
    <div class="row"><span>ETA</span><span>${esc(d.eta) || '—'}</span></div>
    ${d.train ? `<div class="row"><span>On train</span><span>${esc(d.train)}</span></div>` : ''}
    ${d.etr ? `<div class="row"><span>Est. release (ETR)</span><span>${esc(d.etr)}</span></div>` : ''}
    ${d.notes ? `<div class="units">${esc(d.notes)}</div>` : ''}
  </div>`;
}

export const shopPopup = (sh) =>
  `<div class="pop"><h3 style="color:${CO.cyan}">${esc(sh.code)}</h3><div class="loc">${esc(sh.name)} · repair shop</div></div>`;
