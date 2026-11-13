/** Leaflet popup HTML for stations, dead units, deadheads and shops. */
import { THEME as CO, tint, displayState } from '../../core/constants.js';
import { esc } from '../../core/html.js';
import { stationOfKey } from '../../core/keys.js';

const BADGES = {
  short: ['SHORT', CO.red], even: ['EVEN', CO.even], surplus: ['SURPLUS', CO.green],
  shared: ['SHARED', CO.even], free: ['FREE L/M HP', CO.violet],
};
function stBadge(st) {
  const [t, c] = BADGES[st] || ['', ''];
  return `<span class="badge" style="background:${tint(c,'22')};color:${c}">${t}</span>`;
}
function ltTag(t) {
  const c = t === 'HHP' ? CO.cyan : t === 'MHP' ? CO.amber : CO.green;
  return `<span style="color:${c}">${esc(t || '—')}</span>`;
}
const netband = (color, n, label) =>
  `<div class="netband" style="color:${color};border-color:${tint(color,'55')}"><span class="nb-n">${n}</span><span class="nb-l">${label}</span></div>`;

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
 * Assign tab: dispatcher's manual assignments at this terminal.
 * Lists every unit counted toward the terminal (with how it got here) and lets the dispatcher
 * assign another unit here, release one, or undo a manual change. Actions bubble up as a
 * 'dispatch:assign' event ({ loco, k, note }; k = this key | '' release | null undo) for the app.
 */
function assignPane(s, locoIndex, asg) {
  const map = (asg && asg.map) || {};
  const nameOf = (asg && asg.nameOf) || ((k) => stationOfKey(k));
  const counted = (s.have_units || []).map((u) => ({ loco: u[0], model: u[1], fam: u[2], road: !!u[5] }));
  const countedSet = new Set(counted.map((u) => u.loco));
  const via = (u) => {
    const f = (locoIndex && locoIndex[u.loco]) || {};
    if (f.manual === s.k) return '<span class="asg-tag man">manual</span>';
    if (u.road) return `<span class="asg-tag road" title="${esc(f.loc || '')}">on road · ${esc(f.loc || '')}</span>`;
    return f.home === s.k ? '<span class="asg-tag">train home</span>' : '<span class="asg-tag">sitting here</span>';
  };
  const btn = (loco, k, label, cls = '') => `<button type="button" class="asg-btn ${cls}" data-asg-loco="${esc(loco)}" data-asg-k="${k === null ? 'null' : esc(k)}">${label}</button>`;
  const rows = counted.map((u) => {
    const manual = map[u.loco] && map[u.loco].k === s.k;
    const note = manual && map[u.loco].note ? `<span class="asg-note" title="${esc(map[u.loco].note)}">“${esc(map[u.loco].note)}”</span>` : '';
    return `<div class="u asg-row"><span><b>${esc(u.loco)}</b> ${esc(u.model)} <span class="dim">${esc(u.fam)}</span> ${via(u)}${note}</span>` +
      `<span>${manual ? btn(u.loco, null, 'Undo') : btn(u.loco, '', 'Release', 'ghost')}</span></div>`;
  }).join('') || '<div class="u more">No units counted here.</div>';
  // manual assignments to this terminal that do not count (not Available / HHP / slug), and units released here
  const extra = Object.entries(map).filter(([loco, v]) => (v.k === s.k && !countedSet.has(loco)) ||
    (v.k === '' && (v.from === s.k || (locoIndex && locoIndex[loco] && locoIndex[loco].k === s.k)))).map(([loco, v]) => {
    const f = (locoIndex && locoIndex[loco]) || {};
    const why = v.k === '' ? 'released — not counted at any terminal' :
      f.hhp ? 'HHP — not counted' : !f.op ? 'not in this snapshot' : `${esc(f.op)} · ${esc(f.desig || '')} — not counted`;
    return `<div class="u asg-row nc"><span><b>${esc(loco)}</b> ${esc(f.model || '')} <span class="asg-tag ${v.k === '' ? '' : 'man'}">${v.k === '' ? 'released' : 'manual'}</span> <span class="dim">${why}</span></span><span>${btn(loco, null, 'Undo')}</span></div>`;
  }).join('');
  const nManual = Object.values(map).filter((v) => v.k === s.k).length;
  return {
    key: 'assign', label: 'Assign', count: nManual || '+',
    cap: `Assignments at ${esc(s.station)} · ${counted.length} counted${nManual ? ` · ${nManual} manual` : ''}`,
    body: `<form class="asg-add" autocomplete="off">
        <input class="asg-loco" name="loco" list="asg-locos" placeholder="Loco ID, e.g. CN4138" spellcheck="false" required>
        <input class="asg-notein" name="note" placeholder="Note (optional)" maxlength="80">
        <button type="submit" class="asg-btn primary">Assign here</button>
        <div class="asg-msg" aria-live="polite"></div>
      </form>
      <div class="asg-help"><b>Assign</b> overrides a unit's train-based home: it counts toward ${esc(s.station)} (on the road if it is elsewhere) when Available and under 4000&nbsp;hp. <b>Release</b> takes a unit out of the count at every terminal. <b>Undo</b> returns it to automatic.</div>
      <div class="units roster pgrid asg-list">${rows}${extra}</div>`,
    nameOf,
  };
}

