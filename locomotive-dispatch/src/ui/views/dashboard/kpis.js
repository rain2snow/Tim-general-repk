/** Dashboard KPI tiles and their click-to-drill detail panel. */
import { COLORS as CO, HBO_OPS, SLUG_MODELS } from '../../../core/constants.js';
import { isLowMidHP } from '../../../core/balance.js';
import { $$, byId } from '../../dom.js';
import { emit } from '../../state.js';

const netColor = (net) => (net > 0 ? CO.green : net < 0 ? CO.red : CO.even);
const badge = (c, txt) => `<span class="badge" style="background:${c}22;color:${c};border:1px solid ${c}55">${txt}</span>`;
const stLine = (s, sep = '') => `<span class="st">${s.state}${s.zone ? ' · ' + s.zone : sep}</span>`;
const stLineZone = (s) => `<span class="st">${s.state} · ${s.zone || '—'}</span>`;

/** Available low/mid HP physically here + homed here but on the road. */
function presentUnits(s) {
  const here = (s.roster || []).filter((u) => u.desig === 'Available' && isLowMidHP(u)).map((u) => ({ ...u, road: false }));
  const road = (s.road_units || []).filter((u) => u.t !== 'HHP' && !SLUG_MODELS.has(u.model)).map((u) => ({ ...u, road: true }));
  return [...here, ...road];
}
const unitTags = (units) => units.map((u) => `<span class="ltag ${u.road ? 'road' : ''} ${u.short ? 'short' : ''}" title="${u.model}">${u.loco}</span>`).join('');

/**
 * One location card. `color` tints both border and badge; `border: false` keeps the
 * default border (badge still tinted).
 */
function card(s, inner, { color, border = true, badgeTxt, dataKey = false, stHtml = stLine(s) } = {}) {
  const borderStyle = color && border ? ` style="border-color:${color}33"` : '';
  return `<div class="kd-card"${dataKey ? ` data-key="${s.k}"` : ''}${borderStyle}>
    <div class="loc"><span>${s.station}</span>${stHtml}${badgeTxt != null ? badge(color || CO.even, badgeTxt) : ''}</div>
    ${inner}</div>`;
}

