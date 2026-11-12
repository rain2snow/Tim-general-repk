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

function inspSection(s) {
  if (!s.insp || !s.insp.length) return '';
  return `<div class="cap">Inspections due ≤3d</div><div class="units">` + s.insp.map((u) =>
    `<div class="u"><span><b>${esc(u.loco)}</b> ${esc(u.model)}</span><span style="color:${u.days < 0 ? CO.red : CO.amber}">${u.days < 0 ? 'overdue ' + -u.days + 'd' : 'in ' + u.days + 'd'} · ${esc(u.insp)}</span></div>`).join('') + `</div>`;
}
function rosterSection(s) {
  if (!s.roster || !s.roster.length) return '';
  const cap = 30, shown = s.roster.slice(0, cap), more = s.roster.length - shown.length;
  return `<div class="cap">Locomotives here · ${s.roster.length}</div><div class="units roster">` +
    shown.map((u) => {
      const avail = u.desig === 'Available';
      const tag = u.hhp ? `<span class="hhpx">≥4000hp</span>` : u.slug ? `<span class="slugx">slug</span>` : '';
      const lcsTag = u.lcs ? `<span class="lcsx">LCS</span>` : '';
      const dim = u.hhp || u.slug || !avail ? 'opacity:.55' : '';
      const dur = u.op !== 'LN' && u.sinceD != null ? ` <span class="dur">${u.sinceD}d</span>` : '';
      return `<div class="u" style="${dim}"><span><b>${esc(u.loco)}</b> ${esc(u.model)} ${ltTag(u.t)}${lcsTag}</span><span>${esc(u.op)}${dur}${tag}</span></div>`;
    }).join('') + (more > 0 ? `<div class="u more">+${more} more</div>` : '') + `</div>`;
}
function trainsSection(s) {
  if (!s.trains || !s.trains.length) return '';
  const cap = 24, shown = s.trains.slice(0, cap), more = s.trains.length - shown.length;
  return `<div class="cap">Trains / jobs · ${s.trains.length} · requires ${s.required}</div><div class="units trains">` +
    shown.map((t) => {
      const types = t.types.map((x) => `${x[1]}× ${esc(x[0])}`).join(', ');
      const ids = esc(t.ids.join(' / '));
      const shared = t.shared && t.shared.length ? `<span class="shz">shared: ${esc(t.shared.join('; '))}</span>` : '';
      const units = t.units.length
        ? t.units.map((u) => `<span class="tu ${u.here ? '' : 'road'}" title="${esc(u.model)}${u.here ? '' : ' · ' + esc(u.loc)}">${esc(u.loco)}${u.here ? '' : ' ↗'}</span>`).join('')
        : `<span class="tu none">— no units on train —</span>`;
      return `<div class="tr"><div class="tr1"><span class="tid">${ids}${shared}</span><span class="treq">${t.req} · ${types}</span></div><div class="turow">${units}</div></div>`;
    }).join('') + (more > 0 ? `<div class="u more">+${more} more trains</div>` : '') + `</div>`;
}
/**
 * Units homed here but out on the road. Only Available low/mid-HP units count toward on-hand, so a
 * unit riding its train dead (LD / DM / DIT), in shop, etc. is dimmed and tagged "not counted".
 * Status comes from the fleet index (road_units do not carry OpCode / Designation).
 */
