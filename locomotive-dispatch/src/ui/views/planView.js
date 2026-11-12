/**
 * Captive Plan tab: view and edit the captive plan (locations, jobs/trains, unit types, day-of-week
 * requirement). Edits build up as a draft; "Apply to console" re-analyses the current STP snapshot
 * against it (Console, Dashboard, hubs, actions all update) and saves it in this browser.
 * Export / Import move a plan between browsers or into the repo (data/static-plan.json).
 */
import { esc, escAttr } from '../../core/html.js';
import {
  clonePlan, normalizeStation, setDay, newStation, diffPlan, stationSig, stationWarnings, planTypes,
  updateOverrides, DAY_NAMES, PLAN_REGIONS,
} from '../../core/planEdit.js';
import { $, $$, byId, downloadText } from '../dom.js';
import { app, on } from '../state.js';
import { parsePlanFile } from '../planStore.js';
import { showView } from './navigation.js';

let ctx = null;                       // { applyPlan, analyzeWithPlan }
let draft = null;                     // working copy of the plan
let sel = null;                       // selected location key
const ui = { q: '', region: '', onlyEdited: false, adding: false };

const builtin = () => app.reference.plan;
const byKey = (plan) => Object.fromEntries(plan.plan.map((s) => [s.k, s]));
const ensureDraft = () => { if (!draft) draft = clonePlan(app.plan); };
const unsaved = () => diffPlan(app.plan, draft);
const fromBuiltin = (plan) => diffPlan(builtin(), plan);

export function initPlanView(c) {
  ctx = c;
  const root = byId('planview');
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', (e) => {
    if (e.target.id === 'pl-q') { ui.q = e.target.value; renderList(); }
  });
  const chip = byId('planchip');
  if (chip) chip.addEventListener('click', () => showView('plan'));
  on('plan', () => { if (chip) chip.hidden = !app.planEdited; });
  on('plan', () => { draft = null; });   // active plan replaced (apply / import): rebuild the draft from it
}

/** Called when the tab opens. */
export function buildPlanView() {
  ensureDraft();
  const root = byId('planview');
  root.innerHTML = `
    <div class="dash-h">
      <h2>Captive plan</h2>
      <span class="sub">locations, jobs &amp; required units by type and day — edits re-run the analysis on the current snapshot</span>
      <span class="pl-actions">
        <button class="actexport" data-act="export" title="Download the active plan as static-plan.json">Export JSON</button>
        <button class="actexport" data-act="import" title="Load a plan file into the draft (review, then Apply)">Import JSON</button>
        <button class="actexport" data-act="reset" title="Discard all edits and return to the built-in plan">Reset to built-in</button>
        <input type="file" id="pl-file" accept=".json,application/json" hidden>
      </span>
    </div>
    <div id="pl-bar"></div>
    <div class="pl-grid">
      <div class="pl-list">
        <div class="pl-filters">
          <input id="pl-q" type="search" placeholder="Find location, zone or train ID…" value="${escAttr(ui.q)}" autocomplete="off">
          <select id="pl-region"><option value="">All regions</option>${PLAN_REGIONS.map((r) => `<option ${ui.region === r ? 'selected' : ''}>${r}</option>`).join('')}<option value="-" ${ui.region === '-' ? 'selected' : ''}>No region</option></select>
          <label class="pl-chk"><input type="checkbox" id="pl-edited" ${ui.onlyEdited ? 'checked' : ''}> edited</label>
          <button class="pl-btn" data-act="add">+ Location</button>
        </div>
        <div id="pl-add"></div>
        <div class="pl-table" id="pl-table"></div>
      </div>
      <div class="pl-edit" id="pl-edit"></div>
    </div>`;
  renderBar(); renderAdd(); renderList(); renderEditor();
}

