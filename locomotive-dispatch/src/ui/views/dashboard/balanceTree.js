/**
 * Region -> zone -> location -> model family -> unit tree for the dashboard.
 * Rows are flat <tr>s; nesting is expressed by `grp-<parentId>` classes and toggled in place.
 */
import { THEME as CO, tint, REGION_ORDER } from '../../../core/constants.js';
import { esc } from '../../../core/html.js';
import { buildBalanceTree, familyBreakdown, byNetAsc } from '../../../core/balance.js';
import { isGrouped } from '../../../core/pools.js';
import { $$ } from '../../dom.js';

const slug = (s) => String(s).replace(/[^A-Za-z0-9]/g, '');
const dash = (s) => s.replace(/\s+/g, '-');
const caret = (visible = true) => `<span class="tw" style="visibility:${visible ? 'visible' : 'hidden'}">▾</span>`;
const numCls = (n) => (n > 0 ? 'num-pos' : n < 0 ? 'num-neg' : 'num-zero');
const freeBadge = (n) => (n ? ` <span class="free-badge">${n} free</span>` : '');

function netPill(net) {
  const c = net > 0 ? CO.green : net < 0 ? CO.red : CO.even;
  return `<span class="netcell"><span class="pill" style="background:${tint(c,'22')};color:${c};border:1px solid ${tint(c,'55')}">${net > 0 ? '+' + net : net}</span></span>`;
}

function balBar(req, have, maxReq) {
  if (!req) return '';
  const w = Math.min(72, Math.round((req / maxReq) * 72));
  const fillPct = Math.min(100, Math.round((have / req) * 100));
  const net = have - req;
  const col = net > 0 ? CO.green : net < 0 ? CO.red : CO.even;
  return `<div class="barcell" style="width:92px;height:22px;position:relative;">
    <div style="position:absolute;left:0;top:50%;transform:translateY(-50%);
      width:${w}px;height:10px;background:var(--border2);border-radius:3px;overflow:hidden">
      <div style="height:100%;width:${fillPct}%;background:${col};border-radius:3px;
        opacity:.85;transition:width .3s"></div>
    </div></div>`;
}

const tr = (classes, inner, hidden = true) =>
  `<tr${classes ? ` class="${classes}"` : ''}${hidden ? ' style="display:none"' : ''}><td>${inner}</td></tr>`;

function unitRow(groupCls, u, at, train) {
  const uLcs = u[4] ? ` <span class="lcs-tag">LCS</span>` : '';
  const uWhere = u[5]
    ? `<span class="u-where road" title="on train ${esc(train || '')}">${esc(train || 'road')}</span>`
    : `<span class="u-where home">home</span>`;
  return tr(groupCls + ' urow', `<div class="drow r-unit">
      <span class="nm">${caret(false)}<span class="tx u-loco">${esc(u[0])}${uLcs}</span></span>
      <span class="u-model">${esc(u[1])}</span>
      <span class="u-type">${esc(u[3])}</span>
      <span>${uWhere}</span>
      <span class="u-at">${esc(at || '')}</span>
    </div>`);
}

const emptyUnitRow = (groupCls, label, isReq = false) => tr(groupCls + ' urow', `<div class="drow r-unit">
    <span class="nm">${caret(false)}<span class="tx${isReq ? '' : ' u-dim'}">${label}</span></span>
    <span></span><span></span><span></span><span></span></div>`);

function freeModelRows(parentCls, fId, byFam) {
  let rows = '';
  for (const f of Object.keys(byFam).sort()) {
    const fu = byFam[f], ufId = fId + '-m-' + slug(f);
    rows += tr(`${parentCls} grp-${fId}-m mrow`, `<div class="drow r-model collapsed" data-utoggle="${ufId}">
        <span class="nm">${caret()}<span class="tx">${f}</span></span>
        <span class="req">—</span><span>${fu.length}</span>
        <span class="num-pos" style="text-align:right;font-weight:680">+${fu.length}</span><span></span></div>`);
    for (const u of fu) rows += unitRow(`${parentCls} grp-${ufId}-u`, u, u[6], u[7]);
  }
  return rows;
}
const groupByFamily = (units) => units.reduce((o, u) => { (o[u[2]] = o[u[2]] || []).push(u); return o; }, {});

