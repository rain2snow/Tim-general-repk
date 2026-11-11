/** Console action queue (right panel). */
import { esc } from '../../core/html.js';
import { buildQueueActions, countByType } from '../../core/queue.js';
import { planState } from '../../core/store.js';
import { $, $$, byId, setText, isMobile, flashSaved } from '../dom.js';
import { app, emit } from '../state.js';
import { markerByKey, deadByLoco, flyToMarker, layerForStatus } from '../map/mapView.js';
import { ensureLayerShown } from './layerToggles.js';

let actions = [];
let filter = 'all';

export function rebuildQueue() {
  actions = buildQueueActions(app.data, app.retask);
  const c = countByType(actions);
  setText('c-all', c.all); setText('c-route', c.route); setText('c-swap', c.swap); setText('c-retask', c.retask);
  renderQueue();
}

export function setQueueFilter(f) {
  filter = f;
  $$('#seg button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
  renderQueue();
}

export function initQueue() {
  $$('#seg button').forEach((b) => b.addEventListener('click', () => setQueueFilter(b.dataset.f)));
}

const planFlagText = (ps) => (ps === 'done' ? '✓ DONE' : ps === 'planned' ? '● PLAN' : '');

function itemHtml(a, i) {
  const cls = a.type === 'route' ? 'route' : a.cls || 'insp';
  const aid = a.actid || '';
  const ps = aid ? planState(app.store, aid) : '';
  const flag = planFlagText(ps);
  const metas = a.metas.map((m) => `<span class="pill ${m.c || ''}">${esc(m.t)}</span>`).join('');
  const sol = aid ? app.store.get(aid) || '' : '';
  const done = aid ? app.store.get(aid + ':done') === '1' : false;
  const solBlock = aid ? `<div class="qsol">
        <textarea class="qta" rows="1" placeholder="Enter your plan…">${esc(sol)}</textarea>
        <label class="qdone"><input type="checkbox" ${done ? 'checked' : ''}> resolved</label>
        <span class="qsaved">saved</span></div>` : '';
  return `<div class="item ${cls} ${ps}" data-i="${i}">
    <span class="tag"></span>
    <div class="body">
      <div class="r1"><span class="loco">${esc(a.loco)}</span><span class="model">${esc(a.model)}</span></div>
      <div class="act">${a.text}</div>
      <div class="meta">${metas}</div>
      ${solBlock}
    </div>
    ${flag ? `<span class="planflag">${flag}</span>` : ''}<span class="arrow">→</span></div>`;
}

export function renderQueue() {
  const q = byId('queue');
  if (!q) return;
  const list = actions.filter((a) => filter === 'all' || a.type === filter);
  if (!list.length) { q.innerHTML = `<div class="empty">No actions in this view.<br>The network is balanced here.</div>`; return; }
  // keep the dispatcher's caret if they are typing a plan while the queue repaints
  const active = document.activeElement;
  const focusIdx = active && active.classList.contains('qta') && q.contains(active) ? +active.closest('.item').dataset.i : -1;
  const caretPos = focusIdx >= 0 ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = q.scrollTop;
  q.innerHTML = list.map(itemHtml).join('');
  $$('.item', q).forEach((el, i) => wireItem(el, list[i]));
  if (focusIdx >= 0) {
    const ta = $(`.item[data-i="${focusIdx}"] .qta`, q);
    if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(caretPos[0], caretPos[1]); }
    q.scrollTop = scroll;
  }
}

function wireItem(el, a) {
  el.addEventListener('click', (ev) => { if (ev.target.closest('.qsol')) return; focusAction(a); });
  const aid = a.actid || '';
  if (!aid) return;
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
  if (ta) {
    ta.addEventListener('click', (e) => e.stopPropagation());
    ta.addEventListener('input', () => {
      app.store.set(aid, ta.value);
      flashSaved(saved, timer, () => emit('plans'));
      reflag();
    });
  }
  if (cb) cb.addEventListener('change', () => { app.store.set(aid + ':done', cb.checked ? '1' : ''); reflag(); emit('plans'); });
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
  if (isMobile()) {
    byId('right').classList.remove('show');
    $$('.mtab button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'map'));
  }
}
