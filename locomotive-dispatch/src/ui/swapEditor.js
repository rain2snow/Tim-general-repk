/**
 * Swap-plan editor (modal): exchange units between a spoke terminal and its hub's shop terminal.
 * Opened from the action queue (inspection actions, hub groups), a terminal popup or the Fleet tab.
 *   openSwapEditor({ id })                       edit an existing plan
 *   openSwapEditor({ spoke, units?, base?, hub? }) new plan, auto-filled from the spoke's due units
 */
import { esc } from '../core/html.js';
import { displayState } from '../core/constants.js';
import { hubTerminals, suggestSwap, swapCandidates, swapSummary, committedUnits, nextSwapId, SWAP_FIT_DAYS } from '../core/swaps.js';
import { app } from './state.js';
import { saveSwap, deleteSwap } from './app.js';
import { showView } from './views/navigation.js';

/** Re-analysis resets to the console; stay on the Fleet tab if that is where the editor was opened. */
const stayOnView = () => { const v = document.querySelector('#vtab button.on'); return v ? v.dataset.view : 'console'; };
const restore = (v) => { if (v && v !== 'console') showView(v); };

let el = null;
let st = null;      // { id, isNew, hub, spoke, base, toHub, toSpoke, eta, note, msg }

const hm = () => app.hubModel;
const stName = (k) => { const s = app.stationsByKey[k]; return s ? `${s.station}, ${displayState(s.state)}` : String(k || '').split('|')[0]; };
const ops = () => ({ swaps: app.swaps, deadheads: app.deadheads, consists: app.consists });
const terminalsOf = (hubId) => { const h = hm().byId[hubId]; return h ? hubTerminals(h, app.data.stations) : []; };

/** Stations of a hub that can be a spoke (have a plan or units), terminals excluded, by name. */
function spokesOf(hubId, base) {
  const h = hm().byId[hubId];
  if (!h) return [];
  return h.stations.map((k) => app.stationsByKey[k])
    .filter((s) => s && s.k !== base && (s.required > 0 || (s.roster || []).length))
    .sort((a, b) => (b.insp_n || 0) - (a.insp_n || 0) || a.station.localeCompare(b.station));
}

export function openSwapEditor(opts = {}) {
  if (!app.hubModel) return;
  const existing = opts.id ? app.swaps.find((w) => w.id === opts.id) : null;
  if (existing) {
    st = { ...existing, toHub: [...existing.toHub], toSpoke: [...existing.toSpoke], isNew: false, msg: '' };
  } else {
    const hubId = opts.hub || hm().stationHub[opts.spoke || opts.base] || hm().hubs[0].id;
    const base = opts.base || terminalsOf(hubId)[0];
    const spoke = opts.spoke && opts.spoke !== base ? opts.spoke : '';
    st = { id: nextSwapId(app.swaps), isNew: true, hub: hubId, spoke, base, toHub: [], toSpoke: [], eta: '', note: '', msg: '' };
    if (spoke) autofill(opts.units || null);
  }
  ensureEl();
  draw();
  el.classList.add('show');
  const first = el.querySelector('select, input');
  if (first) first.focus({ preventScroll: true });
}

export function closeSwapEditor() { if (el) el.classList.remove('show'); st = null; }

function autofill(only) {
  if (!st.spoke || !st.base) { st.msg = 'Pick a spoke and a hub terminal first.'; return; }
  const h = hm().byId[st.hub];
  const sug = suggestSwap(app.data, h, st.spoke, { baseKey: st.base, ops: ops(), only, exceptSwapId: st.id });
  st.toHub = sug.toHub; st.toSpoke = sug.toSpoke;
  st.msg = !sug.toHub.length ? `No units due for inspection at ${stName(st.spoke)} — add units by hand.`
    : sug.unmatched > 0 ? `Only ${sug.toSpoke.length} fit replacement${sug.toSpoke.length === 1 ? '' : 's'} at ${stName(st.base)} — ${sug.unmatched} short.`
      : `Suggested: ${sug.toHub.length} out, ${sug.toSpoke.length} back.`;
}