function locationRows(zId, s, maxLocReq, nameByKey) {
  const grouped = isGrouped(s), isPrimary = !grouped || s.k === s.grp_primary;
  const dispReq = grouped ? s.grp_required : s.required, dispHave = grouped ? s.grp_have : s.have;
  const lNet = grouped ? (isPrimary ? s.grp_net : 0) : s.have - s.required;
  const mId = zId + '-m-' + slug(s.k);
  let shrTag = '';
  if (grouped && isPrimary) {
    const partners = s.grp_members.filter((k) => k !== s.k).map((k) => nameByKey[k] || k);
    const allNames = s.grp_members.map((k) => nameByKey[k] || k).join(' + ');
    shrTag = ` <span class="shr-tag" title="Shared-job pool: ${dispHave} on hand / ${dispReq} required combined across ${allNames} — deficit/surplus shown here at the primary">⇄ pool ${dispHave}/${dispReq}${partners.length ? ' · ' + partners.join(', ') : ''}</span>`;
  } else if (grouped) {
    const primNm = nameByKey[s.grp_primary] || s.grp_primary;
    shrTag = ` <span class="shr-tag" title="Counted in the shared pool — deficit/surplus shown at ${primNm}">⇄ pooled → ${primNm}</span>`;
  }
  const { fams, reqFam, reqLcs, haveFam, haveLcs } = familyBreakdown(s);
  const roadLoc = {}, roadTrain = {};
  (s.road_units || []).forEach((r) => { roadLoc[r.loco] = (r.loc || '').trim(); roadTrain[r.loco] = r.train || ''; });
  const hasModel = fams.length > 0;
  const secondary = grouped && !isPrimary;

  let rows = tr(`grp-${zId}`, `<div class="drow r-loc collapsed" data-key="${s.k}" ${hasModel ? `data-mtoggle="${mId}"` : ''} title="${s.station}, ${s.state}">
      <span class="nm">${caret(hasModel)}<span class="tx">${s.station}</span><span class="st">${s.state}</span>${shrTag}</span>
      <span class="req">${s.required}</span>
      <span>${s.have}</span>
      <span class="${numCls(lNet)}" style="text-align:right;font-weight:680">${secondary ? '<span style="opacity:.55;font-weight:600">⇄</span>' : (lNet > 0 ? '+' : '') + lNet}</span>
      <span>${secondary ? '' : balBar(dispReq, dispHave, Math.max(maxLocReq, dispReq))}</span>
    </div>`);
  if (!hasModel) return rows;

  const maxFamReq = Math.max(1, ...fams.map((f) => reqFam[f] || 0));
  for (const f of fams) {
    const rq = reqFam[f] || 0, hv = haveFam[f] || 0, nt = hv - rq, rqL = reqLcs[f] || 0, hvL = haveLcs[f] || 0;
    const reqTag = rqL ? ` <span class="lcs-tag">${rqL} LCS</span>` : '';
    const haveTag = rqL ? ` <span class="lcs-tag${hvL < rqL ? ' lcs-short' : ''}">${hvL} LCS</span>` : hvL ? ` <span class="lcs-tag">${hvL} LCS</span>` : '';
    const uId = mId + '-u-' + slug(f);
    const units = (s.have_units || []).filter((u) => u[2] === f);
    const reqTokens = (s.req_detail || []).filter((d) => String(d[0]).replace(/ LCS$/, '') === f);
    const expandable = units.length > 0 || reqTokens.length > 0;
    rows += tr(`grp-${zId} grp-${mId}-m mrow`, `<div class="drow r-model collapsed"${expandable ? ` data-utoggle="${uId}"` : ''}>
        <span class="nm">${caret(expandable)}<span class="tx">${f}</span></span>
        <span class="req">${rq}${reqTag}</span>
        <span>${hv}${haveTag}</span>
        <span class="${numCls(nt)}" style="text-align:right;font-weight:680">${nt > 0 ? '+' : ''}${nt}</span>
        <span>${balBar(rq, hv, maxFamReq)}</span>
      </div>`);
    if (!expandable) continue;
    const ucls = `grp-${zId} grp-${uId}-u`;
    const reqTxt = reqTokens.length ? reqTokens.map((d) => `${esc(String(d[0]))} ×${d[1]}`).join(' · ') : '—';
    rows += emptyUnitRow(ucls, `<span class="u-lbl">req</span>${reqTxt}`, true);
    if (units.length) for (const u of units) rows += unitRow(ucls, u, u[5] ? roadLoc[u[0]] || '' : '', roadTrain[u[0]] || '');
    else rows += emptyUnitRow(ucls, 'none on hand');
  }
  return rows;
}

function zoneFreeRows(zId, zName, zData) {
  const fId = zId + '-free', hasFree = zData.free > 0;
  let rows = tr(`grp-${zId}`, `<div class="drow r-loc free-row${hasFree ? ' collapsed' : ''}"${hasFree ? ` data-mtoggle="${fId}"` : ''} title="Free L/M HP (status=free locations) in ${zName} — present but not on a planned assignment">
      <span class="nm">${caret(hasFree)}<span class="tx">Free low/mid HP</span><span class="st">${hasFree ? 'uncommitted' : 'none here'}</span></span>
      <span class="req">—</span>
      <span>${zData.free}</span>
      <span class="${hasFree ? 'num-pos' : 'num-zero'}" style="text-align:right;font-weight:680">${hasFree ? '+' + zData.free : '0'}</span>
      <span></span>
    </div>`);
  if (hasFree) rows += freeModelRows(`grp-${zId}`, fId, groupByFamily(zData.freeUnits));
  return rows;
}

