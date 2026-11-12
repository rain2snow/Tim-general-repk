/**
 * "Data & handoff" overlay: export / import a session file so the console can be handed between
 * people, browsers and sessions (see core/session.js for the format).
 */
import { buildBundle, parseBundle, summarizeBundle, combineSessions } from '../core/session.js';
import { formatSnapshotLabel } from '../core/dates.js';
import { esc } from '../core/html.js';
import { ACTION_KEY_RE } from '../core/store.js';
import { byId, downloadText } from './dom.js';
import { app, emit } from './state.js';
import { savePlan, clearSavedPlan } from './planStore.js';
import { saveAssignments } from './assignStore.js';
import { saveDeadheads, saveConsists } from './opsStore.js';
import { setTheme } from './theme.js';
import { syncDemandControl } from './console/demandToggle.js';
import { currentSession, useSnapshot, revertToBuiltinSnapshot, setData, analyzeWithPlan } from './app.js';

let pending = null;   // parsed bundle awaiting "Apply"

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SOURCE = { 'built-in': 'built into the app', upload: 'from an STP upload · saved in this browser', import: 'from a session import · saved in this browser' };

export function initSession() {
  byId('reloadbtn').addEventListener('click', refresh);
  byId('ho-export').addEventListener('click', exportSession);
  byId('ho-import').addEventListener('click', () => byId('ho-file').click());
  byId('ho-file').addEventListener('change', (e) => { readImport(e.target.files[0]); e.target.value = ''; });
  byId('snapinfo').addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="revert-snap"]')) return;
    if (!confirm('Go back to the snapshot built into the app? Your plan edits, assignments and action plans are kept.')) return;
    revertToBuiltinSnapshot(); refresh();
  });
  byId('ho-preview').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ho]');
    if (!b) return;
    if (b.dataset.ho === 'cancel') { pending = null; byId('ho-preview').innerHTML = ''; return; }
    if (b.dataset.ho === 'apply') applyImport(pending, (document.querySelector('input[name="ho-mode"]:checked') || {}).value || 'replace');
  });
}

/** What would be exported right now + where the current snapshot came from. */
function refresh() {
  const sess = currentSession();
  const sum = summarizeBundle(buildBundle(sess), app.reference.plan);
  byId('ho-snapdate').textContent = `${formatSnapshotLabel(app.data.meta.snapshot)} · ${app.data.fleet.length.toLocaleString()} units`;
  byId('ho-summary').innerHTML = `<b>This session:</b> ${summaryList(sum)}`;
  byId('snapinfo').innerHTML = `Current snapshot <b>${esc(formatSnapshotLabel(app.data.meta.snapshot))}</b> — ${esc(SOURCE[app.snapshotSource] || app.snapshotSource)}` +
    (app.snapshotSource !== 'built-in' ? ` <button type="button" class="ho-link" data-act="revert-snap">use the built-in snapshot (${esc(formatSnapshotLabel(app.builtinSnapshot.meta.snapshot))})</button>` : '') +
    (app.snapshotSource !== 'built-in' && app.snapshotSaved === false ? ' <span class="ho-warn">— too large to save in this browser; it lasts until you close the page</span>' : '');
}