function ensureEl() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'swapdlg';
  el.className = 'swp-overlay';
  el.innerHTML = '<div class="swp-card" role="dialog" aria-modal="true" aria-labelledby="swp-title"></div>';
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('input', (e) => {
    if (!st) return;
    if (e.target.name === 'eta') st.eta = e.target.value;
    if (e.target.name === 'note') st.note = e.target.value;
    if (e.target.classList.contains('swp-addin')) e.target.value = e.target.value.toUpperCase().replace(/\s+/g, '');
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSwapEditor();
    if (e.key === 'Enter' && e.target.classList.contains('swp-addin')) { e.preventDefault(); addTyped(e.target.dataset.side, e.target); }
  });
}

function addTyped(side, input) {
  const id = input.value.trim().toUpperCase();
  if (!id) return;
  if (!app.locoIndex[id]) { st.msg = `${id} is not in this snapshot.`; draw(); return; }
  addUnit(side, id);
}

function addUnit(side, loco) {
  const other = side === 'toHub' ? 'toSpoke' : 'toHub';
  st[other] = st[other].filter((l) => l !== loco);
  if (!st[side].includes(loco)) st[side].push(loco);
  const f = app.locoIndex[loco], where = side === 'toHub' ? st.spoke : st.base;
  st.msg = f && f.k !== where ? `${loco} is at ${f.loc || f.k}, not ${stName(where)}.` : '';
  draw();
}

function onChange(e) {
  if (!st) return;
  const n = e.target.name;
  if (n === 'hub') {
    st.hub = e.target.value; st.base = terminalsOf(st.hub)[0]; st.spoke = ''; st.toHub = []; st.toSpoke = []; st.msg = ''; draw();
  } else if (n === 'base') {
    st.base = e.target.value; if (st.spoke === st.base) st.spoke = ''; st.toSpoke = []; st.msg = ''; draw();
  } else if (n === 'spoke') {
    st.spoke = e.target.value; st.toHub = []; st.toSpoke = []; if (st.spoke) autofill(null); draw();
  }
}

function onClick(e) {
  if (!st) return;
  if (e.target === el) { closeSwapEditor(); return; }
  const b = e.target.closest('[data-sw]');
  if (!b) return;
  const act = b.dataset.sw;
  if (act === 'close') closeSwapEditor();
  else if (act === 'add') addTyped(b.dataset.side, el.querySelector(`.swp-addin[data-side="${b.dataset.side}"]`));
  else if (act === 'pick') addUnit(b.dataset.side, b.dataset.loco);
  else if (act === 'del') { st[b.dataset.side] = st[b.dataset.side].filter((l) => l !== b.dataset.loco); st.msg = ''; draw(); }
  else if (act === 'auto') { autofill(null); draw(); }
  else if (act === 'save') {
    if (!st.spoke || !st.base) { st.msg = 'Pick a spoke and a hub terminal.'; draw(); return; }
    if (!st.toHub.length && !st.toSpoke.length) { st.msg = 'Add at least one unit.'; draw(); return; }
    const { id, hub, spoke, base, toHub, toSpoke, eta, note } = st;
    const view = stayOnView();
    closeSwapEditor();
    saveSwap({ id, hub, spoke, base, toHub, toSpoke, eta: eta.trim(), note: note.trim() });
    restore(view);
  } else if (act === 'delete') {
    if (!confirm(`Cancel swap plan ${st.id}? Its units go back to their automatic homes.`)) return;
    const id = st.id, view = stayOnView(); closeSwapEditor(); deleteSwap(id); restore(view);
  }
}

const inspTxt = (d) => (d == null ? 'insp —' : d < 0 ? `overdue ${-d}d` : `insp ${d}d`);
const inspCls = (d) => (d == null ? '' : d < 0 ? 'od' : d <= 3 ? 'due' : d <= SWAP_FIT_DAYS ? 'soon' : 'ok');