const aggregateRow = (cls, id, name, d, maxReq, hidden, groupCls = '') => tr(groupCls, `
    <div class="drow ${cls} collapsed" data-toggle="${id}">
      <span class="nm"><span class="tw">▾</span><span class="tx">${name}</span>${freeBadge(d.free)}</span>
      <span class="req">${d.req}</span>
      <span>${d.have}</span>
      <span>${netPill(d.have - d.req)}</span>
      <span>${balBar(d.req, d.have, maxReq)}</span>
    </div>`, hidden);

export function balanceTreeHtml(data) {
  const { regions, orphanFree } = buildBalanceTree(data);
  const nameByKey = {};
  data.stations.forEach((s) => { nameByKey[s.k] = s.station; });
  const maxRegReq = Math.max(...Object.values(regions).map((r) => r.req));
  let rows = '';
  for (const rName of REGION_ORDER) {
    const rData = regions[rName];
    if (!rData) continue;
    const rId = 'r-' + dash(rName);
    rows += aggregateRow('r-region', rId, rName, rData, maxRegReq, false);
    const zoneNames = Object.keys(rData.zones).sort();
    const maxZoneReq = Math.max(...zoneNames.map((z) => rData.zones[z].req));
    for (const zName of zoneNames) {
      const zData = rData.zones[zName], zId = rId + '-z-' + dash(zName);
      rows += aggregateRow('r-zone', zId, zName, zData, maxZoneReq, true, `grp-${rId}`);
      const locs = [...zData.locs].sort(byNetAsc);
      const maxLocReq = Math.max(...locs.map((x) => x.required));
      for (const s of locs) rows += locationRows(zId, s, maxLocReq, nameByKey);
      rows += zoneFreeRows(zId, zName, zData);
    }
  }
  if (orphanFree.length) { // free L/M HP at locations with no plan region/zone
    const fId = 'r-unassigned-free';
    rows += tr('', `<div class="drow r-region collapsed" data-toggle="r-unassigned">
      <span class="nm"><span class="tw">▾</span><span class="tx">Unassigned</span> <span class="free-badge">${orphanFree.length} free</span></span>
      <span class="req">—</span><span></span><span></span><span></span></div>`, false);
    rows += tr('grp-r-unassigned', `<div class="drow r-loc free-row collapsed" data-mtoggle="${fId}" title="Free L/M HP at locations with no plan zone">
        <span class="nm"><span class="tw">▾</span><span class="tx">Free low/mid HP</span><span class="st">no plan zone</span></span>
        <span class="req">—</span><span>${orphanFree.length}</span>
        <span class="num-pos" style="text-align:right;font-weight:680">+${orphanFree.length}</span><span></span></div>`);
    rows += freeModelRows('grp-r-unassigned', fId, groupByFamily(orphanFree));
  }
  return rows;
}

/** Wire expand/collapse at every level, plus location click -> map. */
export function wireBalanceTree(root, onLocation) {
  const hideAll = (sel) => $$(sel).forEach((x) => { x.style.display = 'none'; });
  $$('.drow[data-toggle]', root).forEach((row) => row.addEventListener('click', () => {
    const id = row.dataset.toggle, open = !row.classList.contains('collapsed');
    row.classList.toggle('collapsed', open);
    $$(`.grp-${id}`).forEach((trEl) => {
      const isSub = trEl.classList.contains('mrow') || trEl.classList.contains('urow');
      trEl.style.display = open ? 'none' : isSub ? 'none' : '';
      if (!open) return;
      // collapse children when parent collapses
      const child = trEl.querySelector('.drow[data-toggle]');
      if (child) { child.classList.add('collapsed'); hideAll(`.grp-${child.dataset.toggle}`); }
      const locChild = trEl.querySelector('.drow[data-mtoggle]');
      if (locChild) locChild.classList.add('collapsed');
      const modChild = trEl.querySelector('.drow[data-utoggle]');
      if (modChild) modChild.classList.add('collapsed');
    });
  }));
  // location -> model breakdown (caret only; the row itself flies to the map)
  $$('.drow[data-mtoggle]', root).forEach((row) => {
    const tw = row.querySelector('.tw');
    if (!tw) return;
    tw.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = row.dataset.mtoggle, collapsed = row.classList.toggle('collapsed');
      $$(`.grp-${id}-m`).forEach((trEl) => {
        trEl.style.display = collapsed ? 'none' : '';
        if (!collapsed) return;
        const mod = trEl.querySelector('.drow[data-utoggle]');
        if (mod) { mod.classList.add('collapsed'); hideAll(`.grp-${mod.dataset.utoggle}-u`); }
      });
    });
  });
  // model -> units (whole row)
  $$('.drow[data-utoggle]', root).forEach((row) => row.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = row.classList.toggle('collapsed');
    $$(`.grp-${row.dataset.utoggle}-u`).forEach((trEl) => { trEl.style.display = collapsed ? 'none' : ''; });
  }));
  $$('.drow[data-key]', root).forEach((row) => row.addEventListener('click', () => onLocation(row.dataset.key)));
}