/* ------------------------------------------------------------------ status bar */
function renderBar() {
  const el = byId('pl-bar'); if (!el) return;
  const applied = fromBuiltin(app.plan), pending = unsaved();
  const list = (d) => d.slice(0, 6).map((x) => `<span class="pl-tag ${x.kind}">${esc(x.station)}</span>`).join('') + (d.length > 6 ? ` <span class="pl-more">+${d.length - 6}</span>` : '');
  el.innerHTML = `
    <div class="pl-state ${applied.length ? 'edited' : ''}">
      <b>${applied.length ? 'Edited plan in use' : 'Built-in plan in use'}</b>
      ${applied.length ? `<span>${applied.length} location${applied.length > 1 ? 's' : ''} differ from built-in · saved in this browser</span>${list(applied)}` : '<span>no edits</span>'}
    </div>
    ${pending.length ? `<div class="pl-pending"><b>${pending.length} unsaved change${pending.length > 1 ? 's' : ''}</b>${list(pending)}
      <span class="pl-sp"></span><button class="pl-btn ghost" data-act="discard">Discard</button><button class="pl-btn primary" data-act="apply">Apply to console</button></div>` : ''}`;
}

/* ------------------------------------------------------------------ list */
function renderAdd() {
  const el = byId('pl-add'); if (!el) return;
  el.innerHTML = ui.adding ? `<div class="pl-addform">
      <input id="pa-station" placeholder="Station code (e.g. BRANTFORD)" maxlength="12">
      <input id="pa-state" placeholder="Prov/State" maxlength="2">
      <input id="pa-lat" placeholder="Lat" type="number" step="0.01"><input id="pa-lng" placeholder="Lng" type="number" step="0.01">
      <select id="pa-region"><option value="">Region…</option>${PLAN_REGIONS.map((r) => `<option>${r}</option>`).join('')}</select>
      <input id="pa-zone" placeholder="Zone" list="pl-zones">
      <button class="pl-btn primary" data-act="add-ok">Add</button><button class="pl-btn ghost" data-act="add-cancel">Cancel</button>
      <div class="pl-err" id="pa-err"></div></div>` : '';
}

function renderList() {
  const el = byId('pl-table'); if (!el) return;
  const b = byKey(builtin()), a = byKey(app.plan);
  const q = ui.q.trim().toUpperCase();
  const rank = (r) => { const i = PLAN_REGIONS.indexOf(r); return i < 0 ? 9 : i; };
  const rows = draft.plan.filter((s) => {
    if (ui.region === '-' ? s.region : ui.region && s.region !== ui.region) return false;
    const changed = !b[s.k] || stationSig(s) !== stationSig(b[s.k]) || !a[s.k] || stationSig(s) !== stationSig(a[s.k]);
    if (ui.onlyEdited && !changed) return false;
    if (!q) return true;
    return s.station.includes(q) || (s.zone || '').includes(q) || s.k.includes(q) ||
      (s.trains || []).some((t) => t.ids.some((id) => id.toUpperCase().includes(q)));
  }).sort((x, y) => rank(x.region) - rank(y.region) || (x.zone || '~').localeCompare(y.zone || '~') || x.station.localeCompare(y.station));
  const live = app.stationsByKey || {};
  el.innerHTML = `<table class="pl-tbl"><thead><tr>
      <th class="l">Location</th><th class="l">Region · zone</th><th title="Captive jobs">Jobs</th><th title="Trains / jobs listed">Trains</th>
      <th title="Required units (peak)">Req</th><th title="Day-of-week requirement, Sun–Sat">Days</th><th title="Current balance on hand vs required (applied plan)">Now</th></tr></thead><tbody>` +
    rows.map((s) => {
      const isNew = !b[s.k], editedB = isNew || stationSig(s) !== stationSig(b[s.k]);
      const pending = !a[s.k] || stationSig(s) !== stationSig(a[s.k]);
      const dot = pending ? '<span class="pl-dot pending" title="unsaved change"></span>' : editedB ? `<span class="pl-dot ${isNew ? 'added' : 'edited'}" title="${isNew ? 'added location' : 'edited from built-in'}"></span>` : '';
      const lo = Math.min(...(s.rbd || [s.required])), hi = Math.max(...(s.rbd || [s.required]));
      const L = live[s.k];
      const net = L && L.required ? L.have - L.required : null;
      const now = L ? (L.required ? `<span class="${net < 0 ? 'neg' : net > 0 ? 'pos' : 'zero'}">${net > 0 ? '+' : ''}${net}</span>` : (L.status === 'free' ? '<span class="pos" title="free low/mid HP">free</span>' : '<span class="dim">—</span>')) : '<span class="dim">new</span>';
      return `<tr class="${s.k === sel ? 'sel' : ''}" data-k="${escAttr(s.k)}"><td class="l">${dot}<b>${esc(s.station)}</b> <span class="dim">${esc(s.state)}</span></td>
        <td class="l dim">${esc(s.region || '—')} · ${esc(s.zone || '—')}</td><td>${s.captive_jobs || 0}</td><td>${(s.trains || []).length}</td>
        <td><b>${s.required}</b></td><td class="dim">${s.required ? (lo === hi ? lo : `${lo}–${hi}`) : '—'}</td><td>${now}</td></tr>`;
    }).join('') + `</tbody></table>${rows.length ? '' : '<div class="empty">No locations match.</div>'}
    <datalist id="pl-zones">${[...new Set(draft.plan.map((s) => s.zone).filter(Boolean))].sort().map((z) => `<option value="${escAttr(z)}">`).join('')}</datalist>`;
}