/**
 * Consists tab: consists built at this terminal (lead first, approx HP, warnings) and a builder.
 * Actions bubble as 'dispatch:consist' ({ action: 'save', consist } | { action: 'dissolve', id }).
 */
function consistsPane(s, ctx) {
  const list = s.consists || [];
  const jobs = (s.trains || []).map((t) => t.ids.join(' / '));
  const statusTag = (u) => u.missing ? '<span class="asg-tag">not in snapshot</span>'
    : !u.counted ? `<span class="asg-tag" title="${esc(u.op)} · ${esc(u.desig)} at ${esc(String(u.at).split('|')[0])}">${u.here ? esc(u.op) : '↗ ' + esc(String(u.at).split('|')[0])} · not counted</span>`
      : u.here ? '' : `<span class="asg-tag road">↗ ${esc(String(u.at).split('|')[0])}</span>`;
  const cards = list.map((c) => `
    <div class="cs-card" data-consist='${esc(JSON.stringify({ id: c.id, name: c.name, job: c.job, note: c.note, units: c.units.map((u) => u.loco) })).replace(/'/g, '&#39;')}'>
      <div class="cs-h"><b>${esc(c.name)}</b>${c.job ? `<span class="dim">on ${esc(c.job)}</span>` : '<span class="dim">no job</span>'}
        <span class="cs-hp">≈ ${c.hp.toLocaleString()} hp</span></div>
      <div class="cs-units">${c.units.map((u) => `<span class="cs-u${u.counted ? '' : ' nc'}">${u.lead ? '<span class="cs-lead" title="lead unit">★</span>' : ''}<b>${esc(u.loco)}</b> ${esc(u.model || '')}${statusTag(u)}</span>`).join('')}</div>
      ${c.warnings.length ? `<div class="cs-warn">${c.warnings.map((w) => `⚠ ${esc(w)}`).join('<br>')}</div>` : ''}
      ${c.note ? `<div class="asg-note">“${esc(c.note)}”</div>` : ''}
      <div class="cs-btns"><button type="button" class="asg-btn" data-cs="edit">Edit</button>
        <button type="button" class="asg-btn" data-cs="dh">Deadhead…</button>
        <button type="button" class="asg-btn ghost" data-cs="dissolve">Dissolve</button></div>
    </div>`).join('') || '<div class="u more">No consists at this terminal yet.</div>';
  return {
    key: 'consists', label: 'Consists', count: list.length || '+',
    cap: `Consists at ${esc(s.station)} · ${list.length}`,
    body: `<div class="cs-list">${cards}</div>
      <form class="cs-form" autocomplete="off">
        <div class="cs-fh">New consist</div>
        <input type="hidden" name="id" value="">
        <div class="cs-row">
          <input name="name" placeholder="Name (e.g. ${esc(s.station.slice(0, 4))}-${list.length + 1})" maxlength="40">
          <select name="job"><option value="">— no job —</option>${jobs.map((j) => `<option value="${esc(j)}">${esc(j)}</option>`).join('')}</select>
        </div>
        <div class="cs-chips"></div>
        <div class="cs-row">
          <input class="cs-add" list="asg-locos" placeholder="Add unit (lead first)…" spellcheck="false">
          <button type="button" class="asg-btn" data-cs="add">Add</button>
          <input name="note" placeholder="Note (optional)" maxlength="80">
        </div>
        <div class="asg-msg cs-msg" aria-live="polite"></div>
        <div class="cs-btns"><button type="submit" class="asg-btn primary">Save consist</button>
          <button type="button" class="asg-btn ghost" data-cs="reset">Clear</button></div>
      </form>
      <div class="asg-help">Units in a consist count toward ${esc(s.station)} (if Available, &lt;4000 hp). Tie it to a job to put its units on that job in the Trains tab. A unit belongs to one consist at a time. HP is approximate (by model).</div>`,
  };
}

