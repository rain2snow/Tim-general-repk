/**
 * Console action queue (right panel), hub-and-spoke:
 *   Tactical  — actions grouped by hub (repair shop), worst hub first; each action carries an
 *               in-hub suggestion (cover from in-hub surplus, swap into the hub shop, ...).
 *   Strategic — system view: hub balances after in-hub cover, and transfers between hubs.
 */
import { esc } from '../../core/html.js';
import { countByType } from '../../core/queue.js';
import { planState } from '../../core/store.js';
import { hubSeverity, UNASSIGNED_HUB } from '../../core/hubs.js';
import { $, $$, byId, setText, isMobile, flashSaved } from '../dom.js';
import { app, emit } from '../state.js';
import { map, markerByKey, deadByLoco, flyToMarker, layerForStatus } from '../map/mapView.js';
import { ensureLayerShown } from './layerToggles.js';

let mode = 'tactical';
let filter = 'all';
const collapsed = new Set();          // hub ids the dispatcher has folded

const allActions = () => Object.values((app.hubModel && app.hubModel.tactical) || {}).flat();

export function rebuildQueue() {
  const acts = allActions();
  const c = countByType(acts);
  setText('c-all', c.all); setText('c-route', c.route); setText('c-swap', c.swap); setText('c-retask', c.retask);
  setText('c-tac', c.all);
  const st = app.hubModel ? app.hubModel.strategic : { transfers: [] };
  setText('c-str', st.transfers.length);
  renderQueue();
}