/* ------------------------------------------------------------------ editor */
function typeOptions(selected) {
  return planTypes(draft).map((t) => `<option ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

function renderEditor() {
  const el = byId('pl-edit'); if (!el) return;
  const s = sel && draft.plan.find((x) => x.k === sel);
  if (!s) {
    el.innerHTML = `<div class="pl-empty"><b>Select a location</b> to edit its jobs, unit types and day-of-week requirement.<br><br>
      Requirement is derived from the jobs: each job lists its train IDs and the units it needs by type; the location requires the sum.
      Adding a train ID to a location homes that train's units there.</div>`;
    return;
  }
  const b = byKey(builtin())[s.k], a = byKey(app.plan)[s.k];
  const L = (app.stationsByKey || {})[s.k];
  const warns = stationWarnings(s, draft);
  const zones = [...new Set(draft.plan.map((x) => x.zone).filter(Boolean))].sort();
  el.innerHTML = `
    <div class="pe-h">
      <div><h3>${esc(s.station)} <span class="dim">${esc(s.state)}</span></h3>
        <div class="dim">${!b ? '<span class="pl-tag added">added location</span>' : stationSig(s) !== stationSig(b) ? '<span class="pl-tag changed">edited from built-in</span>' : 'built-in'}
        ${!a || stationSig(s) !== stationSig(a) ? ' · <span class="pl-tag pending">unsaved</span>' : ''}
        ${L && L.required ? ` · now ${L.have} on hand vs ${L.required} required` : ''}</div></div>
      <div class="pe-req"><span class="big">${s.required}</span><span>required (peak)</span></div>
    </div>
    <div class="pe-types">${s.req_detail.length ? s.req_detail.map(([t, n]) => `<span class="ltag">${n}× ${esc(t)}</span>`).join('') : '<span class="dim">no units required</span>'}</div>

    <div class="pe-sec">Location</div>
    <div class="pe-row">
      <label>Region<select data-f="region"><option value="">—</option>${PLAN_REGIONS.map((r) => `<option ${s.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>Zone<input data-f="zone" list="pe-zones" value="${escAttr(s.zone || '')}"><datalist id="pe-zones">${zones.map((z) => `<option value="${escAttr(z)}">`).join('')}</datalist></label>
      <label title="Captive jobs count from the source plan (informational)">Captive jobs<input data-f="captive_jobs" type="number" min="0" value="${s.captive_jobs || 0}"></label>
      <label>Lat<input data-f="lat" type="number" step="0.01" value="${s.lat ?? ''}"></label>
      <label>Lng<input data-f="lng" type="number" step="0.01" value="${s.lng ?? ''}"></label>
    </div>

    <div class="pe-sec">Required by day <button class="pl-link" data-act="days-peak">set every day to ${s.required}</button></div>
    <div class="pe-days">${DAY_NAMES.map((d, i) => `<label><span>${d}</span><input data-day="${i}" type="number" min="0" max="${s.required}" value="${(s.rbd || [])[i] ?? s.required}"></label>`).join('')}</div>

    <div class="pe-sec">Jobs / trains <span class="dim">${s.trains.length}</span> <button class="pl-link" data-act="add-train">+ add job</button></div>
    <div class="pe-trains">${s.trains.map((t, ti) => `
      <div class="pe-train">
        <div class="pe-tr1">
          <input class="pe-ids" data-train="${ti}" data-f="ids" value="${escAttr(t.ids.join(' '))}" placeholder="Train IDs, e.g. L580311 L581311">
          <span class="pe-treq">${t.req} unit${t.req !== 1 ? 's' : ''}</span>
          <button class="pl-x" data-act="del-train" data-train="${ti}" title="Remove this job">✕</button>
        </div>
        ${t.shared && t.shared.length ? `<div class="pe-shared">shared with ${esc(t.shared.join(', '))} — counted here (primary)</div>` : ''}
        <div class="pe-tys">${t.types.map(([ty, n], yi) => `
          <span class="pe-ty"><select data-train="${ti}" data-type="${yi}" data-f="type">${typeOptions(ty)}</select>
          <input type="number" min="0" max="99" data-train="${ti}" data-type="${yi}" data-f="count" value="${n}">
          <button class="pl-x" data-act="del-type" data-train="${ti}" data-type="${yi}" title="Remove type">✕</button></span>`).join('')}
          <button class="pl-link" data-act="add-type" data-train="${ti}">+ type</button>
        </div>
      </div>`).join('') || '<div class="dim">No jobs — this location requires no units.</div>'}</div>

    ${(s.shared_in || []).length ? `<div class="pe-sec">Shared jobs counted elsewhere</div><div class="pe-sharedin">${s.shared_in.map((x) =>
      `<div>${esc(x.ids.join(' / '))} → <b>${esc(x.primary)}</b> · ${x.req}u</div>`).join('')}</div>` : ''}

    ${warns.length ? `<div class="pe-warn">${warns.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}

    <div class="pe-foot">
      ${a && stationSig(s) !== stationSig(a) ? '<button class="pl-btn ghost" data-act="undo-loc">Undo unsaved changes here</button>' : ''}
      ${b && stationSig(s) !== stationSig(b) ? '<button class="pl-btn ghost" data-act="builtin-loc">Reset location to built-in</button>' : ''}
      ${!b ? '<button class="pl-btn ghost danger" data-act="remove-loc">Remove location</button>' : ''}
    </div>`;
}

/* ------------------------------------------------------------------ edits */
function updateStation(fn) {
  const i = draft.plan.findIndex((x) => x.k === sel);
  if (i < 0) return;
  draft.plan[i] = fn(draft.plan[i]);
  refresh();
}
const retrain = (s, fn) => normalizeStation({ ...s, trains: fn(s.trains.map((t) => ({ ...t, ids: [...t.ids], types: t.types.map((x) => [...x]) }))) }, s.required);
function refresh() { renderBar(); renderList(); renderEditor(); }

function onChange(e) {
  const t = e.target;
  if (t.id === 'pl-region') { ui.region = t.value; renderList(); return; }
  if (t.id === 'pl-edited') { ui.onlyEdited = t.checked; renderList(); return; }
  if (t.id === 'pl-file') { importFile(t.files[0]); t.value = ''; return; }
  if (!sel || !t.closest('#pl-edit')) return;
  if (t.dataset.day != null) { updateStation((s) => setDay(s, +t.dataset.day, t.value)); return; }
  const f = t.dataset.f, ti = t.dataset.train != null ? +t.dataset.train : null, yi = t.dataset.type != null ? +t.dataset.type : null;
  if (f === 'region' || f === 'zone') updateStation((s) => ({ ...s, [f]: f === 'zone' ? t.value.trim().toUpperCase() : t.value }));
  else if (f === 'captive_jobs') updateStation((s) => normalizeStation({ ...s, captive_jobs: t.value }, s.required));
  else if (f === 'lat' || f === 'lng') updateStation((s) => ({ ...s, [f]: t.value === '' ? null : Number(t.value) }));
  else if (f === 'ids') updateStation((s) => retrain(s, (tr) => { tr[ti].ids = t.value.toUpperCase().split(/[\s,;/]+/).filter(Boolean); return tr; }));
  else if (f === 'type') updateStation((s) => retrain(s, (tr) => { tr[ti].types[yi][0] = t.value; return tr; }));
  else if (f === 'count') updateStation((s) => retrain(s, (tr) => { tr[ti].types[yi][1] = Number(t.value) || 0; return tr; }));
}

function onClick(e) {
  const row = e.target.closest('tr[data-k]');
  if (row) { sel = row.dataset.k; renderList(); renderEditor(); return; }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act, ti = btn.dataset.train != null ? +btn.dataset.train : null, yi = btn.dataset.type != null ? +btn.dataset.type : null;
  switch (act) {
    case 'apply': return apply();
    case 'discard': draft = clonePlan(app.plan); return refresh();
    case 'export': return exportPlan();
    case 'import': return byId('pl-file').click();
    case 'reset':
      if (!confirm('Discard all captive-plan edits in this browser and return to the built-in plan?')) return;
      draft = clonePlan(builtin());
      ctx.applyPlan(builtin(), { builtIn: true });
      return showView('plan');
    case 'add': ui.adding = !ui.adding; return renderAdd();
    case 'add-cancel': ui.adding = false; return renderAdd();
    case 'add-ok': return addLocation();
    case 'days-peak': return updateStation((s) => ({ ...s, rbd: Array(7).fill(s.required) }));
    case 'add-train': return updateStation((s) => retrain(s, (tr) => [...tr, { ids: [], req: 0, types: [[planTypes(draft)[0], 1]], shared: [] }]));
    case 'del-train': return updateStation((s) => retrain(s, (tr) => tr.filter((_, i) => i !== ti)));
    case 'add-type': return updateStation((s) => retrain(s, (tr) => { tr[ti].types.push([tr[ti].types[0] ? tr[ti].types[0][0] : planTypes(draft)[0], 1]); return tr; }));
    case 'del-type': return updateStation((s) => retrain(s, (tr) => { tr[ti].types.splice(yi, 1); return tr; }));
    case 'undo-loc': { const a = byKey(app.plan)[sel]; return updateStation(() => JSON.parse(JSON.stringify(a))); }
    case 'builtin-loc': { const b = byKey(builtin())[sel]; return updateStation(() => JSON.parse(JSON.stringify(b))); }
    case 'remove-loc':
      if (!confirm('Remove this added location from the plan?')) return;
      draft.plan = draft.plan.filter((x) => x.k !== sel); sel = null; return refresh();
    default: return undefined;
  }
}

function addLocation() {
  const v = (id) => (byId(id).value || '').trim();
  const err = byId('pa-err');
  const st = newStation({ station: v('pa-station'), state: v('pa-state'), lat: v('pa-lat'), lng: v('pa-lng'), region: v('pa-region'), zone: v('pa-zone') });
  if (!st.station || st.state.length !== 2) { err.textContent = 'Enter a station code and a 2-letter province/state.'; return; }
  if (draft.plan.some((x) => x.k === st.k)) { err.textContent = `${st.k} is already in the plan.`; return; }
  draft.plan.push(st); sel = st.k; ui.adding = false;
  renderAdd(); refresh();
}

/* ------------------------------------------------------------------ apply / export / import */
function apply() {
  // record train re-homing for every location whose train IDs changed, relative to the applied plan
  const a = byKey(app.plan), d = byKey(draft);
  let plan = { ...draft, meta: { ...(app.plan.meta || {}), ...(draft.meta || {}) } };
  const keys = new Set([...Object.keys(a), ...Object.keys(d)]);
  keys.forEach((k) => {
    const oldIds = a[k] ? a[k].trains.flatMap((t) => t.ids) : [], newIds = d[k] ? d[k].trains.flatMap((t) => t.ids) : [];
    if (JSON.stringify(oldIds) !== JSON.stringify(newIds)) plan = updateOverrides(plan, app.reference.base2home, k, oldIds, newIds);
  });
  plan.meta = { ...plan.meta, edited: new Date().toISOString() };
  const isBuiltin = !fromBuiltin(plan).length && !Object.keys(plan.meta.base2home_overrides || {}).length;
  ctx.applyPlan(isBuiltin ? builtin() : plan, { builtIn: isBuiltin });
  draft = clonePlan(app.plan);
  showView('plan');
}

function exportPlan() {
  const p = { ...app.plan, meta: { ...(app.plan.meta || {}), exported: new Date().toISOString() } };
  const name = fromBuiltin(app.plan).length ? 'static-plan.edited.json' : 'static-plan.json';
  downloadText(JSON.stringify(p, null, 1), name, 'application/json');
}

function importFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const plan = parsePlanFile(rd.result);
      draft = { ...clonePlan(plan), shops: builtin().shops };
      sel = null;
      buildPlanView();
    } catch (err) { alert('Import failed: ' + err.message); }
  };
  rd.readAsText(file);
}