function chips(side, units) {
  if (!units.length) return '<span class="dim">No units yet.</span>';
  return units.map((u) => `<span class="swp-chip${u.missing ? ' bad' : !u.counted ? ' nc' : ''}">
      <b>${esc(u.loco)}</b> <span class="dim">${esc(u.model || '?')}</span>
      ${u.missing ? '' : `<span class="swp-i ${inspCls(u.inspDays)}">${inspTxt(u.inspDays)}</span>`}
      ${!u.missing && !u.counted ? `<span class="swp-i">${esc(u.op)} · not counted</span>` : ''}
      ${!u.missing && !u.here ? `<span class="swp-i away">at ${esc(String(u.at).split('|')[0])}</span>` : ''}
      <button type="button" class="cs-mini" data-sw="del" data-side="${side}" data-loco="${esc(u.loco)}" title="Remove">✕</button></span>`).join('');
}

function candList(side, list, chosen) {
  const rest = list.filter((u) => !chosen.includes(u.loco)).slice(0, 14);
  if (!rest.length) return `<div class="dim swp-none">${side === 'toHub' ? 'No other units at the spoke.' : `No fit units at the terminal (Available, &lt;4000 hp, inspection &gt;${SWAP_FIT_DAYS}d).`}</div>`;
  return rest.map((u) => `<button type="button" class="swp-cand${u.committed ? ' busy' : ''}" data-sw="pick" data-side="${side}" data-loco="${esc(u.loco)}"
      title="${u.committed ? 'Already in another plan, deadhead or consist' : 'Add'}">+ <b>${esc(u.loco)}</b> ${esc(u.model)}
      <span class="swp-i ${inspCls(u.inspDays)}">${inspTxt(u.inspDays)}</span>${!u.counted ? ` <span class="swp-i">${esc(u.op)}</span>` : ''}${u.committed ? ' <span class="swp-i">in use</span>' : ''}</button>`).join('');
}