export function setQueueMode(m) {
  mode = m;
  $$('#qmode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  const seg = byId('seg'); if (seg) seg.style.display = m === 'tactical' ? '' : 'none';
  setText('qsub', m === 'tactical' ? 'by hub' : 'system');
  renderQueue();
}

export function setQueueFilter(f) {
  filter = f;
  $$('#seg button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
  if (mode !== 'tactical') setQueueMode('tactical'); else renderQueue();
}

export function initQueue() {
  $$('#seg button').forEach((b) => b.addEventListener('click', () => setQueueFilter(b.dataset.f)));
  $$('#qmode button').forEach((b) => b.addEventListener('click', () => setQueueMode(b.dataset.mode)));
}

export function renderQueue() {
  const q = byId('queue');
  if (!q || !app.hubModel) return;
  // keep the dispatcher's caret if they are typing a plan while the queue repaints
  const active = document.activeElement;
  const focusId = active && active.classList.contains('qta') && q.contains(active) ? active.closest('[data-aid]').dataset.aid : null;
  const caret = focusId ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = q.scrollTop;
  q.innerHTML = mode === 'tactical' ? tacticalHtml() : strategicHtml();
  wire(q);
  if (focusId) {
    const ta = $(`[data-aid="${CSS.escape(focusId)}"] .qta`, q);
    if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(caret[0], caret[1]); }
  }
  q.scrollTop = scroll;
}

/* ------------------------------------------------------------------ shared bits */
const planFlagText = (ps) => (ps === 'done' ? '✓ DONE' : ps === 'planned' ? '● PLAN' : '');
function solBlock(aid) {
  const sol = app.store.get(aid) || '', done = app.store.get(aid + ':done') === '1';
  return `<div class="qsol">
      <textarea class="qta" rows="1" placeholder="Enter your plan…">${esc(sol)}</textarea>
      <label class="qdone"><input type="checkbox" ${done ? 'checked' : ''}> resolved</label>
      <span class="qsaved">saved</span></div>`;
}
const statusPill = (b) => {
  const lab = b.status === 'short' ? `SHORT ${b.residualShort}` : b.status === 'surplus' ? `+${b.residualSurplus}` : 'BALANCED';
  return `<span class="hpill ${b.status}">${lab}</span>`;
};
const shopCodes = (b) => b.shops.join(' / ');

/* ------------------------------------------------------------------ tactical */
let tacticalIndex = [];           // flat list of rendered actions, by data-i

function itemHtml(a, i) {
  const cls = a.type === 'route' ? 'route' : a.cls || 'insp';
  const ps = planState(app.store, a.actid);
  const flag = planFlagText(ps);
  const metas = a.metas.map((m) => `<span class="pill ${m.c || ''}">${esc(m.t)}</span>`).join('');
  return `<div class="item ${cls} ${ps}" data-i="${i}" data-aid="${esc(a.actid)}">
    <span class="tag"></span>
    <div class="body">
      <div class="r1"><span class="loco">${esc(a.loco)}</span><span class="model">${esc(a.model)}</span></div>
      <div class="act">${a.text}</div>
      ${a.hint ? `<div class="hint">${esc(a.hint)}</div>` : ''}
      <div class="meta">${metas}</div>
      ${solBlock(a.actid)}
    </div>
    ${flag ? `<span class="planflag">${flag}</span>` : ''}<span class="arrow">→</span></div>`;
}

function tacticalHtml() {
  const hm = app.hubModel;
  tacticalIndex = [];
  const groups = [...hm.hubs, UNASSIGNED_HUB].map((b) => {
    const acts = (hm.tactical[b.id] || []).filter((a) => filter === 'all' || a.type === filter);
    return { b, acts };
  }).filter((g) => g.acts.length);
  if (!groups.length) return `<div class="empty">No actions in this view.<br>Every hub is balanced here.</div>`;
  groups.sort((x, y) => {
    const a = hubSeverity(hm.byId[x.b.id], x.acts), b = hubSeverity(hm.byId[y.b.id], y.acts);
    return b[0] - a[0] || b[1] - a[1] || b[2] - a[2] || b[3] - a[3];
  });
  return groups.map(({ b, acts }) => {
    const bal = hm.byId[b.id];
    const overdue = acts.filter((a) => a.overdue).length;
    const short = acts.filter((a) => a.actid.startsWith('short:')).length;
    const dead = acts.filter((a) => a.type === 'route').length;
    const chips = [short && `<span class="hc short">${short} short</span>`, overdue && `<span class="hc od">${overdue} overdue</span>`,
      dead && `<span class="hc dead">${dead} dead</span>`].filter(Boolean).join('');
    const items = acts.map((a) => { tacticalIndex.push(a); return itemHtml(a, tacticalIndex.length - 1); }).join('');
    return `<div class="hubgrp${collapsed.has(b.id) ? ' collapsed' : ''}" data-hub="${b.id}">
      <div class="hubh"><span class="tw">▾</span>
        <span class="hn">${esc(b.name)}</span><span class="hs">${esc(shopCodes(b) || 'no shop')}</span>
        ${bal ? statusPill(bal) : ''}<span class="hcnt">${acts.length}</span>
        ${bal ? `<button class="hfly" title="Show this hub on the map">⌖</button>` : ''}
      </div>
      ${chips ? `<div class="hchips">${chips}</div>` : ''}
      <div class="hubbody">${items}</div></div>`;
  }).join('');
}

/* ------------------------------------------------------------------ strategic */
function strategicHtml() {
  const hm = app.hubModel, sys = hm.strategic.system;
  const maxDev = Math.max(1, ...hm.hubs.map((b) => Math.max(b.residualShort, b.residualSurplus)));
  const order = [...hm.hubs].sort((a, b) => (b.residualShort - a.residualShort) || (a.residualSurplus - b.residualSurplus));
  const rows = order.map((b) => {
    const dev = b.residualShort ? -b.residualShort : b.residualSurplus;
    const w = Math.round((Math.abs(dev) / maxDev) * 50);
    return `<div class="hrow" data-hub="${b.id}" title="${esc(b.name)}: ${b.short} short / ${b.surplus} spare across ${b.stations.length} stations; ${b.cover} covered in hub">
      <span class="hn">${esc(b.name)}<span class="hs">${esc(shopCodes(b))}</span></span>
      <span class="hbar"><i class="${dev < 0 ? 'neg' : 'pos'}" style="${dev < 0 ? 'right:50%' : 'left:50%'};width:${w}%"></i></span>
      ${statusPill(b)}
      <span class="hmeta">${b.cover ? `${b.cover} covered in hub` : '—'} · shop: ${b.inShop} LS${b.deadInbound ? `, ${b.deadInbound} dead inbound` : ''}</span>
    </div>`;
  }).join('');
  const xfers = hm.strategic.transfers.map((t) => {
    const to = hm.byId[t.to], from = t.from ? hm.byId[t.from] : null;
    const ps = planState(app.store, t.actid);
    const flag = planFlagText(ps);
    const text = from
      ? `Move <b>${t.units}</b> unit${t.units > 1 ? 's' : ''} <span class="hi">${esc(from.name)}</span> → <span class="hi">${esc(to.name)}</span>`
      : `<span class="hi">${esc(to.name)}</span> needs <b>${t.units}</b> more — no hub has spare`;
    const why = from
      ? `${esc(to.name)} is short ${to.residualShort} after in-hub cover; ${esc(from.name)} has +${from.residualSurplus} spare · ~${t.km.toLocaleString()} km shop to shop`
      : 'Consider a shop release, lease or HHP substitution';
    return `<div class="item xfer ${ps}" data-aid="${esc(t.actid)}" data-from="${t.from || ''}" data-to="${t.to}">
      <span class="tag"></span>
      <div class="body">
        <div class="r1"><span class="loco">${from ? esc(from.id) + ' → ' + esc(to.id) : esc(to.id)}</span><span class="model">hub transfer</span></div>
        <div class="act">${text}</div>
        <div class="hint">${why}</div>
        ${solBlock(t.actid)}
      </div>
      ${flag ? `<span class="planflag">${flag}</span>` : ''}<span class="arrow">→</span></div>`;
  }).join('');
  return `<div class="sys">
      <div class="sys-h">System balance <span>${app.data.meta && app.data.meta.snapshot ? esc(app.data.meta.snapshot) : ''}${app.dow != null ? ' · day-of-week demand' : ''}</span></div>
      <div class="sys-k">
        <div><b>${sys.short}</b><span>units short</span></div>
        <div><b>${sys.coveredInHub}</b><span>covered in hub</span></div>
        <div class="${sys.residualShort ? 'neg' : ''}"><b>${sys.residualShort}</b><span>need transfer</span></div>
        <div class="pos"><b>${sys.residualSurplus}</b><span>spare system-wide</span></div>
      </div>
      <div class="sys-n">${sys.hubsShort} hub${sys.hubsShort !== 1 ? 's' : ''} short · ${sys.hubsSurplus} in surplus · balance counted after each hub covers its own stations</div>
    </div>
    <div class="sec-h">Hub balance</div>
    <div class="hrows">${rows}</div>
    <div class="sec-h">Transfers between hubs <span>${hm.strategic.transfers.length}</span></div>
    ${xfers || '<div class="empty">No transfers needed — every hub can cover itself.</div>'}`;
}

/* ------------------------------------------------------------------ wiring */
function wirePlan(el, aid) {
  const ta = $('.qta', el), cb = $('.qdone input', el), saved = $('.qsaved', el), timer = {};
  const reflag = () => {
    const ps = planState(app.store, aid);
    el.classList.toggle('planned', ps === 'planned');
    el.classList.toggle('done', ps === 'done');
    let pf = $('.planflag', el);
    const txt = planFlagText(ps);
    if (txt) {
      if (!pf) { pf = document.createElement('span'); pf.className = 'planflag'; el.insertBefore(pf, $('.arrow', el)); }
      pf.textContent = txt;
    } else if (pf) pf.parentNode.removeChild(pf);
  };
  ta.addEventListener('click', (e) => e.stopPropagation());
  ta.addEventListener('input', () => { app.store.set(aid, ta.value); flashSaved(saved, timer, () => emit('plans')); reflag(); });
  cb.addEventListener('change', () => { app.store.set(aid + ':done', cb.checked ? '1' : ''); reflag(); emit('plans'); });
}

function flyToHubs(ids) {
  const pts = [];
  ids.forEach((id) => {
    const b = app.hubModel.byId[id];
    if (!b) return;
    b.stations.forEach((k) => { const s = app.stationsByKey[k]; if (s && s.lat != null) pts.push([s.lat, s.lng]); });
    b.shopObjs.forEach((sh) => pts.push([sh.lat, sh.lng]));
  });
  if (pts.length) map.flyToBounds(pts, { padding: [50, 50], maxZoom: 7, duration: 0.8 });
  toMapOnMobile();
}

function wire(q) {
  $$('.hubh', q).forEach((h) => h.addEventListener('click', (e) => {
    const g = h.parentNode, id = g.dataset.hub;
    if (e.target.closest('.hfly')) { flyToHubs([id]); return; }
    g.classList.toggle('collapsed');
    if (g.classList.contains('collapsed')) collapsed.add(id); else collapsed.delete(id);
  }));
  $$('.hrow', q).forEach((r) => r.addEventListener('click', () => flyToHubs([r.dataset.hub])));
  $$('.item', q).forEach((el) => {
    const aid = el.dataset.aid;
    if (el.classList.contains('xfer')) {
      el.addEventListener('click', (ev) => { if (!ev.target.closest('.qsol')) flyToHubs([el.dataset.from, el.dataset.to].filter(Boolean)); });
    } else {
      const a = tacticalIndex[+el.dataset.i];
      el.addEventListener('click', (ev) => { if (!ev.target.closest('.qsol')) focusAction(a); });
    }
    wirePlan(el, aid);
  });
}

function toMapOnMobile() {
  if (!isMobile()) return;
  byId('right').classList.remove('show');
  $$('.mtab button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'map'));
}

function focusAction(a) {
  let m = null;
  if (a.ref.kind === 'dead') { m = deadByLoco[a.ref.id]; ensureLayerShown('dead'); }
  else {
    m = markerByKey[a.ref.id];
    const st = app.stationsByKey[a.ref.id];
    if (st) ensureLayerShown(layerForStatus(st.status));
  }
  flyToMarker(m);
  toMapOnMobile();
}