/**
 * Deadhead tab: plan a move of a unit (or a whole consist) to another terminal, and list manual
 * deadheads leaving / arriving here. Actions bubble as 'dispatch:deadhead'.
 */
function deadheadPane(s, locoIndex, ctx) {
  const dhs = (ctx && ctx.deadheads) || {};
  const nameOf = (ctx && ctx.nameOf) || ((k) => String(k).split('|')[0]);
  const out = Object.entries(dhs).filter(([l, d]) => locoIndex && locoIndex[l] && locoIndex[l].k === s.k && d.to !== s.k);
  const inn = Object.entries(dhs).filter(([, d]) => d.to === s.k);
  const row = ([l, d], dir) => {
    const f = (locoIndex && locoIndex[l]) || {};
    return `<div class="u asg-row"><span><b>${esc(l)}</b> ${esc(f.model || '')} <span class="asg-tag man">${dir === 'out' ? '→ ' + esc(nameOf(d.to)) : 'from ' + esc(String(f.k || '?').split('|')[0])}</span>` +
      `${d.eta ? ` <span class="dim">ETA ${esc(d.eta)}</span>` : ''}${d.note ? ` <span class="asg-note">“${esc(d.note)}”</span>` : ''}</span>` +
      `<span><button type="button" class="asg-btn" data-dh-cancel="${esc(l)}">Cancel</button></span></div>`;
  };
  const consistOpts = (s.consists || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${c.units.length} units)</option>`).join('');
  return {
    key: 'deadhead', label: 'Deadhead', count: out.length + inn.length || '+',
    cap: `Deadheads at ${esc(s.station)} · ${out.length} out · ${inn.length} in`,
    body: `<form class="dh-form" autocomplete="off">
        <div class="cs-row">
          <input class="dh-loco" name="loco" list="asg-locos" placeholder="Unit, e.g. CN4138" spellcheck="false">
          ${consistOpts ? `<select name="consist"><option value="">…or a consist here</option>${consistOpts}</select>` : ''}
        </div>
        <div class="cs-row">
          <input class="dh-to" name="to" list="dh-stations" placeholder="To terminal, e.g. HALIFAX NS" spellcheck="false">
          <input name="eta" placeholder="ETA (e.g. 11/13 14:00)" maxlength="30">
        </div>
        <div class="cs-row"><input name="note" placeholder="Note / train (optional)" maxlength="80"></div>
        <div class="asg-msg dh-msg" aria-live="polite"></div>
        <button type="submit" class="asg-btn primary">Plan deadhead</button>
      </form>
      <div class="asg-help">A planned deadhead counts the unit at its destination (on the road until it arrives) and shows the move on the map. It replaces any deadhead in the STP export for that unit.</div>
      ${out.length ? `<div class="ugh">Leaving ${esc(s.station)} <span>${out.length}</span></div><div class="units roster pgrid">${out.map((e) => row(e, 'out')).join('')}</div>` : ''}
      ${inn.length ? `<div class="ugh">Coming to ${esc(s.station)} <span>${inn.length}</span></div><div class="units roster pgrid">${inn.map((e) => row(e, 'in')).join('')}</div>` : ''}
      ${swapSection(s, ctx)}`,
  };
}

/** Swap plans touching this terminal (as line point or hub terminal) + a button to plan one. */
function swapSection(s, ctx) {
  const ws = ((ctx && ctx.swaps) || []).filter((w) => w.point === s.k || w.base === s.k);
  const nameOf = (ctx && ctx.nameOf) || ((k) => String(k).split('|')[0]);
  const isTerm = ctx && ctx.isHubTerminal && ctx.isHubTerminal(s.k);
  const rows = ws.map((w) => `<div class="u asg-row"><span><span class="asg-tag swp">${esc(w.id)}</span> ${w.point === s.k ? `⇄ ${esc(nameOf(w.base))}` : `⇄ ${esc(nameOf(w.point))}`}
      <span class="dim">${w.toHub.length} to shop · ${w.toPoint.length} to line point${w.eta ? ' · ETA ' + esc(w.eta) : ''}</span></span>
      <span><button type="button" class="asg-btn" data-swap-act="edit" data-id="${esc(w.id)}">Edit</button></span></div>`).join('');
  return `<div class="ugh">Swap plans <span>${ws.length}</span></div>
    ${rows ? `<div class="units roster pgrid">${rows}</div>` : ''}
    <button type="button" class="asg-btn" data-swap-act="new" style="margin-top:6px">⇄ ${isTerm ? 'Plan a swap with a line point…' : 'Plan a swap with the hub shop…'}</button>`;
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
    return `<div class="u"${soon ? ` style="background:${tint(CO.green,'14')};border-radius:5px;padding:1px 4px"` : ''}><span><b>${esc(u.loco)}</b> ${esc(u.model)}${dur}</span><span style="color:${soon ? CO.green : 'var(--dim)'};${soon ? 'font-weight:700' : ''}">${soon ? '↩ ' : ''}${etrTxt}</span></div>`;
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
  const body = inb.map((u) => `<div class="u"><span><b>${esc(u.loco)}</b> ${esc(u.model)} ${ltTag(u.t)}${u.swap ? `<span class="asg-tag swp" title="Part of swap plan ${esc(u.swap)}">swap ${esc(u.swap)}</span>` : u.manual ? '<span class="asg-tag man" title="Planned in this console">manual</span>' : ''}</span><span style="color:${CO.inbound}">from ${esc(u.rawloc)} · ETA ${esc(u.eta) || '—'}${u.manual && u.notes ? ' · ' + esc(u.notes) : ''}</span></div>`).join('');
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
export function stationPopup(s, planSt = '', locoIndex = null, asg = null) {
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
  const panes = [trainsPane(s), unitsPane(s), shopPane(lsUnits), inspPane(s), roadPane(s, locoIndex), inboundPane(inb), sharedPane(s),
    asg ? assignPane(s, locoIndex, asg) : null, asg ? consistsPane(s, asg) : null, asg ? deadheadPane(s, locoIndex, asg) : null].filter(Boolean);
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
export function stationPopupElement(s, planSt, locoIndex, asg = null) {
  const el = document.createElement('div');
  el.innerHTML = stationPopup(s, planSt, locoIndex, asg);
  const emit = (loco, k, note) => el.dispatchEvent(new CustomEvent('dispatch:assign', { bubbles: true, detail: { loco, k, note, station: s.k } }));
  el.addEventListener('click', (e) => {
    const ab = e.target.closest('.asg-btn[data-asg-loco]');
    if (ab) { const k = ab.dataset.asgK; emit(ab.dataset.asgLoco, k === 'null' ? null : k); return; }
    const btn = e.target.closest('.ptab');
    if (!btn) return;
    lastTab = btn.dataset.tab;
    el.querySelectorAll('.ptab').forEach((b) => b.classList.toggle('on', b === btn));
    el.querySelectorAll('.ppane').forEach((p) => p.classList.toggle('on', p.dataset.pane === lastTab));
  });
  const form = el.querySelector('.asg-add');
  if (form) {
    const input = form.querySelector('.asg-loco'), msg = form.querySelector('.asg-msg');
    const describe = (id) => {
      const f = locoIndex && locoIndex[id];
      if (!id) return ['', ''];
      if (!f) return [`${id} is not in this snapshot.`, 'err'];
      const counts = f.desig === 'Available' && !f.hhp && !/^(YBU|HBU)/.test(f.model || '');
      const homeTxt = f.home ? (f.home === s.k ? 'already homed here' : `homed at ${(asg && asg.nameOf ? asg.nameOf(f.home) : f.home)}`) : 'no home terminal';
      return [`${f.loco} ${f.model} · ${f.op} ${f.desig} · at ${f.loc || '?'} · ${homeTxt}` +
        (counts ? '' : ' — will not count (only Available units under 4000 hp count)'), counts ? 'ok' : 'warn'];
    };
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/\s+/g, '');
      const [t, cls] = describe(input.value); msg.textContent = t; msg.className = 'asg-msg ' + cls;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = input.value.trim().toUpperCase();
      if (!locoIndex || !locoIndex[id]) { const [t] = describe(id); msg.textContent = t || 'Enter a loco ID.'; msg.className = 'asg-msg err'; return; }
      emit(id, s.k, form.querySelector('.asg-notein').value.trim());
    });
  }
  wireConsists(el, s, locoIndex, asg);
  wireDeadheads(el, s, locoIndex, asg);
  return el;
}

const fire = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

/** "HALIFAX NS", "halifax, ns" or "HALIFAX|NS" -> station key, if it is a known station. */
function stationKeyFrom(text, ctx) {
  const t = String(text || '').trim().toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!t) return null;
  const k = t.includes('|') ? t : t.replace(/ (\w\w)$/, '|$1');
  return ctx && ctx.isStation && ctx.isStation(k) ? k : null;
}

function wireConsists(el, s, locoIndex, ctx) {
  const form = el.querySelector('.cs-form');
  if (!form) return;
  let units = [];
  const chips = form.querySelector('.cs-chips'), msg = form.querySelector('.cs-msg'), add = form.querySelector('.cs-add');
  const say = (t, cls = '') => { msg.textContent = t; msg.className = 'asg-msg cs-msg ' + cls; };
  const draw = () => {
    chips.innerHTML = units.length ? units.map((l, i) => {
      const f = (locoIndex && locoIndex[l]) || {};
      return `<span class="cs-chip">${i === 0 ? '<span class="cs-lead">★</span>' : `<button type="button" class="cs-mini" data-cs-lead="${i}" title="Make lead">★</button><button type="button" class="cs-mini" data-cs-up="${i}" title="Move earlier">◀</button>`}` +
        `<b>${esc(l)}</b> <span class="dim">${esc(f.model || '?')}</span><button type="button" class="cs-mini" data-cs-del="${i}" title="Remove">✕</button></span>`;
    }).join('') : '<span class="dim">No units yet — add them lead first.</span>';
  };
  const load = (c) => {
    form.querySelector('.cs-fh').textContent = c ? `Edit ${c.name}` : 'New consist';
    form.elements.id.value = c ? c.id : '';
    form.elements.name.value = c ? c.name : '';
    form.elements.job.value = c ? c.job || '' : '';
    form.elements.note.value = c ? c.note || '' : '';
    units = c ? c.units.slice() : [];
    draw(); say('');
  };
  const addUnit = () => {
    const id = add.value.trim().toUpperCase();
    if (!id) return;
    const f = locoIndex && locoIndex[id];
    if (!f) { say(`${id} is not in this snapshot.`, 'err'); return; }
    if (units.includes(id)) { say(`${id} is already in this consist.`, 'warn'); return; }
    units.push(id); add.value = ''; draw();
    const notes = [];
    if (f.consist && f.consist !== form.elements.id.value) notes.push(`it will be moved out of consist ${f.consist}`);
    if (f.desig !== 'Available') notes.push(`${f.op} · ${f.desig} — will not count`);
    if (f.k !== s.k) notes.push(`it is at ${f.loc || f.k} — deadhead it here to bring it in`);
    say(notes.length ? `${id}: ${notes.join('; ')}.` : `${id} ${f.model} added.`, notes.length ? 'warn' : 'ok');
  };
  draw();
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUnit(); } });
  add.addEventListener('input', () => { add.value = add.value.toUpperCase().replace(/\s+/g, ''); });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cs],[data-cs-del],[data-cs-up],[data-cs-lead]');
    if (!b) return;
    // these buttons re-render the chips, detaching the clicked node; Leaflet would then not see the
    // click as coming from inside the popup and close it as a map click
    e.stopPropagation();
    if (b.dataset.csDel != null) { units.splice(+b.dataset.csDel, 1); draw(); return; }
    if (b.dataset.csUp != null) { const i = +b.dataset.csUp; [units[i - 1], units[i]] = [units[i], units[i - 1]]; draw(); return; }
    if (b.dataset.csLead != null) { const i = +b.dataset.csLead; units.unshift(units.splice(i, 1)[0]); draw(); return; }
    const card = b.closest('.cs-card');
    const c = card ? JSON.parse(card.dataset.consist) : null;
    if (b.dataset.cs === 'add') addUnit();
    else if (b.dataset.cs === 'reset') load(null);
    else if (b.dataset.cs === 'edit') { load(c); form.scrollIntoView({ block: 'nearest' }); }
    else if (b.dataset.cs === 'dissolve') fire(el, 'dispatch:consist', { action: 'dissolve', id: c.id, station: s.k });
    else if (b.dataset.cs === 'dh') {
      const tab = el.querySelector('.ptab[data-tab="deadhead"]'); if (tab) tab.click();
      const sel = el.querySelector('.dh-form select[name="consist"]'); if (sel) sel.value = c.id;
      const to = el.querySelector('.dh-form .dh-to'); if (to) to.focus();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!units.length) { say('Add at least one unit.', 'err'); return; }
    fire(el, 'dispatch:consist', { action: 'save', station: s.k, consist: {
      id: form.elements.id.value || null, name: form.elements.name.value.trim(), k: s.k,
      job: form.elements.job.value, units, note: form.elements.note.value.trim() } });
  });
}

function wireDeadheads(el, s, locoIndex, ctx) {
  const form = el.querySelector('.dh-form');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dh-cancel]');
    if (b) fire(el, 'dispatch:deadhead', { action: 'cancel', loco: b.dataset.dhCancel, station: s.k });
    const sw = e.target.closest('[data-swap-act]');
    if (sw) {
      e.stopPropagation();
      const term = ctx && ctx.isHubTerminal && ctx.isHubTerminal(s.k);
      fire(el, 'dispatch:swap', sw.dataset.swapAct === 'edit' ? { action: 'edit', id: sw.dataset.id } : term ? { action: 'new', base: s.k } : { action: 'new', point: s.k });
    }
  });
  if (!form) return;
  const msg = form.querySelector('.dh-msg');
  const say = (t, cls = '') => { msg.textContent = t; msg.className = 'asg-msg dh-msg ' + cls; };
  form.elements.loco.addEventListener('input', (e) => {
    const v = e.target.value = e.target.value.toUpperCase().replace(/\s+/g, '');
    const f = locoIndex && locoIndex[v];
    if (!v) say('');
    else if (!f) say(`${v} is not in this snapshot.`, 'err');
    else say(`${f.loco} ${f.model} · ${f.op} ${f.desig} · at ${f.loc || '?'}` + (f.desig === 'Available' ? '' : ' — will move but not count'), f.desig === 'Available' ? 'ok' : 'warn');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const consist = form.elements.consist ? form.elements.consist.value : '';
    const loco = form.elements.loco.value.trim().toUpperCase();
    const to = stationKeyFrom(form.elements.to.value, ctx);
    if (!consist && !(locoIndex && locoIndex[loco])) { say(loco ? `${loco} is not in this snapshot.` : 'Enter a unit or choose a consist.', 'err'); return; }
    if (!to) { say('Choose a destination terminal from the list (e.g. HALIFAX NS).', 'err'); return; }
    if (!consist && locoIndex[loco].k === to) { say(`${loco} is already at ${form.elements.to.value}.`, 'warn'); return; }
    fire(el, 'dispatch:deadhead', { action: 'add', station: s.k, to, eta: form.elements.eta.value.trim(), note: form.elements.note.value.trim(),
      ...(consist ? { consist } : { locos: [loco] }) });
  });
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
    <h3 style="color:${CO.dead}">${esc(d.loco)} <span class="badge" style="background:${tint(CO.dead,'22')};color:${CO.dead}">${esc(d.op)} DEAD</span></h3>
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
    <h3 style="color:${CO.inbound}">${esc(d.loco)} <span class="badge" style="background:${tint(CO.inbound,'22')};color:${CO.inbound}">DH · DEADHEAD</span></h3>
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