/** Each KPI: tile metadata + a detail builder returning {title, cards}. */
export function kpiDefinitions(data, k) {
  const plan = k.plan;
  return [
    { id: 'req', label: 'Total required', color: '#c7d2e2', value: k.totReq, detail: () => ({
      title: `Required units by location (${plan.length} locations · ${k.totReq} total)`,
      cards: [...plan].sort((a, b) => b.required - a.required).map((s) => `<div class="kd-card">
          <div class="loc"><span>${s.station}</span>${stLine(s)}
            <span class="badge" style="background:#1a2a3a;color:#c7d2e2;border:1px solid #2b2e36">${s.required}</span></div>
          <div class="locos">${s.req_detail.map(([t, n]) => `<span class="ltag">${n}× ${t}</span>`).join('')}</div></div>`).join(''),
    }) },
    { id: 'have', label: 'Total on hand', color: CO.cyan, value: k.totHave, detail: () => ({
      title: `On-hand Available L/M HP units at plan locations (${k.totHave} units)`,
      cards: plan.filter((s) => s.have > 0).sort((a, b) => b.have - a.have).map((s) => {
        const units = presentUnits(s);
        if (!units.length) return '';
        return card(s, `<div class="locos">${unitTags(units)}</div>`, { color: netColor(s.have - s.required), border: false, badgeTxt: s.have });
      }).join(''),
    }) },
    { id: 'net', label: 'Net balance', color: netColor(k.totNet), value: (k.totNet > 0 ? '+' : '') + k.totNet, detail: () => ({
      title: `Net balance by location — plan locations sorted worst to best`,
      cards: [...plan].sort((a, b) => (a.have - a.required) - (b.have - b.required)).map((s) => {
        const net = s.have - s.required, nc = netColor(net);
        return card(s, `<div class="locos">
            <span class="ltag" style="color:#aeb9cc">req ${s.required}</span>
            <span class="ltag" style="color:${CO.cyan}">have ${s.have}</span>
            ${s.shortfall > 0 ? `<span class="ltag short">−${s.shortfall} short</span>` : ''}
            ${s.spare_n > 0 ? `<span class="ltag" style="color:${CO.green}">+${s.spare_n} spare</span>` : ''}
          </div>`, { color: nc, badgeTxt: (net > 0 ? '+' : '') + net, stHtml: stLineZone(s) });
      }).join(''),
    }) },
    { id: 'short', label: 'Short locations', color: CO.red, value: k.nShort, detail: () => {
      const shorts = plan.filter((s) => s.have < s.required).sort((a, b) => (a.have - a.required) - (b.have - b.required));
      return {
        title: `Short locations — ${shorts.length} locations, ${shorts.reduce((a, s) => a + s.shortfall, 0)} units short`,
        cards: shorts.map((s) => {
          const typeList = s.req_detail.map(([t, n]) => `<span class="ltag short">${n}× ${t}</span>`).join('');
          const haveList = (s.roster || []).filter((u) => u.desig === 'Available' && isLowMidHP(u)).map((u) => `<span class="ltag">${u.loco}</span>`).join('');
          const roadList = (s.road_units || []).filter((u) => u.t !== 'HHP' && !SLUG_MODELS.has(u.model)).map((u) => `<span class="ltag road">${u.loco}↗</span>`).join('');
          return card(s, `<div class="locos" style="margin-bottom:4px"><span style="font-size:10px;color:var(--dim);margin-right:4px">needs:</span>${typeList}</div>
            ${haveList || roadList ? `<div class="locos"><span style="font-size:10px;color:var(--dim);margin-right:4px">has:</span>${haveList}${roadList}</div>` : ''}`,
          { color: CO.red, badgeTxt: '−' + s.shortfall, dataKey: true, stHtml: stLineZone(s) });
        }).join(''),
      };
    } },
    { id: 'free', label: 'Free L/M HP units', color: CO.violet, value: k.freeUnits, detail: () => {
      const frees = data.stations.filter((s) => s.status === 'free').sort((a, b) => b.have - a.have);
      return {
        title: `Free L/M HP units — ${frees.length} locations, ${k.freeUnits} units unassigned`,
        cards: frees.map((s) => card(s, `<div class="locos">${presentUnits(s).map((u) => `<span class="ltag ${u.road ? 'road' : ''}" title="${u.model}">${u.loco}</span>`).join('')}</div>`,
          { color: CO.violet, badgeTxt: s.have })).join(''),
      };
    } },
    { id: 'shop', label: 'In shop (LS)', color: CO.cyan, value: k.shopUnits, detail: () => {
      const shops = data.stations.map((s) => ({ s, n: (s.roster || []).filter((u) => u.op === 'LS') })).filter((x) => x.n.length).sort((a, b) => b.n.length - a.n.length);
      return {
        title: `In-shop (LS / Shopped) units — ${shops.reduce((a, x) => a + x.n.length, 0)} units at ${shops.length} locations`,
        cards: shops.map((x) => card(x.s, `<div class="locos">${x.n.map((u) => `<span class="ltag shop" title="${u.model}">${u.loco}</span>`).join('')}</div>`,
          { color: CO.cyan, badgeTxt: x.n.length, dataKey: true })).join(''),
      };
    } },
    { id: 'dead', label: 'Dead in transit', color: CO.red, value: k.deadUnits, detail: () => {
      const dd = data.dead || [], byk = {};
      dd.forEach((x) => { const kk = x.rawloc || x.lockey; (byk[kk] = byk[kk] || []).push(x); });
      return {
        title: `Dead-in-transit L/M HP units (LD / DM / DIT) — ${dd.length} units to route`,
        cards: Object.keys(byk).sort((a, b) => byk[b].length - byk[a].length).map((kk) => {
          const tags = byk[kk].map((x) => {
            const sh = x.tname || x.shop || 'no shop assigned';
            const tip = `${x.model} → ${sh}${x.etr ? ' · ETR ' + x.etr : ''}${x.priority ? ' · prio ' + x.priority : ''}`;
            return `<span class="ltag" style="border-color:${CO.red}55" title="${tip}">${x.loco}<span style="color:var(--dim)"> → ${x.shop || '?'}</span></span>`;
          }).join('');
          return `<div class="kd-card" style="border-color:${CO.red}33"><div class="loc"><span>${kk}</span>${badge(CO.red, byk[kk].length)}</div><div class="locos">${tags}</div></div>`;
        }).join(''),
      };
    } },
    { id: 'hbo', label: 'Heavy bad order', color: CO.amber, value: k.hboUnits, detail: () => {
      const hbo = data.fleet.filter((f) => !f.hhp && HBO_OPS.includes(f.op)), byk = {}, stByK = {};
      hbo.forEach((f) => { (byk[f.k] = byk[f.k] || []).push(f); });
      data.stations.forEach((st) => { stByK[st.k] = st; });
      return {
        title: `Heavy bad-order L/M HP units (LA / LB / LO / LV) — ${hbo.length} units at heavy hold`,
        cards: Object.keys(byk).sort((a, b) => byk[b].length - byk[a].length).map((key) => {
          const st = stByK[key] || { k: key, station: String(key).split('|')[0], state: String(key).split('|')[1] || '', zone: '' };
          const tags = byk[key].map((u) => `<span class="ltag" title="${u.model}">${u.loco} <span style="opacity:.6;font-size:8.5px">${u.op}</span></span>`).join('');
          return card({ ...st, k: key }, `<div class="locos">${tags}</div>`, { color: CO.amber, badgeTxt: byk[key].length, dataKey: true, stHtml: `<span class="st">${st.state}${st.zone ? ' · ' + st.zone : ''}</span>` });
        }).join(''),
      };
    } },
  ];
}

export function renderKpis(defs) {
  byId('kpis').innerHTML = defs.map((d) => `<div class="kpi" data-kpi="${d.id}" style="--kc:${d.color}">
      <div class="bar" style="background:${d.color}"></div>
      <div class="v" style="color:${d.color}">${d.value}</div>
      <div class="l">${d.label}</div></div>`).join('');
  const detail = byId('kpi-detail');
  const close = () => { detail.style.display = 'none'; detail.dataset.active = ''; $$('.kpi').forEach((k) => k.classList.remove('active')); };
  detail.style.display = 'none'; detail.dataset.active = '';
  $$('.kpi[data-kpi]').forEach((tile) => tile.addEventListener('click', () => {
    const id = tile.dataset.kpi;
    if (detail.dataset.active === id && detail.style.display !== 'none') { close(); return; } // toggle off
    detail.dataset.active = id;
    $$('.kpi').forEach((k) => k.classList.toggle('active', k.dataset.kpi === id));
    const { title, cards } = defs.find((d) => d.id === id).detail();
    detail.innerHTML = `
      <div class="kd-header"><h3>${title}</h3><button class="close" title="Close">✕</button></div>
      <div class="kd-body">${cards ? `<div class="kd-grid">${cards}</div>` : '<div class="kd-empty">No data</div>'}</div>`;
    detail.style.display = 'block';
    emit('plans');
    detail.querySelector('.close').addEventListener('click', close);
  }));
}