function draw() {
  const card = el.querySelector('.swp-card');
  const hubs = hm().hubs;
  const terms = terminalsOf(st.hub);
  const h = hm().byId[st.hub];
  const baseOpts = [...new Set([...terms, ...(st.base ? [st.base] : []), ...(h ? h.stations.filter((k) => (app.stationsByKey[k] || {}).required > 0) : [])])];
  const spokes = spokesOf(st.hub, st.base);
  const sum = swapSummary({ ...st }, app.data);
  const committed = committedUnits(ops(), st.id);
  const cands = st.spoke && st.base ? swapCandidates(app.data, st.spoke, st.base, { committed, wantFams: sum.toHubUnits.map((u) => u.fam).filter(Boolean) }) : { toHub: [], toSpoke: [] };
  const spoke = app.stationsByKey[st.spoke];
  const netTxt = sum.net === 0 ? 'even swap' : sum.net > 0 ? `+${sum.net} to the spoke` : `${sum.net} at the spoke`;
  card.innerHTML = `
    <div class="swp-h"><div><div class="swp-t" id="swp-title">${st.isNew ? 'New swap plan' : 'Swap plan'} <span class="swp-id">${esc(st.id)}</span></div>
      <div class="swp-sub">Spoke units go to the hub shop; fit units come back so the spoke keeps its power.</div></div>
      <button type="button" class="swp-x" data-sw="close" aria-label="Close">×</button></div>
    <div class="swp-grid3">
      <label>Hub<select name="hub">${hubs.map((b) => `<option value="${b.id}"${b.id === st.hub ? ' selected' : ''}>${esc(b.name)} (${esc(b.shops.join('/'))})</option>`).join('')}</select></label>
      <label>Spoke terminal<select name="spoke"><option value="">— choose —</option>${spokes.map((s) => `<option value="${esc(s.k)}"${s.k === st.spoke ? ' selected' : ''}>${esc(s.station)}, ${esc(displayState(s.state))}${s.insp_n ? ` · ${s.insp_n} insp due` : ''}${s.status === 'short' ? ` · short ${s.shortfall}` : ''}</option>`).join('')}</select></label>
      <label>Hub terminal (shop)<select name="base">${baseOpts.map((k) => `<option value="${esc(k)}"${k === st.base ? ' selected' : ''}>${esc(stName(k))}${terms.includes(k) ? ' · shop' : ''}</option>`).join('')}</select></label>
    </div>
    ${spoke ? `<div class="swp-spoke">${esc(spoke.station)}: ${spoke.have} on hand vs ${spoke.required} required · ${spoke.insp_n || 0} inspection${spoke.insp_n === 1 ? '' : 's'} due${spoke.overdue_n ? ` (${spoke.overdue_n} overdue)` : ''}</div>` : ''}
    <div class="swp-cols">
      <div class="swp-col"><div class="swp-ch">Spoke → hub shop <span>${esc(stName(st.spoke) || '—')} → ${esc(stName(st.base))}</span></div>
        <div class="swp-chips" data-side="toHub">${chips('toHub', sum.toHubUnits)}</div>
        <div class="swp-add"><input class="swp-addin" data-side="toHub" list="asg-locos" placeholder="Add unit…" spellcheck="false"><button type="button" class="asg-btn" data-sw="add" data-side="toHub">Add</button></div>
        <div class="swp-cl">At the spoke</div><div class="swp-cands">${st.spoke ? candList('toHub', cands.toHub, st.toHub) : '<div class="dim swp-none">Choose a spoke.</div>'}</div></div>
      <div class="swp-col"><div class="swp-ch">Hub → spoke <span>${esc(stName(st.base))} → ${esc(stName(st.spoke) || '—')}</span></div>
        <div class="swp-chips" data-side="toSpoke">${chips('toSpoke', sum.toSpokeUnits)}</div>
        <div class="swp-add"><input class="swp-addin" data-side="toSpoke" list="asg-locos" placeholder="Add unit…" spellcheck="false"><button type="button" class="asg-btn" data-sw="add" data-side="toSpoke">Add</button></div>
        <div class="swp-cl">Fit units at the hub terminal</div><div class="swp-cands">${st.spoke ? candList('toSpoke', cands.toSpoke, st.toSpoke) : ''}</div></div>
    </div>
    <div class="swp-row"><input name="eta" placeholder="ETA (e.g. 11/14 06:00)" maxlength="30" value="${esc(st.eta || '')}"><input name="note" placeholder="Note / train (optional)" maxlength="80" value="${esc(st.note || '')}"></div>
    <div class="swp-sum"><span class="swp-net ${sum.net < 0 ? 'neg' : sum.net > 0 ? 'pos' : ''}">${netTxt}</span>
      <span>${sum.toHubUnits.length} out · ${sum.toSpokeUnits.length} back · ≈ ${sum.hpOut.toLocaleString()} hp out / ${sum.hpIn.toLocaleString()} hp back</span></div>
    ${sum.warnings.length && (st.toHub.length || st.toSpoke.length) ? `<div class="cs-warn">${sum.warnings.map((w) => '⚠ ' + esc(w)).join('<br>')}</div>` : ''}
    <div class="asg-msg swp-msg ${st.msg ? 'warn' : ''}" aria-live="polite">${esc(st.msg || '')}</div>
    <div class="swp-btns">
      <button type="button" class="asg-btn primary" data-sw="save">${st.isNew ? 'Save swap plan' : 'Update plan'}</button>
      <button type="button" class="asg-btn" data-sw="auto" title="Send every unit due for inspection at the spoke; pick fit replacements of the same family">Auto-fill</button>
      ${st.isNew ? '' : '<button type="button" class="asg-btn ghost" data-sw="delete">Cancel plan</button>'}
      <button type="button" class="asg-btn ghost" data-sw="close">Close</button>
    </div>
    <div class="asg-help">Each unit is planned as a deadhead to the other end (shown on the map, counted at its destination, tagged with the plan). Saving takes the units out of any other swap plan or manual deadhead.</div>`;
}