function summaryList(sum) {
  const parts = [
    sum.planLocations ? `captive plan edited at ${plural(sum.planLocations, 'location')}` + (sum.trainRehomes ? ` (${plural(sum.trainRehomes, 'train re-homing')})` : '') : 'built-in captive plan',
    plural(sum.assignments, 'manual assignment'),
    ...(sum.deadheads ? [plural(sum.deadheads, 'planned deadhead')] : []),
    ...(sum.consists ? [plural(sum.consists, 'consist')] : []),
    `${plural(sum.actionPlans, 'action plan')}${sum.resolved ? ` (${sum.resolved} resolved)` : ''}`,
    `${sum.theme} mode`,
    sum.demandDay == null ? 'peak demand' : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][sum.demandDay]} demand`,
  ];
  return parts.map(esc).join(' · ');
}

function exportSession() {
  const sess = currentSession();
  const b = buildBundle({ ...sess, snapshot: byId('ho-snap').checked ? sess.snapshot : null, by: byId('ho-by').value, note: byId('ho-note').value });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  downloadText(JSON.stringify(b), `dispatch-session_${b.snapshot ? b.snapshot.meta.snapshot + '_' : ''}${stamp}.json`, 'application/json');
}

function readImport(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try { pending = parseBundle(rd.result); showPreview(pending); }
    catch (err) { pending = null; byId('ho-preview').innerHTML = `<div class="ho-err">${esc(err.message)}</div>`; }
  };
  rd.readAsText(file);
}

function showPreview(b) {
  const sum = summarizeBundle(b, app.reference.plan);
  const when = sum.exportedAt ? new Date(sum.exportedAt).toLocaleString() : '';
  const snapLine = sum.snapshotDate
    ? `snapshot <b>${esc(formatSnapshotLabel(sum.snapshotDate))}</b> (${sum.snapshotUnits.toLocaleString()} units)` +
      (sum.snapshotDate < app.data.meta.snapshot ? ' <span class="ho-warn">— older than the one you have open</span>' : '') +
      (sum.lossless ? '' : ' <span class="ho-warn">— older file format: inspections, notes and ETAs are not included</span>')
    : `no snapshot — keeps yours (<b>${esc(formatSnapshotLabel(app.data.meta.snapshot))}</b>)`;
  byId('ho-preview').innerHTML = `<div class="ho-card">
      <div class="ho-h">Session from ${esc(sum.by || 'an unnamed dispatcher')}${when ? ` · ${esc(when)}` : ''}</div>
      ${sum.note ? `<div class="ho-note">“${esc(sum.note)}”</div>` : ''}
      <div class="ho-sum">${summaryList(sum)}<br>${snapLine}</div>
      <div class="ho-modes">
        <label><input type="radio" name="ho-mode" value="replace" checked> <b>Replace</b> my session with this one <span>(recommended for a handoff)</span></label>
        <label><input type="radio" name="ho-mode" value="merge"> <b>Merge</b> — add its assignments and action plans to mine; use its plan / snapshot if it has them</label>
      </div>
      <div class="ho-btns"><button class="ho-btn primary" type="button" data-ho="apply">Apply session</button><button class="ho-btn" type="button" data-ho="cancel">Cancel</button></div>
    </div>`;
}

/** Apply an imported session: settings, plan, assignments, action plans, snapshot; then re-analyse. */
export function applyImport(bundle, mode = 'replace') {
  const mine = currentSession();
  const next = combineSessions(mine, bundle, mode);

  // action plans + resolved flags
  if (mode === 'replace') Object.keys(app.store.entries(ACTION_KEY_RE)).forEach((k) => app.store.remove(k));
  Object.entries(next.actionPlans).forEach(([k, v]) => app.store.set(k, v));
  // manual assignments
  app.assignments = { ...next.assignments };
  saveAssignments(app.assignments);
  // planned deadheads + consists
  app.deadheads = { ...(next.deadheads || {}) }; saveDeadheads(app.deadheads);
  app.consists = (next.consists || []).map((c) => ({ ...c })); saveConsists(app.consists);
  // captive plan
  if (next.plan) { app.plan = { ...next.plan, shops: app.reference.plan.shops }; app.planEdited = true; savePlan(app.plan); }
  else if (mode === 'replace') { app.plan = app.reference.plan; app.planEdited = false; clearSavedPlan(); }
  // snapshot
  if (next.snapshot) useSnapshot(next.snapshot, 'import');
  // settings
  setTheme(next.settings.theme === 'dark' ? 'dark' : 'light');
  app.dow = Number.isInteger(next.settings.demandDay) ? next.settings.demandDay : null;
  syncDemandControl(app.dow);

  setData(analyzeWithPlan());
  emit('plan'); emit('assign'); emit('snapshot'); emit('plans');
  pending = null;
  const sum = summarizeBundle(buildBundle(currentSession()), app.reference.plan);
  byId('ho-preview').innerHTML = `<div class="ho-ok">✓ Session applied (${mode}) — ${summaryList(sum)}</div>`;
  refresh();
}