function roadSection(s, locoIndex) {
  const list = s.road_units || [];
  if (!list.length) return '';
  const status = (u) => (locoIndex && locoIndex[u.loco]) || {};
  const counts = (u) => { const f = status(u); return !f.op || (f.desig === 'Available' && !f.hhp); };
  const notCounted = list.filter((u) => !counts(u)).length;
  const working = notCounted ? ` · <span class="ncc">${list.length - notCounted} working</span>` : '';
  return `<div class="cap">Home terminal here · out on the road · ${list.length}${working}</div><div class="units roster">` +
    list.slice(0, 30).map((u) => {
      if (counts(u)) {
        return `<div class="u"><span><b>${esc(u.loco)}</b> ${esc(u.model)} ${ltTag(u.t)}</span><span style="color:var(--dim)">↗ ${esc(u.loc)}${u.train ? ' · ' + esc(u.train) : ''}</span></div>`;
      }
      const f = status(u);
      const dead = f.op === 'LD' || f.op === 'DM' || f.desig === 'DIT';
      const why = [f.op, f.desig && f.desig !== f.op ? f.desig : ''].filter(Boolean).join(' · ') + (dead && f.shop ? ` → ${f.shop}` : '');
      return `<div class="u nc"><span><b>${esc(u.loco)}</b> ${esc(u.model)} ${ltTag(u.t)}<span class="ncx ${dead ? 'dead' : ''}" title="${dead ? 'Dead in transit' : 'Not Available'} — not counted toward on-hand${f.etr ? ' · ETR ' + esc(f.etr) : ''}">${esc(why)} · not counted</span></span>` +
        `<span style="color:var(--dim)">↗ ${esc(u.loc)}${u.train ? ' · ' + esc(u.train) : ''}</span></div>`;
    }).join('') +
    (list.length > 30 ? `<div class="u more">+${list.length - 30} more</div>` : '') + `</div>`;
}
function shopSection(lsUnits) {
  if (!lsUnits.length) return '';
  const lsSoon = lsUnits.filter((u) => u.etrH != null && u.etrH < 24).length;
  return `<div class="cap">In shop (LS / Shopped) · ${lsUnits.length}${lsSoon ? ` · <span style="color:${CO.green}">${lsSoon} returning ≤24h</span>` : ''}</div><div class="units">` +
    lsUnits.map((u) => {
      const soon = u.etrH != null && u.etrH < 24;
      const etrTxt = u.etr ? `ETR ${esc(u.etr)}` : 'ETR —';
      const dur = u.sinceD != null ? ` <span class="dur">${u.sinceD}d in shop</span>` : '';
      return `<div class="u"${soon ? ` style="background:${CO.green}14;border-radius:5px;padding:1px 4px"` : ''}><span><b>${esc(u.loco)}</b> ${esc(u.model)}${dur}</span><span style="color:${soon ? CO.green : 'var(--dim)'};${soon ? 'font-weight:700' : ''}">${soon ? '↩ ' : ''}${etrTxt}</span></div>`;
    }).join('') + `</div>`;
}
function inboundSection(inb) {
  if (!inb.length) return '';
  return `<div class="cap">Inbound deadhead · ${inb.length}</div><div class="units">` +
    inb.map((u) => `<div class="u"><span><b>${esc(u.loco)}</b> ${esc(u.model)} ${ltTag(u.t)}</span><span style="color:${CO.inbound}">from ${esc(u.rawloc)} · ETA ${esc(u.eta) || '—'}</span></div>`).join('') + `</div>`;
}
function sharedSection(s) {
  if (!s.shared_in || !s.shared_in.length) return '';
  return `<div class="cap">Shared assignment — counted at the primary terminal</div><div class="units">` +
    s.shared_in.map((x) => `<div class="u"><span>${esc(x.ids.join(' / '))}</span><span style="color:${CO.even}">→ ${esc(x.primary)} · ${x.req}u</span></div>`).join('') + `</div>`;
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

/** @param planSt '' | 'planned' | 'done' */
/**
 * @param planSt    '' | 'planned' | 'done'
 * @param locoIndex loco id -> fleet record (OpCode / Designation for the on-the-road list)
 */
export function stationPopup(s, planSt = '', locoIndex = null) {
  const lsUnits = (s.roster || []).filter((u) => u.op === 'LS');
  const inb = s.inbound || [];
  const planNote = planSt ? netband(CO.green, planSt === 'done' ? '✓' : '●', (planSt === 'done' ? 'plan resolved' : 'plan in place') + ' — see Actions Required tab') : '';
  const onhand = s.required ? `<div class="row"><span>On hand (avail, &lt;4000hp)</span><span style="color:${s.shortfall > 0 ? CO.red : CO.green}">${s.have}${s.have_road ? ` <span style="color:var(--dim)">(${s.have_here} here · ${s.have_road} on trains)</span>` : ''}</span></div>` : '';
  return `<div class="pop">
    <h3>${esc(s.station)} ${stBadge(s.status)}</h3>
    <div class="loc">${esc(s.station)}, ${esc(displayState(s.state))} · ${esc(s.region)} / ${esc(s.zone)}</div>
    ${planNote}
    ${balanceBand(s)}
    <div class="row"><span>Captive jobs</span><span>${s.captive_jobs || '—'}</span></div>
    ${s.required ? `<div class="row"><span>Plan requires (excl. HHP, CALF)</span><span>${s.required}</span></div>` : ''}
    ${onhand}
    ${s.shortfall > 0 ? `<div class="row"><span>Shortfall</span><span style="color:${CO.red}"><b>−${s.shortfall}</b></span></div>` : ''}
    <div class="row"><span>In service (captive)</span><span>${s.inservice}</span></div>
    <div class="row"><span>Idle spare power</span><span style="color:${s.spare_n ? CO.green : 'inherit'}">${s.spare_n}</span></div>
    ${lsUnits.length ? `<div class="row"><span>In shop (LS)</span><span style="color:${CO.cyan}">${lsUnits.length}</span></div>` : ''}
    ${inb.length ? `<div class="row"><span>Inbound (deadhead)</span><span style="color:${CO.inbound}">${inb.length} · ETA ${esc(inb[0].eta) || '—'}</span></div>` : ''}
    ${sharedSection(s)}
    ${trainsSection(s)}
    ${inspSection(s)}
    ${shopSection(lsUnits)}
    ${inboundSection(inb)}
    ${rosterSection(s)}
    ${roadSection(s, locoIndex)}
  </div>`;
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
